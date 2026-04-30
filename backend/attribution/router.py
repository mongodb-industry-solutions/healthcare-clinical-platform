"""
FastAPI router for the Attribution module (Da Vinci ATR-aligned).

Prefix: /attribution
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from attribution.models import (
    PatientAttributionsResponse,
    ProviderSummary,
    SeedAttributionsResponse,
)
from attribution.repository import AttributionRepository
from attribution.service import AttributionService


def get_attribution_service(request: Request) -> AttributionService:
    return AttributionService(AttributionRepository(request.app.state.db))


router = APIRouter(prefix="/attribution", tags=["Provider Attribution (ATR)"])


@router.post("/seed", response_model=SeedAttributionsResponse)
async def seed_attributions(
    svc: AttributionService = Depends(get_attribution_service),
) -> SeedAttributionsResponse:
    """Seed provider-patient attributions for all materialized patients."""
    return svc.seed_attributions()


@router.get("/patient/{patient_id}", response_model=PatientAttributionsResponse)
async def get_patient_attributions(
    patient_id: str,
    svc: AttributionService = Depends(get_attribution_service),
) -> PatientAttributionsResponse:
    """Return all provider attributions for a patient."""
    return svc.get_patient_attributions(patient_id)


@router.get("/status", response_model=dict[str, int])
async def get_status(
    svc: AttributionService = Depends(get_attribution_service),
) -> dict[str, int]:
    return svc.get_status()


@router.get("/providers", response_model=list[ProviderSummary])
async def list_providers(
    svc: AttributionService = Depends(get_attribution_service),
) -> list[ProviderSummary]:
    """Distinct providers (with panel size) for the dashboard filter dropdown."""
    return svc.list_providers()
