from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from .models import AuditLog

log = logging.getLogger("nvr.audit")


def audit(db: Session, *, action: str, user=None, username: str = "", ip: str = "", target_type: str = "",
          target_id: Any = "", result: str = "ok", details: dict[str, Any] | None = None, commit: bool = False) -> None:
    """감사로그 기록. 비밀번호 등 민감 값은 details 에 넣지 않는다(호출부 책임 + 키 이름 필터)."""
    clean = {k: v for k, v in (details or {}).items() if "password" not in k.lower() and "secret" not in k.lower()}
    db.add(AuditLog(
        user_id=getattr(user, "id", None),
        username=getattr(user, "username", "") or username,
        ip=ip,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else "",
        result=result,
        details=clean,
    ))
    if commit:
        db.commit()
