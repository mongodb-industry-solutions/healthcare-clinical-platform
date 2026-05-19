"""
Queryable Encryption collection setup.

Provides helpers to create the encrypted patient_360 collection
with the correct encrypted fields map and DEK generation.
"""
from __future__ import annotations

import logging
from typing import Any

from pymongo import ASCENDING, MongoClient
from pymongo.encryption import ClientEncryption
from bson.codec_options import CodecOptions
from bson.binary import STANDARD

from encryption.config import (
    get_encrypted_fields_map,
    get_kms_provider_credentials,
    get_key_vault_namespace,
    KEY_VAULT_DATABASE,
    KEY_VAULT_COLLECTION,
    ENCRYPTED_COLLECTION_NAME,
)

logger = logging.getLogger(__name__)

PATIENT_360_INDEXES = [
    {"fields": [("patient_id", ASCENDING)], "unique": True},
    {"fields": [("source_hospital", ASCENDING)]},
    {"fields": [("profile_type", ASCENDING)]},
    {"fields": [("active_alerts.severity", ASCENDING)]},
]


def ensure_key_vault(client: MongoClient) -> None:
    """Ensure the key vault collection exists with the required unique index."""
    key_vault_coll = client[KEY_VAULT_DATABASE][KEY_VAULT_COLLECTION]
    key_vault_coll.create_index(
        "keyAltNames",
        unique=True,
        partialFilterExpression={"keyAltNames": {"$exists": True}},
    )
    logger.info("Key vault index ensured on %s.%s", KEY_VAULT_DATABASE, KEY_VAULT_COLLECTION)


def create_encrypted_patient_360(
    plain_client: MongoClient,
    database_name: str,
) -> None:
    """
    Create the patient_360 collection with Queryable Encryption.

    IMPORTANT: ``plain_client`` must be a **plain** MongoClient (no
    AutoEncryptionOpts).  ``create_encrypted_collection`` issues DDL
    commands that the auto-encryption layer cannot handle before DEKs
    exist (``keyId: None`` is BSON null, not Binary).

    If the collection already exists it is dropped first (acceptable for a demo).
    Uses ClientEncryption.create_encrypted_collection() which automatically
    generates Data Encryption Keys for each encrypted field.
    """
    db = plain_client[database_name]
    kms_providers = get_kms_provider_credentials()
    key_vault_namespace = get_key_vault_namespace()
    encrypted_fields_map = get_encrypted_fields_map()

    if ENCRYPTED_COLLECTION_NAME in db.list_collection_names():
        logger.info(
            "Encrypted collection '%s' already exists — skipping creation.",
            ENCRYPTED_COLLECTION_NAME,
        )
        _ensure_indexes(db)
        return

    ensure_key_vault(plain_client)

    codec_options = CodecOptions(uuid_representation=STANDARD)
    client_encryption = ClientEncryption(
        kms_providers=kms_providers,
        key_vault_namespace=key_vault_namespace,
        key_vault_client=plain_client,
        codec_options=codec_options,
    )

    try:
        client_encryption.create_encrypted_collection(
            db,
            ENCRYPTED_COLLECTION_NAME,
            encrypted_fields_map,
            "local",
            {},
        )
        logger.info(
            "Encrypted collection '%s' created with %d encrypted fields.",
            ENCRYPTED_COLLECTION_NAME,
            len(encrypted_fields_map["fields"]),
        )
    finally:
        client_encryption.close()

    _ensure_indexes(db)


def _ensure_indexes(db: Any) -> None:
    """Create non-encrypted indexes on patient_360 after collection creation."""
    collection = db[ENCRYPTED_COLLECTION_NAME]
    for idx in PATIENT_360_INDEXES:
        fields = idx["fields"]
        unique = idx.get("unique", False)
        try:
            collection.create_index(fields, unique=unique)
            field_names = ", ".join(f[0] for f in fields)
            logger.info(
                "Index on (%s) ensured for '%s'%s.",
                field_names,
                ENCRYPTED_COLLECTION_NAME,
                " [unique]" if unique else "",
            )
        except Exception:
            logger.exception(
                "Failed to create index on '%s'.",
                ENCRYPTED_COLLECTION_NAME,
            )
