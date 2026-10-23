from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "공사내역서 재가공 시스템"
    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{Path(__file__).resolve().parent.parent / 'data' / 'app.db'}")
    secret_key: str = os.getenv("SECRET_KEY", "change-me-in-production")
    access_token_minutes: int = int(os.getenv("ACCESS_TOKEN_MINUTES", "720"))
    storage_dir: Path = Path(os.getenv("STORAGE_DIR", str(Path(__file__).resolve().parent.parent / "data" / "files")))
    admin_username: str = os.getenv("ADMIN_USERNAME", "admin")
    admin_password: str = os.getenv("ADMIN_PASSWORD", "admin1234")
    cors_origins: str = os.getenv("CORS_ORIGINS", "*")
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "100"))

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
# Railway/Heroku 식 postgres:// 보정
if settings.database_url.startswith("postgres://"):
    settings.database_url = settings.database_url.replace("postgres://", "postgresql://", 1)
# SQLAlchemy 2.1 은 postgresql:// 기본 드라이버가 psycopg(v3) 이므로 psycopg2 를 명시
if settings.database_url.startswith("postgresql://"):
    settings.database_url = settings.database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
settings.storage_dir.mkdir(parents=True, exist_ok=True)
if settings.database_url.startswith("sqlite"):
    Path(settings.database_url.split("///")[-1]).parent.mkdir(parents=True, exist_ok=True)
