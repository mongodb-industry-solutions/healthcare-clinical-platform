"""
CDS & HEDIS Engine service — thin facade.

Delegates to two architecturally separate engines:

- **AlertEngine** (alert_engine.py): Real-time threshold / monitoring alerts
- **QualityEngine** (quality_engine.py): HEDIS care-gap computation (DEQM-aligned)

This separation follows the Da Vinci recommendation that quality-measure
logic and real-time clinical alerting are complementary but distinct
workflow concerns.

All existing callers (router, hooks, interventions, dashboard) continue
to use CDSService methods unchanged.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from cds.alert_engine import AlertEngine
from cds.quality_engine import QualityEngine
from cds.models import (
    ComputeCareGapsResponse,
    EvaluateAllResponse,
    EvaluatePatientResponse,
    SeedRulesResponse,
)
from cds.repository import CDSRepository
from cds.rules_seed import CDS_RULES

logger = logging.getLogger(__name__)


class CDSService:
    """Facade that delegates to AlertEngine and QualityEngine."""

    def __init__(self, repo: CDSRepository):
        self._repo = repo
        self.alerts = AlertEngine(repo)
        self.quality = QualityEngine(repo)

    # ==================================================================
    # Rules Seeder
    # ==================================================================

    def seed_rules(self) -> SeedRulesResponse:
        inserted_ids: list[str] = []
        for rule in CDS_RULES:
            self._repo.upsert_rule(rule["rule_id"], rule)
            inserted_ids.append(rule["rule_id"])
        return SeedRulesResponse(inserted=len(inserted_ids), rules=inserted_ids)

    def list_rules(self) -> list[dict[str, Any]]:
        return self._repo.get_all_rules(enabled_only=False)

    # ==================================================================
    # Threshold Calculator — delegates to AlertEngine
    # ==================================================================

    def compute_thresholds(self, patient_id: str) -> Optional[dict[str, Any]]:
        return self.alerts.compute_thresholds(patient_id)

    # ==================================================================
    # Real-Time Evaluator — delegates to AlertEngine
    # ==================================================================

    def evaluate_patient(self, patient_id: str) -> Optional[EvaluatePatientResponse]:
        return self.alerts.evaluate_patient(patient_id)

    def evaluate_all(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> EvaluateAllResponse:
        return self.alerts.evaluate_all(hospital=hospital, profile_type=profile_type)

    # ==================================================================
    # HEDIS Care Gap Calculator — delegates to QualityEngine
    # ==================================================================

    def compute_care_gaps(self, patient_id: str) -> Optional[list[dict[str, Any]]]:
        return self.quality.compute_care_gaps(patient_id)

    def compute_care_gaps_all(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> ComputeCareGapsResponse:
        return self.quality.compute_care_gaps_all(
            hospital=hospital, profile_type=profile_type,
        )

    # ==================================================================
    # Alerts retrieval
    # ==================================================================

    def get_patient_alerts(
        self,
        patient_id: str,
        status: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        return self._repo.get_alerts_for_patient(patient_id, status=status)

    def get_status(self) -> dict[str, int]:
        return {
            "cds_rules_count": self._repo.count_rules(),
            "alerts_count": self._repo.count_alerts(),
        }
