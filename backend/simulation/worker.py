"""
Background simulation worker.

Generates vitals for all patients in patient_360 on a fixed interval,
writes them in batches, and evaluates CDS rules only for patients
whose vitals breach personalized thresholds.

Designed for 1 000+ patients per tick at 5-second intervals.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo import UpdateOne

from cds.repository import CDSRepository
from cds.service import CDSService
from db.mdb import MongoDBConnector
from synthetic.vitals_simulator import VitalsSimulator

logger = logging.getLogger(__name__)

_CKD_CODE = "433144002"
_MAX_DURATION_SECONDS = 7 * 60  # 7-minute auto-stop

VITALS_COLLECTION = "synthetic_vitals"
PATIENT_360_COLLECTION = "patient_360"


@dataclass
class PatientMeta:
    patient_id: str
    has_beta_blocker: bool = False
    has_ckd: bool = False
    has_insulin: bool = False
    pattern: str = "deteriorating"
    thresholds: dict[str, Any] = field(default_factory=dict)


class SimulationWorker:
    """
    Singleton background worker that generates vitals for all patients.

    Call ``start()`` to begin and ``stop()`` to halt.  The worker
    automatically shuts down after ``_MAX_DURATION_SECONDS``.
    """

    def __init__(
        self,
        db: MongoDBConnector,
        interval_seconds: int = 5,
        cds_every_n_ticks: int = 3,
    ):
        self._db = db
        self._interval = interval_seconds
        self._cds_cadence = cds_every_n_ticks

        self._patients: dict[str, PatientMeta] = {}
        self._last_readings: dict[str, dict[str, Any]] = {}
        self._simulator = VitalsSimulator()

        self._event_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self._task: Optional[asyncio.Task] = None
        self._tick_count = 0
        self._started_at: Optional[float] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self, interval_seconds: Optional[int] = None) -> dict[str, Any]:
        if self._task and not self._task.done():
            return {"status": "already_running", "tick_count": self._tick_count}

        if interval_seconds is not None:
            self._interval = interval_seconds

        self._tick_count = 0
        self._started_at = time.monotonic()

        await asyncio.get_running_loop().run_in_executor(None, self._load_patients)

        if not self._patients:
            return {"status": "no_patients", "patient_count": 0}

        self._task = asyncio.create_task(self._run_loop())
        logger.info(
            "Simulation started: %d patients, %ds interval, %d-min auto-stop",
            len(self._patients), self._interval, _MAX_DURATION_SECONDS // 60,
        )
        return {
            "status": "started",
            "patient_count": len(self._patients),
            "interval_seconds": self._interval,
            "auto_stop_seconds": _MAX_DURATION_SECONDS,
        }

    async def stop(self) -> dict[str, Any]:
        if not self._task or self._task.done():
            return {"status": "not_running"}

        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

        self._push_event("stopped", {
            "reason": "manual",
            "tick_count": self._tick_count,
        })
        logger.info("Simulation stopped after %d ticks", self._tick_count)
        return {"status": "stopped", "tick_count": self._tick_count}

    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    def status(self) -> dict[str, Any]:
        elapsed = 0.0
        if self._started_at and self.is_running():
            elapsed = time.monotonic() - self._started_at
        return {
            "running": self.is_running(),
            "tick_count": self._tick_count,
            "patient_count": len(self._patients),
            "interval_seconds": self._interval,
            "elapsed_seconds": round(elapsed, 1),
            "auto_stop_seconds": _MAX_DURATION_SECONDS,
        }

    def get_event_queue(self) -> asyncio.Queue:
        return self._event_queue

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def _run_loop(self) -> None:
        loop = asyncio.get_running_loop()
        try:
            while True:
                if self._started_at and (time.monotonic() - self._started_at) >= _MAX_DURATION_SECONDS:
                    self._push_event("stopped", {
                        "reason": "auto_stop",
                        "tick_count": self._tick_count,
                        "message": f"Auto-stopped after {_MAX_DURATION_SECONDS // 60} minutes",
                    })
                    logger.info("Simulation auto-stopped after %d ticks", self._tick_count)
                    break

                await loop.run_in_executor(None, self._tick)
                await asyncio.sleep(self._interval)
        except asyncio.CancelledError:
            raise

    # ------------------------------------------------------------------
    # Single tick — the critical path
    # ------------------------------------------------------------------

    def _tick(self) -> None:
        self._tick_count += 1
        now = datetime.now(timezone.utc)

        vitals_coll = self._db.get_collection(VITALS_COLLECTION)
        p360_coll = self._db.get_collection(PATIENT_360_COLLECTION)

        new_readings: list[dict[str, Any]] = []
        p360_updates: list[UpdateOne] = []
        breached_pids: list[str] = []

        for pid, meta in self._patients.items():
            last = self._last_readings.get(pid, {})

            reading = self._simulator.generate_next_reading(
                patient_id=pid,
                last_reading=last,
                pattern=meta.pattern,
                interval_seconds=self._interval,
                has_beta_blocker=meta.has_beta_blocker,
                has_ckd=meta.has_ckd,
                has_insulin=meta.has_insulin,
            )

            self._last_readings[pid] = reading
            new_readings.append(reading)

            latest_snapshot = {
                "heart_rate": reading["heart_rate"],
                "respiratory_rate": reading["respiratory_rate"],
                "temperature": reading["temperature"],
                "spo2": reading["spo2"],
                "activity_level": reading["activity_level"],
                "timestamp": now.isoformat(),
            }
            p360_updates.append(UpdateOne(
                {"patient_id": pid},
                {"$set": {
                    "vitals_summary.latest": latest_snapshot,
                    "vitals_summary.refreshed_at": now.isoformat(),
                    "updated_at": now.isoformat(),
                }},
            ))

            if self._breaches_threshold(reading, meta.thresholds):
                breached_pids.append(pid)

        if new_readings:
            vitals_coll.insert_many(new_readings)

        if p360_updates:
            p360_coll.bulk_write(p360_updates, ordered=False)

        if breached_pids and (self._tick_count % self._cds_cadence == 0):
            self._run_cds_batch(breached_pids)

        serializable_readings = []
        for r in new_readings:
            sr = {**r}
            if isinstance(sr.get("timestamp"), datetime):
                sr["timestamp"] = sr["timestamp"].isoformat()
            sr.pop("_id", None)
            serializable_readings.append(sr)

        self._push_event("vitals", {
            "tick": self._tick_count,
            "patient_count": len(self._patients),
            "readings": serializable_readings,
            "breached_count": len(breached_pids),
            "timestamp": now.isoformat(),
        })

    # ------------------------------------------------------------------
    # CDS evaluation (batched, only for breached patients)
    # ------------------------------------------------------------------

    def _run_cds_batch(self, patient_ids: list[str]) -> None:
        cds_repo = CDSRepository(self._db)
        cds_svc = CDSService(cds_repo)
        alert_events: list[dict[str, Any]] = []

        for pid in patient_ids:
            try:
                result = cds_svc.evaluate_patient(pid)
                if result and result.alerts_generated > 0:
                    p360 = cds_repo.get_patient_360(pid)
                    patient_name = p360.get("demographics", {}).get("name", "") if p360 else ""
                    active_alerts = p360.get("active_alerts", []) if p360 else []
                    alert_events.append({
                        "patient_id": pid,
                        "patient_name": patient_name,
                        "alerts_generated": result.alerts_generated,
                        "active_alerts": active_alerts,
                    })
            except Exception:
                logger.exception("CDS evaluation failed for %s", pid)

        if alert_events:
            self._push_event("alerts", {
                "tick": self._tick_count,
                "patients_with_new_alerts": len(alert_events),
                "details": alert_events,
            })

    # ------------------------------------------------------------------
    # Threshold breach detection (in-memory, no DB)
    # ------------------------------------------------------------------

    @staticmethod
    def _breaches_threshold(reading: dict[str, Any], thresholds: dict[str, Any]) -> bool:
        for vital in ("heart_rate", "respiratory_rate", "temperature", "spo2"):
            t = thresholds.get(vital)
            if not t:
                continue
            value = reading.get(vital)
            if value is None:
                continue
            low = t.get("low")
            high = t.get("high")
            if low is not None and value < low:
                return True
            if high is not None and value > high:
                return True
        return False

    # ------------------------------------------------------------------
    # Patient loading
    # ------------------------------------------------------------------

    def _load_patients(self) -> None:
        p360_coll = self._db.get_collection(PATIENT_360_COLLECTION)
        vitals_coll = self._db.get_collection(VITALS_COLLECTION)

        projection = {
            "_id": 0,
            "patient_id": 1,
            "flags": 1,
            "personalized_thresholds": 1,
            "simulation_pattern": 1,
        }
        docs = list(p360_coll.find({}, projection))
        self._patients.clear()
        self._last_readings.clear()

        for doc in docs:
            pid = doc["patient_id"]
            flags = doc.get("flags", {})
            self._patients[pid] = PatientMeta(
                patient_id=pid,
                has_beta_blocker=flags.get("has_beta_blocker", False),
                has_ckd=flags.get("has_ckd", False) or _CKD_CODE in flags.get("condition_codes", []),
                has_insulin=flags.get("has_insulin", False),
                pattern=doc.get("simulation_pattern", "deteriorating"),
                thresholds=doc.get("personalized_thresholds", {}),
            )

        patient_ids = list(self._patients.keys())
        if not patient_ids:
            return

        pipeline = [
            {"$match": {"patient_id": {"$in": patient_ids}}},
            {"$sort": {"timestamp": -1}},
            {"$group": {
                "_id": "$patient_id",
                "doc": {"$first": "$$ROOT"},
            }},
        ]
        for result in vitals_coll.aggregate(pipeline):
            pid = result["_id"]
            doc = result["doc"]
            doc.pop("_id", None)
            self._last_readings[pid] = doc

        logger.info(
            "Loaded %d patients, %d with prior vitals",
            len(self._patients), len(self._last_readings),
        )

    def reload_patients(self) -> None:
        self._load_patients()

    # ------------------------------------------------------------------
    # Event queue helpers
    # ------------------------------------------------------------------

    def _push_event(self, event_type: str, data: dict[str, Any]) -> None:
        try:
            self._event_queue.put_nowait({"type": event_type, "data": data})
        except asyncio.QueueFull:
            try:
                self._event_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                self._event_queue.put_nowait({"type": event_type, "data": data})
            except asyncio.QueueFull:
                pass
