"""여러 현장 통합(Edge).

- 현장 서버(Edge): NVR_CENTRAL_URL + NVR_CENTRAL_TOKEN_FILE 이 있으면 30초마다 상태 요약을 중앙으로 보낸다
  (현장 → 중앙 방향 HTTPS 만 사용하므로 현장 방화벽을 열 필요가 없다. 영상은 보내지 않는다).
- 중앙 서버: 90초 넘게 보고가 없으면 '현장 서버 연결 끊김' 이벤트를 연다(녹화 중단으로 단정하지 않음).
"""
from __future__ import annotations

import datetime as dt
import logging
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select

from .. import __version__
from ..config import get_settings
from ..db import session_scope
from ..events import open_event
from ..models import Camera, CameraStatus, EdgeNode, Event, ServiceHeartbeat, Site, utcnow
from ..storage import disk_info

log = logging.getLogger("nvr.worker.edge")
OFFLINE_AFTER = dt.timedelta(seconds=90)


def build_report() -> dict[str, Any]:
    with session_scope() as db:
        sts = {s.camera_id: s for s in db.scalars(select(CameraStatus))}
        sites = {s.id: s.name for s in db.scalars(select(Site))}
        cams = []
        for c in db.scalars(select(Camera).where(Camera.deleted_at.is_(None)).order_by(Camera.id)):
            st = sts.get(c.id)
            cams.append({"id": c.id, "name": c.name, "site": sites.get(c.site_id, ""), "enabled": c.enabled,
                         "record_mode": c.record_mode, "state": st.recorder_state if st else "idle",
                         "error_code": st.error_code if st else "",
                         "last_segment_at": st.last_segment_at.isoformat() if st and st.last_segment_at else None,
                         "is_test_source": c.is_test_source})
        open_events = db.scalar(select(Event.id).where(Event.ended_at.is_(None)).limit(1)) is not None
        svcs = {h.name: h.last_seen_at.isoformat() for h in db.scalars(select(ServiceHeartbeat))}
    try:
        d = disk_info()
        disk = {"total": d.total, "free": d.free}
    except OSError:
        disk = {}
    return {"version": __version__, "at": utcnow().isoformat(), "cameras": cams[:500], "disk": disk,
            "services": svcs, "has_open_events": open_events}


def report_to_central() -> bool | None:
    s = get_settings()
    if not s.central_url or not s.central_token_file:
        return None
    token = Path(s.central_token_file).read_text(encoding="utf-8").strip()
    url = s.central_url.rstrip("/") + "/api/edge/report"
    try:
        with httpx.Client(timeout=15, follow_redirects=False) as c:
            r = c.post(url, json=build_report(), headers={"Authorization": f"Bearer {token}"})
        if r.status_code >= 300:
            log.warning("중앙 보고 실패: HTTP %s", r.status_code)
            return False
        return True
    except httpx.HTTPError as exc:
        log.warning("중앙 보고 실패: %s", exc)
        return False


def check_offline() -> None:
    now = utcnow()
    with session_scope() as db:
        for e in db.scalars(select(EdgeNode)):
            if e.online and (not e.last_seen_at or now - e.last_seen_at > OFFLINE_AFTER):
                e.online = False
                open_event(db, type="edge_offline", dedup_key=f"edge:{e.id}:offline", severity="critical",
                           message=f"현장 서버 '{e.name}' 보고 끊김(마지막 {e.last_seen_at:%Y-%m-%d %H:%M:%S} UTC). "
                                   "현장 녹화 상태는 확인할 수 없습니다." if e.last_seen_at else f"현장 서버 '{e.name}' 보고 없음")
