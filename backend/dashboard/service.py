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

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from dashboard.models import (
    PatientDetailResponse,
    PatientListResponse,
    PatientSummary,
    SearchResponse,
    SearchResult,
    ThresholdBreachStatus,
    VitalsWithContextResponse,
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
