"""원본 양식 그대로 출력: 수정·추가·삭제가 원본 엑셀의 해당 셀에만 반영되고 수식/소계가 보정되는지."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

import openpyxl
import pytest

ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / "data" / "test_ev"
if TMP.exists():
    shutil.rmtree(TMP)
TMP.mkdir(parents=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "files")
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

CHILGOK = ROOT.parent / "samples" / "착공내역서_칠곡종합운동장_실내테니스장_조성사업_소방내역서.xlsm"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        r = c.post("/api/auth/login", data={"username": "admin", "password": "admin1234"})
        c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        yield c


def test_export_original_with_edits(client):
    pid = client.post("/api/projects", json={"name": "원본양식 출력 테스트"}).json()["id"]
    with open(CHILGOK, "rb") as fh:
        fid = client.post(f"/api/projects/{pid}/files", files={"file": (CHILGOK.name, fh, "application/octet-stream")}, data={"sync": "true"}).json()["id"]
    vid = client.post(f"/api/files/{fid}/import", json={}).json()["version_id"]
    items = [i for i in client.get(f"/api/versions/{vid}/items").json()["items"] if i["row_type"] == "item" and i["sheet"] == "내역서"]
    a, b, c_, d = items[0], items[1], items[2], items[3]
    # 수정: 수량, 단가, 규격
    assert client.put(f"/api/versions/{vid}/items/{a['uid']}", json={"qty": 999, "reason": "t"}).status_code == 200
    assert client.put(f"/api/versions/{vid}/items/{b['uid']}", json={"mat_price": 1234, "spec": "CD-난연성 22㎜(변경)", "reason": "t"}).status_code == 200
    # 추가: b 아래
    r = client.post(f"/api/versions/{vid}/items", json={"after_uid": b["uid"], "name": "추가전선관", "spec": "HI 28", "unit": "M", "qty": 10, "mat_price": 100, "lab_price": 200, "exp_price": 0})
    assert r.status_code == 200, r.text
    # 삭제: d
    assert client.delete(f"/api/versions/{vid}/items/{d['uid']}").status_code == 200
    r = client.get(f"/api/versions/{vid}/export")
    assert r.status_code == 200, r.text
    assert r.headers["X-Export-Stats"] == "modified=2;added=1;deleted=1"
    out = TMP / "out.xlsm"
    out.write_bytes(r.content)
    wb = openpyxl.load_workbook(out, keep_vba=True)
    assert wb.sheetnames == openpyxl.load_workbook(CHILGOK, read_only=True).sheetnames   # 시트 구성 동일
    ws = wb["내역서"]
    assert ws["G5"].value == 999                      # a 수량 (원본 수식 → 값)
    assert ws["H6"].value == 1234 and ws["E6"].value == "CD-난연성 22㎜(변경)"
    assert ws["D7"].value == "추가전선관" and ws["G7"].value == 10 and ws["H7"].value == 100 and ws["K7"].value == 200
    assert ws["I7"].value == "=TRUNC(G7*H7)" and ws["P7"].value == "=SUM(I7,L7,N7)"   # 금액 수식 복사
    assert ws["D8"].value == c_["name"]               # 기존 3번째 품목이 한 칸 아래로
    assert ws["I8"].value == "=TRUNC(G8*H8)"          # 밀린 행의 수식 행번호 보정
    # 삭제 품목(d: 원래 8행 → 9행)은 행 유지, 수량 0
    assert ws["D9"].value == d["name"] and ws["G9"].value == 0
    # 소계 범위 확장: 원본 I53=SUM(I5:I52) → 행 삽입 후 SUM(I5:I53), 위치 54행
    assert ws["I54"].value == "=TRUNC(SUM(I4:I53))", ws["I54"].value
    # 다른 시트의 참조도 보정: 총괄표 '=총괄표!I45' 등은 그대로, 내역서 참조는 +1
    # 병합 셀/열 너비 보존
    assert ws.column_dimensions["D"].width == openpyxl.load_workbook(CHILGOK)["내역서"].column_dimensions["D"].width
    # LibreOffice 재계산: 수식 오류 없음, 소계 = 품목 합
    if shutil.which("soffice"):
        subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", str(TMP / "rc"), str(out)], check=True, timeout=180, capture_output=True)
        wv = openpyxl.load_workbook(TMP / "rc" / "out.xlsx", data_only=True)["내역서"]
        assert wv["I5"].value == 999 * 150
        assert wv["I7"].value == 1000 and wv["L7"].value == 2000
        total = sum((wv.cell(r, 9).value or 0) for r in range(4, 54) if isinstance(wv.cell(r, 9).value, (int, float)))
        assert wv["I54"].value == total
        errs = [c.coordinate for row in wv.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("#")]
        assert errs == [], errs
