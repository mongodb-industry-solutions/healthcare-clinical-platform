"""
FastAPI router for Queryable Encryption showcase endpoints.

Prefix: /encryption
"""
from __future__ import annotations

import base64
from typing import Any

from bson import Binary
from fastapi import APIRouter, Depends, HTTPException

from db.mdb import MongoDBConnector
from encryption.config import (
    QE_ENABLED,
    ENCRYPTED_COLLECTION_NAME,
    ENCRYPTED_FIELD_PATHS,
    get_encryption_status_payload,
)

router = APIRouter(prefix="/encryption", tags=["Queryable Encryption"])


def _get_db() -> MongoDBConnector:
    """Lazy import to get the shared DB from app.state at request time."""
    from main import app
    return app.state.db


# ---------------------------------------------------------------------------
# GET /encryption/status
# ---------------------------------------------------------------------------

@router.get("/status")
async def encryption_status():
    """Return the current Queryable Encryption configuration."""
    return get_encryption_status_payload()


# ---------------------------------------------------------------------------
# GET /encryption/server-view/{patient_id}
# ---------------------------------------------------------------------------

def _bson_to_json_serializable(obj: Any) -> Any:
    """Recursively convert BSON types to JSON-safe representations."""
    if isinstance(obj, Binary):
        return {
            "$binary": {
                "base64": base64.b64encode(bytes(obj)).decode(),
                "subType": f"{obj.subtype:02x}",
            }
        }
    if isinstance(obj, bytes):
        return base64.b64encode(obj).decode()
    if isinstance(obj, dict):
        return {k: _bson_to_json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_bson_to_json_serializable(item) for item in obj]
    return obj


@router.get("/server-view/{patient_id}")
async def encryption_server_view(
    patient_id: str,
    db: MongoDBConnector = Depends(_get_db),
):
    """
    Read the patient_360 document using the plain (non-encrypting) client.

    When QE is enabled, encrypted fields appear as Binary ciphertext blobs —
    exactly as they are stored on the MongoDB server. This lets the frontend
    show a side-by-side comparison of decrypted vs. encrypted views.
    """
    if not QE_ENABLED:
        raise HTTPException(
            status_code=404,
            detail="Queryable Encryption is not enabled. Set QE_ENABLED=true to use this endpoint.",
        )

    plain_collection = db.plain_db[ENCRYPTED_COLLECTION_NAME]
    raw_doc = plain_collection.find_one(
        {"patient_id": patient_id},
        {"_id": 0},
    )

    if raw_doc is None:
        raise HTTPException(
            status_code=404,
            detail=f"Patient 360 for {patient_id!r} not found.",
        )

    serializable_doc = _bson_to_json_serializable(raw_doc)

    return {
        "raw_document": serializable_doc,
        "encrypted_field_paths": [f["path"] for f in ENCRYPTED_FIELD_PATHS],
    }
