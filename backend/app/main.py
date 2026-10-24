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


def _add_missing_columns(conn):
    """모델에 새로 추가된 열을 기존 테이블에 ALTER 로 보강 (간이 마이그레이션)."""
    from sqlalchemy import inspect, text
    insp = inspect(conn)
    for table in Base.metadata.sorted_tables:
        if table.name not in insp.get_table_names():
            continue
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing:
                continue
            ddl = col.type.compile(dialect=conn.dialect)
            conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {ddl}'))


@app.on_event("startup")
def _startup():
    import time
    from sqlalchemy import text
    # 여러 워커가 동시에 create_all 을 실행해도 안전하도록 (PostgreSQL 은 advisory lock, 실패 시 재시도)
    for attempt in range(5):
        try:
            with engine.begin() as conn:
                if engine.dialect.name == "postgresql":
                    conn.execute(text("SELECT pg_advisory_xact_lock(728391)"))
                Base.metadata.create_all(conn)
                _add_missing_columns(conn)
            break
        except Exception:  # noqa: BLE001
            if attempt == 4:
                raise
            time.sleep(1.5)
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
