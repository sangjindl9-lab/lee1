import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import BASE_DIR, settings
from .db import Base, engine
from . import models  # noqa: F401  (테이블 등록)
from .routers import auth_router, projects_router, legends_router, takeoff_router, export_router, estimate_router, region_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title=settings.app_name, version="0.4.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _startup():
    Base.metadata.create_all(engine)


for r in (auth_router, projects_router, legends_router, takeoff_router, export_router, estimate_router, region_router):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    from .engine.pdf_parser import HAS_TESSERACT
    return {"ok": True, "app": settings.app_name, "dwg_converter": bool(settings.dwg_converter_cmd),
            "ocr": HAS_TESSERACT, "ai_api": bool(settings.anthropic_api_key), "job_backend": settings.job_backend}


FRONT = BASE_DIR / "frontend" / "static"
if FRONT.exists():
    app.mount("/static", StaticFiles(directory=FRONT), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(FRONT / "index.html")

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return FileResponse(FRONT / "favicon.svg", media_type="image/svg+xml")
