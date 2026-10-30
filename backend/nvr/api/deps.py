from __future__ import annotations

import datetime as dt
import hmac
import ipaddress
from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import audit
from ..config import get_settings
from ..db import SessionLocal
from ..models import AuthSession, Camera, User, utcnow
from ..security.crypto import sha256_hex
from ..security.permissions import effective_permissions

COOKIE_NAME = "nvr_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def client_ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    trusted = [p.strip() for p in get_settings().trusted_proxies.split(",") if p.strip()]
    if peer and trusted:
        try:
            pip = ipaddress.ip_address(peer)
            if any(pip in ipaddress.ip_network(t, strict=False) for t in trusted):
                xff = request.headers.get("x-forwarded-for", "")
                if xff:
                    return xff.split(",")[-1].strip()[:64]
        except ValueError:
            pass
    return peer[:64]


@dataclass
class Principal:
    user: User
    session: AuthSession
    permissions: set[str]
    site_ids: set[int] | None  # None = 전체 현장

    @property
    def is_superadmin(self) -> bool:
        return self.user.role == "superadmin"

    def can(self, perm: str) -> bool:
        return perm in self.permissions

    def can_site(self, site_id: int) -> bool:
        return self.site_ids is None or site_id in self.site_ids


def load_principal(db: Session, token: str) -> Principal | None:
    if not token:
        return None
    sess = db.scalar(select(AuthSession).where(AuthSession.token_hash == sha256_hex(token)))
    now = utcnow()
    if not sess or sess.revoked_at or sess.expires_at < now or sess.idle_expires_at < now:
        return None
    user = db.get(User, sess.user_id)
    if not user or not user.is_active:
        return None
    perms = effective_permissions(user.role, user.permissions_override)
    sites = None if user.role == "superadmin" else {s.id for s in user.sites}
    return Principal(user=user, session=sess, permissions=perms, site_ids=sites)


def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    token = request.cookies.get(COOKIE_NAME, "")
    p = load_principal(db, token)
    if not p:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    if request.method not in SAFE_METHODS:
        sent = request.headers.get("x-csrf-token", "")
        if not sent or not hmac.compare_digest(sent, p.session.csrf_token):
            raise HTTPException(status_code=403, detail="요청 검증(CSRF)에 실패했습니다. 화면을 새로고침하세요.")
    # 유휴 만료 연장(요청 폭주 시 쓰기 줄이기 위해 1분 단위)
    s = get_settings()
    new_idle = utcnow() + dt.timedelta(minutes=s.session_idle_minutes)
    if (new_idle - p.session.idle_expires_at).total_seconds() > 60:
        p.session.idle_expires_at = min(new_idle, p.session.expires_at)
        db.commit()
    request.state.principal = p
    return p


def principal_allow_password_change(request: Request, db: Session = Depends(get_db)) -> Principal:
    return current_principal(request, db)


def active_principal(p: Principal = Depends(current_principal)) -> Principal:
    if p.user.must_change_password:
        raise HTTPException(status_code=403, detail="초기 비밀번호를 변경해야 합니다.")
    return p


def require(perm: str):
    def dep(request: Request, p: Principal = Depends(active_principal), db: Session = Depends(get_db)) -> Principal:
        if not p.can(perm):
            audit(db, action="access.denied", user=p.user, ip=client_ip(request), target_type="permission",
                  target_id=perm, result="denied", details={"path": request.url.path}, commit=True)
            raise HTTPException(status_code=403, detail="권한이 없습니다.")
        return p

    return dep


def require_superadmin(request: Request, p: Principal = Depends(active_principal), db: Session = Depends(get_db)) -> Principal:
    if not p.is_superadmin:
        audit(db, action="access.denied", user=p.user, ip=client_ip(request), target_type="permission",
              target_id="superadmin", result="denied", details={"path": request.url.path}, commit=True)
        raise HTTPException(status_code=403, detail="최고관리자만 사용할 수 있습니다.")
    return p


def get_camera_for(db: Session, p: Principal, camera_id: int, request: Request | None = None,
                   include_deleted: bool = False) -> Camera:
    cam = db.get(Camera, camera_id)
    if not cam or (cam.deleted_at and not include_deleted):
        raise HTTPException(status_code=404, detail="카메라를 찾을 수 없습니다.")
    if not p.can_site(cam.site_id):
        audit(db, action="access.denied", user=p.user, ip=client_ip(request) if request else "",
              target_type="camera", target_id=camera_id, result="denied", commit=True)
        # 존재 여부를 숨기기 위해 404
        raise HTTPException(status_code=404, detail="카메라를 찾을 수 없습니다.")
    return cam
