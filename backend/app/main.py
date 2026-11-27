from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import tasks
from .api import admin, projects, providers, youtube
from .config import get_settings
from .db import SessionLocal, init_db
from .models import User
from .providers.registry import seed_models
from .security import hash_password

_s = get_settings()


def bootstrap():
    """테이블(개발 모드)·관리자 계정·모델 레지스트리 초기화."""
    if _s.db_url.startswith("sqlite"):
        init_db()
    db = SessionLocal()
    try:
        if _s.admin_password and not db.query(User).filter_by(username=_s.admin_username).first():
            db.add(User(username=_s.admin_username, password_hash=hash_password(_s.admin_password), role="admin",
                        daily_cost_limit_usd=_s.default_daily_cost_limit_usd,
                        monthly_cost_limit_usd=_s.default_monthly_cost_limit_usd,
                        daily_video_limit=_s.default_daily_video_limit))
            db.commit()
        seed_models(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    bootstrap()
    tasks.start_inline_ticker()  # inline 모드: 재시작 시 중단된 작업 복구 + 예약 제작
    yield


app = FastAPI(title=_s.app_name, version="1.0.0", lifespan=lifespan)
origins = [o.strip() for o in _s.cors_origins.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["Content-Disposition"])
for r in (projects.router, providers.router, youtube.router, admin.router):
    app.include_router(r)


@app.get("/api/healthz")
def healthz():
    return {"ok": True, "app": _s.app_name}
