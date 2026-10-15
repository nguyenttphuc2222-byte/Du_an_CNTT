from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import Base, engine
from app.models import User  # noqa: F401 - registers model metadata


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Convenient for the starter. Use Alembic migrations for a growing/production app.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Student Conduct System API",
    description="Starter API for the student conduct management project.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/")
def root():
    return {"message": "Student Conduct System API is running"}
