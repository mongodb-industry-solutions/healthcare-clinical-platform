"""
Dashboard repository.

Read-only queries against patient_360, alerts, and synthetic_vitals.
Supports filtering, sorting, pagination, and text search for the
clinician dashboard endpoints.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

from pymongo import ASCENDING, DESCENDING

from db.mdb import MongoDBConnector

PATIENT_360_COLLECTION = "patient_360"
ALERTS_COLLECTION = "alerts"
VITALS_COLLECTION = "synthetic_vitals"


class DashboardRepository:
    def __init__(self, db: MongoDBConnector):
        self._db = db

    # ------------------------------------------------------------------
    # Patient list
    # ------------------------------------------------------------------

    def list_patients(
        self,
        skip: int = 0,
        limit: int = 50,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
        sort_by: str = "alert_severity",
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Return paginated Patient 360 documents with optional filters.
        Returns (docs, total_count).
        """
        query: dict[str, Any] = {}
        if hospital:
            query["source_hospital"] = hospital
        if profile_type:
            query["profile_type"] = profile_type

        collection = self._db.get_collection(PATIENT_360_COLLECTION)
        total = collection.count_documents(query)

        sort_spec = self._build_sort_spec(sort_by)
        docs = list(
            collection.find(query, {"_id": 0})
            .sort(sort_spec)
            .skip(skip)
            .limit(limit)
        )
        return docs, total

    @staticmethod
    def _build_sort_spec(sort_by: str) -> list[tuple[str, int]]:
        """Map sort_by parameter to MongoDB sort specification."""
        if sort_by == "name":
            return [("demographics.name", ASCENDING)]
        if sort_by == "hospital":
            return [("source_hospital", ASCENDING)]
        return [("updated_at", DESCENDING)]

    # ------------------------------------------------------------------
    # Patient detail
    # ------------------------------------------------------------------

    def get_patient_360(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Fetch a single Patient 360 document."""
        return self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id}, {"_id": 0},
        )

    # ------------------------------------------------------------------
    # Vitals
    # ------------------------------------------------------------------

    def get_vitals_window(
        self,
        patient_id: str,
        start: datetime,
        end: datetime,
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

    def get_vitals_latest(
        self, patient_id: str, limit: int = 1,
    ) -> list[dict[str, Any]]:
        """Fetch the most recent vitals readings."""
        return list(
            self._db.get_collection(VITALS_COLLECTION)
            .find({"patient_id": patient_id}, {"_id": 0})
            .sort("timestamp", DESCENDING)
            .limit(limit)
        )

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_patients(
        self, query_text: str, limit: int = 20,
    ) -> list[dict[str, Any]]:
        """
        Search patient_360 by name, MRN, or condition display text.
        Uses case-insensitive regex matching.
        """
        escaped = re.escape(query_text)
        regex = {"$regex": escaped, "$options": "i"}

        pipeline: list[dict[str, Any]] = [
            {
                "$match": {
                    "$or": [
                        {"demographics.name": regex},
                        {"mrn": regex},
                        {"conditions.display": regex},
                    ],
                },
            },
            {"$limit": limit},
            {"$project": {"_id": 0}},
        ]

        return list(
            self._db.get_collection(PATIENT_360_COLLECTION).aggregate(pipeline)
        )
