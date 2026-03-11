"""
Pydantic models for the Synthetic Data Generator API.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class VitalsPattern(str, Enum):
    """Vitals simulation pattern type."""
    NORMAL = "normal"
    DETERIORATING = "deteriorating"
    ACUTE = "acute"


class SourceHospital(str, Enum):
    """Demo hospital sources as defined in the guidelines."""
    ST_MARYS = "st_marys"          # Epic, FHIR R4
    REGIONAL_GENERAL = "regional_general"  # Cerner, FHIR R4 variants
    COMMUNITY_HEALTH = "community_health"  # Legacy, HL7v2 (normalised to FHIR)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class GeneratePatientsRequest(BaseModel):
    count: int = Field(default=10, ge=1, le=500, description="Number of patients to generate")
    hospital: Optional[SourceHospital] = Field(
        default=None,
        description="Assign all patients to a specific hospital (random if omitted)",
    )
    seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")


class GenerateVitalsRequest(BaseModel):
    pattern: VitalsPattern = Field(
        default=VitalsPattern.NORMAL,
        description="Simulation pattern: normal | deteriorating | acute",
    )
    hours: int = Field(
        default=24,
        ge=1,
        le=168,
        description="Number of hours of history to generate",
    )
    interval_minutes: int = Field(
        default=5,
        ge=1,
        le=60,
        description="Sampling interval in minutes",
    )
    seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class PatientSummary(BaseModel):
    patient_id: str
    mrn: str
    name: str
    age: int
    gender: str
    source_hospital: str
    conditions: list[str]
    medications: list[str]
    created_at: str


class GeneratePatientsResponse(BaseModel):
    generated: int
    patient_ids: list[str]


class GenerateVitalsResponse(BaseModel):
    patient_id: str
    readings_written: int
    pattern: str
    start_time: str
    end_time: str


class VitalsReading(BaseModel):
    timestamp: str
    heart_rate: float
    respiratory_rate: float
    temperature: float
    spo2: float
    activity_level: float
    pattern: str


class StatusResponse(BaseModel):
    patients: int
    fhir_resources: int
    vitals_readings: int
