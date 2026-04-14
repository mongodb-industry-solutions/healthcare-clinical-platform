"""
Patient 360 Materializer service.

Reads FHIR bundles from synthetic_patients and vitals from synthetic_vitals,
extracts/transforms them into the denormalized Patient 360 schema, and
persists the result to the patient_360 collection.

All business logic lives here — no HTTP, no direct MongoDB queries.
"""
from __future__ import annotations

import hashlib
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from materializer.models import (
    MaterializeAllResponse,
    MaterializeSingleResponse,
)
from materializer.repository import MaterializerRepository

logger = logging.getLogger(__name__)

# Vitals fields used for summary computation
_VITAL_FIELDS = ["heart_rate", "respiratory_rate", "temperature", "spo2", "activity_level"]

# SNOMED codes referenced for flag/threshold logic
_CKD_CODE = "433144002"
_T2DM_CODE = "44054006"
_HTN_CODE = "59621000"


class MaterializerService:
    def __init__(self, repo: MaterializerRepository):
        self._repo = repo

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def materialize_patient(self, patient_id: str) -> Optional[MaterializeSingleResponse]:
        """
        Build (or rebuild) the Patient 360 document for a single patient.
        Returns None if the patient does not exist in synthetic_patients.
        """
        patient_doc = self._repo.get_patient_bundle(patient_id)
        if not patient_doc:
            return None

        meta = patient_doc.get("meta", {})
        entries = patient_doc.get("bundle", {}).get("entry", [])

        # Extract FHIR sections
        demographics = self._extract_demographics(entries, meta)
        conditions = self._extract_conditions(entries)
        medications = self._extract_medications(entries)
        allergies = self._extract_allergies(entries)
        labs = self._extract_labs(entries)
        encounters = self._extract_encounters(entries)
        flags = self._extract_flags(meta)

        # Compute personalized thresholds based on clinical context
        thresholds = self._compute_thresholds(flags)

        # Compute vitals summary from synthetic_vitals
        vitals_summary, vitals_count = self._compute_vitals_summary(patient_id)

        # Generate longitudinal snapshots for trend analysis
        profile_type = meta.get("profile_type", "")
        longitudinal = self._generate_longitudinal_snapshots(
            patient_id, profile_type, flags, thresholds,
            len(conditions), len(medications),
        )

        now = datetime.now(timezone.utc).isoformat()

        doc: dict[str, Any] = {
            "patient_id": patient_id,
            "mrn": meta.get("mrn", ""),
            "source_hospital": meta.get("source_hospital", ""),
            "hospital_name": meta.get("hospital_name", ""),
            "profile_type": profile_type,
            "simulation_pattern": "deteriorating",
            "demographics": demographics,
            "conditions": conditions,
            "medications": medications,
            "allergies": allergies,
            "labs": labs,
            "flags": flags,
            "personalized_thresholds": thresholds,
            "vitals_summary": vitals_summary,
            "longitudinal_snapshots": longitudinal,
            "longitudinal_generated_at": now,
            "active_alerts": [],   # populated by CDS engine in Phase C
            "care_gaps": [],       # populated by HEDIS calculator in Phase C
            "interventions": {
                "ked_workflow": {
                    "status": "not_started",
                    "ordered_at": None,
                    "ordered_by": None,
                    "completed_at": None,
                    "completed_by": None,
                    "required_evidence": ["eGFR", "uACR"],
                    "missing_evidence": ["eGFR", "uACR"],
                    "latest_result_profile": None,
                    "latest_result_ids": [],
                    "follow_up_recommended": False,
                    "follow_up_reason": None,
                    "follow_up_summary": None,
                    "last_updated_at": None,
                },
                "cdc_hba_workflow": {
                    "status": "not_started",
                    "ordered_at": None,
                    "ordered_by": None,
                    "completed_at": None,
                    "completed_by": None,
                    "required_evidence": ["HbA1c"],
                    "missing_evidence": ["HbA1c"],
                    "latest_result_profile": None,
                    "latest_result_ids": [],
                    "follow_up_recommended": False,
                    "follow_up_reason": None,
                    "follow_up_summary": None,
                    "last_updated_at": None,
                },
            },
            "encounters": encounters,
            "created_at": now,
            "updated_at": now,
        }

        self._repo.upsert_patient_360(patient_id, doc)

        return MaterializeSingleResponse(
            patient_id=patient_id,
            status="materialized",
            vitals_readings_used=vitals_count,
        )

    def materialize_all(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> MaterializeAllResponse:
        """
        Batch-materialize Patient 360 documents for all patients
        (or a filtered subset).
        """
        patient_ids = self._repo.get_all_patient_ids(
            hospital=hospital, profile_type=profile_type,
        )
        total = len(patient_ids)
        materialized = 0
        errors: list[str] = []

        for pid in patient_ids:
            try:
                result = self.materialize_patient(pid)
                if result:
                    materialized += 1
                else:
                    errors.append(f"Patient {pid}: not found in synthetic_patients")
            except Exception as exc:
                msg = f"Patient {pid}: {exc}"
                logger.exception("Materialization failed — %s", msg)
                errors.append(msg)

        return MaterializeAllResponse(
            total_patients=total,
            materialized=materialized,
            errors=errors,
        )

    def get_patient_360(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Retrieve a materialized Patient 360 document."""
        return self._repo.get_patient_360(patient_id)

    def list_patient_360(
        self,
        skip: int = 0,
        limit: int = 50,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
        sort_by: str = "alert_severity",
    ) -> list[dict[str, Any]]:
        """Return paginated Patient 360 documents."""
        return self._repo.list_patient_360(
            skip=skip, limit=limit, hospital=hospital,
            profile_type=profile_type, sort_by=sort_by,
        )

    def get_status(self) -> dict[str, int]:
        """Return count of materialized patient_360 documents."""
        return {"patient_360_count": self._repo.count_patient_360()}

    # ------------------------------------------------------------------
    # FHIR extraction helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_demographics(entries: list[dict], meta: dict) -> dict[str, Any]:
        """Extract demographics from the Patient resource in the FHIR bundle."""
        patient_resource = next(
            (e["resource"] for e in entries
             if e.get("resource", {}).get("resourceType") == "Patient"),
            {},
        )
        name_parts = patient_resource.get("name", [{}])[0]
        given = name_parts.get("given", [""])[0]
        family = name_parts.get("family", "")
        dob = patient_resource.get("birthDate", "")
        gender = patient_resource.get("gender", "")

        age = 0
        if dob:
            try:
                birth = datetime.fromisoformat(dob)
                today = datetime.now(timezone.utc)
                age = today.year - birth.year - (
                    (today.month, today.day) < (birth.month, birth.day)
                )
            except (ValueError, TypeError):
                pass

        return {
            "name": f"{given} {family}".strip(),
            "given": given,
            "family": family,
            "gender": gender,
            "birth_date": dob,
            "age": age,
        }

    @staticmethod
    def _extract_conditions(entries: list[dict]) -> list[dict[str, Any]]:
        """Extract Condition resources into the flat 360 schema."""
        conditions = []
        for entry in entries:
            resource = entry.get("resource", {})
            if resource.get("resourceType") != "Condition":
                continue
            code_block = resource.get("code", {})
            coding = code_block.get("coding", [{}])[0]
            clinical_status = (
                resource.get("clinicalStatus", {})
                .get("coding", [{}])[0]
                .get("code", "active")
            )
            conditions.append({
                "code": coding.get("code", ""),
                "system": coding.get("system", "http://snomed.info/sct"),
                "icd10": "",  # ICD-10 is in the FHIR generator's meta, not in the resource coding
                "display": code_block.get("text", coding.get("display", "")),
                "clinical_status": clinical_status,
                "onset_date": resource.get("onsetDateTime", None),
            })
        return conditions

    @staticmethod
    def _extract_medications(entries: list[dict]) -> list[dict[str, Any]]:
        """Extract MedicationRequest resources into the flat 360 schema."""
        medications = []
        for entry in entries:
            resource = entry.get("resource", {})
            if resource.get("resourceType") != "MedicationRequest":
                continue

            med_concept = resource.get("medicationCodeableConcept", {})
            coding = med_concept.get("coding", [{}])[0]

            # Extract dosage info
            dosage = resource.get("dosageInstruction", [{}])[0] if resource.get("dosageInstruction") else {}
            dose_quantity = dosage.get("doseAndRate", [{}])[0].get("doseQuantity", {}) if dosage.get("doseAndRate") else {}
            route_coding = dosage.get("route", {}).get("coding", [{}])[0] if dosage.get("route") else {}
            timing_code = dosage.get("timing", {}).get("code", {}).get("text", "") if dosage.get("timing") else ""

            dose_str = ""
            if dose_quantity.get("value") is not None:
                dose_str = f"{dose_quantity['value']} {dose_quantity.get('unit', '')}".strip()

            medications.append({
                "code": coding.get("code", ""),
                "system": coding.get("system", "http://www.nlm.nih.gov/research/umls/rxnorm"),
                "display": med_concept.get("text", coding.get("display", "")),
                "dose": dose_str,
                "route": route_coding.get("display", ""),
                "frequency": timing_code,
                "status": resource.get("status", "active"),
            })
        return medications

    @staticmethod
    def _extract_allergies(entries: list[dict]) -> list[dict[str, Any]]:
        """Extract AllergyIntolerance resources into the flat 360 schema."""
        allergies = []
        for entry in entries:
            resource = entry.get("resource", {})
            if resource.get("resourceType") != "AllergyIntolerance":
                continue
            code_block = resource.get("code", {})
            coding = code_block.get("coding", [{}])[0]

            reaction_list = resource.get("reaction", [])
            reaction_text = ""
            severity = ""
            if reaction_list:
                reaction_text = reaction_list[0].get("manifestation", [{}])[0].get("text",
                    reaction_list[0].get("manifestation", [{}])[0].get("coding", [{}])[0].get("display", "")
                )
                severity = reaction_list[0].get("severity", "")

            allergies.append({
                "code": coding.get("code", ""),
                "display": code_block.get("text", coding.get("display", "")),
                "reaction": reaction_text,
                "severity": severity,
                "criticality": resource.get("criticality", ""),
            })
        return allergies

    @staticmethod
    def _extract_labs(entries: list[dict]) -> list[dict[str, Any]]:
        """Extract Observation (lab) resources into the flat 360 schema."""
        labs = []
        for entry in entries:
            resource = entry.get("resource", {})
            if resource.get("resourceType") != "Observation":
                continue
            # Skip vitals-category observations (if any)
            categories = resource.get("category", [])
            is_lab = any(
                cat_coding.get("code") == "laboratory"
                for cat in categories
                for cat_coding in cat.get("coding", [])
            )
            if not is_lab:
                continue

            code_block = resource.get("code", {})
            coding = code_block.get("coding", [{}])[0]
            value_quantity = resource.get("valueQuantity", {})

            # Reference range
            ref_range = resource.get("referenceRange", [{}])[0] if resource.get("referenceRange") else {}
            ref_low = ref_range.get("low", {}).get("value")
            ref_high = ref_range.get("high", {}).get("value")

            # Interpretation
            interp_coding = resource.get("interpretation", [{}])[0].get("coding", [{}])[0] if resource.get("interpretation") else {}

            labs.append({
                "loinc": coding.get("code", ""),
                "display": code_block.get("text", coding.get("display", "")),
                "value": value_quantity.get("value", 0),
                "unit": value_quantity.get("unit", ""),
                "ref_low": ref_low,
                "ref_high": ref_high,
                "interpretation": interp_coding.get("code", ""),
                "effective_date": resource.get("effectiveDateTime", None),
            })
        return labs

    @staticmethod
    def _extract_encounters(entries: list[dict]) -> list[dict[str, Any]]:
        """Extract Encounter resources into the flat 360 schema."""
        encounters = []
        for entry in entries:
            resource = entry.get("resource", {})
            if resource.get("resourceType") != "Encounter":
                continue
            period = resource.get("period", {})
            enc_class = resource.get("class", {})

            provider = ""
            if resource.get("serviceProvider", {}).get("display"):
                provider = resource["serviceProvider"]["display"]

            encounters.append({
                "status": resource.get("status", ""),
                "class": enc_class.get("code", "") if isinstance(enc_class, dict) else str(enc_class),
                "period_start": period.get("start"),
                "period_end": period.get("end"),
                "provider": provider,
            })
        return encounters

    @staticmethod
    def _extract_flags(meta: dict) -> dict[str, Any]:
        """Extract clinical flags from the patient meta sub-document."""
        condition_codes = meta.get("condition_codes", [])
        return {
            "has_beta_blocker": meta.get("has_beta_blocker", False),
            "has_insulin": meta.get("has_insulin", False),
            "has_ace_inhibitor": meta.get("has_ace_inhibitor", False),
            "has_ckd": _CKD_CODE in condition_codes,
            "condition_codes": condition_codes,
        }

    # ------------------------------------------------------------------
    # Personalized thresholds
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_thresholds(flags: dict[str, Any]) -> dict[str, Any]:
        """
        Compute personalized vital-sign alert thresholds based on the
        patient's clinical context (conditions + medications).

        Rules implemented:
        - Beta-blocker → HR high threshold lowered from 100 to 90
        - CKD → SpO2 low threshold lowered from 92 to 90 (chronic baseline is lower)
        - CKD → RR high threshold raised from 20 to 22 (compensatory breathing)
        """
        hr_high = 100
        hr_source = None
        if flags.get("has_beta_blocker"):
            hr_high = 90
            hr_source = "cds_beta_blocker_hr"

        spo2_low = 92
        spo2_source = None
        rr_high = 20
        rr_source = None
        if flags.get("has_ckd"):
            spo2_low = 90
            spo2_source = "cds_ckd_spo2"
            rr_high = 22
            rr_source = "cds_ckd_respiratory"

        return {
            "heart_rate": {"low": 50, "high": hr_high, "source_rule": hr_source},
            "respiratory_rate": {"low": 10, "high": rr_high, "source_rule": rr_source},
            "temperature": {"low": 36.0, "high": 38.0, "source_rule": None},
            "spo2": {"low": spo2_low, "high": 100, "source_rule": spo2_source},
            "activity_level": {"low": None, "high": None, "source_rule": None},
        }

    # ------------------------------------------------------------------
    # Vitals summary computation
    # ------------------------------------------------------------------

    def _compute_vitals_summary(self, patient_id: str) -> tuple[dict[str, Any], int]:
        """
        Compute the vitals_summary sub-document:
          - latest: most recent reading
          - avg_4h: average of readings in the last 4 hours
          - trend_24h: direction (stable / increasing / decreasing) over 24h

        Returns (vitals_summary_dict, total_readings_count).
        """
        total_count = self._repo.count_vitals(patient_id)

        empty_summary: dict[str, Any] = {
            "latest": {},
            "avg_4h": {},
            "trend_24h": {v: "stable" for v in _VITAL_FIELDS},
            "refreshed_at": None,
        }

        if total_count == 0:
            return empty_summary, 0

        # Get the latest reading to anchor our time windows
        latest_docs = self._repo.get_vitals_latest(patient_id, limit=1)
        if not latest_docs:
            return empty_summary, 0

        latest = latest_docs[0]
        latest_ts = latest.get("timestamp")

        # Build the "latest" snapshot
        latest_snapshot = {
            "timestamp": latest_ts.isoformat() if isinstance(latest_ts, datetime) else str(latest_ts),
        }
        for field in _VITAL_FIELDS:
            latest_snapshot[field] = latest.get(field)

        if not isinstance(latest_ts, datetime):
            return {
                "latest": latest_snapshot,
                "avg_4h": {},
                "trend_24h": {v: "stable" for v in _VITAL_FIELDS},
                "refreshed_at": None,
            }, total_count

        # 4-hour average — pass datetime objects directly for BSON comparison
        start_4h = latest_ts - timedelta(hours=4)
        readings_4h = self._repo.get_vitals_window(patient_id, start_4h, latest_ts)
        avg_4h = self._compute_average(readings_4h)

        # 24-hour trend
        start_24h = latest_ts - timedelta(hours=24)
        readings_24h = self._repo.get_vitals_window(patient_id, start_24h, latest_ts)
        trend_24h = self._compute_trend(readings_24h)

        return {
            "latest": latest_snapshot,
            "avg_4h": avg_4h,
            "trend_24h": trend_24h,
            "refreshed_at": datetime.now(timezone.utc).isoformat(),
        }, total_count

    @staticmethod
    def _compute_average(readings: list[dict[str, Any]]) -> dict[str, Any]:
        """Compute mean values across a list of vitals readings."""
        if not readings:
            return {}

        sums: dict[str, float] = {f: 0.0 for f in _VITAL_FIELDS}
        counts: dict[str, int] = {f: 0 for f in _VITAL_FIELDS}

        for r in readings:
            for field in _VITAL_FIELDS:
                val = r.get(field)
                if val is not None:
                    sums[field] += val
                    counts[field] += 1

        return {
            field: round(sums[field] / counts[field], 2) if counts[field] > 0 else None
            for field in _VITAL_FIELDS
        }

    @staticmethod
    def _compute_trend(readings: list[dict[str, Any]]) -> dict[str, str]:
        """
        Determine trend direction for each vital over a 24-hour window.

        Strategy: Compare the average of the first quarter of readings to the
        average of the last quarter. If the difference exceeds a threshold
        relative to the overall mean, mark as increasing/decreasing; else stable.
        """
        if len(readings) < 4:
            return {field: "stable" for field in _VITAL_FIELDS}

        quarter = max(1, len(readings) // 4)
        first_quarter = readings[:quarter]
        last_quarter = readings[-quarter:]

        # Relative thresholds: the % change that counts as a trend
        thresholds = {
            "heart_rate": 0.05,        # 5%
            "respiratory_rate": 0.08,  # 8%
            "temperature": 0.005,      # 0.5% (~0.18°C on 37°C baseline)
            "spo2": 0.015,             # 1.5%
            "activity_level": 0.15,    # 15%
        }

        trends: dict[str, str] = {}
        for field in _VITAL_FIELDS:
            first_vals = [r[field] for r in first_quarter if r.get(field) is not None]
            last_vals = [r[field] for r in last_quarter if r.get(field) is not None]

            if not first_vals or not last_vals:
                trends[field] = "stable"
                continue

            first_avg = sum(first_vals) / len(first_vals)
            last_avg = sum(last_vals) / len(last_vals)
            overall_avg = (first_avg + last_avg) / 2

            if overall_avg == 0:
                trends[field] = "stable"
                continue

            change_ratio = (last_avg - first_avg) / abs(overall_avg)
            threshold = thresholds.get(field, 0.05)

            if change_ratio > threshold:
                trends[field] = "increasing"
            elif change_ratio < -threshold:
                trends[field] = "decreasing"
            else:
                trends[field] = "stable"

        return trends

    # ------------------------------------------------------------------
    # Longitudinal snapshot generation
    # ------------------------------------------------------------------

    @staticmethod
    def _generate_longitudinal_snapshots(
        patient_id: str,
        profile_type: str,
        flags: dict[str, Any],
        thresholds: dict[str, Any],
        condition_count: int,
        medication_count: int,
    ) -> list[dict[str, Any]]:
        """
        Produce synthetic period summaries that simulate months of clinical
        history.  Each profile_type follows a distinct clinical narrative:

        - healthy / normal:  stable vitals, low risk, few alerts
        - target / deteriorating: gradual worsening over 6 months
        - diabetic: moderate with episodic instability
        - cardiac: elevated HR baseline with slow progression
        """
        rng = random.Random(
            int(hashlib.sha256(patient_id.encode()).hexdigest()[:8], 16)
        )

        now = datetime.now(timezone.utc)
        periods = [
            ("6_months", "6 Months Ago",  now - timedelta(days=180)),
            ("3_months", "3 Months Ago",  now - timedelta(days=90)),
            ("1_month",  "1 Month Ago",   now - timedelta(days=30)),
            ("1_week",   "1 Week Ago",    now - timedelta(days=7)),
            ("current",  "Current",       now),
        ]

        has_bb = flags.get("has_beta_blocker", False)
        has_ckd = flags.get("has_ckd", False)

        hr_base = 68 if not has_bb else 62
        spo2_base = 97.0 if not has_ckd else 94.0
        rr_base = 15.0
        temp_base = 36.7

        profile = profile_type.lower()

        # Per-period drift multipliers (index 0..4 = oldest..current)
        if profile in ("target", "deteriorating"):
            hr_drifts   = [0.0, 0.04, 0.09, 0.15, 0.22]
            spo2_drifts = [0.0, -0.005, -0.012, -0.022, -0.035]
            rr_drifts   = [0.0, 0.03, 0.07, 0.12, 0.18]
            temp_drifts = [0.0, 0.002, 0.005, 0.01, 0.016]
            risk_curve  = [12, 22, 38, 55, 72]
            alert_scale = [0.2, 0.5, 1.0, 2.0, 3.5]
        elif profile == "acute":
            hr_drifts   = [0.0, 0.01, 0.02, 0.18, 0.30]
            spo2_drifts = [0.0, -0.002, -0.004, -0.03, -0.05]
            rr_drifts   = [0.0, 0.01, 0.02, 0.15, 0.25]
            temp_drifts = [0.0, 0.001, 0.002, 0.015, 0.025]
            risk_curve  = [10, 14, 18, 58, 80]
            alert_scale = [0.1, 0.2, 0.3, 2.5, 5.0]
        elif profile == "diabetic":
            hr_drifts   = [0.0, 0.02, 0.05, 0.04, 0.08]
            spo2_drifts = [0.0, -0.003, -0.008, -0.006, -0.015]
            rr_drifts   = [0.0, 0.02, 0.04, 0.03, 0.06]
            temp_drifts = [0.0, 0.001, 0.003, 0.002, 0.005]
            risk_curve  = [18, 25, 35, 30, 42]
            alert_scale = [0.3, 0.6, 1.2, 0.9, 1.8]
        elif profile == "cardiac":
            hr_drifts   = [0.0, 0.03, 0.06, 0.10, 0.14]
            spo2_drifts = [0.0, -0.002, -0.005, -0.010, -0.018]
            rr_drifts   = [0.0, 0.02, 0.04, 0.07, 0.10]
            temp_drifts = [0.0, 0.001, 0.002, 0.004, 0.006]
            risk_curve  = [20, 28, 38, 48, 58]
            alert_scale = [0.3, 0.5, 1.0, 1.5, 2.5]
        else:  # healthy / normal
            hr_drifts   = [0.0, -0.01, -0.005, 0.005, 0.0]
            spo2_drifts = [0.0, 0.002, 0.003, 0.002, 0.001]
            rr_drifts   = [0.0, -0.005, -0.003, 0.0, 0.005]
            temp_drifts = [0.0, 0.0, 0.0, 0.0, 0.0]
            risk_curve  = [8, 6, 5, 4, 5]
            alert_scale = [0.1, 0.05, 0.0, 0.0, 0.1]

        snapshots: list[dict[str, Any]] = []

        for i, (period_key, label, ref_date) in enumerate(periods):
            noise = lambda: rng.gauss(0, 0.01)  # noqa: E731

            hr_avg  = round(hr_base * (1 + hr_drifts[i] + noise()), 1)
            spo2_avg = round(spo2_base * (1 + spo2_drifts[i] + noise()), 1)
            spo2_avg = min(spo2_avg, 100.0)
            rr_avg  = round(rr_base * (1 + rr_drifts[i] + noise()), 1)
            temp_avg = round(temp_base * (1 + temp_drifts[i] + noise()), 2)

            hr_std   = round(rng.uniform(2.5, 6.0), 1)
            spo2_std = round(rng.uniform(0.5, 2.0), 1)
            rr_std   = round(rng.uniform(1.0, 3.0), 1)
            temp_std = round(rng.uniform(0.15, 0.4), 2)

            scale = alert_scale[i]
            critical = max(0, round(scale * rng.uniform(0, 0.4)))
            high     = max(0, round(scale * rng.uniform(0.5, 1.5)))
            moderate = max(0, round(scale * rng.uniform(1.0, 3.0)))
            low      = max(0, round(scale * rng.uniform(1.5, 4.0)))

            risk = min(100, max(0, risk_curve[i] + rng.randint(-3, 3)))

            if i == 0:
                trend = "stable"
            else:
                prev_risk = risk_curve[i - 1]
                cur_risk = risk_curve[i]
                if cur_risk > prev_risk + 5:
                    trend = "worsening"
                elif cur_risk < prev_risk - 5:
                    trend = "improving"
                else:
                    trend = "stable"

            cond_active = condition_count
            med_active = medication_count
            if profile in ("target", "deteriorating", "acute") and i < 2:
                cond_active = max(0, condition_count - rng.randint(0, 1))
                med_active = max(0, medication_count - rng.randint(0, 1))

            notes_map = {
                "healthy": [
                    "Stable baseline, no concerns",
                    "Routine follow-up, within normal limits",
                    "Annual physical — all vitals normal",
                    "Maintaining healthy lifestyle",
                    "Continue current wellness plan",
                ],
                "target": [
                    "Baseline assessment, early signs of concern",
                    "Mild upward trend in HR, monitoring initiated",
                    "SpO2 trending down, additional labs ordered",
                    "Escalating alert frequency, treatment adjusted",
                    "Significant deterioration, care plan under review",
                ],
                "acute": [
                    "Stable on admission workup",
                    "Routine monitoring, no acute changes",
                    "Subtle vital changes noted",
                    "Acute decompensation, rapid response activated",
                    "Critical care intervention, close monitoring",
                ],
                "diabetic": [
                    "Diabetes well-controlled, A1c on target",
                    "Mild glycemic variability noted",
                    "Increased episodes of hyperglycemia",
                    "Temporary improvement after regimen change",
                    "Persistent metabolic instability, endocrine consult",
                ],
                "cardiac": [
                    "Cardiac function stable, EF within range",
                    "Mild tachycardia episodes noted",
                    "Increasing frequency of rhythm irregularities",
                    "Rate control medications adjusted",
                    "Progressive cardiac decompensation observed",
                ],
            }
            note_list = notes_map.get(profile, notes_map["healthy"])

            snapshots.append({
                "period_key": period_key,
                "label": label,
                "reference_date": ref_date.isoformat(),
                "vitals_summary": {
                    "heart_rate": {
                        "avg": hr_avg,
                        "min": round(hr_avg - hr_std * 2.5, 1),
                        "max": round(hr_avg + hr_std * 2.5, 1),
                        "std": hr_std,
                    },
                    "spo2": {
                        "avg": spo2_avg,
                        "min": round(max(80, spo2_avg - spo2_std * 2.5), 1),
                        "max": round(min(100, spo2_avg + spo2_std * 2.5), 1),
                        "std": spo2_std,
                    },
                    "respiratory_rate": {
                        "avg": rr_avg,
                        "min": round(max(8, rr_avg - rr_std * 2.0), 1),
                        "max": round(rr_avg + rr_std * 2.0, 1),
                        "std": rr_std,
                    },
                    "temperature": {
                        "avg": temp_avg,
                        "min": round(temp_avg - temp_std * 2.0, 2),
                        "max": round(temp_avg + temp_std * 2.0, 2),
                        "std": temp_std,
                    },
                },
                "risk_score": risk,
                "alert_frequency": {
                    "critical": critical,
                    "high": high,
                    "moderate": moderate,
                    "low": low,
                },
                "trend_vs_previous": trend,
                "conditions_active": cond_active,
                "medications_active": med_active,
                "notes": note_list[i] if i < len(note_list) else "",
            })

        return snapshots
