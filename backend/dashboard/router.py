"""
FastAPI router for the Clinician Dashboard API.

Frontend-facing endpoints for the Next.js dashboard (Phase E):
- GET  /dashboard/patients                     — Patient list with risk indicators
- GET  /dashboard/patients/{patient_id}        — Patient detail with breach status
- GET  /dashboard/patients/{patient_id}/vitals — Vitals time series with thresholds
- GET  /dashboard/search                       — Search patients by name/MRN/condition

No business logic. No direct database access.

Prefix: /dashboard
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from dashboard.models import (
    LongitudinalResponse,
    PatientDetailResponse,
    PatientFhirBundleResponse,
    PatientListResponse,
    SearchResponse,
    VitalsWithContextResponse,
)
from dashboard.repository import DashboardRepository
from dashboard.service import DashboardService


def get_dashboard_service(request: Request) -> DashboardService:
    """FastAPI dependency — uses the shared (possibly encrypted) DB connector."""
    return DashboardService(DashboardRepository(request.app.state.db))


router = APIRouter(prefix="/dashboard", tags=["Clinician Dashboard"])


# ---------------------------------------------------------------------------
# Patient list (population view)
# ---------------------------------------------------------------------------

@router.get("/patients", response_model=PatientListResponse)
async def list_patients(
    hospital: Optional[str] = Query(default=None, description="Filter by source hospital key"),
    profile_type: Optional[str] = Query(default=None, description="Filter by profile type"),
    sort_by: str = Query(
        default="alert_severity",
        description="Sort field: alert_severity, name, hospital",
    ),
    limit: int = Query(default=50, ge=1, le=500),
    skip: int = Query(default=0, ge=0),
    svc: DashboardService = Depends(get_dashboard_service),
) -> PatientListResponse:
    """
    Return a paginated patient list with risk indicators.

    Each patient includes: alert count, max severity, open care gap count,
    latest vitals snapshot, and a composite risk score (0-10).
    Patients are sorted by risk score (highest first) within the
    requested sort order.
    """
    return svc.list_patients(
        skip=skip, limit=limit, hospital=hospital,
        profile_type=profile_type, sort_by=sort_by,
    )


# ---------------------------------------------------------------------------
# Patient detail
# ---------------------------------------------------------------------------

@router.get(
    "/patients/{patient_id}",
    response_model=PatientDetailResponse,
)
async def get_patient_detail(
    patient_id: str,
    svc: DashboardService = Depends(get_dashboard_service),
) -> PatientDetailResponse:
    """
    Return enriched Patient 360 for the detail view.

    Includes the full Patient 360 document plus computed fields:
    risk score, time since last alert, and per-vital threshold
    breach status.
    """
    result = svc.get_patient_detail(patient_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found.",
        )
    return result


@router.get(
    "/patients/{patient_id}/fhir-bundle",
    response_model=PatientFhirBundleResponse,
)
async def get_patient_fhir_bundle(
    patient_id: str,
    svc: DashboardService = Depends(get_dashboard_service),
) -> PatientFhirBundleResponse:
    """
    Return raw FHIR bundle data for the insights modal on demand.
    """
    result = svc.get_patient_fhir_bundle(patient_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found.",
        )
    return result


# ---------------------------------------------------------------------------
# Vitals with clinical context
# ---------------------------------------------------------------------------

@router.get(
    "/patients/{patient_id}/vitals",
    response_model=VitalsWithContextResponse,
)
async def get_vitals_with_context(
    patient_id: str,
    hours: int = Query(default=24, ge=1, le=168, description="Hours of history to return"),
    svc: DashboardService = Depends(get_dashboard_service),
) -> VitalsWithContextResponse:
    """
    Return vitals time series with personalized thresholds.

    The response includes the raw vitals array plus the patient's
    personalized thresholds, so the frontend can render threshold
    lines on charts.
    """
    result = svc.get_vitals_with_context(patient_id, hours=hours)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found.",
        )
    return result


# ---------------------------------------------------------------------------
# Longitudinal trend analysis
# ---------------------------------------------------------------------------

@router.get(
    "/patients/{patient_id}/longitudinal",
    response_model=LongitudinalResponse,
)
async def get_longitudinal(
    patient_id: str,
    baseline_period_key: Optional[str] = Query(
        default=None,
        description="Selected baseline period key, e.g. 1_week, 1_month, 3_months, 6_months",
    ),
    svc: DashboardService = Depends(get_dashboard_service),
) -> LongitudinalResponse:
    """
    Return longitudinal trend snapshots for a patient.

    Each snapshot represents a historical period (6 months, 3 months,
    1 month, 1 week, current) with aggregated vitals, risk scores,
    and alert frequencies.
    """
    result = svc.get_longitudinal(patient_id, baseline_period_key=baseline_period_key)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Longitudinal data for {patient_id!r} not found.",
        )
    return result


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@router.get("/search", response_model=SearchResponse)
async def search_patients(
    q: str = Query(description="Search term (name, MRN, or condition)"),
    limit: int = Query(default=20, ge=1, le=100),
    svc: DashboardService = Depends(get_dashboard_service),
) -> SearchResponse:
    """
    Search patients by name, MRN, or condition display text.

    Uses case-insensitive matching across patient_360 documents.
    """
    return svc.search_patients(q, limit=limit)
