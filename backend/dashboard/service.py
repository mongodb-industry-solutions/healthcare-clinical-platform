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

from cds.hedis_measures import HEDIS_MEASURES
from dashboard.models import (
    AlertFrequency,
    BaselineVitalDelta,
    CareGapContext,
    CareGapHospitalBreakdown,
    CareGapMeasureMetric,
    CareGapPriorityBucket,
    ChronicContextFactor,
    EvidenceItem,
    LongitudinalResponse,
    LongitudinalSnapshot,
    PatientDetailResponse,
    PatientFhirBundleResponse,
    PatientListResponse,
    PatientSummary,
    PopulationCareGapMetricsFilters,
    PopulationCareGapMetricsResponse,
    RecommendedAction,
    SearchResponse,
    SearchResult,
    ThresholdBreachStatus,
    TrajectoryAssessment,
    VitalStats,
    VitalsWithContextResponse,
    WorkbenchStatus,
)
from dashboard.repository import DashboardRepository

# Forward-ref import only — kept inside the type-checking guard would be ideal
# but the constructor uses it at runtime as an optional dep. We import at
# module level rather than inside the method to keep the dependency explicit.
from attribution.repository import AttributionRepository

# Hospital code → display-name map mirrored from synthetic generation. Kept
# small and local so the dashboard service doesn't take a dependency on the
# synthetic module just for a label lookup. New hospitals fall back to the code.
_HOSPITAL_DISPLAY_NAMES: dict[str, str] = {
    "st_marys": "St. Mary's Medical Center",
    "regional_general": "Regional General Hospital",
    "community_health": "Community Health Partners",
}

_SEVERITY_ORDER = {"critical": 4, "high": 3, "moderate": 2, "low": 1}

_VITAL_FIELDS = [
    "heart_rate", "respiratory_rate", "temperature", "spo2", "activity_level",
]


class DashboardService:
    def __init__(
        self,
        repo: DashboardRepository,
        attribution_repo: Optional[AttributionRepository] = None,
    ):
        self._repo = repo
        # Optional so existing callers (tests, scripts) that don't need
        # provider-scoped filtering can keep their two-arg construction.
        self._attribution_repo = attribution_repo

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

    def get_patient_fhir_bundle(
        self, patient_id: str,
    ) -> Optional[PatientFhirBundleResponse]:
        """
        Return raw FHIR bundle availability for the insights modal.
        Returns None only when the patient itself does not exist.
        """
        patient_360 = self._repo.get_patient_360(patient_id)
        if not patient_360:
            return None

        doc = self._repo.get_patient_fhir_bundle(patient_id)
        bundle = doc.get("bundle") if doc else None

        return PatientFhirBundleResponse(
            patient_id=patient_id,
            available=bundle is not None,
            bundle=bundle,
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
        conditions = doc.get("conditions", [])
        medications = doc.get("medications", [])
        vitals_summary = doc.get("vitals_summary", {})

        urgency_reason = _build_urgency_reason(
            current_status=current_status,
            threshold_breaches=threshold_breaches,
            active_alerts=active_alerts,
            flags=flags,
            baseline_risk_delta=baseline_risk_delta,
            selected_baseline=selected_baseline,
        )
        evidence = _build_evidence(
            threshold_breaches=threshold_breaches,
            baseline_vital_deltas=baseline_vital_deltas,
            active_alerts=active_alerts,
            care_gaps=care_gaps,
            thresholds=thresholds,
        )
        chronic_context = _build_chronic_context(
            flags=flags,
            conditions=conditions,
            medications=medications,
        )
        care_gap_ctx = _build_care_gap_context(
            care_gaps=care_gaps,
            flags=flags,
            vitals_summary=vitals_summary,
        )
        trajectory = _build_trajectory_assessment(snapshots)
        workflow_rec = _build_workflow_recommendation(
            current_status=current_status,
            threshold_breaches=threshold_breaches,
            active_alerts=active_alerts,
            open_gap_count=len(open_gaps),
        )
        confidence = _compute_confidence(
            current_snapshot=current_snapshot,
            threshold_breaches=threshold_breaches,
            active_alerts=active_alerts,
        )

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
            urgency_reason=urgency_reason,
            evidence=evidence,
            chronic_context=chronic_context,
            care_gap_context=care_gap_ctx,
            trajectory_assessment=trajectory,
            workflow_recommendation=workflow_rec,
            confidence=confidence,
            aggregation_ms=agg_ms,
            pipeline_display=pipeline_display,
        )

    # ------------------------------------------------------------------
    # Population care-gap metrics
    # ------------------------------------------------------------------

    def get_population_care_gap_metrics(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
        provider_id: Optional[str] = None,
    ) -> PopulationCareGapMetricsResponse:
        """
        Run a `$facet` aggregation across patient_360 and shape it into the
        population dashboard response.

        Two passes are performed against MongoDB:

          1. The aggregation pipeline (one round-trip, single doc out).
          2. A lightweight projection-only `find()` so we can compute
             *applicable* denominators for each HEDIS measure without
             encoding HEDIS rules in the aggregation pipeline itself.

        The literal pipeline is returned as `pipeline_display` so the UI can
        render the actual MongoDB aggregation — same pattern as the
        longitudinal endpoint.
        """
        # Resolve provider_id → patient-id list via the attribution module.
        # Three states:
        #   - None              → no provider filter, scope is the whole panel
        #   - []                → provider exists but has no attributed patients;
        #                          short-circuit to an empty response so we don't
        #                          send a `$in: []` query that returns the wrong
        #                          totals via the unrelated `totals` facet.
        #   - [pid, ...]        → narrow the aggregation match stage
        patient_id_filter: Optional[list[str]] = None
        if provider_id and self._attribution_repo is not None:
            patient_id_filter = self._attribution_repo.get_patient_ids_for_provider(
                provider_id,
            )
            if not patient_id_filter:
                return self._empty_population_care_gap_metrics(
                    hospital=hospital,
                    profile_type=profile_type,
                    provider_id=provider_id,
                )

        t0 = time.perf_counter()
        facet_doc, raw_pipeline = self._repo.aggregate_care_gap_metrics(
            hospital=hospital,
            profile_type=profile_type,
            patient_id_filter=patient_id_filter,
        )
        applicability_docs = self._repo.list_patient_ids(
            hospital=hospital,
            profile_type=profile_type,
            patient_id_filter=patient_id_filter,
        )
        agg_ms = round((time.perf_counter() - t0) * 1000)

        applicable_counts = _count_applicable_per_measure(applicability_docs)

        totals = facet_doc.get("totals") or []
        total_patients = totals[0].get("patient_count", 0) if totals else 0

        by_measure_raw = {row["_id"]: row for row in facet_doc.get("by_measure", []) if row.get("_id")}

        by_measure: list[CareGapMeasureMetric] = []
        for measure in HEDIS_MEASURES:
            code = measure["measure_code"]
            row = by_measure_raw.get(code, {})
            applicable = applicable_counts.get(code, 0)
            open_count = int(row.get("open", 0) or 0)
            open_pct = round((open_count / applicable) * 100, 1) if applicable else 0.0
            avg_overdue_raw = row.get("avg_days_overdue")
            avg_overdue = round(float(avg_overdue_raw), 1) if avg_overdue_raw is not None else 0.0
            max_overdue_raw = row.get("max_days_overdue")
            max_overdue = int(max_overdue_raw) if max_overdue_raw is not None else 0

            by_measure.append(CareGapMeasureMetric(
                hedis_measure=code,
                measure_name=row.get("measure_name") or measure["measure_name"],
                applicable_count=applicable,
                open=open_count,
                closed_controlled=int(row.get("closed_controlled", 0) or 0),
                closed_uncontrolled=int(row.get("closed_uncontrolled", 0) or 0),
                due_soon=int(row.get("due_soon", 0) or 0),
                open_pct=open_pct,
                avg_days_overdue=avg_overdue,
                max_days_overdue=max_overdue,
            ))

        by_measure.sort(key=lambda m: (-m.open_pct, -m.open, m.hedis_measure))

        priority_order = {"critical": 0, "high": 1, "moderate": 2, "low": 3}
        by_priority_raw = facet_doc.get("by_priority", [])
        by_priority = [
            CareGapPriorityBucket(
                priority=str(row.get("_id") or "unknown"),
                count=int(row.get("count", 0) or 0),
            )
            for row in by_priority_raw
            if row.get("_id")
        ]
        by_priority.sort(key=lambda b: priority_order.get(b.priority, 99))

        by_hospital_raw = facet_doc.get("by_hospital", [])
        by_hospital: list[CareGapHospitalBreakdown] = []
        for row in by_hospital_raw:
            key = row.get("_id") or {}
            hospital_code = key.get("hospital") or "unknown"
            measure_code = key.get("measure")
            if not measure_code:
                continue
            by_hospital.append(CareGapHospitalBreakdown(
                hospital=hospital_code,
                hospital_name=_HOSPITAL_DISPLAY_NAMES.get(hospital_code, hospital_code),
                hedis_measure=measure_code,
                open_count=int(row.get("count", 0) or 0),
            ))

        pipeline_display = json.dumps(
            _decorate_pipeline_for_display(raw_pipeline, hospital, profile_type, provider_id),
            indent=2,
            default=str,
        )

        return PopulationCareGapMetricsResponse(
            total_patients=total_patients,
            by_measure=by_measure,
            by_priority=by_priority,
            by_hospital=by_hospital,
            aggregation_ms=agg_ms,
            pipeline_display=pipeline_display,
            filters=PopulationCareGapMetricsFilters(
                hospital=hospital,
                profile_type=profile_type,
                provider_id=provider_id,
            ),
        )

    def _empty_population_care_gap_metrics(
        self,
        hospital: Optional[str],
        profile_type: Optional[str],
        provider_id: Optional[str],
    ) -> PopulationCareGapMetricsResponse:
        """Zero-row response shape for filters that select no patients."""
        return PopulationCareGapMetricsResponse(
            total_patients=0,
            by_measure=[
                CareGapMeasureMetric(
                    hedis_measure=m["measure_code"],
                    measure_name=m["measure_name"],
                    applicable_count=0,
                    open=0,
                    closed_controlled=0,
                    closed_uncontrolled=0,
                    due_soon=0,
                    open_pct=0.0,
                    avg_days_overdue=0.0,
                    max_days_overdue=0,
                )
                for m in HEDIS_MEASURES
            ],
            by_priority=[],
            by_hospital=[],
            aggregation_ms=0,
            pipeline_display=json.dumps(
                {
                    "note": (
                        "Provider has no attributed patients — aggregation skipped."
                    ),
                    "filters": {
                        "hospital": hospital,
                        "profile_type": profile_type,
                        "provider_id": provider_id,
                    },
                },
                indent=2,
            ),
            filters=PopulationCareGapMetricsFilters(
                hospital=hospital,
                profile_type=profile_type,
                provider_id=provider_id,
            ),
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


def _count_applicable_per_measure(
    docs: list[dict[str, Any]],
) -> dict[str, int]:
    """
    Count how many patients in ``docs`` each HEDIS measure applies to.

    Mirrors `QualityEngine.compute_care_gaps` applicability gating exactly
    (condition codes ∩ flags ∩ SPD age window) so the denominator the UI
    shows ("12 of 22 applicable") matches the engine's own numerator.
    """
    counts: dict[str, int] = {m["measure_code"]: 0 for m in HEDIS_MEASURES}

    for doc in docs:
        flags = doc.get("flags", {}) or {}
        condition_codes = set(flags.get("condition_codes", []) or [])
        age = (doc.get("demographics") or {}).get("age", 0) or 0

        for measure in HEDIS_MEASURES:
            applicable_conditions = measure.get("applicable_conditions", [])
            if applicable_conditions and not any(
                c in condition_codes for c in applicable_conditions
            ):
                continue
            applicable_flags = measure.get("applicable_flags", [])
            if applicable_flags and not all(
                flags.get(f, False) for f in applicable_flags
            ):
                continue
            if measure["measure_code"] == "SPD" and (age < 40 or age > 75):
                continue
            counts[measure["measure_code"]] += 1

    return counts


def _decorate_pipeline_for_display(
    raw_pipeline: list[dict[str, Any]],
    hospital: Optional[str],
    profile_type: Optional[str],
    provider_id: Optional[str],
) -> list[dict[str, Any]]:
    """
    Substitute placeholder strings into the `$match` stage so the JSON
    rendered in the UI tells the same story for both filtered and
    unfiltered runs.
    """
    decorated = json.loads(json.dumps(raw_pipeline, default=str))
    if not decorated:
        return decorated
    match_stage = decorated[0].get("$match", {})
    if not match_stage:
        match_stage["<no_filters>"] = "all patients"
    if hospital is None:
        match_stage.setdefault("source_hospital", "<all_hospitals>")
    if profile_type is None:
        match_stage.setdefault("profile_type", "<all_profiles>")
    if provider_id is not None:
        match_stage["patient_id"] = {"$in": f"<patients_attributed_to:{provider_id}>"}
    decorated[0]["$match"] = match_stage
    return decorated


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
        title = gap.get("recommended_action") or gap.get("measure_name", "Care gap follow-up")
        reason = gap.get("reason", "")
        days_overdue = gap.get("days_overdue", 0)
        if reason:
            description = f"{reason}. Closing this gap strengthens chronic disease follow-up."
        elif days_overdue and days_overdue > 0:
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
            title=title,
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


# ---------------------------------------------------------------------------
# Workbench interpretation builders
# ---------------------------------------------------------------------------

def _build_urgency_reason(
    current_status: WorkbenchStatus,
    threshold_breaches: list[ThresholdBreachStatus],
    active_alerts: list[dict[str, Any]],
    flags: dict[str, Any],
    baseline_risk_delta: Optional[float],
    selected_baseline: Optional[LongitudinalSnapshot],
) -> str:
    """
    Produce a concise (1-2 sentence) reason *why* this patient is urgent
    right now.  Every claim traces back to thresholds, alerts, flags,
    or baseline deltas — never speculative.
    """
    breached = [b for b in threshold_breaches if b.breached]
    critical_alerts = [
        a for a in active_alerts
        if _normalize_severity(a.get("severity")) == "critical"
    ]
    high_alerts = [
        a for a in active_alerts
        if _normalize_severity(a.get("severity")) == "high"
    ]

    fragments: list[str] = []

    if breached:
        breach_parts = []
        for b in breached[:2]:
            unit = _vital_unit(b.vital)
            breach_parts.append(
                f"{_vital_label(b.vital)} at {b.current_value:.1f} {unit} "
                f"({b.direction} the personalized threshold of {b.threshold} {unit})"
            )
        fragments.append(
            f"{' and '.join(breach_parts)}, indicating the patient is outside "
            "safe personalized range."
        )

    if critical_alerts:
        titles = [a.get("title", "untitled") for a in critical_alerts[:2]]
        fragments.append(
            f"Critical CDS alert{'s' if len(titles) > 1 else ''}: "
            f"{'; '.join(titles)}."
        )
    elif high_alerts:
        fragments.append(
            f"{len(high_alerts)} high-severity alert(s) active, "
            f"led by \"{high_alerts[0].get('title', '')}\"."
        )

    context_qualifiers: list[str] = []
    if flags.get("has_beta_blocker"):
        context_qualifiers.append("beta-blocker therapy")
    if flags.get("has_ckd"):
        context_qualifiers.append("CKD")
    if flags.get("has_insulin"):
        context_qualifiers.append("insulin use")
    if context_qualifiers:
        fragments.append(
            f"This is more concerning because the patient has "
            f"{', '.join(context_qualifiers)}, which lowers the threshold "
            "for clinical significance."
        )

    if (
        baseline_risk_delta is not None
        and selected_baseline
        and abs(baseline_risk_delta) >= 2
    ):
        direction = "higher" if baseline_risk_delta > 0 else "lower"
        fragments.append(
            f"Compared with {selected_baseline.label.lower()}, risk is "
            f"{abs(baseline_risk_delta):.0f} points {direction}."
        )

    if fragments:
        return " ".join(fragments[:3])

    return current_status.description


def _build_evidence(
    threshold_breaches: list[ThresholdBreachStatus],
    baseline_vital_deltas: list[BaselineVitalDelta],
    active_alerts: list[dict[str, Any]],
    care_gaps: list[dict[str, Any]],
    thresholds: dict[str, Any],
) -> list[EvidenceItem]:
    """
    Build structured evidence items linking specific data points to
    clinical interpretation.  Each item cites a category and the data
    source that produced it.
    """
    items: list[EvidenceItem] = []

    for b in threshold_breaches:
        if not b.breached:
            continue
        thresh_info = thresholds.get(b.vital, {})
        source_rule = thresh_info.get("source_rule")
        items.append(EvidenceItem(
            category="threshold_breach",
            description=(
                f"{_vital_label(b.vital)} is {b.current_value:.1f} {_vital_unit(b.vital)}, "
                f"{b.direction} the personalized threshold of "
                f"{b.threshold} {_vital_unit(b.vital)}."
            ),
            vital=b.vital,
            source_rule=source_rule,
            significance="high",
        ))

    for delta in baseline_vital_deltas:
        if delta.significance == "low":
            continue
        direction_word = "rose" if delta.delta > 0 else "fell"
        items.append(EvidenceItem(
            category="baseline_drift",
            description=(
                f"{delta.label} {direction_word} from {delta.baseline_value} to "
                f"{delta.current_value} {delta.unit} vs baseline, a clinically "
                f"{delta.significance}-significance shift."
            ),
            vital=delta.vital,
            significance=delta.significance,
        ))

    for alert in active_alerts[:3]:
        items.append(EvidenceItem(
            category="alert",
            description=(
                f"CDS alert \"{alert.get('title', '')}\": "
                f"{alert.get('reasoning', 'no reasoning provided')}"
            ),
            source_rule=alert.get("rule_id"),
            significance="high" if _normalize_severity(
                alert.get("severity"),
            ) in ("critical", "high") else "moderate",
        ))

    open_gaps = [g for g in care_gaps if g.get("status") == "open"]
    for gap in open_gaps[:2]:
        days = gap.get("days_overdue", 0)
        overdue_text = f"{days} days overdue" if days and days > 0 else "upcoming"
        items.append(EvidenceItem(
            category="care_gap",
            description=(
                f"HEDIS {gap.get('hedis_measure', '')}: "
                f"{gap.get('measure_name', '')} is {overdue_text}."
            ),
            significance="moderate" if not days or days <= 30 else "high",
        ))

    return items[:8]


def _build_chronic_context(
    flags: dict[str, Any],
    conditions: list[dict[str, Any]],
    medications: list[dict[str, Any]],
) -> list[ChronicContextFactor]:
    """
    Explain how the patient's chronic conditions and medications modify
    the clinical interpretation of their vitals.  Each factor maps
    directly to a Patient 360 flag.
    """
    factors: list[ChronicContextFactor] = []

    if flags.get("has_beta_blocker"):
        med_name = _find_medication_display(medications, "atenolol")
        factors.append(ChronicContextFactor(
            factor=f"Beta-blocker therapy ({med_name})" if med_name else "Beta-blocker therapy",
            clinical_impact=(
                "Lowers expected resting heart rate to 55-75 bpm. A heart rate "
                "above 90 bpm despite beta-blockade suggests medication failure, "
                "possible hypoglycemia, infection, or cardiac event."
            ),
            relevant_vitals=["heart_rate"],
            source_flag="has_beta_blocker",
        ))

    if flags.get("has_ckd"):
        factors.append(ChronicContextFactor(
            factor="Chronic Kidney Disease (Stage 3)",
            clinical_impact=(
                "CKD lowers baseline SpO2 by ~2% and shifts respiratory "
                "compensation. Elevated respiratory rate in CKD may indicate "
                "metabolic acidosis (Kussmaul breathing) rather than primary "
                "respiratory pathology."
            ),
            relevant_vitals=["spo2", "respiratory_rate"],
            source_flag="has_ckd",
        ))

    if flags.get("has_insulin"):
        factors.append(ChronicContextFactor(
            factor="Insulin therapy (basal insulin)",
            clinical_impact=(
                "Insulin use in elderly patients raises concern for "
                "hypoglycemic episodes. Sudden HR spike (+20-30 bpm), "
                "decreased activity, and temperature drop together suggest "
                "a hypoglycemic event."
            ),
            relevant_vitals=["heart_rate", "activity_level", "temperature"],
            source_flag="has_insulin",
        ))

    if flags.get("has_ace_inhibitor"):
        med_name = _find_medication_display(medications, "lisinopril")
        factors.append(ChronicContextFactor(
            factor=f"ACE inhibitor ({med_name})" if med_name else "ACE inhibitor",
            clinical_impact=(
                "ACE inhibitors are renoprotective in CKD but can cause "
                "hyperkalemia and acute kidney injury. Monitor for worsening "
                "renal function in conjunction with vitals changes."
            ),
            relevant_vitals=["heart_rate"],
            source_flag="has_ace_inhibitor",
        ))

    condition_codes = set(flags.get("condition_codes", []))
    if "44054006" in condition_codes:
        factors.append(ChronicContextFactor(
            factor="Type 2 Diabetes Mellitus",
            clinical_impact=(
                "T2DM increases infection risk and impairs wound healing. "
                "Temperature and respiratory changes carry higher clinical "
                "significance for sepsis screening."
            ),
            relevant_vitals=["temperature", "respiratory_rate", "heart_rate"],
            source_flag="condition_codes",
        ))

    return factors


def _build_care_gap_context(
    care_gaps: list[dict[str, Any]],
    flags: dict[str, Any],
    vitals_summary: dict[str, Any],
) -> list[CareGapContext]:
    """
    For each open care gap, explain why it matters for this specific
    patient based on their flags and current vitals trends.
    """
    results: list[CareGapContext] = []

    trend_24h = vitals_summary.get("trend_24h", {})

    for gap in care_gaps:
        if gap.get("status") != "open":
            continue

        measure = gap.get("hedis_measure", "")
        measure_name = gap.get("measure_name", "")
        days_overdue = gap.get("days_overdue", 0)

        priority_reason, wearable_correlation = _care_gap_reasoning(
            measure, flags, trend_24h, days_overdue,
        )

        results.append(CareGapContext(
            hedis_measure=measure,
            measure_name=measure_name,
            status=gap.get("status", "open"),
            days_overdue=days_overdue or 0,
            priority_reason=priority_reason,
            wearable_correlation=wearable_correlation,
        ))

    return results


def _care_gap_reasoning(
    measure: str,
    flags: dict[str, Any],
    trend_24h: dict[str, str],
    days_overdue: int,
) -> tuple[str, Optional[str]]:
    """Map each HEDIS measure to a patient-specific priority reason."""
    overdue_prefix = (
        f"{days_overdue} days overdue. " if days_overdue and days_overdue > 0 else ""
    )
    has_ckd = flags.get("has_ckd", False)
    has_insulin = flags.get("has_insulin", False)
    has_bb = flags.get("has_beta_blocker", False)

    if measure == "CDC-HBA":
        reason = (
            f"{overdue_prefix}HbA1c testing is critical for glycemic control assessment "
            "in this diabetic patient."
        )
        wearable = None
        if (
            trend_24h.get("heart_rate") == "increasing"
            or trend_24h.get("activity_level") == "decreasing"
        ):
            wearable = (
                "Wearable data shows HR trending up or activity declining, "
                "patterns consistent with poor glycemic control. "
                "This strengthens the urgency of HbA1c re-testing."
            )
        return reason, wearable

    if measure == "KED":
        reason = (
            f"{overdue_prefix}Annual kidney evaluation (eGFR + uACR) is especially "
            "important because this patient has CKD."
            if has_ckd else
            f"{overdue_prefix}Annual kidney evaluation is standard for diabetic patients."
        )
        wearable = None
        if trend_24h.get("respiratory_rate") == "increasing" and has_ckd:
            wearable = (
                "Rising respiratory rate in a CKD patient may indicate worsening "
                "metabolic acidosis, making kidney function re-evaluation urgent."
            )
        return reason, wearable

    if measure == "CBP":
        reason = (
            f"{overdue_prefix}Blood pressure control target (<140/90) verification "
            "is essential for this patient with both diabetes and hypertension."
        )
        wearable = None
        if has_bb and trend_24h.get("heart_rate") == "increasing":
            wearable = (
                "Heart rate is trending up despite beta-blocker therapy, which may "
                "correlate with suboptimal blood pressure control."
            )
        return reason, wearable

    if measure == "SPD":
        reason = (
            f"{overdue_prefix}Statin therapy review is recommended for diabetic "
            "patients aged 40-75 to reduce cardiovascular risk."
        )
        return reason, None

    if measure == "EED":
        reason = (
            f"{overdue_prefix}Annual retinal exam screens for diabetic retinopathy, "
            "which accelerates with poor glycemic control."
        )
        wearable = None
        if has_insulin:
            wearable = (
                "This patient is on insulin, indicating advanced diabetes management "
                "that makes retinal screening more urgent."
            )
        return reason, wearable

    return (
        f"{overdue_prefix}Scheduled follow-up to close this HEDIS measure gap.",
        None,
    )


def _build_trajectory_assessment(
    snapshots: list[LongitudinalSnapshot],
) -> Optional[TrajectoryAssessment]:
    """
    Assess overall clinical trajectory across all snapshots.
    Uses trend_vs_previous markers and risk score progression.
    """
    if len(snapshots) < 2:
        return None

    trends = [s.trend_vs_previous for s in snapshots]
    risk_scores = [s.risk_score for s in snapshots]
    worsening_count = trends.count("worsening")
    improving_count = trends.count("improving")

    first_risk = risk_scores[0]
    last_risk = risk_scores[-1]
    risk_delta = last_risk - first_risk

    if worsening_count >= 3 or risk_delta > 30:
        direction = "deteriorating"
    elif improving_count >= 3 or risk_delta < -20:
        direction = "improving"
    elif worsening_count > improving_count:
        direction = "deteriorating"
    elif improving_count > worsening_count:
        direction = "improving"
    elif abs(risk_delta) <= 5:
        direction = "stable"
    else:
        direction = "fluctuating"

    consistent_signals = worsening_count >= 3 or improving_count >= 3
    strong_risk_change = abs(risk_delta) > 20
    if consistent_signals and strong_risk_change:
        confidence = "high"
    elif consistent_signals or strong_risk_change:
        confidence = "moderate"
    else:
        confidence = "low"

    transitions: list[str] = []
    for i in range(1, len(snapshots)):
        prev_trend = trends[i - 1] if i > 1 else "stable"
        curr_trend = trends[i]
        if prev_trend != curr_trend and curr_trend != "stable":
            transitions.append(
                f"{snapshots[i].label}: shifted to {curr_trend} "
                f"(risk {risk_scores[i-1]} → {risk_scores[i]})"
            )

    summary_parts = [
        f"Over the observation period, the patient's clinical trajectory is "
        f"{direction} with {confidence} confidence.",
        f"Risk score moved from {first_risk} to {last_risk} "
        f"({'+' if risk_delta >= 0 else ''}{risk_delta} points).",
    ]
    if worsening_count > 0:
        summary_parts.append(
            f"{worsening_count} of {len(trends)} periods showed worsening."
        )

    return TrajectoryAssessment(
        direction=direction,
        confidence=confidence,
        summary=" ".join(summary_parts),
        key_transitions=transitions[:3],
    )


def _build_workflow_recommendation(
    current_status: WorkbenchStatus,
    threshold_breaches: list[ThresholdBreachStatus],
    active_alerts: list[dict[str, Any]],
    open_gap_count: int,
) -> str:
    """
    Single care pathway directive based on the patient's current
    escalation level.  Maps directly to status tone.
    """
    breach_count = sum(1 for b in threshold_breaches if b.breached)
    critical_count = sum(
        1 for a in active_alerts
        if _normalize_severity(a.get("severity")) == "critical"
    )

    if current_status.tone == "critical":
        return (
            "Initiate immediate clinical review. Activate rapid response "
            "protocol if available. Verify medication compliance, assess "
            "for acute infection or cardiac event, and prepare for possible "
            "transfer to higher-acuity care."
        )

    if current_status.tone == "high":
        actions = ["Schedule urgent clinician review within 2-4 hours."]
        if breach_count > 0:
            actions.append(
                "Re-check breached vitals manually to confirm wearable readings."
            )
        if open_gap_count > 0:
            actions.append(
                f"Address {open_gap_count} open care gap(s) during the review."
            )
        return " ".join(actions)

    if current_status.tone == "moderate":
        return (
            "Continue monitoring with increased frequency. Review care gaps "
            "and schedule follow-up assessments within 24-48 hours to prevent "
            "drift toward escalation."
        )

    return (
        "Maintain routine monitoring cadence. No immediate intervention "
        "required. Next standard review per care plan schedule."
    )


def _compute_confidence(
    current_snapshot: Optional[LongitudinalSnapshot],
    threshold_breaches: list[ThresholdBreachStatus],
    active_alerts: list[dict[str, Any]],
) -> str:
    """
    Confidence in the clinical interpretation, based on:
    - Data completeness (readings analyzed)
    - Signal consistency (multiple corroborating signals)
    - Alert confirmation (CDS rules fired)
    """
    signals = 0

    if current_snapshot and current_snapshot.readings_analyzed > 0:
        signals += 1
        if current_snapshot.readings_analyzed >= 50:
            signals += 1

    breach_count = sum(1 for b in threshold_breaches if b.breached)
    if breach_count >= 2:
        signals += 2
    elif breach_count == 1:
        signals += 1

    if active_alerts:
        signals += 1
        if any(
            _normalize_severity(a.get("severity")) in ("critical", "high")
            for a in active_alerts
        ):
            signals += 1

    if signals >= 4:
        return "high"
    if signals >= 2:
        return "moderate"
    return "low"


def _find_medication_display(
    medications: list[dict[str, Any]], keyword: str,
) -> Optional[str]:
    """Find a medication display name containing the keyword."""
    keyword_lower = keyword.lower()
    for med in medications:
        display = med.get("display", "")
        if keyword_lower in display.lower():
            return display
    return None
