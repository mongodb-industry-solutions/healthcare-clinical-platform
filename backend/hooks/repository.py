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


class HooksRepository:
    def __init__(self, db: MongoDBConnector):
        self._db = db

    def get_patient_360(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Fetch a single Patient 360 document."""
        return self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id}, {"_id": 0},
        )

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
