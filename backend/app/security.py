"""인증(세션 쿠키 + CSRF 헤더), 비밀번호 해시(Argon2), 서버측 권한 검사."""
import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import Project, ProjectMember, User, UserSession
from .util import now_kst

SESSION_COOKIE = "gw_session"
CSRF_HEADER = "X-CSRF-Token"
_ph = PasswordHasher()


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def validate_password_policy(pw: str) -> None:
    if len(pw) < 8:
        raise HTTPException(400, "비밀번호는 8자 이상이어야 합니다.")
    kinds = sum([any(c.isalpha() for c in pw), any(c.isdigit() for c in pw), any(not c.isalnum() for c in pw)])
    if kinds < 2:
        raise HTTPException(400, "비밀번호는 영문·숫자·특수문자 중 2종류 이상을 포함해야 합니다.")


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session, user: User, request: Request) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    db.add(UserSession(
        token_hash=_h(token), csrf_token=csrf, user_id=user.id,
        expires_at=now_kst() + timedelta(hours=get_settings().session_hours),
        ip=request.client.host if request.client else None,
        user_agent=(request.headers.get("user-agent") or "")[:300],
    ))
    return token, csrf


def destroy_session(db: Session, token: str | None) -> None:
    if token:
        db.query(UserSession).filter(UserSession.token_hash == _h(token)).delete()


@dataclass
class Ctx:
    """요청 단위 인증 컨텍스트."""
    user: User
    perms: set[str]
    csrf: str
    db: Session
    ip: str | None

    @property
    def company_id(self) -> int:
        return self.user.company_id

    def has(self, perm: str) -> bool:
        return perm in self.perms

    def require(self, *perms: str) -> None:
        missing = [p for p in perms if p not in self.perms]
        if missing:
            raise HTTPException(403, "이 작업을 수행할 권한이 없습니다.")

    # 현장 접근 범위 -------------------------------------------------
    def project_ids(self) -> list[int] | None:
        """None = 전체 현장. 그 외에는 접근 가능한 현장 id 목록."""
        if self.has("project.view_all"):
            return None
        rows = self.db.execute(select(ProjectMember.project_id).where(
            ProjectMember.user_id == self.user.id, ProjectMember.company_id == self.company_id)).scalars().all()
        extra = self.db.execute(select(Project.id).where(
            Project.company_id == self.company_id,
            (Project.site_manager_id == self.user.id) | (Project.admin_staff_id == self.user.id))).scalars().all()
        return sorted(set(rows) | set(extra))

    def project(self, project_id: int, include_deleted: bool = False) -> Project:
        p = self.db.get(Project, project_id)
        if not p or p.company_id != self.company_id or (p.deleted_at and not include_deleted):
            raise HTTPException(404, "공사를 찾을 수 없습니다.")
        ids = self.project_ids()
        if ids is not None and p.id not in ids:
            raise HTTPException(403, "배정되지 않은 현장입니다.")
        return p


def effective_permissions(user: User) -> set[str]:
    perms = set(user.role.permissions or []) | set(user.extra_permissions or [])
    return perms - set(user.denied_permissions or [])


def get_ctx(request: Request, db: Session = Depends(get_db)) -> Ctx:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "로그인이 필요합니다.")
    sess = db.execute(select(UserSession).where(UserSession.token_hash == _h(token))).scalar_one_or_none()
    if not sess or sess.expires_at < now_kst():
        raise HTTPException(401, "로그인 세션이 만료되었습니다. 다시 로그인하세요.")
    user = db.get(User, sess.user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "사용할 수 없는 계정입니다.")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if not secrets.compare_digest(request.headers.get(CSRF_HEADER, ""), sess.csrf_token):
            raise HTTPException(403, "보안 토큰이 올바르지 않습니다. 새로고침 후 다시 시도하세요.")
    ctx = Ctx(user=user, perms=effective_permissions(user), csrf=sess.csrf_token, db=db,
              ip=request.client.host if request.client else None)
    # 최초 비밀번호 변경 전에는 비밀번호 변경 외 API 차단
    if user.must_change_password and request.url.path not in ("/api/auth/me", "/api/auth/password", "/api/auth/logout"):
        raise HTTPException(428, "최초 로그인: 비밀번호를 먼저 변경하세요.")
    return ctx


def perm(*perms: str):
    def dep(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        ctx.require(*perms)
        return ctx
    return dep
