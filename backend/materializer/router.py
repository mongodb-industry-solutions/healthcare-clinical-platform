"""
FastAPI router for the Patient 360 Materializer.

Responsibilities: HTTP only — parse requests, delegate to MaterializerService,
map service results to HTTP responses and status codes.
No business logic. No direct database access.

Prefix: /materializer

Endpoints
---------
POST   /materializer/patients/materialize              Batch-materialize all (or filtered) patients
POST   /materializer/patients/{patient_id}/materialize  Materialize a single patient
GET    /materializer/patients                           List materialized Patient 360 docs
GET    /materializer/patients/{patient_id}              Get a single Patient 360 doc
GET    /materializer/status                             Count of materialized documents
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from db.mdb import MongoDBConnector
from materializer.models import (
    MaterializeAllRequest,
    MaterializeAllResponse,
    MaterializeSingleResponse,
)
from materializer.repository import MaterializerRepository
from materializer.service import MaterializerService


def get_materializer_service() -> MaterializerService:
    """FastAPI dependency — constructs the full service + repo stack."""
    return MaterializerService(MaterializerRepository(MongoDBConnector()))


router = APIRouter(prefix="/materializer", tags=["Patient 360 Materializer"])


# ---------------------------------------------------------------------------
# Materialize
# ---------------------------------------------------------------------------

@router.post(
    "/patients/materialize",
    response_model=MaterializeAllResponse,
    status_code=200,
)
async def materialize_all(
    body: MaterializeAllRequest = MaterializeAllRequest(),
    svc: MaterializerService = Depends(get_materializer_service),
) -> MaterializeAllResponse:
    """
    Batch-materialize Patient 360 documents for all synthetic patients
    (or a filtered subset by hospital / profile_type).
    """
    return svc.materialize_all(
        hospital=body.hospital,
        profile_type=body.profile_type,
    )


@router.post(
    "/patients/{patient_id}/materialize",
    response_model=MaterializeSingleResponse,
    status_code=200,
)
async def materialize_patient(
    patient_id: str,
    svc: MaterializerService = Depends(get_materializer_service),
) -> MaterializeSingleResponse:
    """Build or rebuild the Patient 360 document for a single patient."""
    result = svc.materialize_patient(patient_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient {patient_id!r} not found in synthetic_patients.",
        )
    return result


# ---------------------------------------------------------------------------
# Read materialized data
# ---------------------------------------------------------------------------

@router.get("/patients", response_model=list[dict[str, Any]])
async def list_patient_360(
    hospital: Optional[str] = Query(default=None, description="Filter by source hospital key"),
    profile_type: Optional[str] = Query(default=None, description="Filter by profile type"),
    sort_by: str = Query(
        default="alert_severity",
        description="Sort field: alert_severity, name, hospital",
    ),
    limit: int = Query(default=50, ge=1, le=500),
    skip: int = Query(default=0, ge=0),
    svc: MaterializerService = Depends(get_materializer_service),
) -> list[dict[str, Any]]:
    """Return paginated Patient 360 documents (read from patient_360 collection)."""
    return svc.list_patient_360(
        skip=skip, limit=limit, hospital=hospital,
        profile_type=profile_type, sort_by=sort_by,
    )


@router.get("/patients/{patient_id}", response_model=dict[str, Any])
async def get_patient_360(
    patient_id: str,
    svc: MaterializerService = Depends(get_materializer_service),
) -> dict[str, Any]:
    """Retrieve a single materialized Patient 360 document."""
    doc = svc.get_patient_360(patient_id)
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found. Has it been materialized?",
        )
    return doc


@router.get("/status", response_model=dict[str, int])
async def get_status(
    svc: MaterializerService = Depends(get_materializer_service),
) -> dict[str, int]:
    """Return the count of materialized Patient 360 documents."""
    return svc.get_status()
