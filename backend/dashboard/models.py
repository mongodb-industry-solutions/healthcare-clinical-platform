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
