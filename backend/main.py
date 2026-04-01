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

from synthetic.router import router as synthetic_router
from materializer.router import router as materializer_router
from cds.router import router as cds_router
from hooks.router import router as hooks_router
from dashboard.router import router as dashboard_router
from simulation.router import router as simulation_router
from _collection_initializer import CollectionInitializer
from db.mdb import MongoDBConnector
from simulation.worker import SimulationWorker

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
DATABASE_NAME = os.getenv("DATABASE_NAME")
APP_NAME = os.getenv("APP_NAME")

VITALS_COLLECTION = "synthetic_vitals"
PATIENTS_COLLECTION = "synthetic_patients"
PATIENT_360_COLLECTION = "patient_360"
CDS_RULES_COLLECTION = "cds_rules"
ALERTS_COLLECTION = "alerts"


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

    # Denormalized Patient 360 materialized view
    init.ensure_collection_with_indexes(PATIENT_360_COLLECTION, indexes=[
        {"fields": [("patient_id", 1)], "unique": True},
        {"fields": [("source_hospital", 1)]},
        {"fields": [("profile_type", 1)]},
        {"fields": [("active_alerts.severity", 1)]},
    ])

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

    # Shared DB connector and simulation worker available on app.state
    shared_db = MongoDBConnector()
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

@app.get("/")
async def read_root(request: Request):
    return {"message": "Server is running"}