"""
Pydantic models for the Intervention Workflow domain.

Covers:
- Request / response DTOs for KED and CDC-HBA endpoints
- Result profile enums per measure
- Lab input sub-models
- Shared closure-evidence and follow-up DTOs
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class KedResultProfile(str, Enum):
    STABLE = "stable"
    ABNORMAL = "abnormal"
    CONCERNING = "concerning"


class KedWorkflowStatus(str, Enum):
    NOT_STARTED = "not_started"
    ORDERED = "ordered"
    COMPLETED = "completed"


# ---------------------------------------------------------------------------
# Lab sub-models
# ---------------------------------------------------------------------------

class KidneyLabInput(BaseModel):
    """A single kidney lab value provided by the caller."""
    value: float
    unit: str
    effective_date: Optional[datetime] = None


class KidneyLabSetInput(BaseModel):
    """Paired eGFR + uACR lab values."""
    egfr: KidneyLabInput
    uacr: KidneyLabInput


# ---------------------------------------------------------------------------
# Closure evidence & follow-up (embedded in care gap and workflow)
# ---------------------------------------------------------------------------

class ClosureEvidence(BaseModel):
    required: list[str] = Field(default_factory=lambda: ["eGFR", "uACR"])
    received: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=lambda: ["eGFR", "uACR"])
    closed_at: Optional[str] = None


class FollowUp(BaseModel):
    recommended: bool = False
    reason: Optional[str] = None
    status: str = "not_needed"


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class OrderKedLabsRequest(BaseModel):
    ordered_by: str = "demo_user"


class RecordKedResultsRequest(BaseModel):
    result_profile: KedResultProfile
    recorded_by: str = "demo_user"
    labs: Optional[KidneyLabSetInput] = None


class GenerateFollowUpSummaryRequest(BaseModel):
    requested_by: str = "demo_user"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class KedWorkflowStatusResponse(BaseModel):
    patient_id: str
    ked_gap_exists: bool = False
    ked_gap_open: bool = False
    workflow_status: str = "not_started"
    missing_evidence: list[str] = Field(default_factory=lambda: ["eGFR", "uACR"])
    latest_kidney_labs: list[dict[str, Any]] = Field(default_factory=list)
    follow_up_recommended: bool = False
    follow_up_reason: Optional[str] = None
    follow_up_summary: Optional[dict[str, Any]] = None


class OrderKedLabsResponse(BaseModel):
    patient_id: str
    workflow_status: str = "ordered"
    ordered_at: str
    required_evidence: list[str] = Field(default_factory=lambda: ["eGFR", "uACR"])


class RecordKedResultsResponse(BaseModel):
    patient_id: str
    workflow_status: str = "completed"
    ked_gap_status: str
    follow_up_recommended: bool = False
    follow_up_reason: Optional[str] = None
    labs_written: list[dict[str, Any]] = Field(default_factory=list)


class GenerateFollowUpSummaryResponse(BaseModel):
    title: str
    summary: str
    recommendations: list[str] = Field(default_factory=list)
    based_on: dict[str, Any] = Field(default_factory=dict)


# ===================================================================
# CDC-HBA (Hemoglobin A1c) Intervention Workflow
# ===================================================================

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class CdcHbaResultProfile(str, Enum):
    CONTROLLED = "controlled"
    ELEVATED = "elevated"
    CONCERNING = "concerning"


# ---------------------------------------------------------------------------
# Lab sub-models
# ---------------------------------------------------------------------------

class Hba1cLabInput(BaseModel):
    """A single HbA1c lab value provided by the caller."""
    value: float
    unit: str = "%"
    effective_date: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class OrderCdcHbaTestRequest(BaseModel):
    ordered_by: str = "demo_user"


class RecordCdcHbaResultsRequest(BaseModel):
    result_profile: CdcHbaResultProfile
    recorded_by: str = "demo_user"
    lab: Optional[Hba1cLabInput] = None


class GenerateCdcHbaFollowUpSummaryRequest(BaseModel):
    requested_by: str = "demo_user"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class CdcHbaWorkflowStatusResponse(BaseModel):
    patient_id: str
    cdc_hba_gap_exists: bool = False
    cdc_hba_gap_open: bool = False
    workflow_status: str = "not_started"
    missing_evidence: list[str] = Field(default_factory=lambda: ["HbA1c"])
    latest_hba1c_lab: Optional[dict[str, Any]] = None
    follow_up_recommended: bool = False
    follow_up_reason: Optional[str] = None
    follow_up_summary: Optional[dict[str, Any]] = None


class OrderCdcHbaTestResponse(BaseModel):
    patient_id: str
    workflow_status: str = "ordered"
    ordered_at: str
    required_evidence: list[str] = Field(default_factory=lambda: ["HbA1c"])


class RecordCdcHbaResultsResponse(BaseModel):
    patient_id: str
    workflow_status: str = "completed"
    cdc_hba_gap_status: str
    follow_up_recommended: bool = False
    follow_up_reason: Optional[str] = None
    lab_written: Optional[dict[str, Any]] = None


class GenerateCdcHbaFollowUpSummaryResponse(BaseModel):
    title: str
    summary: str
    recommendations: list[str] = Field(default_factory=list)
    based_on: dict[str, Any] = Field(default_factory=dict)
