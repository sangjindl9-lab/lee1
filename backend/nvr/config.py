"""환경변수 기반 설정. 인증정보는 코드에 두지 않고 파일(Docker secret) 또는 환경변수로만 받는다."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NVR_", env_file=None, extra="ignore")

    # DB: 비밀번호는 NVR_DATABASE_PASSWORD_FILE 로 분리 가능
    database_url: str = "postgresql+psycopg://nvr@db:5432/nvr"
    database_password_file: str | None = None

    # 마스터 키(32바이트, base64) 파일 경로 — 카메라 비밀번호 암호화·토큰 서명용 키를 여기서 파생
    master_key_file: str = "/run/secrets/nvr_master_key"

    recordings_dir: Path = Path("/recordings")
    exports_dir: Path = Path("/exports")
    mediamtx_config_path: Path = Path("/mediamtx-config/mediamtx.yml")
    mediamtx_base_config_path: Path = Path("/app/deploy/mediamtx/mediamtx.base.yml")
    mediamtx_auth_url: str = "http://api:8000/internal/mediamtx/auth"

    # WebRTC 후보 주소(서버 LAN IP, 공인 IP/도메인) — 쉼표 구분
    public_hosts: str = ""
    webrtc_tcp: bool = False
    # "auto" = WebRTC 우선·HLS 대체, "hls" = UDP 를 못 쓰는 호스팅(클라우드 데모 등)에서 HLS 만 사용
    live_mode: str = "auto"

    # 여러 현장 통합: 이 서버가 현장(Edge)이면 중앙 서버 주소와 Edge 토큰 파일
    central_url: str = ""
    central_token_file: str = ""
    # ONVIF 자동 탐색: host 네트워크로 도는 탐색 서비스 주소(비우면 이 프로세스에서 직접 탐색)
    discovery_url: str = ""
    stun_servers: str = ""

    cookie_secure: bool = True
    session_idle_minutes: int = 60
    session_absolute_hours: int = 12
    live_token_seconds: int = 600

    login_max_fail_user: int = 5
    login_max_fail_ip: int = 20
    login_window_minutes: int = 15

    # 항상 차단할 추가 네트워크(쉼표 구분). NVR 내부 Docker 망을 넣는다.
    deny_networks: str = ""
    # 프록시(caddy) 주소 — 이 주소에서 온 요청만 X-Forwarded-For 를 신뢰
    trusted_proxies: str = ""

    segment_seconds: int = 60
    event_segment_seconds: int = 10
    event_buffer_max_seconds: int = 120
    event_max_minutes: int = 30
    default_retention_days: int = 30
    min_free_percent: float = 10.0
    min_free_gb: float = 5.0
    # recorder 는 남은 공간이 이보다 적으면 새 녹화 프로세스를 시작하지 않는다(보관 정리 대기)
    recorder_min_free_mb: int = 512
    export_ttl_hours: int = 24
    export_max_minutes: int = 240
    watermark_font: str = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    log_level: str = "INFO"

    @property
    def incoming_dir(self) -> Path:
        # 같은 파일시스템이어야 rename 이 원자적이다
        return self.recordings_dir / ".incoming"

    def sqlalchemy_url(self) -> str:
        url = self.database_url
        if self.database_password_file and os.path.exists(self.database_password_file):
            from sqlalchemy.engine import make_url

            pw = Path(self.database_password_file).read_text(encoding="utf-8").strip()
            return make_url(url).set(password=pw).render_as_string(hide_password=False)
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()


class KeyMaterial:
    """마스터 키에서 용도별 키를 HMAC(HKDF 단순형)으로 파생한다."""

    def __init__(self, master: bytes):
        if len(master) < 32:
            raise ValueError("마스터 키는 32바이트 이상이어야 합니다")
        self._master = master

    def derive(self, purpose: str) -> bytes:
        return hmac.new(self._master, f"nvr:{purpose}:v1".encode(), hashlib.sha256).digest()

    @property
    def fernet_key(self) -> bytes:
        return base64.urlsafe_b64encode(self.derive("camera-credentials"))

    @property
    def token_key(self) -> bytes:
        return self.derive("media-token")

    @property
    def discovery_key(self) -> str:
        return base64.urlsafe_b64encode(self.derive("discovery-service")).decode().rstrip("=")

    @property
    def mediamtx_hook_key(self) -> str:
        return base64.urlsafe_b64encode(self.derive("mediamtx-hook")).decode().rstrip("=")


@lru_cache
def get_keys() -> KeyMaterial:
    s = get_settings()
    path = Path(s.master_key_file)
    if not path.exists():
        raise RuntimeError(
            f"마스터 키 파일이 없습니다: {path}. scripts/init-secrets.sh 로 생성하세요."
        )
    raw = path.read_text(encoding="utf-8").strip()
    try:
        master = base64.b64decode(raw, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("마스터 키 형식 오류(base64 32바이트)") from exc
    return KeyMaterial(master)
