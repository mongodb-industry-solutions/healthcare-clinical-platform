"""
Attribution repository — MongoDB operations for the attributions collection.
"""
from __future__ import annotations

from typing import Any, Optional

from db.mdb import MongoDBConnector

ATTRIBUTIONS_COLLECTION = "attributions"
PATIENT_360_COLLECTION = "patient_360"


class AttributionRepository:
    def __init__(self, db: MongoDBConnector):
        self._db = db

    def upsert_attribution(self, attribution_id: str, doc: dict[str, Any]) -> None:
        self._db.get_collection(ATTRIBUTIONS_COLLECTION).replace_one(
            {"attribution_id": attribution_id}, doc, upsert=True,
        )

    def get_attributions_for_patient(
        self, patient_id: str,
    ) -> list[dict[str, Any]]:
        return list(
            self._db.get_collection(ATTRIBUTIONS_COLLECTION)
            .find({"patient_id": patient_id}, {"_id": 0})
        )

    def get_attributions_for_provider(
        self, provider_id: str,
    ) -> list[dict[str, Any]]:
        return list(
            self._db.get_collection(ATTRIBUTIONS_COLLECTION)
            .find({"provider_id": provider_id}, {"_id": 0})
        )

    def get_patient_ids_for_provider(self, provider_id: str) -> list[str]:
        """Lightweight projection used by the dashboard provider filter.

        Returns just the patient IDs attributed to a provider (verified
        attributions only) so the population aggregation can scope itself
        with `{"patient_id": {"$in": [...]}}`.
        """
        cursor = self._db.get_collection(ATTRIBUTIONS_COLLECTION).find(
            {"provider_id": provider_id, "verified": True},
            {"_id": 0, "patient_id": 1},
        )
        return [doc["patient_id"] for doc in cursor if doc.get("patient_id")]

    def list_distinct_providers(self) -> list[dict[str, Any]]:
        """Aggregate the attributions collection into one row per provider.

        Used by the dashboard "scope to my panel" filter dropdown. Only
        verified attributions feed the count so a stale unverified row
        doesn't inflate panel size.
        """
        pipeline: list[dict[str, Any]] = [
            {"$match": {"verified": True}},
            {"$group": {
                "_id": "$provider_id",
                "provider_name": {"$first": "$provider_name"},
                "provider_role": {"$first": "$provider_role"},
                "organization": {"$first": "$organization"},
                "patient_count": {"$sum": 1},
            }},
            {"$sort": {"organization": 1, "provider_name": 1}},
        ]
        results = list(
            self._db.get_collection(ATTRIBUTIONS_COLLECTION).aggregate(pipeline)
        )
        return [
            {
                "provider_id": r["_id"],
                "provider_name": r.get("provider_name", "Unknown"),
                "provider_role": r.get("provider_role", "pcp"),
                "organization": r.get("organization", ""),
                "patient_count": int(r.get("patient_count", 0) or 0),
            }
            for r in results
        ]

    def check_attribution(
        self, patient_id: str, provider_id: str,
    ) -> bool:
        doc = self._db.get_collection(ATTRIBUTIONS_COLLECTION).find_one(
            {"patient_id": patient_id, "provider_id": provider_id, "verified": True},
        )
        return doc is not None

    def get_all_patient_360_ids(self) -> list[str]:
        cursor = self._db.get_collection(PATIENT_360_COLLECTION).find(
            {}, {"patient_id": 1, "source_hospital": 1, "hospital_name": 1, "_id": 0},
        )
        return list(cursor)

    def count_attributions(self) -> int:
        return self._db.get_collection(ATTRIBUTIONS_COLLECTION).count_documents({})

    def clear_all(self) -> int:
        result = self._db.get_collection(ATTRIBUTIONS_COLLECTION).delete_many({})
        return result.deleted_count
