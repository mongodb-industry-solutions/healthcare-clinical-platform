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


class CDSCard(BaseModel):
    """A single CDS Card returned to the EHR."""
    uuid: str
    summary: str
    detail: str = ""
    indicator: str = Field(description="One of: info, warning, critical")
    source: CDSSource
    suggestions: list[CDSSuggestion] = []
    links: list[CDSLink] = []


class CDSHooksResponse(BaseModel):
    """Response body for a CDS Hooks invocation — a list of cards."""
    cards: list[CDSCard] = []
