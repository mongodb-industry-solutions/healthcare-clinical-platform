"""
Pydantic models for the Attribution module (Da Vinci ATR-aligned).

Models the provider-patient treatment relationship used to determine
which providers are entitled to access care-gap results for a patient.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class Attribution(BaseModel):
    """A provider-patient treatment relationship."""
    attribution_id: str
    patient_id: str
    provider_id: str
    provider_name: str
    provider_role: str = "pcp"
    organization: str = ""
    relationship_type: str = "attributed"
    period_start: str = ""
    period_end: Optional[str] = None
    source: str = "roster"
    verified: bool = True


class SeedAttributionsResponse(BaseModel):
    total_patients: int
    attributions_created: int
    errors: list[str] = Field(default_factory=list)


class PatientAttributionsResponse(BaseModel):
    patient_id: str
    attributions: list[dict[str, Any]] = Field(default_factory=list)
    total: int = 0


class ProviderSummary(BaseModel):
    """One row in the dashboard's provider filter dropdown.

    Distinct providers across the attributions collection, with the size of
    each provider's attributed panel so the UI can show "Dr. Chen — 47 pts".
    """

    provider_id: str
    provider_name: str
    provider_role: str = "pcp"
    organization: str = ""
    patient_count: int = 0
