"""환경설정. 모든 값은 환경변수(.env)로 덮어쓸 수 있다."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "SHORTS FACTORY AI"
    database_url: str = "sqlite:///./data/dev.db"
    redis_url: str = ""
    # inline: API 프로세스 안의 백그라운드 스레드에서 실행 (단일 서버·개발용)
    # celery: Redis 큐 + 분리된 워커에서 실행 (운영 권장)
    task_mode: str = "inline"

    secret_key: str = "change-me-in-production"
    encryption_key: str = ""  # Fernet 키(없으면 secret_key에서 유도)
    token_hours: int = 24 * 7

    storage_backend: str = "local"  # local | s3
    storage_dir: str = "./data/storage"
    work_dir: str = "./data/work"
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_region: str = "auto"

    public_base_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:3000"
    cors_origins: str = "*"

    admin_username: str = "admin"
    admin_password: str = ""  # 환경변수 ADMIN_PASSWORD 로만 지정(저장소에 비밀번호를 두지 않는다)
    allow_signup: bool = True

    google_client_id: str = ""
    google_client_secret: str = ""

    default_max_cost_usd: float = 3.0
    default_daily_cost_limit_usd: float = 20.0
    default_monthly_cost_limit_usd: float = 200.0
    default_daily_video_limit: int = 20
    youtube_quota_per_project: int = 900
    max_regen_rounds: int = 2
    quality_pass_score: int = 90
    lock_ttl_seconds: int = 900

    subtitle_font: str = "Noto Sans CJK KR"

    @property
    def db_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
