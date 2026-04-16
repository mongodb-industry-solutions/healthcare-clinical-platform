import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:     %(name)s — %(message)s",
)

logger = logging.getLogger(__name__)

from synthetic.router import router as synthetic_router
from materializer.router import router as materializer_router
from cds.router import router as cds_router
from hooks.router import router as hooks_router
from dashboard.router import router as dashboard_router
from simulation.router import router as simulation_router
from interventions.router import router as interventions_router
from encryption.router import router as encryption_router
from _collection_initializer import CollectionInitializer
from pymongo import MongoClient
from db.mdb import MongoDBConnector
from simulation.worker import SimulationWorker
from encryption.config import QE_ENABLED

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
DATABASE_NAME = os.getenv("DATABASE_NAME")
APP_NAME = os.getenv("APP_NAME")

VITALS_COLLECTION = "synthetic_vitals"
PATIENTS_COLLECTION = "synthetic_patients"
PATIENT_360_COLLECTION = "patient_360"
CDS_RULES_COLLECTION = "cds_rules"
ALERTS_COLLECTION = "alerts"


def _build_auto_encryption_opts():
    """Build AutoEncryptionOpts for the encrypted MongoClient.

    The encrypted_fields_map is intentionally omitted here. The driver
    auto-fetches the schema from the server (stored when the collection
    was created via ``create_encrypted_collection``). This avoids the
    chicken-and-egg problem where ``keyId: None`` (BSON null) would be
    rejected by the auto-encryption layer before DEKs exist.
    """
    from pymongo.encryption_options import AutoEncryptionOpts
    from encryption.config import (
        get_kms_provider_credentials,
        get_key_vault_namespace,
    )

    kms_providers = get_kms_provider_credentials()
    key_vault_ns = get_key_vault_namespace()

    opts_kwargs = {
        "kms_providers": kms_providers,
        "key_vault_namespace": key_vault_ns,
    }

    crypt_shared_path = os.getenv("CRYPT_SHARED_LIB_PATH", "").strip()
    if crypt_shared_path:
        resolved = os.path.abspath(crypt_shared_path)
        opts_kwargs["crypt_shared_lib_path"] = resolved

    return AutoEncryptionOpts(**opts_kwargs)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init = CollectionInitializer(MONGODB_URI, DATABASE_NAME, APP_NAME)

    # Time series collection for wearable vitals
    init.create_timeseries_collection(
        VITALS_COLLECTION, "timestamp", "patient_id", "minutes",
    )

    # Regular collection for FHIR patient bundles
    init.ensure_collection_with_indexes(PATIENTS_COLLECTION, indexes=[
        {"fields": [("meta.patient_id", 1)], "unique": True},
        {"fields": [("meta.source_hospital", 1)]},
    ])

    if QE_ENABLED:
        logger.info("Queryable Encryption is ENABLED — setting up encrypted patient_360 collection.")
        from encryption.setup import create_encrypted_patient_360

        plain_setup_client = MongoClient(
            MONGODB_URI, appname=APP_NAME,
        )
        create_encrypted_patient_360(plain_setup_client, DATABASE_NAME)
        plain_setup_client.close()

        auto_enc_opts = _build_auto_encryption_opts()
        shared_db = MongoDBConnector(auto_encryption_opts=auto_enc_opts)
    else:
        # Standard (unencrypted) patient_360 collection
        init.ensure_collection_with_indexes(PATIENT_360_COLLECTION, indexes=[
            {"fields": [("patient_id", 1)], "unique": True},
            {"fields": [("source_hospital", 1)]},
            {"fields": [("profile_type", 1)]},
            {"fields": [("active_alerts.severity", 1)]},
        ])
        shared_db = MongoDBConnector()

    # CDS rules repository
    init.ensure_collection_with_indexes(CDS_RULES_COLLECTION, indexes=[
        {"fields": [("rule_id", 1)], "unique": True},
        {"fields": [("enabled", 1)]},
    ])

    # Alerts & care gaps
    init.ensure_collection_with_indexes(ALERTS_COLLECTION, indexes=[
        {"fields": [("patient_id", 1), ("status", 1)]},
        {"fields": [("severity", 1), ("status", 1)]},
        {"fields": [("created_at", 1)]},
        {"fields": [("alert_type", 1)]},
    ])

    app.state.db = shared_db
    app.state.simulation_worker = SimulationWorker(shared_db)

    yield

    # Graceful shutdown: stop simulation if running
    if app.state.simulation_worker.is_running():
        await app.state.simulation_worker.stop()


app = FastAPI(
    title="MedWatch Clinical Platform API",
    description="Backend for the MedWatch remote patient monitoring demo.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(synthetic_router)
app.include_router(materializer_router)
app.include_router(cds_router)
app.include_router(hooks_router)
app.include_router(dashboard_router)
app.include_router(simulation_router)
app.include_router(interventions_router)
app.include_router(encryption_router)

@app.get("/")
async def read_root(request: Request):
    return {"message": "Server is running"}