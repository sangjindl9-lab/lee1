"""2·3단계 API: PTZ, 자동 탐색, 수동 이벤트, 장치 저장영상(Profile G), 북마크, 알림 채널, Edge, 분석 연동."""
from __future__ import annotations

import datetime as dt
import hmac
import json
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ...audit import audit
from ...config import get_keys, get_settings
from ...events import close_event, open_event
from ...models import ApiKey, Bookmark, Camera, EdgeNode, Event, NotifyChannel, NotifyLog, Site, User, utcnow
from ...onvif import discovery
from ...onvif.client import OnvifError
from ...onvif.ext import Session as OnvifSession
from ...policy import triggers
from ...security.crypto import encrypt_secret, new_token, sha256_hex
from ...security.netguard import TargetDenied, check_host
from ..deps import Principal, client_ip, get_camera_for, get_db, require, require_superadmin
from .recordings import _parse_ts

router = APIRouter(tags=["ops"])


def _onvif_err(exc: Exception) -> HTTPException:
    return HTTPException(400, detail={"code": getattr(exc, "code", "error"), "message": getattr(exc, "message", str(exc))})


# ───────────────────────────────────────────── PTZ
class PtzIn(BaseModel):
    action: str  # move / stop / goto / set_preset
    pan: float = 0
    tilt: float = 0
    zoom: float = 0
    seconds: float = Field(default=1.0, ge=0.2, le=10)
    preset: str = Field(default="", max_length=64)
    name: str = Field(default="", max_length=40)


_ptz_audit: dict[tuple[int, int], float] = {}


@router.get("/api/cameras/{camera_id}/ptz")
def ptz_info(camera_id: int, request: Request, p: Principal = Depends(require("ptz")), db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    if not (cam.capabilities or {}).get("ptz"):
        return {"supported": False, "reason": "이 카메라는 ONVIF PTZ 서비스를 제공하지 않습니다(등록 시 조회 결과)."}
    try:
        with OnvifSession(cam) as s:
            return {"supported": True, "presets": s.ptz_presets(), "status": s.ptz_status()}
    except (OnvifError, TargetDenied, RuntimeError) as exc:
        raise _onvif_err(exc) from exc


@router.post("/api/cameras/{camera_id}/ptz")
def ptz_control(camera_id: int, body: PtzIn, request: Request, p: Principal = Depends(require("ptz")),
                db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    if not (cam.capabilities or {}).get("ptz"):
        raise HTTPException(409, "이 카메라는 PTZ 를 지원하지 않습니다.")
    out: dict[str, Any] = {"ok": True}
    try:
        with OnvifSession(cam) as s:
            if body.action == "move":
                s.ptz_move(body.pan, body.tilt, body.zoom, body.seconds)
            elif body.action == "stop":
                s.ptz_stop()
            elif body.action == "goto":
                s.ptz_goto(body.preset)
            elif body.action == "set_preset":
                if not body.name.strip():
                    raise HTTPException(400, "프리셋 이름을 입력하세요.")
                out["token"] = s.ptz_set_preset(body.name.strip())
            else:
                raise HTTPException(400, "알 수 없는 PTZ 동작입니다.")
            try:
                out["status"] = s.ptz_status()
            except OnvifError:
                pass
    except (OnvifError, TargetDenied, RuntimeError) as exc:
        raise _onvif_err(exc) from exc
    # 이동 명령은 1분에 한 번만 감사로그(조이스틱 연속 입력으로 로그가 넘치지 않게), 프리셋은 매번
    key = (p.user.id, cam.id)
    if body.action in ("goto", "set_preset") or time.time() - _ptz_audit.get(key, 0) > 60:
        _ptz_audit[key] = time.time()
        audit(db, action=f"ptz.{body.action}", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
              details={"preset": body.preset or body.name} if body.action in ("goto", "set_preset") else {}, commit=True)
    return out


# ───────────────────────────────────────────── 자동 탐색
class DiscoverIn(BaseModel):
    site_id: int
    interface_ip: str = ""
    timeout: float = Field(default=3.0, ge=1, le=10)


@router.get("/api/onvif/interfaces")
def onvif_interfaces(p: Principal = Depends(require("settings"))):
    s = get_settings()
    if s.discovery_url:
        try:
            r = httpx.get(s.discovery_url.rstrip("/") + "/interfaces", timeout=5, trust_env=False,
                          headers={"X-NVR-Key": get_keys().discovery_key})
            r.raise_for_status()
            return {"items": r.json(), "via": "discovery-service"}
        except httpx.HTTPError as exc:
            raise HTTPException(503, f"탐색 서비스에 연결할 수 없습니다: {exc}") from exc
    return {"items": discovery.local_interfaces(), "via": "local"}


@router.post("/api/onvif/discover")
def onvif_discover(body: DiscoverIn, request: Request, p: Principal = Depends(require("settings")),
                   db: Session = Depends(get_db)):
    site = db.get(Site, body.site_id)
    if not site or not p.can_site(site.id):
        raise HTTPException(404, "현장을 찾을 수 없습니다.")
    s = get_settings()
    try:
        if s.discovery_url:
            r = httpx.post(s.discovery_url.rstrip("/") + "/discover", timeout=body.timeout + 5, trust_env=False,
                           headers={"X-NVR-Key": get_keys().discovery_key},
                           json={"interface_ip": body.interface_ip, "timeout": body.timeout})
            r.raise_for_status()
            found = r.json()
        else:
            found = discovery.probe(body.interface_ip or None, body.timeout)
    except (ValueError, OSError, httpx.HTTPError) as exc:
        raise HTTPException(400, f"탐색 실패: {exc}") from exc
    nets = [str(n) for n in site.allowed_networks]
    known = {(c.host, c.onvif_port) for c in db.scalars(select(Camera).where(Camera.deleted_at.is_(None)))}
    for d in found:
        try:
            check_host(d["host"], nets)
            d["allowed"], d["reason"] = True, ""
        except TargetDenied as exc:
            d["allowed"], d["reason"] = False, exc.message
        d["registered"] = (d["host"], d["port"]) in known
    audit(db, action="onvif.discover", user=p.user, ip=client_ip(request), target_type="site", target_id=site.id,
          details={"found": len(found), "interface": body.interface_ip}, commit=True)
    return {"items": found, "note": "같은 네트워크(L2) 안의 장치만 찾을 수 있습니다. 찾지 못한 장치는 IP 수동 등록을 사용하세요."}


# ───────────────────────────────────────────── 수동 이벤트(관제원 표시) — 이벤트 녹화 트리거
class ManualEventIn(BaseModel):
    seconds: int = Field(default=60, ge=5, le=1800)
    note: str = Field(default="", max_length=500)


@router.post("/api/cameras/{camera_id}/events/manual")
def manual_event(camera_id: int, body: ManualEventIn, request: Request, p: Principal = Depends(require("live_view")),
                 db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    now = utcnow()
    ev = Event(type="manual", source="system", severity="info", camera_id=cam.id, site_id=cam.site_id,
               started_at=now, ended_at=now + dt.timedelta(seconds=body.seconds),
               triggers_recording=triggers(cam, "manual"),
               message=f"{cam.name}: 수동 이벤트({p.user.username}) {body.note}".strip(),
               details={"user": p.user.username, "seconds": body.seconds})
    db.add(ev)
    db.flush()
    audit(db, action="event.manual", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          details={"event_id": ev.id, "seconds": body.seconds})
    db.commit()
    return {"id": ev.id, "triggers_recording": ev.triggers_recording,
            "note": "이 카메라 녹화 방식이 이벤트/일정(E)일 때 전·후 구간이 녹화로 확정됩니다." if ev.triggers_recording else
            "이 카메라는 수동 이벤트로 녹화하지 않도록 설정되어 있습니다(표시만 남김)."}


# ───────────────────────────────────────────── 장치 저장영상(Profile G)
@router.get("/api/cameras/{camera_id}/device-recordings")
def device_recordings(camera_id: int, request: Request, p: Principal = Depends(require("playback")),
                      db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    try:
        with OnvifSession(cam) as s:
            items = s.recordings()
            for it in items:
                try:
                    it["replay_uri"] = s.replay_uri(it["token"]) if it["token"] else ""
                except OnvifError as exc:
                    it["replay_uri"], it["replay_error"] = "", exc.message
    except (OnvifError, TargetDenied, RuntimeError) as exc:
        raise _onvif_err(exc) from exc
    audit(db, action="device_recording.search", user=p.user, ip=client_ip(request), target_type="camera",
          target_id=cam.id, details={"count": len(items)}, commit=True)
    return {"items": items, "note": "카메라(SD카드 등)에 저장된 녹화 목록입니다. NVR 로 가져오기(회수)는 아직 지원하지 않습니다."}


# ───────────────────────────────────────────── 북마크·메모
class BookmarkIn(BaseModel):
    camera_id: int
    at: str
    end: str | None = None
    title: str = Field(min_length=1, max_length=200)
    note: str = Field(default="", max_length=4000)


def bm_out(b: Bookmark, cam: Camera | None, users: dict[int, str]) -> dict:
    return {"id": b.id, "camera_id": b.camera_id, "camera_name": cam.name if cam else "", "at": b.at.isoformat(),
            "end": b.end_at.isoformat() if b.end_at else None, "title": b.title, "note": b.note,
            "user": users.get(b.user_id or 0, ""), "created_at": b.created_at.isoformat() if b.created_at else None}


@router.get("/api/bookmarks")
def list_bookmarks(camera_id: int | None = None, q: str = "", start: str | None = None, end: str | None = None,
                   request: Request = None, p: Principal = Depends(require("playback")), db: Session = Depends(get_db)):
    stmt = select(Bookmark).order_by(Bookmark.at.desc()).limit(500)
    if camera_id:
        get_camera_for(db, p, camera_id, request, include_deleted=True)
        stmt = stmt.where(Bookmark.camera_id == camera_id)
    if q.strip():
        like = f"%{q.strip()[:100]}%"
        stmt = stmt.where(or_(Bookmark.title.ilike(like), Bookmark.note.ilike(like)))
    if start:
        stmt = stmt.where(Bookmark.at >= _parse_ts(start, "start"))
    if end:
        stmt = stmt.where(Bookmark.at < _parse_ts(end, "end"))
    cams = {c.id: c for c in db.scalars(select(Camera))}
    users = dict(db.execute(select(User.id, User.username)).all())
    return {"items": [bm_out(b, cams.get(b.camera_id), users) for b in db.scalars(stmt)
                      if cams.get(b.camera_id) and p.can_cam(cams[b.camera_id])]}


@router.post("/api/bookmarks")
def add_bookmark(body: BookmarkIn, request: Request, p: Principal = Depends(require("playback")),
                 db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, body.camera_id, request, include_deleted=True)
    b = Bookmark(camera_id=cam.id, user_id=p.user.id, at=_parse_ts(body.at, "at"),
                 end_at=_parse_ts(body.end, "end") if body.end else None, title=body.title.strip(), note=body.note)
    db.add(b)
    db.flush()
    audit(db, action="bookmark.create", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          details={"bookmark_id": b.id})
    db.commit()
    return bm_out(b, cam, {p.user.id: p.user.username})


@router.delete("/api/bookmarks/{bookmark_id}")
def del_bookmark(bookmark_id: int, request: Request, p: Principal = Depends(require("playback")),
                 db: Session = Depends(get_db)):
    b = db.get(Bookmark, bookmark_id)
    if not b:
        raise HTTPException(404, "북마크를 찾을 수 없습니다.")
    get_camera_for(db, p, b.camera_id, request, include_deleted=True)
    if b.user_id != p.user.id and not p.can("settings"):
        raise HTTPException(403, "다른 사람의 북마크는 설정 권한이 있어야 삭제할 수 있습니다.")
    db.delete(b)
    audit(db, action="bookmark.delete", user=p.user, ip=client_ip(request), target_type="bookmark", target_id=bookmark_id)
    db.commit()
    return {"ok": True}


# ───────────────────────────────────────────── 알림 채널
class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str
    config: dict[str, Any]
    enabled: bool = True
    min_severity: str = "warning"
    event_types: list[str] = []
    repeat_minutes: int = Field(default=0, ge=0, le=1440)
    suppress_minutes: int = Field(default=10, ge=0, le=1440)


def _clean_config(t: str, cfg: dict[str, Any], old: dict[str, Any] | None = None) -> dict[str, Any]:
    old = old or {}
    if t == "webhook":
        url = str(cfg.get("url", "")).strip()
        if not url.startswith(("https://", "http://")):
            raise HTTPException(400, "웹훅 주소는 http(s):// 로 시작해야 합니다.")
        return {"url": url[:500], "secret": cfg.get("secret") or old.get("secret", "")}
    if t == "email":
        to = [x.strip() for x in (cfg.get("to") or []) if "@" in str(x)][:20]
        if not cfg.get("host") or not to:
            raise HTTPException(400, "SMTP 서버와 받는 사람을 입력하세요.")
        if cfg.get("security", "starttls") not in ("starttls", "ssl", "none"):
            raise HTTPException(400, "보안 방식은 starttls / ssl / none 입니다.")
        return {"host": str(cfg["host"])[:200], "port": int(cfg.get("port") or 587), "security": cfg.get("security", "starttls"),
                "username": str(cfg.get("username", ""))[:200], "password": cfg.get("password") or old.get("password", ""),
                "from": str(cfg.get("from", ""))[:200], "to": to}
    raise HTTPException(400, "채널 종류는 email 또는 webhook 입니다.")


def ch_out(ch: NotifyChannel, db: Session) -> dict:
    from ...worker.notify import channel_config

    cfg = channel_config(ch)
    safe = {k: v for k, v in cfg.items() if k not in ("password", "secret")}
    safe["has_secret"] = bool(cfg.get("password") or cfg.get("secret"))
    last = db.scalars(select(NotifyLog).where(NotifyLog.channel_id == ch.id).order_by(NotifyLog.id.desc()).limit(1)).first()
    return {"id": ch.id, "name": ch.name, "type": ch.type, "config": safe, "enabled": ch.enabled,
            "min_severity": ch.min_severity, "event_types": ch.event_types, "repeat_minutes": ch.repeat_minutes,
            "suppress_minutes": ch.suppress_minutes,
            "last": {"at": last.sent_at.isoformat(), "ok": last.ok, "error": last.error, "kind": last.kind} if last else None}


@router.get("/api/notify/channels")
def list_channels(p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    return {"items": [ch_out(c, db) for c in db.scalars(select(NotifyChannel).order_by(NotifyChannel.id))]}


@router.post("/api/notify/channels")
def add_channel(body: ChannelIn, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    if body.min_severity not in ("info", "warning", "critical"):
        raise HTTPException(400, "중요도는 info / warning / critical 입니다.")
    cfg = _clean_config(body.type, body.config)
    ch = NotifyChannel(name=body.name, type=body.type, config_enc=encrypt_secret(json.dumps(cfg)), enabled=body.enabled,
                       min_severity=body.min_severity, event_types=body.event_types, repeat_minutes=body.repeat_minutes,
                       suppress_minutes=body.suppress_minutes)
    db.add(ch)
    db.flush()
    audit(db, action="notify.create", user=p.user, ip=client_ip(request), target_type="notify", target_id=ch.id,
          details={"type": ch.type, "name": ch.name})
    db.commit()
    return ch_out(ch, db)


@router.put("/api/notify/channels/{ch_id}")
def put_channel(ch_id: int, body: ChannelIn, request: Request, p: Principal = Depends(require_superadmin),
                db: Session = Depends(get_db)):
    from ...worker.notify import channel_config

    ch = db.get(NotifyChannel, ch_id)
    if not ch:
        raise HTTPException(404, "채널을 찾을 수 없습니다.")
    cfg = _clean_config(body.type, body.config, channel_config(ch) if ch.type == body.type else None)
    ch.name, ch.type, ch.enabled, ch.min_severity = body.name, body.type, body.enabled, body.min_severity
    ch.event_types, ch.repeat_minutes, ch.suppress_minutes = body.event_types, body.repeat_minutes, body.suppress_minutes
    ch.config_enc = encrypt_secret(json.dumps(cfg))
    audit(db, action="notify.update", user=p.user, ip=client_ip(request), target_type="notify", target_id=ch.id)
    db.commit()
    return ch_out(ch, db)


@router.delete("/api/notify/channels/{ch_id}")
def del_channel(ch_id: int, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    ch = db.get(NotifyChannel, ch_id)
    if not ch:
        raise HTTPException(404, "채널을 찾을 수 없습니다.")
    db.delete(ch)
    audit(db, action="notify.delete", user=p.user, ip=client_ip(request), target_type="notify", target_id=ch_id)
    db.commit()
    return {"ok": True}


@router.post("/api/notify/channels/{ch_id}/test")
def test_channel(ch_id: int, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    from ...worker.notify import deliver

    ch = db.get(NotifyChannel, ch_id)
    if not ch:
        raise HTTPException(404, "채널을 찾을 수 없습니다.")
    ev = Event(id=0, type="notify_test", severity="info", source="system", message="웹 NVR 알림 시험 메시지입니다.",
               started_at=utcnow())
    ok, err = deliver(ch, ev, None, "test")
    db.add(NotifyLog(channel_id=ch.id, event_id=None, dedup_key="test", kind="test", ok=ok, error=err[:500]))
    audit(db, action="notify.test", user=p.user, ip=client_ip(request), target_type="notify", target_id=ch.id,
          result="ok" if ok else "fail")
    db.commit()
    if not ok:
        raise HTTPException(400, f"전송 실패: {err}")
    return {"ok": True}


# ───────────────────────────────────────────── 여러 현장(Edge)
class EdgeIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(default="", max_length=500)


def edge_out(e: EdgeNode) -> dict:
    rep = e.report or {}
    cams = rep.get("cameras", [])
    return {"id": e.id, "name": e.name, "url": e.url, "online": e.online, "last_ip": e.last_ip,
            "last_seen_at": e.last_seen_at.isoformat() if e.last_seen_at else None,
            "version": rep.get("version"), "disk": rep.get("disk"), "services": rep.get("services"),
            "camera_total": len(cams), "camera_recording": sum(1 for c in cams if c.get("state") == "recording"),
            "camera_problem": sum(1 for c in cams if c.get("state") in ("retry_wait", "error")), "cameras": cams}


@router.get("/api/edges")
def list_edges(p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    return {"items": [edge_out(e) for e in db.scalars(select(EdgeNode).order_by(EdgeNode.id))]}


@router.post("/api/edges")
def add_edge(body: EdgeIn, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    if body.url and not body.url.startswith(("https://", "http://")):
        raise HTTPException(400, "현장 서버 주소는 http(s):// 로 시작해야 합니다.")
    token = "edge_" + new_token(32)
    e = EdgeNode(name=body.name, url=body.url, token_hash=sha256_hex(token))
    db.add(e)
    db.flush()
    audit(db, action="edge.create", user=p.user, ip=client_ip(request), target_type="edge", target_id=e.id,
          details={"name": e.name})
    db.commit()
    out = edge_out(e)
    out["token"] = token  # 이번 한 번만 표시
    return out


@router.delete("/api/edges/{edge_id}")
def del_edge(edge_id: int, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    e = db.get(EdgeNode, edge_id)
    if not e:
        raise HTTPException(404, "현장 서버를 찾을 수 없습니다.")
    db.delete(e)
    close_event(db, f"edge:{edge_id}:offline")
    audit(db, action="edge.delete", user=p.user, ip=client_ip(request), target_type="edge", target_id=edge_id)
    db.commit()
    return {"ok": True}


@router.post("/api/edge/report")
async def edge_report(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token.startswith("edge_"):
        raise HTTPException(401, "토큰이 필요합니다.")
    e = db.scalar(select(EdgeNode).where(EdgeNode.token_hash == sha256_hex(token)))
    if not e:
        raise HTTPException(401, "등록되지 않은 현장 서버입니다.")
    raw = await request.body()
    if len(raw) > 512 * 1024:
        raise HTTPException(413, "보고 크기가 너무 큽니다.")
    try:
        rep = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(400, "JSON 형식 오류") from exc
    was_online = e.online
    e.report = {k: rep.get(k) for k in ("version", "at", "cameras", "disk", "services", "has_open_events")}
    e.last_seen_at, e.last_ip, e.online = utcnow(), client_ip(request), True
    if not was_online and close_event(db, f"edge:{e.id}:offline"):
        db.add(Event(type="edge_online", severity="info", source="system", message=f"현장 서버 '{e.name}' 보고 재개",
                     started_at=utcnow(), ended_at=utcnow()))
    db.commit()
    return {"ok": True}


# ───────────────────────────────────────────── 분석 모듈 연동
class ApiKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    site_ids: list[int] = []


@router.get("/api/integrations/keys")
def list_keys(p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    return {"items": [{"id": k.id, "name": k.name, "purpose": k.purpose, "site_ids": k.site_ids, "enabled": k.enabled,
                       "created_at": k.created_at.isoformat() if k.created_at else None,
                       "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None}
                      for k in db.scalars(select(ApiKey).order_by(ApiKey.id))]}


@router.post("/api/integrations/keys")
def add_key(body: ApiKeyIn, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    raw = "nvrk_" + new_token(32)
    k = ApiKey(name=body.name, purpose="analytics", key_hash=sha256_hex(raw), site_ids=body.site_ids)
    db.add(k)
    db.flush()
    audit(db, action="apikey.create", user=p.user, ip=client_ip(request), target_type="apikey", target_id=k.id,
          details={"name": k.name})
    db.commit()
    return {"id": k.id, "name": k.name, "key": raw}


@router.delete("/api/integrations/keys/{key_id}")
def del_key(key_id: int, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    k = db.get(ApiKey, key_id)
    if not k:
        raise HTTPException(404, "키를 찾을 수 없습니다.")
    db.delete(k)
    audit(db, action="apikey.delete", user=p.user, ip=client_ip(request), target_type="apikey", target_id=key_id)
    db.commit()
    return {"ok": True}


class AnalyticsEventIn(BaseModel):
    camera_id: int
    label: str = Field(min_length=1, max_length=40)  # person / vehicle / intrusion / line_crossing …
    state: str = "pulse"  # start / end / pulse(시작과 동시에 끝, duration 사용)
    duration_seconds: int = Field(default=10, ge=1, le=600)
    object_id: str = Field(default="", max_length=60)
    score: float | None = Field(default=None, ge=0, le=1)
    at: str | None = None
    message: str = Field(default="", max_length=300)


@router.post("/api/integrations/analytics/events")
def analytics_event(body: AnalyticsEventIn, request: Request, db: Session = Depends(get_db)):
    """외부 분석 모듈(사람·차량·침입 등)이 이벤트를 보내는 주소. 헤더 X-API-Key 필요.

    이 NVR 은 분석 모델을 포함하지 않는다. 여기로 들어온 이벤트는 source=analytics 로 구분해 기록한다.
    """
    raw = request.headers.get("x-api-key", "")
    k = db.scalar(select(ApiKey).where(ApiKey.key_hash == sha256_hex(raw), ApiKey.enabled.is_(True))) if raw else None
    if not k or not hmac.compare_digest(k.key_hash, sha256_hex(raw)):
        raise HTTPException(401, "API 키가 올바르지 않습니다.")
    cam = db.get(Camera, body.camera_id)
    if not cam or cam.deleted_at or (k.site_ids and cam.site_id not in k.site_ids):
        raise HTTPException(404, "카메라를 찾을 수 없습니다.")
    at = _parse_ts(body.at, "at") if body.at else utcnow()
    key = f"cam:{cam.id}:analytics:{body.label}:{body.object_id}"
    label = body.label.strip().lower()
    msg = f"{cam.name}: 분석 이벤트 '{label}'" + (f" ({body.message})" if body.message else "") + \
        (f" 신뢰도 {body.score:.2f}" if body.score is not None else "")
    details = {"label": label, "object_id": body.object_id, "score": body.score, "key_name": k.name}
    if body.state == "end":
        close_event(db, key)
    elif body.state == "start":
        open_event(db, type="analytics", dedup_key=key, message=msg, severity="info", camera_id=cam.id, site_id=cam.site_id,
                   details=details, source="analytics", triggers_recording=triggers(cam, "analytics"), started_at=at)
    elif body.state == "pulse":
        db.add(Event(type="analytics", source="analytics", severity="info", camera_id=cam.id, site_id=cam.site_id,
                     started_at=at, ended_at=at + dt.timedelta(seconds=body.duration_seconds), message=msg,
                     details=details, triggers_recording=triggers(cam, "analytics")))
    else:
        raise HTTPException(400, "state 는 start / end / pulse 입니다.")
    k.last_used_at = utcnow()
    db.commit()
    return {"ok": True}


# ───────────────────────────────────────────── 이벤트 검색(필터)
@router.get("/api/events/search")
def search_events(type: str = "", source: str = "", camera_id: int | None = None, q: str = "", start: str | None = None,
                  end: str | None = None, open_only: bool = False, limit: int = 300,
                  p: Principal = Depends(require("live_view")), db: Session = Depends(get_db)):
    from ...events import EVENT_TEXT

    stmt = select(Event).order_by(Event.started_at.desc()).limit(min(limit, 1000))
    if type:
        stmt = stmt.where(Event.type == type)
    if source:
        stmt = stmt.where(Event.source == source)
    if camera_id:
        stmt = stmt.where(Event.camera_id == camera_id)
    if q.strip():
        stmt = stmt.where(or_(Event.message.ilike(f"%{q.strip()[:100]}%"), Event.note.ilike(f"%{q.strip()[:100]}%")))
    if start:
        stmt = stmt.where(Event.started_at >= _parse_ts(start, "start"))
    if end:
        stmt = stmt.where(Event.started_at < _parse_ts(end, "end"))
    if open_only:
        stmt = stmt.where(Event.acknowledged_at.is_(None))
    cams = {c.id: c for c in db.scalars(select(Camera))}
    users = dict(db.execute(select(User.id, User.username)).all())
    out = []
    for e in db.scalars(stmt):
        c = cams.get(e.camera_id) if e.camera_id else None
        if c and not p.can_cam(c):
            continue
        if not c and e.camera_id is None and not p.is_superadmin and e.type.startswith("edge"):
            continue
        out.append({"id": e.id, "camera_id": e.camera_id, "camera_name": c.name if c else None, "type": e.type,
                    "type_label": EVENT_TEXT.get(e.type, e.type), "severity": e.severity, "source": e.source,
                    "start": e.started_at.isoformat(), "end": e.ended_at.isoformat() if e.ended_at else None,
                    "message": e.message, "triggers_recording": e.triggers_recording, "details": e.details,
                    "acknowledged_at": e.acknowledged_at.isoformat() if e.acknowledged_at else None,
                    "acknowledged_by": users.get(e.acknowledged_by or 0), "note": e.note})
    counts = dict(db.execute(select(Event.type, func.count()).where(
        Event.started_at > utcnow() - dt.timedelta(days=1)).group_by(Event.type)).all())
    return {"items": out, "last24h": counts}

