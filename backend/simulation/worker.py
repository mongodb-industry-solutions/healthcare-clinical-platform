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
import threading
import time
from collections import deque
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
        cds_batch_size: int = 5,
        cds_requeue_cooldown_seconds: int = 30,
    ):
        self._db = db
        self._interval = interval_seconds
        self._cds_cadence = cds_every_n_ticks
        self._cds_batch_size = cds_batch_size
        self._cds_requeue_cooldown_seconds = cds_requeue_cooldown_seconds

        self._patients: dict[str, PatientMeta] = {}
        self._last_readings: dict[str, dict[str, Any]] = {}
        self._simulator = VitalsSimulator()

        self._event_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self._task: Optional[asyncio.Task] = None
        self._cds_task: Optional[asyncio.Task] = None
        self._tick_count = 0
        self._started_at: Optional[float] = None
        self._accepting_cds = False
        self._cds_pending_order: deque[str] = deque()
        self._cds_pending_lookup: set[str] = set()
        self._cds_last_enqueued_at: dict[str, float] = {}
        self._cds_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self, interval_seconds: Optional[int] = None) -> dict[str, Any]:
        if (
            (self._task and not self._task.done()) or
            (self._cds_task and not self._cds_task.done())
        ):
            return {"status": "already_running", "tick_count": self._tick_count}

        if interval_seconds is not None:
            self._interval = interval_seconds

        self._tick_count = 0
        self._started_at = time.monotonic()
        self._accepting_cds = True
        with self._cds_lock:
            self._cds_pending_order.clear()
            self._cds_pending_lookup.clear()
            self._cds_last_enqueued_at.clear()
        self._clear_event_queue()

        await asyncio.get_running_loop().run_in_executor(None, self._load_patients)

        if not self._patients:
            self._accepting_cds = False
            return {"status": "no_patients", "patient_count": 0}

        self._task = asyncio.create_task(self._run_loop())
        self._cds_task = asyncio.create_task(self._run_cds_loop())
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
        if (not self._task or self._task.done()) and (not self._cds_task or self._cds_task.done()):
            return {"status": "not_running"}

        self._accepting_cds = False

        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        if self._cds_task and not self._cds_task.done():
            self._cds_task.cancel()
            try:
                await self._cds_task
            except asyncio.CancelledError:
                pass

        self._task = None
        self._cds_task = None
        with self._cds_lock:
            self._cds_pending_order.clear()
            self._cds_pending_lookup.clear()

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
                    self._accepting_cds = False
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

    async def _run_cds_loop(self) -> None:
        loop = asyncio.get_running_loop()
        try:
            while self._accepting_cds or self._pending_cds_count() > 0:
                patient_ids = self._drain_cds_patients(self._cds_batch_size)
                if not patient_ids:
                    await asyncio.sleep(0.2)
                    continue

                cds_started_at = time.perf_counter()
                await loop.run_in_executor(None, self._run_cds_batch, patient_ids)
                cds_ms = (time.perf_counter() - cds_started_at) * 1000
                logger.info(
                    "CDS batch timing | patients=%d pending=%d total=%.1fms",
                    len(patient_ids),
                    self._pending_cds_count(),
                    cds_ms,
                )
        except asyncio.CancelledError:
            raise
        finally:
            self._cds_task = None

    # ------------------------------------------------------------------
    # Single tick — the critical path
    # ------------------------------------------------------------------

    def _tick(self) -> None:
        self._tick_count += 1
        now = datetime.now(timezone.utc)
        tick_started_at = time.perf_counter()

        vitals_coll = self._db.get_collection(VITALS_COLLECTION)
        p360_coll = self._db.get_collection(PATIENT_360_COLLECTION)

        new_readings: list[dict[str, Any]] = []
        p360_updates: list[UpdateOne] = []
        breached_pids: list[str] = []
        generation_started_at = time.perf_counter()

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

        generation_ms = (time.perf_counter() - generation_started_at) * 1000

        vitals_insert_ms = 0.0
        if new_readings:
            vitals_insert_started_at = time.perf_counter()
            vitals_coll.insert_many(new_readings)
            vitals_insert_ms = (time.perf_counter() - vitals_insert_started_at) * 1000

        p360_update_ms = 0.0
        if p360_updates:
            p360_update_started_at = time.perf_counter()
            p360_coll.bulk_write(p360_updates, ordered=False)
            p360_update_ms = (time.perf_counter() - p360_update_started_at) * 1000

        cds_queued = 0
        if breached_pids and (self._tick_count % self._cds_cadence == 0):
            cds_queued = self._enqueue_cds_patients(breached_pids)

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

        total_ms = (time.perf_counter() - tick_started_at) * 1000
        logger.info(
            "Simulation tick %d timing | patients=%d readings=%d breached=%d cds_queued=%d cds_pending=%d "
            "generate=%.1fms insert_many=%.1fms bulk_write=%.1fms total=%.1fms",
            self._tick_count,
            len(self._patients),
            len(new_readings),
            len(breached_pids),
            cds_queued,
            self._pending_cds_count(),
            generation_ms,
            vitals_insert_ms,
            p360_update_ms,
            total_ms,
        )

        if total_ms > (self._interval * 1000):
            logger.warning(
                "Simulation tick %d exceeded interval: total=%.1fms interval=%dms",
                self._tick_count,
                total_ms,
                self._interval * 1000,
            )

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

    def _enqueue_cds_patients(self, patient_ids: list[str]) -> int:
        queued = 0
        now = time.monotonic()
        with self._cds_lock:
            for pid in patient_ids:
                if pid in self._cds_pending_lookup:
                    continue
                last_enqueued_at = self._cds_last_enqueued_at.get(pid)
                if (
                    last_enqueued_at is not None and
                    (now - last_enqueued_at) < self._cds_requeue_cooldown_seconds
                ):
                    continue
                self._cds_pending_order.append(pid)
                self._cds_pending_lookup.add(pid)
                self._cds_last_enqueued_at[pid] = now
                queued += 1
        return queued

    def _drain_cds_patients(self, max_items: int) -> list[str]:
        drained: list[str] = []
        with self._cds_lock:
            while self._cds_pending_order and len(drained) < max_items:
                pid = self._cds_pending_order.popleft()
                self._cds_pending_lookup.discard(pid)
                drained.append(pid)
        return drained

    def _pending_cds_count(self) -> int:
        with self._cds_lock:
            return len(self._cds_pending_order)

    def _clear_event_queue(self) -> None:
        while True:
            try:
                self._event_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

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
        started_at = time.monotonic()

        projection = {
            "_id": 0,
            "patient_id": 1,
            "flags": 1,
            "personalized_thresholds": 1,
            "simulation_pattern": 1,
            "vitals_summary.latest": 1,
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
            latest = doc.get("vitals_summary", {}).get("latest")
            if latest:
                # Prime the simulator from the already-materialized Patient 360 snapshot
                # instead of scanning the full time-series collection before the first tick.
                self._last_readings[pid] = {
                    "patient_id": pid,
                    **latest,
                }

        logger.info(
            "Loaded %d patients, %d with prior vitals summary in %.2fs",
            len(self._patients), len(self._last_readings), time.monotonic() - started_at,
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
