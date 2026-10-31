from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError

from .config import get_settings
from .routers import (admin, approvals, auth, boq, daily_reports, dashboard, exports, files, imports, materials,
                      projects, worklogs)

FIELD_KO = {"name": "이름", "login_id": "아이디", "password": "비밀번호", "code": "코드", "unit": "단위", "qty": "수량",
            "title": "제목", "body": "내용", "reason": "사유", "items": "품목", "report_date": "작성일", "task": "업무"}


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="현장통합 그룹웨어", docs_url="/api/docs" if s.env != "production" else None, redoc_url=None)

    @app.exception_handler(RequestValidationError)
    async def _val(request: Request, exc: RequestValidationError):
        msgs = []
        for e in exc.errors():
            loc = [str(x) for x in e.get("loc", []) if x not in ("body", "query", "path")]
            field = FIELD_KO.get(loc[-1], loc[-1]) if loc else "입력값"
            t = e.get("type", "")
            if t == "missing":
                m = f"{field}: 필수 입력입니다"
            elif "too_short" in t or "min_length" in t:
                m = f"{field}: 너무 짧거나 비어 있습니다"
            elif "date" in t:
                m = f"{field}: 날짜 형식(YYYY-MM-DD)이 아닙니다"
            elif "pattern" in t:
                m = f"{field}: 형식이 올바르지 않습니다"
            else:
                m = f"{field}: 입력값을 확인하세요"
            msgs.append(m)
        return JSONResponse({"detail": " / ".join(msgs[:5]), "errors": exc.errors()}, status_code=422)

    @app.exception_handler(IntegrityError)
    async def _integ(request: Request, exc: IntegrityError):
        return JSONResponse({"detail": "중복되거나 연결된 자료가 있어 저장할 수 없습니다. 입력값을 확인하세요."}, status_code=409)

    @app.middleware("http")
    async def _headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        if request.url.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    for r in (auth, admin, projects, boq, daily_reports, worklogs, materials, approvals, files, dashboard, exports, imports):
        app.include_router(r.router)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    fe = s.frontend_dir
    if fe.exists():
        app.mount("/static", StaticFiles(directory=fe), name="static")

        @app.get("/")
        def index():
            return FileResponse(fe / "index.html", headers={"Cache-Control": "no-cache"})
    return app


app = create_app()
