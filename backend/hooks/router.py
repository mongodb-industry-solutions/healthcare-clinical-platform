"""
FastAPI router for DaVinci CDS Hooks.

Implements the CDS Hooks specification endpoints:
- GET  /hooks/cds-services               — Discovery: list available hooks
- POST /hooks/cds-services/patient-view   — patient-view hook invocation

No business logic. No direct database access.

Prefix: /hooks
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from db.mdb import MongoDBConnector
from hooks.models import CDSDiscoveryResponse, CDSHooksRequest, CDSHooksResponse
from hooks.repository import HooksRepository
from hooks.service import HooksService


def get_hooks_service() -> HooksService:
    """FastAPI dependency — constructs the full service + repo stack."""
    return HooksService(HooksRepository(MongoDBConnector()))


router = APIRouter(prefix="/hooks", tags=["CDS Hooks (DaVinci)"])


@router.get("/cds-services", response_model=CDSDiscoveryResponse)
async def discovery(
    svc: HooksService = Depends(get_hooks_service),
) -> CDSDiscoveryResponse:
    """CDS Hooks discovery — returns the list of available CDS services."""
    return svc.get_discovery()


@router.post(
    "/cds-services/patient-view",
    response_model=CDSHooksResponse,
    status_code=200,
)
async def patient_view(
    body: CDSHooksRequest,
    svc: HooksService = Depends(get_hooks_service),
) -> CDSHooksResponse:
    """
    CDS Hooks patient-view invocation.

    Called by an EHR when a clinician opens a patient chart.
    Returns CDS Cards with active alerts and open care gaps.
    """
    patient_id = body.context.patientId
    return svc.evaluate_patient_view(patient_id)
