"""
FastAPI router for FHIR DEQM operations.

Exposes the $care-gaps operation that wraps the internal QualityEngine
and returns FHIR-shaped MeasureReport + DetectedIssue resources.

Prefix: /fhir
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from cds.repository import CDSRepository
from fhir.models import FHIRCareGapBundle
from fhir.service import FHIRService


def get_fhir_service(request: Request) -> FHIRService:
    return FHIRService(CDSRepository(request.app.state.db))


router = APIRouter(prefix="/fhir", tags=["FHIR DEQM"])


@router.get(
    "/Measure/$care-gaps",
    response_model=FHIRCareGapBundle,
)
async def care_gaps_operation(
    periodStart: str = Query(..., description="Measurement period start (YYYY-MM-DD)"),
    periodEnd: str = Query(..., description="Measurement period end (YYYY-MM-DD)"),
    subject: str = Query(..., description="Patient reference, e.g. Patient/{id}"),
    status: str = Query(
        default="open-gap",
        description="Gap status filter: open-gap | closed-gap | all",
    ),
    svc: FHIRService = Depends(get_fhir_service),
) -> FHIRCareGapBundle:
    """
    DEQM $care-gaps operation (Da Vinci Gaps in Care IG).

    Returns a FHIR Bundle containing MeasureReport and DetectedIssue
    resources for the requested patient and measurement period.
    """
    patient_id = subject.replace("Patient/", "").strip()
    if not patient_id:
        raise HTTPException(status_code=400, detail="subject parameter must be Patient/{id}")

    return svc.care_gaps_operation(
        patient_id=patient_id,
        period_start=periodStart,
        period_end=periodEnd,
        status_filter=status,
    )
