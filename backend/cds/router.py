"""
FastAPI router for the CDS & HEDIS Engine.

Responsibilities: HTTP only — parse requests, delegate to CDSService,
map service results to HTTP responses and status codes.
No business logic. No direct database access.

Prefix: /cds

Endpoints
---------
POST   /cds/rules/seed                          Seed (upsert) the 5 CDS rules
GET    /cds/rules                                List all CDS rules
POST   /cds/thresholds/{patient_id}              Compute personalized thresholds for one patient
POST   /cds/evaluate/{patient_id}                Evaluate CDS rules for one patient
POST   /cds/evaluate                             Batch-evaluate all patients
POST   /cds/care-gaps/{patient_id}               Compute HEDIS care gaps for one patient
POST   /cds/care-gaps                            Batch-compute care gaps for all patients
GET    /cds/alerts/{patient_id}                  Get alerts for a patient
GET    /cds/status                               Counts of rules and alerts
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from cds.models import (
    ComputeCareGapsRequest,
    ComputeCareGapsResponse,
    EvaluateAllRequest,
    EvaluateAllResponse,
    EvaluatePatientResponse,
    PatientAlertsResponse,
    SeedRulesResponse,
)
from cds.repository import CDSRepository
from cds.service import CDSService


def get_cds_service(request: Request) -> CDSService:
    """FastAPI dependency — uses the shared (possibly encrypted) DB connector."""
    return CDSService(CDSRepository(request.app.state.db))


router = APIRouter(prefix="/cds", tags=["CDS & HEDIS Engine"])


# ---------------------------------------------------------------------------
# Rules management
# ---------------------------------------------------------------------------

@router.post("/rules/seed", response_model=SeedRulesResponse, status_code=200)
async def seed_rules(
    svc: CDSService = Depends(get_cds_service),
) -> SeedRulesResponse:
    """Seed (upsert) the 5 CDS rules into the cds_rules collection."""
    return svc.seed_rules()


@router.get("/rules", response_model=list[dict[str, Any]])
async def list_rules(
    svc: CDSService = Depends(get_cds_service),
) -> list[dict[str, Any]]:
    """Return all CDS rules (enabled and disabled)."""
    return svc.list_rules()


# ---------------------------------------------------------------------------
# Personalized thresholds
# ---------------------------------------------------------------------------

@router.post("/thresholds/{patient_id}", response_model=dict[str, Any])
async def compute_thresholds(
    patient_id: str,
    svc: CDSService = Depends(get_cds_service),
) -> dict[str, Any]:
    """Compute and store personalized vital-sign thresholds for a patient."""
    result = svc.compute_thresholds(patient_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found. Has it been materialized?",
        )
    return result


# ---------------------------------------------------------------------------
# CDS evaluation
# ---------------------------------------------------------------------------

@router.post(
    "/evaluate/{patient_id}",
    response_model=EvaluatePatientResponse,
    status_code=200,
)
async def evaluate_patient(
    patient_id: str,
    svc: CDSService = Depends(get_cds_service),
) -> EvaluatePatientResponse:
    """Evaluate all enabled CDS rules against a single patient's latest vitals."""
    result = svc.evaluate_patient(patient_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found. Has it been materialized?",
        )
    return result


@router.post("/evaluate", response_model=EvaluateAllResponse, status_code=200)
async def evaluate_all(
    body: EvaluateAllRequest = EvaluateAllRequest(),
    svc: CDSService = Depends(get_cds_service),
) -> EvaluateAllResponse:
    """Batch-evaluate CDS rules for all materialized patients."""
    return svc.evaluate_all(
        hospital=body.hospital,
        profile_type=body.profile_type,
    )


# ---------------------------------------------------------------------------
# HEDIS Care Gaps
# ---------------------------------------------------------------------------

@router.post(
    "/care-gaps/{patient_id}",
    response_model=list[dict[str, Any]],
    status_code=200,
)
async def compute_care_gaps(
    patient_id: str,
    svc: CDSService = Depends(get_cds_service),
) -> list[dict[str, Any]]:
    """Compute HEDIS care gaps for a single patient."""
    result = svc.compute_care_gaps(patient_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found. Has it been materialized?",
        )
    return result


@router.post(
    "/care-gaps",
    response_model=ComputeCareGapsResponse,
    status_code=200,
)
async def compute_care_gaps_all(
    body: ComputeCareGapsRequest = ComputeCareGapsRequest(),
    svc: CDSService = Depends(get_cds_service),
) -> ComputeCareGapsResponse:
    """Batch-compute HEDIS care gaps for all materialized patients."""
    return svc.compute_care_gaps_all(
        hospital=body.hospital,
        profile_type=body.profile_type,
    )


# ---------------------------------------------------------------------------
# Alerts retrieval
# ---------------------------------------------------------------------------

@router.get(
    "/alerts/{patient_id}",
    response_model=PatientAlertsResponse,
    status_code=200,
)
async def get_patient_alerts(
    patient_id: str,
    status: Optional[str] = Query(default=None, description="Filter by alert status"),
    svc: CDSService = Depends(get_cds_service),
) -> PatientAlertsResponse:
    """Retrieve alerts for a patient."""
    alerts = svc.get_patient_alerts(patient_id, status=status)
    return PatientAlertsResponse(
        patient_id=patient_id,
        total=len(alerts),
        alerts=alerts,
    )


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@router.get("/status", response_model=dict[str, int])
async def get_status(
    svc: CDSService = Depends(get_cds_service),
) -> dict[str, int]:
    """Return counts of CDS rules and alerts."""
    return svc.get_status()
