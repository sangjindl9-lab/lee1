"""API 연결 관리 · 모델 레지스트리 · 음성 목록 · 라이브러리(캐릭터/브랜딩/음악/라이선스)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..db import get_db
from ..deps import admin_user, current_user
from ..media import ffmpeg
from ..models import AudioTrack, Character, License, ProviderConfig, ProviderModel, User, uid
from ..providers import registry, speech
from ..providers.base import ProviderError
from ..providers.higgsfield import Higgsfield
from ..providers.llm import LLM
from ..providers.search import ENGINES
from ..providers.youtube import YouTubeData
from ..security import decrypt_json, encrypt_json, mask
from ..storage import file_url, get_storage

router = APIRouter(prefix="/api")


def _row(db, user: User, provider: str, scope: str) -> ProviderConfig | None:
    uid_ = None if scope == "global" else user.id
    return db.query(ProviderConfig).filter(ProviderConfig.provider == provider, ProviderConfig.user_id == uid_
                                           if uid_ else ProviderConfig.user_id.is_(None)).first()


@router.get("/providers")
def list_providers(user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = []
    for c in registry.CATALOG:
        mine, glob = _row(db, user, c["id"], "user"), _row(db, user, c["id"], "global")
        active = mine or glob

        def view(r):
            if not r:
                return None
            cred = decrypt_json(r.credentials_enc) if r.credentials_enc else {}
            return {"status": r.status, "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
                    "last_error": r.last_error, "masked": {k: mask(str(v)) for k, v in cred.items()}, "meta": r.meta}
        env = bool(registry._env_credentials(c["id"]))
        out.append({**c, "mine": view(mine), "shared": {"status": glob.status} if glob else None, "env": env,
                    "connected": bool(active and active.credentials_enc) or env,
                    "verified": bool(active and active.status == "ok")})
    return out


class CredIn(BaseModel):
    credentials: dict
    scope: str = "user"  # global 은 관리자만(서비스 공용 키)


@router.put("/providers/{provider}")
def save_provider(provider: str, body: CredIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cat = next((c for c in registry.CATALOG if c["id"] == provider), None)
    if not cat or not cat["implemented"]:
        raise HTTPException(400, "아직 연동이 구현되지 않은 공급자입니다.")
    if cat.get("admin_only"):
        body.scope = "global"
    if body.scope == "global" and user.role != "admin":
        raise HTTPException(403, "공용 키는 관리자만 등록할 수 있습니다.")
    cred = {k: str(v).strip() for k, v in body.credentials.items() if k in cat["fields"] and str(v).strip()}
    if provider == "higgsfield":
        # "ID:SECRET" 한 줄을 어느 칸에 넣어도 나눠서 저장한다.
        only = cred.get("key_id") or cred.get("key_secret") or ""
        if len(cred) == 1 and ":" in only:
            cred = dict(zip(("key_id", "key_secret"), (x.strip() for x in only.split(":", 1))))
        elif "key_id" not in cred and "key_secret" in cred:
            cred = {"key_id": cred["key_secret"]}
    missing = [f for f in cat["fields"] if f not in cred and f not in cat.get("optional", [])]
    if missing:
        raise HTTPException(400, f"비어 있는 항목: {', '.join(missing)}")
    row = _row(db, user, provider, body.scope)
    if not row:
        row = ProviderConfig(user_id=None if body.scope == "global" else user.id, provider=provider)
        db.add(row)
    row.credentials_enc, row.status, row.last_error, row.is_active = encrypt_json(cred), "untested", None, True
    db.commit()
    return {"ok": True}


@router.delete("/providers/{provider}")
def delete_provider(provider: str, scope: str = "user", user: User = Depends(current_user), db: Session = Depends(get_db)):
    if scope == "global" and user.role != "admin":
        raise HTTPException(403, "권한이 없습니다.")
    row = _row(db, user, provider, scope)
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


def run_test(provider: str, cred: dict) -> dict:
    """실제 공급자에 인증 확인 요청을 보낸다. 가능한 한 비용이 들지 않는 호출을 쓴다."""
    if provider == "higgsfield":
        return Higgsfield(**cred).test()
    if provider == "topview":
        from ..providers.topview import Topview
        return Topview(cred["api_key"]).test()
    if provider in ("anthropic", "openai", "gemini"):
        models = LLM(provider, cred["api_key"], "").list_models()
        return {"ok": True, "models": models[:200]}
    if provider == "elevenlabs":
        return speech.ElevenLabsTTS(cred["api_key"]).test()
    if provider in ENGINES:
        hits = ENGINES[provider](cred["api_key"]).search("YouTube Shorts", 1)
        return {"ok": True, "note": f"검색 1회 실행(결과 {len(hits)}건) — 검색 크레딧 1회가 사용됩니다."}
    if provider == "youtube":
        return YouTubeData(cred["api_key"]).test()
    if provider == "google_oauth":
        return {"ok": True, "note": "저장됨. 실제 확인은 '유튜브 채널 연결'에서 로그인할 때 이뤄집니다."}
    raise HTTPException(400, "테스트를 지원하지 않는 공급자입니다.")


@router.post("/providers/{provider}/test")
def test_provider(provider: str, scope: str = "user", user: User = Depends(current_user), db: Session = Depends(get_db)):
    if scope == "global" and user.role != "admin":
        raise HTTPException(403, "권한이 없습니다.")
    row = _row(db, user, provider, scope)
    if not row or not row.credentials_enc:
        raise HTTPException(404, "등록된 키가 없습니다.")
    row.last_checked_at = datetime.now(timezone.utc)
    try:
        res = run_test(provider, decrypt_json(row.credentials_enc))
        row.status, row.last_error = "ok", None
        row.meta = {**(row.meta or {}), "models": res.get("models", [])[:200]} if res.get("models") else (row.meta or {})
        flag_modified(row, "meta")
        db.commit()
        return res
    except ProviderError as e:
        row.status, row.last_error = "error", f"{e.kind}: {e.message}"[:500]
        db.commit()
        raise HTTPException(400, f"연결 실패 — {row.last_error}") from None


# -- 모델 레지스트리 ----------------------------------------------------------
@router.get("/models")
def list_models(user: User = Depends(current_user), db: Session = Depends(get_db)):
    avail = registry.available_providers(db, user.id)
    return [{**m.dict(), "provider_connected": m.provider in avail}
            for m in db.query(ProviderModel).order_by(ProviderModel.kind, ProviderModel.provider, ProviderModel.tier)]


class ModelIn(BaseModel):
    provider: str | None = None
    model_key: str | None = None
    kind: str | None = None
    display_name: str | None = None
    endpoint: str | None = None
    tier: str | None = None
    unit: str | None = None
    unit_cost_usd: float | None = None
    unit_cost_out_usd: float | None = None
    price_source: str | None = None
    capabilities: dict | None = None
    default_params: dict | None = None
    enabled: bool | None = None
    schema_verified: bool | None = None
    notes: str | None = None
    clear_price: bool = False


@router.post("/models")
def add_model(body: ModelIn, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    for f in ("provider", "model_key", "kind", "display_name", "endpoint"):
        if not getattr(body, f):
            raise HTTPException(400, f"{f} 는 필수입니다.")
    if body.provider not in registry.IMPLEMENTED:
        raise HTTPException(400, "연동이 구현된 공급자의 모델만 추가할 수 있습니다.")
    if db.query(ProviderModel).filter_by(model_key=body.model_key).first():
        raise HTTPException(409, "이미 있는 모델 키입니다.")
    data = body.model_dump(exclude_none=True, exclude={"clear_price"})
    data.setdefault("unit", {"llm": "per_mtok", "image": "per_image", "tts": "per_1k_chars", "stt": "per_minute"}.get(body.kind, "per_second"))
    if body.kind == "llm":
        data.setdefault("capabilities", {"vision": True})
    m = ProviderModel(**data)
    db.add(m)
    db.commit()
    return m.dict()


@router.patch("/models/{key}")
def edit_model(key: str, body: ModelIn, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    m = db.query(ProviderModel).filter_by(model_key=key).first()
    if not m:
        raise HTTPException(404, "모델이 없습니다.")
    for f, v in body.model_dump(exclude_none=True, exclude={"clear_price", "model_key", "provider"}).items():
        setattr(m, f, v)
    if body.clear_price:
        m.unit_cost_usd = None
    db.commit()
    return m.dict()


@router.delete("/models/{key}")
def delete_model(key: str, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    db.query(ProviderModel).filter_by(model_key=key).delete()
    db.commit()
    return {"ok": True}


# -- 음성 라이브러리 -----------------------------------------------------------
@router.get("/voices")
def voices(user: User = Depends(current_user), db: Session = Depends(get_db)):
    out, errors = [], []
    el = registry.credentials(db, user.id, "elevenlabs")
    if el:
        try:
            out += [{**v, "provider": "elevenlabs"} for v in speech.ElevenLabsTTS(el["api_key"]).voices()]
        except ProviderError as e:
            errors.append(f"ElevenLabs: {e.message}")
    if registry.credentials(db, user.id, "openai"):
        out += [{**v, "provider": "openai"} for v in speech.OpenAITTS("").voices()]
    return {"voices": out, "errors": errors, "default_voice": (user.settings or {}).get("default_voice"),
            "note": "음성 복제는 본인 또는 명시적으로 이용 허락을 받은 음성만 사용하세요. 이 서비스는 복제 기능을 직접 제공하지 않습니다."}


# -- 캐릭터 관리 ---------------------------------------------------------------
class CharacterIn(BaseModel):
    name: str
    bible: dict = {}
    provider_ref: dict = {}
    seed: int | None = None


def char_out(c: Character) -> dict:
    return {**c.dict(), "reference_image_url": file_url(c.reference_image_key)}


@router.get("/characters")
def list_characters(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [char_out(c) for c in db.query(Character).filter_by(user_id=user.id, project_id=None).order_by(Character.created_at.desc())]


@router.post("/characters")
def add_character(body: CharacterIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = Character(user_id=user.id, **body.model_dump())
    db.add(c)
    db.commit()
    return char_out(c)


@router.put("/characters/{cid}")
def edit_character(cid: str, body: CharacterIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Character, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "캐릭터가 없습니다.")
    c.name, c.bible, c.provider_ref, c.seed = body.name, body.bible, body.provider_ref, body.seed
    db.commit()
    return char_out(c)


@router.post("/characters/{cid}/image")
async def character_image(cid: str, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = db.get(Character, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "캐릭터가 없습니다.")
    if (file.content_type or "") not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(400, "PNG·JPG·WEBP 이미지만 올릴 수 있습니다.")
    key = f"users/{user.id}/characters/{cid}.{file.content_type.split('/')[-1]}"
    get_storage().put_bytes(key, await file.read())
    c.reference_image_key = key
    db.commit()
    return char_out(c)


@router.delete("/characters/{cid}")
def delete_character(cid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Character).filter_by(id=cid, user_id=user.id).delete()
    db.commit()
    return {"ok": True}


# -- 채널 브랜딩 ---------------------------------------------------------------
@router.get("/branding")
def get_branding(user: User = Depends(current_user)):
    b = (user.settings or {}).get("branding") or {}
    return {**b, "logo_url": file_url(b.get("logo_key")), "subtitle_style": (user.settings or {}).get("subtitle_style") or {}}


class BrandIn(BaseModel):
    channel_name: str | None = None
    palette: str | None = None
    subtitle_style: dict | None = None
    remove_logo: bool = False


@router.put("/branding")
def put_branding(body: BrandIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = dict(user.settings or {})
    b = dict(s.get("branding") or {})
    if body.channel_name is not None:
        b["channel_name"] = body.channel_name
    if body.palette is not None:
        b["palette"] = body.palette
    if body.remove_logo:
        b.pop("logo_key", None)
    s["branding"] = b
    if body.subtitle_style is not None:
        s["subtitle_style"] = body.subtitle_style
    user.settings = s
    flag_modified(user, "settings")
    db.commit()
    return get_branding(user)


@router.post("/branding/logo")
async def upload_logo(file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    if (file.content_type or "") != "image/png":
        raise HTTPException(400, "투명 배경 PNG 로고만 올릴 수 있습니다.")
    key = f"users/{user.id}/branding/logo.png"
    get_storage().put_bytes(key, await file.read())
    s = dict(user.settings or {})
    s["branding"] = {**(s.get("branding") or {}), "logo_key": key}
    user.settings = s
    flag_modified(user, "settings")
    db.commit()
    return get_branding(user)


# -- 음악 라이브러리 + 라이선스 -------------------------------------------------
def track_out(db, t: AudioTrack) -> dict:
    lic = db.get(License, t.license_id) if t.license_id else None
    return {**t.dict(), "url": file_url(t.storage_key), "license": lic.dict() if lic else None,
            "usable": bool(lic and lic.commercial_ok)}


@router.get("/music")
def list_music(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(AudioTrack).filter(AudioTrack.kind.in_(["music", "sfx"]),
                                    (AudioTrack.user_id == user.id) | (AudioTrack.user_id.is_(None)))
    return [track_out(db, t) for t in q.order_by(AudioTrack.created_at.desc())]


@router.post("/music")
async def upload_music(file: UploadFile = File(...), title: str = Form(...), mood: str = Form(""), kind: str = Form("music"),
                       license_name: str = Form(...), license_type: str = Form(""), source_url: str = Form(""),
                       attribution: str = Form(""), commercial_ok: bool = Form(False), shared: bool = Form(False),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    """음원은 이용 허락 정보와 함께만 등록된다. 상업적 이용 가능으로 표시한 음원만 자동 선정 대상이 된다."""
    ext = (file.filename or "a.mp3").rsplit(".", 1)[-1].lower()
    if ext not in ("mp3", "wav", "m4a", "aac", "ogg"):
        raise HTTPException(400, "mp3·wav·m4a·aac·ogg 파일만 올릴 수 있습니다.")
    owner = None if (shared and user.role == "admin") else user.id
    lic = License(user_id=owner, name=license_name, license_type=license_type, source_url=source_url,
                  attribution=attribution, commercial_ok=commercial_ok)
    db.add(lic)
    db.flush()
    key = f"users/{user.id}/audio/{uid()}.{ext}"
    st = get_storage()
    st.put_bytes(key, await file.read())
    try:
        dur = ffmpeg.duration(st.local_path(key))
    except Exception:  # noqa: BLE001
        st.delete(key)
        raise HTTPException(400, "오디오 파일을 읽을 수 없습니다.") from None
    t = AudioTrack(user_id=owner, kind=kind if kind in ("music", "sfx") else "music", title=title, mood=mood or None,
                   storage_key=key, duration=dur, license_id=lic.id)
    db.add(t)
    db.commit()
    return track_out(db, t)


@router.delete("/music/{tid}")
def delete_music(tid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = db.get(AudioTrack, tid)
    if not t or (t.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "음원이 없습니다.")
    get_storage().delete(t.storage_key)
    db.delete(t)
    db.commit()
    return {"ok": True}
