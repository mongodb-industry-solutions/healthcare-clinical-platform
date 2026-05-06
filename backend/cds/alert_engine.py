"""
Real-time clinical alert engine (Threshold / Monitoring Engine).

Evaluates patient vitals against CDS rules and personalized thresholds
to generate clinical alerts. This is architecturally separate from the
quality/care-gap engine per the Da Vinci recommendation to keep
clinical monitoring alerts distinct from HEDIS quality gap logic.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from cds.models import (
    EvaluateAllResponse,
    EvaluatePatientResponse,
)
from cds.repository import CDSRepository

logger = logging.getLogger(__name__)

_T2DM_CODE = "44054006"
_CKD_CODE = "433144002"
_NEUROPATHY_CODE = "230572002"


class AlertEngine:
    """Real-time threshold and clinical alert evaluation engine."""

    def __init__(self, repo: CDSRepository):
        self._repo = repo

    # ------------------------------------------------------------------
    # Personalized Threshold Calculator
    # ------------------------------------------------------------------

    def compute_thresholds(self, patient_id: str) -> Optional[dict[str, Any]]:
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        flags = p360.get("flags", {})
        condition_codes = flags.get("condition_codes", [])
        age = p360.get("demographics", {}).get("age", 0)

        thresholds = self._build_thresholds(flags, condition_codes, age)
        self._repo.update_patient_360_thresholds(patient_id, thresholds)
        return thresholds

    @staticmethod
    def _build_thresholds(
        flags: dict[str, Any],
        condition_codes: list[str],
        age: int,
    ) -> dict[str, Any]:
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

    # ------------------------------------------------------------------
    # Real-Time Evaluator
    # ------------------------------------------------------------------

    def evaluate_patient(self, patient_id: str) -> Optional[EvaluatePatientResponse]:
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        rules = self._repo.get_all_rules(enabled_only=True)

        latest_vitals = self._repo.get_vitals_latest(patient_id, limit=1)
        if not latest_vitals:
            return EvaluatePatientResponse(
                patient_id=patient_id, alerts_generated=0, alerts=[],
            )
        current = latest_vitals[0]

        latest_ts = current.get("timestamp")
        baseline_hr = None
        if isinstance(latest_ts, datetime):
            start_2h = latest_ts - timedelta(hours=2)
            window = self._repo.get_vitals_window(patient_id, start_2h, latest_ts)
            if window:
                hr_vals = [r["heart_rate"] for r in window if r.get("heart_rate") is not None]
                if hr_vals:
                    baseline_hr = sum(hr_vals) / len(hr_vals)

        readings_4h: list[dict[str, Any]] = []
        if isinstance(latest_ts, datetime):
            start_4h = latest_ts - timedelta(hours=4)
            readings_4h = self._repo.get_vitals_window(patient_id, start_4h, latest_ts)

        self._repo.clear_alerts_for_patient(patient_id)

        generated_alerts: list[dict[str, Any]] = []

        for rule in rules:
            if not self._rule_applies(rule, p360):
                continue

            alert = self._evaluate_rule(rule, p360, current, baseline_hr, readings_4h)
            if alert:
                self._repo.insert_alert(alert)
                generated_alerts.append(alert)

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

        for a in generated_alerts:
            a.pop("_id", None)

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
    # Rule applicability
    # ------------------------------------------------------------------

    @staticmethod
    def _rule_applies(rule: dict[str, Any], p360: dict[str, Any]) -> bool:
        applicability = rule.get("applicability", {})
        flags = p360.get("flags", {})
        demographics = p360.get("demographics", {})
        condition_codes = flags.get("condition_codes", [])
        age = demographics.get("age", 0)

        required_conditions = applicability.get("conditions", [])
        if required_conditions:
            if not all(c in condition_codes for c in required_conditions):
                return False

        required_flags = applicability.get("flags", [])
        if required_flags:
            if not all(flags.get(f, False) for f in required_flags):
                return False

        min_age = applicability.get("min_age")
        if min_age is not None and age < min_age:
            return False
        max_age = applicability.get("max_age")
        if max_age is not None and age > max_age:
            return False

        profile_types = applicability.get("profile_types")
        if profile_types:
            if p360.get("profile_type", "") not in profile_types:
                return False

        return True

    # ------------------------------------------------------------------
    # Rule evaluation dispatch
    # ------------------------------------------------------------------

    def _evaluate_rule(
        self,
        rule: dict[str, Any],
        p360: dict[str, Any],
        current_vitals: dict[str, Any],
        baseline_hr: Optional[float],
        readings_4h: list[dict[str, Any]],
    ) -> Optional[dict[str, Any]]:
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
        trigger = rule["trigger"]
        vital_name = trigger.get("vital")
        if not vital_name:
            return None

        value = current.get(vital_name)
        if value is None:
            return None

        threshold = trigger.get("threshold", 0)
        if trigger.get("use_personalized_threshold"):
            pt = p360.get("personalized_thresholds", {}).get(vital_name, {})
            operator = trigger.get("operator", ">")
            if operator in (">", ">="):
                threshold = pt.get("high", threshold) or threshold
            else:
                threshold = pt.get("low", threshold) or threshold

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
        trigger = rule["trigger"]
        vital_name = trigger.get("vital", "heart_rate")
        spike_pct = trigger.get("threshold", 20)

        current_val = current.get(vital_name)
        if current_val is None or baseline_hr is None or baseline_hr == 0:
            return None

        pct_change = ((current_val - baseline_hr) / baseline_hr) * 100
        if pct_change <= spike_pct:
            return None

        activity = current.get("activity_level")
        spo2 = current.get("spo2")
        if activity is not None and activity > 3.0:
            return None
        flags = p360.get("flags", {})
        spo2_floor = 90.0 if flags.get("has_ckd") else 95.0
        if spo2 is not None and spo2 < spo2_floor:
            return None

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
        trigger = rule["trigger"]
        required_count = int(trigger.get("threshold", 3))

        criteria_met: list[str] = []

        temp = current.get("temperature")
        if temp is not None and (temp > 38.0 or temp < 36.0):
            criteria_met.append(f"Temperature {temp:.1f}°C (abnormal)")

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
        template = rule.get("alert_template", {})
        now = datetime.now(timezone.utc).isoformat()
        patient_id = p360.get("patient_id", "")

        reasoning = template.get("reasoning", "")
        substitutions: dict[str, Any] = {
            "value": round(value, 1) if value is not None else "N/A",
            "threshold": rule.get("trigger", {}).get("threshold", ""),
            "sustained_minutes": rule.get("trigger", {}).get("sustained_minutes", ""),
        }

        medications = p360.get("medications", [])
        beta_blockers = [m["display"] for m in medications
                         if "atenolol" in m.get("display", "").lower()
                         or "metoprolol" in m.get("display", "").lower()
                         or "propranolol" in m.get("display", "").lower()]
        substitutions["medication_name"] = beta_blockers[0] if beta_blockers else "beta-blocker"

        labs = p360.get("labs", [])
        egfr_vals = [lb["value"] for lb in labs if lb.get("loinc") == "62238-1"]
        substitutions["egfr_value"] = egfr_vals[0] if egfr_vals else "N/A"

        if extra_context:
            substitutions.update(extra_context)

        severity = template.get("severity", "moderate")
        if rule.get("rule_id") == "cds_comparative_context":
            severity = self._comparative_severity(p360)
            substitutions["context_explanation"] = self._comparative_explanation(p360, severity)

        try:
            reasoning = reasoning.format(**substitutions)
        except (KeyError, IndexError):
            pass

        ts = current_vitals.get("timestamp")
        contributing = {
            "timestamp": ts.isoformat() if isinstance(ts, datetime) else str(ts) if ts else None,
            "heart_rate": current_vitals.get("heart_rate"),
            "respiratory_rate": current_vitals.get("respiratory_rate"),
            "temperature": current_vitals.get("temperature"),
            "spo2": current_vitals.get("spo2"),
            "activity_level": current_vitals.get("activity_level"),
        }

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
        flags = p360.get("flags", {})
        condition_codes = flags.get("condition_codes", [])

        risk_score = 0
        if flags.get("has_beta_blocker"):
            risk_score += 2
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
