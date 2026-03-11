from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi import APIRouter

from dotenv import load_dotenv

from synthetic.router import router as synthetic_router

load_dotenv()

app = FastAPI(
    title="MedWatch Clinical Platform API",
    description="Backend for the MedWatch remote patient monitoring demo.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter()
app.include_router(synthetic_router)


@app.get("/")
async def read_root(request: Request):
    return {"message": "Server is running"}