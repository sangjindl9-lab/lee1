from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .. import __version__
from ..config import get_keys, get_settings
from ..db import SessionLocal
from .routes import analytics, auth, cameras, exports, live, ops, recordings, sites, system, users


def create_app() -> FastAPI:
    s = get_settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # 이벤트 수신 요청마다 남는 로그 억제
    get_keys()  # 마스터 키가 없으면 시작하지 않음
    app = FastAPI(title="웹 NVR API", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith("/api/") and "cache-control" not in resp.headers:
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):  # 내부 오류 내용(경로·인증정보)을 응답에 노출하지 않음
        logging.getLogger("nvr.api").exception("처리되지 않은 오류: %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "서버 내부 오류가 발생했습니다. 관리자 로그를 확인하세요."})

    @app.get("/api/health")
    def health():
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            ok = True
        except Exception:  # noqa: BLE001
            ok = False
        finally:
            db.close()
        return JSONResponse(status_code=200 if ok else 503, content={"ok": ok, "version": __version__})

    for r in (auth.router, users.router, sites.router, cameras.router, live.router, recordings.router,
              exports.router, system.router, ops.router, analytics.router):
        app.include_router(r)
    return app


app = create_app()
