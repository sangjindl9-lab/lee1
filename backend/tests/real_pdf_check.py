"""실제 도면 PDF 로 API 전체 흐름 점검 (업로드 → 범례 자동 → 승인 → 산출). 결과를 요약 출력."""
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TEST_DIR = Path("/tmp/aa/api")
TEST_DIR.mkdir(parents=True, exist_ok=True)
os.environ["KET_DATABASE_URL"] = f"sqlite:///{TEST_DIR / 'test.db'}"
os.environ["KET_STORAGE_DIR"] = str(TEST_DIR / "storage")
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.db import Base, engine  # noqa: E402

pdf = Path(sys.argv[1])
if (TEST_DIR / "test.db").exists():
    (TEST_DIR / "test.db").unlink()
Base.metadata.create_all(engine)
with TestClient(app) as c:
    tok = c.post("/api/auth/register", json={"company_name": "실도면", "email": "r@example.com", "name": "r", "password": "password123"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    pid = c.post("/api/projects", headers=h, json={"name": "실도면 점검"}).json()["id"]
    t0 = time.time()
    c.post(f"/api/projects/{pid}/files", headers=h, files=[("files", (pdf.name, pdf.read_bytes(), "application/pdf"))])
    while True:
        files = c.get(f"/api/projects/{pid}/files", headers=h).json()
        if all(f["status"] in ("done", "failed", "needs_converter") for f in files):
            break
        time.sleep(2)
    f = files[0]
    print("FILE", f["status"], f["error"], "%.0fs" % (time.time() - t0))
    for s in f["sheets"]:
        print("  SHEET", s["page_no"], s["drawing_no"], s["drawing_title"], s["drawing_type"], s["discipline"], s["source_kind"], "scale", s["scale_factor"], s["scale_confirmed"])
    for w in f["warnings"][:12]:
        print("  WARN", w)
    t0 = time.time()
    r = c.post(f"/api/projects/{pid}/legends/auto", headers=h).json()
    print("LEGEND tables", len(r["created"]), "%.0fs" % (time.time() - t0))
    for t in c.get(f"/api/projects/{pid}/legends", headers=h).json():
        print(" TABLE", t["title"], "sheet", t["sheet_id"], len(t["symbols"]))
        for s in t["symbols"]:
            print("   ", s["row_no"], s["item_name"], "|", s["category"], s["layer_hint"], s["status"], (s["fingerprint"] or {}).get("dash"))
    c.post(f"/api/projects/{pid}/legends/approve-all", headers=h)
    # 축척 확정: 1/400 (A3 기준) → 1pt = 25.4/72 mm × 400
    for s in f["sheets"]:
        if s["drawing_type"] == "평면도" or (s["drawing_title"] or "").find("평면") >= 0:
            c.post(f"/api/projects/{pid}/sheets/{s['id']}/scale", headers=h, json={"scale_factor": 25.4 / 72 / 1000 * 400})
    t0 = time.time()
    r = c.post(f"/api/projects/{pid}/takeoff/run", headers=h).json()
    print("RUN", r, "%.0fs" % (time.time() - t0))
    for q in c.get(f"/api/projects/{pid}/takeoff/items", headers=h).json():
        print("  ITEM", q["item_name"], "|", q["spec"], q["unit"], q["qty_total"], q["status"], q["drawing_nos"], (q["formula"] or "")[:60])
    for i in c.get(f"/api/projects/{pid}/takeoff/issues", headers=h).json()[:8]:
        print("  ISSUE", i["code"], i["message"][:80])
