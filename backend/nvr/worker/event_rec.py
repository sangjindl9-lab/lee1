"""이벤트 녹화: 버퍼 구간을 이벤트 구간(사전·사후 여유 포함)에 맞춰 확정하거나 정리한다."""
from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import or_, select, update

from ..config import get_settings
from ..db import session_scope
from ..models import Camera, Event, RecordingSegment, utcnow
from .retention import _delete_segments

log = logging.getLogger("nvr.worker.event_rec")


def windows_for(db, cam: Camera, since: dt.datetime, now: dt.datetime) -> list[tuple[dt.datetime, dt.datetime]]:
    s = get_settings()
    pre = dt.timedelta(seconds=cam.event_pre_seconds)
    post = dt.timedelta(seconds=cam.event_post_seconds)
    cap = dt.timedelta(minutes=s.event_max_minutes)
    evs = db.scalars(select(Event).where(
        Event.camera_id == cam.id, Event.triggers_recording.is_(True),
        Event.started_at < now + post,
        or_(Event.ended_at.is_(None), Event.ended_at > since - post))).all()
    out = []
    for e in evs:
        end = e.ended_at or now
        end = min(end, e.started_at + cap)  # 끝나지 않는 이벤트(장치 오류 등)로 무한 녹화하지 않음
        out.append((e.started_at - pre, end + post))
    return out


def process() -> dict:
    s = get_settings()
    now = utcnow()
    promoted = deleted = 0
    with session_scope() as db:
        cam_ids = list(db.scalars(select(RecordingSegment.camera_id).where(RecordingSegment.status == "buffer").distinct()))
    for cid in cam_ids:
        to_delete: list[int] = []
        with session_scope() as db:
            cam = db.get(Camera, cid)
            segs = db.scalars(select(RecordingSegment).where(RecordingSegment.camera_id == cid,
                                                             RecordingSegment.status == "buffer")
                              .order_by(RecordingSegment.start_at)).all()
            if not segs:
                continue
            wins = windows_for(db, cam, segs[0].start_at, now) if cam else []
            keep_until = now - dt.timedelta(seconds=max(cam.event_pre_seconds if cam else 0, s.event_buffer_max_seconds))
            ids_promote = []
            for sg in segs:
                if any(sg.start_at < b and sg.end_at > a for a, b in wins):
                    ids_promote.append(sg.id)
                elif sg.end_at < keep_until:
                    to_delete.append(sg.id)
            if ids_promote:
                db.execute(update(RecordingSegment).where(RecordingSegment.id.in_(ids_promote))
                           .values(status="ready", kind="event"))
                promoted += len(ids_promote)
        if to_delete:
            # 보관 정리와 같은 2단계(deleting 표시 → 파일 삭제 → 행 삭제) 절차
            n, _ = _delete_segments(to_delete)
            deleted += n
    if promoted or deleted:
        log.info("이벤트 녹화: 확정 %d, 버퍼 정리 %d", promoted, deleted)
    return {"promoted": promoted, "deleted": deleted}
