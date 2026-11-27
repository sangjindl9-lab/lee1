"""작업 실행 계층. task_mode=celery 이면 Redis 큐의 분리된 워커, inline 이면 백그라운드 스레드."""
import threading
import time
from datetime import datetime, timedelta, timezone

from .config import get_settings
from .db import session_scope
from .models import ACTIVE, Project
from .pipeline import orchestrator

_s = get_settings()
celery_app = None
if _s.task_mode == "celery":
    from celery import Celery

    celery_app = Celery("shorts_factory", broker=_s.redis_url, backend=_s.redis_url)
    celery_app.conf.update(
        task_acks_late=True, worker_prefetch_multiplier=1, task_reject_on_worker_lost=True,
        task_routes={"sf.run": {"queue": "pipeline"}},
        beat_schedule={"tick": {"task": "sf.tick", "schedule": 60.0, "options": {"queue": "pipeline"}}},
        timezone="UTC",
    )

    @celery_app.task(name="sf.run")
    def _run(project_id: str, queue: str = "pipeline"):
        return orchestrator.run_project(project_id, queue, enqueue)

    @celery_app.task(name="sf.tick")
    def _tick():
        return tick()


def enqueue(project_id: str, queue: str | None = None):
    if queue is None:
        with session_scope() as db:
            p = db.get(Project, project_id)
            queue = orchestrator.queue_for(p) if p else "pipeline"
    if celery_app:
        celery_app.send_task("sf.run", args=[project_id, queue], queue=queue)
    else:
        # 단일 프로세스 모드: 큐 구분 없이 한 스레드에서 끝까지 진행한다.
        threading.Thread(target=orchestrator.run_project, args=(project_id, queue, None), daemon=True).start()


def tick() -> dict:
    """주기 작업: ① 중단된 작업 복구 ② 예약·일괄 제작 시작 ③ 채널 성과 수집."""
    out = {"recovered": 0, "started": 0, "analytics": 0}
    now = datetime.now(timezone.utc)
    with session_scope() as db:
        for pid in orchestrator.stale_projects(db):
            enqueue(pid)
            out["recovered"] += 1
        # 무인 일괄 제작: 사용자별로 한 번에 하나씩 순차 진행
        due = db.query(Project).filter(Project.status == "PENDING", Project.scheduled_at.isnot(None),
                                       Project.scheduled_at <= now).order_by(Project.scheduled_at, Project.created_at).all()
        busy = {u for (u,) in db.query(Project.user_id).filter(Project.status.in_(ACTIVE))}
        for p in due:
            if p.user_id in busy:
                continue
            busy.add(p.user_id)
            p.scheduled_at = None
            db.commit()
            enqueue(p.id, "pipeline")
            out["started"] += 1
    try:
        from .api.youtube import collect_due_analytics
        out["analytics"] = collect_due_analytics()
    except Exception:  # noqa: BLE001 — 성과 수집 실패가 제작을 막지 않게 한다
        pass
    return out


_ticker_started = False


def start_inline_ticker():
    global _ticker_started
    if _ticker_started or celery_app:
        return
    _ticker_started = True

    def loop():
        time.sleep(3)
        while True:
            try:
                tick()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(60)

    threading.Thread(target=loop, daemon=True).start()
