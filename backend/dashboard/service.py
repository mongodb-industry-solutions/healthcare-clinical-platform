"""
Dashboard service.

Builds enriched views of patient data for the clinician dashboard:
- Population view with risk indicators
- Patient detail with threshold breach status
- Vitals time series with clinical context
- Patient search

All business logic lives here — no HTTP, no direct MongoDB queries.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from dashboard.models import (
    AlertFrequency,
    BaselineVitalDelta,
    LongitudinalResponse,
    LongitudinalSnapshot,
    PatientDetailResponse,
    PatientListResponse,
    PatientSummary,
    RecommendedAction,
    SearchResponse,
    SearchResult,
    ThresholdBreachStatus,
    VitalStats,
    VitalsWithContextResponse,
    WorkbenchStatus,
)
from dashboard.repository import DashboardRepository

_SEVERITY_ORDER = {"critical": 4, "high": 3, "moderate": 2, "low": 1}

_VITAL_FIELDS = [
    "heart_rate", "respiratory_rate", "temperature", "spo2", "activity_level",
]


class DashboardService:
    def __init__(self, repo: DashboardRepository):
        self._repo = repo

    # ------------------------------------------------------------------
    # Patient list (population view)
    # ------------------------------------------------------------------

    def list_patients(
        self,
        skip: int = 0,
        limit: int = 50,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
        sort_by: str = "alert_severity",
    ) -> PatientListResponse:
        """
        Return a compact patient list with risk indicators.
        Each row includes alert count, max severity, care gap count,
        latest vitals snapshot, and a computed risk score.
        """
        docs, total = self._repo.list_patients(
            skip=skip, limit=limit, hospital=hospital,
            profile_type=profile_type, sort_by=sort_by,
        )

        summaries = [self._to_summary(doc) for doc in docs]

        summaries.sort(key=lambda s: s.risk_score, reverse=True)

        return PatientListResponse(total=total, patients=summaries)

    @staticmethod
    def _to_summary(doc: dict[str, Any]) -> PatientSummary:
        """Transform a Patient 360 document into a compact summary."""
        demographics = doc.get("demographics", {})
        active_alerts = doc.get("active_alerts", [])
        care_gaps = doc.get("care_gaps", [])
        vitals = doc.get("vitals_summary", {}).get("latest", {})

        alert_count = len(active_alerts)
        max_severity = None
        if active_alerts:
            max_severity = max(
                (a.get("severity", "low") for a in active_alerts),
                key=lambda s: _SEVERITY_ORDER.get(s, 0),
            )

        open_gaps = [g for g in care_gaps if g.get("status") == "open"]

        risk_score = _compute_risk_score(
            alert_count, max_severity, len(open_gaps), doc.get("flags", {}),
        )

        return PatientSummary(
            patient_id=doc.get("patient_id", ""),
            mrn=doc.get("mrn", ""),
            name=demographics.get("name", ""),
            age=demographics.get("age", 0),
            gender=demographics.get("gender", ""),
            source_hospital=doc.get("source_hospital", ""),
            hospital_name=doc.get("hospital_name", ""),
            profile_type=doc.get("profile_type", ""),
            alert_count=alert_count,
            max_severity=max_severity,
            care_gap_count=len(open_gaps),
            latest_hr=vitals.get("heart_rate"),
            latest_rr=vitals.get("respiratory_rate"),
            latest_spo2=vitals.get("spo2"),
            latest_temp=vitals.get("temperature"),
            risk_score=risk_score,
        )

    # ------------------------------------------------------------------
    # Patient detail
    # ------------------------------------------------------------------

    def get_patient_detail(self, patient_id: str) -> Optional[PatientDetailResponse]:
        """
        Return enriched Patient 360 for the detail view.
        Adds risk score, time since last alert, and per-vital
        threshold breach status.
        """
        doc = self._repo.get_patient_360(patient_id)
        if not doc:
            return None

        active_alerts = doc.get("active_alerts", [])
        care_gaps = doc.get("care_gaps", [])
        open_gaps = [g for g in care_gaps if g.get("status") == "open"]
        flags = doc.get("flags", {})

        alert_count = len(active_alerts)
        max_severity = None
        if active_alerts:
            max_severity = max(
                (a.get("severity", "low") for a in active_alerts),
                key=lambda s: _SEVERITY_ORDER.get(s, 0),
            )

        risk_score = _compute_risk_score(
            alert_count, max_severity, len(open_gaps), flags,
        )

        time_since = self._time_since_last_alert(active_alerts)
        breaches = self._compute_breach_status(doc)

        return PatientDetailResponse(
            patient=doc,
            risk_score=risk_score,
            time_since_last_alert=time_since,
            threshold_breaches=breaches,
        )

    @staticmethod
    def _time_since_last_alert(alerts: list[dict[str, Any]]) -> Optional[str]:
        """Compute a human-readable time-since string for the most recent alert."""
        if not alerts:
            return None

        dates = []
        for a in alerts:
            created = a.get("created_at")
            if not created:
                continue
            try:
                if isinstance(created, str):
                    dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                elif isinstance(created, datetime):
                    dt = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
                else:
                    continue
                dates.append(dt)
            except (ValueError, TypeError):
                continue

        if not dates:
            return None

        most_recent = max(dates)
        now = datetime.now(timezone.utc)
        delta = now - most_recent

        if delta.days > 0:
            return f"{delta.days}d ago"
        hours = delta.seconds // 3600
        if hours > 0:
            return f"{hours}h ago"
        minutes = delta.seconds // 60
        return f"{minutes}m ago"

    @staticmethod
    def _compute_breach_status(doc: dict[str, Any]) -> list[ThresholdBreachStatus]:
        """Check each vital against its personalized threshold."""
        thresholds = doc.get("personalized_thresholds", {})
        latest = doc.get("vitals_summary", {}).get("latest", {})
        results: list[ThresholdBreachStatus] = []

        for vital in _VITAL_FIELDS:
            current = latest.get(vital)
            thresh = thresholds.get(vital, {})
            high = thresh.get("high")
            low = thresh.get("low")

            breached = False
            direction = None
            effective_threshold = None

            if current is not None and high is not None and current > high:
                breached = True
                direction = "above"
                effective_threshold = high
            elif current is not None and low is not None and current < low:
                breached = True
                direction = "below"
                effective_threshold = low

            results.append(ThresholdBreachStatus(
                vital=vital,
                current_value=current,
                threshold=effective_threshold,
                breached=breached,
                direction=direction,
            ))

        return results

    # ------------------------------------------------------------------
    # Vitals with context
    # ------------------------------------------------------------------

    def get_vitals_with_context(
        self,
        patient_id: str,
        hours: int = 24,
    ) -> Optional[VitalsWithContextResponse]:
        """
        Return vitals time series for the requested window plus the
        patient's personalized thresholds so the frontend can render
        threshold lines on charts.
        """
        doc = self._repo.get_patient_360(patient_id)
        if not doc:
            return None

        thresholds = doc.get("personalized_thresholds", {})

        latest_docs = self._repo.get_vitals_latest(patient_id, limit=1)
        if not latest_docs:
            return VitalsWithContextResponse(
                patient_id=patient_id,
                readings=[],
                thresholds=thresholds,
                total_readings=0,
                hours=hours,
            )

        latest_ts = latest_docs[0].get("timestamp")
        if not isinstance(latest_ts, datetime):
            return VitalsWithContextResponse(
                patient_id=patient_id,
                readings=[],
                thresholds=thresholds,
                total_readings=0,
                hours=hours,
            )

        start = latest_ts - timedelta(hours=hours)
        readings = self._repo.get_vitals_window(patient_id, start, latest_ts)

        for r in readings:
            ts = r.get("timestamp")
            if isinstance(ts, datetime):
                r["timestamp"] = ts.isoformat()

        return VitalsWithContextResponse(
            patient_id=patient_id,
            readings=readings,
            thresholds=thresholds,
            total_readings=len(readings),
            hours=hours,
        )

    # ------------------------------------------------------------------
    # Longitudinal trend analysis
    # ------------------------------------------------------------------

    def get_longitudinal(
        self,
        patient_id: str,
        baseline_period_key: Optional[str] = None,
    ) -> Optional[LongitudinalResponse]:
        """
        Return a hybrid longitudinal response:
        - 3 synthetic historical snapshots (6mo, 3mo, 1mo)
        - 2 live-computed snapshots (1 week, current) from actual
          synthetic_vitals via MongoDB aggregation pipeline
        """
        doc = self._repo.get_patient_360(patient_id)
        if not doc:
            return None

        raw_snapshots = doc.get("longitudinal_snapshots", [])

        if not raw_snapshots:
            from materializer.service import MaterializerService
            raw_snapshots = MaterializerService._generate_longitudinal_snapshots(
                patient_id,
                doc.get("profile_type", ""),
                doc.get("flags", {}),
                doc.get("personalized_thresholds", {}),
                len(doc.get("conditions", [])),
                len(doc.get("medications", [])),
            )

        historical_keys = {"6_months", "3_months", "1_month"}
        snapshots: list[LongitudinalSnapshot] = []
        for s in raw_snapshots:
            if s.get("period_key") not in historical_keys:
                continue
            vitals_summary = {}
            for vital_key, stats in s.get("vitals_summary", {}).items():
                vitals_summary[vital_key] = VitalStats(**stats)

            af = s.get("alert_frequency", {})
            snapshots.append(LongitudinalSnapshot(
                period_key=s["period_key"],
                label=s["label"],
                reference_date=s["reference_date"],
                vitals_summary=vitals_summary,
                risk_score=s.get("risk_score", 0),
                alert_frequency=AlertFrequency(**af),
                trend_vs_previous=s.get("trend_vs_previous", "stable"),
                conditions_active=s.get("conditions_active", 0),
                medications_active=s.get("medications_active", 0),
                notes=s.get("notes", ""),
                source="historical",
                readings_analyzed=0,
            ))

        now = datetime.now(timezone.utc)
        flags = doc.get("flags", {})
        active_alerts = doc.get("active_alerts", [])
        care_gaps = doc.get("care_gaps", [])
        open_gaps = [g for g in care_gaps if g.get("status") == "open"]
        condition_count = len(doc.get("conditions", []))
        medication_count = len(doc.get("medications", []))

        live_windows = [
            ("1_week", "1 Week", timedelta(hours=168)),
            ("current", "Current (10 min)", timedelta(minutes=10)),
        ]

        t0 = time.perf_counter()
        total_readings_analyzed = 0

        prev_risk = snapshots[-1].risk_score if snapshots else 0

        for period_key, label, window in live_windows:
            start = now - window
            agg = self._repo.aggregate_vitals_stats(patient_id, start, now)

            if agg and agg.get("count", 0) > 0:
                count = agg["count"]
                total_readings_analyzed += count

                vitals_summary = {
                    "heart_rate": VitalStats(
                        avg=round(agg["hr_avg"], 1),
                        min=round(agg["hr_min"], 1),
                        max=round(agg["hr_max"], 1),
                        std=round(agg["hr_std"] or 0, 1),
                    ),
                    "spo2": VitalStats(
                        avg=round(agg["spo2_avg"], 1),
                        min=round(agg["spo2_min"], 1),
                        max=round(agg["spo2_max"], 1),
                        std=round(agg["spo2_std"] or 0, 1),
                    ),
                    "respiratory_rate": VitalStats(
                        avg=round(agg["rr_avg"], 1),
                        min=round(agg["rr_min"], 1),
                        max=round(agg["rr_max"], 1),
                        std=round(agg["rr_std"] or 0, 1),
                    ),
                    "temperature": VitalStats(
                        avg=round(agg["temp_avg"], 2),
                        min=round(agg["temp_min"], 2),
                        max=round(agg["temp_max"], 2),
                        std=round(agg["temp_std"] or 0, 2),
                    ),
                }

                alert_counts = self._repo.count_alerts_in_window(
                    patient_id, start, now,
                )
                alert_count = sum(alert_counts.values())
                max_sev = None
                for sev in ("critical", "high", "moderate", "low"):
                    if alert_counts.get(sev, 0) > 0:
                        max_sev = sev
                        break

                risk = _compute_risk_score(
                    alert_count, max_sev, len(open_gaps), flags,
                )

                if risk > prev_risk + 5:
                    trend = "worsening"
                elif risk < prev_risk - 5:
                    trend = "improving"
                else:
                    trend = "stable"

                notes = (
                    f"Live: {count:,} readings aggregated from "
                    f"synthetic_vitals ({label.lower()} window)"
                )

                snapshots.append(LongitudinalSnapshot(
                    period_key=period_key,
                    label=label,
                    reference_date=now.isoformat(),
                    vitals_summary=vitals_summary,
                    risk_score=risk,
                    alert_frequency=AlertFrequency(**alert_counts),
                    trend_vs_previous=trend,
                    conditions_active=condition_count,
                    medications_active=medication_count,
                    notes=notes,
                    source="live",
                    readings_analyzed=count,
                ))
                prev_risk = risk
            else:
                snapshots.append(LongitudinalSnapshot(
                    period_key=period_key,
                    label=label,
                    reference_date=now.isoformat(),
                    vitals_summary={},
                    risk_score=0,
                    alert_frequency=AlertFrequency(),
                    trend_vs_previous="stable",
                    conditions_active=condition_count,
                    medications_active=medication_count,
                    notes="No vitals data in this window yet",
                    source="live",
                    readings_analyzed=0,
                ))

        agg_ms = round((time.perf_counter() - t0) * 1000)

        pipeline_display = json.dumps([
            {"$match": {
                "patient_id": "<patient_id>",
                "timestamp": {"$gte": "<window_start>", "$lte": "<now>"},
            }},
            {"$group": {
                "_id": None,
                "count": {"$sum": 1},
                "hr_avg": {"$avg": "$heart_rate"},
                "hr_min": {"$min": "$heart_rate"},
                "hr_max": {"$max": "$heart_rate"},
                "hr_std": {"$stdDevPop": "$heart_rate"},
                "spo2_avg": {"$avg": "$spo2"},
                "spo2_min": {"$min": "$spo2"},
                "spo2_max": {"$max": "$spo2"},
                "spo2_std": {"$stdDevPop": "$spo2"},
                "rr_avg": {"$avg": "$respiratory_rate"},
                "rr_min": {"$min": "$respiratory_rate"},
                "rr_max": {"$max": "$respiratory_rate"},
                "rr_std": {"$stdDevPop": "$respiratory_rate"},
                "temp_avg": {"$avg": "$temperature"},
                "temp_min": {"$min": "$temperature"},
                "temp_max": {"$max": "$temperature"},
                "temp_std": {"$stdDevPop": "$temperature"},
            }},
        ], indent=2)

        demographics = doc.get("demographics", {})
        thresholds = doc.get("personalized_thresholds", {})
        selected_baseline = _select_baseline_snapshot(snapshots, baseline_period_key)
        current_snapshot = snapshots[-1] if snapshots else None
        threshold_breaches = _compute_snapshot_breaches(current_snapshot, thresholds)
        current_status = _compute_workbench_status(
            current_snapshot=current_snapshot,
            threshold_breaches=threshold_breaches,
            active_alerts=active_alerts,
            open_gap_count=len(open_gaps),
        )
        baseline_risk_delta = None
        baseline_alert_delta = None
        if current_snapshot and selected_baseline:
            baseline_risk_delta = round(
                current_snapshot.risk_score - selected_baseline.risk_score, 1,
            )
            baseline_alert_delta = (
                _count_alert_frequency(current_snapshot.alert_frequency)
                - _count_alert_frequency(selected_baseline.alert_frequency)
            )
        top_risk_drivers = _build_top_risk_drivers(
            doc=doc,
            current_snapshot=current_snapshot,
            selected_baseline=selected_baseline,
            threshold_breaches=threshold_breaches,
        )
        baseline_vital_deltas = _build_baseline_vital_deltas(
            current_snapshot=current_snapshot,
            selected_baseline=selected_baseline,
        )
        clinical_summary = _build_clinical_summary(
            selected_baseline=selected_baseline,
            current_status=current_status,
            baseline_vital_deltas=baseline_vital_deltas,
            baseline_risk_delta=baseline_risk_delta,
            baseline_alert_delta=baseline_alert_delta,
        )
        recommended_actions = _build_recommended_actions(doc)

        return LongitudinalResponse(
            patient_id=patient_id,
            patient_name=demographics.get("name", ""),
            profile_type=doc.get("profile_type", ""),
            current_thresholds=thresholds,
            snapshots=snapshots,
            selected_baseline_key=selected_baseline.period_key if selected_baseline else None,
            selected_baseline_label=selected_baseline.label if selected_baseline else None,
            baseline_risk_delta=baseline_risk_delta,
            baseline_alert_delta=baseline_alert_delta,
            current_status=current_status,
            threshold_breaches=threshold_breaches,
            top_risk_drivers=top_risk_drivers,
            clinical_summary=clinical_summary,
            baseline_vital_deltas=baseline_vital_deltas,
            recommended_actions=recommended_actions,
            aggregation_ms=agg_ms,
            pipeline_display=pipeline_display,
        )

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_patients(
        self, query_text: str, limit: int = 20,
    ) -> SearchResponse:
        """
        Search patients by name, MRN, or condition.
        Returns matched documents with the field that matched.
        """
        query_lower = query_text.lower()
        docs = self._repo.search_patients(query_text, limit=limit)

        results: list[SearchResult] = []
        for doc in docs:
            match_field, match_value = _identify_match(doc, query_lower)
            demographics = doc.get("demographics", {})
            results.append(SearchResult(
                patient_id=doc.get("patient_id", ""),
                mrn=doc.get("mrn", ""),
                name=demographics.get("name", ""),
                age=demographics.get("age", 0),
                gender=demographics.get("gender", ""),
                source_hospital=doc.get("source_hospital", ""),
                match_field=match_field,
                match_value=match_value,
            ))

        return SearchResponse(
            query=query_text,
            total=len(results),
            results=results,
        )


# ---------------------------------------------------------------------------
# Helpers (module-level)
# ---------------------------------------------------------------------------

def _compute_risk_score(
    alert_count: int,
    max_severity: Optional[str],
    open_gap_count: int,
    flags: dict[str, Any],
) -> int:
    """
    Compute a 0-10 composite risk score for patient prioritization.

    Weights:
    - Active alerts:   up to 4 points (severity-weighted)
    - Care gaps:       up to 3 points
    - Clinical flags:  up to 3 points
    """
    score = 0

    severity_points = _SEVERITY_ORDER.get(max_severity or "", 0)
    score += min(severity_points, 4)

    if alert_count >= 3:
        score += 1

    gap_points = min(open_gap_count, 3)
    score += gap_points

    if flags.get("has_ckd"):
        score += 1
    if flags.get("has_insulin"):
        score += 1

    return min(score, 10)


def _identify_match(doc: dict[str, Any], query_lower: str) -> tuple[str, str]:
    """Determine which field matched the search query."""
    name = doc.get("demographics", {}).get("name", "")
    if query_lower in name.lower():
        return "name", name

    mrn = doc.get("mrn", "")
    if query_lower in mrn.lower():
        return "mrn", mrn

    for cond in doc.get("conditions", []):
        display = cond.get("display", "")
        if query_lower in display.lower():
            return "condition", display

    return "unknown", ""


def _select_baseline_snapshot(
    snapshots: list[LongitudinalSnapshot],
    baseline_period_key: Optional[str],
) -> Optional[LongitudinalSnapshot]:
    historical = [s for s in snapshots if s.source != "live"]
    if not historical:
        return None

    if baseline_period_key:
        for snapshot in historical:
            if snapshot.period_key == baseline_period_key:
                return snapshot

    for preferred in ("1_month", "1_week", "3_months", "6_months"):
        for snapshot in historical:
            if snapshot.period_key == preferred:
                return snapshot

    return historical[0]


def _compute_snapshot_breaches(
    snapshot: Optional[LongitudinalSnapshot],
    thresholds: dict[str, Any],
) -> list[ThresholdBreachStatus]:
    if snapshot is None:
        return []

    results: list[ThresholdBreachStatus] = []
    for vital in _VITAL_FIELDS:
        stats = snapshot.vitals_summary.get(vital)
        current = stats.avg if stats else None
        thresh = thresholds.get(vital, {})
        high = thresh.get("high")
        low = thresh.get("low")

        breached = False
        direction = None
        effective_threshold = None

        if current is not None and high is not None and current > high:
            breached = True
            direction = "above"
            effective_threshold = high
        elif current is not None and low is not None and current < low:
            breached = True
            direction = "below"
            effective_threshold = low

        results.append(ThresholdBreachStatus(
            vital=vital,
            current_value=current,
            threshold=effective_threshold,
            breached=breached,
            direction=direction,
        ))

    return results


def _compute_workbench_status(
    current_snapshot: Optional[LongitudinalSnapshot],
    threshold_breaches: list[ThresholdBreachStatus],
    active_alerts: list[dict[str, Any]],
    open_gap_count: int,
) -> WorkbenchStatus:
    critical_alerts = sum(
        1 for alert in active_alerts if _normalize_severity(alert.get("severity")) == "critical"
    )
    high_alerts = sum(
        1 for alert in active_alerts if _normalize_severity(alert.get("severity")) == "high"
    )
    breach_count = sum(1 for breach in threshold_breaches if breach.breached)
    risk_score = current_snapshot.risk_score if current_snapshot else 0

    if critical_alerts > 0 or breach_count >= 3 or risk_score >= 7:
        return WorkbenchStatus(
            title="Critical Escalation",
            tone="critical",
            description=(
                "Multiple signals suggest active deterioration, and the patient should move from "
                "passive monitoring into immediate clinical review."
            ),
        )

    if high_alerts > 0 or breach_count >= 2 or risk_score >= 5:
        return WorkbenchStatus(
            title="Escalating Risk",
            tone="high",
            description=(
                "The patient is drifting away from personalized baseline and should be reviewed "
                "before the current pattern hardens into a critical event."
            ),
        )

    if open_gap_count > 0 or risk_score >= 3:
        return WorkbenchStatus(
            title="Watch Closely",
            tone="moderate",
            description=(
                "No immediate crisis is evident, but current drift and chronic context justify "
                "closer follow-up."
            ),
        )

    return WorkbenchStatus(
        title="Stable For Now",
        tone="stable",
        description=(
            "Current signals remain within expected range for this patient, with no immediate need "
            "to escalate beyond routine monitoring."
        ),
    )


def _build_top_risk_drivers(
    doc: dict[str, Any],
    current_snapshot: Optional[LongitudinalSnapshot],
    selected_baseline: Optional[LongitudinalSnapshot],
    threshold_breaches: list[ThresholdBreachStatus],
) -> list[str]:
    drivers: list[str] = []
    thresholds = doc.get("personalized_thresholds", {})

    for breach in threshold_breaches:
        if not breach.breached:
            continue
        threshold_value = breach.threshold
        current_value = breach.current_value
        unit = _vital_unit(breach.vital)
        if threshold_value is None or current_value is None:
            continue
        delta = abs(current_value - threshold_value)
        direction_word = "above" if breach.direction == "above" else "below"
        drivers.append(
            f"{_vital_label(breach.vital)} is {current_value:.1f} {unit}, {delta:.1f} {unit} "
            f"{direction_word} the personalized threshold."
        )

    if current_snapshot and selected_baseline:
        baseline_alert_delta = (
            _count_alert_frequency(current_snapshot.alert_frequency)
            - _count_alert_frequency(selected_baseline.alert_frequency)
        )
        baseline_risk_delta = current_snapshot.risk_score - selected_baseline.risk_score
        if abs(baseline_risk_delta) >= 1:
            drivers.append(
                f"Compared with {selected_baseline.label.lower()}, risk score is "
                f"{abs(baseline_risk_delta):.1f} points "
                f"{'higher' if baseline_risk_delta >= 0 else 'lower'}."
            )
        if baseline_alert_delta != 0:
            drivers.append(
                f"Alert burden is {abs(baseline_alert_delta)} "
                f"{'higher' if baseline_alert_delta > 0 else 'lower'} than {selected_baseline.label.lower()}."
            )

        for vital in ("spo2", "respiratory_rate", "heart_rate", "temperature"):
            current_stats = current_snapshot.vitals_summary.get(vital)
            baseline_stats = selected_baseline.vitals_summary.get(vital)
            if not current_stats or not baseline_stats:
                continue
            delta = current_stats.avg - baseline_stats.avg
            if abs(delta) < (1.0 if vital != "temperature" else 0.2):
                continue
            drivers.append(
                f"{_vital_label(vital)} shifted from {baseline_stats.avg:.1f} to "
                f"{current_stats.avg:.1f} {_vital_unit(vital)} since {selected_baseline.label.lower()}."
            )
            break

    flags = doc.get("flags", {})
    context_bits: list[str] = []
    if flags.get("has_beta_blocker"):
        context_bits.append("beta-blocker therapy lowers the expected heart-rate baseline")
    if flags.get("has_ckd"):
        context_bits.append("CKD makes respiratory and oxygenation changes more clinically meaningful")
    if flags.get("has_insulin"):
        context_bits.append("insulin therapy raises concern for hypoglycemic physiology")
    if context_bits:
        drivers.append(f"Clinical context matters because {'; '.join(context_bits)}.")

    active_alerts = doc.get("active_alerts", [])
    if active_alerts:
        lead_alert = active_alerts[0]
        title = lead_alert.get("title")
        if title:
            drivers.append(f'Current alert stack is led by "{title}".')

    deduped: list[str] = []
    seen: set[str] = set()
    for driver in drivers:
        if driver in seen:
            continue
        seen.add(driver)
        deduped.append(driver)
    return deduped[:4]


def _build_baseline_vital_deltas(
    current_snapshot: Optional[LongitudinalSnapshot],
    selected_baseline: Optional[LongitudinalSnapshot],
) -> list[BaselineVitalDelta]:
    if not current_snapshot or not selected_baseline:
        return []

    deltas: list[BaselineVitalDelta] = []
    for vital in ("spo2", "respiratory_rate", "heart_rate", "temperature"):
        current_stats = current_snapshot.vitals_summary.get(vital)
        baseline_stats = selected_baseline.vitals_summary.get(vital)
        if not current_stats or not baseline_stats:
            continue

        delta = round(current_stats.avg - baseline_stats.avg, 2 if vital == "temperature" else 1)
        abs_delta = abs(delta)
        significance = "low"
        if vital == "spo2" and abs_delta >= 2:
            significance = "high"
        elif vital == "respiratory_rate" and abs_delta >= 3:
            significance = "high"
        elif vital == "heart_rate" and abs_delta >= 8:
            significance = "high"
        elif vital == "temperature" and abs_delta >= 0.5:
            significance = "high"
        elif abs_delta >= (1 if vital != "temperature" else 0.2):
            significance = "moderate"

        deltas.append(BaselineVitalDelta(
            vital=vital,
            label=_vital_label(vital),
            unit=_vital_unit(vital),
            current_value=round(current_stats.avg, 2 if vital == "temperature" else 1),
            baseline_value=round(baseline_stats.avg, 2 if vital == "temperature" else 1),
            delta=delta,
            direction="up" if delta > 0 else "down" if delta < 0 else "flat",
            significance=significance,
        ))

    deltas.sort(key=lambda item: (0 if item.significance == "high" else 1 if item.significance == "moderate" else 2, -abs(item.delta)))
    return deltas


def _build_clinical_summary(
    selected_baseline: Optional[LongitudinalSnapshot],
    current_status: WorkbenchStatus,
    baseline_vital_deltas: list[BaselineVitalDelta],
    baseline_risk_delta: Optional[float],
    baseline_alert_delta: Optional[int],
) -> Optional[str]:
    if not selected_baseline:
        return current_status.description

    fragments: list[str] = []
    leading_deltas = baseline_vital_deltas[:2]
    for delta in leading_deltas:
        direction_word = "rose" if delta.delta > 0 else "fell" if delta.delta < 0 else "held steady"
        if delta.direction == "flat":
            fragments.append(
                f"{delta.label} held steady at {delta.current_value:.1f} {delta.unit}."
            )
        else:
            fragments.append(
                f"{delta.label} {direction_word} from {delta.baseline_value:.1f} to {delta.current_value:.1f} {delta.unit}."
            )

    if baseline_alert_delta is not None and baseline_alert_delta != 0:
        fragments.append(
            f"Alert burden is {abs(baseline_alert_delta)} {'higher' if baseline_alert_delta > 0 else 'lower'} than {selected_baseline.label.lower()}."
        )
    if baseline_risk_delta is not None and abs(baseline_risk_delta) >= 1:
        fragments.append(
            f"Overall risk is {abs(baseline_risk_delta):.1f} points {'higher' if baseline_risk_delta > 0 else 'lower'}."
        )

    summary_body = " ".join(fragments[:3]) if fragments else current_status.description
    return f"Compared with {selected_baseline.label.lower()}, {summary_body}"


def _build_recommended_actions(doc: dict[str, Any]) -> list[RecommendedAction]:
    actions: list[RecommendedAction] = []
    seen: set[str] = set()

    for alert in doc.get("active_alerts", []):
        source = alert.get("title")
        for suggested in alert.get("suggested_actions", []):
            normalized = suggested.strip().lower()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            actions.append(RecommendedAction(
                title=suggested,
                description=(
                    f"Recommended by {source.lower()} based on the current alert reasoning."
                    if source else "Recommended by the current alert stack."
                ),
                source=source,
            ))

    for gap in doc.get("care_gaps", []):
        if gap.get("status") != "open":
            continue
        normalized = f"gap:{gap.get('hedis_measure', '')}"
        if normalized in seen:
            continue
        seen.add(normalized)
        measure_name = gap.get("measure_name", "Care gap follow-up")
        days_overdue = gap.get("days_overdue", 0)
        if days_overdue and days_overdue > 0:
            description = (
                f"{days_overdue} days overdue. Closing this gap strengthens chronic disease "
                "follow-up and reduces risk of missed deterioration."
            )
        else:
            description = (
                "Scheduling this now makes the RPM workflow feel clinically actionable, not "
                "purely observational."
            )
        actions.append(RecommendedAction(
            title=measure_name,
            description=description,
            source="Care gap program",
        ))

    if not actions:
        actions.append(RecommendedAction(
            title="Continue routine monitoring",
            description=(
                "No urgent intervention is inferred right now, so the next step is continued "
                "surveillance and review of the next live window."
            ),
            source="Workbench fallback",
        ))

    return actions[:4]


def _count_alert_frequency(alert_frequency: AlertFrequency) -> int:
    return (
        alert_frequency.critical
        + alert_frequency.high
        + alert_frequency.moderate
        + alert_frequency.low
    )


def _normalize_severity(severity: Any) -> str:
    value = str(severity or "").lower()
    if value == "medium":
        return "moderate"
    return value


def _vital_label(vital: str) -> str:
    labels = {
        "heart_rate": "Heart rate",
        "respiratory_rate": "Respiratory rate",
        "temperature": "Temperature",
        "spo2": "SpO2",
        "activity_level": "Activity level",
    }
    return labels.get(vital, vital)


def _vital_unit(vital: str) -> str:
    units = {
        "heart_rate": "bpm",
        "respiratory_rate": "/min",
        "temperature": "C",
        "spo2": "%",
        "activity_level": "",
    }
    return units.get(vital, "")
