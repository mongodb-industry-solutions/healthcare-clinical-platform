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
SYNTHETIC_PATIENTS_COLLECTION = "synthetic_patients"


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
        docs = [
            self._db.strip_qe_metadata(d)
            for d in collection.find(query, {"_id": 0, "__safeContent__": 0})
            .sort(sort_spec)
            .skip(skip)
            .limit(limit)
        ]
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
        doc = self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id}, {"_id": 0},
        )
        return self._db.strip_qe_metadata(doc)

    def get_patient_fhir_bundle(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Fetch the raw FHIR bundle wrapper document for a patient."""
        return self._db.get_collection(SYNTHETIC_PATIENTS_COLLECTION).find_one(
            {"meta.patient_id": patient_id}, {"_id": 0, "bundle": 1},
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
    # Vitals aggregation (for live longitudinal snapshots)
    # ------------------------------------------------------------------

    def aggregate_vitals_stats(
        self,
        patient_id: str,
        start: datetime,
        end: datetime,
    ) -> Optional[dict[str, Any]]:
        """
        Run a MongoDB aggregation pipeline to compute avg/min/max/stddev
        for each vital sign in a single pass over the time window.
        Returns None if no readings exist in the window.
        """
        pipeline: list[dict[str, Any]] = [
            {"$match": {
                "patient_id": patient_id,
                "timestamp": {"$gte": start, "$lte": end},
            }},
            {"$group": {
                "_id": None,
                "count": {"$sum": 1},
                "hr_avg": {"$avg": "$heart_rate"},
                "hr_min": {"$min": "$heart_rate"},
                "hr_max": {"$max": "$heart_rate"},
                "hr_std": {"$stdDevPop": "$heart_rate"},
                "spo2_avg": {"$avg": "$spo2"},
                "spo2_min": {"$min": "$spo2"},
                "spo2_max": {"$max": "$spo2"},
                "spo2_std": {"$stdDevPop": "$spo2"},
                "rr_avg": {"$avg": "$respiratory_rate"},
                "rr_min": {"$min": "$respiratory_rate"},
                "rr_max": {"$max": "$respiratory_rate"},
                "rr_std": {"$stdDevPop": "$respiratory_rate"},
                "temp_avg": {"$avg": "$temperature"},
                "temp_min": {"$min": "$temperature"},
                "temp_max": {"$max": "$temperature"},
                "temp_std": {"$stdDevPop": "$temperature"},
            }},
        ]

        results = list(
            self._db.get_collection(VITALS_COLLECTION).aggregate(pipeline)
        )
        return results[0] if results else None

    def count_alerts_in_window(
        self,
        patient_id: str,
        start: datetime,
        end: datetime,
    ) -> dict[str, int]:
        """
        Count alerts by severity within a time window.
        """
        pipeline: list[dict[str, Any]] = [
            {"$match": {
                "patient_id": patient_id,
                "created_at": {"$gte": start.isoformat(), "$lte": end.isoformat()},
            }},
            {"$group": {
                "_id": "$severity",
                "count": {"$sum": 1},
            }},
        ]

        results = list(
            self._db.get_collection(ALERTS_COLLECTION).aggregate(pipeline)
        )
        counts: dict[str, int] = {"critical": 0, "high": 0, "moderate": 0, "low": 0}
        for r in results:
            sev = r.get("_id", "")
            if sev in counts:
                counts[sev] = r["count"]
        return counts

    # ------------------------------------------------------------------
    # Population care-gap aggregation
    # ------------------------------------------------------------------

    def aggregate_care_gap_metrics(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
        patient_id_filter: Optional[list[str]] = None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """
        Run a single `$facet` aggregation across patient_360 to compute:

          - by_measure   :: open / closed_controlled / closed_uncontrolled / due_soon
                            counts per HEDIS measure, plus avg/max days_overdue
          - totals       :: matched patient count
          - by_priority  :: count of OPEN gaps grouped by priority
          - by_hospital  :: count of OPEN gaps grouped by (hospital, measure)

        Routing note: when Queryable Encryption is on, the automatic
        encryption query analyzer rejects `$facet` (it cannot statically
        prove that the inner pipelines are safe). All fields we touch
        (`care_gaps.*`, `source_hospital`, `profile_type`, `patient_id`)
        are unencrypted, so we run this aggregation through the plain
        client. The result is identical — only ciphertext fields would
        be opaque, and we never look at any of those here.

        Returns (facet_result_doc, pipeline_used_for_display).
        """
        match_stage: dict[str, Any] = {}
        if hospital:
            match_stage["source_hospital"] = hospital
        if profile_type:
            match_stage["profile_type"] = profile_type
        if patient_id_filter:
            match_stage["patient_id"] = {"$in": patient_id_filter}

        # `result_evaluation` is allowed to be missing (older docs / measures
        # without the block), so we use `$ne false` rather than `$eq true` to
        # treat missing as "controlled" for the closed_controlled bucket.
        pipeline: list[dict[str, Any]] = [
            {"$match": match_stage},
            {"$facet": {
                "by_measure": [
                    {"$unwind": "$care_gaps"},
                    {"$group": {
                        "_id": "$care_gaps.hedis_measure",
                        "measure_name": {"$first": "$care_gaps.measure_name"},
                        "open": {"$sum": {"$cond": [
                            {"$eq": ["$care_gaps.status", "open"]}, 1, 0,
                        ]}},
                        "closed_controlled": {"$sum": {"$cond": [
                            {"$and": [
                                {"$eq": ["$care_gaps.status", "closed"]},
                                {"$ne": ["$care_gaps.result_evaluation.controlled", False]},
                            ]}, 1, 0,
                        ]}},
                        "closed_uncontrolled": {"$sum": {"$cond": [
                            {"$eq": ["$care_gaps.result_evaluation.controlled", False]}, 1, 0,
                        ]}},
                        "due_soon": {"$sum": {"$cond": [
                            {"$eq": ["$care_gaps.status", "due_soon"]}, 1, 0,
                        ]}},
                        "avg_days_overdue": {"$avg": "$care_gaps.days_overdue"},
                        "max_days_overdue": {"$max": "$care_gaps.days_overdue"},
                    }},
                    {"$sort": {"_id": 1}},
                ],
                "totals": [
                    {"$count": "patient_count"},
                ],
                "by_priority": [
                    {"$unwind": "$care_gaps"},
                    {"$match": {"care_gaps.status": "open"}},
                    {"$group": {"_id": "$care_gaps.priority", "count": {"$sum": 1}}},
                    {"$sort": {"_id": 1}},
                ],
                "by_hospital": [
                    {"$unwind": "$care_gaps"},
                    {"$match": {"care_gaps.status": "open"}},
                    {"$group": {
                        "_id": {
                            "hospital": "$source_hospital",
                            "measure": "$care_gaps.hedis_measure",
                        },
                        "count": {"$sum": 1},
                    }},
                    {"$sort": {"_id.hospital": 1, "_id.measure": 1}},
                ],
            }},
        ]

        collection = self._aggregation_collection(PATIENT_360_COLLECTION)
        results = list(collection.aggregate(pipeline))
        # `$facet` always emits exactly one doc; default to an empty shape so
        # an empty collection doesn't make the service layer reach into None.
        facet_doc = results[0] if results else {
            "by_measure": [],
            "totals": [],
            "by_priority": [],
            "by_hospital": [],
        }
        return facet_doc, pipeline

    def _aggregation_collection(self, name: str):
        """
        Return a collection handle suitable for read-only aggregations that
        don't touch encrypted fields. With Queryable Encryption enabled the
        automatic query analyzer disallows several stages (e.g. `$facet`),
        so we route around it via the plain (non-encrypting) client.
        """
        if self._db.has_encryption:
            return self._db.plain_db[name]
        return self._db.get_collection(name)

    def list_patient_ids(
        self,
        hospital: Optional[str] = None,
        profile_type: Optional[str] = None,
        patient_id_filter: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        """
        Lightweight projection used for HEDIS applicability counting.
        Returns only the fields needed to evaluate measure applicability
        (condition_codes, flags, age) — keeps the wire payload minimal.
        """
        query: dict[str, Any] = {}
        if hospital:
            query["source_hospital"] = hospital
        if profile_type:
            query["profile_type"] = profile_type
        if patient_id_filter:
            query["patient_id"] = {"$in": patient_id_filter}

        projection = {
            "_id": 0,
            "patient_id": 1,
            "demographics.age": 1,
            "flags": 1,
            "source_hospital": 1,
            "profile_type": 1,
        }
        collection = self._aggregation_collection(PATIENT_360_COLLECTION)
        return [
            self._db.strip_qe_metadata(d)
            for d in collection.find(query, projection)
        ]

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
            {"$project": {"_id": 0, "__safeContent__": 0}},
        ]

        return [
            self._db.strip_qe_metadata(d)
            for d in self._db.get_collection(PATIENT_360_COLLECTION).aggregate(pipeline)
        ]
