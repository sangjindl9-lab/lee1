from __future__ import annotations

import csv
import datetime as dt
import io
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import false, func, or_, select
from sqlalchemy.orm import Session

from ...audit import audit
from ...camera_util import camera_source
from ...config import get_settings
from ...media.ffmpeg import ERROR_TEXT, build_source, grab_snapshot, probe_stream
from ...models import Camera, CameraStatus, Driver, RecordingSegment, Site, utcnow
from ...onvif.client import OnvifClient, OnvifError, OnvifTarget, fetch_snapshot
from ...security.crypto import decrypt_secret, encrypt_secret
from ...security.netguard import TargetDenied, check_host, check_url
from ..deps import Principal, active_principal, client_ip, get_camera_for, get_db, require

router = APIRouter(prefix="/api", tags=["cameras"])

RECORDER_STATE_TEXT = {
    "idle": "대기",
    "connecting": "연결 중",
    "recording": "녹화 중",
    "retry_wait": "재연결 대기",
    "stopped": "녹화 꺼짐",
    "error": "오류",
    "disabled": "사용 안 함",
}


class StreamTestIn(BaseModel):
    site_id: int
    url: str = Field(max_length=2000)
    username: str = Field(default="", max_length=100)
    password: str = Field(default="", max_length=200)
    rtsp_transport: str = "tcp"
    camera_id: int | None = None  # 수정 화면에서 저장된 비밀번호 재사용


class SnapshotPreviewIn(BaseModel):
    site_id: int
    snapshot_url: str = Field(default="", max_length=2000)
    stream_url: str = Field(default="", max_length=2000)
    username: str = Field(default="", max_length=100)
    password: str = Field(default="", max_length=200)
    rtsp_transport: str = "tcp"
    camera_id: int | None = None


class OnvifProbeIn(BaseModel):
    site_id: int
    host: str = Field(max_length=255)
    port: int = Field(default=80, ge=1, le=65535)
    scheme: str = "http"
    device_path: str = Field(default="/onvif/device_service", max_length=255)
    username: str = Field(default="", max_length=100)
    password: str = Field(default="", max_length=200)
    camera_id: int | None = None


class CameraIn(BaseModel):
    site_id: int
    name: str = Field(min_length=1, max_length=100)
    building: str = Field(default="", max_length=100)
    zone: str = Field(default="", max_length=100)
    connection_type: str = "rtsp"
    host: str = Field(default="", max_length=255)
    onvif_port: int | None = Field(default=None, ge=1, le=65535)
    onvif_scheme: str = "http"
    onvif_device_path: str = Field(default="/onvif/device_service", max_length=255)
    rtsp_transport: str = "tcp"
    main_stream_url: str = Field(max_length=2000)
    sub_stream_url: str = Field(default="", max_length=2000)
    main_profile_token: str = Field(default="", max_length=100)
    sub_profile_token: str = Field(default="", max_length=100)
    snapshot_url: str = Field(default="", max_length=2000)
    username: str = Field(default="", max_length=100)
    password: str = Field(default="", max_length=200)
    vendor: str = Field(default="", max_length=100)
    model: str = Field(default="", max_length=100)
    firmware: str = Field(default="", max_length=100)
    serial: str = Field(default="", max_length=100)
    tags: list[str] = []
    location_note: str = Field(default="", max_length=2000)
    enabled: bool = True
    record_mode: str = "continuous"
    retention_days: int | None = Field(default=None, ge=1, le=3650)
    is_test_source: bool = False
    capabilities: dict[str, Any] = {}
    stream_info: dict[str, Any] = {}
    allow_duplicate: bool = False


class CameraPatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    building: str | None = Field(default=None, max_length=100)
    zone: str | None = Field(default=None, max_length=100)
    host: str | None = Field(default=None, max_length=255)
    onvif_port: int | None = Field(default=None, ge=1, le=65535)
    rtsp_transport: str | None = None
    main_stream_url: str | None = Field(default=None, max_length=2000)
    sub_stream_url: str | None = Field(default=None, max_length=2000)
    snapshot_url: str | None = Field(default=None, max_length=2000)
    username: str | None = Field(default=None, max_length=100)
    password: str | None = Field(default=None, max_length=200)  # 빈 값/None 이면 변경 안 함
    tags: list[str] | None = None
    location_note: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None
    record_mode: str | None = None
    retention_days: int | None = Field(default=None, ge=0, le=3650)  # 0 = 기본값 사용
    is_test_source: bool | None = None
    tls_insecure: bool | None = None
    stream_info: dict[str, Any] | None = None


class RecordingControlIn(BaseModel):
    action: str  # start / stop / manual_start / manual_stop
    minutes: int = Field(default=60, ge=1, le=24 * 60)


def camera_out(cam: Camera, st: CameraStatus | None = None, usage: int | None = None) -> dict:
    return {
        "id": cam.id,
        "site_id": cam.site_id,
        "site_name": cam.site.name if cam.site else "",
        "building": cam.building,
        "zone": cam.zone,
        "name": cam.name,
        "vendor": cam.vendor,
        "model": cam.model,
        "firmware": cam.firmware,
        "serial": cam.serial,
        "connection_type": cam.connection_type,
        "host": cam.host,
        "onvif_port": cam.onvif_port,
        "onvif_scheme": cam.onvif_scheme,
        "onvif_device_path": cam.onvif_device_path,
        "rtsp_transport": cam.rtsp_transport,
        "main_stream_url": cam.main_stream_url,
        "sub_stream_url": cam.sub_stream_url,
        "main_profile_token": cam.main_profile_token,
        "sub_profile_token": cam.sub_profile_token,
        "snapshot_url": cam.snapshot_url,
        "username": cam.username,
        "has_password": bool(cam.password_enc),
        "tls_insecure": cam.tls_insecure,
        "tags": cam.tags,
        "location_note": cam.location_note,
        "enabled": cam.enabled,
        "record_mode": cam.record_mode,
        "manual_record_until": cam.manual_record_until.isoformat() if cam.manual_record_until else None,
        "retention_days": cam.retention_days,
        "effective_retention_days": cam.retention_days or get_settings().default_retention_days,
        "is_test_source": cam.is_test_source,
        "capabilities": cam.capabilities,
        "stream_info": cam.stream_info,
        "deleted": cam.deleted_at is not None,
        "created_at": cam.created_at.isoformat() if cam.created_at else None,
        "updated_at": cam.updated_at.isoformat() if cam.updated_at else None,
        "status": status_out(cam, st),
        "storage_bytes": usage,
    }


def status_out(cam: Camera, st: CameraStatus | None) -> dict:
    if not cam.enabled:
        state = "disabled"
    else:
        state = st.recorder_state if st else "idle"
    stale = False
    if st and st.updated_at and (utcnow() - st.updated_at).total_seconds() > 60 and state in ("recording", "connecting"):
        stale = True  # recorder 하트비트 끊김
    return {
        "state": state,
        "state_label": RECORDER_STATE_TEXT.get(state, state) + (" (상태 갱신 지연)" if stale else ""),
        "stale": stale,
        "error_code": st.error_code if st else "",
        "error_message": st.error_message if st else "",
        "last_segment_at": st.last_segment_at.isoformat() if st and st.last_segment_at else None,
        "connected_since": st.connected_since.isoformat() if st and st.connected_since else None,
        "retry_count": st.retry_count if st else 0,
        "next_retry_at": st.next_retry_at.isoformat() if st and st.next_retry_at else None,
        "updated_at": st.updated_at.isoformat() if st and st.updated_at else None,
    }


def _site(db: Session, p: Principal, site_id: int) -> Site:
    s = db.get(Site, site_id)
    if not s or not p.can_site(site_id):
        raise HTTPException(404, "현장을 찾을 수 없습니다.")
    return s


def _nets(site: Site) -> list[str]:
    return [str(n) for n in site.allowed_networks]


def _denied(exc: TargetDenied) -> HTTPException:
    return HTTPException(400, detail={"code": exc.code, "message": exc.message})


# ------------------------------------------------------------------ 목록·조회
@router.get("/cameras")
def list_cameras(site_id: int | None = None, include_deleted: bool = False, p: Principal = Depends(active_principal),
                 db: Session = Depends(get_db)):
    q = select(Camera).order_by(Camera.site_id, Camera.name)
    if not include_deleted:
        q = q.where(Camera.deleted_at.is_(None))
    if site_id:
        q = q.where(Camera.site_id == site_id)
    cams = [c for c in db.scalars(q) if p.can_site(c.site_id)]
    sts = {s.camera_id: s for s in db.scalars(select(CameraStatus).where(CameraStatus.camera_id.in_([c.id for c in cams])))} if cams else {}
    usage = dict(db.execute(select(RecordingSegment.camera_id, func.sum(RecordingSegment.size_bytes))
                            .group_by(RecordingSegment.camera_id)).all())
    return {"items": [camera_out(c, sts.get(c.id), int(usage.get(c.id) or 0)) for c in cams]}


@router.get("/cameras/{camera_id}")
def get_camera(camera_id: int, request: Request, p: Principal = Depends(active_principal), db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request, include_deleted=True)
    return camera_out(cam, db.get(CameraStatus, cam.id))


# ------------------------------------------------------------------ 시험
@router.post("/cameras/test")
def test_stream(body: StreamTestIn, request: Request, p: Principal = Depends(require("settings")),
                db: Session = Depends(get_db)):
    site = _site(db, p, body.site_id)
    password = body.password
    if not password and body.camera_id:
        cam = get_camera_for(db, p, body.camera_id, request)
        password = decrypt_secret(cam.password_enc)
    try:
        src = build_source(body.url, body.username, password, body.rtsp_transport, _nets(site))
    except TargetDenied as exc:
        raise _denied(exc) from exc
    res = probe_stream(src)
    audit(db, action="camera.test", user=p.user, ip=client_ip(request), target_type="stream",
          target_id=body.camera_id or "", result="ok" if res.ok else "fail",
          details={"url": src.safe_url, "error_code": res.error_code}, commit=True)
    return res.to_dict()


@router.post("/cameras/snapshot-preview")
def snapshot_preview(body: SnapshotPreviewIn, request: Request, p: Principal = Depends(require("settings")),
                     db: Session = Depends(get_db)):
    site = _site(db, p, body.site_id)
    password = body.password
    tls_insecure = False
    if not password and body.camera_id:
        cam = get_camera_for(db, p, body.camera_id, request)
        password = decrypt_secret(cam.password_enc)
        tls_insecure = cam.tls_insecure
    img, code, msg = _snapshot(site, body.snapshot_url, body.stream_url, body.username, password,
                               body.rtsp_transport, tls_insecure)
    if not img:
        raise HTTPException(400, detail={"code": code, "message": msg})
    return Response(content=img, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


def _snapshot(site: Site, snapshot_url: str, stream_url: str, username: str, password: str, transport: str,
              tls_insecure: bool) -> tuple[bytes | None, str, str]:
    code, msg = "", ""
    if snapshot_url:
        img, code, msg = fetch_snapshot(snapshot_url, username, password, _nets(site), tls_insecure=tls_insecure)
        if img:
            return img, "", ""
    if stream_url:
        try:
            src = build_source(stream_url, username, password, transport, _nets(site), tls_insecure=tls_insecure)
        except TargetDenied as exc:
            return None, exc.code, exc.message
        return grab_snapshot(src)
    return None, code or "no_source", msg or "스냅샷 주소나 스트림 주소가 없습니다."


@router.post("/onvif/probe")
def onvif_probe(body: OnvifProbeIn, request: Request, p: Principal = Depends(require("settings")),
                db: Session = Depends(get_db)):
    site = _site(db, p, body.site_id)
    password = body.password
    if not password and body.camera_id:
        cam = get_camera_for(db, p, body.camera_id, request)
        password = decrypt_secret(cam.password_enc)
    try:
        client = OnvifClient(OnvifTarget(scheme=body.scheme, host=body.host.strip(), port=body.port,
                                         device_path=body.device_path, username=body.username,
                                         password=password, allowed_networks=_nets(site)))
    except TargetDenied as exc:
        raise _denied(exc) from exc
    except OnvifError as exc:
        raise HTTPException(400, detail={"code": exc.code, "message": exc.message}) from exc
    try:
        out = client.probe()
    except OnvifError as exc:
        audit(db, action="onvif.probe", user=p.user, ip=client_ip(request), target_type="host", target_id=body.host,
              result="fail", details={"error_code": exc.code}, commit=True)
        raise HTTPException(400, detail={"code": exc.code, "message": exc.message}) from exc
    except TargetDenied as exc:
        raise _denied(exc) from exc
    finally:
        client.close()
    # 중복 등록 감지
    dups = []
    serial = out.device.get("SerialNumber", "")
    q = select(Camera).where(Camera.deleted_at.is_(None), Camera.site_id == site.id)
    for c in db.scalars(q):
        if (serial and c.serial == serial and c.vendor == out.device.get("Manufacturer", "")) or c.host == body.host.strip():
            dups.append({"id": c.id, "name": c.name, "host": c.host, "serial": c.serial})
    audit(db, action="onvif.probe", user=p.user, ip=client_ip(request), target_type="host", target_id=body.host,
          details={"manufacturer": out.device.get("Manufacturer"), "model": out.device.get("Model")}, commit=True)
    return {
        "device": out.device,
        "time_offset_seconds": out.time_offset_seconds,
        "media2": out.media2,
        "capabilities": out.capabilities,
        "services": out.services,
        "profiles": out.profiles,
        "warnings": out.warnings,
        "duplicates": dups,
        "note": "ONVIF 연동 조회 결과입니다. ONVIF 공식 적합성 인증 여부와는 무관합니다.",
    }


# ------------------------------------------------------------------ 등록·수정·삭제
def _validate_urls(site: Site, main: str, sub: str, snap: str) -> None:
    try:
        check_url(main, _nets(site), schemes={"rtsp", "rtsps"})
        if sub:
            check_url(sub, _nets(site), schemes={"rtsp", "rtsps"})
        if snap:
            check_url(snap, _nets(site), schemes={"http", "https"})
    except TargetDenied as exc:
        raise _denied(exc) from exc


def _validate_mode(record_mode: str, transport: str) -> None:
    if record_mode not in ("off", "continuous"):
        raise HTTPException(400, "녹화 방식은 '끔' 또는 '연속'만 지원합니다(예약·이벤트 녹화는 2단계).")
    if transport not in ("tcp", "udp"):
        raise HTTPException(400, "RTSP 전송 방식은 tcp 또는 udp 입니다.")


def _driver_id(db: Session, connection_type: str) -> int | None:
    name = "onvif-generic" if connection_type == "onvif" else "rtsp-generic"
    d = db.scalar(select(Driver).where(Driver.name == name))
    return d.id if d else None


def create_camera_record(db: Session, p: Principal, body: CameraIn, ip: str) -> Camera:
    site = _site(db, p, body.site_id)
    if body.connection_type not in ("onvif", "rtsp"):
        raise HTTPException(400, "연결 방식은 onvif 또는 rtsp 입니다.")
    _validate_mode(body.record_mode, body.rtsp_transport)
    _validate_urls(site, body.main_stream_url, body.sub_stream_url, body.snapshot_url)
    host = body.host.strip()
    if body.connection_type == "onvif":
        if not host or not body.onvif_port:
            raise HTTPException(400, "ONVIF 카메라는 주소와 포트가 필요합니다.")
        try:
            check_host(host, _nets(site))
        except TargetDenied as exc:
            raise _denied(exc) from exc
    if not host:
        from urllib.parse import urlsplit

        host = urlsplit(body.main_stream_url).hostname or ""
    if not body.allow_duplicate:
        q = select(Camera).where(Camera.deleted_at.is_(None), Camera.site_id == site.id,
                                 or_(Camera.main_stream_url == body.main_stream_url,
                                     (Camera.serial == body.serial) if body.serial else false()))
        dup = db.scalar(q)
        if dup:
            raise HTTPException(409, detail={"code": "duplicate", "message": f"이미 등록된 카메라와 중복됩니다: {dup.name} (#{dup.id})",
                                             "camera_id": dup.id})
    cam = Camera(
        site_id=site.id, name=body.name.strip(), building=body.building, zone=body.zone,
        connection_type=body.connection_type, host=host, onvif_port=body.onvif_port,
        onvif_scheme=body.onvif_scheme if body.onvif_scheme in ("http", "https") else "http",
        onvif_device_path=body.onvif_device_path or "/onvif/device_service",
        rtsp_transport=body.rtsp_transport, main_stream_url=body.main_stream_url.strip(),
        sub_stream_url=body.sub_stream_url.strip(), main_profile_token=body.main_profile_token,
        sub_profile_token=body.sub_profile_token, snapshot_url=body.snapshot_url.strip(),
        username=body.username, password_enc=encrypt_secret(body.password),
        vendor=body.vendor, model=body.model, firmware=body.firmware, serial=body.serial,
        tags=[t.strip() for t in body.tags if t.strip()][:20], location_note=body.location_note,
        enabled=body.enabled, record_mode=body.record_mode, retention_days=body.retention_days,
        is_test_source=body.is_test_source, capabilities=body.capabilities, stream_info=body.stream_info,
        driver_id=_driver_id(db, body.connection_type),
    )
    db.add(cam)
    db.flush()
    db.add(CameraStatus(camera_id=cam.id, recorder_state="idle"))
    audit(db, action="camera.create", user=p.user, ip=ip, target_type="camera", target_id=cam.id,
          details={"name": cam.name, "site_id": site.id, "type": cam.connection_type, "main": cam.main_stream_url,
                   "record_mode": cam.record_mode, "test_source": cam.is_test_source})
    return cam


@router.post("/cameras")
def create_camera(body: CameraIn, request: Request, p: Principal = Depends(require("settings")),
                  db: Session = Depends(get_db)):
    cam = create_camera_record(db, p, body, client_ip(request))
    db.commit()
    return camera_out(cam, db.get(CameraStatus, cam.id))


@router.patch("/cameras/{camera_id}")
def update_camera(camera_id: int, body: CameraPatch, request: Request, p: Principal = Depends(require("settings")),
                  db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    site = cam.site
    changes: dict[str, Any] = {}
    data = body.model_dump(exclude_unset=True)
    reconnect_fields = {"host", "onvif_port", "rtsp_transport", "main_stream_url", "sub_stream_url", "username",
                        "password", "tls_insecure", "enabled"}
    if "record_mode" in data or "rtsp_transport" in data:
        _validate_mode(data.get("record_mode", cam.record_mode), data.get("rtsp_transport", cam.rtsp_transport))
    _validate_urls(site, data.get("main_stream_url", cam.main_stream_url), data.get("sub_stream_url", cam.sub_stream_url),
                   data.get("snapshot_url", cam.snapshot_url))
    if "tls_insecure" in data and data["tls_insecure"] != cam.tls_insecure:
        if not p.is_superadmin:
            raise HTTPException(403, "인증서 검증 예외는 최고관리자만 승인할 수 있습니다.")
        cam.tls_insecure = bool(data["tls_insecure"])
        cam.tls_insecure_approved_by = p.user.id if cam.tls_insecure else None
        cam.tls_insecure_approved_at = utcnow() if cam.tls_insecure else None
        changes["tls_insecure"] = cam.tls_insecure
    for k, v in data.items():
        if k in ("tls_insecure",):
            continue
        if k == "password":
            if v:
                cam.password_enc = encrypt_secret(v)
                changes["password_changed"] = True
            continue
        if k == "retention_days":
            v = v or None
        if k == "tags" and v is not None:
            v = [t.strip() for t in v if t.strip()][:20]
        if getattr(cam, k) != v:
            setattr(cam, k, v)
            changes[k] = v
    if any(k in reconnect_fields or k == "password_changed" for k in changes):
        cam.config_version += 1
        st = db.get(CameraStatus, cam.id)
        if st:
            st.retry_count = 0  # 비밀번호 변경 등으로 즉시 재인증
            st.next_retry_at = None
    cam.updated_at = utcnow()
    audit(db, action="camera.update", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          details={k: v for k, v in changes.items() if k != "password"})
    db.commit()
    return camera_out(cam, db.get(CameraStatus, cam.id))


@router.delete("/cameras/{camera_id}")
def delete_camera(camera_id: int, request: Request, p: Principal = Depends(require("settings")),
                  db: Session = Depends(get_db)):
    """카메라 등록정보 삭제. 녹화 파일은 보존되며, 녹화 삭제는 /api/recordings 의 별도 동작이다."""
    cam = get_camera_for(db, p, camera_id, request)
    cam.deleted_at = utcnow()
    cam.enabled = False
    cam.config_version += 1
    cam.password_enc = ""  # 더 이상 연결하지 않으므로 인증정보 폐기
    n = db.scalar(select(func.count()).select_from(RecordingSegment).where(RecordingSegment.camera_id == cam.id)) or 0
    audit(db, action="camera.delete", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          details={"name": cam.name, "recordings_kept": n})
    db.commit()
    return {"ok": True, "recordings_kept": n,
            "message": f"카메라 등록정보를 삭제했습니다. 기존 녹화 {n}개 구간은 보존됩니다(보관 정책에 따라 정리)."}


@router.post("/cameras/{camera_id}/test")
def test_camera(camera_id: int, request: Request, which: str = "main", p: Principal = Depends(require("settings")),
                db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    try:
        src = camera_source(cam, which)
    except TargetDenied as exc:
        raise _denied(exc) from exc
    res = probe_stream(src)
    if res.ok:
        info = dict(cam.stream_info or {})
        info[which] = {"video": res.video, "audio": res.audio, "bitrate_kbps": res.bitrate_kbps,
                       "measured_fps": res.measured_fps, "tested_at": utcnow().isoformat()}
        cam.stream_info = info
    audit(db, action="camera.test", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          result="ok" if res.ok else "fail", details={"which": which, "error_code": res.error_code})
    db.commit()
    return res.to_dict()


@router.get("/cameras/{camera_id}/snapshot")
def camera_snapshot(camera_id: int, request: Request, p: Principal = Depends(require("live_view")),
                    db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    pw = decrypt_secret(cam.password_enc)
    img, code, msg = _snapshot(cam.site, cam.snapshot_url, cam.sub_stream_url or cam.main_stream_url, cam.username,
                               pw, cam.rtsp_transport, cam.tls_insecure)
    audit(db, action="camera.snapshot", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          result="ok" if img else "fail", commit=True)
    if not img:
        raise HTTPException(400, detail={"code": code, "message": msg})
    return Response(content=img, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/cameras/{camera_id}/recording")
def control_recording(camera_id: int, body: RecordingControlIn, request: Request,
                      p: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    if body.action == "start":
        cam.record_mode = "continuous"
    elif body.action == "stop":
        cam.record_mode = "off"
        cam.manual_record_until = None
    elif body.action == "manual_start":
        cam.manual_record_until = utcnow() + dt.timedelta(minutes=body.minutes)
    elif body.action == "manual_stop":
        cam.manual_record_until = None
    else:
        raise HTTPException(400, "알 수 없는 동작입니다.")
    cam.updated_at = utcnow()
    audit(db, action=f"recording.{body.action}", user=p.user, ip=client_ip(request), target_type="camera",
          target_id=cam.id, details={"minutes": body.minutes} if body.action == "manual_start" else {})
    db.commit()
    return camera_out(cam, db.get(CameraStatus, cam.id))


# ------------------------------------------------------------------ CSV 일괄 등록
CSV_COLUMNS = ["site_code", "name", "building", "zone", "connection_type", "host", "onvif_port", "username", "password",
               "main_stream_url", "sub_stream_url", "snapshot_url", "rtsp_transport", "record_mode", "retention_days",
               "tags", "location_note"]


@router.get("/cameras-csv/template")
def csv_template(p: Principal = Depends(require("settings"))):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_COLUMNS)
    w.writerow(["SITE1", "정문 카메라", "본관", "정문", "onvif", "192.168.10.21", "80", "admin", "", "", "", "", "tcp",
                "continuous", "30", "출입;외곽", "정문 위 2.5m"])
    w.writerow(["SITE1", "주차장 카메라", "주차동", "B1", "rtsp", "", "", "viewer", "", "rtsp://192.168.10.22:554/<카메라 매뉴얼의 경로>",
                "", "", "tcp", "continuous", "", "주차장", ""])
    note = ("# onvif 행: host·onvif_port·username·password 필수, 스트림 주소는 비워두면 ONVIF로 조회(첫 프로파일=메인, 둘째=서브)\n"
            "# rtsp 행: main_stream_url 필수(카메라 매뉴얼 또는 ONVIF 조회로 확인한 주소만 사용)\n"
            "# 비밀번호가 들어간 CSV는 업로드 후 즉시 삭제하세요.\n")
    data = "﻿" + note + buf.getvalue()
    return Response(content=data.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="camera_import_template.csv"'})


@router.post("/cameras-csv/import")
async def csv_import(request: Request, file: UploadFile = File(...), dry_run: bool = False,
                     p: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    raw = await file.read()
    if len(raw) > 1024 * 1024:
        raise HTTPException(400, "CSV 파일은 1MB 이하만 가능합니다.")
    text = raw.decode("utf-8-sig", errors="replace")
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    reader = csv.DictReader(lines)
    missing = [c for c in ("site_code", "name", "connection_type") if c not in (reader.fieldnames or [])]
    if missing:
        raise HTTPException(400, f"필수 열이 없습니다: {', '.join(missing)}")
    results = []
    sites = {s.code: s for s in db.scalars(select(Site))}
    for i, row in enumerate(reader, start=2):
        if i > 202:
            results.append({"row": i, "ok": False, "message": "한 번에 200행까지 처리합니다."})
            break
        row = {k: (v or "").strip() for k, v in row.items() if k}
        try:
            site = sites.get(row.get("site_code", ""))
            if not site or not p.can_site(site.id):
                raise ValueError("현장 코드를 찾을 수 없거나 권한이 없습니다.")
            ctype = row.get("connection_type", "rtsp").lower()
            main, sub, snap = row.get("main_stream_url", ""), row.get("sub_stream_url", ""), row.get("snapshot_url", "")
            info: dict[str, Any] = {}
            caps: dict[str, Any] = {}
            vendor = model = fw = serial = ""
            mtok = stok = ""
            if ctype == "onvif" and not main:
                c = OnvifClient(OnvifTarget(scheme="http", host=row.get("host", ""), port=int(row.get("onvif_port") or 80),
                                            device_path="/onvif/device_service", username=row.get("username", ""),
                                            password=row.get("password", ""), allowed_networks=_nets(site)))
                try:
                    out = c.probe()
                finally:
                    c.close()
                usable = [x for x in out.profiles if x.get("stream_uri")]
                if not usable:
                    raise ValueError("ONVIF 프로파일에서 스트림 주소를 얻지 못했습니다.")
                main, mtok = usable[0]["stream_uri"], usable[0]["token"]
                if len(usable) > 1:
                    sub, stok = usable[1]["stream_uri"], usable[1]["token"]
                snap = snap or usable[0].get("snapshot_uri", "")
                vendor, model = out.device.get("Manufacturer", ""), out.device.get("Model", "")
                fw, serial = out.device.get("FirmwareVersion", ""), out.device.get("SerialNumber", "")
                caps = out.capabilities
            body = CameraIn(
                site_id=site.id, name=row["name"], building=row.get("building", ""), zone=row.get("zone", ""),
                connection_type=ctype, host=row.get("host", ""),
                onvif_port=int(row["onvif_port"]) if row.get("onvif_port") else None,
                rtsp_transport=row.get("rtsp_transport") or "tcp", main_stream_url=main, sub_stream_url=sub,
                main_profile_token=mtok, sub_profile_token=stok, snapshot_url=snap,
                username=row.get("username", ""), password=row.get("password", ""),
                vendor=vendor, model=model, firmware=fw, serial=serial,
                tags=[t for t in row.get("tags", "").split(";") if t], location_note=row.get("location_note", ""),
                record_mode=row.get("record_mode") or "continuous",
                retention_days=int(row["retention_days"]) if row.get("retention_days") else None,
                capabilities=caps, stream_info=info,
            )
            if dry_run:
                _validate_mode(body.record_mode, body.rtsp_transport)
                _validate_urls(site, body.main_stream_url, body.sub_stream_url, body.snapshot_url)
                results.append({"row": i, "ok": True, "message": "검증 통과", "name": body.name})
            else:
                with db.begin_nested():
                    cam = create_camera_record(db, p, body, client_ip(request))
                results.append({"row": i, "ok": True, "message": "등록됨", "camera_id": cam.id, "name": cam.name})
        except HTTPException as exc:
            d = exc.detail
            results.append({"row": i, "ok": False, "message": d.get("message") if isinstance(d, dict) else str(d)})
        except (OnvifError, TargetDenied) as exc:
            results.append({"row": i, "ok": False, "message": exc.message})
        except (ValueError, KeyError) as exc:
            results.append({"row": i, "ok": False, "message": str(exc)})
    audit(db, action="camera.import_csv", user=p.user, ip=client_ip(request), target_type="camera",
          details={"rows": len(results), "ok": sum(r["ok"] for r in results), "dry_run": dry_run})
    db.commit()
    return {"results": results}


def error_text(code: str) -> str:
    return ERROR_TEXT.get(code, code)
