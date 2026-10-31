from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import AuditLog, Company, User
from ..permissions import PERMISSIONS
from ..security import (SESSION_COOKIE, Ctx, create_session, destroy_session, effective_permissions, get_ctx,
                        hash_password, validate_password_policy, verify_password)
from ..util import now_kst

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAIL = 5
LOCK_MIN = 10


class LoginIn(BaseModel):
    login_id: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=200)


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    users = db.execute(select(User).where(User.login_id == body.login_id.strip())).scalars().all()
    user = users[0] if len(users) == 1 else None
    msg = "아이디 또는 비밀번호가 올바르지 않습니다."
    if not user:
        raise HTTPException(401, msg)
    if user.locked_until and user.locked_until > now_kst():
        raise HTTPException(423, f"로그인 {MAX_FAIL}회 실패로 잠겼습니다. {LOCK_MIN}분 후 다시 시도하거나 관리자에게 문의하세요.")
    if not verify_password(body.password, user.password_hash):
        user.failed_logins = (user.failed_logins or 0) + 1
        if user.failed_logins >= MAX_FAIL:
            user.locked_until = now_kst() + timedelta(minutes=LOCK_MIN)
            user.failed_logins = 0
        db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="login_fail", entity="user",
                        entity_id=user.id, summary="로그인 실패", ip=request.client.host if request.client else None))
        db.commit()
        raise HTTPException(401, msg)
    if not user.is_active:
        raise HTTPException(403, "비활성화된 계정입니다. 관리자에게 문의하세요.")
    user.failed_logins, user.locked_until, user.last_login_at = 0, None, now_kst()
    token, csrf = create_session(db, user, request)
    db.add(AuditLog(company_id=user.company_id, user_id=user.id, action="login", entity="user", entity_id=user.id,
                    summary="로그인", ip=request.client.host if request.client else None))
    db.commit()
    s = get_settings()
    response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=s.cookie_secure, samesite="lax",
                        max_age=s.session_hours * 3600, path="/")
    return {"ok": True, "csrf": csrf, "must_change_password": user.must_change_password}


@router.post("/logout")
def logout(request: Request, response: Response, ctx: Ctx = Depends(get_ctx)):
    destroy_session(ctx.db, request.cookies.get(SESSION_COOKIE))
    ctx.db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(ctx: Ctx = Depends(get_ctx)):
    u = ctx.user
    c = ctx.db.get(Company, u.company_id)
    return {
        "id": u.id, "login_id": u.login_id, "name": u.name, "company_id": u.company_id,
        "company_name": c.name, "company_logo_file_id": c.logo_file_id,
        "department": u.department.name if u.department else None,
        "position": u.position.name if u.position else None,
        "role": u.role.name, "role_code": u.role.code,
        "permissions": sorted(effective_permissions(u)), "csrf": ctx.csrf,
        "must_change_password": u.must_change_password,
        "permission_labels": PERMISSIONS,
    }


class PwIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


@router.post("/password")
def change_password(body: PwIn, ctx: Ctx = Depends(get_ctx)):
    if not verify_password(body.current_password, ctx.user.password_hash):
        raise HTTPException(400, "현재 비밀번호가 올바르지 않습니다.")
    if body.current_password == body.new_password:
        raise HTTPException(400, "새 비밀번호가 현재 비밀번호와 같습니다.")
    validate_password_policy(body.new_password)
    ctx.user.password_hash = hash_password(body.new_password)
    ctx.user.must_change_password = False
    ctx.db.add(AuditLog(company_id=ctx.company_id, user_id=ctx.user.id, action="password_change",
                        entity="user", entity_id=ctx.user.id, summary="비밀번호 변경", ip=ctx.ip))
    ctx.db.commit()
    return {"ok": True}
