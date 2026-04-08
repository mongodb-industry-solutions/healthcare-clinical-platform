"""
FastAPI router for KED Intervention Workflow.

Responsibilities: HTTP only — parse requests, delegate to InterventionService,
map service results to HTTP responses and status codes.
No business logic. No direct database access.

Prefix: /interventions

Endpoints
---------
GET    /interventions/ked/{patient_id}                  Get KED workflow state
POST   /interventions/ked/{patient_id}/order             Order kidney evaluation labs
POST   /interventions/ked/{patient_id}/results           Record kidney lab results
POST   /interventions/ked/{patient_id}/follow-up-summary Generate follow-up summary
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from interventions.models import (
    GenerateFollowUpSummaryRequest,
    GenerateFollowUpSummaryResponse,
    KedWorkflowStatusResponse,
    OrderKedLabsRequest,
    OrderKedLabsResponse,
    RecordKedResultsRequest,
    RecordKedResultsResponse,
)
from interventions.repository import InterventionRepository
from interventions.service import InterventionService
from cds.repository import CDSRepository
from cds.service import CDSService
from db.mdb import MongoDBConnector


def get_intervention_service() -> InterventionService:
    """FastAPI dependency — constructs the full service + repo stack."""
    db = MongoDBConnector()
    return InterventionService(
        repo=InterventionRepository(db),
        cds_service=CDSService(CDSRepository(db)),
    )


router = APIRouter(prefix="/interventions", tags=["Interventions"])


# ---------------------------------------------------------------------------
# KED workflow state
# ---------------------------------------------------------------------------

@router.get(
    "/ked/{patient_id}",
    response_model=KedWorkflowStatusResponse,
    status_code=200,
)
async def get_ked_workflow(
    patient_id: str,
    svc: InterventionService = Depends(get_intervention_service),
) -> KedWorkflowStatusResponse:
    """Return the current KED workflow status for a patient."""
    result = svc.get_ked_workflow(patient_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found.",
        )
    return result


# ---------------------------------------------------------------------------
# Order labs
# ---------------------------------------------------------------------------

@router.post(
    "/ked/{patient_id}/order",
    response_model=OrderKedLabsResponse,
    status_code=200,
)
async def order_ked_labs(
    patient_id: str,
    body: OrderKedLabsRequest = OrderKedLabsRequest(),
    svc: InterventionService = Depends(get_intervention_service),
) -> OrderKedLabsResponse:
    """Mark KED workflow as ordered — kidney evaluation labs pending."""
    result = svc.order_ked_labs(patient_id, body.ordered_by)
    if result is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot order KED labs for {patient_id!r}. "
                "Patient not found or KED gap is not open."
            ),
        )
    return result


# ---------------------------------------------------------------------------
# Record results
# ---------------------------------------------------------------------------

@router.post(
    "/ked/{patient_id}/results",
    response_model=RecordKedResultsResponse,
    status_code=200,
)
async def record_ked_results(
    patient_id: str,
    body: RecordKedResultsRequest,
    svc: InterventionService = Depends(get_intervention_service),
) -> RecordKedResultsResponse:
    """Ingest simulated kidney lab results and recompute KED gap."""
    result = svc.record_ked_results(patient_id, body)
    if result is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot record results for {patient_id!r}. "
                "Patient not found or workflow is not in an orderable state."
            ),
        )
    return result


# ---------------------------------------------------------------------------
# Follow-up summary
# ---------------------------------------------------------------------------

@router.post(
    "/ked/{patient_id}/follow-up-summary",
    response_model=GenerateFollowUpSummaryResponse,
    status_code=200,
)
async def generate_follow_up_summary(
    patient_id: str,
    body: GenerateFollowUpSummaryRequest = GenerateFollowUpSummaryRequest(),
    svc: InterventionService = Depends(get_intervention_service),
) -> GenerateFollowUpSummaryResponse:
    """Generate a deterministic clinician review summary after abnormal results."""
    result = svc.generate_ked_follow_up_summary(patient_id, body.requested_by)
    if result is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot generate follow-up summary for {patient_id!r}. "
                "Patient not found or follow-up is not recommended."
            ),
        )
    return result
