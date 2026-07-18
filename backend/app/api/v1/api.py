"""API v1 router aggregator."""
from fastapi import APIRouter
from app.api.v1.endpoints import auth, documents, chat, courses, study_tools, system
from app.api.v1.endpoints import organizations, admin, billing
from app.api.v1.endpoints import search, chat_ws, web_search
from app.api.v1.endpoints import cost, quality, lifecycle, admin_search, compliance

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(documents.router)
api_router.include_router(chat.router)
api_router.include_router(chat_ws.router)
api_router.include_router(courses.router)
api_router.include_router(study_tools.router)
api_router.include_router(system.router)
api_router.include_router(organizations.router)
api_router.include_router(admin.router)
api_router.include_router(billing.router)
api_router.include_router(search.router)
api_router.include_router(web_search.router)
api_router.include_router(cost.router)
api_router.include_router(quality.router)
api_router.include_router(lifecycle.router)
api_router.include_router(admin_search.router)
api_router.include_router(compliance.router)


