from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_ph = PasswordHasher()  # argon2id, 라이브러리 권장 기본값

# 타이밍으로 계정 존재 여부가 드러나지 않도록, 없는 계정에도 같은 비용의 검증을 수행
_DUMMY_HASH = _ph.hash("nvr-dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _ph.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


def validate_password_policy(password: str, username: str = "") -> str | None:
    """정책 위반 시 사유(한국어) 반환."""
    if len(password) < 10:
        return "비밀번호는 10자 이상이어야 합니다."
    classes = sum(
        [
            any(c.islower() for c in password),
            any(c.isupper() for c in password),
            any(c.isdigit() for c in password),
            any(not c.isalnum() for c in password),
        ]
    )
    if classes < 3:
        return "영문 대문자·소문자·숫자·특수문자 중 3종류 이상을 사용하세요."
    if username and username.lower() in password.lower():
        return "비밀번호에 사용자 ID를 포함할 수 없습니다."
    return None
