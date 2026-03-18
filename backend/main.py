import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from synthetic.router import router as synthetic_router
from _collection_initializer import CollectionInitializer

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

    yield


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

@app.get("/")
async def read_root(request: Request):
    return {"message": "Server is running"}