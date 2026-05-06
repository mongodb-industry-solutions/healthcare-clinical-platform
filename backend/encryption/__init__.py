"""
MongoDB Queryable Encryption module.

Provides configuration, collection setup, and API endpoints for
demonstrating Queryable Encryption on the patient_360 collection.
"""

from encryption.config import (
    QE_ENABLED,
    get_encrypted_fields_map,
    get_kms_provider_credentials,
    get_key_vault_namespace,
    ENCRYPTED_DATABASE_NAME,
    ENCRYPTED_COLLECTION_NAME,
)

__all__ = [
    "QE_ENABLED",
    "get_encrypted_fields_map",
    "get_kms_provider_credentials",
    "get_key_vault_namespace",
    "ENCRYPTED_DATABASE_NAME",
    "ENCRYPTED_COLLECTION_NAME",
]
