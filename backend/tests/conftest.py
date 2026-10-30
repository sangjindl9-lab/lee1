"""자동화 시험 공통 설정.

필요: 비어 있어도 되는 시험용 PostgreSQL DB (NVR_TEST_DATABASE_URL). 시험마다 스키마를 새로 만든다.
  예) NVR_TEST_DATABASE_URL=postgresql+psycopg://nvr:pw@127.0.0.1:5432/nvr_test pytest -q
"""
from __future__ import annotations

import base64
import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_tmp = Path(tempfile.mkdtemp(prefix="nvr-test-"))
(_tmp / "rec").mkdir()
(_tmp / "exp").mkdir()
(_tmp / "master.key").write_text(base64.b64encode(os.urandom(32)).decode())
os.environ["NVR_DATABASE_URL"] = os.environ.get("NVR_TEST_DATABASE_URL", "postgresql+psycopg://nvr@127.0.0.1:5432/nvr_test")
os.environ.pop("NVR_DATABASE_PASSWORD_FILE", None)
os.environ["NVR_MASTER_KEY_FILE"] = str(_tmp / "master.key")
os.environ["NVR_RECORDINGS_DIR"] = str(_tmp / "rec")
os.environ["NVR_EXPORTS_DIR"] = str(_tmp / "exp")
os.environ["NVR_COOKIE_SECURE"] = "false"
os.environ["NVR_MIN_FREE_PERCENT"] = "1"
os.environ["NVR_MIN_FREE_GB"] = "1"
os.environ["NVR_MEDIAMTX_BASE_CONFIG_PATH"] = str(ROOT.parent / "deploy/mediamtx/mediamtx.base.yml")
os.environ["NVR_MEDIAMTX_CONFIG_PATH"] = str(_tmp / "mediamtx.yml")

ADMIN_PW = "Test#Admin-2026x"


@pytest.fixture(scope="session", autouse=True)
def schema():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text

    eng = create_engine(os.environ["NVR_DATABASE_URL"])
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    eng.dispose()
    cfg = Config(str(ROOT / "alembic.ini"))
    command.upgrade(cfg, "head")
    from nvr.db import session_scope
    from nvr.models import User
    from nvr.security.passwords import hash_password

    with session_scope() as db:
        db.add(User(username="admin", display_name="관리자", role="superadmin", password_hash=hash_password(ADMIN_PW)))
    yield


@pytest.fixture(scope="session")
def tmpdir_root() -> Path:
    return _tmp


class Client:
    def __init__(self, tc):
        self.tc = tc
        self.csrf = ""

    def login(self, u, p):
        r = self.tc.post("/api/auth/login", json={"username": u, "password": p})
        if r.status_code == 200:
            self.csrf = r.json()["csrf_token"]
        return r

    def req(self, method, path, **kw):
        h = kw.pop("headers", {})
        h.setdefault("X-CSRF-Token", self.csrf)
        return self.tc.request(method, path, headers=h, **kw)


@pytest.fixture()
def make_client():
    from fastapi.testclient import TestClient

    from nvr.api.main import app

    def _make():
        return Client(TestClient(app, client=("10.1.1.1", 5000)))

    return _make


@pytest.fixture()
def admin(make_client):
    c = make_client()
    assert c.login("admin", ADMIN_PW).status_code == 200
    return c
