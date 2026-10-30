from __future__ import annotations

import hmac
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...audit import audit
from ...camera_util import mediamtx_path
from ...config import get_keys, get_settings
from sqlalchemy import select

from ...models import AuthSession, Camera, User, UserCamera, utcnow
from ...security.crypto import sign_media_token, verify_media_token
from ...security.permissions import effective_permissions
from ..deps import Principal, client_ip, get_camera_for, get_db, require

router = APIRouter(tags=["live"])
log = logging.getLogger("nvr.live")
_PATH = re.compile(r"^cam(\d+)_(main|sub)$")


class LiveIn(BaseModel):
    camera_id: int
    stream: str = "sub"
    refresh: bool = False


@router.post("/api/live/sessions")
def live_session(body: LiveIn, request: Request, p: Principal = Depends(require("live_view")),
                 db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, body.camera_id, request)
    if not cam.enabled:
        raise HTTPException(409, "사용 안 함 상태의 카메라입니다.")
    which = "main" if body.stream == "main" or not cam.sub_stream_url else "sub"
    path = mediamtx_path(cam.id, which)
    s = get_settings()
    token, exp = sign_media_token({"u": p.user.id, "sid": p.session.id, "p": path, "a": "read"}, s.live_token_seconds)
    if not body.refresh:
        audit(db, action="live.view", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
              details={"stream": which}, commit=True)
    info = (cam.stream_info or {}).get(which) or {}
    codec = ((info.get("video") or {}).get("codec") or "").lower()
    warnings = []
    if codec == "hevc":
        warnings.append("H.265 스트림 — 브라우저에 따라 재생되지 않을 수 있습니다.")
    if (info.get("video") or {}).get("has_b_frames"):
        warnings.append("B-프레임 포함 H.264 — WebRTC 재생이 안 되면 HLS로 전환됩니다.")
    return {
        "camera_id": cam.id,
        "stream": which,
        "path": path,
        "token": token,
        "expires_at": exp,
        "whep_url": f"/rtc/{path}/whep",
        "prefer_hls": s.live_mode == "hls",
        "allow_audio": p.can("audio"),
        "has_audio": bool((info.get("audio") or {}) or ((cam.stream_info or {}).get("main") or {}).get("audio")),
        "hls_url": f"/hls/{path}/index.m3u8",
        "codec": codec or None,
        "is_test_source": cam.is_test_source,
        "warnings": warnings,
    }


@router.post("/internal/mediamtx/auth")
async def mediamtx_auth(request: Request, key: str = "", db: Session = Depends(get_db)):
    """mediamtx authMethod: http 훅. 2xx = 허용, 그 외 = 거부.

    이 경로는 caddy 에서 외부로 노출하지 않으며, 추가로 공유키(key)를 확인한다.
    """
    if not hmac.compare_digest(key, get_keys().mediamtx_hook_key):
        return Response(status_code=403)
    try:
        body = await request.json()
    except ValueError:
        return Response(status_code=400)
    action = body.get("action")
    path = body.get("path") or ""
    protocol = body.get("protocol")
    token = body.get("token") or body.get("password") or ""
    if action != "read" or protocol not in ("webrtc", "hls"):
        # 발행(publish)·RTSP 읽기·API·메트릭은 모두 거부(경로 소스는 서버가 직접 당겨옴)
        return Response(status_code=403)
    if not token:
        return Response(status_code=401)
    claims = verify_media_token(token)
    if not claims or claims.get("a") != "read" or claims.get("p") != path:
        return Response(status_code=403)
    m = _PATH.match(path)
    if not m:
        return Response(status_code=403)
    sess = db.get(AuthSession, int(claims.get("sid", 0)))
    now = utcnow()
    if not sess or sess.revoked_at or sess.expires_at < now or sess.user_id != claims.get("u"):
        return Response(status_code=403)
    user = db.get(User, sess.user_id)
    cam = db.get(Camera, int(m.group(1)))
    if not user or not user.is_active or not cam or cam.deleted_at or not cam.enabled:
        return Response(status_code=403)
    if "live_view" not in effective_permissions(user.role, user.permissions_override):
        return Response(status_code=403)
    if user.role != "superadmin":
        if cam.site_id not in {s.id for s in user.sites}:
            return Response(status_code=403)
        restricted = set(db.scalars(select(UserCamera.camera_id).where(UserCamera.user_id == user.id)))
        if restricted and cam.id not in restricted:
            return Response(status_code=403)
    return Response(status_code=200)
