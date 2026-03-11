"""
FastAPI router for the Synthetic Data Generator.

Responsibilities: HTTP only — parse requests, delegate to SyntheticService,
map service results to HTTP responses and status codes.
No business logic. No direct database access.

Prefix: /synthetic

Endpoints
---------
POST   /synthetic/patients/generate            Generate N patients → MongoDB
GET    /synthetic/patients                     List patients (summary, paginated)
GET    /synthetic/patients/{patient_id}        Full FHIR bundle for one patient
POST   /synthetic/vitals/{patient_id}/generate Generate vitals history → MongoDB
GET    /synthetic/vitals/{patient_id}          Query saved vitals readings
GET    /synthetic/status                       Collection size counts
DELETE /synthetic/reset                        Drop all generated data (dev only)
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from synthetic.models import (
    GeneratePatientsRequest,
    GeneratePatientsResponse,
    GenerateVitalsRequest,
    GenerateVitalsResponse,
    PatientSummary,
    StatusResponse,
)
from db.mdb import MongoDBConnector
from synthetic.repository import SyntheticRepository
from synthetic.service import SyntheticService


def get_synthetic_service() -> SyntheticService:
    """FastAPI dependency — constructs the full service + repo stack."""
    return SyntheticService(SyntheticRepository(MongoDBConnector()))

router = APIRouter(prefix="/synthetic", tags=["Synthetic Data Generator"])


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------

@router.post("/patients/generate", response_model=GeneratePatientsResponse, status_code=201)
async def generate_patients(
    body: GeneratePatientsRequest,
    svc: SyntheticService = Depends(get_synthetic_service),
) -> GeneratePatientsResponse:
    """
    Generate synthetic FHIR R4 patient bundles and persist them to MongoDB.

    - **count**: how many patients to create (1–500)
    - **hospital**: pin all patients to a specific source hospital (optional)
    - **seed**: random seed for reproducible generation (optional)
    """
    return svc.generate_patients(body)


@router.get("/patients", response_model=list[PatientSummary])
async def list_patients(
    hospital: Optional[str] = Query(default=None, description="Filter by source hospital key"),
    limit: int = Query(default=50, ge=1, le=500),
    skip: int  = Query(default=0, ge=0),
    svc: SyntheticService = Depends(get_synthetic_service),
) -> list[PatientSummary]:
    """
    Return a paginated list of generated patient summaries.
    Optionally filter by hospital: st_marys | regional_general | community_health.
    """
    return svc.list_patients(hospital=hospital, skip=skip, limit=limit)


@router.get("/patients/{patient_id}", response_model=dict)
async def get_patient(
    patient_id: str,
    svc: SyntheticService = Depends(get_synthetic_service),
) -> dict:
    """Retrieve the full FHIR Bundle for a single patient."""
    doc = svc.get_patient(patient_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id!r} not found.")
    return doc


# ---------------------------------------------------------------------------
# Vitals
# ---------------------------------------------------------------------------

@router.post("/vitals/{patient_id}/generate", response_model=GenerateVitalsResponse, status_code=201)
async def generate_vitals(
    patient_id: str,
    body: GenerateVitalsRequest,
    svc: SyntheticService = Depends(get_synthetic_service),
) -> GenerateVitalsResponse:
    """
    Simulate wearable-patch vitals for a patient and persist to MongoDB.

    - **pattern**: normal | deteriorating | acute
    - **hours**: length of history to generate (1–168)
    - **interval_minutes**: reading frequency in minutes (1–60)
    - **seed**: random seed for reproducibility (optional)
    """
    result = svc.generate_vitals(patient_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id!r} not found.")
    return result


@router.get("/vitals/{patient_id}", response_model=list[dict])
async def get_vitals(
    patient_id: str,
    limit: int = Query(
        default=288, ge=1, le=5000,
        description="Max readings to return (default = 24 h at 5-min intervals)",
    ),
    start_iso: Optional[str] = Query(default=None, description="Start datetime ISO-8601"),
    end_iso: Optional[str]   = Query(default=None, description="End datetime ISO-8601"),
    pattern: Optional[str]   = Query(default=None, description="normal | deteriorating | acute"),
    svc: SyntheticService = Depends(get_synthetic_service),
) -> list[dict[str, Any]]:
    """Retrieve saved vitals readings for a patient, ordered oldest → newest."""
    return svc.get_vitals(
        patient_id=patient_id,
        limit=limit,
        start_iso=start_iso,
        end_iso=end_iso,
        pattern=pattern,
    )


# ---------------------------------------------------------------------------
# Status / admin
# ---------------------------------------------------------------------------

@router.get("/status", response_model=StatusResponse)
async def get_status(
    svc: SyntheticService = Depends(get_synthetic_service),
) -> StatusResponse:
    """Return document counts for each synthetic data collection."""
    return svc.get_status()


@router.delete("/reset", status_code=200)
async def reset_data(
    confirm: bool = Query(default=False),
    svc: SyntheticService = Depends(get_synthetic_service),
) -> dict:
    """
    **DEV ONLY** — drop all synthetic patients and vitals from MongoDB.
    Pass `?confirm=true` to prevent accidental deletion.
    """
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Pass ?confirm=true to confirm deletion of all synthetic data.",
        )
    return svc.reset_data()
