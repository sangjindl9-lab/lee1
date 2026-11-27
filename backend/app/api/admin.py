"""관리자 API: 사용자, 전체 제작 내역, 실패 기록, API 장애 현황, 강제 중지, 서버·워커 상태, 정책·한도, 통계."""
import shutil
import subprocess
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from .. import tasks
from ..config import get_settings
from ..db import get_db
from ..deps import admin_user
from ..models import (ACTIVE, GLOBAL_DEFAULTS, AppSetting, AuditLog, CostRecord, Project, ProviderRequest, User)
from ..security import hash_password
from .projects import summary

router = APIRouter(prefix="/api/admin", dependencies=[Depends(admin_user)])
_s = get_settings()


@router.get("/users")
def users(db: Session = Depends(get_db)):
    month0 = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    spend = dict(db.query(CostRecord.user_id, func.sum(CostRecord.amount_usd)).filter(CostRecord.created_at >= month0).group_by(CostRecord.user_id).all())
    made = dict(db.query(Project.user_id, func.count()).group_by(Project.user_id).all())
    return [{**u.dict("password_hash", "settings"), "month_cost_usd": round(spend.get(u.id) or 0, 4), "projects": made.get(u.id, 0)}
            for u in db.query(User).order_by(User.created_at)]


class UserIn(BaseModel):
    username: str | None = None
    password: str | None = None
    role: str | None = None
    is_active: bool | None = None
    plan: str | None = None
    daily_cost_limit_usd: float | None = None
    monthly_cost_limit_usd: float | None = None
    daily_video_limit: int | None = None


@router.post("/users")
def add_user(body: UserIn, db: Session = Depends(get_db)):
    if not body.username or not body.password or len(body.password) < 8:
        raise HTTPException(400, "아이디와 8자 이상 비밀번호가 필요합니다.")
    if db.query(User).filter_by(username=body.username).first():
        raise HTTPException(409, "이미 있는 아이디입니다.")
    u = User(username=body.username, password_hash=hash_password(body.password), role=body.role or "user")
    db.add(u)
    db.commit()
    return u.dict("password_hash")


@router.patch("/users/{uid}")
def edit_user(uid: str, body: UserIn, me: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "사용자가 없습니다.")
    if u.id == me.id and (body.is_active is False or (body.role and body.role != "admin")):
        raise HTTPException(400, "자기 자신의 관리자 권한은 해제할 수 없습니다.")
    for f, v in body.model_dump(exclude_none=True, exclude={"password", "username"}).items():
        setattr(u, f, v)
    if body.password:
        u.password_hash = hash_password(body.password)
    db.commit()
    return u.dict("password_hash")


@router.get("/projects")
def all_projects(status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Project, User.username).join(User, User.id == Project.user_id)
    if status:
        q = q.filter(Project.status == status)
    return [{**summary(p), "username": name} for p, name in q.order_by(Project.created_at.desc()).limit(300)]


@router.post("/projects/{pid}/stop")
def force_stop(pid: str, me: User = Depends(admin_user), db: Session = Depends(get_db)):
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "프로젝트가 없습니다.")
    if p.locked_by and p.status in ACTIVE:
        p.cancel_requested = True
    else:
        p.status = "CANCELLED"
    db.add(AuditLog(user_id=me.id, project_id=pid, action="force_stop", level="warn", message="관리자 강제 중지"))
    db.commit()
    return summary(p)


@router.get("/failures")
def failures(db: Session = Depends(get_db)):
    rows = db.query(AuditLog).filter(AuditLog.level == "error").order_by(AuditLog.created_at.desc()).limit(100).all()
    reqs = db.query(ProviderRequest).filter_by(status="failed").order_by(ProviderRequest.created_at.desc()).limit(100).all()
    return {"logs": [r.dict() for r in rows], "requests": [r.dict("request", "response") for r in reqs]}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """공급자별 최근 7일 오류율·평균 처리 시간(API 장애 현황)."""
    since = datetime.now(timezone.utc) - timedelta(days=7)
    agg = {}
    for r in db.query(ProviderRequest).filter(ProviderRequest.created_at >= since):
        a = agg.setdefault((r.provider, r.model_key, r.kind), {"provider": r.provider, "model": r.model_key, "kind": r.kind,
                                                               "total": 0, "failed": 0, "ms": [], "last_error": None, "cost": 0.0})
        a["total"] += 1
        if r.status == "failed":
            a["failed"] += 1
            a["last_error"] = r.error
        if r.duration_ms and r.status == "completed":
            a["ms"].append(r.duration_ms)
        a["cost"] += r.cost_usd or 0
    out = []
    for a in agg.values():
        ms = a.pop("ms")
        out.append({**a, "error_rate": round(a["failed"] / a["total"], 3), "avg_seconds": round(sum(ms) / len(ms) / 1000, 1) if ms else None,
                    "cost": round(a["cost"], 4)})
    return sorted(out, key=lambda x: -x["total"])


@router.get("/system")
def system(db: Session = Depends(get_db)):
    info = {"task_mode": _s.task_mode, "storage": _s.storage_backend, "database": "ok", "redis": None, "workers": None}
    try:
        db.execute(text("select 1"))
    except Exception as e:  # noqa: BLE001
        info["database"] = f"error: {e}"
    if tasks.celery_app:
        try:
            import redis
            redis.Redis.from_url(_s.redis_url, socket_timeout=2).ping()
            info["redis"] = "ok"
        except Exception as e:  # noqa: BLE001
            info["redis"] = f"error: {e}"
        try:
            pong = tasks.celery_app.control.inspect(timeout=2).ping() or {}
            queues = tasks.celery_app.control.inspect(timeout=2).active_queues() or {}
            info["workers"] = [{"name": k, "queues": [q["name"] for q in queues.get(k, [])]} for k in pong]
        except Exception as e:  # noqa: BLE001
            info["workers"] = f"error: {e}"
    else:
        info["workers"] = "inline(API 프로세스 내부 스레드)"
    try:
        info["ffmpeg"] = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5).stdout.split("\n")[0]
    except Exception:  # noqa: BLE001
        info["ffmpeg"] = "없음"
    du = shutil.disk_usage(".")
    info["disk_free_gb"] = round(du.free / 1e9, 1)
    info["active_projects"] = db.query(Project).filter(Project.status.in_(ACTIVE)).count()
    return info


@router.get("/settings")
def get_global(db: Session = Depends(get_db)):
    row = db.query(AppSetting).filter_by(key="global").first()
    return {**GLOBAL_DEFAULTS, **((row.value if row else None) or {})}


@router.put("/settings")
def put_global(body: dict, db: Session = Depends(get_db)):
    bad = set(body) - set(GLOBAL_DEFAULTS)
    if bad:
        raise HTTPException(400, f"알 수 없는 설정: {sorted(bad)}")
    row = db.query(AppSetting).filter_by(key="global").first()
    if not row:
        row = AppSetting(key="global", value={})
        db.add(row)
    row.value = {**(row.value or {}), **body}
    db.commit()
    return get_global(db)


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=30)
    by_status = dict(db.query(Project.status, func.count()).group_by(Project.status).all())
    by_day = {}
    for p in db.query(Project).filter(Project.created_at >= since):
        d = by_day.setdefault(p.created_at.strftime("%m-%d"), {"day": p.created_at.strftime("%m-%d"), "created": 0, "completed": 0, "failed": 0})
        d["created"] += 1
        d["completed"] += p.status == "COMPLETED"
        d["failed"] += p.status == "FAILED"
    cost = float(db.query(func.coalesce(func.sum(CostRecord.amount_usd), 0.0)).filter(CostRecord.created_at >= since).scalar() or 0)
    done = by_status.get("COMPLETED", 0)
    return {"users": db.query(User).count(), "by_status": by_status, "by_day": sorted(by_day.values(), key=lambda x: x["day"]),
            "cost_30d_usd": round(cost, 4), "avg_cost_per_completed_usd": round(cost / done, 4) if done else None,
            "billing": "유료 구독 결제는 비활성 상태입니다(users.plan 필드만 준비)."}
