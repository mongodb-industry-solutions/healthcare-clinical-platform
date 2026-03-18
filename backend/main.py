import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from synthetic.router import router as synthetic_router
from _timeseries_coll_creator import TimeSeriesCollectionCreator

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
DATABASE_NAME = os.getenv("DATABASE_NAME")
APP_NAME = os.getenv("APP_NAME")
VITALS_COLLECTION = "synthetic_vitals"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create Time Series collection if doesn't exist
    creator = TimeSeriesCollectionCreator(MONGODB_URI, DATABASE_NAME, APP_NAME)
    creator.create_timeseries_collection(VITALS_COLLECTION, "timestamp", "minutes")
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