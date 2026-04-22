"""
FHIR DEQM models — Pydantic representations of MeasureReport,
DetectedIssue, and the $care-gaps Bundle response.

Simplified to match the Da Vinci Gaps in Care IG profile while
remaining practical for the demo.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class FHIRMeasureReport(BaseModel):
    """Individual MeasureReport for a single HEDIS measure."""
    resourceType: str = "MeasureReport"
    id: str = ""
    status: str = "complete"
    type: str = "individual"
    measure: str = ""
    subject: dict[str, str] = Field(default_factory=dict)
    date: str = ""
    period: dict[str, str] = Field(default_factory=dict)
    group: list[dict[str, Any]] = Field(default_factory=list)
    evaluatedResource: list[dict[str, str]] = Field(default_factory=list)


class FHIRDetectedIssue(BaseModel):
    """DetectedIssue representing an open care gap."""
    resourceType: str = "DetectedIssue"
    id: str = ""
    status: str = "preliminary"
    code: dict[str, Any] = Field(default_factory=dict)
    patient: dict[str, str] = Field(default_factory=dict)
    identifiedDateTime: str = ""
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    detail: str = ""


class FHIRCareGapBundle(BaseModel):
    """Bundle containing MeasureReport + DetectedIssue entries."""
    resourceType: str = "Bundle"
    id: str = ""
    type: str = "collection"
    total: int = 0
    entry: list[dict[str, Any]] = Field(default_factory=list)
