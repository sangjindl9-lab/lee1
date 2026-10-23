from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .auth import ensure_admin_user
from .config import settings
from .db import Base, SessionLocal, engine
from .routers import changes, core, estimates, files, progress

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

for r in (core.router, files.router, estimates.router, progress.router, changes.router):
    app.include_router(r)


@app.on_event("startup")
def _startup():
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        ensure_admin_user(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"ok": True, "app": settings.app_name}


# 프론트엔드 빌드 산출물 서빙 (frontend/dist)
STATIC = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if STATIC.exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = STATIC / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(STATIC / "index.html")
