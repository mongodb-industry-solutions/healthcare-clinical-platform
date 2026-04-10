"""
CDS Hooks service.

Reads Patient 360 documents (alerts + care gaps) and builds
DaVinci-spec CDS Cards for EHR consumption.

All business logic lives here — no HTTP, no direct MongoDB queries.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from hooks.models import (
    CDSCard,
    CDSCardExtensions,
    CDSDiscoveryResponse,
    CDSHooksResponse,
    CDSLink,
    CDSProvenanceResponse,
    CDSServiceDefinition,
    CDSSource,
    CDSSuggestion,
    CDSVitalTrigger,
)
from hooks.repository import HooksRepository

_SOURCE = CDSSource(
    label="MedWatch Health CDS",
    url="https://medwatch.health",
)

_CARE_GAP_UUID_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

_SEVERITY_TO_INDICATOR = {
    "critical": "critical",
    "high": "warning",
    "moderate": "info",
    "low": "info",
}

_CARE_GAP_PRIORITY_TO_INDICATOR = {
    "critical": "critical",
    "high": "warning",
    "moderate": "info",
    "low": "info",
}

RULE_CLINICAL_WEIGHT = {
    "cds_sepsis_warning": 100,
    "cds_hypoglycemia": 85,
    "cds_ckd_respiratory": 70,
    "cds_beta_blocker_hr": 55,
    "cds_comparative_context": 40,
}

INDICATOR_WEIGHT = {"critical": 300, "warning": 200, "info": 100}

_VITAL_UNITS = {
    "heart_rate": "bpm",
    "spo2": "%",
    "respiratory_rate": "br/min",
    "temperature": "°C",
}

_FLAG_LABELS = {
    "has_beta_blocker": "Beta-blocker therapy",
    "has_insulin": "Insulin-treated diabetes",
    "has_ckd": "CKD context",
    "has_ace_inhibitor": "ACE inhibitor therapy",
}

MEASURE_ACTIONS: dict[str, dict] = {
    "CDC-HBA": {
        "primary": "Schedule or order an HbA1c follow-up",
        "contextual": {
            "has_insulin": "Confirm glycemic follow-up timing if glucose instability continues",
            "default": "Confirm diabetes follow-up is active before routing outreach",
        },
    },
    "KED": {
        "primary": "Order kidney evaluation labs and route follow-up",
        "contextual": {
            "has_ckd": "Prioritize eGFR and uACR completion — CKD context",
            "default": "Confirm kidney monitoring is not already pending",
        },
    },
    "CBP": {
        "primary": "Schedule blood pressure follow-up and confirm control plan",
        "contextual": {"default": "Confirm blood pressure follow-up and control plan"},
    },
    "SPD": {
        "primary": "Review statin therapy gap and route medication follow-up",
        "contextual": {"default": "Review statin therapy gap and route medication follow-up"},
    },
    "EED": {
        "primary": "Schedule diabetic eye exam outreach",
        "contextual": {"default": "Initiate retinal exam outreach and close the referral loop"},
    },
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
        each into a DaVinci-spec CDS Card enriched with extensions.
        Cards are returned pre-sorted by ranking_weight descending.
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

        alerts = self._repo.get_active_alerts(patient_id)
        rules_by_id = {r["rule_id"]: r for r in self._repo.get_all_rules()}

        cards: list[CDSCard] = []

        for alert in alerts:
            rule = rules_by_id.get(alert.get("rule_id"))
            cards.append(self._alert_to_card(alert, patient_id, p360, rule))

        for gap in p360.get("care_gaps", []):
            if gap.get("status") == "open":
                cards.append(self._care_gap_to_card(gap, patient_id, p360))

        cards.sort(key=lambda c: -(c.extensions.ranking_weight if c.extensions else 0))

        return CDSHooksResponse(cards=cards)

    # ------------------------------------------------------------------
    # Card builders
    # ------------------------------------------------------------------

    def _alert_to_card(
        self,
        alert: dict[str, Any],
        patient_id: str,
        p360: dict[str, Any],
        rule: dict[str, Any] | None,
    ) -> CDSCard:
        """Convert an alert document into an enriched CDS Card."""
        severity = alert.get("severity", "moderate")
        indicator = _SEVERITY_TO_INDICATOR.get(severity, "info")
        rule_id = alert.get("rule_id")

        suggestions = self._enrich_alert_suggestions(alert, p360, rule)
        vital_triggers = self._extract_vital_triggers(alert, p360)
        context_factors = (
            self._get_card_context_factors(rule, p360) if rule else []
        )

        days_overdue = 0
        priority = severity
        measure_code = alert.get("hedis_measure")

        weight = self._compute_card_weight(
            card_type="alert",
            rule_id=rule_id,
            indicator=indicator,
            days_overdue=days_overdue,
            priority=priority,
        )

        extensions = CDSCardExtensions(
            card_type="alert",
            measure_code=measure_code,
            rule_id=rule_id,
            rule_name=rule.get("name") if rule else None,
            days_overdue=None,
            priority=priority,
            context_factors=context_factors,
            vital_triggers=vital_triggers,
            escalation_reason=None,
            ranking_weight=weight,
        )

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
            extensions=extensions,
        )

    def _care_gap_to_card(
        self,
        gap: dict[str, Any],
        patient_id: str,
        p360: dict[str, Any],
    ) -> CDSCard:
        """Convert an open HEDIS care gap into an enriched CDS Card."""
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

        suggestions = self._build_care_gap_suggestions(gap, p360)
        context_factors = self._get_care_gap_context_factors(gap, p360)
        escalation_reason = self._get_escalation_reason(gap, p360)

        weight = self._compute_card_weight(
            card_type="care_gap",
            rule_id=None,
            indicator=indicator,
            days_overdue=days_overdue,
            priority=priority,
        )

        extensions = CDSCardExtensions(
            card_type="care_gap",
            measure_code=measure,
            rule_id=None,
            rule_name=None,
            days_overdue=days_overdue if days_overdue > 0 else None,
            priority=priority,
            context_factors=context_factors,
            vital_triggers=[],
            escalation_reason=escalation_reason,
            ranking_weight=weight,
        )

        stable_uuid = str(uuid.uuid5(_CARE_GAP_UUID_NS, f"{patient_id}:{measure}"))

        return CDSCard(
            uuid=stable_uuid,
            summary=f"Care Gap: {measure_name}",
            detail=". ".join(detail_parts) + ".",
            indicator=indicator,
            source=_SOURCE,
            suggestions=suggestions,
            links=[
                CDSLink(
                    label="View Patient Care Gaps",
                    url=f"/dashboard/patients/{patient_id}",
                    type="absolute",
                ),
            ],
            extensions=extensions,
        )

    # ------------------------------------------------------------------
    # Card ranking
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_card_weight(
        card_type: str,
        rule_id: str | None,
        indicator: str,
        days_overdue: int,
        priority: str,
    ) -> int:
        weight = INDICATOR_WEIGHT.get(indicator, 100)
        if card_type == "alert":
            weight += RULE_CLINICAL_WEIGHT.get(rule_id or "", 30)
        elif card_type == "care_gap":
            priority_weight = {"critical": 80, "high": 60, "moderate": 40, "low": 20}
            weight += priority_weight.get(priority, 20)
            weight += min(days_overdue, 120)
        return weight

    # ------------------------------------------------------------------
    # Card-specific context factors
    # ------------------------------------------------------------------

    @staticmethod
    def _get_card_context_factors(rule: dict, p360: dict) -> list[str]:
        """Return only the context factors that made THIS rule applicable."""
        factors: list[str] = []
        applicability = rule.get("applicability", {})
        flags = p360.get("flags", {})

        for flag in applicability.get("flags", []):
            if flags.get(flag):
                factors.append(_FLAG_LABELS.get(flag, flag))

        age = p360.get("demographics", {}).get("age", 0)
        min_age = applicability.get("min_age")
        if min_age and age >= min_age:
            factors.append(f"Age {age} (≥{min_age})")

        conditions = p360.get("conditions", [])
        required_conditions = applicability.get("conditions", [])
        condition_names = {c.get("code"): c.get("display", "") for c in conditions}
        for code in required_conditions:
            if code in condition_names:
                factors.append(condition_names[code])

        return factors

    @staticmethod
    def _get_care_gap_context_factors(gap: dict, p360: dict) -> list[str]:
        """Derive context factors for a care gap from HEDIS measure applicability."""
        factors: list[str] = []
        flags = p360.get("flags", {})
        conditions = p360.get("conditions", [])
        condition_names = {c.get("code"): c.get("display", "") for c in conditions}

        measure = gap.get("hedis_measure", "")
        _MEASURE_APPLICABLE: dict[str, dict] = {
            "CDC-HBA": {"conditions": ["44054006"], "flags": []},
            "KED": {"conditions": ["44054006", "433144002"], "flags": ["has_ckd"]},
            "CBP": {"conditions": ["44054006", "59621000"], "flags": []},
            "SPD": {"conditions": ["44054006"], "flags": []},
            "EED": {"conditions": ["44054006"], "flags": []},
        }
        applicable = _MEASURE_APPLICABLE.get(measure, {})
        for flag in applicable.get("flags", []):
            if flags.get(flag):
                factors.append(_FLAG_LABELS.get(flag, flag))
        for code in applicable.get("conditions", []):
            if code in condition_names:
                factors.append(condition_names[code])

        return factors

    # ------------------------------------------------------------------
    # Vital triggers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_vital_triggers(alert: dict, p360: dict) -> list[CDSVitalTrigger]:
        """Map contributing_vitals against personalized_thresholds."""
        triggers: list[CDSVitalTrigger] = []
        contributing = alert.get("contributing_vitals", {})
        thresholds = p360.get("personalized_thresholds", {})

        for vital, unit in _VITAL_UNITS.items():
            value = contributing.get(vital)
            pt = thresholds.get(vital, {})
            if value is None:
                continue
            high = pt.get("high")
            low = pt.get("low")
            if high is not None and value > high:
                triggers.append(CDSVitalTrigger(
                    vital=vital, value=round(value, 1), threshold=high,
                    direction="above", unit=unit, source_rule=pt.get("source_rule"),
                ))
            elif low is not None and value < low:
                triggers.append(CDSVitalTrigger(
                    vital=vital, value=round(value, 1), threshold=low,
                    direction="below", unit=unit, source_rule=pt.get("source_rule"),
                ))

        return triggers

    # ------------------------------------------------------------------
    # Escalation reason (care gaps)
    # ------------------------------------------------------------------

    @staticmethod
    def _get_escalation_reason(gap: dict, p360: dict) -> str | None:
        """Explain why a care gap's priority was escalated, if applicable."""
        priority = gap.get("priority", "moderate")
        if priority not in ("critical", "high"):
            return None

        measure = gap.get("hedis_measure", "")
        flags = p360.get("flags", {})
        reasons: list[str] = []

        if flags.get("has_ckd") and measure == "KED":
            reasons.append("CKD comorbidity increases urgency for kidney evaluation")
        if flags.get("has_insulin") and measure == "CDC-HBA":
            reasons.append("Insulin therapy requires tighter glycemic monitoring")

        days = gap.get("days_overdue", 0)
        if days > 60:
            reasons.append(f"{days} days overdue")

        if not reasons:
            return None
        return f"Priority escalated to {priority}: " + "; ".join(reasons)

    # ------------------------------------------------------------------
    # Enriched suggestions
    # ------------------------------------------------------------------

    @staticmethod
    def _enrich_alert_suggestions(
        alert: dict,
        p360: dict,
        rule: dict | None,
    ) -> list[CDSSuggestion]:
        base_actions = alert.get("suggested_actions", [])
        enriched: list[CDSSuggestion] = []
        contributing = alert.get("contributing_vitals", {})
        medications = p360.get("medications", [])

        for action in base_actions:
            label = action
            if "blood glucose" in label.lower() and contributing.get("heart_rate"):
                label = f"{label} — HR currently {contributing['heart_rate']:.0f} bpm"
            if "beta-blocker" in label.lower() or "medication compliance" in label.lower():
                bb_meds = [
                    m["display"] for m in medications
                    if any(d in m.get("display", "").lower()
                           for d in ("atenolol", "metoprolol", "propranolol"))
                ]
                if bb_meds:
                    label = f"{label} (current: {bb_meds[0]})"
            enriched.append(CDSSuggestion(label=label, uuid=str(uuid.uuid4())))

        rule_id = rule.get("rule_id", "") if rule else ""
        alert_type = alert.get("alert_type", "")
        if alert_type == "multi_factor" and rule_id == "cds_hypoglycemia":
            if not any("glucose" in s.label.lower() for s in enriched):
                enriched.insert(0, CDSSuggestion(
                    label="Check point-of-care glucose and review insulin timing",
                    uuid=str(uuid.uuid4()),
                ))
        if alert_type == "multi_factor" and rule_id == "cds_sepsis_warning":
            if not any("cultures" in s.label.lower() for s in enriched):
                enriched.insert(0, CDSSuggestion(
                    label="Evaluate for infection source and obtain cultures",
                    uuid=str(uuid.uuid4()),
                ))

        return enriched[:6]

    @staticmethod
    def _build_care_gap_suggestions(gap: dict, p360: dict) -> list[CDSSuggestion]:
        measure = gap.get("hedis_measure", "")
        meta = MEASURE_ACTIONS.get(measure, {})
        suggestions: list[CDSSuggestion] = []

        primary = meta.get("primary", f"Advance {measure} gap closure workflow")
        suggestions.append(CDSSuggestion(label=primary, uuid=str(uuid.uuid4())))

        contextual = meta.get("contextual", {})
        flags = p360.get("flags", {})
        added_contextual = False
        for flag, action in contextual.items():
            if flag != "default" and flags.get(flag):
                suggestions.append(CDSSuggestion(label=action, uuid=str(uuid.uuid4())))
                added_contextual = True
                break
        if not added_contextual and "default" in contextual:
            suggestions.append(CDSSuggestion(
                label=contextual["default"], uuid=str(uuid.uuid4()),
            ))

        return suggestions

    # ------------------------------------------------------------------
    # Provenance
    # ------------------------------------------------------------------

    def get_card_provenance(self, patient_id: str, card_uuid: str) -> CDSProvenanceResponse:
        """Return full provenance for a single CDS Card."""
        response = self.evaluate_patient_view(patient_id)
        card = next((c for c in response.cards if c.uuid == card_uuid), None)
        if not card:
            raise ValueError(f"Card {card_uuid} not found")

        p360 = self._repo.get_patient_360(patient_id)
        ext = card.extensions
        source_rule: dict | None = None
        care_gap_doc: dict | None = None
        alert_doc: dict | None = None

        if ext:
            if ext.rule_id:
                source_rule = self._repo.get_rule_by_id(ext.rule_id)
            if ext.card_type == "care_gap" and ext.measure_code:
                care_gap_doc = next(
                    (g for g in (p360 or {}).get("care_gaps", [])
                     if g.get("hedis_measure") == ext.measure_code),
                    None,
                )
                if not source_rule:
                    related = self._repo.get_rules_by_hedis_measure(ext.measure_code)
                    if related:
                        source_rule = related[0]
            if ext.card_type == "alert":
                alert_doc = self._repo.get_alert_by_id(card.uuid)
                if not source_rule and alert_doc and alert_doc.get("rule_id"):
                    source_rule = self._repo.get_rule_by_id(alert_doc["rule_id"])

        patient_context: dict = {}
        if p360:
            patient_context = {
                "flags": p360.get("flags", {}),
                "personalized_thresholds": p360.get("personalized_thresholds", {}),
                "conditions": [
                    {"code": c.get("code"), "display": c.get("display")}
                    for c in p360.get("conditions", [])
                ],
            }

        return CDSProvenanceResponse(
            card=card,
            source_rule=source_rule,
            care_gap_document=care_gap_doc,
            alert_document=alert_doc,
            patient_context=patient_context,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )
