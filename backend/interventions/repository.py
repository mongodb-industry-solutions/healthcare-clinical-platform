"""
Intervention repository.

All MongoDB read/write operations for the KED workflow live here.
Scoped to the patient_360 collection.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from db.mdb import MongoDBConnector

PATIENT_360_COLLECTION = "patient_360"

# LOINC codes for kidney evaluation
EGFR_LOINC = "62238-1"
UACR_LOINC = "14959-1"


class InterventionRepository:
    def __init__(self, db: MongoDBConnector):
        self._db = db

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    def get_patient_360(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Fetch a full Patient 360 document."""
        return self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id}, {"_id": 0},
        )

    def get_ked_gap(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Return the KED care gap entry from a patient's care_gaps array."""
        doc = self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id},
            {"care_gaps": 1, "_id": 0},
        )
        if not doc:
            return None
        for gap in doc.get("care_gaps", []):
            if gap.get("hedis_measure") == "KED":
                return gap
        return None

    def get_kidney_labs(self, patient_id: str) -> list[dict[str, Any]]:
        """Return eGFR and uACR labs from the patient's labs array, most recent first."""
        doc = self._db.get_collection(PATIENT_360_COLLECTION).find_one(
            {"patient_id": patient_id},
            {"labs": 1, "_id": 0},
        )
        if not doc:
            return []
        kidney = [
            lb for lb in doc.get("labs", [])
            if lb.get("loinc") in (EGFR_LOINC, UACR_LOINC)
        ]
        kidney.sort(key=lambda lb: lb.get("effective_date", ""), reverse=True)
        return kidney

    # ------------------------------------------------------------------
    # Order workflow
    # ------------------------------------------------------------------

    def mark_ked_ordered(
        self,
        patient_id: str,
        ordered_by: str,
        ordered_at: datetime,
    ) -> int:
        """Set the KED workflow status to 'ordered' and update the care gap."""
        col = self._db.get_collection(PATIENT_360_COLLECTION)
        ts = ordered_at.isoformat()

        result = col.update_one(
            {"patient_id": patient_id},
            {"$set": {
                "interventions.ked_workflow.status": "ordered",
                "interventions.ked_workflow.ordered_at": ts,
                "interventions.ked_workflow.ordered_by": ordered_by,
                "interventions.ked_workflow.last_updated_at": ts,
                "care_gaps.$[ked].workflow_status": "ordered",
                "updated_at": ts,
            }},
            array_filters=[{"ked.hedis_measure": "KED"}],
        )
        return result.modified_count

    # ------------------------------------------------------------------
    # Lab ingestion
    # ------------------------------------------------------------------

    def append_kidney_labs(
        self,
        patient_id: str,
        lab_docs: list[dict[str, Any]],
    ) -> int:
        """Push new kidney lab entries into the patient's labs array."""
        col = self._db.get_collection(PATIENT_360_COLLECTION)
        result = col.update_one(
            {"patient_id": patient_id},
            {"$push": {"labs": {"$each": lab_docs}}},
        )
        return result.modified_count

    # ------------------------------------------------------------------
    # Workflow completion
    # ------------------------------------------------------------------

    def set_ked_workflow_completed(
        self,
        patient_id: str,
        completed_by: str,
        completed_at: datetime,
        result_profile: str,
        result_ids: list[str],
    ) -> int:
        """Mark the KED workflow as completed after results are recorded."""
        col = self._db.get_collection(PATIENT_360_COLLECTION)
        ts = completed_at.isoformat()

        result = col.update_one(
            {"patient_id": patient_id},
            {"$set": {
                "interventions.ked_workflow.status": "completed",
                "interventions.ked_workflow.completed_at": ts,
                "interventions.ked_workflow.completed_by": completed_by,
                "interventions.ked_workflow.latest_result_profile": result_profile,
                "interventions.ked_workflow.latest_result_ids": result_ids,
                "interventions.ked_workflow.missing_evidence": [],
                "interventions.ked_workflow.last_updated_at": ts,
                "updated_at": ts,
            }},
        )
        return result.modified_count

    # ------------------------------------------------------------------
    # Follow-up
    # ------------------------------------------------------------------

    def set_ked_follow_up(
        self,
        patient_id: str,
        recommended: bool,
        reason: Optional[str],
        summary: Optional[dict[str, Any]],
    ) -> int:
        """Write follow-up recommendation into the KED workflow state."""
        col = self._db.get_collection(PATIENT_360_COLLECTION)
        ts = datetime.utcnow().isoformat()

        result = col.update_one(
            {"patient_id": patient_id},
            {"$set": {
                "interventions.ked_workflow.follow_up_recommended": recommended,
                "interventions.ked_workflow.follow_up_reason": reason,
                "interventions.ked_workflow.follow_up_summary": summary,
                "interventions.ked_workflow.last_updated_at": ts,
                "updated_at": ts,
            }},
        )
        return result.modified_count

    # ------------------------------------------------------------------
    # Care gap metadata
    # ------------------------------------------------------------------

    def update_ked_gap_metadata(
        self,
        patient_id: str,
        gap_update: dict[str, Any],
    ) -> int:
        """Update KED-specific fields on the care_gaps array element."""
        col = self._db.get_collection(PATIENT_360_COLLECTION)

        set_fields: dict[str, Any] = {
            "updated_at": datetime.utcnow().isoformat(),
        }
        for key, value in gap_update.items():
            set_fields[f"care_gaps.$[ked].{key}"] = value

        result = col.update_one(
            {"patient_id": patient_id},
            {"$set": set_fields},
            array_filters=[{"ked.hedis_measure": "KED"}],
        )
        return result.modified_count
