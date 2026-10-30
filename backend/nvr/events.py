"""시스템 이벤트 기록(중복 억제: 같은 dedup_key 의 열린 이벤트가 있으면 새로 만들지 않음)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Event, utcnow

EVENT_TEXT = {
    "camera_offline": "카메라 연결 끊김",
    "camera_online": "카메라 연결 복구",
    "recording_stopped": "녹화 중단",
    "recording_resumed": "녹화 재개",
    "storage_low": "저장공간 부족",
    "storage_full": "저장공간 확보 불가",
    "disk_write_error": "디스크 쓰기 실패",
    "service_started": "서비스 시작",
    "retention_deleted": "보관 정책 삭제",
}


def open_event(db: Session, *, type: str, dedup_key: str, message: str, severity: str = "warning",
               camera_id: int | None = None, site_id: int | None = None, details: dict[str, Any] | None = None,
               source: str = "system") -> Event | None:
    existing = db.scalar(select(Event).where(Event.dedup_key == dedup_key, Event.ended_at.is_(None)))
    if existing:
        return None
    ev = Event(type=type, dedup_key=dedup_key, message=message, severity=severity, camera_id=camera_id,
               site_id=site_id, details=details or {}, source=source)
    db.add(ev)
    return ev


def close_event(db: Session, dedup_key: str) -> bool:
    evs = db.scalars(select(Event).where(Event.dedup_key == dedup_key, Event.ended_at.is_(None))).all()
    for ev in evs:
        ev.ended_at = utcnow()
    return bool(evs)


def point_event(db: Session, *, type: str, message: str, severity: str = "info", camera_id: int | None = None,
                site_id: int | None = None, details: dict[str, Any] | None = None) -> Event:
    now = utcnow()
    ev = Event(type=type, dedup_key="", message=message, severity=severity, camera_id=camera_id, site_id=site_id,
               details=details or {}, started_at=now, ended_at=now)
    db.add(ev)
    return ev
