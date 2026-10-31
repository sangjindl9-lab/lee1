import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://gw:gwpass@localhost/groupware_test")
os.environ["FILE_STORAGE_DIR"] = tempfile.mkdtemp(prefix="gw-files-")
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session", autouse=True)
def fresh_db():
    import sqlalchemy as sa
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    with eng.begin() as c:
        c.execute(sa.text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    eng.dispose()
    env = {**os.environ}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT, env=env, check=True, capture_output=True)
    env["INIT_ADMIN_PASSWORD"] = "Admin1234!"
    subprocess.run([sys.executable, "-m", "app.cli", "init", "--company", "테스트전기(주)", "--no-force-change"],
                   cwd=ROOT, env=env, check=True, capture_output=True)
    yield


class Client:
    """세션 쿠키 + CSRF 헤더를 자동 처리하는 테스트 클라이언트."""

    def __init__(self):
        from fastapi.testclient import TestClient
        from app.main import app
        self.c = TestClient(app)
        self.csrf = ""

    def login(self, login_id, pw):
        r = self.c.post("/api/auth/login", json={"login_id": login_id, "password": pw})
        assert r.status_code == 200, r.text
        self.csrf = r.json()["csrf"]
        return self

    def _h(self, kw):
        h = kw.pop("headers", {}) or {}
        h.setdefault("X-CSRF-Token", self.csrf)
        return h

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, **kw):
        return self.c.post(url, headers=self._h(kw), **kw)

    def put(self, url, **kw):
        return self.c.put(url, headers=self._h(kw), **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers=self._h(kw), **kw)


@pytest.fixture
def client_factory():
    return Client


def ok(r, code=200):
    assert r.status_code == code, f"{r.status_code} {r.text}"
    return r.json() if r.headers.get("content-type", "").startswith("application/json") else r
