"""
Pydantic models for the CDS & HEDIS Engine.

Covers:
- CDS rule definitions (the rules stored in cds_rules collection)
- Alert documents (output of the real-time evaluator)
- HEDIS care gap entries
- Request/response models for the router
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class AlertSeverity(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"


class AlertStatus(str, Enum):
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class AlertType(str, Enum):
    THRESHOLD_BREACH = "threshold_breach"
    MULTI_FACTOR = "multi_factor"
    TREND_BASED = "trend_based"
    COMPARATIVE = "comparative"


class CareGapStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"


class CareGapPriority(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"


# ---------------------------------------------------------------------------
# CDS Rule sub-documents
# ---------------------------------------------------------------------------

class RuleApplicability(BaseModel):
    """Conditions under which a CDS rule is applicable to a patient."""
    conditions: list[str] = []
    medications: list[str] = []
    flags: list[str] = []
    min_age: Optional[int] = None
    max_age: Optional[int] = None
    profile_types: Optional[list[str]] = None


class RuleTrigger(BaseModel):
    """What event/measurement triggers the rule evaluation."""
    vital: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    use_personalized_threshold: bool = False
    sustained_minutes: Optional[int] = None


class RuleAlertTemplate(BaseModel):
    """Template used to generate alert documents when a rule fires."""
    title: str
    severity: AlertSeverity
    alert_type: AlertType
    reasoning: str
    suggested_actions: list[str] = []
    hedis_measure: Optional[str] = None
    davinci_profile: Optional[str] = None


class CDSRule(BaseModel):
    """Full CDS rule as stored in the cds_rules collection."""
    rule_id: str
    name: str
    version: int = 1
    enabled: bool = True
    applicability: RuleApplicability = RuleApplicability()
    trigger: RuleTrigger = RuleTrigger()
    alert_template: RuleAlertTemplate


# ---------------------------------------------------------------------------
# Alert document
# ---------------------------------------------------------------------------

class ContributingVitals(BaseModel):
    """Vitals snapshot that contributed to an alert firing."""
    timestamp: Optional[str] = None
    heart_rate: Optional[float] = None
    respiratory_rate: Optional[float] = None
    temperature: Optional[float] = None
    spo2: Optional[float] = None
    activity_level: Optional[float] = None


class FHIRPrediction(BaseModel):
    outcome: dict[str, str] = {}
    qualitativeRisk: dict[str, str] = {}


class FHIRResource(BaseModel):
    """Embedded FHIR RiskAssessment stub for HealthLake sync."""
    resourceType: str = "RiskAssessment"
    status: str = "final"
    subject: dict[str, str] = {}
    prediction: list[FHIRPrediction] = []


class AlertDocument(BaseModel):
    """An alert as stored in the alerts collection."""
    alert_id: str
    patient_id: str
    rule_id: str

    alert_type: str
    severity: str
    title: str
    reasoning: str
    suggested_actions: list[str] = []

    contributing_vitals: ContributingVitals = ContributingVitals()

    status: str = "new"
    created_at: Optional[str] = None
    acknowledged_at: Optional[str] = None
    acknowledged_by: Optional[str] = None
    resolved_at: Optional[str] = None

    hedis_measure: Optional[str] = None
    measure_name: Optional[str] = None
    last_completed: Optional[str] = None
    due_by: Optional[str] = None
    days_overdue: Optional[int] = None

    fhir_resource: Optional[FHIRResource] = None


# ---------------------------------------------------------------------------
# HEDIS Care Gap
# ---------------------------------------------------------------------------

class CareGap(BaseModel):
    """A single HEDIS care gap entry in the Patient 360."""
    hedis_measure: str
    measure_name: str
    status: str = "open"
    last_completed: Optional[str] = None
    due_by: Optional[str] = None
    days_overdue: int = 0
    priority: str = "moderate"


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SeedRulesResponse(BaseModel):
    inserted: int
    rules: list[str]


class EvaluatePatientRequest(BaseModel):
    patient_id: str


class EvaluateAllRequest(BaseModel):
    hospital: Optional[str] = None
    profile_type: Optional[str] = None


class EvaluatePatientResponse(BaseModel):
    patient_id: str
    alerts_generated: int
    alerts: list[dict[str, Any]] = []


class EvaluateAllResponse(BaseModel):
    total_patients: int
    evaluated: int
    total_alerts: int
    errors: list[str] = []


class ComputeCareGapsRequest(BaseModel):
    hospital: Optional[str] = None
    profile_type: Optional[str] = None


class ComputeCareGapsResponse(BaseModel):
    total_patients: int
    processed: int
    total_gaps_found: int
    errors: list[str] = []


class PatientAlertsResponse(BaseModel):
    patient_id: str
    total: int
    alerts: list[dict[str, Any]] = []
