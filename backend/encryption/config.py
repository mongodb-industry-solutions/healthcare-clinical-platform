"""
Queryable Encryption configuration.

Reads environment variables to configure:
- Whether QE is enabled
- The local 96-byte master key
- The encrypted fields map for patient_360
- HIPAA compliance metadata for the frontend showcase
"""
from __future__ import annotations

import base64
import logging
import os
import secrets

logger = logging.getLogger(__name__)

QE_ENABLED: bool = os.getenv("QE_ENABLED", "false").lower() in ("true", "1", "yes")

KEY_VAULT_DATABASE = "encryption"
KEY_VAULT_COLLECTION = "__keyVault"
KEY_VAULT_NAMESPACE = f"{KEY_VAULT_DATABASE}.{KEY_VAULT_COLLECTION}"

ENCRYPTED_DATABASE_NAME: str = os.getenv("DATABASE_NAME", "")
ENCRYPTED_COLLECTION_NAME = "patient_360"

ENCRYPTED_FIELD_PATHS: list[dict] = [
    {
        "path": "mrn",
        "bsonType": "string",
        "queryable": True,
        "query_type": "equality",
        "hipaa_ref": "§164.514(b)(2)(i)",
        "hipaa_category": "Direct Identifier",
    },
    {
        "path": "demographics.name",
        "bsonType": "string",
        "queryable": False,
        "query_type": None,
        "hipaa_ref": "§164.514(b)(2)(i)",
        "hipaa_category": "Direct Identifier",
    },
    {
        "path": "demographics.given",
        "bsonType": "string",
        "queryable": False,
        "query_type": None,
        "hipaa_ref": "§164.514(b)(2)(i)",
        "hipaa_category": "Direct Identifier",
    },
    {
        "path": "demographics.family",
        "bsonType": "string",
        "queryable": False,
        "query_type": None,
        "hipaa_ref": "§164.514(b)(2)(i)",
        "hipaa_category": "Direct Identifier",
    },
    {
        "path": "demographics.birth_date",
        "bsonType": "string",
        "queryable": False,
        "query_type": None,
        "hipaa_ref": "§164.514(b)(2)(i)",
        "hipaa_category": "Direct Identifier",
    },
]


_cached_local_key: bytes | None = None


def _get_or_generate_local_key() -> bytes:
    """
    Return the 96-byte local master key from the QE_LOCAL_MASTER_KEY env var.
    If the var is empty, generate a random key, log it, and return it.
    The result is cached so every caller in the same process gets the same key.
    """
    global _cached_local_key
    if _cached_local_key is not None:
        return _cached_local_key

    raw = os.getenv("QE_LOCAL_MASTER_KEY", "").strip()
    if raw:
        key = base64.b64decode(raw)
        if len(key) != 96:
            raise ValueError(
                f"QE_LOCAL_MASTER_KEY must decode to exactly 96 bytes, got {len(key)}"
            )
        _cached_local_key = key
        return key

    key = secrets.token_bytes(96)
    encoded = base64.b64encode(key).decode()
    logger.warning(
        "QE_LOCAL_MASTER_KEY not set — generated a random key. "
        "Persist this value to keep access to encrypted data:\n"
        "  QE_LOCAL_MASTER_KEY=%s",
        encoded,
    )
    _cached_local_key = key
    return key


def get_kms_provider_credentials() -> dict:
    """Return the KMS provider credentials dict for AutoEncryptionOpts."""
    return {"local": {"key": _get_or_generate_local_key()}}


def get_key_vault_namespace() -> str:
    return KEY_VAULT_NAMESPACE


def get_encrypted_fields_map() -> dict:
    """
    Return the encrypted fields specification used by
    create_encrypted_collection() and AutoEncryptionOpts.
    """
    fields = []
    for field_def in ENCRYPTED_FIELD_PATHS:
        entry: dict = {
            "path": field_def["path"],
            "bsonType": field_def["bsonType"],
            "keyId": None,
        }
        if field_def["queryable"]:
            entry["queries"] = [{"queryType": field_def["query_type"]}]
        fields.append(entry)
    return {"fields": fields}


def get_encryption_status_payload() -> dict:
    """Build the JSON payload for the GET /encryption/status endpoint."""
    return {
        "qe_enabled": QE_ENABLED,
        "kms_provider": "local",
        "encrypted_collection": ENCRYPTED_COLLECTION_NAME,
        "encrypted_fields": [
            {
                "path": f["path"],
                "queryable": f["queryable"],
                "query_type": f["query_type"],
            }
            for f in ENCRYPTED_FIELD_PATHS
        ],
        "hipaa_mapping": [
            {
                "field": f["path"],
                "regulation": f"HIPAA {f['hipaa_ref']}",
                "category": f["hipaa_category"],
            }
            for f in ENCRYPTED_FIELD_PATHS
        ],
    }
