"""
FastAPI router for the Synthetic Data Generator.

Responsibilities: HTTP only — parse requests, delegate to SyntheticService,
map service results to HTTP responses and status codes.
No business logic. No direct database access.

Prefix: /synthetic

Endpoints
---------
POST   /synthetic/patients/generate            Generate N patients → MongoDB
GET    /synthetic/patients                     List patients (summary, paginated)
GET    /synthetic/patients/{patient_id}        Full FHIR bundle for one patient
POST   /synthetic/vitals/{patient_id}/generate Generate vitals history → MongoDB
GET    /synthetic/vitals/{patient_id}          Query saved vitals readings
GET    /synthetic/vitals/stream                SSE stream — live vitals + alert Change Stream
GET    /synthetic/status                       Collection size counts
DELETE /synthetic/reset                        Drop all generated data (dev only)
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from cds.repository import CDSRepository
from cds.service import CDSService
from materializer.repository import MaterializerRepository
from synthetic.models import (
    GeneratePatientsRequest,
    GeneratePatientsResponse,
    GenerateVitalsRequest,
    GenerateVitalsResponse,
    PatientSummary,
    StatusResponse,
)
from synthetic.repository import SyntheticRepository
from synthetic.service import SyntheticService

logger = logging.getLogger(__name__)


def get_synthetic_service(request: Request) -> SyntheticService:
    """FastAPI dependency — uses the shared (possibly encrypted) DB connector."""
    return SyntheticService(SyntheticRepository(request.app.state.db))

router = APIRouter(prefix="/synthetic", tags=["Synthetic Data Generator"])


# ---------------------------------------------------------------------------
# Patients
# ---------------------------------------------------------------------------

@router.post("/patients/generate", response_model=GeneratePatientsResponse, status_code=201)
async def generate_patients(
    body: GeneratePatientsRequest,
    svc: SyntheticService = Depends(get_synthetic_service),
) -> GeneratePatientsResponse:
    """
    Generate synthetic FHIR R4 patient bundles and persist them to MongoDB.

    - **count**: how many patients to create (1–500)
    - **hospital**: pin all patients to a specific source hospital (optional)
    - **seed**: random seed for reproducible generation (optional)
    """
    return svc.generate_patients(body)


@router.get("/patients", response_model=list[PatientSummary])
async def list_patients(
    hospital: Optional[str] = Query(default=None, description="Filter by source hospital key"),
    limit: int = Query(default=50, ge=1, le=500),
    skip: int  = Query(default=0, ge=0),
    svc: SyntheticService = Depends(get_synthetic_service),
) -> list[PatientSummary]:
    """
    Return a paginated list of generated patient summaries.
    Optionally filter by hospital: st_marys | regional_general | community_health.
    """
    return svc.list_patients(hospital=hospital, skip=skip, limit=limit)


@router.get("/patients/{patient_id}", response_model=dict)
async def get_patient(
    patient_id: str,
    svc: SyntheticService = Depends(get_synthetic_service),
) -> dict:
    """Retrieve the full FHIR Bundle for a single patient."""
    doc = svc.get_patient(patient_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id!r} not found.")
    return doc


# ---------------------------------------------------------------------------
# Vitals
# ---------------------------------------------------------------------------

@router.post("/vitals/{patient_id}/generate", response_model=GenerateVitalsResponse, status_code=201)
async def generate_vitals(
    patient_id: str,
    body: GenerateVitalsRequest,
    svc: SyntheticService = Depends(get_synthetic_service),
) -> GenerateVitalsResponse:
    """
    Simulate wearable-patch vitals for a patient and persist to MongoDB.

    - **pattern**: normal | deteriorating | acute
    - **hours**: length of history to generate (1–168)
    - **interval_minutes**: reading frequency in minutes (1–60)
    - **seed**: random seed for reproducibility (optional)
    """
    result = svc.generate_vitals(patient_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id!r} not found.")
    return result


# ---------------------------------------------------------------------------
# Live vitals SSE stream with Change Stream alerts
# MUST be registered before /vitals/{patient_id} so FastAPI doesn't treat
# "stream" as a patient_id value.
# ---------------------------------------------------------------------------

def _change_stream_watcher(
    db: MongoDBConnector,
    patient_ids: list[str],
    loop: asyncio.AbstractEventLoop,
    queue: asyncio.Queue,
    stop_event: threading.Event,
) -> None:
    """
    Background thread: watch patient_360 for active_alerts changes
    and push new alerts into the asyncio queue.
    """
    collection = db.get_collection("patient_360")
    pipeline = [
        {
            "$match": {
                "operationType": {"$in": ["update", "replace"]},
            },
        },
    ]
    pid_set = set(patient_ids)
    try:
        with collection.watch(
            pipeline,
            full_document="updateLookup",
        ) as stream:
            while not stop_event.is_set():
                change = stream.try_next()
                if change is None:
                    if stop_event.wait(0.5):
                        break
                    continue

                full_doc = change.get("fullDocument")
                if not full_doc:
                    continue

                patient_id = full_doc.get("patient_id", "")
                if patient_id not in pid_set:
                    continue

                active_alerts = full_doc.get("active_alerts", [])
                if not active_alerts:
                    continue

                patient_name = full_doc.get("demographics", {}).get("name", "")
                thresholds = full_doc.get("personalized_thresholds", {})

                alert_payload = {
                    "patient_id": patient_id,
                    "patient_name": patient_name,
                    "active_alerts": active_alerts,
                    "thresholds": thresholds,
                }
                loop.call_soon_threadsafe(queue.put_nowait, alert_payload)
    except Exception:
        logger.exception("Change Stream watcher failed")


@router.get("/vitals/stream")
async def stream_vitals(
    patient_ids: str = Query(
        description="Comma-separated patient IDs to monitor",
    ),
    interval_seconds: int = Query(default=5, ge=1, le=30),
    pattern: str = Query(default="deteriorating", description="normal | deteriorating | acute"),
) -> StreamingResponse:
    """
    Server-Sent Events stream that:
    1. Generates one vitals reading per patient on each tick.
    2. Pushes ``event: vitals`` with the new readings.
    3. Watches patient_360 via MongoDB Change Stream for alert changes
       and pushes ``event: alert`` instantly.
    """
    ids = [pid.strip() for pid in patient_ids.split(",") if pid.strip()]
    if not ids:
        raise HTTPException(400, "patient_ids is required")

    async def event_generator():
        from main import app as _app
        db = _app.state.db
        synth_svc = SyntheticService(SyntheticRepository(db))
        mat_repo = MaterializerRepository(db)
        cds_svc = CDSService(CDSRepository(db))

        loop = asyncio.get_running_loop()
        alert_queue: asyncio.Queue = asyncio.Queue()
        stop_event = threading.Event()

        cs_thread = threading.Thread(
            target=_change_stream_watcher,
            args=(db, ids, loop, alert_queue, stop_event),
            daemon=True,
        )
        cs_thread.start()

        connected_payload = json.dumps({
            "patient_ids": ids,
            "interval_seconds": interval_seconds,
            "pattern": pattern,
        })
        yield f"event: connected\ndata: {connected_payload}\n\n"

        try:
            while True:
                try:
                    readings = await loop.run_in_executor(
                        None,
                        synth_svc.tick_patients,
                        ids, pattern, interval_seconds, mat_repo, cds_svc,
                    )
                except Exception:
                    logger.exception("tick_patients failed")
                    readings = []

                vitals_event = json.dumps({
                    "readings": readings,
                    "timestamp": readings[0]["timestamp"] if readings else None,
                })
                yield f"event: vitals\ndata: {vitals_event}\n\n"

                while not alert_queue.empty():
                    try:
                        alert_data = alert_queue.get_nowait()

                        def _serialize(obj):
                            if hasattr(obj, "isoformat"):
                                return obj.isoformat()
                            return str(obj)

                        yield f"event: alert\ndata: {json.dumps(alert_data, default=_serialize)}\n\n"
                    except asyncio.QueueEmpty:
                        break

                await asyncio.sleep(interval_seconds)
        finally:
            stop_event.set()
            cs_thread.join(timeout=3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/vitals/{patient_id}", response_model=list[dict])
async def get_vitals(
    patient_id: str,
    limit: int = Query(
        default=288, ge=1, le=5000,
        description="Max readings to return (default = 24 h at 5-min intervals)",
    ),
    start_iso: Optional[str] = Query(default=None, description="Start datetime ISO-8601"),
    end_iso: Optional[str]   = Query(default=None, description="End datetime ISO-8601"),
    pattern: Optional[str]   = Query(default=None, description="normal | deteriorating | acute"),
    svc: SyntheticService = Depends(get_synthetic_service),
) -> list[dict[str, Any]]:
    """Retrieve saved vitals readings for a patient, ordered oldest → newest."""
    return svc.get_vitals(
        patient_id=patient_id,
        limit=limit,
        start_iso=start_iso,
        end_iso=end_iso,
        pattern=pattern,
    )


# ---------------------------------------------------------------------------
# Status / admin
# ---------------------------------------------------------------------------

@router.get("/status", response_model=StatusResponse)
async def get_status(
    svc: SyntheticService = Depends(get_synthetic_service),
) -> StatusResponse:
    """Return document counts for each synthetic data collection."""
    return svc.get_status()


@router.delete("/reset", status_code=200)
async def reset_data(
    confirm: bool = Query(default=False),
    svc: SyntheticService = Depends(get_synthetic_service),
) -> dict:
    """
    **DEV ONLY** — drop all synthetic patients and vitals from MongoDB.
    Pass `?confirm=true` to prevent accidental deletion.
    """
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Pass ?confirm=true to confirm deletion of all synthetic data.",
        )
    return svc.reset_data()
