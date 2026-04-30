"""
Attribution service — simplified Da Vinci ATR-style provider attribution.

For the demo, auto-generates provider-patient relationships based on
each patient's source_hospital. Each patient gets a PCP and a care
coordinator attribution.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from attribution.models import (
    PatientAttributionsResponse,
    ProviderSummary,
    SeedAttributionsResponse,
)
from attribution.repository import AttributionRepository

DEMO_PROVIDERS: dict[str, list[dict[str, str]]] = {
    "st_marys": [
        {"provider_id": "prov-sm-001", "provider_name": "Dr. Sarah Chen", "provider_role": "pcp", "organization": "St. Mary's Medical Center"},
        {"provider_id": "prov-sm-002", "provider_name": "Maria Torres, RN", "provider_role": "care_coordinator", "organization": "St. Mary's Medical Center"},
    ],
    "regional_general": [
        {"provider_id": "prov-rg-001", "provider_name": "Dr. James Park", "provider_role": "pcp", "organization": "Regional General Hospital"},
        {"provider_id": "prov-rg-002", "provider_name": "Linda Okafor, RN", "provider_role": "care_coordinator", "organization": "Regional General Hospital"},
    ],
    "community_health": [
        {"provider_id": "prov-ch-001", "provider_name": "Dr. Emily Rodriguez", "provider_role": "pcp", "organization": "Community Health Partners"},
        {"provider_id": "prov-ch-002", "provider_name": "David Kim, RN", "provider_role": "care_coordinator", "organization": "Community Health Partners"},
    ],
}

DEFAULT_PROVIDERS = [
    {"provider_id": "prov-default-001", "provider_name": "Dr. Default Provider", "provider_role": "pcp", "organization": "Demo Health System"},
    {"provider_id": "prov-default-002", "provider_name": "Default Coordinator, RN", "provider_role": "care_coordinator", "organization": "Demo Health System"},
]


class AttributionService:
    def __init__(self, repo: AttributionRepository):
        self._repo = repo

    def seed_attributions(self) -> SeedAttributionsResponse:
        self._repo.clear_all()

        patient_docs = self._repo.get_all_patient_360_ids()
        total = len(patient_docs)
        created = 0
        errors: list[str] = []

        now = datetime.now(timezone.utc)
        period_start = (now - timedelta(days=365)).strftime("%Y-%m-%d")

        for doc in patient_docs:
            patient_id = doc.get("patient_id", "")
            hospital = doc.get("source_hospital", "")
            providers = DEMO_PROVIDERS.get(hospital, DEFAULT_PROVIDERS)

            for prov in providers:
                attr_id = str(uuid.uuid5(
                    uuid.NAMESPACE_DNS,
                    f"{patient_id}:{prov['provider_id']}",
                ))
                attribution = {
                    "attribution_id": attr_id,
                    "patient_id": patient_id,
                    "provider_id": prov["provider_id"],
                    "provider_name": prov["provider_name"],
                    "provider_role": prov["provider_role"],
                    "organization": prov["organization"],
                    "relationship_type": "attributed",
                    "period_start": period_start,
                    "period_end": None,
                    "source": "roster",
                    "verified": True,
                }
                try:
                    self._repo.upsert_attribution(attr_id, attribution)
                    created += 1
                except Exception as exc:
                    errors.append(f"Patient {patient_id}: {exc}")

        return SeedAttributionsResponse(
            total_patients=total,
            attributions_created=created,
            errors=errors,
        )

    def get_patient_attributions(
        self, patient_id: str,
    ) -> PatientAttributionsResponse:
        attrs = self._repo.get_attributions_for_patient(patient_id)
        return PatientAttributionsResponse(
            patient_id=patient_id,
            attributions=attrs,
            total=len(attrs),
        )

    def check_attribution(
        self, patient_id: str, provider_id: str,
    ) -> bool:
        return self._repo.check_attribution(patient_id, provider_id)

    def get_status(self) -> dict[str, int]:
        return {"attributions_count": self._repo.count_attributions()}

    def list_providers(self) -> list[ProviderSummary]:
        """Distinct providers across all attributions, for the dashboard filter."""
        return [ProviderSummary(**row) for row in self._repo.list_distinct_providers()]

    def get_patient_ids_for_provider(self, provider_id: str) -> list[str]:
        """Used by the dashboard to scope population metrics to a provider's panel."""
        return self._repo.get_patient_ids_for_provider(provider_id)
