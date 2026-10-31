"""보관기간·여유공간 기준 순환 삭제. 보호 구간과 확정 전(작성 중) 파일은 삭제하지 않는다."""
from __future__ import annotations

import datetime as dt
import logging
import time

from sqlalchemy import delete, select, update

from ..config import get_settings
from ..db import session_scope
from ..events import close_event, open_event, point_event
from ..models import AuthSession, Camera, LoginAttempt, RecordingSegment, utcnow
from ..settings_store import get_all
from ..storage import disk_info, safe_join
from ..osutil import unlink_retry

log = logging.getLogger("nvr.worker.retention")


def _delete_segments(ids: list[int]) -> tuple[int, int]:
    """'deleting' 표시 → 파일 삭제 → 행 삭제. 중간에 죽으면 다음 회차에 'deleting' 행을 이어서 정리."""
    if not ids:
        return 0, 0
    s = get_settings()
    with session_scope() as db:
        db.execute(update(RecordingSegment).where(RecordingSegment.id.in_(ids), RecordingSegment.protected.is_(False))
                   .values(status="deleting"))
    return finish_deleting(limit=len(ids) + 10, base=s.recordings_dir)


def finish_deleting(limit: int = 1000, base=None) -> tuple[int, int]:
    base = base or get_settings().recordings_dir
    removed = freed = 0
    with session_scope() as db:
        rows = db.execute(select(RecordingSegment.id, RecordingSegment.rel_path, RecordingSegment.size_bytes)
                          .where(RecordingSegment.status == "deleting").limit(limit)).all()
    done_ids = []
    for sid, rel, size in rows:
        try:
            unlink_retry(safe_join(base, rel), missing_ok=False)
            freed += size
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as exc:
            log.error("녹화 파일 삭제 실패 %s: %s", rel, exc)
            continue
        done_ids.append(sid)
    if done_ids:
        with session_scope() as db:
            db.execute(delete(RecordingSegment).where(RecordingSegment.id.in_(done_ids)))
        removed = len(done_ids)
    return removed, freed


def apply_retention() -> dict:
    cfg_default = None
    report = {"by_age": 0, "by_space": 0, "freed": 0}
    with session_scope() as db:
        cfg = get_all(db)
        cfg_default = int(cfg["default_retention_days"])
        cams = db.execute(select(Camera.id, Camera.retention_days)).all()
    now = utcnow()
    for cid, days in cams:
        cutoff = now - dt.timedelta(days=days or cfg_default)
        while True:
            with session_scope() as db:
                ids = list(db.scalars(select(RecordingSegment.id).where(
                    RecordingSegment.camera_id == cid, RecordingSegment.status == "ready",
                    RecordingSegment.protected.is_(False), RecordingSegment.end_at < cutoff)
                    .order_by(RecordingSegment.start_at).limit(500)))
            if not ids:
                break
            n, freed = _delete_segments(ids)
            report["by_age"] += n
            report["freed"] += freed
            if n == 0:
                break
    # 여유 공간 기준
    d = disk_info()
    min_free = max(d.total * float(cfg["min_free_percent"]) / 100, float(cfg["min_free_gb"]) * 1024 ** 3)
    target = min_free * 1.05
    if d.free < min_free:
        with session_scope() as db:
            open_event(db, type="storage_low", dedup_key="storage:low", severity="warning",
                       message=f"저장공간 부족: 여유 {d.free / 1024 ** 3:.1f}GB (기준 {min_free / 1024 ** 3:.1f}GB) — 오래된 녹화부터 정리합니다.")
        guard = 0
        while d.free < target and guard < 1000:
            guard += 1
            with session_scope() as db:
                ids = list(db.scalars(select(RecordingSegment.id).where(
                    RecordingSegment.status == "ready", RecordingSegment.protected.is_(False))
                    .order_by(RecordingSegment.start_at).limit(10)))
            if not ids:
                with session_scope() as db:
                    open_event(db, type="storage_full", dedup_key="storage:full", severity="critical",
                               message="삭제 가능한(비보호) 녹화가 없어 저장공간을 확보할 수 없습니다. 보호 구간 해제 또는 디스크 증설이 필요합니다.")
                break
            n, freed = _delete_segments(ids)
            report["by_space"] += n
            report["freed"] += freed
            d = disk_info()
    else:
        with session_scope() as db:
            close_event(db, "storage:low")
            close_event(db, "storage:full")
    if report["by_age"] or report["by_space"]:
        with session_scope() as db:
            point_event(db, type="retention_deleted", severity="info",
                        message=f"보관 정책 정리: 기간 초과 {report['by_age']}개, 공간 확보 {report['by_space']}개 구간 삭제 "
                                f"({report['freed'] / 1024 ** 2:.0f}MB)", details=report)
        log.info("보관 정리 %s", report)
    return report


def housekeeping() -> None:
    now = utcnow()
    with session_scope() as db:
        db.execute(delete(LoginAttempt).where(LoginAttempt.at < now - dt.timedelta(days=30)))
        db.execute(delete(AuthSession).where(AuthSession.expires_at < now - dt.timedelta(days=7)))
    q = get_settings().recordings_dir / ".quarantine"
    if q.exists():
        for f in q.rglob("*"):
            try:
                if f.is_file() and time.time() - f.stat().st_mtime > 7 * 86400:
                    f.unlink()
            except OSError:
                pass
