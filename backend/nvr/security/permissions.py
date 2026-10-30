"""역할·기능 권한."""
from __future__ import annotations

ROLES = {
    "superadmin": "최고관리자",
    "site_admin": "현장관리자",
    "operator": "관제요원",
    "viewer": "조회전용",
}

PERMISSIONS = {
    "live_view": "실시간 보기",
    "playback": "녹화 재생",
    "download": "영상 다운로드",
    "ptz": "PTZ 제어",
    "audio": "음성 사용",
    "settings": "설정 변경",
    "delete_recordings": "녹화 삭제",
}

ROLE_DEFAULTS: dict[str, set[str]] = {
    "superadmin": set(PERMISSIONS),
    "site_admin": {"live_view", "playback", "download", "ptz", "audio", "settings", "delete_recordings"},
    "operator": {"live_view", "playback", "download", "ptz", "audio"},
    "viewer": {"live_view", "playback"},
}


def effective_permissions(role: str, override: dict[str, bool] | None) -> set[str]:
    perms = set(ROLE_DEFAULTS.get(role, set()))
    if role == "superadmin":
        return perms
    for k, v in (override or {}).items():
        if k not in PERMISSIONS:
            continue
        if v:
            perms.add(k)
        else:
            perms.discard(k)
    return perms
