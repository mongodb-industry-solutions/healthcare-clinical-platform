"""
Pydantic models for the Patient 360 Materializer API.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class MaterializeAllRequest(BaseModel):
    """Request body for the batch materialize-all endpoint."""
    profile_type: Optional[str] = Field(
        default=None,
        description="Only materialize patients of this profile type (optional)",
    )
    hospital: Optional[str] = Field(
        default=None,
        description="Only materialize patients from this hospital (optional)",
    )


# ---------------------------------------------------------------------------
# Sub-document models (match the Patient 360 schema)
# ---------------------------------------------------------------------------

class Demographics(BaseModel):
    name: str
    given: str
    family: str
    gender: str
    birth_date: str
    age: int


class ConditionEntry(BaseModel):
    code: str
    system: str = "http://snomed.info/sct"
    icd10: str = ""
    display: str
    clinical_status: str = "active"
    onset_date: Optional[str] = None


class MedicationEntry(BaseModel):
    code: str
    system: str = "http://www.nlm.nih.gov/research/umls/rxnorm"
    display: str
    dose: str = ""
    route: str = ""
    frequency: str = ""
    status: str = "active"


class AllergyEntry(BaseModel):
    code: str
    display: str
    reaction: str = ""
    severity: str = ""
    criticality: str = ""


class LabEntry(BaseModel):
    loinc: str
    display: str
    value: float
    unit: str
    ref_low: Optional[float] = None
    ref_high: Optional[float] = None
    interpretation: str = ""
    effective_date: Optional[str] = None


class EncounterEntry(BaseModel):
    status: str
    encounter_class: str = Field(alias="class", default="")
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    provider: str = ""

    model_config = {"populate_by_name": True}


class PatientFlags(BaseModel):
    has_beta_blocker: bool = False
    has_insulin: bool = False
    has_ace_inhibitor: bool = False
    has_ckd: bool = False
    condition_codes: list[str] = []


class ThresholdRange(BaseModel):
    low: Optional[float] = None
    high: Optional[float] = None
    source_rule: Optional[str] = None


class PersonalizedThresholds(BaseModel):
    heart_rate: ThresholdRange = ThresholdRange(low=50, high=100)
    respiratory_rate: ThresholdRange = ThresholdRange(low=10, high=20)
    temperature: ThresholdRange = ThresholdRange(low=36.0, high=38.0)
    spo2: ThresholdRange = ThresholdRange(low=92, high=100)
    activity_level: ThresholdRange = ThresholdRange()


class VitalSnapshot(BaseModel):
    timestamp: Optional[str] = None
    heart_rate: Optional[float] = None
    respiratory_rate: Optional[float] = None
    temperature: Optional[float] = None
    spo2: Optional[float] = None
    activity_level: Optional[float] = None


class TrendSnapshot(BaseModel):
    heart_rate: str = "stable"
    respiratory_rate: str = "stable"
    temperature: str = "stable"
    spo2: str = "stable"
    activity_level: str = "stable"


class VitalsSummary(BaseModel):
    latest: VitalSnapshot = VitalSnapshot()
    avg_4h: VitalSnapshot = VitalSnapshot()
    trend_24h: TrendSnapshot = TrendSnapshot()
    refreshed_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class MaterializeSingleResponse(BaseModel):
    patient_id: str
    status: str
    vitals_readings_used: int


class MaterializeAllResponse(BaseModel):
    total_patients: int
    materialized: int
    errors: list[str] = []
