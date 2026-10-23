"""JWT 로그인 + 역할 기반 권한 + 회사별 데이터 접근 통제."""
from datetime import datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AuditLog, Project, Role, User

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
ALGO = "HS256"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "cid": user.company_id,
        "role": user.role.value,
        "exp": datetime.utcnow() + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGO)


def current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    cred_exc = HTTPException(status.HTTP_401_UNAUTHORIZED, "인증이 필요합니다.")
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=[ALGO])
        uid = int(data["sub"])
    except (JWTError, KeyError, ValueError):
        raise cred_exc
    user = db.get(User, uid)
    if not user or not user.is_active:
        raise cred_exc
    return user


def require_role(*roles: Role):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role == Role.superadmin or user.role in roles:
            return user
        raise HTTPException(status.HTTP_403_FORBIDDEN, "권한이 없습니다.")
    return dep


EDIT_ROLES = (Role.company_admin, Role.estimator)
REVIEW_ROLES = (Role.company_admin, Role.estimator, Role.reviewer)


def get_project_or_403(db: Session, user: User, project_id: int) -> Project:
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "프로젝트가 없습니다.")
    if user.role != Role.superadmin and p.company_id != user.company_id:
        raise HTTPException(403, "다른 회사의 프로젝트입니다.")
    return p


def audit(db: Session, user: User | None, action: str, project_id: int | None = None, **detail):
    db.add(AuditLog(company_id=user.company_id if user else None, user_id=user.id if user else None,
                    project_id=project_id, action=action, detail=detail))
