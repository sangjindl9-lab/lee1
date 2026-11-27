import os
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()
_url = _settings.db_url
_kwargs: dict = {"pool_pre_ping": True}
if _url.startswith("sqlite"):
    os.makedirs("data", exist_ok=True)
    _kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
engine = create_engine(_url, **_kwargs)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """개발·테스트용 테이블 생성. 운영은 alembic upgrade head 를 사용한다."""
    from . import models  # noqa: F401

    Base.metadata.create_all(engine)
