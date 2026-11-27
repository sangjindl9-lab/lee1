import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet

from .config import get_settings

_s = get_settings()


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def make_token(payload: dict, hours: float | None = None) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=hours or _s.token_hours)
    return jwt.encode({**payload, "exp": exp}, _s.secret_key, algorithm="HS256")


def read_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, _s.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _fernet() -> Fernet:
    key = _s.encryption_key
    if not key:
        key = base64.urlsafe_b64encode(hashlib.sha256(_s.secret_key.encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt_json(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt_json(token: str) -> dict:
    if not token:
        return {}
    return json.loads(_fernet().decrypt(token.encode()).decode())


def mask(value: str) -> str:
    """API 키를 화면·로그에 그대로 노출하지 않기 위한 마스킹."""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return value[:3] + "*" * 6 + value[-3:]
