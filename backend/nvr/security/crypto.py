"""카메라 인증정보 암호화와 미디어 토큰 서명."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from ..config import get_keys


def _fernet() -> Fernet:
    return Fernet(get_keys().fernet_key)


def encrypt_secret(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("카메라 인증정보를 복호화할 수 없습니다(마스터 키 불일치)") from exc


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_media_token(payload: dict[str, Any], ttl_seconds: int) -> tuple[str, int]:
    """HMAC-SHA256 서명 토큰(`body.sig`). 만료 시각(epoch)을 함께 반환."""
    exp = int(time.time()) + ttl_seconds
    body = dict(payload, exp=exp, n=secrets.token_hex(4))
    raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(get_keys().token_key, raw, hashlib.sha256).digest()
    return f"{_b64(raw)}.{_b64(sig)}", exp


def verify_media_token(token: str) -> dict[str, Any] | None:
    try:
        body_b64, sig_b64 = token.split(".", 1)
        raw = _unb64(body_b64)
        sig = _unb64(sig_b64)
    except Exception:  # noqa: BLE001
        return None
    expect = hmac.new(get_keys().token_key, raw, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        body = json.loads(raw)
    except ValueError:
        return None
    if int(body.get("exp", 0)) < int(time.time()):
        return None
    return body
