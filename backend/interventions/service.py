"""
Intervention service.

Orchestrates validation, workflow transitions, deterministic result
generation, and care gap recompute for intervention workflows.

Supports: KED, CDC-HBA.

Responsibilities:
- Validate patient + measure gap exist
- Validate gap is still open / in correct state before mutations
- Build deterministic lab documents from preset profiles
- Map abnormal values to follow-up recommendation
- Trigger care-gap recompute via CDSService
- Return frontend-friendly response objects
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from interventions.models import (
    CdcHbaResultProfile,
    CdcHbaWorkflowStatusResponse,
    GenerateCdcHbaFollowUpSummaryResponse,
    GenerateFollowUpSummaryResponse,
    KedResultProfile,
    KedWorkflowStatusResponse,
    OrderCdcHbaTestResponse,
    OrderKedLabsResponse,
    RecordCdcHbaResultsRequest,
    RecordCdcHbaResultsResponse,
    RecordKedResultsRequest,
    RecordKedResultsResponse,
)
from interventions.repository import (
    InterventionRepository,
    EGFR_LOINC,
    HBA1C_LOINC,
    UACR_LOINC,
)
from cds.repository import CDSRepository
from cds.service import CDSService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# KED preset lab profiles (deterministic demo values)
# ---------------------------------------------------------------------------

RESULT_PROFILES: dict[str, dict[str, Any]] = {
    "stable": {
        "egfr": {"value": 72, "unit": "mL/min/1.73m2", "interpretation": "N"},
        "uacr": {"value": 18, "unit": "mg/g", "interpretation": "N"},
    },
    "abnormal": {
        "egfr": {"value": 38, "unit": "mL/min/1.73m2", "interpretation": "L"},
        "uacr": {"value": 145, "unit": "mg/g", "interpretation": "H"},
    },
    "concerning": {
        "egfr": {"value": 52, "unit": "mL/min/1.73m2", "interpretation": "L"},
        "uacr": {"value": 85, "unit": "mg/g", "interpretation": "H"},
    },
}

# ---------------------------------------------------------------------------
# CDC-HBA preset lab profiles (deterministic demo values)
# ---------------------------------------------------------------------------

CDC_HBA_RESULT_PROFILES: dict[str, dict[str, Any]] = {
    "controlled": {
        "value": 6.7, "unit": "%", "interpretation": "N",
    },
    "elevated": {
        "value": 8.4, "unit": "%", "interpretation": "H",
    },
    "concerning": {
        "value": 10.2, "unit": "%", "interpretation": "HH",
    },
}

HBA1C_FOLLOW_UP_THRESHOLD = 7.0


class InterventionService:
    def __init__(
        self,
        repo: InterventionRepository,
        cds_service: CDSService,
    ):
        self._repo = repo
        self._cds = cds_service

    # ------------------------------------------------------------------
    # GET workflow state
    # ------------------------------------------------------------------

    def get_ked_workflow(self, patient_id: str) -> Optional[KedWorkflowStatusResponse]:
        """Return the current KED workflow state for a patient."""
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        ked_gap = None
        for gap in p360.get("care_gaps", []):
            if gap.get("hedis_measure") == "KED":
                ked_gap = gap
                break

        workflow = p360.get("interventions", {}).get("ked_workflow", {})
        kidney_labs = self._repo.get_kidney_labs(patient_id)

        return KedWorkflowStatusResponse(
            patient_id=patient_id,
            ked_gap_exists=ked_gap is not None,
            ked_gap_open=ked_gap is not None and ked_gap.get("status") == "open",
            workflow_status=workflow.get("status", "not_started"),
            missing_evidence=workflow.get("missing_evidence", ["eGFR", "uACR"]),
            latest_kidney_labs=kidney_labs,
            follow_up_recommended=workflow.get("follow_up_recommended", False),
            follow_up_reason=workflow.get("follow_up_reason"),
            follow_up_summary=workflow.get("follow_up_summary"),
        )

    # ------------------------------------------------------------------
    # Order labs
    # ------------------------------------------------------------------

    def order_ked_labs(
        self,
        patient_id: str,
        ordered_by: str,
    ) -> Optional[OrderKedLabsResponse]:
        """Mark the KED workflow as ordered (labs pending)."""
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        ked_gap = None
        for gap in p360.get("care_gaps", []):
            if gap.get("hedis_measure") == "KED":
                ked_gap = gap
                break

        if not ked_gap or ked_gap.get("status") != "open":
            logger.warning(
                "Cannot order KED labs for %s — gap not open", patient_id,
            )
            return None

        now = datetime.now(timezone.utc)
        self._repo.mark_ked_ordered(patient_id, ordered_by, now)

        return OrderKedLabsResponse(
            patient_id=patient_id,
            workflow_status="ordered",
            ordered_at=now.isoformat(),
            required_evidence=["eGFR", "uACR"],
        )

    # ------------------------------------------------------------------
    # Record results
    # ------------------------------------------------------------------

    def record_ked_results(
        self,
        patient_id: str,
        body: RecordKedResultsRequest,
    ) -> Optional[RecordKedResultsResponse]:
        """Ingest kidney lab results, recompute KED gap, set follow-up."""
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        workflow = p360.get("interventions", {}).get("ked_workflow", {})
        if workflow.get("status") not in ("ordered", "not_started"):
            logger.warning(
                "Cannot record results for %s — workflow status is %s",
                patient_id, workflow.get("status"),
            )
            return None

        now = datetime.now(timezone.utc)
        profile = body.result_profile.value

        # Build lab documents from preset or caller-provided values
        lab_docs = self._build_kidney_lab_documents(profile, body, now)
        result_ids = [lb["result_id"] for lb in lab_docs]

        # 1. Append labs to patient_360.labs
        self._repo.append_kidney_labs(patient_id, lab_docs)

        # 2. Mark workflow completed
        self._repo.set_ked_workflow_completed(
            patient_id, body.recorded_by, now, profile, result_ids,
        )

        # 3. Recompute care gaps (this will close KED because evidence exists)
        recomputed_gaps = self._cds.compute_care_gaps(patient_id)

        # 4. Find updated KED gap status
        ked_gap_status = "open"
        if recomputed_gaps:
            for gap in recomputed_gaps:
                if gap.get("hedis_measure") == "KED":
                    ked_gap_status = gap.get("status", "open")
                    break

        # 5. Update KED gap with workflow-aware metadata
        egfr_val = next(
            (lb["value"] for lb in lab_docs if lb["loinc"] == EGFR_LOINC), 0,
        )
        uacr_val = next(
            (lb["value"] for lb in lab_docs if lb["loinc"] == UACR_LOINC), 0,
        )
        is_abnormal = self._is_abnormal_ked_result(egfr_val, uacr_val)

        evidence_update: dict[str, Any] = {
            "workflow_status": "completed",
            "closure_evidence": {
                "required": ["eGFR", "uACR"],
                "received": ["eGFR", "uACR"],
                "missing": [],
                "closed_at": now.isoformat(),
            },
            "status": "closed",
            "last_completed": now.strftime("%Y-%m-%d"),
            "days_overdue": 0,
            "priority": "low",
        }

        follow_up_reason = None
        if is_abnormal:
            evidence_update["follow_up"] = {
                "recommended": True,
                "reason": "Abnormal kidney evaluation results",
                "status": "pending_review",
            }
            follow_up_reason = "Abnormal kidney evaluation results"
            self._repo.set_ked_follow_up(
                patient_id,
                recommended=True,
                reason=follow_up_reason,
                summary=None,
            )
        else:
            evidence_update["follow_up"] = {
                "recommended": False,
                "reason": None,
                "status": "not_needed",
            }
            self._repo.set_ked_follow_up(
                patient_id,
                recommended=False,
                reason=None,
                summary=None,
            )

        self._repo.update_ked_gap_metadata(patient_id, evidence_update)

        labs_summary = [
            {
                "loinc": lb["loinc"],
                "display": lb["display"],
                "value": lb["value"],
                "unit": lb["unit"],
                "interpretation": lb["interpretation"],
            }
            for lb in lab_docs
        ]

        return RecordKedResultsResponse(
            patient_id=patient_id,
            workflow_status="completed",
            ked_gap_status="closed",
            follow_up_recommended=is_abnormal,
            follow_up_reason=follow_up_reason,
            labs_written=labs_summary,
        )

    # ------------------------------------------------------------------
    # Follow-up summary
    # ------------------------------------------------------------------

    def generate_ked_follow_up_summary(
        self,
        patient_id: str,
        requested_by: str,
    ) -> Optional[GenerateFollowUpSummaryResponse]:
        """Generate a deterministic clinician review summary."""
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        workflow = p360.get("interventions", {}).get("ked_workflow", {})
        if not workflow.get("follow_up_recommended", False):
            return None

        kidney_labs = self._repo.get_kidney_labs(patient_id)
        ked_gap = self._repo.get_ked_gap(patient_id)
        summary = self._build_follow_up_summary(p360, ked_gap, kidney_labs)

        self._repo.set_ked_follow_up(
            patient_id,
            recommended=True,
            reason=workflow.get("follow_up_reason", "Abnormal kidney evaluation results"),
            summary=summary,
        )

        return GenerateFollowUpSummaryResponse(
            title=summary["title"],
            summary=summary["summary"],
            recommendations=summary["recommendations"],
            based_on=summary["based_on"],
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_kidney_lab_documents(
        profile: str,
        body: RecordKedResultsRequest,
        now: datetime,
    ) -> list[dict[str, Any]]:
        """Create lab documents from a preset profile or caller-provided values."""
        preset = RESULT_PROFILES[profile]

        if body.labs:
            egfr_val = body.labs.egfr.value
            egfr_unit = body.labs.egfr.unit
            egfr_date = (body.labs.egfr.effective_date or now).isoformat()
            uacr_val = body.labs.uacr.value
            uacr_unit = body.labs.uacr.unit
            uacr_date = (body.labs.uacr.effective_date or now).isoformat()
            egfr_interp = "L" if egfr_val < 60 else "N"
            uacr_interp = "H" if uacr_val > 30 else "N"
        else:
            egfr_val = preset["egfr"]["value"]
            egfr_unit = preset["egfr"]["unit"]
            egfr_date = now.isoformat()
            uacr_val = preset["uacr"]["value"]
            uacr_unit = preset["uacr"]["unit"]
            uacr_date = now.isoformat()
            egfr_interp = preset["egfr"]["interpretation"]
            uacr_interp = preset["uacr"]["interpretation"]

        return [
            {
                "result_id": str(uuid.uuid4()),
                "loinc": EGFR_LOINC,
                "display": "Estimated glomerular filtration rate",
                "value": egfr_val,
                "unit": egfr_unit,
                "interpretation": egfr_interp,
                "effective_date": egfr_date,
                "source": "demo_ked_workflow",
            },
            {
                "result_id": str(uuid.uuid4()),
                "loinc": UACR_LOINC,
                "display": "Urine albumin/creatinine ratio",
                "value": uacr_val,
                "unit": uacr_unit,
                "interpretation": uacr_interp,
                "effective_date": uacr_date,
                "source": "demo_ked_workflow",
            },
        ]

    @staticmethod
    def _is_abnormal_ked_result(egfr_value: float, uacr_value: float) -> bool:
        """eGFR < 60 or uACR > 30 indicates abnormal kidney function."""
        return egfr_value < 60 or uacr_value > 30

    @staticmethod
    def _build_follow_up_summary(
        patient_doc: dict[str, Any],
        ked_gap: Optional[dict[str, Any]],
        kidney_labs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Build a deterministic clinician review summary from current data."""
        demographics = patient_doc.get("demographics", {})
        patient_name = demographics.get("name", "Patient")
        age = demographics.get("age", "unknown")

        egfr_labs = sorted(
            [lb for lb in kidney_labs if lb.get("loinc") == EGFR_LOINC],
            key=lambda lb: lb.get("effective_date", ""),
            reverse=True,
        )
        uacr_labs = sorted(
            [lb for lb in kidney_labs if lb.get("loinc") == UACR_LOINC],
            key=lambda lb: lb.get("effective_date", ""),
            reverse=True,
        )
        egfr_lab = egfr_labs[0] if egfr_labs else None
        uacr_lab = uacr_labs[0] if uacr_labs else None

        egfr_str = (
            f"{egfr_lab['value']} {egfr_lab['unit']}" if egfr_lab else "not available"
        )
        uacr_str = (
            f"{uacr_lab['value']} {uacr_lab['unit']}" if uacr_lab else "not available"
        )

        recommendations = [
            "Review renal function trend",
            "Assess CKD staging and follow-up plan",
            "Confirm medication review and nephrology referral if needed",
        ]

        if egfr_lab and egfr_lab.get("value", 999) < 30:
            recommendations.append(
                "Urgent nephrology referral — eGFR below 30 mL/min/1.73m2",
            )

        if uacr_lab and uacr_lab.get("value", 0) > 300:
            recommendations.append(
                "Consider ACE inhibitor / ARB therapy for significant albuminuria",
            )

        return {
            "title": "Clinician review recommended after kidney evaluation",
            "summary": (
                f"Kidney evaluation evidence has been completed for {patient_name} "
                f"(age {age}). Results show eGFR {egfr_str} and uACR {uacr_str}. "
                "Follow-up review is recommended even though the KED gap is now closed."
            ),
            "recommendations": recommendations,
            "based_on": {
                "egfr": egfr_lab or {},
                "uacr": uacr_lab or {},
                "patient_id": patient_doc.get("patient_id"),
            },
        }

    # ==================================================================
    # CDC-HBA workflow — public methods
    # ==================================================================

    def get_cdc_hba_workflow(
        self, patient_id: str,
    ) -> Optional[CdcHbaWorkflowStatusResponse]:
        """Return the current CDC-HBA workflow state for a patient."""
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        cdc_gap = None
        for gap in p360.get("care_gaps", []):
            if gap.get("hedis_measure") == "CDC-HBA":
                cdc_gap = gap
                break

        workflow = p360.get("interventions", {}).get("cdc_hba_workflow", {})
        hba1c_labs = self._repo.get_hba1c_labs(patient_id)
        latest_lab = hba1c_labs[0] if hba1c_labs else None

        return CdcHbaWorkflowStatusResponse(
            patient_id=patient_id,
            cdc_hba_gap_exists=cdc_gap is not None,
            cdc_hba_gap_open=cdc_gap is not None and cdc_gap.get("status") == "open",
            workflow_status=workflow.get("status", "not_started"),
            missing_evidence=workflow.get("missing_evidence", ["HbA1c"]),
            latest_hba1c_lab=latest_lab,
            follow_up_recommended=workflow.get("follow_up_recommended", False),
            follow_up_reason=workflow.get("follow_up_reason"),
            follow_up_summary=workflow.get("follow_up_summary"),
        )

    def order_cdc_hba_test(
        self,
        patient_id: str,
        ordered_by: str,
    ) -> Optional[OrderCdcHbaTestResponse]:
        """Mark the CDC-HBA workflow as ordered (HbA1c test pending)."""
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        cdc_gap = None
        for gap in p360.get("care_gaps", []):
            if gap.get("hedis_measure") == "CDC-HBA":
                cdc_gap = gap
                break

        if not cdc_gap or cdc_gap.get("status") != "open":
            logger.warning(
                "Cannot order CDC-HBA test for %s — gap not open", patient_id,
            )
            return None

        now = datetime.now(timezone.utc)
        self._repo.mark_cdc_hba_ordered(patient_id, ordered_by, now)

        return OrderCdcHbaTestResponse(
            patient_id=patient_id,
            workflow_status="ordered",
            ordered_at=now.isoformat(),
            required_evidence=["HbA1c"],
        )

    def record_cdc_hba_results(
        self,
        patient_id: str,
        body: RecordCdcHbaResultsRequest,
    ) -> Optional[RecordCdcHbaResultsResponse]:
        """Ingest HbA1c result, recompute CDC-HBA gap, set follow-up."""
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        workflow = p360.get("interventions", {}).get("cdc_hba_workflow", {})
        if workflow.get("status") not in ("ordered", "not_started"):
            logger.warning(
                "Cannot record CDC-HBA results for %s — workflow status is %s",
                patient_id, workflow.get("status"),
            )
            return None

        now = datetime.now(timezone.utc)
        profile = body.result_profile.value

        lab_doc = self._build_hba1c_lab_document(profile, body, now)
        result_ids = [lab_doc["result_id"]]

        self._repo.append_hba1c_lab(patient_id, lab_doc)

        self._repo.set_cdc_hba_workflow_completed(
            patient_id, body.recorded_by, now, profile, result_ids,
        )

        recomputed_gaps = self._cds.compute_care_gaps(patient_id)

        cdc_gap_status = "open"
        if recomputed_gaps:
            for gap in recomputed_gaps:
                if gap.get("hedis_measure") == "CDC-HBA":
                    cdc_gap_status = gap.get("status", "open")
                    break

        hba1c_value = lab_doc["value"]
        needs_follow_up = self._is_elevated_hba1c(hba1c_value)

        evidence_update: dict[str, Any] = {
            "workflow_status": "completed",
            "closure_evidence": {
                "required": ["HbA1c"],
                "received": ["HbA1c"],
                "missing": [],
                "closed_at": now.isoformat(),
            },
            "status": "closed",
            "last_completed": now.strftime("%Y-%m-%d"),
            "days_overdue": 0,
            "priority": "low",
        }

        follow_up_reason = None
        if needs_follow_up:
            follow_up_reason = "Elevated HbA1c result"
            evidence_update["follow_up"] = {
                "recommended": True,
                "reason": follow_up_reason,
                "status": "pending_review",
            }
            self._repo.set_cdc_hba_follow_up(
                patient_id,
                recommended=True,
                reason=follow_up_reason,
                summary=None,
            )
        else:
            evidence_update["follow_up"] = {
                "recommended": False,
                "reason": None,
                "status": "not_needed",
            }
            self._repo.set_cdc_hba_follow_up(
                patient_id,
                recommended=False,
                reason=None,
                summary=None,
            )

        self._repo.update_cdc_hba_gap_metadata(patient_id, evidence_update)

        lab_summary = {
            "loinc": lab_doc["loinc"],
            "display": lab_doc["display"],
            "value": lab_doc["value"],
            "unit": lab_doc["unit"],
            "interpretation": lab_doc["interpretation"],
        }

        return RecordCdcHbaResultsResponse(
            patient_id=patient_id,
            workflow_status="completed",
            cdc_hba_gap_status="closed",
            follow_up_recommended=needs_follow_up,
            follow_up_reason=follow_up_reason,
            lab_written=lab_summary,
        )

    def generate_cdc_hba_follow_up_summary(
        self,
        patient_id: str,
        requested_by: str,
    ) -> Optional[GenerateCdcHbaFollowUpSummaryResponse]:
        """Generate a deterministic clinician review summary for CDC-HBA."""
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return None

        workflow = p360.get("interventions", {}).get("cdc_hba_workflow", {})
        if not workflow.get("follow_up_recommended", False):
            return None

        hba1c_labs = self._repo.get_hba1c_labs(patient_id)
        cdc_gap = self._repo.get_cdc_hba_gap(patient_id)
        latest_lab = hba1c_labs[0] if hba1c_labs else None
        summary = self._build_cdc_hba_follow_up_summary(p360, cdc_gap, latest_lab)

        self._repo.set_cdc_hba_follow_up(
            patient_id,
            recommended=True,
            reason=workflow.get("follow_up_reason", "Elevated HbA1c result"),
            summary=summary,
        )

        return GenerateCdcHbaFollowUpSummaryResponse(
            title=summary["title"],
            summary=summary["summary"],
            recommendations=summary["recommendations"],
            based_on=summary["based_on"],
        )

    # ==================================================================
    # CDC-HBA private helpers
    # ==================================================================

    @staticmethod
    def _build_hba1c_lab_document(
        profile: str,
        body: RecordCdcHbaResultsRequest,
        now: datetime,
    ) -> dict[str, Any]:
        """Create an HbA1c lab document from a preset profile or caller-provided value."""
        preset = CDC_HBA_RESULT_PROFILES[profile]

        if body.lab:
            value = body.lab.value
            unit = body.lab.unit
            effective_date = (body.lab.effective_date or now).isoformat()
            interpretation = "H" if value >= HBA1C_FOLLOW_UP_THRESHOLD else "N"
        else:
            value = preset["value"]
            unit = preset["unit"]
            effective_date = now.isoformat()
            interpretation = preset["interpretation"]

        return {
            "result_id": str(uuid.uuid4()),
            "loinc": HBA1C_LOINC,
            "display": "Hemoglobin A1c/Hemoglobin.total in Blood",
            "value": value,
            "unit": unit,
            "interpretation": interpretation,
            "effective_date": effective_date,
            "source": "demo_cdc_hba_workflow",
        }

    @staticmethod
    def _is_elevated_hba1c(value: float) -> bool:
        """HbA1c >= 7.0 % is considered elevated and triggers follow-up."""
        return value >= HBA1C_FOLLOW_UP_THRESHOLD

    @staticmethod
    def _build_cdc_hba_follow_up_summary(
        patient_doc: dict[str, Any],
        cdc_gap: Optional[dict[str, Any]],
        latest_lab: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        """Build a deterministic clinician review summary for elevated HbA1c."""
        demographics = patient_doc.get("demographics", {})
        patient_name = demographics.get("name", "Patient")
        age = demographics.get("age", "unknown")

        hba1c_str = (
            f"{latest_lab['value']} {latest_lab['unit']}"
            if latest_lab else "not available"
        )

        recommendations = [
            "Review glycemic control trend",
            "Assess diabetes follow-up plan",
            "Confirm medication adherence and follow-up interval",
        ]

        if latest_lab and latest_lab.get("value", 0) >= 10.0:
            recommendations.append(
                "Urgent endocrinology referral — HbA1c at or above 10 %",
            )

        return {
            "title": "Clinician review recommended after HbA1c testing",
            "summary": (
                f"HbA1c testing has been completed for {patient_name} "
                f"(age {age}). The result is {hba1c_str}, which is above the "
                "expected target range. Follow-up review is recommended even "
                "though the CDC-HBA care gap is now closed."
            ),
            "recommendations": recommendations,
            "based_on": {
                "hba1c": latest_lab or {},
                "patient_id": patient_doc.get("patient_id"),
            },
        }
