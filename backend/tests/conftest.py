import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TEST_DIR = Path(__file__).parent / "_tmp"
TEST_DIR.mkdir(exist_ok=True)
os.environ["KET_DATABASE_URL"] = f"sqlite:///{TEST_DIR / 'test.db'}"
os.environ["KET_STORAGE_DIR"] = str(TEST_DIR / "storage")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.db import Base, engine  # noqa: E402
from tests import make_drawings as md  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def fixtures():
    FIX.mkdir(exist_ok=True)
    md.make_cctv_plan(FIX / "test_cctv_plan.dxf")
    md.make_cctv_plan(FIX / "test_cctv_plan_dup.dxf", with_duplicate=True)
    md.make_cctv_riser(FIX / "test_cctv_riser.dxf")
    md.make_scanned_pdf(FIX / "test_scanned_noscale.pdf")
    md.make_vector_pdf(FIX / "test_vector.pdf")
    return FIX


@pytest.fixture(scope="session")
def client():
    if (TEST_DIR / "test.db").exists():
        (TEST_DIR / "test.db").unlink()
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client):
    r = client.post("/api/auth/register", json={"company_name": "테스트전력", "email": "tester@example.com", "name": "테스터", "password": "password123"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def wait_done(client, auth, pid, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        files = client.get(f"/api/projects/{pid}/files", headers=auth).json()
        if files and all(f["status"] in ("done", "failed", "needs_converter") for f in files):
            return files
        time.sleep(0.5)
    raise TimeoutError("file processing timeout")
