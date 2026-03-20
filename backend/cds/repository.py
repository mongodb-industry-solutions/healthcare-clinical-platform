"""
CDS & HEDIS Engine repository.

All MongoDB read/write operations for the CDS module live here.
Reads from cds_rules, patient_360, synthetic_vitals.
Writes to alerts and updates patient_360 (active_alerts, care_gaps, thresholds).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pymongo import ASCENDING, DESCENDING

from db.mdb import MongoDBConnector

CDS_RULES_COLLECTION = "cds_rules"
PATIENT_360_COLLECTION = "patient_360"
ALERTS_COLLECTION = "alerts"
VITALS_COLLECTION = "synthetic_vitals"


class CDSRepository:
    def __init__(self, db: MongoDBConnector):
        self._db = db

    # ------------------------------------------------------------------
    # CDS Rules
    # ------------------------------------------------------------------

    def get_all_rules(self, enabled_only: bool = True) -> list[dict[str, Any]]:
        """Fetch all CDS rules, optionally filtering to enabled ones."""
        query: dict[str, Any] = {}
        if enabled_only:
            query["enabled"] = True
        return list(
            self._db.get_collection(CDS_RULES_COLLECTION)
            .find(query, {"_id": 0})
        )

    def get_rule(self, rule_id: str) -> Optional[dict[str, Any]]:
        """Fetch a single CDS rule by rule_id."""
        return self._db.get_collection(CDS_RULES_COLLECTION).find_one(
            {"rule_id": rule_id}, {"_id": 0}
        )

    def upsert_rule(self, rule_id: str, doc: dict[str, Any]) -> None:
        """Insert or replace a CDS rule document."""
        self._db.get_collection(CDS_RULES_COLLECTION).replace_one(
            {"rule_id": rule_id}, doc, upsert=True,
        )

    def count_rules(self) -> int:
        return self._db.get_collection(CDS_RULES_COLLECTION).count_documents({})

    # ------------------------------------------------------------------
    # Patient 360 reads (for evaluation context)
    # ------------------------------------------------------------------

    def get_patient_360(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Fetch a Patient 360 document."""
        return self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id}, {"_id": 0}
        )

    def get_all_patient_360_ids(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> list[str]:
        """Return all patient_ids from patient_360, optionally filtered."""
        query: dict[str, Any] = {}
        if hospital:
            query["source_hospital"] = hospital
        if profile_type:
            query["profile_type"] = profile_type
        cursor = self._db.get_collection(PATIENT_360_COLLECTION).find(
            query, {"patient_id": 1, "_id": 0}
        )
        return [doc["patient_id"] for doc in cursor]

    # ------------------------------------------------------------------
    # Vitals reads (for evaluation)
    # ------------------------------------------------------------------

    def get_vitals_latest(self, patient_id: str, limit: int = 1) -> list[dict[str, Any]]:
        """Fetch the most recent vitals readings for a patient."""
        return list(
            self._db.get_collection(VITALS_COLLECTION)
            .find({"patient_id": patient_id}, {"_id": 0})
            .sort("timestamp", DESCENDING)
            .limit(limit)
        )

    def get_vitals_window(
        self, patient_id: str, start: datetime, end: datetime,
    ) -> list[dict[str, Any]]:
        """Fetch vitals within a time window (ascending)."""
        return list(
            self._db.get_collection(VITALS_COLLECTION)
            .find(
                {
                    "patient_id": patient_id,
                    "timestamp": {"$gte": start, "$lte": end},
                },
                {"_id": 0},
            )
            .sort("timestamp", ASCENDING)
        )

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    def insert_alert(self, alert_doc: dict[str, Any]) -> None:
        """Insert a new alert document."""
        self._db.get_collection(ALERTS_COLLECTION).insert_one(alert_doc)

    def get_alerts_for_patient(
        self,
        patient_id: str,
        status: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Fetch alerts for a patient, optionally filtering by status."""
        query: dict[str, Any] = {"patient_id": patient_id}
        if status:
            query["status"] = status
        return list(
            self._db.get_collection(ALERTS_COLLECTION)
            .find(query, {"_id": 0})
            .sort("created_at", DESCENDING)
        )

    def clear_alerts_for_patient(self, patient_id: str) -> int:
        """Remove all alerts for a patient (used before re-evaluation)."""
        result = self._db.get_collection(ALERTS_COLLECTION).delete_many(
            {"patient_id": patient_id}
        )
        return result.deleted_count

    def count_alerts(self, patient_id: Optional[str] = None) -> int:
        query: dict[str, Any] = {}
        if patient_id:
            query["patient_id"] = patient_id
        return self._db.get_collection(ALERTS_COLLECTION).count_documents(query)

    # ------------------------------------------------------------------
    # Patient 360 updates (active_alerts, care_gaps, thresholds)
    # ------------------------------------------------------------------

    def update_patient_360_active_alerts(
        self, patient_id: str, active_alerts: list[dict[str, Any]],
    ) -> None:
        """Replace the active_alerts array in a Patient 360 document."""
        self._db.get_collection(PATIENT_360_COLLECTION).update_one(
            {"patient_id": patient_id},
            {"$set": {
                "active_alerts": active_alerts,
                "updated_at": datetime.utcnow().isoformat(),
            }},
        )

    def update_patient_360_care_gaps(
        self, patient_id: str, care_gaps: list[dict[str, Any]],
    ) -> None:
        """Replace the care_gaps array in a Patient 360 document."""
        self._db.get_collection(PATIENT_360_COLLECTION).update_one(
            {"patient_id": patient_id},
            {"$set": {
                "care_gaps": care_gaps,
                "updated_at": datetime.utcnow().isoformat(),
            }},
        )

    def update_patient_360_thresholds(
        self, patient_id: str, thresholds: dict[str, Any],
    ) -> None:
        """Replace the personalized_thresholds in a Patient 360 document."""
        self._db.get_collection(PATIENT_360_COLLECTION).update_one(
            {"patient_id": patient_id},
            {"$set": {
                "personalized_thresholds": thresholds,
                "updated_at": datetime.utcnow().isoformat(),
            }},
        )
