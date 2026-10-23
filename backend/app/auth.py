from __future__ import annotations

from datetime import datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AuditLog, Project, ProjectMember, User

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    payload = {"sub": str(user.id), "username": user.username, "role": user.role,
               "exp": datetime.utcnow() + timedelta(minutes=settings.access_token_minutes)}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def get_current_user(token: str | None = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다.")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "토큰이 유효하지 않습니다.")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "사용자를 찾을 수 없습니다.")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "관리자 권한이 필요합니다.")
    return user


def get_project_for(db: Session, project_id: int, user: User, need: str = "view") -> Project:
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "공사를 찾을 수 없습니다.")
    if user.role == "admin" or p.created_by == user.id:
        return p
    m = db.query(ProjectMember).filter_by(project_id=project_id, user_id=user.id).first()
    if not m:
        raise HTTPException(403, "이 공사에 대한 접근 권한이 없습니다.")
    order = {"view": 0, "edit": 1, "approve": 2}
    if order.get(m.access, 0) < order.get(need, 0):
        raise HTTPException(403, f"'{need}' 권한이 필요합니다.")
    return p


def audit(db: Session, user: User | None, action: str, project_id: int | None = None, target: str = "",
          before=None, after=None, reason: str = ""):
    db.add(AuditLog(project_id=project_id, user_id=user.id if user else None, action=action, target=target,
                    before=before, after=after, reason=reason))


def ensure_admin_user(db: Session):
    if not db.query(User).filter_by(username=settings.admin_username).first():
        db.add(User(username=settings.admin_username, password_hash=hash_password(settings.admin_password),
                    display_name="관리자", role="admin"))
        db.commit()
