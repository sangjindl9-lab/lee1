"""환경변수 기반 설정. 비밀키·DB 접속정보는 코드에 넣지 않는다."""
import os
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
BASE_DIR = Path(__file__).resolve().parent.parent

try:  # 개발 편의: backend/.env 자동 로드 (운영에서는 실제 환경변수 사용 권장)
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env", override=False)
except ImportError:
    pass


def _env(name: str, default: str | None = None, required: bool = False) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        raise RuntimeError(f"환경변수 {name} 이(가) 설정되지 않았습니다. .env.example 을 참고하세요.")
    return v  # type: ignore[return-value]


class Settings:
    def __init__(self) -> None:
        url = _env("DATABASE_URL", required=True)
        # Render 등은 postgres:// 또는 postgresql:// 형식으로 준다 → psycopg3 드라이버 지정
        for pre in ("postgres://", "postgresql://"):
            if url.startswith(pre):
                url = "postgresql+psycopg://" + url[len(pre):]
        # DB_NAME 이 있으면 같은 Postgres 서버 안의 별도 데이터베이스를 사용 (기존 유료 DB 공유 시)
        db_name = _env("DB_NAME")
        if db_name:
            url = url.rsplit("/", 1)[0] + "/" + db_name if "?" not in url else url.rsplit("/", 1)[0] + "/" + db_name + "?" + url.split("?", 1)[1]
        self.database_url = url
        self.file_storage_mode = _env("FILE_STORAGE_MODE", "disk")  # disk | db
        self.file_storage_dir = Path(_env("FILE_STORAGE_DIR", str(BASE_DIR / "storage")))
        self.max_upload_mb = int(_env("MAX_UPLOAD_MB", "30"))
        self.session_hours = int(_env("SESSION_HOURS", "12"))
        self.cookie_secure = _env("COOKIE_SECURE", "false").lower() == "true"
        self.env = _env("APP_ENV", "development")
        self.frontend_dir = Path(_env("FRONTEND_DIR", str(BASE_DIR.parent / "frontend")))
        self.pdf_font_family = _env("PDF_FONT_FAMILY", "Noto Sans CJK KR, NanumGothic, Malgun Gothic, sans-serif")


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
