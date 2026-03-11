"""
Synthetic data repository.

All MongoDB read/write operations for the synthetic module live here.
Nothing in this file knows about FastAPI, HTTP, or business rules.
"""
from __future__ import annotations
from typing import Any, Optional
from pymongo import ASCENDING
from db.mdb import MongoDBConnector

# ---------------------------------------------------------------------------
# Collection names
# ---------------------------------------------------------------------------

PATIENTS_COLLECTION = "synthetic_patients"
VITALS_COLLECTION   = "synthetic_vitals"


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------

class SyntheticRepository:
    def __init__(self, db: MongoDBConnector):
        self._db = db

    # ------------------------------------------------------------------
    # Patients
    # ------------------------------------------------------------------

    def insert_patients(self, docs: list[dict[str, Any]]) -> None:
        self._db.insert_many(PATIENTS_COLLECTION, docs)

    def find_patients(
        self,
        hospital: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {}
        if hospital:
            query["meta.source_hospital"] = hospital
        projection = {"meta": 1, "bundle.entry": 1}
        collection = self._db.get_collection(PATIENTS_COLLECTION)
        return list(collection.find(query, projection).skip(skip).limit(limit))

    def find_patient_by_id(self, patient_id: str) -> Optional[dict[str, Any]]:
        return self._db.get_collection(PATIENTS_COLLECTION).find_one(
            {"meta.patient_id": patient_id}, {"_id": 0}
        )

    def find_patient_meta(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Lightweight fetch — returns only the meta sub-document."""
        return self._db.get_collection(PATIENTS_COLLECTION).find_one(
            {"meta.patient_id": patient_id}, {"meta": 1, "_id": 0}
        )

    def count_patients(self) -> int:
        return self._db.get_collection(PATIENTS_COLLECTION).count_documents({})

    def delete_all_patients(self) -> int:
        result = self._db.get_collection(PATIENTS_COLLECTION).delete_many({})
        return result.deleted_count

    # ------------------------------------------------------------------
    # Vitals
    # ------------------------------------------------------------------

    def insert_vitals(self, readings: list[dict[str, Any]]) -> None:
        self._db.insert_many(VITALS_COLLECTION, readings)

    def find_vitals(
        self,
        patient_id: str,
        limit: int = 288,
        start_iso: Optional[str] = None,
        end_iso: Optional[str] = None,
        pattern: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"patient_id": patient_id}

        if start_iso or end_iso:
            ts_filter: dict[str, Any] = {}
            if start_iso:
                ts_filter["$gte"] = start_iso
            if end_iso:
                ts_filter["$lte"] = end_iso
            query["timestamp"] = ts_filter

        if pattern:
            query["pattern"] = pattern

        collection = self._db.get_collection(VITALS_COLLECTION)
        return list(
            collection.find(query, {"_id": 0})
            .sort("timestamp", ASCENDING)
            .limit(limit)
        )

    def count_vitals(self) -> int:
        return self._db.get_collection(VITALS_COLLECTION).count_documents({})

    def delete_all_vitals(self) -> int:
        result = self._db.get_collection(VITALS_COLLECTION).delete_many({})
        return result.deleted_count
