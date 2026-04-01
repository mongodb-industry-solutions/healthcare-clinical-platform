"""
FastAPI router for the simulation background worker.

Prefix: /simulation

Endpoints
---------
POST   /simulation/start    Start the background vitals simulation
POST   /simulation/stop     Stop the simulation gracefully
GET    /simulation/status   Current worker state
GET    /simulation/stream   SSE stream of vitals + alert events
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/simulation", tags=["Simulation Worker"])


class StartRequest(BaseModel):
    interval_seconds: Optional[int] = None


def _get_worker(request: Request):
    worker = getattr(request.app.state, "simulation_worker", None)
    if worker is None:
        raise HTTPException(500, "Simulation worker not initialized")
    return worker


@router.post("/start")
async def start_simulation(request: Request, body: StartRequest = StartRequest()):
    worker = _get_worker(request)
    result = await worker.start(interval_seconds=body.interval_seconds)
    return result


@router.post("/stop")
async def stop_simulation(request: Request):
    worker = _get_worker(request)
    result = await worker.stop()
    return result


@router.get("/status")
async def simulation_status(request: Request):
    worker = _get_worker(request)
    return worker.status()


@router.get("/stream")
async def simulation_stream(request: Request) -> StreamingResponse:
    """
    SSE stream that forwards events from the simulation worker.

    Event types:
    - ``vitals``  — batch of new readings for all patients
    - ``alerts``  — CDS alerts fired for patients with threshold breaches
    - ``stopped`` — simulation ended (manual or auto-stop)
    """
    worker = _get_worker(request)
    queue = worker.get_event_queue()

    async def event_generator():
        yield f"event: connected\ndata: {json.dumps(worker.status())}\n\n"

        try:
            while True:
                if not worker.is_running():
                    try:
                        event = queue.get_nowait()
                    except asyncio.QueueEmpty:
                        yield f"event: stopped\ndata: {json.dumps({'reason': 'not_running'})}\n\n"
                        break
                else:
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=2.0)
                    except asyncio.TimeoutError:
                        continue

                def _serialize(obj: Any) -> Any:
                    if hasattr(obj, "isoformat"):
                        return obj.isoformat()
                    return str(obj)

                event_type = event.get("type", "message")
                event_data = json.dumps(event.get("data", {}), default=_serialize)
                yield f"event: {event_type}\ndata: {event_data}\n\n"

                if event_type == "stopped":
                    break
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
