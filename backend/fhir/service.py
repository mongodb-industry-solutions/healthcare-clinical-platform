"""
FHIR DEQM service — transforms internal CareGap dicts into FHIR
MeasureReport + DetectedIssue resources for the $care-gaps operation.

No business logic duplication: delegates to QualityEngine for gap
computation and only handles the FHIR serialization layer.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from cds.quality_engine import QualityEngine
from cds.repository import CDSRepository
from fhir.models import (
    FHIRCareGapBundle,
    FHIRDetectedIssue,
    FHIRMeasureReport,
)

HEDIS_MEASURE_URLS: dict[str, str] = {
    "CDC-HBA": "https://ncqa.org/hedis/measures/comprehensive-diabetes-care-hba1c",
    "KED": "https://ncqa.org/hedis/measures/kidney-health-evaluation-diabetes",
    "CBP": "https://ncqa.org/hedis/measures/controlling-high-blood-pressure",
    "SPD": "https://ncqa.org/hedis/measures/statin-therapy-patients-with-diabetes",
    "EED": "https://ncqa.org/hedis/measures/eye-exam-patients-with-diabetes",
}


class FHIRService:
    def __init__(self, repo: CDSRepository):
        self._quality = QualityEngine(repo)
        self._repo = repo

    def care_gaps_operation(
        self,
        patient_id: str,
        period_start: str,
        period_end: str,
        status_filter: str = "open-gap",
    ) -> FHIRCareGapBundle:
        """
        Execute the DEQM $care-gaps operation for a single patient.

        Computes care gaps via QualityEngine, then transforms the results
        into a FHIR Bundle containing MeasureReport + DetectedIssue entries.
        """
        gaps = self._quality.compute_care_gaps(patient_id)
        if gaps is None:
            return FHIRCareGapBundle(
                id=str(uuid.uuid4()),
                total=0,
                entry=[],
            )

        if status_filter == "open-gap":
            gaps = [g for g in gaps if g.get("status") == "open"]
        elif status_filter == "closed-gap":
            gaps = [g for g in gaps if g.get("status") == "closed"]

        now = datetime.now(timezone.utc).isoformat()
        entries: list[dict[str, Any]] = []

        for gap in gaps:
            measure_code = gap.get("hedis_measure", "")
            measure_url = HEDIS_MEASURE_URLS.get(measure_code, f"https://ncqa.org/hedis/measures/{measure_code}")

            report_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{patient_id}:{measure_code}:report"))
            measure_report = FHIRMeasureReport(
                id=report_id,
                measure=measure_url,
                subject={"reference": f"Patient/{patient_id}"},
                date=now,
                period={"start": period_start, "end": period_end},
                group=[
                    {
                        "code": {
                            "coding": [{"system": "https://ncqa.org/hedis", "code": measure_code}],
                            "text": gap.get("measure_name", ""),
                        },
                        "population": [
                            {"code": {"text": "initial-population"}, "count": 1},
                            {"code": {"text": "denominator"}, "count": 1},
                            {
                                "code": {"text": "numerator"},
                                "count": 1 if gap.get("status") == "closed" else 0,
                            },
                        ],
                        "measureScore": {
                            "value": 1.0 if gap.get("status") == "closed" else 0.0,
                        },
                    }
                ],
                evaluatedResource=[
                    {"reference": ref}
                    for ref in gap.get("evidence", {}).get("source_resources", [])
                ],
            )

            entries.append({
                "fullUrl": f"urn:uuid:{report_id}",
                "resource": measure_report.model_dump(),
            })

            if gap.get("status") == "open":
                issue_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{patient_id}:{measure_code}:issue"))
                evidence_items = []
                for found in gap.get("evidence", {}).get("found", []):
                    evidence_items.append({"detail": [{"text": found}]})
                for missing in gap.get("evidence", {}).get("missing", []):
                    evidence_items.append({"detail": [{"text": f"MISSING: {missing}"}]})

                detected_issue = FHIRDetectedIssue(
                    id=issue_id,
                    code={
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                            "code": "CAREGAP",
                            "display": "Care Gap",
                        }],
                        "text": f"Open care gap: {gap.get('measure_name', '')}",
                    },
                    patient={"reference": f"Patient/{patient_id}"},
                    identifiedDateTime=now,
                    evidence=evidence_items,
                    detail=gap.get("reason", "") or "",
                )

                entries.append({
                    "fullUrl": f"urn:uuid:{issue_id}",
                    "resource": detected_issue.model_dump(),
                })

        return FHIRCareGapBundle(
            id=str(uuid.uuid4()),
            total=len(entries),
            entry=entries,
        )
