from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...audit import audit
from ...models import AuthSession, Camera, Site, User, UserCamera, utcnow
from ...security.passwords import hash_password, validate_password_policy
from ...security.permissions import PERMISSIONS, ROLES, effective_permissions
from ..deps import Principal, client_ip, get_db, require_superadmin

router = APIRouter(prefix="/api/users", tags=["users"])
_USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")


class UserIn(BaseModel):
    username: str = Field(max_length=64)
    display_name: str = Field(default="", max_length=100)
    role: str
    password: str = Field(max_length=256)
    site_ids: list[int] = []
    camera_ids: list[int] = []
    permissions_override: dict[str, bool] = {}


class UserPatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    role: str | None = None
    is_active: bool | None = None
    site_ids: list[int] | None = None
    camera_ids: list[int] | None = None
    permissions_override: dict[str, bool] | None = None
    new_password: str | None = Field(default=None, max_length=256)


def user_out(u: User, camera_ids: list[int] | None = None) -> dict:
    return {
        "camera_ids": camera_ids or [],
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "role": u.role,
        "role_label": ROLES.get(u.role, u.role),
        "is_active": u.is_active,
        "must_change_password": u.must_change_password,
        "site_ids": [s.id for s in u.sites],
        "permissions_override": u.permissions_override,
        "effective_permissions": sorted(effective_permissions(u.role, u.permissions_override)),
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def _check_override(o: dict[str, bool]) -> dict[str, bool]:
    bad = [k for k in o if k not in PERMISSIONS]
    if bad:
        raise HTTPException(400, f"알 수 없는 권한: {', '.join(bad)}")
    return {k: bool(v) for k, v in o.items()}


@router.get("")
def list_users(p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    cams: dict[int, list[int]] = {}
    for uc in db.scalars(select(UserCamera)):
        cams.setdefault(uc.user_id, []).append(uc.camera_id)
    return {"items": [user_out(u, cams.get(u.id)) for u in db.scalars(select(User).order_by(User.id))],
            "roles": ROLES, "permissions": PERMISSIONS}


@router.post("")
def create_user(body: UserIn, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    username = body.username.strip().lower()
    if not _USERNAME.match(username):
        raise HTTPException(400, "사용자 ID는 영문 소문자·숫자·._- 3~64자입니다.")
    if body.role not in ROLES:
        raise HTTPException(400, "알 수 없는 역할입니다.")
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(409, "이미 존재하는 사용자 ID입니다.")
    reason = validate_password_policy(body.password, username)
    if reason:
        raise HTTPException(400, reason)
    u = User(username=username, display_name=body.display_name, role=body.role,
             password_hash=hash_password(body.password), must_change_password=True,
             permissions_override=_check_override(body.permissions_override))
    u.sites = list(db.scalars(select(Site).where(Site.id.in_(body.site_ids)))) if body.site_ids else []
    db.add(u)
    db.flush()
    _set_cameras(db, u.id, body.camera_ids)
    audit(db, action="user.create", user=p.user, ip=client_ip(request), target_type="user", target_id=u.id,
          details={"username": username, "role": body.role, "site_ids": body.site_ids})
    db.commit()
    return user_out(u, body.camera_ids)


@router.patch("/{user_id}")
def update_user(user_id: int, body: UserPatch, request: Request, p: Principal = Depends(require_superadmin),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")
    changes: dict = {}
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(400, "알 수 없는 역할입니다.")
        if u.id == p.user.id and body.role != "superadmin":
            raise HTTPException(400, "자기 자신의 최고관리자 권한은 해제할 수 없습니다.")
        u.role = body.role
        changes["role"] = body.role
    if body.display_name is not None:
        u.display_name = body.display_name
        changes["display_name"] = body.display_name
    if body.is_active is not None:
        if u.id == p.user.id and not body.is_active:
            raise HTTPException(400, "자기 자신을 비활성화할 수 없습니다.")
        u.is_active = body.is_active
        changes["is_active"] = body.is_active
        if not body.is_active:
            _revoke_all(db, u.id)
    if body.site_ids is not None:
        u.sites = list(db.scalars(select(Site).where(Site.id.in_(body.site_ids)))) if body.site_ids else []
        changes["site_ids"] = body.site_ids
    if body.camera_ids is not None:
        _set_cameras(db, u.id, body.camera_ids)
        changes["camera_ids"] = body.camera_ids
        _revoke_all(db, u.id)  # 시청 토큰 재발급 강제
    if body.permissions_override is not None:
        u.permissions_override = _check_override(body.permissions_override)
        changes["permissions_override"] = u.permissions_override
    if body.new_password:
        reason = validate_password_policy(body.new_password, u.username)
        if reason:
            raise HTTPException(400, reason)
        u.password_hash = hash_password(body.new_password)
        u.must_change_password = True
        _revoke_all(db, u.id)
        changes["password_reset"] = True
    audit(db, action="user.update", user=p.user, ip=client_ip(request), target_type="user", target_id=u.id,
          details=changes)
    db.commit()
    return user_out(u, list(db.scalars(select(UserCamera.camera_id).where(UserCamera.user_id == u.id))))


def _set_cameras(db: Session, user_id: int, camera_ids: list[int]) -> None:
    db.query(UserCamera).filter(UserCamera.user_id == user_id).delete()
    valid = set(db.scalars(select(Camera.id).where(Camera.id.in_(camera_ids)))) if camera_ids else set()
    for cid in sorted(valid):
        db.add(UserCamera(user_id=user_id, camera_id=cid))


def _revoke_all(db: Session, user_id: int) -> int:
    n = 0
    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))):
        s.revoked_at = utcnow()
        n += 1
    return n


@router.post("/{user_id}/revoke-sessions")
def revoke_sessions(user_id: int, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")
    n = _revoke_all(db, u.id)
    audit(db, action="user.revoke_sessions", user=p.user, ip=client_ip(request), target_type="user",
          target_id=u.id, details={"revoked": n})
    db.commit()
    return {"revoked": n}
