"""작업 서비스(worker): 내보내기, 보관 정리, 만료 처리, mediamtx 설정 생성."""
from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time

from ..config import get_settings
from ..db import session_scope
from ..models import ServiceHeartbeat, utcnow
from . import edge, event_rec, exports, mediamtx_config, notify, retention
from .onvif_events import EventManager

log = logging.getLogger("nvr.worker")


class Worker:
    def __init__(self):
        self.running = True
        self.instance = f"{socket.gethostname()}:{os.getpid()}"
        self.started_at = utcnow()
        self.last = {"retention": 0.0, "mediamtx": 0.0, "expire": 0.0, "house": 0.0, "hb": 0.0, "evrec": 0.0,
                     "events": 0.0, "notify": 0.0, "edge_report": 0.0, "edge_check": 0.0}
        self.events = EventManager()
        self.export_thread: threading.Thread | None = None
        self.stats = {"exports_done": 0, "retention_runs": 0, "mediamtx_updates": 0}

    def due(self, key: str, every: float) -> bool:
        if time.time() - self.last[key] >= every:
            self.last[key] = time.time()
            return True
        return False

    def heartbeat(self) -> None:
        with session_scope() as db:
            hb = db.get(ServiceHeartbeat, "worker")
            if not hb:
                hb = ServiceHeartbeat(name="worker", started_at=self.started_at, last_seen_at=utcnow())
                db.add(hb)
            if hb.instance != self.instance:
                hb.started_at = self.started_at
            info = dict(self.stats)
            info["event_subscriptions"] = {str(k): v for k, v in self.events.status.items()}
            hb.instance, hb.last_seen_at, hb.info = self.instance, utcnow(), info

    def export_loop(self) -> None:
        while self.running:
            job_id = None
            try:
                job_id = exports.claim_job()
                if job_id:
                    exports.run_job(job_id)
                    self.stats["exports_done"] += 1
                    continue
            except Exception:  # noqa: BLE001
                log.exception("내보내기 작업 오류")
                if job_id:
                    try:
                        exports._set(job_id, status="failed", error="내부 오류", finished_at=utcnow())
                    except Exception:  # noqa: BLE001
                        pass
            time.sleep(2)

    def loop(self) -> None:
        s = get_settings()
        s.exports_dir.mkdir(parents=True, exist_ok=True)
        exports.reset_orphan_running(self.started_at)
        self.export_thread = threading.Thread(target=self.export_loop, daemon=True)
        self.export_thread.start()
        while self.running:
            try:
                if self.due("mediamtx", 10):
                    if mediamtx_config.sync():
                        self.stats["mediamtx_updates"] += 1
                if self.due("retention", 60):
                    retention.finish_deleting()
                    retention.apply_retention()
                    self.stats["retention_runs"] += 1
                if self.due("expire", 60):
                    exports.expire_exports()
                if self.due("house", 3600):
                    retention.housekeeping()
                if self.due("evrec", 5):
                    event_rec.process()
                if self.due("events", 10):
                    self.events.sync()
                if self.due("notify", 10):
                    notify.run_once()
                if self.due("edge_report", 30):
                    r = edge.report_to_central()
                    if r is not None:
                        self.stats["central_report_ok"] = r
                if self.due("edge_check", 30):
                    edge.check_offline()
                if self.due("hb", 10):
                    self.heartbeat()
            except Exception:  # noqa: BLE001
                log.exception("작업 루프 오류(계속 진행)")
            time.sleep(1)
        self.events.stop()


def main() -> None:
    s = get_settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    w = Worker()

    def _stop(*_):
        w.running = False

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    w.loop()


if __name__ == "__main__":
    main()
