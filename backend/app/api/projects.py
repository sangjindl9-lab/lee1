"""인증 · 프로젝트(제작) · 일괄/예약 제작 · 비용 · 환경설정 API."""
import asyncio
import io
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .. import tasks
from ..db import get_db, session_scope
from ..deps import current_user
from ..models import (ACTIVE, AuditLog, CostRecord, GeneratedAsset, Project, ProjectSettings, ProviderRequest,
                      QualityReport, ResearchSource, Scene, Script, Storyboard, Subtitle, User, YoutubeReference,
                      YoutubeUpload, gset, uid)
from ..pipeline.orchestrator import STAGE_KEYS, STAGES
from ..providers import higgsfield as hf
from ..providers import registry
from ..security import hash_password, make_token, read_token, verify_password
from ..storage import file_url, get_storage

router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ 인증 --
class LoginIn(BaseModel):
    username: str
    password: str
    email: str | None = None


def user_out(u: User) -> dict:
    return u.dict("password_hash")


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(username=body.username).first()
    if not u or not u.is_active or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
    return {"token": make_token({"uid": u.id}), "user": user_out(u)}


@router.post("/auth/register")
def register(body: LoginIn, db: Session = Depends(get_db)):
    if not gset(db, "allow_signup"):
        raise HTTPException(403, "현재 회원가입이 닫혀 있습니다.")
    if len(body.username) < 3 or len(body.password) < 8:
        raise HTTPException(400, "아이디는 3자 이상, 비밀번호는 8자 이상이어야 합니다.")
    if db.query(User).filter_by(username=body.username).first():
        raise HTTPException(409, "이미 사용 중인 아이디입니다.")
    u = User(username=body.username, email=body.email, password_hash=hash_password(body.password),
             daily_cost_limit_usd=gset(db, "default_daily_cost_limit_usd"),
             monthly_cost_limit_usd=gset(db, "default_monthly_cost_limit_usd"),
             daily_video_limit=gset(db, "default_daily_video_limit"))
    db.add(u)
    db.commit()
    return {"token": make_token({"uid": u.id}), "user": user_out(u)}


@router.get("/auth/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


# -------------------------------------------------------------- 프로젝트 --
class Options(BaseModel):
    style: str | None = None
    voice: str | None = None
    resolution: str = "1080x1920"
    fps: int = 30
    llm_model: str | None = None
    image_model: str | None = None
    video_model: str | None = None
    tts_model: str | None = None
    character_id: str | None = None
    allow_unpriced: bool = False
    subtitle_languages: list[str] = []
    no_music: bool = False
    speed: float = 1.0
    subtitle_style: dict = {}


class ProjectIn(BaseModel):
    topic: str = Field(min_length=2, max_length=500)
    mode: str = "auto"
    language: str = "ko"
    duration: int = 0
    max_cost_usd: float | None = None
    options: Options = Options()


def _create(db: Session, user: User, body: ProjectIn, idem: str | None = None, batch_id: str | None = None,
            scheduled_at: datetime | None = None) -> Project:
    if body.mode not in ("economy", "quality", "cinematic", "auto"):
        raise HTTPException(400, "지원하지 않는 제작 모드입니다.")
    if body.options.resolution not in ("1080x1920", "2160x3840") or body.options.fps not in (30, 60):
        raise HTTPException(400, "지원하지 않는 출력 규격입니다.")
    for kw in gset(db, "blocked_keywords") or []:
        if kw and kw.lower() in body.topic.lower():
            raise HTTPException(400, "콘텐츠 정책상 제작할 수 없는 주제입니다.")
    p = Project(user_id=user.id, topic=body.topic.strip(), mode=body.mode, language=body.language,
                target_duration=body.duration, idempotency_key=idem, batch_id=batch_id, scheduled_at=scheduled_at,
                max_cost_usd=body.max_cost_usd or (user.settings or {}).get("default_max_cost_usd")
                or gset(db, "default_max_cost_usd"))
    db.add(p)
    db.flush()
    o = body.options
    brand = (user.settings or {}).get("branding") or {}
    db.add(ProjectSettings(
        project_id=p.id, style=o.style, voice=o.voice, resolution=o.resolution, fps=o.fps, llm_model=o.llm_model,
        image_model=o.image_model, video_model=o.video_model, tts_model=o.tts_model, character_id=o.character_id,
        allow_unpriced=o.allow_unpriced or bool((user.settings or {}).get("allow_unpriced")),
        subtitle_style=o.subtitle_style or (user.settings or {}).get("subtitle_style") or {}, branding=brand,
        extra={"subtitle_languages": o.subtitle_languages, "no_music": o.no_music, "speed": o.speed}))
    db.commit()
    return p


@router.post("/projects")
def create_project(body: ProjectIn, idempotency_key: str | None = Header(None), user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    if idempotency_key:  # 같은 제작 요청이 두 번 들어와도 한 번만 실행
        key = f"{user.id}:{idempotency_key}"[:128]
        old = db.query(Project).filter_by(idempotency_key=key).first()
        if old:
            return summary(old)
    else:
        key = None
    p = _create(db, user, body, key)
    tasks.enqueue(p.id, "pipeline")
    return summary(p)


def summary(p: Project) -> dict:
    d = p.dict("stage_data", "stage_state", "package", "locked_by", "lock_expires_at", "idempotency_key")
    d["video_url"] = file_url(p.output_video_key) if p.status == "COMPLETED" else None
    thumb = (p.package or {}).get("thumbnail") or ((p.package or {}).get("covers") or [None])[0]
    d["thumbnail_url"] = file_url(thumb)
    return d


def own(db: Session, user: User, pid: str) -> Project:
    p = db.get(Project, pid)
    if not p or (p.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
    return p


@router.get("/projects")
def list_projects(status: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Project).filter_by(user_id=user.id)
    if status == "active":
        q = q.filter(Project.status.in_(ACTIVE + ["PENDING", "AWAITING_APPROVAL"]))
    elif status:
        q = q.filter_by(status=status)
    return [summary(p) for p in q.order_by(Project.created_at.desc()).limit(200)]


def stage_list(p: Project) -> list[dict]:
    st = p.stage_state or {}
    return [{"key": k, "label": label, "group": status, **{"status": "pending", **(st.get(k) or {})}}
            for k, status, _, label, _ in STAGES]


def logs(db: Session, pid: str, n: int = 80) -> list[dict]:
    rows = db.query(AuditLog).filter_by(project_id=pid).order_by(AuditLog.created_at.desc()).limit(n).all()
    return [{"at": r.created_at.isoformat(), "level": r.level, "action": r.action, "message": r.message} for r in reversed(rows)]


@router.get("/projects/{pid}")
def get_project(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    d = summary(p)
    d["stages"], d["stage_data"], d["logs"] = stage_list(p), p.stage_data or {}, logs(db, pid)
    cfg = db.query(ProjectSettings).filter_by(project_id=pid).first()
    d["settings"] = cfg.dict() if cfg else {}
    assets = {a.id: a for a in db.query(GeneratedAsset).filter_by(project_id=pid)}

    def aurl(i):
        return file_url(assets[i].storage_key) if i in assets else None
    d["scenes"] = [{**s.dict("words"), "image_url": aurl(s.image_asset_id), "video_url": aurl(s.video_asset_id),
                    "audio_url": aurl(s.audio_asset_id)} for s in db.query(Scene).filter_by(project_id=pid).order_by(Scene.idx)]
    sc = db.query(Script).filter_by(project_id=pid).order_by(Script.version.desc()).first()
    d["script"] = sc.dict() if sc else None
    sb = db.query(Storyboard).filter_by(project_id=pid).order_by(Storyboard.version.desc()).first()
    d["storyboard"] = sb.dict() if sb else None
    d["sources"] = [s.dict() for s in db.query(ResearchSource).filter_by(project_id=pid).order_by(ResearchSource.kind)]
    refs = db.query(YoutubeReference).filter_by(project_id=pid).all()
    refs.sort(key=lambda r: r.metrics.get("score", 0), reverse=True)
    d["youtube"] = [r.dict("description") for r in refs[:30]]
    d["quality"] = [q.dict() for q in db.query(QualityReport).filter_by(project_id=pid).order_by(QualityReport.created_at)]
    costs = db.query(CostRecord.provider, CostRecord.model_key, CostRecord.kind, func.sum(CostRecord.amount_usd),
                     func.count()).filter_by(project_id=pid).group_by(CostRecord.provider, CostRecord.model_key, CostRecord.kind)
    d["costs"] = [{"provider": a, "model": b, "kind": k, "amount_usd": round(v or 0, 5), "calls": n} for a, b, k, v, n in costs]
    d["failed_requests"] = [r.dict("request", "response") for r in db.query(ProviderRequest).filter_by(
        project_id=pid, status="failed").order_by(ProviderRequest.created_at.desc()).limit(20)]
    pk = dict(p.package or {})
    if pk:
        pk["cover_urls"] = [file_url(k) for k in pk.get("covers") or []]
        pk["thumbnail_url"] = file_url(pk.get("thumbnail"))
    d["package"] = pk
    d["subtitles"] = [{"language": s.language, "format": s.format, "url": file_url(s.storage_key), "sync": s.sync_method}
                      for s in db.query(Subtitle).filter_by(project_id=pid)]
    d["uploads"] = [u.dict("response") for u in db.query(YoutubeUpload).filter_by(project_id=pid)]
    return d


class ApproveIn(BaseModel):
    max_cost_usd: float | None = None
    allow_unpriced: bool | None = None


def _restart(db: Session, p: Project):
    st = dict(p.stage_state or {})
    for k in STAGE_KEYS:
        if (st.get(k) or {}).get("status") in ("failed", "running"):
            st[k] = {**st[k], "status": "pending"}
    p.stage_state, p.status, p.error, p.cancel_requested = st, "PENDING", None, False
    flag_modified(p, "stage_state")
    db.commit()
    tasks.enqueue(p.id)


@router.post("/projects/{pid}/retry")
def retry(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    if p.status not in ("FAILED", "CANCELLED", "AWAITING_APPROVAL", "PENDING"):
        raise HTTPException(409, "이미 진행 중이거나 완료된 작업입니다.")
    _restart(db, p)  # 실패한 단계부터 이어서 진행(완료 단계·생성 소스는 재사용)
    return summary(p)


@router.post("/projects/{pid}/approve")
def approve(pid: str, body: ApproveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    if p.status != "AWAITING_APPROVAL":
        raise HTTPException(409, "승인 대기 상태가 아닙니다.")
    if body.max_cost_usd is not None:
        if body.max_cost_usd < p.actual_cost_usd:
            raise HTTPException(400, "이미 사용한 금액보다 작게 설정할 수 없습니다.")
        p.max_cost_usd = body.max_cost_usd
    if body.allow_unpriced is not None:
        db.query(ProjectSettings).filter_by(project_id=pid).update({"allow_unpriced": body.allow_unpriced})
    db.add(AuditLog(user_id=user.id, project_id=pid, action="approve", level="info",
                    message=f"사용자 승인: 최대 비용 ${p.max_cost_usd:.2f}, 단가 미등록 허용={body.allow_unpriced}"))
    _restart(db, p)
    return summary(p)


@router.post("/projects/{pid}/cancel")
def cancel(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    if p.status in ("COMPLETED", "CANCELLED"):
        return summary(p)
    if p.locked_by and p.status in ACTIVE:
        p.cancel_requested = True  # 워커가 다음 확인 지점에서 멈춘다
    else:
        p.status = "CANCELLED"
    db.commit()
    # 아직 대기열에 있는 Higgsfield 요청은 취소를 시도한다(처리 시작 전이면 환불).
    cred = registry.credentials(db, p.user_id, "higgsfield")
    if cred:
        client = hf.Higgsfield(**cred)
        for r in db.query(ProviderRequest).filter_by(project_id=pid, provider="higgsfield", status="submitted"):
            if r.external_id and client.cancel(r.external_id):
                r.status, r.error, r.billed = "failed", "사용자 취소", False
        db.commit()
    return summary(p)


@router.delete("/projects/{pid}")
def delete_project(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    if p.status in ACTIVE and p.locked_by:
        raise HTTPException(409, "진행 중인 작업은 먼저 중지하세요.")
    st = get_storage()
    for a in db.query(GeneratedAsset).filter_by(project_id=pid):
        try:
            st.delete(a.storage_key)
        except Exception:  # noqa: BLE001
            pass
    for model in (Scene, Script, Storyboard, Subtitle, ResearchSource, QualityReport, GeneratedAsset, ProjectSettings):
        db.query(model).filter_by(project_id=pid).delete()
    db.delete(p)
    db.commit()
    return {"ok": True}


# -- AI 영상 편집기: 장면 수정 후 필요한 단계만 다시 실행 -------------------
class SceneEdit(BaseModel):
    narration: str | None = None
    image_prompt: str | None = None
    video_prompt: str | None = None
    kind: str | None = None
    transition: str | None = None
    subtitle_position: str | None = None
    regenerate: bool = False


ORDER = {k: i for i, k in enumerate(STAGE_KEYS)}


@router.patch("/projects/{pid}/scenes/{sid}")
def edit_scene(pid: str, sid: str, body: SceneEdit, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    if p.status in ACTIVE:
        raise HTTPException(409, "제작이 진행 중일 때는 수정할 수 없습니다.")
    s = db.get(Scene, sid)
    if not s or s.project_id != pid:
        raise HTTPException(404, "장면을 찾을 수 없습니다.")
    first = None

    def mark(stage):
        nonlocal first
        if first is None or ORDER[stage] < ORDER[first]:
            first = stage
    if body.narration is not None and body.narration.strip() != s.narration:
        s.narration, s.tts_text, s.audio_asset_id, s.words = body.narration.strip(), None, None, []
        s.attempts += 1
        mark("narration")
    if (body.image_prompt is not None and body.image_prompt != s.image_prompt) or body.regenerate:
        s.image_prompt = body.image_prompt if body.image_prompt is not None else s.image_prompt
        s.status, s.attempts = "redo", s.attempts + 1
        mark("images")
    if body.video_prompt is not None and body.video_prompt != s.video_prompt:
        s.video_prompt, s.video_asset_id = body.video_prompt, None
        s.attempts += 1
        mark("videos")
    if body.kind in ("image", "video") and body.kind != s.kind:
        s.kind = body.kind
        if body.kind == "video" and not s.video_model:
            m = registry.pick_model(db, p.user_id, "i2v")
            if not m:
                raise HTTPException(400, "연결된 영상 생성 모델이 없습니다.")
            s.video_model = m.model_key
        mark("videos")
    if body.transition and body.transition != s.transition:
        s.transition = body.transition
        mark("timeline")
    if body.subtitle_position in ("lower", "center") and body.subtitle_position != s.subtitle_position:
        s.subtitle_position = body.subtitle_position
        mark("subs")
    db.commit()
    return {"ok": True, "rebuild_from": first}


class RebuildIn(BaseModel):
    from_stage: str
    subtitle_style: dict | None = None
    max_cost_usd: float | None = None


@router.post("/projects/{pid}/rebuild")
def rebuild(pid: str, body: RebuildIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    if p.status in ACTIVE:
        raise HTTPException(409, "제작이 진행 중입니다.")
    if body.from_stage not in ORDER or ORDER[body.from_stage] < ORDER["narration"]:
        raise HTTPException(400, "narration 이후 단계부터 다시 만들 수 있습니다.")
    if body.subtitle_style is not None:
        db.query(ProjectSettings).filter_by(project_id=pid).update({"subtitle_style": body.subtitle_style})
    if body.max_cost_usd:
        p.max_cost_usd = max(body.max_cost_usd, p.actual_cost_usd)
    st = dict(p.stage_state or {})
    for k in STAGE_KEYS[ORDER[body.from_stage]:]:
        st[k] = {"status": "pending"}
    p.stage_state, p.status, p.error, p.regen_rounds = st, "PENDING", None, 0
    flag_modified(p, "stage_state")
    db.commit()
    tasks.enqueue(p.id)
    return summary(p)


# -- 진행 상황 스트림(SSE) ----------------------------------------------------
@router.get("/projects/{pid}/events")
async def events(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    own(db, user, pid)

    def snapshot():
        with session_scope() as s:
            p = s.get(Project, pid)
            if not p:
                return None
            return {"status": p.status, "stage": p.current_stage, "progress": p.progress, "error": p.error,
                    "actual_cost_usd": p.actual_cost_usd, "estimated_cost_usd": p.estimated_cost_usd,
                    "stages": stage_list(p), "logs": logs(s, pid, 30), "updated_at": p.updated_at.isoformat()}

    async def gen():
        last, idle = None, 0
        while True:
            snap = await asyncio.to_thread(snapshot)
            if snap is None:
                break
            blob = json.dumps(snap, ensure_ascii=False)
            if blob != last:
                last, idle = blob, 0
                yield f"data: {blob}\n\n"
            else:
                idle += 1
                if idle % 15 == 0:
                    yield ": keep-alive\n\n"
            if snap["status"] in ("COMPLETED", "FAILED", "CANCELLED") and idle > 2:
                break
            await asyncio.sleep(1)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# -- 다운로드 ----------------------------------------------------------------
@router.get("/files/{key:path}")
def get_file(key: str, t: str):
    data = read_token(t)
    if not data or data.get("f") != key:
        raise HTTPException(403, "링크가 만료되었거나 올바르지 않습니다.")
    st = get_storage()
    if not st.exists(key):
        raise HTTPException(404, "파일이 없습니다.")
    return FileResponse(st.local_path(key))


def safe_name(s: str) -> str:
    return re.sub(r"[^\w가-힣\- ]+", "", s or "shorts").strip()[:60] or "shorts"


@router.get("/projects/{pid}/download")
def download_video(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    if not p.output_video_key:
        raise HTTPException(404, "완성된 영상이 없습니다.")
    return FileResponse(get_storage().local_path(p.output_video_key), media_type="video/mp4",
                        filename=f"{safe_name(p.title)}.mp4")


@router.get("/projects/{pid}/package.zip")
def download_package(pid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own(db, user, pid)
    if p.status != "COMPLETED":
        raise HTTPException(409, "완성된 프로젝트만 내려받을 수 있습니다.")
    st, pk = get_storage(), p.package or {}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        z.write(st.local_path(p.output_video_key), "video.mp4")
        for s in db.query(Subtitle).filter_by(project_id=pid):
            if s.format in ("srt", "vtt"):
                z.write(st.local_path(s.storage_key), f"subtitles/{s.language}.{s.format}")
        for i, k in enumerate(pk.get("covers") or []):
            z.write(st.local_path(k), f"covers/cover_{i + 1}.jpg")
        if pk.get("thumbnail"):
            z.write(st.local_path(pk["thumbnail"]), "covers/thumbnail_title.jpg")
        z.writestr("metadata.json", json.dumps(pk, ensure_ascii=False, indent=2))
        lines = [f"# {pk.get('final_title')}", "", "## 추천 제목"] + [f"- {t}" for t in pk.get("titles") or []]
        lines += ["", "## 설명", pk.get("description") or "", "", "## 해시태그", " ".join(pk.get("hashtags") or []),
                  "", "## 고정 댓글", pk.get("pinned_comment") or "", "", "## 참고 자료"]
        lines += [f"- {s['claim']} — {s['title']} ({s['url']}, 발표 {s.get('published') or '미상'}, 확인 {s.get('checked')})"
                  for s in pk.get("sources") or []] or ["- 검증된 출처 없음"]
        lines += ["", "## AI 생성 콘텐츠 표시", json.dumps(pk.get("ai_disclosure"), ensure_ascii=False),
                  "", "## 정책 사전 검사", json.dumps(pk.get("policy_check"), ensure_ascii=False), pk.get("policy_disclaimer") or "",
                  "", f"## 제작 비용\n${pk.get('cost_usd')}"]
        z.writestr("upload_guide.md", "\n".join(lines))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="package_{pid[:8]}.zip"'})


# -- 무인 일괄 · 예약 제작 -----------------------------------------------------
class BatchIn(BaseModel):
    topics: list[str]
    mode: str = "auto"
    language: str = "ko"
    duration: int = 0
    max_cost_usd: float | None = None
    start_at: datetime | None = None
    options: Options = Options()


def _tokens(s: str) -> set[str]:
    return set(re.findall(r"[\w가-힣]+", s.lower()))


def too_similar(a: str, b: str) -> bool:
    x, y = _tokens(a), _tokens(b)
    return bool(x and y) and len(x & y) / len(x | y) >= 0.8


@router.post("/batches")
def create_batch(body: BatchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """여러 주제를 큐에 등록한다. 지나치게 비슷한 주제는 걸러 반복 콘텐츠 생산을 막는다."""
    recent = [t for (t,) in db.query(Project.topic).filter_by(user_id=user.id).order_by(Project.created_at.desc()).limit(200)]
    batch, created, skipped, accepted = uid(), [], [], []
    start = body.start_at or datetime.now(timezone.utc)
    for raw in body.topics[:100]:
        topic = raw.strip()
        if len(topic) < 2:
            continue
        dup = next((t for t in accepted + recent if too_similar(topic, t)), None)
        if dup:
            skipped.append({"topic": topic, "reason": f"기존 주제와 거의 같음: {dup}"})
            continue
        if len(created) >= user.daily_video_limit:
            skipped.append({"topic": topic, "reason": "일일 제작 수량 한도"})
            continue
        accepted.append(topic)
        p = _create(db, user, ProjectIn(topic=topic, mode=body.mode, language=body.language, duration=body.duration,
                                        max_cost_usd=body.max_cost_usd, options=body.options), None, batch,
                    start + timedelta(seconds=len(created)))
        created.append(summary(p))
    return {"batch_id": batch, "created": created, "skipped": skipped,
            "note": "작업은 사용자별로 한 번에 하나씩 순서대로 진행되며, 일·월 비용 한도를 넘으면 승인 대기로 멈춥니다."}


@router.get("/batches")
def list_scheduled(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Project).filter(Project.user_id == user.id, Project.batch_id.isnot(None)).order_by(Project.created_at.desc())
    return [summary(p) for p in q.limit(300)]


# -- 사용량 · 비용 ------------------------------------------------------------
@router.get("/costs")
def costs(user: User = Depends(current_user), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month0 = day0.replace(day=1)

    def total(since):
        return round(float(db.query(func.coalesce(func.sum(CostRecord.amount_usd), 0.0)).filter(
            CostRecord.user_id == user.id, CostRecord.created_at >= since).scalar() or 0), 4)
    recs = db.query(CostRecord).filter(CostRecord.user_id == user.id, CostRecord.created_at >= now - timedelta(days=31)).all()
    by_day, by_model, by_project = {}, {}, {}
    for r in recs:
        d = r.created_at.strftime("%m-%d")
        by_day[d] = round(by_day.get(d, 0) + r.amount_usd, 4)
        k = f"{r.provider}/{r.model_key or r.kind}"
        m = by_model.setdefault(k, {"model": k, "kind": r.kind, "amount_usd": 0, "calls": 0})
        m["amount_usd"], m["calls"] = round(m["amount_usd"] + r.amount_usd, 4), m["calls"] + 1
        if r.project_id:
            by_project[r.project_id] = round(by_project.get(r.project_id, 0) + r.amount_usd, 4)
    titles = {p.id: p.title or p.topic for p in db.query(Project).filter(Project.id.in_(list(by_project) or [""]))}
    fails = db.query(ProviderRequest).filter(ProviderRequest.user_id == user.id, ProviderRequest.status == "failed",
                                             ProviderRequest.created_at >= now - timedelta(days=31)).all()
    return {"today": total(day0), "month": total(month0),
            "limits": {"daily": user.daily_cost_limit_usd, "monthly": user.monthly_cost_limit_usd,
                       "daily_videos": user.daily_video_limit},
            "by_day": [{"day": k, "amount_usd": v} for k, v in sorted(by_day.items())],
            "by_model": sorted(by_model.values(), key=lambda x: -x["amount_usd"]),
            "by_project": sorted(({"project_id": k, "title": titles.get(k, k), "amount_usd": v} for k, v in by_project.items()),
                                 key=lambda x: -x["amount_usd"])[:50],
            "failed_requests": [{"provider": f.provider, "model": f.model_key, "kind": f.kind, "error": f.error,
                                 "billed": f.billed, "at": f.created_at.isoformat()} for f in fails[-50:]],
            "note": "금액은 등록된 단가표로 계산한 값입니다. 공급자가 금액을 응답에 주지 않아 실제 청구액과 다를 수 있습니다."}


# -- 환경설정 -----------------------------------------------------------------
class SettingsIn(BaseModel):
    locale: str | None = None
    daily_cost_limit_usd: float | None = None
    monthly_cost_limit_usd: float | None = None
    daily_video_limit: int | None = None
    settings: dict | None = None
    password: str | None = None


@router.put("/settings")
def put_settings(body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.locale:
        user.locale = body.locale
    for f in ("daily_cost_limit_usd", "monthly_cost_limit_usd", "daily_video_limit"):
        v = getattr(body, f)
        if v is not None:
            if v < 0:
                raise HTTPException(400, "한도는 0 이상이어야 합니다.")
            setattr(user, f, v)
    if body.settings is not None:
        user.settings = {**(user.settings or {}), **body.settings}
        flag_modified(user, "settings")
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(400, "비밀번호는 8자 이상이어야 합니다.")
        user.password_hash = hash_password(body.password)
    db.commit()
    return user_out(user)


@router.get("/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    counts = dict(db.query(Project.status, func.count()).filter_by(user_id=user.id).group_by(Project.status).all())
    recent = db.query(Project).filter_by(user_id=user.id).order_by(Project.created_at.desc()).limit(8).all()
    avail = registry.available_providers(db, user.id)
    need = {"언어 AI": bool(avail & {"anthropic", "openai", "gemini"}), "이미지·영상(Higgsfield)": "higgsfield" in avail,
            "음성": bool(avail & {"elevenlabs", "openai"}), "웹 검색": bool(avail & {"tavily", "brave"}),
            "YouTube 조사": "youtube" in avail}
    c = costs(user, db)
    return {"counts": counts, "recent": [summary(p) for p in recent], "readiness": need,
            "cost": {"today": c["today"], "month": c["month"], "limits": c["limits"]}}
