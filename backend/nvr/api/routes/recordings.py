from __future__ import annotations

import datetime as dt
import os
import zoneinfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, select, text, update
from sqlalchemy.orm import Session

from ...audit import audit
from ...config import get_settings
from ...models import Bookmark, Event, RecordingSegment, utcnow
from ...storage import safe_join
from ..deps import Principal, client_ip, get_camera_for, get_db, require

router = APIRouter(prefix="/api/recordings", tags=["recordings"])

GAP_THRESHOLD_S = 3.0


def _parse_ts(v: str, name: str) -> dt.datetime:
    try:
        t = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(400, f"{name} 시각 형식 오류(ISO 8601)") from exc
    if t.tzinfo is None:
        raise HTTPException(400, f"{name} 시각에 시간대(+09:00 등)를 포함하세요.")
    return t


@router.get("/days")
def recording_days(camera_id: int, month: str, request: Request, p: Principal = Depends(require("playback")),
                   db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request, include_deleted=True)
    tz = zoneinfo.ZoneInfo(cam.site.timezone)
    try:
        y, m = (int(x) for x in month.split("-"))
        start = dt.datetime(y, m, 1, tzinfo=tz)
    except ValueError as exc:
        raise HTTPException(400, "month 는 YYYY-MM 형식입니다.") from exc
    end = dt.datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=tz)
    rows = db.execute(
        text("SELECT DISTINCT to_char(start_at AT TIME ZONE :tz, 'YYYY-MM-DD') AS d "
             "FROM recording_segments WHERE camera_id = :cid AND status = 'ready' "
             "AND start_at >= :s AND start_at < :e ORDER BY d"),
        {"tz": cam.site.timezone, "cid": cam.id, "s": start, "e": end},
    ).all()
    return {"camera_id": cam.id, "timezone": cam.site.timezone, "days": [r[0] for r in rows]}


@router.get("/timeline")
def timeline(camera_id: int, start: str, end: str, request: Request, p: Principal = Depends(require("playback")),
             db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request, include_deleted=True)
    t0, t1 = _parse_ts(start, "start"), _parse_ts(end, "end")
    if t1 <= t0 or (t1 - t0) > dt.timedelta(days=2):
        raise HTTPException(400, "조회 범위는 0초 초과 2일 이하입니다.")
    segs = db.scalars(
        select(RecordingSegment)
        .where(RecordingSegment.camera_id == cam.id, RecordingSegment.status == "ready",
               RecordingSegment.end_at > t0, RecordingSegment.start_at < t1)
        .order_by(RecordingSegment.start_at)
        .limit(5000)
    ).all()
    items = [{
        "id": s.id, "start": s.start_at.isoformat(), "end": s.end_at.isoformat(), "duration_ms": s.duration_ms,
        "kind": s.kind, "protected": s.protected, "video_codec": s.video_codec, "audio_codec": s.audio_codec,
        "width": s.width, "height": s.height, "size_bytes": s.size_bytes,
    } for s in segs]
    gaps = []
    cursor = t0
    now = utcnow()
    for s in segs:
        if (s.start_at - cursor).total_seconds() > GAP_THRESHOLD_S:
            gaps.append({"start": cursor.isoformat(), "end": s.start_at.isoformat()})
        cursor = max(cursor, s.end_at)
    tail_end = min(t1, now)
    if (tail_end - cursor).total_seconds() > max(GAP_THRESHOLD_S, get_settings().segment_seconds + 15):
        # 마지막 구간 뒤(현재 녹화 중인 구간은 확정 전이므로 1구간 길이만큼 여유)
        gaps.append({"start": cursor.isoformat(), "end": tail_end.isoformat()})
    evs = db.scalars(select(Event).where(Event.camera_id == cam.id, Event.started_at < t1,
                                         (Event.ended_at.is_(None)) | (Event.ended_at > t0))
                     .order_by(Event.started_at).limit(500)).all()
    events = [{"id": e.id, "type": e.type, "severity": e.severity, "source": e.source, "start": e.started_at.isoformat(),
               "end": e.ended_at.isoformat() if e.ended_at else None, "message": e.message} for e in evs]
    bms = db.scalars(select(Bookmark).where(Bookmark.camera_id == cam.id, Bookmark.at >= t0, Bookmark.at < t1)
                     .order_by(Bookmark.at).limit(500)).all()
    bookmarks = [{"id": b.id, "at": b.at.isoformat(), "title": b.title, "note": b.note} for b in bms]
    return {"camera_id": cam.id, "timezone": cam.site.timezone, "segments": items, "gaps": gaps, "events": events,
            "bookmarks": bookmarks,
            # 이벤트·일정 녹화 카메라는 녹화 공백이 정상 동작일 수 있음(화면에서 장애와 구분해 표시)
            "gaps_expected": cam.record_mode in ("event", "schedule", "off"),
            "is_test_source": cam.is_test_source, "now": now.isoformat()}


@router.get("/segments/{segment_id}/media")
def segment_media(segment_id: int, request: Request, p: Principal = Depends(require("playback")),
                  db: Session = Depends(get_db)):
    seg = db.get(RecordingSegment, segment_id)
    if not seg or seg.status != "ready":
        raise HTTPException(404, "녹화 구간을 찾을 수 없습니다.")
    get_camera_for(db, p, seg.camera_id, request, include_deleted=True)  # 권한 검증(매 요청)
    try:
        path = safe_join(get_settings().recordings_dir, seg.rel_path)
    except ValueError as exc:
        raise HTTPException(404, "녹화 구간을 찾을 수 없습니다.") from exc
    if not path.is_file():
        raise HTTPException(410, "녹화 파일이 없습니다(삭제되었거나 저장장치 오류).")
    return FileResponse(path, media_type="video/mp4", headers={"Cache-Control": "private, max-age=300",
                                                                "Content-Disposition": "inline"})


class PlaybackIn(BaseModel):
    camera_id: int
    at: str


@router.post("/playback-sessions")
def playback_session(body: PlaybackIn, request: Request, p: Principal = Depends(require("playback")),
                     db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, body.camera_id, request, include_deleted=True)
    at = _parse_ts(body.at, "at")
    audit(db, action="recording.play", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          details={"at": at.isoformat()}, commit=True)
    return {"ok": True}


class RangeIn(BaseModel):
    camera_id: int
    start: str
    end: str
    protected: bool | None = None


@router.post("/protect")
def protect(body: RangeIn, request: Request, p: Principal = Depends(require("delete_recordings")),
            db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, body.camera_id, request, include_deleted=True)
    t0, t1 = _parse_ts(body.start, "start"), _parse_ts(body.end, "end")
    flag = True if body.protected is None else body.protected
    res = db.execute(update(RecordingSegment).where(
        RecordingSegment.camera_id == cam.id, RecordingSegment.end_at > t0, RecordingSegment.start_at < t1,
        RecordingSegment.status == "ready").values(protected=flag))
    audit(db, action="recording.protect" if flag else "recording.unprotect", user=p.user, ip=client_ip(request),
          target_type="camera", target_id=cam.id,
          details={"start": t0.isoformat(), "end": t1.isoformat(), "segments": res.rowcount})
    db.commit()
    return {"updated": res.rowcount}


@router.post("/delete")
def delete_recordings(body: RangeIn, request: Request, p: Principal = Depends(require("delete_recordings")),
                      db: Session = Depends(get_db)):
    """녹화 삭제(카메라 등록정보 삭제와 별개). 보호 구간은 삭제하지 않는다."""
    cam = get_camera_for(db, p, body.camera_id, request, include_deleted=True)
    t0, t1 = _parse_ts(body.start, "start"), _parse_ts(body.end, "end")
    cond = and_(RecordingSegment.camera_id == cam.id, RecordingSegment.start_at >= t0, RecordingSegment.end_at <= t1,
                RecordingSegment.status == "ready")
    protected_n = db.scalar(select(func.count()).select_from(RecordingSegment).where(cond, RecordingSegment.protected)) or 0
    ids = list(db.scalars(select(RecordingSegment.id).where(cond, RecordingSegment.protected.is_(False))))
    if ids:
        db.execute(update(RecordingSegment).where(RecordingSegment.id.in_(ids)).values(status="deleting"))
        db.commit()
    base = get_settings().recordings_dir
    removed, freed = 0, 0
    for seg in db.scalars(select(RecordingSegment).where(RecordingSegment.id.in_(ids))) if ids else []:
        try:
            path = safe_join(base, seg.rel_path)
            freed += seg.size_bytes
            os.unlink(path)
        except FileNotFoundError:
            pass
        except (OSError, ValueError):
            continue  # 남은 'deleting' 행은 worker 가 재시도
        db.execute(delete(RecordingSegment).where(RecordingSegment.id == seg.id))
        removed += 1
    audit(db, action="recording.delete", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          details={"start": t0.isoformat(), "end": t1.isoformat(), "deleted": removed, "skipped_protected": protected_n,
                   "freed_bytes": freed})
    db.commit()
    return {"deleted": removed, "skipped_protected": protected_n, "freed_bytes": freed}
