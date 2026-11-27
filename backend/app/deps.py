from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import read_token


def current_user(request: Request, token: str | None = Query(None), db: Session = Depends(get_db)) -> User:
    auth = request.headers.get("Authorization", "")
    raw = auth[7:] if auth.startswith("Bearer ") else token  # SSE·다운로드는 ?token= 사용
    data = read_token(raw) if raw else None
    user = db.get(User, data["uid"]) if data and data.get("uid") else None
    if not user or not user.is_active:
        raise HTTPException(401, "로그인이 필요합니다.")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "관리자 권한이 필요합니다.")
    return user
