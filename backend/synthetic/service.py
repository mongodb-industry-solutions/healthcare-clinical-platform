"""
Synthetic data service.

Orchestrates patient generation and vitals simulation.
All business logic lives here — no HTTP, no MongoDB queries.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from healthlake.client import HealthLakeClient
from synthetic.fhir_generator import FHIRPatientGenerator
from synthetic.models import (
    GeneratePatientsRequest,
    GeneratePatientsResponse,
    GenerateVitalsRequest,
    GenerateVitalsResponse,
    PatientSummary,
    StatusResponse,
)
from synthetic.repository import SyntheticRepository
from synthetic.vitals_simulator import VitalsSimulator


logger = logging.getLogger(__name__)


class SyntheticService:
    def __init__(self, repo: SyntheticRepository):
        self._repo = repo

    ######## Patients ########

    def generate_patients(self, body: GeneratePatientsRequest) -> GeneratePatientsResponse:
        """Generate FHIR R4 patient bundles, persist to MongoDB, optionally push to HealthLake."""
        generator   = FHIRPatientGenerator(seed=body.seed)
        patient_ids: list[str] = []
        docs: list[dict[str, Any]] = []

        for _ in range(body.count):
            patient = generator.generate_patient(
                hospital=body.hospital,
                profile_type=body.profile_type.value,
            )
            patient["_type"] = "synthetic_patient"
            docs.append(patient)
            patient_ids.append(patient["meta"]["patient_id"])

        self._repo.insert_patients(docs)

        healthlake_sent   = 0
        healthlake_errors: list[str] = []

        if body.send_to_healthlake:
            hl_client = HealthLakeClient()
            for doc in docs:
                pid = doc["meta"]["patient_id"]
                try:
                    sent, errs = hl_client.send_resources_from_bundle(doc["bundle"])
                    healthlake_sent += sent
                    healthlake_errors.extend(
                        f"Patient {pid} — {e}" for e in errs
                    )
                except Exception as exc:
                    msg = f"Patient {pid}: {exc}"
                    logger.warning("HealthLake send failed — %s", msg)
                    healthlake_errors.append(msg)

        return GeneratePatientsResponse(
            generated         = len(patient_ids),
            patient_ids       = patient_ids,
            healthlake_sent   = healthlake_sent,
            healthlake_errors = healthlake_errors,
        )

    def list_patients(
        self,
        hospital: Optional[str],
        skip: int,
        limit: int,
    ) -> list[PatientSummary]:
        """Return lightweight patient summaries, optionally filtered by hospital."""
        docs = self._repo.find_patients(hospital=hospital, skip=skip, limit=limit)
        return [PatientSummary(**self._extract_summary(d)) for d in docs]

    def get_patient(self, patient_id: str) -> Optional[dict[str, Any]]:
        """Return the full FHIR bundle document for a patient, or None."""
        return self._repo.find_patient_by_id(patient_id)

    ######## Vitals ########

    def generate_vitals(
        self,
        patient_id: str,
        body: GenerateVitalsRequest,
    ) -> Optional[GenerateVitalsResponse]:
        """
        Simulate wearable-patch vitals for a patient and persist to MongoDB.
        Returns None if the patient does not exist.
        """
        patient_doc = self._repo.find_patient_meta(patient_id)
        if not patient_doc:
            return None

        meta = patient_doc.get("meta", {})
        has_beta_blocker: bool = meta.get("has_beta_blocker", False)
        has_ckd: bool = "433144002" in meta.get("condition_codes", [])
        has_insulin: bool = meta.get("has_insulin", False)

        simulator = VitalsSimulator(seed=body.seed)
        readings  = simulator.generate(
            patient_id       = patient_id,
            pattern          = body.pattern.value,
            hours            = body.hours,
            interval_minutes = body.interval_minutes,
            has_beta_blocker = has_beta_blocker,
            has_ckd          = has_ckd,
            has_insulin       = has_insulin,
        )

        self._repo.insert_vitals(readings)

        return GenerateVitalsResponse(
            patient_id       = patient_id,
            readings_written = len(readings),
            pattern          = body.pattern.value,
            start_time       = readings[0]["timestamp"].isoformat(),
            end_time         = readings[-1]["timestamp"].isoformat(),
        )

    def get_vitals(
        self,
        patient_id: str,
        limit: int,
        start_iso: Optional[str],
        end_iso: Optional[str],
        pattern: Optional[str],
    ) -> list[dict[str, Any]]:
        return self._repo.find_vitals(
            patient_id=patient_id,
            limit=limit,
            start_iso=start_iso,
            end_iso=end_iso,
            pattern=pattern,
        )

    ######## Live tick (SSE streaming) ########

    def tick_patients(
        self,
        patient_ids: list[str],
        pattern: str,
        interval_seconds: int,
        materializer_repo: Any,
        cds_service: Any,
    ) -> list[dict[str, Any]]:
        """
        Generate one new vitals reading per patient, persist it,
        patch patient_360.vitals_summary.latest, and run CDS evaluation.

        Returns the list of new readings (one per patient).
        """
        from pymongo import DESCENDING

        simulator = VitalsSimulator()
        new_readings: list[dict[str, Any]] = []

        for pid in patient_ids:
            patient_meta = self._repo.find_patient_meta(pid)
            if not patient_meta:
                continue

            meta = patient_meta.get("meta", {})
            has_beta_blocker = meta.get("has_beta_blocker", False)
            has_ckd = "433144002" in meta.get("condition_codes", [])
            has_insulin = meta.get("has_insulin", False)

            last_docs = (
                self._repo._db.get_collection("synthetic_vitals")
                .find({"patient_id": pid}, {"_id": 0})
                .sort("timestamp", DESCENDING)
                .limit(1)
            )
            last_list = list(last_docs)
            last_reading = last_list[0] if last_list else {}

            reading = simulator.generate_next_reading(
                patient_id=pid,
                last_reading=last_reading,
                pattern=pattern,
                interval_seconds=interval_seconds,
                has_beta_blocker=has_beta_blocker,
                has_ckd=has_ckd,
                has_insulin=has_insulin,
            )

            self._repo._db.get_collection("synthetic_vitals").insert_one(reading)

            latest_snapshot = {
                "heart_rate": reading["heart_rate"],
                "respiratory_rate": reading["respiratory_rate"],
                "temperature": reading["temperature"],
                "spo2": reading["spo2"],
                "activity_level": reading["activity_level"],
            }
            materializer_repo.patch_vitals_latest(pid, latest_snapshot)

            try:
                cds_service.evaluate_patient(pid)
            except Exception:
                logger.warning("CDS evaluation failed for %s during tick", pid)

            serializable = {**reading}
            if isinstance(serializable.get("timestamp"), datetime):
                serializable["timestamp"] = serializable["timestamp"].isoformat()
            serializable.pop("_id", None)
            new_readings.append(serializable)

        return new_readings

   ######## Status / admin ########

    def get_status(self) -> StatusResponse:
        return StatusResponse(
            patients        = self._repo.count_patients(),
            fhir_resources  = 0,  # embedded in patient bundles
            vitals_readings = self._repo.count_vitals(),
        )

    def reset_data(self) -> dict[str, int]:
        return {
            "patients_deleted": self._repo.delete_all_patients(),
            "vitals_deleted":   self._repo.delete_all_vitals(),
        }

    ######## Private Helpers ########

    @staticmethod
    def _extract_summary(doc: dict[str, Any]) -> dict[str, Any]:
        """Build a PatientSummary-compatible dict from a stored patient document."""
        meta    = doc.get("meta", {})
        entries = doc.get("bundle", {}).get("entry", [])

        conditions = [
            e["resource"]["code"]["text"]
            for e in entries
            if e["resource"].get("resourceType") == "Condition"
        ]
        medications = [
            e["resource"]["medicationCodeableConcept"]["text"]
            for e in entries
            if e["resource"].get("resourceType") == "MedicationRequest"
        ]

        patient_resource = next(
            (e["resource"] for e in entries if e["resource"].get("resourceType") == "Patient"),
            {},
        )
        name_parts = patient_resource.get("name", [{}])[0]
        given  = name_parts.get("given", [""])[0]
        family = name_parts.get("family", "")
        dob    = patient_resource.get("birthDate", "")

        age = 0
        if dob:
            try:
                birth = datetime.fromisoformat(dob)
                today = datetime.now()
                age   = today.year - birth.year - (
                    (today.month, today.day) < (birth.month, birth.day)
                )
            except (ValueError, TypeError):
                pass

        return {
            "patient_id":      meta.get("patient_id", ""),
            "mrn":             meta.get("mrn", ""),
            "name":            f"{given} {family}".strip(),
            "age":             age,
            "gender":          patient_resource.get("gender", ""),
            "source_hospital": meta.get("source_hospital", ""),
            "profile_type":    meta.get("profile_type", "target"),
            "conditions":      conditions,
            "medications":     medications,
            "created_at":      meta.get("ingested_at", ""),
        }



