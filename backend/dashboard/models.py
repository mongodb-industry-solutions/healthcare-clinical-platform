"""
Pydantic models for the Clinician Dashboard API.

Response models for the frontend-facing endpoints:
- Patient list with risk indicators
- Patient detail with threshold breach status
- Vitals time series with clinical context
- Patient search results
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Patient list
# ---------------------------------------------------------------------------

class PatientSummary(BaseModel):
    """Compact patient row for the population view."""
    patient_id: str
    mrn: str
    name: str
    age: int
    gender: str
    source_hospital: str
    hospital_name: str
    profile_type: str
    alert_count: int = 0
    max_severity: Optional[str] = None
    care_gap_count: int = 0
    latest_hr: Optional[float] = None
    latest_rr: Optional[float] = None
    latest_spo2: Optional[float] = None
    latest_temp: Optional[float] = None
    risk_score: int = 0


class PatientListResponse(BaseModel):
    """Paginated patient list for the population view."""
    total: int
    patients: list[PatientSummary]


# ---------------------------------------------------------------------------
# Patient detail
# ---------------------------------------------------------------------------

class ThresholdBreachStatus(BaseModel):
    """Whether a specific vital is currently breaching its threshold."""
    vital: str
    current_value: Optional[float] = None
    threshold: Optional[float] = None
    breached: bool = False
    direction: Optional[str] = Field(
        default=None, description="'above' or 'below' if breached",
    )


class PatientDetailResponse(BaseModel):
    """Enriched Patient 360 for the detail view."""
    patient: dict[str, Any]
    risk_score: int = 0
    time_since_last_alert: Optional[str] = None
    threshold_breaches: list[ThresholdBreachStatus] = []


class PatientFhirBundleResponse(BaseModel):
    """Raw FHIR bundle availability for a single patient."""
    patient_id: str
    available: bool = False
    bundle: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Vitals with context
# ---------------------------------------------------------------------------

class VitalsWithContextResponse(BaseModel):
    """Vitals time series plus personalized thresholds for chart rendering."""
    patient_id: str
    readings: list[dict[str, Any]]
    thresholds: dict[str, Any]
    total_readings: int
    hours: int


# ---------------------------------------------------------------------------
# Longitudinal trend analysis
# ---------------------------------------------------------------------------

class VitalStats(BaseModel):
    """Aggregated statistics for a single vital sign over a period."""
    avg: float
    min: float
    max: float
    std: float


class AlertFrequency(BaseModel):
    """Alert counts by severity for a period."""
    critical: int = 0
    high: int = 0
    moderate: int = 0
    low: int = 0


class LongitudinalSnapshot(BaseModel):
    """Clinical summary for a single period (historical or live-computed)."""
    period_key: str
    label: str
    reference_date: str
    vitals_summary: dict[str, VitalStats]
    risk_score: float
    alert_frequency: AlertFrequency
    trend_vs_previous: str
    conditions_active: int
    medications_active: int
    notes: str
    source: str = "historical"
    readings_analyzed: int = 0


class WorkbenchStatus(BaseModel):
    """Backend-derived clinical status for the workbench hero."""
    title: str
    tone: str
    description: str


class RecommendedAction(BaseModel):
    """Action item the care team should consider next."""
    title: str
    description: str
    source: Optional[str] = None


class BaselineVitalDelta(BaseModel):
    """How a single vital changed compared with the selected baseline."""
    vital: str
    label: str
    unit: str
    current_value: float
    baseline_value: float
    delta: float
    direction: str
    significance: str


class EvidenceItem(BaseModel):
    """A single piece of evidence supporting the clinical interpretation."""
    category: str = Field(
        description="threshold_breach | baseline_drift | alert | care_gap | trend",
    )
    description: str
    vital: Optional[str] = None
    source_rule: Optional[str] = None
    significance: str = "moderate"


class ChronicContextFactor(BaseModel):
    """How a chronic condition or medication modifies clinical interpretation."""
    factor: str
    clinical_impact: str
    relevant_vitals: list[str] = []
    source_flag: str


class CareGapContext(BaseModel):
    """Why a specific care gap matters for this patient right now."""
    hedis_measure: str
    measure_name: str
    status: str
    days_overdue: int = 0
    priority_reason: str
    wearable_correlation: Optional[str] = None


class TrajectoryAssessment(BaseModel):
    """Overall clinical trajectory over the observation period."""
    direction: str = Field(
        description="deteriorating | improving | stable | fluctuating",
    )
    confidence: str = Field(description="high | moderate | low")
    summary: str
    key_transitions: list[str] = []


class LongitudinalResponse(BaseModel):
    """Full longitudinal trend analysis for a patient."""
    patient_id: str
    patient_name: str
    profile_type: str
    current_thresholds: dict[str, Any]
    snapshots: list[LongitudinalSnapshot]
    selected_baseline_key: Optional[str] = None
    selected_baseline_label: Optional[str] = None
    baseline_risk_delta: Optional[float] = None
    baseline_alert_delta: Optional[int] = None
    current_status: Optional[WorkbenchStatus] = None
    threshold_breaches: list[ThresholdBreachStatus] = []
    top_risk_drivers: list[str] = []
    clinical_summary: Optional[str] = None
    baseline_vital_deltas: list[BaselineVitalDelta] = []
    recommended_actions: list[RecommendedAction] = []
    urgency_reason: Optional[str] = None
    evidence: list[EvidenceItem] = []
    chronic_context: list[ChronicContextFactor] = []
    care_gap_context: list[CareGapContext] = []
    trajectory_assessment: Optional[TrajectoryAssessment] = None
    workflow_recommendation: Optional[str] = None
    confidence: Optional[str] = None
    aggregation_ms: Optional[int] = None
    pipeline_display: Optional[str] = None


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class SearchResult(BaseModel):
    """A single search hit."""
    patient_id: str
    mrn: str
    name: str
    age: int
    gender: str
    source_hospital: str
    match_field: str
    match_value: str


class SearchResponse(BaseModel):
    """Search results wrapper."""
    query: str
    total: int
    results: list[SearchResult]
