"""애플리케이션 설정 — 환경변수(.env)로 재정의 가능."""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_prefix="KET_", extra="ignore")

    app_name: str = "K-ElecTakeoff AI"
    # 기본 SQLite(개발/소규모). 운영은 postgresql+psycopg://user:pw@host/db 로 교체.
    database_url: str = f"sqlite:///{BASE_DIR / 'storage' / 'ket.db'}"
    secret_key: str = "change-me-in-production-please-32bytes-min"
    access_token_minutes: int = 60 * 12
    storage_dir: Path = BASE_DIR / "storage"
    max_upload_mb: int = 200
    allowed_extensions: tuple[str, ...] = (".dwg", ".dxf", ".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".xls")
    # DWG→DXF 변환기 명령. 예: ODA File Converter 경로. 비어 있으면 DWG는 '변환기 미설정'으로 보고.
    dwg_converter_cmd: str = ""
    # 외부 AI(멀티모달) API 키 — 서버에만 보관, 브라우저 노출 금지. 비어 있으면 AI 보조 분석 비활성.
    anthropic_api_key: str = ""
    # 작업 큐: "thread"(기본, 단일 서버) | "celery"(Redis 필요)
    job_backend: str = "thread"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]

    @property
    def originals_dir(self) -> Path:
        return self.storage_dir / "originals"

    @property
    def processed_dir(self) -> Path:
        return self.storage_dir / "processed"


settings = Settings()
settings.originals_dir.mkdir(parents=True, exist_ok=True)
settings.processed_dir.mkdir(parents=True, exist_ok=True)
