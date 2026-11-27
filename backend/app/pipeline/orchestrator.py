"""파이프라인 오케스트레이터(총괄 프로듀서의 실행 통제).

- 단계 상태를 DB(projects.stage_state)에 저장하므로 서버가 재시작돼도 완료된 단계는 건너뛴다.
- 프로젝트 단위 잠금(locked_by + 만료 시각)으로 같은 작업이 동시에 두 번 실행되지 않는다.
- queue 가 다른 단계(렌더링)는 해당 워커 큐로 넘긴다.
"""
import traceback
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, update
from sqlalchemy.orm.attributes import flag_modified

from ..config import get_settings
from ..db import session_scope
from ..models import ACTIVE, AuditLog, Project
from ..providers.base import ProviderError
from . import stages as S
from .context import BudgetExceeded, Cancelled, Ctx, PipelineError

# (단계 키, 표시 상태, 워커 큐, 화면 표시 이름, 함수)
STAGES = [
    ("analyze", "RESEARCHING", "pipeline", "주제 분석·키워드 확장", S.analyze),
    ("web_research", "RESEARCHING", "pipeline", "인터넷 자료 조사", S.web_research),
    ("youtube_research", "RESEARCHING", "pipeline", "유튜브 인기 영상 조사", S.youtube_research),
    ("strategy", "RESEARCHING", "pipeline", "경쟁 분석·기획안 선정", S.strategy),
    ("factcheck", "RESEARCHING", "pipeline", "사실관계 검증", S.factcheck),
    ("script", "SCRIPTING", "pipeline", "제목·대본 작성", S.script),
    ("storyboard", "STORYBOARDING", "pipeline", "스토리보드·연출·캐릭터 설정", S.storyboard),
    ("plan_budget", "STORYBOARDING", "pipeline", "모델 선택·비용 산정", S.plan_budget),
    ("narration", "GENERATING", "pipeline", "내레이션 생성", S.narration),
    ("images", "GENERATING", "pipeline", "이미지 생성", S.images),
    ("videos", "GENERATING", "pipeline", "영상 생성", S.videos),
    ("music", "GENERATING", "pipeline", "배경음악 선정", S.music),
    ("subs", "EDITING", "pipeline", "자막 생성", S.subs),
    ("timeline", "EDITING", "pipeline", "편집 타임라인 구성", S.timeline),
    ("render", "RENDERING", "render", "영상 렌더링", S.render),
    ("review", "REVIEWING", "render", "품질검수", S.review),
    ("package", "RENDERING", "render", "업로드 패키지 제작", S.package),
]
STAGE_KEYS = [s[0] for s in STAGES]
STAGE_LABELS = {s[0]: s[3] for s in STAGES}


def utcnow():
    return datetime.now(timezone.utc)


def acquire(db, project_id: str, worker: str) -> bool:
    ttl = get_settings().lock_ttl_seconds
    now = utcnow()
    res = db.execute(update(Project).where(
        Project.id == project_id,
        or_(Project.locked_by.is_(None), Project.lock_expires_at < now, Project.locked_by == worker),
    ).values(locked_by=worker, lock_expires_at=now + timedelta(seconds=ttl)))
    db.commit()
    return res.rowcount == 1


def release(db, p: Project):
    p.locked_by, p.lock_expires_at = None, None
    db.commit()


def set_stage(db, p: Project, key: str, **fields):
    st = dict(p.stage_state or {})
    st[key] = {**(st.get(key) or {}), **fields}
    p.stage_state = st
    flag_modified(p, "stage_state")
    done = sum(1 for k in STAGE_KEYS if (st.get(k) or {}).get("status") == "done")
    p.progress = int(done / len(STAGES) * 100)
    db.commit()


def reset_stages(db, p: Project, keys: list[str]):
    st = dict(p.stage_state or {})
    for k in keys:
        st[k] = {"status": "pending", "attempts": (st.get(k) or {}).get("attempts", 0)}
    p.stage_state = st
    flag_modified(p, "stage_state")
    db.commit()


def run_project(project_id: str, queue: str = "pipeline", enqueue=None) -> str:
    """프로젝트를 가능한 데까지 진행한다. 반환: 최종 상태 또는 'handoff:<queue>' / 'locked'."""
    worker = f"{queue}-{uuid.uuid4().hex[:8]}"
    with session_scope() as db:
        if not acquire(db, project_id, worker):
            return "locked"
        p = db.get(Project, project_id)
        if p.status in ("COMPLETED", "CANCELLED"):
            release(db, p)
            return p.status
        c = Ctx(db, p, worker)
        c.stage_count = len(STAGES)
        p.error = None
        try:
            guard = 0
            while True:
                guard += 1
                if guard > 12:
                    raise PipelineError("단계 반복 한도를 넘었습니다.")
                looped = False
                for key, status, q, label, fn in STAGES:
                    if (p.stage_state or {}).get(key, {}).get("status") == "done":
                        continue
                    if q != queue and enqueue:
                        release(db, p)
                        enqueue(project_id, q)
                        return f"handoff:{q}"
                    c.heartbeat()
                    p.status, p.current_stage = status, key
                    attempts = (p.stage_state or {}).get(key, {}).get("attempts", 0) + 1
                    set_stage(db, p, key, status="running", attempts=attempts, started_at=utcnow().isoformat(), error=None)
                    c.log(f"{label} 시작", "info", "stage", stage=key)
                    redo = fn(c)
                    set_stage(db, p, key, status="done", finished_at=utcnow().isoformat())
                    if redo:  # 품질검수가 일부 단계의 재실행을 요청
                        reset_stages(db, p, redo)
                        looped = True
                        break
                if not looped:
                    break
            p.status, p.current_stage, p.progress = "COMPLETED", None, 100
            c.log("제작 완료", "info", "done")
        except Cancelled:
            p.status, p.cancel_requested = "CANCELLED", False
            c.log("사용자 요청으로 중지되었습니다.", "warn", "cancel")
        except BudgetExceeded as e:
            p.status, p.error = "AWAITING_APPROVAL", str(e)
            set_stage(db, p, p.current_stage, status="pending")
            c.log(f"승인 대기: {e}", "warn", "budget")
        except Exception as e:  # noqa: BLE001
            db.rollback()
            msg = e.message if isinstance(e, ProviderError) else str(e)
            if isinstance(e, ProviderError):
                hint = {"balance": "API 잔액이 부족하고, 대신 쓸 다른 공급자가 연결돼 있지 않습니다. 충전하거나 'API 연결 관리'에서 OpenAI 키를 등록(연결 확인)한 뒤 '다시 시도'를 누르세요.",
                        "auth": "API 키 또는 요금제 권한 문제입니다. 'API 연결 관리'와 공급자 요금제를 확인하세요.",
                        "config": "", "rate_limit": "요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요."}.get(e.kind, "")
                msg = f"[{e.provider}] {msg} {hint}".strip()
            p.status, p.error = "FAILED", msg[:2000]
            set_stage(db, p, p.current_stage or "analyze", status="failed", error=msg[:1000])
            c.log(f"실패({STAGE_LABELS.get(p.current_stage, p.current_stage)}): {msg}", "error", "error",
                  trace=traceback.format_exc()[-2000:] if not isinstance(e, (ProviderError, PipelineError)) else None)
        finally:
            release(db, p)
        return p.status


def release_dead_locks(db) -> int:
    """단일 프로세스(inline) 모드 전용: 서버가 새로 뜬 시점의 잠금은 모두 죽은 프로세스의 것이다.
    만료(lock_ttl_seconds, 기본 15분)를 기다리지 않고 바로 풀어 중단된 작업을 즉시 이어서 진행하게 한다."""
    rows = db.query(Project).filter(Project.locked_by.isnot(None)).all()
    for p in rows:
        p.locked_by, p.lock_expires_at = None, None
        if p.status in ACTIVE:
            db.add(AuditLog(user_id=p.user_id, project_id=p.id, action="recover", level="warn",
                            message="서버가 재시작되어 중단된 작업을 이어서 진행합니다(완료된 단계·생성물은 재사용)."))
    db.commit()
    return len(rows)


def stale_projects(db) -> list[str]:
    """진행 중 상태인데 잠금이 풀렸거나 만료된 작업(서버 재시작 등) → 복구 대상."""
    now = utcnow()
    q = db.query(Project.id).filter(Project.status.in_(ACTIVE), Project.cancel_requested.is_(False),
                                    or_(Project.locked_by.is_(None), Project.lock_expires_at < now))
    return [i for (i,) in q]


def queue_for(p: Project) -> str:
    for key, _, q, _, _ in STAGES:
        if (p.stage_state or {}).get(key, {}).get("status") != "done":
            return q
    return "pipeline"
