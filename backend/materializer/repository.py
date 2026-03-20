"""
Patient 360 Materializer repository.

All MongoDB read/write operations for the materializer module live here.
Reads from synthetic_patients and synthetic_vitals,
writes to the patient_360 collection.
"""
from __future__ import annotations

from typing import Any, Optional

from pymongo import ASCENDING, DESCENDING

from db.mdb import MongoDBConnector

PATIENTS_COLLECTION = "synthetic_patients"
VITALS_COLLECTION = "synthetic_vitals"
PATIENT_360_COLLECTION = "patient_360"


class MaterializerRepository:
    def __init__(self, db: MongoDBConnector):
        self._db = db

    # ------------------------------------------------------------------
    # Read from source collections
    # ------------------------------------------------------------------

    def get_all_patient_ids(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> list[str]:
        """Return all patient_id values from synthetic_patients, optionally filtered."""
        query: dict[str, Any] = {}
        if hospital:
            query["meta.source_hospital"] = hospital
        if profile_type:
            query["meta.profile_type"] = profile_type

        collection = self._db.get_collection(PATIENTS_COLLECTION)
        cursor = collection.find(query, {"meta.patient_id": 1, "_id": 0})
        return [doc["meta"]["patient_id"] for doc in cursor]

    def get_patient_bundle(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Fetch the full FHIR patient document from synthetic_patients."""
        return self._db.get_collection(PATIENTS_COLLECTION).find_one(
            {"meta.patient_id": patient_id}, {"_id": 0}
        )

    def get_vitals_latest(self, patient_id: str, limit: int = 1) -> list[dict[str, Any]]:
        """Fetch the most recent vitals readings for a patient (newest first)."""
        collection = self._db.get_collection(VITALS_COLLECTION)
        return list(
            collection.find(
                {"patient_id": patient_id}, {"_id": 0}
            )
            .sort("timestamp", DESCENDING)
            .limit(limit)
        )

    def get_vitals_window(
        self,
        patient_id: str,
        start: Any,
        end: Any,
    ) -> list[dict[str, Any]]:
        """Fetch vitals within a time window (ascending order). Accepts datetime objects."""
        collection = self._db.get_collection(VITALS_COLLECTION)
        return list(
            collection.find(
                {
                    "patient_id": patient_id,
                    "timestamp": {"$gte": start, "$lte": end},
                },
                {"_id": 0},
            ).sort("timestamp", ASCENDING)
        )

    def count_vitals(self, patient_id: str) -> int:
        """Count total vitals readings for a patient."""
        return self._db.get_collection(VITALS_COLLECTION).count_documents(
            {"patient_id": patient_id}
        )

    # ------------------------------------------------------------------
    # Write to patient_360
    # ------------------------------------------------------------------

    def upsert_patient_360(self, patient_id: str, doc: dict[str, Any]) -> None:
        """Insert or fully replace a patient_360 document."""
        self._db.get_collection(PATIENT_360_COLLECTION).replace_one(
            {"patient_id": patient_id},
            doc,
            upsert=True,
        )

    def get_patient_360(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Fetch a single patient_360 document."""
        return self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id}, {"_id": 0}
        )

    def list_patient_360(
        self,
        skip: int = 0,
        limit: int = 50,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Return paginated patient_360 documents with optional filters."""
        query: dict[str, Any] = {}
        if hospital:
            query["source_hospital"] = hospital
        if profile_type:
            query["profile_type"] = profile_type
        collection = self._db.get_collection(PATIENT_360_COLLECTION)
        return list(
            collection.find(query, {"_id": 0}).skip(skip).limit(limit)
        )

    def count_patient_360(self) -> int:
        """Count patient_360 documents."""
        return self._db.get_collection(PATIENT_360_COLLECTION).count_documents({})
