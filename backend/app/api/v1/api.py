"""API v1 router aggregator."""
from fastapi import APIRouter
from app.api.v1.endpoints import auth, documents, chat, courses, study_tools, system

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(documents.router)
api_router.include_router(chat.router)
api_router.include_router(courses.router)
api_router.include_router(study_tools.router)
api_router.include_router(system.router)
