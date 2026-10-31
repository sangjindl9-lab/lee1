from __future__ import annotations

import datetime as dt
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ... import __version__
from ...audit import audit
from ...config import get_settings
from ...events import EVENT_TEXT
from ...models import AuditLog, Camera, CameraStatus, Event, Layout, RecordingSegment, ServiceHeartbeat, utcnow
from ...settings_store import get_all, set_value
from ...storage import disk_info
from ..deps import Principal, active_principal, client_ip, get_db, require, require_superadmin

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/status")
def system_status(p: Principal = Depends(active_principal), db: Session = Depends(get_db)):
    cams = [c for c in db.scalars(select(Camera).where(Camera.deleted_at.is_(None))) if p.can_cam(c)]
    sts = {s.camera_id: s for s in db.scalars(select(CameraStatus))}
    counts = {"total": len(cams), "enabled": 0, "recording": 0, "problem": 0, "record_off": 0, "test_sources": 0}
    for c in cams:
        if c.is_test_source:
            counts["test_sources"] += 1
        if not c.enabled:
            continue
        counts["enabled"] += 1
        st = sts.get(c.id)
        state = st.recorder_state if st else "idle"
        if state == "recording":
            counts["recording"] += 1
        elif state in ("retry_wait", "error"):
            counts["problem"] += 1
        elif state == "stopped":
            counts["record_off"] += 1
    now = utcnow()
    services = []
    for hb in db.scalars(select(ServiceHeartbeat).order_by(ServiceHeartbeat.name)):
        age = (now - hb.last_seen_at).total_seconds()
        services.append({"name": hb.name, "instance": hb.instance, "started_at": hb.started_at.isoformat(),
                         "last_seen_at": hb.last_seen_at.isoformat(), "alive": age < 45, "age_seconds": int(age),
                         "info": hb.info})
    try:
        d = disk_info()
        disk = {"path": d.path, "total": d.total, "used": d.used, "free": d.free, "free_percent": d.free_percent}
    except OSError as exc:
        disk = {"error": str(exc)}
    open_events = db.scalar(select(func.count()).select_from(Event).where(
        Event.ended_at.is_(None), Event.acknowledged_at.is_(None))) or 0
    return {"version": __version__, "now": now.isoformat(), "cameras": counts, "services": services, "disk": disk,
            "open_events": open_events}


@router.get("/system/storage")
def storage(p: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    s = get_settings()
    cfg = get_all(db)
    d = disk_info()
    rows = db.execute(select(RecordingSegment.camera_id, func.count(), func.sum(RecordingSegment.size_bytes),
                             func.min(RecordingSegment.start_at), func.max(RecordingSegment.end_at))
                      .group_by(RecordingSegment.camera_id)).all()
    cams = {c.id: c for c in db.scalars(select(Camera))}
    per_cam = []
    for cid, n, size, first, last in rows:
        c = cams.get(cid)
        if c and not p.can_cam(c):
            continue
        per_cam.append({"camera_id": cid, "name": c.name if c else f"#{cid}", "deleted": bool(c and c.deleted_at),
                        "segments": n, "bytes": int(size or 0), "first": first.isoformat() if first else None,
                        "last": last.isoformat() if last else None,
                        "retention_days": (c.retention_days if c and c.retention_days else cfg["default_retention_days"])})
    # 최근 24시간 실측 기록량으로 디스크 부족 예상 시점 계산
    since = utcnow() - dt.timedelta(hours=24)
    written = int(db.scalar(select(func.sum(RecordingSegment.size_bytes)).where(RecordingSegment.created_at > since)) or 0)
    first_seg = db.scalar(select(func.min(RecordingSegment.created_at)).where(RecordingSegment.created_at > since))
    hours = max((utcnow() - first_seg).total_seconds() / 3600, 0.1) if first_seg else 0
    rate_per_day = (written / hours * 24) if hours else 0
    min_free = max(d.total * cfg["min_free_percent"] / 100, cfg["min_free_gb"] * 1024 ** 3)
    usable = max(d.free - min_free, 0)
    days_left = round(usable / rate_per_day, 1) if rate_per_day > 0 else None
    exports_size = 0
    try:
        for root, _, files in os.walk(s.exports_dir):
            exports_size += sum(os.path.getsize(os.path.join(root, f)) for f in files)
    except OSError:
        pass
    return {
        "disk": {"path": d.path, "total": d.total, "used": d.used, "free": d.free, "free_percent": d.free_percent},
        "settings": cfg,
        "min_free_bytes": int(min_free),
        "per_camera": sorted(per_cam, key=lambda x: -x["bytes"]),
        "measured": {"bytes_last_24h": int(written), "hours_observed": round(hours, 2),
                     "bytes_per_day": int(rate_per_day),
                     "days_until_cleanup_threshold": days_left,
                     "note": "최근 24시간 실측 기록량 기준. 보관 정책에 따라 오래된 녹화가 자동 삭제되므로 '정리 시작까지 남은 기간'입니다."},
        "exports_bytes": exports_size,
    }


class EstimateIn(BaseModel):
    cameras: int = Field(ge=1, le=1000)
    bitrate_mbps: float = Field(gt=0, le=100)
    hours_per_day: float = Field(default=24, gt=0, le=24)
    retention_days: int = Field(ge=1, le=3650)
    audio_kbps: float = Field(default=0, ge=0, le=512)
    overhead_percent: float = Field(default=2, ge=0, le=50)
    reserve_percent: float = Field(default=15, ge=0, le=90)


@router.post("/system/storage/estimate")
def estimate(body: EstimateIn, p: Principal = Depends(active_principal)):
    video = body.bitrate_mbps * 1e6 / 8 * 3600 * body.hours_per_day * body.retention_days * body.cameras
    audio = body.audio_kbps * 1e3 / 8 * 3600 * body.hours_per_day * body.retention_days * body.cameras
    subtotal = (video + audio) * (1 + body.overhead_percent / 100)
    total = subtotal / (1 - body.reserve_percent / 100) if body.reserve_percent < 100 else subtotal
    ingest_mbps = (body.bitrate_mbps + body.audio_kbps / 1000) * body.cameras
    return {
        "kind": "추정치",
        "video_bytes": int(video), "audio_bytes": int(audio), "with_overhead_bytes": int(subtotal),
        "recommended_disk_bytes": int(total),
        "ingest_mbps": round(ingest_mbps, 2),
        "disk_write_mbps_recommended": round(ingest_mbps * 2.5, 2),
        "note": "평균 비트레이트 기준 추정치입니다. 장면 복잡도·야간 노이즈·VBR 설정에 따라 실제 사용량이 달라지며, "
                "구간 확정 시 재다중화로 디스크 쓰기가 일시적으로 약 2배가 됩니다. 실측치는 저장장치 화면에서 확인하세요.",
    }


class SettingsIn(BaseModel):
    default_retention_days: int | None = Field(default=None, ge=1, le=3650)
    min_free_percent: float | None = Field(default=None, ge=1, le=50)
    min_free_gb: float | None = Field(default=None, ge=1, le=100000)
    export_ttl_hours: int | None = Field(default=None, ge=1, le=24 * 30)


@router.put("/system/settings")
def put_settings(body: SettingsIn, request: Request, p: Principal = Depends(require_superadmin),
                 db: Session = Depends(get_db)):
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        set_value(db, k, v)
    audit(db, action="settings.update", user=p.user, ip=client_ip(request), target_type="system", details=changes)
    db.commit()
    return get_all(db)


# ------------------------------------------------------------------ 이벤트
@router.get("/events")
def list_events(camera_id: int | None = None, open_only: bool = False, limit: int = 200,
                p: Principal = Depends(require("live_view")), db: Session = Depends(get_db)):
    q = select(Event).order_by(Event.started_at.desc()).limit(min(limit, 1000))
    if camera_id:
        q = q.where(Event.camera_id == camera_id)
    if open_only:
        q = q.where(Event.acknowledged_at.is_(None))
    cams = {c.id: c for c in db.scalars(select(Camera))}
    out = []
    for e in db.scalars(q):
        c = cams.get(e.camera_id) if e.camera_id else None
        if c and not p.can_cam(c):
            continue
        out.append({"id": e.id, "camera_id": e.camera_id, "camera_name": c.name if c else None, "type": e.type,
                    "type_label": EVENT_TEXT.get(e.type, e.type), "severity": e.severity, "source": e.source,
                    "start": e.started_at.isoformat(), "end": e.ended_at.isoformat() if e.ended_at else None,
                    "message": e.message, "acknowledged_at": e.acknowledged_at.isoformat() if e.acknowledged_at else None,
                    "note": e.note})
    return {"items": out}


class AckIn(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.post("/events/{event_id}/ack")
def ack_event(event_id: int, body: AckIn, request: Request, p: Principal = Depends(require("live_view")),
              db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(404, "이벤트를 찾을 수 없습니다.")
    if e.camera_id:
        c = db.get(Camera, e.camera_id)
        if c and not p.can_cam(c):
            raise HTTPException(404, "이벤트를 찾을 수 없습니다.")
    e.acknowledged_at = utcnow()
    e.acknowledged_by = p.user.id
    e.note = body.note
    audit(db, action="event.ack", user=p.user, ip=client_ip(request), target_type="event", target_id=e.id)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ 감사로그
@router.get("/audit")
def list_audit(action: str = "", username: str = "", limit: int = 300, before_id: int | None = None,
               p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000))
    if action:
        q = q.where(AuditLog.action.startswith(action))
    if username:
        q = q.where(AuditLog.username == username)
    if before_id:
        q = q.where(AuditLog.id < before_id)
    return {"items": [{"id": a.id, "at": a.at.isoformat(), "username": a.username, "ip": a.ip, "action": a.action,
                       "target_type": a.target_type, "target_id": a.target_id, "result": a.result,
                       "details": a.details} for a in db.scalars(q)]}


# ------------------------------------------------------------------ 화면 배치
class LayoutIn(BaseModel):
    name: str = Field(default="기본", min_length=1, max_length=60)
    grid: int
    cells: list[int | None]
    is_default: bool = True


@router.get("/layouts")
def get_layouts(p: Principal = Depends(require("live_view")), db: Session = Depends(get_db)):
    rows = db.scalars(select(Layout).where(Layout.user_id == p.user.id).order_by(Layout.name)).all()
    return {"items": [{"id": r.id, "name": r.name, "grid": r.grid, "cells": r.cells, "is_default": r.is_default}
                      for r in rows]}


@router.delete("/layouts/{layout_id}")
def delete_layout(layout_id: int, p: Principal = Depends(require("live_view")), db: Session = Depends(get_db)):
    row = db.get(Layout, layout_id)
    if not row or row.user_id != p.user.id:
        raise HTTPException(404, "배치를 찾을 수 없습니다.")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.put("/layouts")
def put_layout(body: LayoutIn, p: Principal = Depends(require("live_view")), db: Session = Depends(get_db)):
    if body.grid not in (1, 4, 9, 16, 25, 36):
        raise HTTPException(400, "분할은 1·4·9·16·25·36 중 하나입니다.")
    cells = (body.cells + [None] * body.grid)[: body.grid]
    row = db.scalar(select(Layout).where(Layout.user_id == p.user.id, Layout.name == body.name))
    if body.is_default:
        for r in db.scalars(select(Layout).where(Layout.user_id == p.user.id)):
            r.is_default = False
    if not row:
        row = Layout(user_id=p.user.id, name=body.name)
        db.add(row)
    row.grid, row.cells, row.is_default, row.updated_at = body.grid, cells, body.is_default, utcnow()
    db.commit()
    return {"id": row.id, "name": row.name, "grid": row.grid, "cells": row.cells, "is_default": row.is_default}
