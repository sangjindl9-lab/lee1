"""유튜브 콘텐츠 분석 · 인기 주제 찾기 · 채널 연결(OAuth) · 승인 기반 업로드 · 채널 성과."""
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db, session_scope
from ..deps import current_user
from ..models import (ApiUsageLog, AuditLog, ChannelAnalytics, CostRecord, Project, User, YoutubeChannel,
                      YoutubeUpload, gset)
from ..pipeline import agents as A
from ..pipeline.stages import collect_youtube
from ..providers import registry
from ..providers import youtube as yt
from ..providers.base import ProviderError
from ..providers.llm import LLM
from ..security import decrypt_json, encrypt_json, make_token, read_token
from ..storage import get_storage

router = APIRouter(prefix="/api")
_s = get_settings()


def data_client(db, user: User) -> yt.YouTubeData:
    cred = registry.credentials(db, user.id, "youtube")
    if not cred:
        raise HTTPException(400, "YouTube Data API 키를 'API 연결 관리'에서 먼저 등록하세요.")

    def on_quota(method, units):
        db.add(ApiUsageLog(user_id=user.id, provider="youtube", endpoint=method, units=units, unit_type="quota"))
    return yt.YouTubeData(cred["api_key"], on_quota)


def quick_agent(db, user: User, name: str, system: str, prompt: str, required: list[str]) -> dict:
    """프로젝트 밖(주제 찾기 등)에서 쓰는 1회성 LLM 호출. 사용량·비용을 남긴다."""
    m = registry.pick_model(db, user.id, "llm", "economy")
    if not m:
        raise HTTPException(400, "언어 AI(Claude·OpenAI·Gemini) 키를 먼저 등록하세요.")
    t0 = time.time()
    res = LLM(m.provider, registry.require(db, user.id, m.provider)["api_key"], m.endpoint).complete_json(system, prompt, required)
    db.add(ApiUsageLog(user_id=user.id, provider=m.provider, endpoint=f"llm:{name}", units=res.input_tokens + res.output_tokens,
                       unit_type="tokens", latency_ms=int((time.time() - t0) * 1000)))
    if m.unit_cost_usd is not None:
        db.add(CostRecord(user_id=user.id, provider=m.provider, model_key=m.model_key, kind="llm", estimated=False,
                          amount_usd=res.input_tokens / 1e6 * m.unit_cost_usd + res.output_tokens / 1e6 * (m.unit_cost_out_usd or m.unit_cost_usd)))
    db.commit()
    return res.data  # type: ignore[return-value]


def ref_out(r) -> dict:
    return {**r.dict("description"), "limits": "유지율·이탈률·노출 클릭률은 공개 API로 확인할 수 없어 표시하지 않습니다."}


@router.get("/youtube/analyze")
def analyze(q: str, lang: str = "ko", deep: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """유튜브 콘텐츠 분석: 검색어의 최근 인기 쇼츠 후보와 공개 지표."""
    client = data_client(db, user)
    try:
        r = collect_youtube(db, user.id, client, [q], q.split(), 450 if deep else 250, None, lang,
                            windows=(7, 30, 1, 90) if deep else (7, 30))
    except ProviderError as e:
        raise HTTPException(400, f"YouTube API 오류 — {e.message}") from None
    rows = r["rows"]
    durs = [x.duration_sec or 0 for x in rows]
    return {"videos": [ref_out(x) for x in rows[:50]], "comments": r["comments"], "quota_used": r["quota_used"],
            "covered": r["covered"], "note": r["note"], "short_note": r["short_note"],
            "duration_distribution": {"~15초": sum(d <= 15 for d in durs), "16~30초": sum(15 < d <= 30 for d in durs),
                                      "31~60초": sum(30 < d <= 60 for d in durs), "61~180초": sum(60 < d <= 180 for d in durs)}}


@router.get("/youtube/topics")
def topics(region: str = "KR", user: User = Depends(current_user), db: Session = Depends(get_db)):
    """인기 주제 찾기: 지역 인기 영상(공식 mostPopular 차트)을 근거로 새 주제를 제안."""
    client = data_client(db, user)
    try:
        vids = client.most_popular(region, 50)
    except ProviderError as e:
        raise HTTPException(400, f"YouTube API 오류 — {e.message}") from None
    compact = [{"video_id": v["video_id"], "title": v["title"], "views": v["view_count"], "likes": v["like_count"],
                "duration": v["duration_sec"], "channel": v["channel_title"], "published": v["published_at"]} for v in vids]
    try:
        out = quick_agent(db, user, "인기 주제", A.TOPICS, f"지역: {region}\n인기 영상:\n{A.ext(compact)}", ["topics"])
    except ProviderError as e:
        raise HTTPException(400, f"언어 AI 오류 — {e.message}") from None
    return {"topics": out.get("topics") or [], "based_on": compact[:20],
            "note": "공식 인기 차트의 공개 지표만 근거로 한 제안이며 조회수를 보장하지 않습니다."}


# ------------------------------------------------------------------ OAuth --
def oauth_client(db) -> tuple[str, str]:
    cred = registry.credentials(db, None, "google_oauth") or {}
    cid = cred.get("client_id") or _s.google_client_id
    sec = cred.get("client_secret") or _s.google_client_secret
    if not cid or not sec:
        raise HTTPException(400, "Google OAuth 클라이언트가 설정되지 않았습니다. 관리자가 클라이언트 ID·시크릿을 등록해야 합니다.")
    return cid, sec


def redirect_uri() -> str:
    return f"{_s.public_base_url}/api/youtube/oauth/callback"


@router.get("/youtube/oauth/start")
def oauth_start(user: User = Depends(current_user), db: Session = Depends(get_db)):
    cid, _ = oauth_client(db)
    return {"url": yt.oauth_url(cid, redirect_uri(), make_token({"oauth_uid": user.id}, 0.25)),
            "redirect_uri": redirect_uri()}


@router.get("/youtube/oauth/callback")
def oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None, db: Session = Depends(get_db)):
    front = f"{_s.frontend_url}/channels"
    data = read_token(state or "")
    if error or not code or not data or not data.get("oauth_uid"):
        return RedirectResponse(f"{front}?error={error or 'invalid_state'}")
    cid, sec = oauth_client(db)
    try:
        tok = yt.oauth_exchange(cid, sec, redirect_uri(), code)
        ch = yt.YouTubeAccount(tok["access_token"]).my_channel()
    except ProviderError as e:
        return RedirectResponse(f"{front}?error={e.kind}")
    if not ch:
        return RedirectResponse(f"{front}?error=no_channel")
    tok["obtained_at"] = time.time()
    row = db.query(YoutubeChannel).filter_by(user_id=data["oauth_uid"], channel_id=ch["channel_id"]).first()
    if not row:
        row = YoutubeChannel(user_id=data["oauth_uid"], channel_id=ch["channel_id"])
        db.add(row)
    old = decrypt_json(row.tokens_enc) if row.tokens_enc else {}
    tok.setdefault("refresh_token", old.get("refresh_token"))
    row.title, row.thumbnail, row.tokens_enc, row.scopes, row.status = ch["title"], ch["thumbnail"], encrypt_json(tok), tok.get("scope"), "connected"
    db.commit()
    return RedirectResponse(f"{front}?connected=1")


def account(db, row: YoutubeChannel) -> yt.YouTubeAccount:
    tok = decrypt_json(row.tokens_enc)
    if time.time() > tok.get("obtained_at", 0) + tok.get("expires_in", 3600) - 120:
        if not tok.get("refresh_token"):
            row.status = "expired"
            db.commit()
            raise HTTPException(400, "채널 인증이 만료되었습니다. 다시 연결하세요.")
        cid, sec = oauth_client(db)
        try:
            new = yt.oauth_refresh(cid, sec, tok["refresh_token"])
        except ProviderError:
            row.status = "expired"
            db.commit()
            raise HTTPException(400, "채널 인증을 갱신하지 못했습니다. 다시 연결하세요.") from None
        tok.update(new)
        tok["obtained_at"] = time.time()
        row.tokens_enc = encrypt_json(tok)
        db.commit()
    return yt.YouTubeAccount(tok["access_token"])


@router.get("/youtube/channels")
def channels(user: User = Depends(current_user), db: Session = Depends(get_db)):
    configured = True
    try:
        oauth_client(db)
    except HTTPException:
        configured = False
    return {"oauth_configured": configured, "redirect_uri": redirect_uri(),
            "channels": [c.dict("tokens_enc") for c in db.query(YoutubeChannel).filter_by(user_id=user.id)]}


@router.delete("/youtube/channels/{cid}")
def disconnect(cid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(YoutubeChannel, cid)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "채널이 없습니다.")
    tok = decrypt_json(row.tokens_enc) if row.tokens_enc else {}
    yt.oauth_revoke(tok.get("refresh_token") or tok.get("access_token") or "")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ----------------------------------------------------------------- 업로드 --
class UploadIn(BaseModel):
    channel_id: str
    confirm: bool = False
    privacy: str = "private"
    title: str | None = None
    description: str | None = None
    synthetic: bool | None = None


@router.post("/projects/{pid}/upload")
def upload(pid: str, body: UploadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """사용자가 명시적으로 승인(confirm=true)한 경우에만 videos.insert 로 올린다. 기본 공개 범위는 비공개."""
    p = db.get(Project, pid)
    if not p or p.user_id != user.id or p.status != "COMPLETED":
        raise HTTPException(404, "완성된 프로젝트가 아닙니다.")
    if not body.confirm:
        raise HTTPException(400, "업로드 승인(confirm)이 필요합니다. 승인 없는 자동 공개는 하지 않습니다.")
    if body.privacy not in ("private", "unlisted", "public"):
        raise HTTPException(400, "공개 범위가 올바르지 않습니다.")
    row = db.get(YoutubeChannel, body.channel_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "연결된 채널이 없습니다.")
    pk = p.package or {}
    up = YoutubeUpload(project_id=pid, channel_row_id=row.id, privacy=body.privacy, status="uploading",
                       approved_by_user=True, approved_at=datetime.now(timezone.utc))
    db.add(up)
    db.add(AuditLog(user_id=user.id, project_id=pid, action="upload_approved", message=f"업로드 승인({body.privacy})"))
    db.commit()
    desc = (body.description or pk.get("description") or "") + "\n\n" + " ".join(pk.get("hashtags") or [])
    try:
        res = account(db, row).upload(get_storage().local_path(p.output_video_key), body.title or pk.get("final_title") or p.title or p.topic,
                                      desc.strip(), [k.lstrip("#") for k in (pk.get("keywords") or [])], body.privacy, body.synthetic)
    except ProviderError as e:
        up.status, up.error = "failed", f"{e.kind}: {e.message}"
        db.commit()
        raise HTTPException(400, f"업로드 실패 — {e.message}") from None
    up.video_id, up.status = res.get("id"), "uploaded"
    actual = (res.get("status") or {}).get("privacyStatus")
    up.response = {"privacyStatus": actual, "uploadStatus": (res.get("status") or {}).get("uploadStatus")}
    db.commit()
    note = None
    if actual and actual != body.privacy:
        note = f"요청한 공개 범위({body.privacy})와 다르게 '{actual}'로 올라갔습니다. API 프로젝트가 감사(검증)를 통과하지 않으면 비공개로 제한됩니다."
    return {"video_id": up.video_id, "url": f"https://www.youtube.com/shorts/{up.video_id}", "privacy": actual, "note": note}


# -------------------------------------------------------------- 채널 성과 --
WINDOWS = {"24h": 1, "3d": 3, "7d": 7}


def _collect(db, up: YoutubeUpload, window: str) -> bool:
    row = db.get(YoutubeChannel, up.channel_row_id)
    if not row or row.status != "connected":
        return False
    start = (up.created_at - timedelta(days=1)).strftime("%Y-%m-%d")
    m = account(db, row).video_report(up.video_id, start, datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    db.add(ChannelAnalytics(channel_row_id=row.id, project_id=up.project_id, video_id=up.video_id, window=window, metrics=m))
    db.commit()
    return True


def collect_due_analytics() -> int:
    """업로드 후 24시간·3일·7일 시점의 본인 채널 지표를 수집한다(주기 작업에서 호출)."""
    n = 0
    with session_scope() as db:
        now = datetime.now(timezone.utc)
        for up in db.query(YoutubeUpload).filter(YoutubeUpload.video_id.isnot(None), YoutubeUpload.status == "uploaded"):
            created = up.created_at if up.created_at.tzinfo else up.created_at.replace(tzinfo=timezone.utc)
            if now - created > timedelta(days=9):
                continue
            have = {w for (w,) in db.query(ChannelAnalytics.window).filter_by(video_id=up.video_id)}
            for w, days in WINDOWS.items():
                if w not in have and now - created >= timedelta(days=days):
                    try:
                        n += bool(_collect(db, up, w))
                    except Exception:  # noqa: BLE001
                        db.rollback()
    return n


@router.post("/youtube/analytics/collect")
def collect_now(user: User = Depends(current_user), db: Session = Depends(get_db)):
    n, errors = 0, []
    q = db.query(YoutubeUpload).join(Project, Project.id == YoutubeUpload.project_id).filter(
        Project.user_id == user.id, YoutubeUpload.video_id.isnot(None))
    for up in q:
        try:
            n += bool(_collect(db, up, "manual"))
        except (ProviderError, HTTPException) as e:
            errors.append(getattr(e, "message", None) or getattr(e, "detail", str(e)))
    return {"collected": n, "errors": errors}


@router.get("/youtube/analytics")
def analytics(user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = []
    q = db.query(YoutubeUpload, Project).join(Project, Project.id == YoutubeUpload.project_id).filter(
        Project.user_id == user.id, YoutubeUpload.video_id.isnot(None)).order_by(YoutubeUpload.created_at.desc())
    for up, p in q:
        rows = db.query(ChannelAnalytics).filter_by(video_id=up.video_id).order_by(ChannelAnalytics.captured_at).all()
        out.append({"project_id": p.id, "title": p.title, "topic": p.topic, "mode": p.mode, "video_id": up.video_id,
                    "url": f"https://www.youtube.com/shorts/{up.video_id}", "uploaded_at": up.created_at.isoformat(),
                    "duration": (p.package or {}).get("video", {}).get("duration"),
                    "snapshots": [{"window": r.window, "at": r.captured_at.isoformat(), "metrics": r.metrics} for r in rows]})
    return {"videos": out, "pass_score": gset(db, "quality_pass_score"),
            "note": "본인 채널에 한해 YouTube Analytics API로 수집한 실측값입니다. 수집된 성과는 다음 제작의 기획 단계에 참고 자료로 전달됩니다."}
