from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...audit import audit
from ...config import get_settings
from ...models import AuthSession, LoginAttempt, User, utcnow
from ...security.crypto import new_token, sha256_hex
from ...security.passwords import hash_password, needs_rehash, validate_password_policy, verify_password
from ...security.permissions import PERMISSIONS, ROLES
from ..deps import COOKIE_NAME, Principal, client_ip, current_principal, get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


def me_payload(p: Principal) -> dict:
    u = p.user
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "role": u.role,
        "role_label": ROLES.get(u.role, u.role),
        "permissions": sorted(p.permissions),
        "site_ids": None if p.site_ids is None else sorted(p.site_ids),
        "must_change_password": u.must_change_password,
        "csrf_token": p.session.csrf_token,
        "session_expires_at": p.session.expires_at.isoformat(),
        "permission_labels": PERMISSIONS,
    }


def _locked(db: Session, username: str, ip: str) -> bool:
    s = get_settings()
    since = utcnow() - dt.timedelta(minutes=s.login_window_minutes)
    # 마지막 성공 이후의 실패만 센다
    last_ok = db.scalar(select(func.max(LoginAttempt.at)).where(
        LoginAttempt.username == username, LoginAttempt.success.is_(True)))
    user_since = max(since, last_ok) if last_ok else since
    user_fail = db.scalar(select(func.count()).select_from(LoginAttempt).where(
        LoginAttempt.username == username, LoginAttempt.success.is_(False), LoginAttempt.at > user_since)) or 0
    ip_fail = db.scalar(select(func.count()).select_from(LoginAttempt).where(
        LoginAttempt.ip == ip, LoginAttempt.success.is_(False), LoginAttempt.at > since)) or 0
    return user_fail >= s.login_max_fail_user or ip_fail >= s.login_max_fail_ip


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    s = get_settings()
    ip = client_ip(request)
    username = body.username.strip().lower()
    if _locked(db, username, ip):
        db.add(LoginAttempt(username=username, ip=ip, success=False))
        audit(db, action="auth.login", username=username, ip=ip, result="denied", details={"reason": "locked"})
        db.commit()
        raise HTTPException(status_code=429, detail=f"로그인 실패가 반복되어 잠시 차단되었습니다. {s.login_window_minutes}분 후 다시 시도하세요.")
    user = db.scalar(select(User).where(User.username == username))
    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or not user or not user.is_active:
        db.add(LoginAttempt(username=username, ip=ip, success=False))
        audit(db, action="auth.login", username=username, ip=ip, result="fail",
              details={"reason": "inactive" if (user and ok) else "bad_credentials"})
        db.commit()
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    token = new_token(32)
    now = utcnow()
    sess = AuthSession(
        token_hash=sha256_hex(token),
        csrf_token=new_token(24),
        user_id=user.id,
        expires_at=now + dt.timedelta(hours=s.session_absolute_hours),
        idle_expires_at=now + dt.timedelta(minutes=s.session_idle_minutes),
        ip=ip,
        user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    db.add(sess)
    user.last_login_at = now
    db.add(LoginAttempt(username=username, ip=ip, success=True))
    audit(db, action="auth.login", user=user, ip=ip, result="ok")
    db.commit()
    response.set_cookie(
        COOKIE_NAME, token, httponly=True, secure=s.cookie_secure, samesite="strict",
        max_age=s.session_absolute_hours * 3600, path="/",
    )
    from ..deps import load_principal

    p = load_principal(db, token)
    return me_payload(p)


@router.post("/logout")
def logout(request: Request, response: Response, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    p.session.revoked_at = utcnow()
    audit(db, action="auth.logout", user=p.user, ip=client_ip(request))
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(p: Principal = Depends(current_principal)):
    return me_payload(p)


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, p: Principal = Depends(current_principal),
                    db: Session = Depends(get_db)):
    user = p.user
    if not verify_password(user.password_hash, body.current_password):
        audit(db, action="auth.change_password", user=user, ip=client_ip(request), result="fail", commit=True)
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다.")
    reason = validate_password_policy(body.new_password, user.username)
    if reason:
        raise HTTPException(status_code=400, detail=reason)
    if verify_password(user.password_hash, body.new_password):
        raise HTTPException(status_code=400, detail="이전과 다른 비밀번호를 사용하세요.")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    # 다른 세션은 모두 종료
    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None),
                                                    AuthSession.id != p.session.id)):
        s.revoked_at = utcnow()
    audit(db, action="auth.change_password", user=user, ip=client_ip(request))
    db.commit()
    return {"ok": True}
