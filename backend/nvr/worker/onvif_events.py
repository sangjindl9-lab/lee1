"""ONVIF 이벤트 구독(PullPoint): 구독 생성 → 주기적 수신 → 갱신 → 끊기면 백오프 재연결.

카메라가 제공한 이벤트(source=camera)만 기록한다. 모션 등 상태형 이벤트는 활성(true)일 때 열고
비활성(false)일 때 닫는다. 녹화 트리거 여부는 카메라 설정(event_triggers)을 따른다.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..events import EVENT_TEXT, close_event, open_event
from ..models import Camera, Event, utcnow
from ..onvif.client import OnvifError
from ..onvif.ext import Session
from ..policy import triggers
from ..security.netguard import TargetDenied

log = logging.getLogger("nvr.worker.onvif_events")
SEVERITY = {"tamper": "warning", "input": "warning", "motion": "info", "analytics": "info"}


class Subscriber(threading.Thread):
    def __init__(self, camera_id: int, version: int, status: dict[int, dict[str, Any]]):
        super().__init__(daemon=True, name=f"onvif-ev-{camera_id}")
        self.camera_id = camera_id
        self.version = version
        self.stop_flag = threading.Event()
        self.status = status

    def set(self, state: str, error: str = "") -> None:
        self.status[self.camera_id] = {"state": state, "error": error[:200], "since": utcnow().isoformat()}

    def run(self) -> None:
        backoff = 2.0
        while not self.stop_flag.is_set():
            with session_scope() as db:
                cam = db.get(Camera, self.camera_id)
                if not cam:
                    return
                _ = cam.site.allowed_networks
            sess = None
            try:
                self.set("connecting")
                sess = Session(cam, timeout=10)
                raw, url = sess.create_pullpoint(60)
                self.set("subscribed")
                with session_scope() as db:
                    close_event(db, f"cam:{cam.id}:evsub")
                backoff = 2.0
                last_renew = time.time()
                while not self.stop_flag.is_set():
                    for m in sess.pull(raw, url, timeout_s=3):
                        self.handle(cam, m)
                    if time.time() - last_renew > 30:
                        sess.renew(raw, url, 60)
                        last_renew = time.time()
                try:
                    sess.unsubscribe(raw, url)
                except Exception:  # noqa: BLE001
                    pass
            except (OnvifError, TargetDenied, OSError, RuntimeError) as exc:
                msg = getattr(exc, "message", str(exc))
                self.set("retry_wait", msg)
                log.warning("카메라 %s 이벤트 구독 오류: %s (%.0f초 후 재시도)", self.camera_id, msg, backoff)
                with session_scope() as db:
                    open_event(db, type="event_subscription", dedup_key=f"cam:{self.camera_id}:evsub", severity="warning",
                               camera_id=self.camera_id, site_id=cam.site_id,
                               message=f"{cam.name}: 카메라 이벤트 구독 실패 — {msg[:150]}")
                self.stop_flag.wait(backoff)
                backoff = min(120.0, backoff * 2)
            finally:
                if sess:
                    sess.close()
        self.status.pop(self.camera_id, None)

    def handle(self, cam: Camera, m: dict[str, Any]) -> None:
        kind = m["kind"]
        if kind == "other" or m["active"] is None:
            return
        src = ",".join(f"{k}={v}" for k, v in sorted(m["source"].items()))[:80]
        key = f"cam:{cam.id}:{kind}:{src}"
        with session_scope() as db:
            if m["active"]:
                open_event(db, type=kind, dedup_key=key, source="camera", severity=SEVERITY.get(kind, "info"),
                           camera_id=cam.id, site_id=cam.site_id, triggers_recording=triggers(cam, kind),
                           message=f"{cam.name}: {EVENT_TEXT.get(kind, kind)} ({m['topic'].split(':')[-1][:60]})",
                           details={"topic": m["topic"][:200], "source": m["source"], "data": m["data"]})
            else:
                close_event(db, key)


class EventManager:
    def __init__(self):
        self.subs: dict[int, Subscriber] = {}
        self.status: dict[int, dict[str, Any]] = {}

    def sync(self) -> None:
        with session_scope() as db:
            want = {c.id: c.config_version for c in db.scalars(select(Camera).where(
                Camera.deleted_at.is_(None), Camera.enabled.is_(True), Camera.events_enabled.is_(True),
                Camera.connection_type == "onvif"))}
        for cid, sub in list(self.subs.items()):
            if cid not in want or want[cid] != sub.version or not sub.is_alive():
                sub.stop_flag.set()
                del self.subs[cid]
                if cid not in want:
                    self._close_open(cid)
        for cid, ver in want.items():
            if cid not in self.subs:
                s = Subscriber(cid, ver, self.status)
                self.subs[cid] = s
                s.start()

    @staticmethod
    def _close_open(camera_id: int) -> None:
        with session_scope() as db:
            for e in db.scalars(select(Event).where(Event.camera_id == camera_id, Event.source == "camera",
                                                    Event.ended_at.is_(None))):
                e.ended_at = utcnow()

    def stop(self) -> None:
        for s in self.subs.values():
            s.stop_flag.set()
