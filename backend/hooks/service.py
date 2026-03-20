"""
CDS Hooks service.

Reads Patient 360 documents (alerts + care gaps) and builds
DaVinci-spec CDS Cards for EHR consumption.

All business logic lives here — no HTTP, no direct MongoDB queries.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from hooks.models import (
    CDSCard,
    CDSDiscoveryResponse,
    CDSHooksResponse,
    CDSLink,
    CDSServiceDefinition,
    CDSSource,
    CDSSuggestion,
)
from hooks.repository import HooksRepository

_SOURCE = CDSSource(
    label="MedWatch Health CDS",
    url="https://medwatch.health",
)

_SEVERITY_TO_INDICATOR = {
    "critical": "critical",
    "high": "warning",
    "moderate": "info",
    "low": "info",
}

_INDICATOR_SORT_ORDER = {"critical": 0, "warning": 1, "info": 2}

_CARE_GAP_PRIORITY_TO_INDICATOR = {
    "critical": "critical",
    "high": "warning",
    "moderate": "info",
    "low": "info",
}


class HooksService:
    def __init__(self, repo: HooksRepository):
        self._repo = repo

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    @staticmethod
    def get_discovery() -> CDSDiscoveryResponse:
        """Return the list of CDS services this platform exposes."""
        return CDSDiscoveryResponse(
            services=[
                CDSServiceDefinition(
                    hook="patient-view",
                    title="MedWatch Clinical Decision Support",
                    description=(
                        "Provides real-time clinical alerts and HEDIS care gap "
                        "cards when a patient chart is opened. Alerts are "
                        "personalized based on the patient's conditions, "
                        "medications, and continuous wearable vitals."
                    ),
                    id="patient-view",
                    prefetch={
                        "patient": "Patient/{{context.patientId}}",
                    },
                ),
            ],
        )

    # ------------------------------------------------------------------
    # patient-view hook
    # ------------------------------------------------------------------

    def evaluate_patient_view(self, patient_id: str) -> CDSHooksResponse:
        """
        Build CDS Cards for a patient-view hook invocation.

        Reads the Patient 360 (active alerts + care gaps) and any
        non-resolved alerts from the alerts collection, then maps
        each into a DaVinci-spec CDS Card.
        """
        p360 = self._repo.get_patient_360(patient_id)
        if not p360:
            return CDSHooksResponse(cards=[
                CDSCard(
                    uuid=str(uuid.uuid4()),
                    summary="Patient not found",
                    detail=f"No Patient 360 record exists for ID {patient_id}.",
                    indicator="info",
                    source=_SOURCE,
                ),
            ])

        cards: list[CDSCard] = []

        alerts = self._repo.get_active_alerts(patient_id)
        for alert in alerts:
            cards.append(self._alert_to_card(alert, patient_id))

        care_gaps = p360.get("care_gaps", [])
        for gap in care_gaps:
            if gap.get("status") == "open":
                cards.append(self._care_gap_to_card(gap, patient_id))

        cards.sort(key=lambda c: _INDICATOR_SORT_ORDER.get(c.indicator, 2))

        return CDSHooksResponse(cards=cards)

    # ------------------------------------------------------------------
    # Card builders
    # ------------------------------------------------------------------

    @staticmethod
    def _alert_to_card(alert: dict[str, Any], patient_id: str) -> CDSCard:
        """Convert an alert document into a CDS Card."""
        severity = alert.get("severity", "moderate")
        indicator = _SEVERITY_TO_INDICATOR.get(severity, "info")

        suggestions = [
            CDSSuggestion(label=action, uuid=str(uuid.uuid4()))
            for action in alert.get("suggested_actions", [])
        ]

        return CDSCard(
            uuid=alert.get("alert_id", str(uuid.uuid4())),
            summary=alert.get("title", "Clinical Alert"),
            detail=alert.get("reasoning", ""),
            indicator=indicator,
            source=_SOURCE,
            suggestions=suggestions,
            links=[
                CDSLink(
                    label="View in MedWatch Dashboard",
                    url=f"/dashboard/patients/{patient_id}",
                    type="absolute",
                ),
            ],
        )

    @staticmethod
    def _care_gap_to_card(gap: dict[str, Any], patient_id: str) -> CDSCard:
        """Convert an open HEDIS care gap into a CDS Card."""
        priority = gap.get("priority", "moderate")
        indicator = _CARE_GAP_PRIORITY_TO_INDICATOR.get(priority, "info")

        measure = gap.get("hedis_measure", "")
        measure_name = gap.get("measure_name", "")

        detail_parts = [f"HEDIS Measure: {measure} — {measure_name}"]
        if gap.get("last_completed"):
            detail_parts.append(f"Last completed: {gap['last_completed']}")
        if gap.get("due_by"):
            detail_parts.append(f"Due by: {gap['due_by']}")
        days_overdue = gap.get("days_overdue", 0)
        if days_overdue > 0:
            detail_parts.append(f"Days overdue: {days_overdue}")

        return CDSCard(
            uuid=str(uuid.uuid4()),
            summary=f"Care Gap: {measure_name}",
            detail=". ".join(detail_parts) + ".",
            indicator=indicator,
            source=_SOURCE,
            suggestions=[
                CDSSuggestion(
                    label=f"Schedule {measure_name}",
                    uuid=str(uuid.uuid4()),
                ),
            ],
            links=[
                CDSLink(
                    label="View Patient Care Gaps",
                    url=f"/dashboard/patients/{patient_id}",
                    type="absolute",
                ),
            ],
        )
