"""운영 설정(DB system_settings). 환경변수 값이 기본값."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .config import get_settings
from .models import SystemSetting


def defaults() -> dict[str, Any]:
    s = get_settings()
    return {
        "default_retention_days": s.default_retention_days,
        "min_free_percent": s.min_free_percent,
        "min_free_gb": s.min_free_gb,
        "export_ttl_hours": s.export_ttl_hours,
    }


def get_all(db: Session) -> dict[str, Any]:
    out = defaults()
    for row in db.query(SystemSetting).all():
        if row.key in out:
            out[row.key] = row.value
    return out


def set_value(db: Session, key: str, value: Any) -> None:
    row = db.get(SystemSetting, key)
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value))
