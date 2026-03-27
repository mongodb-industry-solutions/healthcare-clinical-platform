"""
CDS & HEDIS Engine service.

Three sub-modules in a single service class:

1. **Rules Seeder** — inserts the 5 CDS rule documents into cds_rules.
2. **Personalized Threshold Calculator** — reads Patient 360 flags/conditions/meds
   and writes custom vital-sign alert boundaries.
3. **Real-Time Evaluator** — evaluates the latest vitals against personalized
   thresholds and CDS rules, generates alerts, and copies active alerts into
   the Patient 360 active_alerts array.
4. **HEDIS Care Gap Calculator** — evaluates patient histories against the 5
   HEDIS measures, prioritizes based on vitals trends, and writes to care_gaps
   in Patient 360.

All business logic lives here — no HTTP, no direct MongoDB queries.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from cds.hedis_measures import HEDIS_MEASURES
from cds.models import (
    ComputeCareGapsResponse,
    EvaluateAllResponse,
    EvaluatePatientResponse,
    SeedRulesResponse,
)
from cds.repository import CDSRepository
from cds.rules_seed import CDS_RULES

logger = logging.getLogger(__name__)

# SNOMED codes
_T2DM_CODE = "44054006"
_CKD_CODE = "433144002"
_HTN_CODE = "59621000"
_NEUROPATHY_CODE = "230572002"

# Vitals field names
_VITAL_FIELDS = ["heart_rate", "respiratory_rate", "temperature", "spo2", "activity_level"]


class CDSService:
    def __init__(self, repo: CDSRepository):
        self._repo = repo

    # ==================================================================
    # 1. Rules Seeder
    # ==================================================================

    def seed_rules(self) -> SeedRulesResponse:
        """Insert (or update) the 5 CDS rules into the cds_rules collection."""
        inserted_ids: list[str] = []
        for rule in CDS_RULES:
            self._repo.upsert_rule(rule["rule_id"], rule)
            inserted_ids.append(rule["rule_id"])
        return SeedRulesResponse(inserted=len(inserted_ids), rules=inserted_ids)

    def list_rules(self) -> list[dict[str, Any]]:
        """Return all CDS rules."""
        return self._repo.get_all_rules(enabled_only=False)

    # ==================================================================
    # 2. Personalized Threshold Calculator
    # ==================================================================

    def compute_thresholds(self, patient_id: str) -> Optional[dict[str, Any]]:
        """
        Compute personalized thresholds for a patient based on their
        clinical context (flags, conditions, medications) and write
        them to the Patient 360 document.

        Returns the computed thresholds dict, or None if patient not found.
        """
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        flags = p360.get("flags", {})
        conditions = p360.get("conditions", [])
        demographics = p360.get("demographics", {})
        age = demographics.get("age", 0)
        condition_codes = flags.get("condition_codes", [])

        thresholds = self._build_thresholds(flags, condition_codes, age)
        self._repo.update_patient_360_thresholds(patient_id, thresholds)
        return thresholds

    @staticmethod
    def _build_thresholds(
        flags: dict[str, Any],
        condition_codes: list[str],
        age: int,
    ) -> dict[str, Any]:
        """
        Build personalized thresholds from clinical context.

        Rules:
        - Beta-blocker → HR high 100 → 90
        - CKD → SpO2 low 92 → 90
        - CKD → RR high 20 → 22
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
            "heart_rate":       {"low": 50,   "high": hr_high,  "source_rule": hr_source},
            "respiratory_rate": {"low": 10,   "high": rr_high,  "source_rule": rr_source},
            "temperature":      {"low": 36.0, "high": 38.0,     "source_rule": None},
            "spo2":             {"low": spo2_low, "high": 100,  "source_rule": spo2_source},
            "activity_level":   {"low": None, "high": None,     "source_rule": None},
        }

    # ==================================================================
    # 3. Real-Time CDS Evaluator
    # ==================================================================

    def evaluate_patient(self, patient_id: str) -> Optional[EvaluatePatientResponse]:
        """
        Evaluate the latest vitals for a patient against all enabled CDS rules.
        Generates alerts and updates the Patient 360 active_alerts array.

        Returns None if patient_360 not found.
        """
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        rules = self._repo.get_all_rules(enabled_only=True)

        # Get recent vitals for evaluation context
        latest_vitals = self._repo.get_vitals_latest(patient_id, limit=1)
        if not latest_vitals:
            return EvaluatePatientResponse(
                patient_id=patient_id, alerts_generated=0, alerts=[],
            )
        current = latest_vitals[0]

        # Get 2-hour baseline for spike detection
        latest_ts = current.get("timestamp")
        baseline_hr = None
        if isinstance(latest_ts, datetime):
            start_2h = latest_ts - timedelta(hours=2)
            window = self._repo.get_vitals_window(patient_id, start_2h, latest_ts)
            if window:
                hr_vals = [r["heart_rate"] for r in window if r.get("heart_rate") is not None]
                if hr_vals:
                    baseline_hr = sum(hr_vals) / len(hr_vals)

        # Get 4-hour window for trend / sustained checks
        readings_4h: list[dict[str, Any]] = []
        if isinstance(latest_ts, datetime):
            start_4h = latest_ts - timedelta(hours=4)
            readings_4h = self._repo.get_vitals_window(patient_id, start_4h, latest_ts)

        # Clear existing alerts before re-evaluation
        self._repo.clear_alerts_for_patient(patient_id)

        generated_alerts: list[dict[str, Any]] = []

        for rule in rules:
            if not self._rule_applies(rule, p360):
                continue

            alert = self._evaluate_rule(rule, p360, current, baseline_hr, readings_4h)
            if alert:
                self._repo.insert_alert(alert)
                generated_alerts.append(alert)

        # Update Patient 360 active_alerts with summary
        active_summary = [
            {
                "alert_id": a["alert_id"],
                "rule_id": a["rule_id"],
                "title": a["title"],
                "severity": a["severity"],
                "reasoning": a["reasoning"],
                "suggested_actions": a["suggested_actions"],
                "created_at": a["created_at"],
            }
            for a in generated_alerts
        ]
        self._repo.update_patient_360_active_alerts(patient_id, active_summary)

        return EvaluatePatientResponse(
            patient_id=patient_id,
            alerts_generated=len(generated_alerts),
            alerts=generated_alerts,
        )

    def evaluate_all(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> EvaluateAllResponse:
        """Batch-evaluate CDS rules for all materialized patients."""
        patient_ids = self._repo.get_all_patient_360_ids(
            hospital=hospital, profile_type=profile_type,
        )
        total = len(patient_ids)
        evaluated = 0
        total_alerts = 0
        errors: list[str] = []

        for pid in patient_ids:
            try:
                result = self.evaluate_patient(pid)
                if result:
                    evaluated += 1
                    total_alerts += result.alerts_generated
                else:
                    errors.append(f"Patient {pid}: not found in patient_360")
            except Exception as exc:
                msg = f"Patient {pid}: {exc}"
                logger.exception("CDS evaluation failed — %s", msg)
                errors.append(msg)

        return EvaluateAllResponse(
            total_patients=total,
            evaluated=evaluated,
            total_alerts=total_alerts,
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Rule applicability check
    # ------------------------------------------------------------------

    @staticmethod
    def _rule_applies(rule: dict[str, Any], p360: dict[str, Any]) -> bool:
        """Check whether a CDS rule is applicable to this patient."""
        applicability = rule.get("applicability", {})
        flags = p360.get("flags", {})
        demographics = p360.get("demographics", {})
        condition_codes = flags.get("condition_codes", [])
        age = demographics.get("age", 0)

        # Check required conditions (all must be present)
        required_conditions = applicability.get("conditions", [])
        if required_conditions:
            if not all(c in condition_codes for c in required_conditions):
                return False

        # Check required flags (all must be True)
        required_flags = applicability.get("flags", [])
        if required_flags:
            if not all(flags.get(f, False) for f in required_flags):
                return False

        # Age bounds
        min_age = applicability.get("min_age")
        if min_age is not None and age < min_age:
            return False
        max_age = applicability.get("max_age")
        if max_age is not None and age > max_age:
            return False

        # Profile type restriction
        profile_types = applicability.get("profile_types")
        if profile_types:
            if p360.get("profile_type", "") not in profile_types:
                return False

        return True

    # ------------------------------------------------------------------
    # Individual rule evaluation
    # ------------------------------------------------------------------

    def _evaluate_rule(
        self,
        rule: dict[str, Any],
        p360: dict[str, Any],
        current_vitals: dict[str, Any],
        baseline_hr: Optional[float],
        readings_4h: list[dict[str, Any]],
    ) -> Optional[dict[str, Any]]:
        """
        Evaluate a single CDS rule against a patient's current vitals.
        Returns an alert dict if the rule fires, None otherwise.
        """
        trigger = rule.get("trigger", {})
        operator = trigger.get("operator", "")

        if operator in (">", "<", ">=", "<="):
            return self._eval_threshold(rule, p360, current_vitals, readings_4h)
        elif operator == "spike_pct":
            return self._eval_spike(rule, p360, current_vitals, baseline_hr)
        elif operator == "sirs_composite":
            return self._eval_sirs(rule, p360, current_vitals)
        return None

    def _eval_threshold(
        self,
        rule: dict[str, Any],
        p360: dict[str, Any],
        current: dict[str, Any],
        readings_4h: list[dict[str, Any]],
    ) -> Optional[dict[str, Any]]:
        """Evaluate a simple threshold breach rule (>, <)."""
        trigger = rule["trigger"]
        vital_name = trigger.get("vital")
        if not vital_name:
            return None

        value = current.get(vital_name)
        if value is None:
            return None

        # Determine the effective threshold
        threshold = trigger.get("threshold", 0)
        if trigger.get("use_personalized_threshold"):
            pt = p360.get("personalized_thresholds", {}).get(vital_name, {})
            operator = trigger.get("operator", ">")
            if operator in (">", ">="):
                threshold = pt.get("high", threshold) or threshold
            else:
                threshold = pt.get("low", threshold) or threshold

        # Check breach
        operator = trigger.get("operator", ">")
        breached = False
        if operator == ">" and value > threshold:
            breached = True
        elif operator == ">=" and value >= threshold:
            breached = True
        elif operator == "<" and value < threshold:
            breached = True
        elif operator == "<=" and value <= threshold:
            breached = True

        if not breached:
            return None

        # Check sustained_minutes — if breach is sustained, escalate;
        # but always fire the alert when the latest reading breaches.
        is_sustained = False
        sustained = trigger.get("sustained_minutes", 0)
        if sustained and sustained > 0 and readings_4h:
            is_sustained = self._is_sustained(
                readings_4h, vital_name, operator, threshold, sustained,
            )

        return self._build_alert(
            rule, p360, current, value=value,
            extra_context={"sustained": is_sustained},
        )

    def _eval_spike(
        self,
        rule: dict[str, Any],
        p360: dict[str, Any],
        current: dict[str, Any],
        baseline_hr: Optional[float],
    ) -> Optional[dict[str, Any]]:
        """
        Evaluate a spike-percentage rule (e.g., HR spike >20% from baseline).
        Also checks secondary factors: activity decrease and SpO2 ≥ 95%.
        """
        trigger = rule["trigger"]
        vital_name = trigger.get("vital", "heart_rate")
        spike_pct = trigger.get("threshold", 20)

        current_val = current.get(vital_name)
        if current_val is None or baseline_hr is None or baseline_hr == 0:
            return None

        pct_change = ((current_val - baseline_hr) / baseline_hr) * 100
        if pct_change <= spike_pct:
            return None

        # Secondary checks for hypoglycemia pattern:
        # - Activity should be low (sudden decrease)
        # - SpO2 should be relatively preserved — for CKD patients whose
        #   baseline is ~93-95%, use a lower cutoff of 90% instead of 95%.
        activity = current.get("activity_level")
        spo2 = current.get("spo2")
        if activity is not None and activity > 3.0:
            return None  # Patient is active — not a hypo pattern
        flags = p360.get("flags", {})
        spo2_floor = 90.0 if flags.get("has_ckd") else 95.0
        if spo2 is not None and spo2 < spo2_floor:
            return None  # Low SpO2 points to respiratory, not hypo

        spo2_floor_note = " (adjusted for CKD baseline)" if flags.get("has_ckd") else ""
        return self._build_alert(
            rule, p360, current,
            value=current_val,
            extra_context={
                "baseline_hr": round(baseline_hr, 1),
                "spike_pct": round(pct_change, 1),
                "spo2_floor": int(spo2_floor),
                "spo2_floor_note": spo2_floor_note,
            },
        )

    def _eval_sirs(
        self,
        rule: dict[str, Any],
        p360: dict[str, Any],
        current: dict[str, Any],
    ) -> Optional[dict[str, Any]]:
        """
        Evaluate modified SIRS criteria for sepsis warning.

        Modified SIRS criteria (wearable-adapted):
        1. Temperature > 38.0°C or < 36.0°C
        2. Heart rate > 90 bpm
        3. Respiratory rate > 20 breaths/min
        4. SpO2 < 95%

        Need ≥ 3 criteria met. Risk amplifiers increase severity.
        """
        trigger = rule["trigger"]
        required_count = int(trigger.get("threshold", 3))

        criteria_met: list[str] = []

        temp = current.get("temperature")
        if temp is not None and (temp > 38.0 or temp < 36.0):
            criteria_met.append(f"Temperature {temp:.1f}°C (abnormal)")

        # Use personalized HR threshold for beta-blocker patients
        hr = current.get("heart_rate")
        hr_threshold = 90
        hr_pt = p360.get("personalized_thresholds", {}).get("heart_rate", {})
        if hr_pt.get("high"):
            hr_threshold = hr_pt["high"]
        if hr is not None and hr > hr_threshold:
            criteria_met.append(f"Heart rate {hr:.0f} bpm (>{hr_threshold})")

        rr = current.get("respiratory_rate")
        if rr is not None and rr > 20:
            criteria_met.append(f"Respiratory rate {rr:.0f} breaths/min (>20)")

        spo2 = current.get("spo2")
        if spo2 is not None and spo2 < 95:
            criteria_met.append(f"SpO2 {spo2:.1f}% (<95%)")

        if len(criteria_met) < required_count:
            return None

        # Risk amplifiers
        flags = p360.get("flags", {})
        condition_codes = flags.get("condition_codes", [])
        amplifiers: list[str] = []
        if _NEUROPATHY_CODE in condition_codes:
            amplifiers.append("Peripheral neuropathy (masked symptoms)")
        if _CKD_CODE in condition_codes:
            amplifiers.append("CKD Stage 3 (impaired clearance)")
        encounters = p360.get("encounters", [])
        if any(e.get("class") in ("inpatient", "IMP") for e in encounters):
            amplifiers.append("Recent hospitalization")

        return self._build_alert(
            rule, p360, current,
            extra_context={
                "sirs_count": len(criteria_met),
                "sirs_details": "; ".join(criteria_met),
                "risk_amplifiers": ", ".join(amplifiers) if amplifiers else "None",
            },
        )

    @staticmethod
    def _is_sustained(
        readings: list[dict[str, Any]],
        vital: str,
        operator: str,
        threshold: float,
        minutes: int,
    ) -> bool:
        """
        Check whether a threshold breach has been sustained for at least
        `minutes` minutes within the recent readings window.
        """
        if not readings:
            return False

        breach_start: Optional[datetime] = None
        for r in readings:
            val = r.get(vital)
            ts = r.get("timestamp")
            if val is None or ts is None:
                breach_start = None
                continue

            in_breach = False
            if operator in (">", ">=") and val > threshold:
                in_breach = True
            elif operator in ("<", "<=") and val < threshold:
                in_breach = True

            if in_breach:
                if breach_start is None:
                    breach_start = ts if isinstance(ts, datetime) else None
                else:
                    if isinstance(ts, datetime) and isinstance(breach_start, datetime):
                        elapsed = (ts - breach_start).total_seconds() / 60
                        if elapsed >= minutes:
                            return True
            else:
                breach_start = None

        return False

    # ------------------------------------------------------------------
    # Alert builder
    # ------------------------------------------------------------------

    def _build_alert(
        self,
        rule: dict[str, Any],
        p360: dict[str, Any],
        current_vitals: dict[str, Any],
        value: Optional[float] = None,
        extra_context: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Build an alert document from a rule template + patient context."""
        template = rule.get("alert_template", {})
        now = datetime.now(timezone.utc).isoformat()
        patient_id = p360.get("patient_id", "")

        # Build reasoning string with template substitution
        reasoning = template.get("reasoning", "")
        substitutions: dict[str, Any] = {
            "value": round(value, 1) if value is not None else "N/A",
            "threshold": rule.get("trigger", {}).get("threshold", ""),
            "sustained_minutes": rule.get("trigger", {}).get("sustained_minutes", ""),
        }

        # Find medication name if referenced
        medications = p360.get("medications", [])
        beta_blockers = [m["display"] for m in medications
                         if "atenolol" in m.get("display", "").lower()
                         or "metoprolol" in m.get("display", "").lower()
                         or "propranolol" in m.get("display", "").lower()]
        substitutions["medication_name"] = beta_blockers[0] if beta_blockers else "beta-blocker"

        # Find eGFR if referenced
        labs = p360.get("labs", [])
        egfr_vals = [lb["value"] for lb in labs if lb.get("loinc") == "62238-1"]
        substitutions["egfr_value"] = egfr_vals[0] if egfr_vals else "N/A"

        if extra_context:
            substitutions.update(extra_context)

        # Determine severity — for comparative rule, escalate for high-risk patients
        severity = template.get("severity", "moderate")
        if rule.get("rule_id") == "cds_comparative_context":
            severity = self._comparative_severity(p360)
            substitutions["context_explanation"] = self._comparative_explanation(p360, severity)

        # Safe template substitution
        try:
            reasoning = reasoning.format(**substitutions)
        except (KeyError, IndexError):
            pass  # leave template placeholders as-is

        # Contributing vitals snapshot
        ts = current_vitals.get("timestamp")
        contributing = {
            "timestamp": ts.isoformat() if isinstance(ts, datetime) else str(ts) if ts else None,
            "heart_rate": current_vitals.get("heart_rate"),
            "respiratory_rate": current_vitals.get("respiratory_rate"),
            "temperature": current_vitals.get("temperature"),
            "spo2": current_vitals.get("spo2"),
            "activity_level": current_vitals.get("activity_level"),
        }

        # FHIR RiskAssessment stub
        fhir_resource = {
            "resourceType": "RiskAssessment",
            "status": "final",
            "subject": {"reference": f"Patient/{patient_id}"},
            "prediction": [
                {
                    "outcome": {"text": template.get("title", "")},
                    "qualitativeRisk": {"text": severity},
                }
            ],
        }

        return {
            "alert_id": str(uuid.uuid4()),
            "patient_id": patient_id,
            "rule_id": rule.get("rule_id", ""),
            "alert_type": template.get("alert_type", "threshold_breach"),
            "severity": severity,
            "title": template.get("title", ""),
            "reasoning": reasoning,
            "suggested_actions": template.get("suggested_actions", []),
            "contributing_vitals": contributing,
            "status": "new",
            "created_at": now,
            "acknowledged_at": None,
            "acknowledged_by": None,
            "resolved_at": None,
            "hedis_measure": template.get("hedis_measure"),
            "measure_name": None,
            "last_completed": None,
            "due_by": None,
            "days_overdue": None,
            "fhir_resource": fhir_resource,
        }

    @staticmethod
    def _comparative_severity(p360: dict[str, Any]) -> str:
        """
        For the comparative-context rule, determine severity based on
        clinical profile rather than raw vitals.
        """
        flags = p360.get("flags", {})
        condition_codes = flags.get("condition_codes", [])

        risk_score = 0
        if flags.get("has_beta_blocker"):
            risk_score += 2  # On beta-blocker but HR still high = very concerning
        if flags.get("has_ckd"):
            risk_score += 1
        if _T2DM_CODE in condition_codes:
            risk_score += 1
        age = p360.get("demographics", {}).get("age", 0)
        if age >= 65:
            risk_score += 1

        if risk_score >= 4:
            return "critical"
        elif risk_score >= 2:
            return "high"
        elif risk_score >= 1:
            return "moderate"
        return "low"

    @staticmethod
    def _comparative_explanation(p360: dict[str, Any], severity: str) -> str:
        """Build a human-readable explanation of why the patient's context
        makes this heart rate clinically significant."""
        flags = p360.get("flags", {})
        condition_codes = flags.get("condition_codes", [])
        factors: list[str] = []

        if flags.get("has_beta_blocker"):
            factors.append("on beta-blocker therapy (HR should be controlled)")
        if flags.get("has_ckd"):
            factors.append("chronic kidney disease")
        if _T2DM_CODE in condition_codes:
            factors.append("type 2 diabetes")
        age = p360.get("demographics", {}).get("age", 0)
        if age >= 65:
            factors.append(f"age {age}")

        if not factors:
            return f"classified as {severity} based on overall profile"

        return f"{severity} because patient has {', '.join(factors)}"

    # ==================================================================
    # 4. HEDIS Care Gap Calculator
    # ==================================================================

    def compute_care_gaps(self, patient_id: str) -> Optional[list[dict[str, Any]]]:
        """
        Evaluate HEDIS measures for a single patient and write care_gaps
        to the Patient 360 document.

        Returns the computed care gaps list, or None if patient not found.
        """
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        flags = p360.get("flags", {})
        condition_codes = flags.get("condition_codes", [])
        labs = p360.get("labs", [])
        vitals_summary = p360.get("vitals_summary", {})
        trend_24h = vitals_summary.get("trend_24h", {})

        now = datetime.now(timezone.utc)
        care_gaps: list[dict[str, Any]] = []

        for measure in HEDIS_MEASURES:
            # Check if measure applies to this patient
            applicable_conditions = measure.get("applicable_conditions", [])
            if applicable_conditions:
                if not any(c in condition_codes for c in applicable_conditions):
                    continue

            applicable_flags = measure.get("applicable_flags", [])
            if applicable_flags:
                if not all(flags.get(f, False) for f in applicable_flags):
                    continue

            # Statin therapy (SPD) check — age 40-75
            if measure["measure_code"] == "SPD":
                age = p360.get("demographics", {}).get("age", 0)
                if age < 40 or age > 75:
                    continue

            # Determine last completion date from labs
            last_completed = None
            lab_loinc = measure.get("lab_loinc")
            if lab_loinc:
                matching = [lb for lb in labs if lb.get("loinc") == lab_loinc]
                if matching:
                    dates = [lb.get("effective_date") for lb in matching if lb.get("effective_date")]
                    if dates:
                        last_completed = max(dates)

            # Compute due date & overdue status
            frequency_days = measure.get("frequency_days", 365)
            due_by = None
            days_overdue = 0
            status = "open"

            if last_completed:
                try:
                    last_dt = datetime.fromisoformat(last_completed.replace("Z", "+00:00"))
                    if last_dt.tzinfo is None:
                        last_dt = last_dt.replace(tzinfo=timezone.utc)
                    due_dt = last_dt + timedelta(days=frequency_days)
                    due_by = due_dt.strftime("%Y-%m-%d")

                    if now > due_dt:
                        days_overdue = (now - due_dt).days
                        status = "open"
                    else:
                        status = "closed"
                except (ValueError, TypeError):
                    pass

            if status == "closed":
                continue  # Only report open gaps

            # Compute priority — base + vitals trend escalation
            priority = measure.get("priority_base", "moderate")
            priority = self._escalate_priority(
                priority, measure["measure_code"], trend_24h, labs,
            )

            care_gaps.append({
                "hedis_measure": measure["measure_code"],
                "measure_name": measure["measure_name"],
                "status": status,
                "last_completed": last_completed,
                "due_by": due_by,
                "days_overdue": days_overdue,
                "priority": priority,
            })

        self._repo.update_patient_360_care_gaps(patient_id, care_gaps)
        return care_gaps

    def compute_care_gaps_all(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> ComputeCareGapsResponse:
        """Batch-compute HEDIS care gaps for all materialized patients."""
        patient_ids = self._repo.get_all_patient_360_ids(
            hospital=hospital, profile_type=profile_type,
        )
        total = len(patient_ids)
        processed = 0
        total_gaps = 0
        errors: list[str] = []

        for pid in patient_ids:
            try:
                gaps = self.compute_care_gaps(pid)
                if gaps is not None:
                    processed += 1
                    total_gaps += len(gaps)
                else:
                    errors.append(f"Patient {pid}: not found in patient_360")
            except Exception as exc:
                msg = f"Patient {pid}: {exc}"
                logger.exception("Care gap computation failed — %s", msg)
                errors.append(msg)

        return ComputeCareGapsResponse(
            total_patients=total,
            processed=processed,
            total_gaps_found=total_gaps,
            errors=errors,
        )

    @staticmethod
    def _escalate_priority(
        base_priority: str,
        measure_code: str,
        trend_24h: dict[str, str],
        labs: list[dict[str, Any]],
    ) -> str:
        """
        Escalate care gap priority based on wearable vitals trends.

        This is the novel value proposition: wearable data enriches
        care gap analysis. E.g., "HbA1c overdue AND wearable shows
        increasing HR variability → escalate priority."
        """
        priority_order = ["low", "moderate", "high", "critical"]
        idx = priority_order.index(base_priority) if base_priority in priority_order else 1

        # CDC-HBA: HbA1c overdue + increasing HR trend → poor glycemic control signal
        if measure_code == "CDC-HBA":
            if trend_24h.get("heart_rate") == "increasing":
                idx = min(idx + 1, 3)
            # Also escalate if last HbA1c was high
            hba1c_vals = [lb["value"] for lb in labs if lb.get("loinc") == "4548-4"]
            if hba1c_vals and max(hba1c_vals) > 8.0:
                idx = min(idx + 1, 3)

        # KED: Kidney eval overdue + decreasing SpO2 → CKD decompensation risk
        elif measure_code == "KED":
            if trend_24h.get("spo2") == "decreasing":
                idx = min(idx + 1, 3)
            if trend_24h.get("respiratory_rate") == "increasing":
                idx = min(idx + 1, 3)

        # CBP: BP control overdue + increasing HR trend
        elif measure_code == "CBP":
            if trend_24h.get("heart_rate") == "increasing":
                idx = min(idx + 1, 3)

        # SPD: Statin overdue + decreasing activity level → deconditioning
        elif measure_code == "SPD":
            if trend_24h.get("activity_level") == "decreasing":
                idx = min(idx + 1, 3)

        return priority_order[idx]

    # ------------------------------------------------------------------
    # Alerts retrieval
    # ------------------------------------------------------------------

    def get_patient_alerts(
        self,
        patient_id: str,
        status: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Retrieve alerts for a patient."""
        return self._repo.get_alerts_for_patient(patient_id, status=status)

    def get_status(self) -> dict[str, int]:
        """Return counts of rules and alerts."""
        return {
            "cds_rules_count": self._repo.count_rules(),
            "alerts_count": self._repo.count_alerts(),
        }
