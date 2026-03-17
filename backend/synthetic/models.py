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
    ST_MARYS = "st_marys"                    # Epic, FHIR R4
    REGIONAL_GENERAL = "regional_general"    # Cerner, FHIR R4 variants
    COMMUNITY_HEALTH = "community_health"    # Legacy, HL7v2 (normalised to FHIR)


class ProfileType(str, Enum):
    """
    Patient profile type controlling demographics, conditions, and medications.

    target    — Maria: 72-year-old female, T2DM + CKD3 + HTN + neuropathy,
                on beta-blocker + insulin + metformin + ACE inhibitor.
                Primary demo patient for CDS alerts and the context-matters story.

    healthy   — James: 25–40-year-old male, no chronic conditions,
                recovering from minor surgery, OTC pain relief only.
                Used for the side-by-side "same vitals, different response" demo.

    diabetic  — Background T2DM population (HEDIS HbA1c care gap cohort).
                Age 45–75, T2DM + optional hypertension.

    cardiac   — Background CHF/COPD population (secondary chronic cohort).
                Age 55–80, CHF or COPD with standard medications.

    mixed     — Randomly selects one of the above per patient using the
                population weights defined in profiles.md (60/20/10/10).
    """
    TARGET   = "target"
    HEALTHY  = "healthy"
    DIABETIC = "diabetic"
    CARDIAC  = "cardiac"
    MIXED    = "mixed"


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class GeneratePatientsRequest(BaseModel):
    count: int = Field(default=10, ge=1, le=500, description="Number of patients to generate")
    hospital: Optional[SourceHospital] = Field(
        default=None,
        description="Assign all patients to a specific hospital (random if omitted)",
    )
    profile_type: ProfileType = Field(
        default=ProfileType.TARGET,
        description=(
            "Patient profile type: target (Maria) | healthy (James) | "
            "diabetic | cardiac | mixed (population weights)"
        ),
    )
    seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")
    send_to_healthlake: bool = Field(
        default=False,
        description="Also POST each FHIR bundle to AWS HealthLake (requires HEALTHLAKE_DATASTORE_ID env var)",
    )


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
    profile_type: str
    conditions: list[str]
    medications: list[str]
    created_at: str


class GeneratePatientsResponse(BaseModel):
    generated: int
    patient_ids: list[str]
    healthlake_sent: int = 0
    healthlake_errors: list[str] = []


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
