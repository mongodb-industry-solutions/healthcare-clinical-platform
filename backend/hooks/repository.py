"""
CDS Hooks repository.

Read-only access to patient_360 and alerts collections.
This module never writes — it consumes data produced by the
materializer and CDS engine.
"""
from __future__ import annotations

from typing import Any, Optional

from pymongo import DESCENDING

from db.mdb import MongoDBConnector

PATIENT_360_COLLECTION = "patient_360"
ALERTS_COLLECTION = "alerts"
CDS_RULES_COLLECTION = "cds_rules"


class HooksRepository:
    def __init__(self, db: MongoDBConnector):
        self._db = db

    def get_patient_360(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Fetch a single Patient 360 document."""
        doc = self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id}, {"_id": 0},
        )
        return self._db.strip_qe_metadata(doc)

    def get_active_alerts(self, patient_id: str) -> list[dict[str, Any]]:
        """Fetch all non-resolved alerts for a patient, newest first."""
        return list(
            self._db.get_collection(ALERTS_COLLECTION)
            .find(
                {"patient_id": patient_id, "status": {"$ne": "resolved"}},
                {"_id": 0},
            )
            .sort("created_at", DESCENDING)
        )

    def get_all_rules(self) -> list[dict[str, Any]]:
        """Fetch every CDS rule definition."""
        return list(self._db.get_collection(CDS_RULES_COLLECTION).find({}, {"_id": 0}))

    def get_rule_by_id(self, rule_id: str) -> Optional[dict[str, Any]]:
        """Fetch a single CDS rule by its rule_id."""
        return self._db.get_collection(CDS_RULES_COLLECTION).find_one(
            {"rule_id": rule_id}, {"_id": 0},
        )

    def get_alert_by_id(self, alert_id: str) -> Optional[dict[str, Any]]:
        """Fetch a single alert document by its alert_id."""
        return self._db.get_collection(ALERTS_COLLECTION).find_one(
            {"alert_id": alert_id}, {"_id": 0},
        )

    def get_rules_by_hedis_measure(self, measure_code: str) -> list[dict[str, Any]]:
        """Fetch CDS rules whose alert_template targets a given HEDIS measure."""
        return list(
            self._db.get_collection(CDS_RULES_COLLECTION).find(
                {"alert_template.hedis_measure": measure_code}, {"_id": 0},
            )
        )
