"""
HEDIS quality / care-gap engine (DEQM-aligned).

Evaluates patient clinical histories against HEDIS measures to identify
open and closed care gaps. Architecturally separate from the real-time
alert engine per the Da Vinci recommendation to keep quality-measure
logic distinct from clinical threshold monitoring.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from cds.hedis_measures import HEDIS_MEASURES
from cds.models import ComputeCareGapsResponse
from cds.repository import CDSRepository

logger = logging.getLogger(__name__)


# Alert → care-gap escalation map.
#
# This is the *only* coupling point between the alert engine and the quality
# engine, and it is intentionally a one-way data read: the quality engine
# inspects the already-materialized `patient_360.active_alerts` array and
# never imports from `alert_engine.py`. The alert engine has no knowledge of
# this mapping. Architecturally we keep both engines independent so the
# pattern matches the Da Vinci recommendation ("device threshold events can
# absolutely feed care-gap logic indirectly").
#
# Behaviour:
#   * `rule_ids`      — explicit allow-list of alert rule_ids that escalate
#                       the measure. Empty list ⇒ any alert at or above
#                       `min_severity` qualifies.
#   * `min_severity`  — minimum severity required for the alert to count.
ALERT_ESCALATIONS_BY_MEASURE: dict[str, dict[str, Any]] = {
    "CDC-HBA": {
        "rule_ids": ["cds_beta_blocker_hr", "cds_hypoglycemia"],
        "min_severity": "high",
    },
    "KED": {
        "rule_ids": ["cds_ckd_respiratory", "cds_sepsis_warning"],
        "min_severity": "high",
    },
    "CBP": {
        "rule_ids": ["cds_beta_blocker_hr"],
        "min_severity": "moderate",
    },
    "SPD": {
        # Sepsis in a diabetic patient without active statin therapy elevates
        # cardiovascular mortality risk. Breakthrough tachycardia on a beta-blocker
        # signals cardiovascular instability where the statin gap becomes acute.
        "rule_ids": ["cds_sepsis_warning", "cds_beta_blocker_hr"],
        "min_severity": "high",
    },
    "EED": {
        # Hypoglycemic episodes directly damage retinal tissue; an active
        # hypoglycemia pattern makes an overdue diabetic eye exam genuinely urgent.
        "rule_ids": ["cds_hypoglycemia"],
        "min_severity": "high",
    },
}

_SEVERITY_ORDER = ["low", "moderate", "high", "critical"]


# Window in which a not-yet-overdue gap is surfaced as DEQM "prospective"
# (`due_soon`) rather than `closed`. 60 days mirrors the typical proactive
# scheduling window used in care-management programs.
DUE_SOON_WINDOW_DAYS = 60


class QualityEngine:
    """HEDIS care-gap computation engine."""

    def __init__(self, repo: CDSRepository):
        self._repo = repo

    def compute_care_gaps(self, patient_id: str) -> Optional[list[dict[str, Any]]]:
        """
        Evaluate HEDIS measures for a single patient and write care_gaps
        to the Patient 360 document.
        """
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        flags = p360.get("flags", {})
        condition_codes = flags.get("condition_codes", [])
        labs = p360.get("labs", [])
        conditions = p360.get("conditions", [])
        vitals_summary = p360.get("vitals_summary", {})
        trend_24h = vitals_summary.get("trend_24h", {})
        # Snapshot of the denormalized active alerts on Patient 360 (written
        # by the alert engine on its own evaluation cycle). This stays a pure
        # data read — no import of alert_engine.
        active_alerts = p360.get("active_alerts", []) or []

        # Item 7 — gap closure audit trail. Keyed by measure_code so we can
        # both (a) carry forward prior `closure_history` across recomputes
        # (re-open via overdue must not erase audit entries) and (b) detect
        # `open|due_soon → closed` transitions that warrant a fresh entry.
        prior_gaps_by_measure: dict[str, dict[str, Any]] = {
            (g.get("hedis_measure") or ""): g
            for g in (p360.get("care_gaps") or [])
            if g.get("hedis_measure")
        }

        now = datetime.now(timezone.utc)
        care_gaps: list[dict[str, Any]] = []
        period_end = now.strftime("%Y-%m-%d")

        for measure in HEDIS_MEASURES:
            applicable_conditions = measure.get("applicable_conditions", [])
            if applicable_conditions:
                if not any(c in condition_codes for c in applicable_conditions):
                    continue

            applicable_flags = measure.get("applicable_flags", [])
            if applicable_flags:
                if not all(flags.get(f, False) for f in applicable_flags):
                    continue

            if measure["measure_code"] == "SPD":
                age = p360.get("demographics", {}).get("age", 0)
                if age < 40 or age > 75:
                    continue

            frequency_days = measure.get("frequency_days", 365)
            period_start_dt = now - timedelta(days=frequency_days)
            measurement_period = f"{period_start_dt.strftime('%Y-%m-%d')}/{period_end}"

            evidence_found: list[str] = []
            evidence_missing: list[str] = []
            source_resources: list[str] = []
            last_completed = None
            lab_loinc = measure.get("lab_loinc")
            evidence_labels = measure.get("evidence_labels", {})

            if measure["measure_code"] == "KED":
                egfr_dates = [
                    lb.get("effective_date") for lb in labs
                    if lb.get("loinc") == "62238-1" and lb.get("effective_date")
                ]
                uacr_dates = [
                    lb.get("effective_date") for lb in labs
                    if lb.get("loinc") == "14959-1" and lb.get("effective_date")
                ]
                egfr_vals = [lb for lb in labs if lb.get("loinc") == "62238-1"]
                uacr_vals = [lb for lb in labs if lb.get("loinc") == "14959-1"]
                if egfr_dates:
                    val = egfr_vals[0].get("value", "") if egfr_vals else ""
                    unit = egfr_vals[0].get("unit", "") if egfr_vals else ""
                    evidence_found.append(f"eGFR {val} {unit} ({max(egfr_dates)[:10]})")
                    source_resources.append("Observation/eGFR")
                else:
                    evidence_missing.append("eGFR not found in measurement period")
                if uacr_dates:
                    val = uacr_vals[0].get("value", "") if uacr_vals else ""
                    unit = uacr_vals[0].get("unit", "") if uacr_vals else ""
                    evidence_found.append(f"uACR {val} {unit} ({max(uacr_dates)[:10]})")
                    source_resources.append("Observation/uACR")
                else:
                    evidence_missing.append("uACR not found in measurement period")

                all_dates = egfr_dates + uacr_dates
                if not evidence_missing and all_dates:
                    last_completed = max(all_dates)

            elif lab_loinc:
                matching = [lb for lb in labs if lb.get("loinc") == lab_loinc]
                label = evidence_labels.get(lab_loinc, lab_loinc)
                if matching:
                    dates = [lb.get("effective_date") for lb in matching if lb.get("effective_date")]
                    if dates:
                        last_completed = max(dates)
                        val = matching[0].get("value", "")
                        unit = matching[0].get("unit", "")
                        evidence_found.append(f"{label} {val} {unit} ({last_completed[:10]})")
                        source_resources.append(f"Observation/{label}")
                    else:
                        evidence_missing.append(f"{label} result found but missing date")
                else:
                    evidence_missing.append(f"No {label} result in measurement period")

            if not last_completed and not lab_loinc:
                encounters = p360.get("encounters", [])
                enc_dates = []
                for enc in encounters:
                    end = enc.get("period_end") or enc.get("period_start")
                    if end:
                        enc_dates.append(end)
                if enc_dates:
                    last_completed = max(enc_dates)
                    evidence_found.append(f"Encounter on {last_completed[:10]}")
                    source_resources.append("Encounter")
                else:
                    measure_name_short = measure["measure_code"]
                    evidence_missing.append(f"No qualifying {measure_name_short} encounter found")

            due_by = None
            days_overdue = 0
            days_until_due = 0
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
                        # DEQM "prospective": gap is technically still closed
                        # but is closing soon enough that the care team should
                        # schedule it proactively rather than wait for it to
                        # flip open.
                        days_until_due = (due_dt - now).days
                        if days_until_due <= DUE_SOON_WINDOW_DAYS:
                            status = "due_soon"
                        else:
                            status = "closed"
                except (ValueError, TypeError):
                    pass
            else:
                due_dt = self._derive_due_date(
                    applicable_conditions, conditions, frequency_days, now,
                )
                due_by = due_dt.strftime("%Y-%m-%d")
                if now > due_dt:
                    days_overdue = (now - due_dt).days

            priority = measure.get("priority_base", "moderate")
            if status == "open":
                priority = self._escalate_priority(
                    priority, measure["measure_code"], trend_24h, labs,
                )
                if days_overdue > 90:
                    priority = self._bump_priority(priority)

            # Alert → care-gap correlation. The list itself is always projected
            # onto the gap so the UI can render the "Linked alert" pill even
            # when a gap is closed-controlled. The actual priority bump is
            # deferred until after result-based evaluation so that
            # `closed_uncontrolled` gaps (Item 2) can also be amplified by
            # correlated alerts.
            correlated_alerts = self._correlate_alerts(
                measure["measure_code"], active_alerts,
            )

            if status == "open" and evidence_missing:
                reason = "; ".join(evidence_missing)
            elif status == "open" and days_overdue > 0:
                reason = f"Last completed {last_completed[:10] if last_completed else 'unknown'}, {days_overdue} days overdue"
            elif status == "due_soon":
                reason = (
                    f"Closing in {days_until_due} days — schedule proactively"
                )
            elif status == "closed":
                reason = None
            else:
                reason = f"Due by {due_by}"

            if status == "closed":
                recompute_after = due_by
            else:
                # `open` and `due_soon` both warrant a 24h refresh — the
                # countdown for `due_soon` is moving every day.
                recompute_after = (now + timedelta(hours=24)).isoformat()

            confidence = "high"
            if not lab_loinc and evidence_found:
                confidence = "medium"
            if evidence_missing and evidence_found:
                confidence = "medium"

            recommended_action = measure.get("recommended_action")
            result_evaluation: dict[str, Any] | None = None

            # Result-based evaluation runs only on screenings that closed by
            # existence — HEDIS still counts the screening as the numerator,
            # but a failing result drives the "Closed — flagged" UI state and
            # may bump priority + override the recommended action.
            if status == "closed" and measure.get("result_evaluation"):
                result_evaluation = self._evaluate_result(measure, labs)
                if result_evaluation:
                    if not result_evaluation["controlled"]:
                        priority = self._raise_to_floor(
                            priority,
                            measure["result_evaluation"].get(
                                "uncontrolled_priority_floor", "high"
                            ),
                        )
                        action_override = result_evaluation.get("uncontrolled_action")
                        if action_override:
                            recommended_action = action_override
                        # Surface each failing component in the evidence trail
                        # so the patient detail panel can show the "why".
                        for comp in result_evaluation["components"]:
                            if not comp["met"]:
                                evidence_found.append(
                                    self._format_uncontrolled_evidence(comp)
                                )
                        reason = (
                            f"Screening completed; result not at target "
                            f"({result_evaluation['label']})"
                        )

            # Deferred alert-correlation bump (see comment above). Apply only
            # to gaps that are still actionable: open, due_soon, or
            # closed-but-flagged. `due_soon` is included because a correlated
            # alert is a strong reason to pull the next screening forward.
            if correlated_alerts:
                is_flagged_closed = (
                    status == "closed"
                    and result_evaluation is not None
                    and result_evaluation.get("controlled") is False
                )
                if status in ("open", "due_soon") or is_flagged_closed:
                    priority = self._bump_priority(priority)

            gap_entry: dict[str, Any] = {
                "hedis_measure": measure["measure_code"],
                "measure_name": measure["measure_name"],
                "description": measure.get("description", ""),
                "status": status,
                "last_completed": last_completed,
                "due_by": due_by,
                "days_overdue": days_overdue,
                "days_until_due": days_until_due,
                "priority": priority,
                "measurement_period": measurement_period,
                "evidence": {
                    "found": evidence_found,
                    "missing": evidence_missing,
                    "source_resources": source_resources,
                },
                "reason": reason,
                "recommended_action": recommended_action,
                "confidence": confidence,
                "recompute_after": recompute_after,
                "result_evaluation": result_evaluation,
                "correlated_alerts": correlated_alerts,
            }

            if measure["measure_code"] == "KED":
                workflow = p360.get("interventions", {}).get("ked_workflow", {})
                gap_entry["workflow_status"] = workflow.get("status", "not_started")
                follow_up = workflow.get("follow_up_recommended", False)
                gap_entry["follow_up"] = {
                    "recommended": follow_up,
                    "reason": workflow.get("follow_up_reason"),
                    "status": "pending_review" if follow_up else "not_needed",
                }

            if measure["measure_code"] == "CDC-HBA":
                workflow = p360.get("interventions", {}).get("cdc_hba_workflow", {})
                gap_entry["workflow_status"] = workflow.get("status", "not_started")
                follow_up = workflow.get("follow_up_recommended", False)
                gap_entry["follow_up"] = {
                    "recommended": follow_up,
                    "reason": workflow.get("follow_up_reason"),
                    "status": "pending_review" if follow_up else "not_needed",
                }

            prior_gap = prior_gaps_by_measure.get(measure["measure_code"])
            gap_entry["closure_history"] = self._build_closure_history(
                measure_code=measure["measure_code"],
                prior_gap=prior_gap,
                new_status=status,
                evidence_found=evidence_found,
                result_evaluation=result_evaluation,
                p360=p360,
                now=now,
            )

            care_gaps.append(gap_entry)

        self._repo.update_patient_360_care_gaps(patient_id, care_gaps)
        self._sync_ked_workflow(patient_id, p360, care_gaps)
        self._sync_cdc_hba_workflow(patient_id, p360, care_gaps)
        return care_gaps

    def compute_care_gaps_all(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> ComputeCareGapsResponse:
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

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_closure_history(
        measure_code: str,
        prior_gap: Optional[dict[str, Any]],
        new_status: str,
        evidence_found: list[str],
        result_evaluation: Optional[dict[str, Any]],
        p360: dict[str, Any],
        now: datetime,
    ) -> list[dict[str, Any]]:
        """Carry prior closure entries forward and append a new one when a
        gap transitions `open|due_soon → closed` between recomputes.

        Dedup on (workflow, closed_at) keeps the array bounded across many
        compute cycles and across re-open/re-close oscillations driven by
        overdue dates.
        """
        history = list((prior_gap or {}).get("closure_history") or [])

        prior_status = (prior_gap or {}).get("status")
        is_transition = (
            new_status == "closed"
            and prior_status in ("open", "due_soon")
        )
        if not is_transition:
            return history

        interventions = p360.get("interventions", {}) or {}
        workflow_key = "system"
        completed_at: Optional[str] = None
        completed_by: Optional[str] = None
        if measure_code == "KED":
            workflow_key = "ked_workflow"
            wf = interventions.get("ked_workflow", {}) or {}
            completed_at = wf.get("completed_at")
            completed_by = wf.get("completed_by")
        elif measure_code == "CDC-HBA":
            workflow_key = "cdc_hba_workflow"
            wf = interventions.get("cdc_hba_workflow", {}) or {}
            completed_at = wf.get("completed_at")
            completed_by = wf.get("completed_by")

        event = {
            "closed_at": completed_at or now.isoformat(),
            "closed_by": completed_by or "system",
            "closed_by_role": None,
            "workflow": workflow_key,
            "evidence_snapshot": list(evidence_found),
            "result_evaluation": result_evaluation,
        }

        # Dedup so repeated `compute_care_gaps` runs that pick up the same
        # workflow.completed_at don't double-write.
        existing_keys = {
            (e.get("workflow"), e.get("closed_at")) for e in history
        }
        if (event["workflow"], event["closed_at"]) in existing_keys:
            return history

        history.append(event)
        return history

    @staticmethod
    def _derive_due_date(
        applicable_condition_codes: list[str],
        conditions: list[dict[str, Any]],
        frequency_days: int,
        now: datetime,
    ) -> datetime:
        earliest_onset: datetime | None = None
        for cond in conditions:
            if cond.get("code") in applicable_condition_codes:
                onset_raw = cond.get("onset_date")
                if onset_raw:
                    try:
                        onset_dt = datetime.fromisoformat(
                            onset_raw.replace("Z", "+00:00"),
                        )
                        if onset_dt.tzinfo is None:
                            onset_dt = onset_dt.replace(tzinfo=timezone.utc)
                        if earliest_onset is None or onset_dt < earliest_onset:
                            earliest_onset = onset_dt
                    except (ValueError, TypeError):
                        pass

        if earliest_onset is None:
            return now + timedelta(days=30)

        days_since = (now - earliest_onset).days
        cycles = max(1, days_since // frequency_days)
        next_due = earliest_onset + timedelta(days=(cycles + 1) * frequency_days)
        prev_due = earliest_onset + timedelta(days=cycles * frequency_days)

        if (next_due - now).days <= 60:
            return next_due
        return prev_due

    def _sync_ked_workflow(
        self,
        patient_id: str,
        p360: dict[str, Any],
        care_gaps: list[dict[str, Any]],
    ) -> None:
        ked_gap = next(
            (gap for gap in care_gaps if gap.get("hedis_measure") == "KED"),
            None,
        )
        if not ked_gap:
            return

        existing_workflow = p360.get("interventions", {}).get("ked_workflow", {})
        evidence = ked_gap.get("evidence", {})
        follow_up = ked_gap.get("follow_up", {})
        gap_status = ked_gap.get("status", "open")
        existing_status = existing_workflow.get("status", "not_started")

        # `due_soon` means the prior screening completed and is still within
        # the measurement window — same workflow consequence as a plain
        # `closed` gap (the ordered tests have results), just with a shorter
        # runway before the next refresh.
        is_screening_done = gap_status in ("closed", "due_soon")

        if is_screening_done:
            workflow_status = "completed"
        elif existing_status == "ordered":
            workflow_status = "ordered"
        else:
            workflow_status = "not_started"

        closed_at = ked_gap.get("last_completed") if is_screening_done else None
        ordered_at = existing_workflow.get("ordered_at")
        completed_at = existing_workflow.get("completed_at")

        missing_labels = [m.split(" ")[0] for m in evidence.get("missing", [])]

        ked_workflow = {
            "status": workflow_status,
            "ordered_at": ordered_at,
            "ordered_by": existing_workflow.get("ordered_by"),
            "completed_at": completed_at or closed_at,
            "completed_by": existing_workflow.get("completed_by"),
            "required_evidence": ["eGFR", "uACR"],
            "missing_evidence": missing_labels if missing_labels else existing_workflow.get("missing_evidence", ["eGFR", "uACR"]),
            "latest_result_profile": existing_workflow.get("latest_result_profile"),
            "latest_result_ids": existing_workflow.get("latest_result_ids", []),
            "follow_up_recommended": follow_up.get("recommended", False),
            "follow_up_reason": follow_up.get("reason"),
            "follow_up_summary": existing_workflow.get("follow_up_summary"),
            "last_updated_at": datetime.now(timezone.utc).isoformat(),
        }

        if workflow_status == "completed":
            ked_workflow["missing_evidence"] = []
            if not ked_workflow["completed_at"]:
                ked_workflow["completed_at"] = closed_at or datetime.now(timezone.utc).isoformat()

        self._repo.update_patient_360_ked_workflow(patient_id, ked_workflow)

    def _sync_cdc_hba_workflow(
        self,
        patient_id: str,
        p360: dict[str, Any],
        care_gaps: list[dict[str, Any]],
    ) -> None:
        cdc_gap = next(
            (gap for gap in care_gaps if gap.get("hedis_measure") == "CDC-HBA"),
            None,
        )
        if not cdc_gap:
            return

        existing_workflow = p360.get("interventions", {}).get("cdc_hba_workflow", {})
        evidence = cdc_gap.get("evidence", {})
        follow_up = cdc_gap.get("follow_up", {})
        gap_status = cdc_gap.get("status", "open")
        existing_status = existing_workflow.get("status", "not_started")

        # `due_soon` ⇒ screening completed; treat as a closed workflow.
        is_screening_done = gap_status in ("closed", "due_soon")

        if is_screening_done:
            workflow_status = "completed"
        elif existing_status == "ordered":
            workflow_status = "ordered"
        else:
            workflow_status = "not_started"

        closed_at = cdc_gap.get("last_completed") if is_screening_done else None
        ordered_at = existing_workflow.get("ordered_at")
        completed_at = existing_workflow.get("completed_at")

        missing_labels = [m.split(" ")[0] for m in evidence.get("missing", [])]

        cdc_hba_workflow = {
            "status": workflow_status,
            "ordered_at": ordered_at,
            "ordered_by": existing_workflow.get("ordered_by"),
            "completed_at": completed_at or closed_at,
            "completed_by": existing_workflow.get("completed_by"),
            "required_evidence": ["HbA1c"],
            "missing_evidence": missing_labels if missing_labels else existing_workflow.get("missing_evidence", ["HbA1c"]),
            "latest_result_profile": existing_workflow.get("latest_result_profile"),
            "latest_result_ids": existing_workflow.get("latest_result_ids", []),
            "follow_up_recommended": follow_up.get("recommended", False),
            "follow_up_reason": follow_up.get("reason"),
            "follow_up_summary": existing_workflow.get("follow_up_summary"),
            "last_updated_at": datetime.now(timezone.utc).isoformat(),
        }

        if workflow_status == "completed":
            cdc_hba_workflow["missing_evidence"] = []
            if not cdc_hba_workflow["completed_at"]:
                cdc_hba_workflow["completed_at"] = closed_at or datetime.now(timezone.utc).isoformat()

        self._repo.update_patient_360_cdc_hba_workflow(patient_id, cdc_hba_workflow)

    @staticmethod
    def _correlate_alerts(
        measure_code: str,
        active_alerts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Return the subset of `active_alerts` that correlate with `measure_code`.

        Uses the `ALERT_ESCALATIONS_BY_MEASURE` table — see the module-level
        comment for the architectural rationale (one-way data read; no
        import of alert_engine).
        """
        config = ALERT_ESCALATIONS_BY_MEASURE.get(measure_code)
        if not config or not active_alerts:
            return []

        rule_ids = set(config.get("rule_ids") or [])
        min_severity = config.get("min_severity", "high")
        try:
            min_idx = _SEVERITY_ORDER.index(min_severity)
        except ValueError:
            min_idx = _SEVERITY_ORDER.index("high")

        matches: list[dict[str, Any]] = []
        for alert in active_alerts:
            severity = alert.get("severity", "")
            try:
                sev_idx = _SEVERITY_ORDER.index(severity)
            except ValueError:
                continue
            if sev_idx < min_idx:
                continue
            if rule_ids and alert.get("rule_id") not in rule_ids:
                continue
            matches.append({
                "alert_id": alert.get("alert_id", ""),
                "rule_id": alert.get("rule_id", ""),
                "title": alert.get("title", ""),
                "severity": severity,
                "reasoning": alert.get("reasoning", ""),
            })
        return matches

    @staticmethod
    def _bump_priority(priority: str) -> str:
        order = ["low", "moderate", "high", "critical"]
        idx = order.index(priority) if priority in order else 1
        return order[min(idx + 1, 3)]

    @staticmethod
    def _raise_to_floor(priority: str, floor: str) -> str:
        order = ["low", "moderate", "high", "critical"]
        cur = order.index(priority) if priority in order else 1
        flr = order.index(floor) if floor in order else 2
        return order[max(cur, flr)]

    @staticmethod
    def _compare(value: float, comparator: str, target: float) -> bool:
        if comparator == "lt":
            return value < target
        if comparator == "lte":
            return value <= target
        if comparator == "gt":
            return value > target
        if comparator == "gte":
            return value >= target
        return False

    @staticmethod
    def _latest_lab(labs: list[dict[str, Any]], loinc: str) -> dict[str, Any] | None:
        matching = [lb for lb in labs if lb.get("loinc") == loinc and lb.get("value") is not None]
        if not matching:
            return None
        # Most recent by effective_date; labs without a date sort last.
        return max(
            matching,
            key=lambda lb: lb.get("effective_date") or "",
        )

    def _evaluate_result(
        self,
        measure: dict[str, Any],
        labs: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        """Run the result-evaluation block against the patient's most recent labs.

        Returns None when no component has a value (the gap remains plain
        `closed` with no result_evaluation block — the UI falls back to the
        existing screening-only treatment).
        """
        eval_def = measure.get("result_evaluation")
        if not eval_def:
            return None

        components_out: list[dict[str, Any]] = []
        for comp_def in eval_def.get("components", []):
            lab = self._latest_lab(labs, comp_def["loinc"])
            value = lab.get("value") if lab else None
            measured_at = lab.get("effective_date") if lab else None
            unit = comp_def.get("unit") or (lab.get("unit") if lab else None)

            if value is None:
                # No measurement → can't evaluate this component; skip rather
                # than asserting "uncontrolled" on missing data.
                continue

            try:
                value_f = float(value)
            except (TypeError, ValueError):
                continue

            met = self._compare(value_f, comp_def["comparator"], comp_def["target"])
            components_out.append({
                "loinc": comp_def["loinc"],
                "label": comp_def["label"],
                "value": value_f,
                "unit": unit,
                "target": comp_def["target"],
                "comparator": comp_def["comparator"],
                "met": met,
                "measured_at": measured_at,
            })

        if not components_out:
            return None

        controlled = all(c["met"] for c in components_out)
        return {
            "controlled": controlled,
            "label": eval_def["control_label"] if controlled else eval_def["uncontrolled_label"],
            "components": components_out,
            "uncontrolled_action": (
                None if controlled else eval_def.get("uncontrolled_action")
            ),
        }

    @staticmethod
    def _format_uncontrolled_evidence(component: dict[str, Any]) -> str:
        """Render a single failing component for the evidence trail.

        Example: 'HbA1c 9.1 % above target < 8.0 % (poorly controlled)'
        """
        comparator_text = {
            "lt": "<",
            "lte": "≤",
            "gt": ">",
            "gte": "≥",
        }.get(component["comparator"], component["comparator"])

        direction = "above" if component["comparator"] in ("lt", "lte") else "below"
        unit = component.get("unit") or ""
        return (
            f"{component['label']} {component['value']} {unit} "
            f"{direction} target {comparator_text} {component['target']} {unit}"
        ).strip()

    @staticmethod
    def _escalate_priority(
        base_priority: str,
        measure_code: str,
        trend_24h: dict[str, str],
        labs: list[dict[str, Any]],
    ) -> str:
        priority_order = ["low", "moderate", "high", "critical"]
        idx = priority_order.index(base_priority) if base_priority in priority_order else 1

        if measure_code == "CDC-HBA":
            if trend_24h.get("heart_rate") == "increasing":
                idx = min(idx + 1, 3)
            hba1c_vals = [lb["value"] for lb in labs if lb.get("loinc") == "4548-4"]
            if hba1c_vals and max(hba1c_vals) > 8.0:
                idx = min(idx + 1, 3)
        elif measure_code == "KED":
            if trend_24h.get("spo2") == "decreasing":
                idx = min(idx + 1, 3)
            if trend_24h.get("respiratory_rate") == "increasing":
                idx = min(idx + 1, 3)
        elif measure_code == "CBP":
            if trend_24h.get("heart_rate") == "increasing":
                idx = min(idx + 1, 3)
        elif measure_code == "SPD":
            if trend_24h.get("activity_level") == "decreasing":
                idx = min(idx + 1, 3)

        return priority_order[idx]
