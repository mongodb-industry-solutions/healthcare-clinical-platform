"""
Pydantic models for the DaVinci CDS Hooks API.

Implements the CDS Hooks specification:
- Discovery response (GET /cds-services)
- Hook request (POST /cds-services/patient-view)
- CDS Cards response
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

class CDSServiceDefinition(BaseModel):
    """A single CDS service entry returned by the discovery endpoint."""
    hook: str
    title: str
    description: str
    id: str
    prefetch: Optional[dict[str, str]] = None


class CDSDiscoveryResponse(BaseModel):
    """Response from GET /cds-services — lists all available hooks."""
    services: list[CDSServiceDefinition] = []


# ---------------------------------------------------------------------------
# Hook request (patient-view)
# ---------------------------------------------------------------------------

class PatientViewContext(BaseModel):
    """Context object for the patient-view hook."""
    userId: str = ""
    patientId: str


class CDSHooksRequest(BaseModel):
    """Incoming request body for a CDS Hooks invocation."""
    hookInstance: str
    hook: str = "patient-view"
    fhirServer: Optional[str] = None
    context: PatientViewContext
    prefetch: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# CDS Cards response
# ---------------------------------------------------------------------------

class CDSSource(BaseModel):
    """Source attribution for a CDS Card."""
    label: str
    url: Optional[str] = None
    icon: Optional[str] = None


class CDSSuggestion(BaseModel):
    """A suggested action within a CDS Card."""
    label: str
    uuid: str


class CDSLink(BaseModel):
    """An external link attached to a CDS Card."""
    label: str
    url: str
    type: str = "absolute"


class CDSVitalTrigger(BaseModel):
    """A vital sign that breached a personalized threshold."""
    vital: str
    value: float
    threshold: float
    direction: str  # "above" or "below"
    unit: str
    source_rule: Optional[str] = None


class CDSCardExtensions(BaseModel):
    """Platform-specific extensions attached to a CDS Card."""
    card_type: str  # "alert" or "care_gap"
    measure_code: Optional[str] = None
    rule_id: Optional[str] = None
    rule_name: Optional[str] = None
    days_overdue: Optional[int] = None
    priority: Optional[str] = None
    context_factors: list[str] = []
    vital_triggers: list[CDSVitalTrigger] = []
    escalation_reason: Optional[str] = None
    ranking_weight: int = 0


class CDSCard(BaseModel):
    """A single CDS Card returned to the EHR."""
    uuid: str
    summary: str
    detail: str = ""
    indicator: str = Field(description="One of: info, warning, critical")
    source: CDSSource
    suggestions: list[CDSSuggestion] = []
    links: list[CDSLink] = []
    extensions: Optional[CDSCardExtensions] = None


class CDSHooksResponse(BaseModel):
    """Response body for a CDS Hooks invocation — a list of cards."""
    cards: list[CDSCard] = []


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------

class CDSProvenanceResponse(BaseModel):
    """Full provenance for a single CDS Card — the card, its source rule, and
    the underlying alert or care-gap document from MongoDB."""
    card: CDSCard
    source_rule: Optional[dict] = None
    care_gap_document: Optional[dict] = None
    alert_document: Optional[dict] = None
    patient_context: dict = {}
    generated_at: str
    data_source: str = "MongoDB patient_360 + cds_rules + alerts collections"
