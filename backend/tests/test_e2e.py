"""엔드투엔드: 업로드 → 분석 → 가져오기 → 1차 기성 → 확정 → 2차 기성(전회 반영) → 설계변경 → 승인 → 3차 기성 잔량 → 엑셀 출력."""
from __future__ import annotations

import os
import sys
from decimal import Decimal
from pathlib import Path

import openpyxl
import pytest

ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / "data" / "test"
TMP.mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "files")
for f in (TMP / "test.db",):
    if f.exists():
        f.unlink()
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

SAMPLES = ROOT.parent / "samples"
GANGNEUNG = SAMPLES / "강릉_통합공공임대주택_건립사업_전기_내역서.xlsx"
CHILGOK = SAMPLES / "착공내역서_칠곡종합운동장_실내테니스장_조성사업_소방내역서.xlsm"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        r = c.post("/api/auth/login", data={"username": "admin", "password": "admin1234"})
        assert r.status_code == 200, r.text
        c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        yield c


def test_full_flow(client):
    # 공사 등록
    r = client.post("/api/projects", json={"name": "칠곡 실내테니스장 소방(테스트)", "client": "칠곡군", "work_type": "소방"})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]

    # 업로드 + 동기 분석
    with open(CHILGOK, "rb") as fh:
        r = client.post(f"/api/projects/{pid}/files", files={"file": (CHILGOK.name, fh, "application/octet-stream")},
                        data={"purpose": "contract", "sync": "true"})
    assert r.status_code == 200, r.text
    fo = r.json()
    fid = fo["id"]
    assert fo["status"] == "analyzed"
    assert fo["summary"]["estimate_sheets"] == ["내역서", "내역서 (2)"]
    assert fo["summary"]["has_cost_sheet"] and fo["summary"]["has_unit_price"]
    assert fo["summary"]["grand_totals"]["mat_amt"] == "98821566"

    a = client.get(f"/api/files/{fid}/analysis").json()
    assert any(c["field"] == "mat_amt" and c["ok"] for c in a["cost_compare"])
    roles = {x["sheet"]: x["role"] for x in a["roles"]}
    assert roles["원가"] == "cost_sheet" and roles["일위대가"] == "unit_price"

    # 미리보기
    pv = client.get(f"/api/files/{fid}/preview", params={"sheet": "내역서", "rows": 8}).json()
    assert pv["rows"][1][3] == "명   칭"

    # 가져오기
    r = client.post(f"/api/files/{fid}/import", json={"label": "최초계약"})
    assert r.status_code == 200, r.text
    vid = r.json()["version_id"]
    assert r.json()["item_count"] == 268
    assert Decimal(r.json()["totals"]["tot_amt"]) == Decimal("199123603")

    items = client.get(f"/api/versions/{vid}/items").json()["items"]
    item_rows = [i for i in items if i["row_type"] == "item"]
    first = item_rows[0]
    assert first["name"] == "합성수지제 가요전선관" and first["section_path"][0] == "내역서"
    assert first["price_source"]["mat_price"].startswith("합산자재")

    # 원가 비목
    rules = client.get(f"/api/projects/{pid}/cost-rules").json()
    names = [r_["name"].replace(" ", "") for r_ in rules]
    assert "간접노무비" in names
    assert next(r_ for r_ in rules if r_["name"].replace(" ", "") == "간접노무비")["rate"].startswith("15.2")

    # 일위대가
    ups = client.get(f"/api/projects/{pid}/unit-prices").json()
    assert len(ups) > 10

    # ---- 1차 기성
    r = client.post(f"/api/projects/{pid}/claims", json={"base_date": "2026-01-31"})
    assert r.status_code == 200, r.text
    c1 = r.json()["id"]
    uid = first["uid"]
    qty = Decimal(first["qty"])
    assert qty > 0
    r = client.put(f"/api/claims/{c1}/inputs", json={"inputs": {uid: {"this_qty": "30"}, item_rows[1]["uid"]: {"rate": "50"}}})
    assert r.status_code == 200, r.text
    d = r.json()
    l0 = next(l for l in d["lines"] if l["uid"] == uid)
    assert Decimal(l0["this_qty"]) == 30
    # 금액 = TRUNC(30 × 단가)
    exp_mat = (Decimal("30") * Decimal(first["mat_price"])).to_integral_value(rounding="ROUND_DOWN")
    assert Decimal(l0["this_mat_amt"]) == exp_mat
    assert Decimal(l0["remain_qty"]) == qty - 30
    l1 = next(l for l in d["lines"] if l["uid"] == item_rows[1]["uid"])
    assert Decimal(l1["rate"]) == Decimal("50") or abs(Decimal(l1["cum_qty"]) - Decimal(item_rows[1]["qty"]) / 2) < Decimal("0.001")

    # 초과 입력 → 경고 → 확정 거부
    r = client.put(f"/api/claims/{c1}/inputs", json={"inputs": {item_rows[2]["uid"]: {"this_qty": str(Decimal(item_rows[2]["qty"]) + 1)}}})
    assert r.json()["summary"]["warning_count"] >= 1
    r = client.post(f"/api/claims/{c1}/confirm")
    assert r.status_code == 400
    client.put(f"/api/claims/{c1}/inputs", json={"inputs": {item_rows[2]["uid"]: {"this_qty": "0"}}})
    r = client.post(f"/api/claims/{c1}/confirm")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"
    # 확정 후 수정 불가
    assert client.put(f"/api/claims/{c1}/inputs", json={"inputs": {uid: {"this_qty": "1"}}}).status_code == 400

    # ---- 2차 기성: 전회 반영, 누계수량 입력
    c2 = client.post(f"/api/projects/{pid}/claims", json={"base_date": "2026-02-28"}).json()["id"]
    d = client.put(f"/api/claims/{c2}/inputs", json={"inputs": {uid: {"cum_qty": "50"}}}).json()
    l0 = next(l for l in d["lines"] if l["uid"] == uid)
    assert Decimal(l0["prev_qty"]) == 30 and Decimal(l0["this_qty"]) == 20 and Decimal(l0["cum_qty"]) == 50
    assert Decimal(l0["remain_qty"]) == qty - 50
    # 기성 엑셀 출력 (표준/원본)
    r = client.get(f"/api/claims/{c2}/export", params={"mode": "standard"})
    assert r.status_code == 200
    std = TMP / "c2_std.xlsx"
    std.write_bytes(r.content)
    wb = openpyxl.load_workbook(std)
    assert set(wb.sheetnames) >= {"기성내역서", "기성총괄표", "기성집계표"}
    ws = wb["기성내역서"]
    row = next(rw for rw in ws.iter_rows(min_row=5) if rw[0].value == first["name"] and rw[1].value == first["spec"])
    assert row[6].value == 30 and row[8].value == 20
    r = client.get(f"/api/claims/{c2}/export", params={"mode": "original"})
    assert r.status_code == 200, r.text
    orig = TMP / "c2_orig.xlsx"
    orig.write_bytes(r.content)
    wb = openpyxl.load_workbook(orig)
    assert "기성내역서" in wb.sheetnames and "원가" in wb.sheetnames
    ws = wb["기성내역서"]
    assert ws["D5"].value == "합성수지제 가요전선관"
    # 기성 열이 추가되었는지
    hdr = [c.value for c in ws[2]]
    assert "금회수량" in hdr and "누계금액" in hdr
    assert client.post(f"/api/claims/{c2}/confirm").status_code == 200

    # ---- 설계변경: 수량 증가 + 신규 품목 + 삭제(기성 없는 품목)
    r = client.post(f"/api/projects/{pid}/changes", json={"title": "1차 설계변경", "reason": "현장 여건 변경"})
    assert r.status_code == 200, r.text
    dcid = r.json()["id"]
    del_uid = item_rows[5]["uid"]
    body = [
        {"uid": uid, "action": "modify", "new_qty": str(qty + 20), "price_type": "contract", "reason": "물량 증가"},
        {"uid": del_uid, "action": "delete", "reason": "불필요"},
        {"action": "add", "new_item": {"section_path": first["section_path"], "name": "신규 전선관", "spec": "HI 28mm", "unit": "M", "after_uid": uid},
         "new_qty": "100", "new_mat_price": "1000", "new_lab_price": "2000", "new_exp_price": "0", "price_type": "new_unit_price", "price_basis": "신규 일위대가 1호"},
    ]
    r = client.put(f"/api/changes/{dcid}/items", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["summary"]["counts"] == {"modify": 1, "add": 1, "delete": 1, "keep": 266}
    lm = next(l for l in d["lines"] if l["uid"] == uid)
    assert Decimal(lm["diff"]["qty"]) == 20 and Decimal(lm["progress_qty"]) == 50
    la = next(l for l in d["lines"] if l["action"] == "add")
    assert Decimal(la["chg"]["tot_amt"]) == 300000 and Decimal(la["orig"]["tot_amt"]) == 0
    assert Decimal(d["summary"]["diff"]["tot_amt"]) == (Decimal(lm["diff"]["tot_amt"]) + 300000 - Decimal(item_rows[5]["tot_amt"]))
    # 원가 재계산: 간접노무비 = TRUNC(직노 × 15.2%)
    cs = d["summary"]["cost_sheet"]
    il = next(c for c in cs if c["name"].replace(" ", "") == "간접노무비")
    lab_chg = Decimal(d["summary"]["chg"]["lab_amt"])
    assert Decimal(il["chg"]) == (lab_chg * Decimal("15.2") / 100).to_integral_value(rounding="ROUND_DOWN")
    assert d["summary"]["warnings"] == []
    # 설계변경 엑셀
    r = client.get(f"/api/changes/{dcid}/export")
    assert r.status_code == 200
    (TMP / "dc.xlsx").write_bytes(r.content)
    wb = openpyxl.load_workbook(TMP / "dc.xlsx")
    assert {"설계변경대비표", "변경내역서", "증감총괄표", "변경원가계산서", "신규품목내역서"} <= set(wb.sheetnames)
    # 승인 → 새 버전
    r = client.post(f"/api/changes/{dcid}/approve")
    assert r.status_code == 200, r.text
    v1 = r.json()["version"]
    assert v1["version_no"] == 1
    vers = client.get(f"/api/projects/{pid}/versions").json()
    assert len(vers) == 2 and vers[1]["status"] == "approved"
    new_items = client.get(f"/api/versions/{v1['id']}/items").json()["items"]
    nm = next(i for i in new_items if i["uid"] == uid)
    assert Decimal(nm["qty"]) == qty + 20
    assert any(i["is_new"] and i["name"] == "신규 전선관" for i in new_items)
    assert next(i for i in new_items if i["uid"] == del_uid)["is_deleted"]

    # ---- 3차 기성: 변경계약 기준, 기존 기성 50 유지, 잔여 = (qty+20) - 50
    c3 = client.post(f"/api/projects/{pid}/claims", json={"base_date": "2026-03-31"}).json()
    assert c3["contract_version_id"] == v1["id"]
    d = client.get(f"/api/claims/{c3['id']}").json()
    l0 = next(l for l in d["lines"] if l["uid"] == uid)
    assert Decimal(l0["contract_qty"]) == qty + 20 and Decimal(l0["prev_qty"]) == 50 and Decimal(l0["remain_qty"]) == qty + 20 - 50
    ln = next(l for l in d["lines"] if l["name"] == "신규 전선관")
    assert Decimal(ln["contract_qty"]) == 100 and Decimal(ln["prev_qty"]) == 0
    # 확정된 1·2차 기록은 그대로
    d1 = client.get(f"/api/claims/{c1}").json()
    assert Decimal(next(l for l in d1["lines"] if l["uid"] == uid)["this_qty"]) == 30

    # 대시보드
    dash = client.get("/api/dashboard").json()
    pj = next(p for p in dash["projects"] if p["id"] == pid)
    assert pj["confirmed_claims"] == 2 and pj["version_count"] == 2
    assert Decimal(pj["cum_progress_amount"]) > 0

    # 이력
    logs = client.get(f"/api/projects/{pid}/audit").json()
    assert any(l["action"] == "claim.confirm" for l in logs) and any(l["action"] == "change.approve" for l in logs)


def test_gangneung_import_and_original_export(client):
    r = client.post("/api/projects", json={"name": "강릉 통합공공임대(전기)", "client": "LH"})
    pid = r.json()["id"]
    with open(GANGNEUNG, "rb") as fh:
        r = client.post(f"/api/projects/{pid}/files", files={"file": (GANGNEUNG.name, fh, "application/octet-stream")}, data={"sync": "true"})
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    a = client.get(f"/api/files/{fid}/analysis").json()
    assert a["estimate_sheets"] == ["내역서"]
    assert next(c for c in a["cost_compare"] if c["field"] == "mat_amt")["matched"] == "excluding_sections"
    r = client.post(f"/api/files/{fid}/import", json={})
    assert r.status_code == 200
    assert r.json()["item_count"] == 766
    cid = client.post(f"/api/projects/{pid}/claims", json={}).json()["id"]
    items = client.get(f"/api/versions/{r.json()['version_id']}/items").json()["items"]
    it = next(i for i in items if i["row_type"] == "item")
    client.put(f"/api/claims/{cid}/inputs", json={"inputs": {it["uid"]: {"this_qty": "10"}}})
    r = client.get(f"/api/claims/{cid}/export", params={"mode": "original", "keep_sheets": "false"})
    assert r.status_code == 200
    p = TMP / "gn_orig.xlsx"
    p.write_bytes(r.content)
    wb = openpyxl.load_workbook(p)
    assert wb.sheetnames == ["기성내역서"]
    ws = wb["기성내역서"]
    # 원본 열 너비/병합 보존 확인
    assert ws.column_dimensions["D"].width is not None
    assert ws["D5"].value == it["name"]
    # 다른 시트 참조 수식은 값으로 치환됨
    assert not (isinstance(ws["H5"].value, str) and ws["H5"].value.startswith("="))


def test_sheet_role_override_and_mapping(client):
    r = client.post("/api/projects", json={"name": "매핑 테스트"})
    pid = r.json()["id"]
    with open(CHILGOK, "rb") as fh:
        fid = client.post(f"/api/projects/{pid}/files", files={"file": (CHILGOK.name, fh, "application/octet-stream")}, data={"sync": "true"}).json()["id"]
    # 내역서 (2) 를 참조로 지정 → estimate_sheets 에서 제외
    r = client.put(f"/api/files/{fid}/sheets/내역서 (2)", json={"user_role": "reference"})
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["estimate_sheets"] == ["내역서"]
    # 열 매핑 지정 (비고 열을 Q→R 로 바꿔도 분석이 돌아가는지)
    r = client.put(f"/api/files/{fid}/sheets/내역서", json={"user_column_map": {"note": 18}, "save_as_rule": True})
    assert r.status_code == 200, r.text
    rules = client.get("/api/mapping-rules").json()
    assert rules and rules[0]["column_map"] == {"note": 18}


def test_price_tables(client):
    r = client.post("/api/projects", json={"name": "단가표 테스트"})
    pid = r.json()["id"]
    with open(CHILGOK, "rb") as fh:
        fid = client.post(f"/api/projects/{pid}/files", files={"file": (CHILGOK.name, fh, "application/octet-stream")}, data={"sync": "true"}).json()["id"]
    a = client.get(f"/api/files/{fid}/analysis").json()
    assert {"합산자재", "단가조사", "일위노임", "노임근거", "단가대비표"} <= set(a["price_tables"])
    client.post(f"/api/files/{fid}/import", json={})
    tables = client.get(f"/api/projects/{pid}/price-tables").json()
    kinds = {t["sheet"]: t["kind"] for t in tables}
    assert kinds["합산자재"] == "material" and kinds["노임근거"] == "labor"
    t = next(t for t in tables if t["sheet"] == "단가조사")
    d = client.get(f"/api/price-tables/{t['id']}", params={"q": "CD-난연성 22"}).json()
    assert d["matched"] == 1 and d["rows"][0]["G"] == 227.2193
    assert any(c["label"] == "거래가격/단가" for c in d["columns"])
    lk = client.get(f"/api/projects/{pid}/price-lookup", params={"q": "가요전선관 22"}).json()
    assert lk and lk[0]["name"] == "합성수지제 가요전선관"


def test_adjust_prices_and_delete_version(client):
    pid = client.post("/api/projects", json={"name": "단가조정 테스트"}).json()["id"]
    with open(CHILGOK, "rb") as fh:
        fid = client.post(f"/api/projects/{pid}/files", files={"file": (CHILGOK.name, fh, "application/octet-stream")}, data={"sync": "true"}).json()["id"]
    vid = client.post(f"/api/files/{fid}/import", json={}).json()["version_id"]
    items = [i for i in client.get(f"/api/versions/{vid}/items").json()["items"] if i["row_type"] == "item"]
    first = items[0]
    pv = client.post(f"/api/versions/{vid}/adjust-prices", json={"mat_pct": 87.747, "lab_pct": 100, "only_preview": True}).json()
    assert pv["preview"] and Decimal(pv["diff"]["mat_amt"]) < 0 and Decimal(pv["diff"]["lab_amt"]) == 0
    r = client.post(f"/api/versions/{vid}/adjust-prices", json={"mat_pct": 87.747, "lab_pct": 100, "reason": "낙찰률 적용"})
    assert r.status_code == 200 and r.json()["items"] > 0
    it = next(i for i in client.get(f"/api/versions/{vid}/items").json()["items"] if i["uid"] == first["uid"])
    exp = (Decimal(first["mat_price"]) * Decimal("0.87747")).to_integral_value(rounding="ROUND_DOWN")
    assert Decimal(it["mat_price"]) == exp and Decimal(it["lab_price"]) == Decimal(first["lab_price"])
    assert Decimal(it["mat_amt"]) == (Decimal(it["qty"]) * exp).to_integral_value(rounding="ROUND_DOWN")
    # 공종 한정 + 노무 105%
    sec = first["section_path"]
    r = client.post(f"/api/versions/{vid}/adjust-prices", json={"lab_pct": 105, "section_prefix": sec}).json()
    assert r["items"] > 0
    # 버전 삭제 (기성 없음 → 가능)
    assert client.delete(f"/api/versions/{vid}").status_code == 200
    assert client.get(f"/api/projects/{pid}/versions").json() == []
    # 공사 삭제
    assert client.delete(f"/api/projects/{pid}").status_code == 200
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_fit_contract(client):
    pid = client.post("/api/projects", json={"name": "낙찰 맞추기 테스트"}).json()["id"]
    with open(CHILGOK, "rb") as fh:
        fid = client.post(f"/api/projects/{pid}/files", files={"file": (CHILGOK.name, fh, "application/octet-stream")}, data={"sync": "true"}).json()["id"]
    vid = client.post(f"/api/files/{fid}/import", json={}).json()["version_id"]
    # 원본 총공사비 확인 (미리보기, 100%)
    pv = client.post(f"/api/versions/{vid}/fit-contract", json={"target_amount": 300359600, "include_vat": True, "only_preview": True}).json()
    grand_orig = pv["summary"]["grand"]
    assert pv["preview"] and Decimal(pv["diff"]) == 0 and Decimal(grand_orig) == 300359600
    assert Decimal(pv["profit"]) == 16408680   # 원본 이윤 그대로 복원되는지
    # 낙찰가 87% 로 맞추기: 자재 87.747%, 노무 100% → 남는 차액은 이윤
    target = (Decimal(grand_orig) * Decimal("0.87")).to_integral_value(rounding="ROUND_DOWN")
    target = (target / 1000).to_integral_value(rounding="ROUND_DOWN") * 1000   # 천원 절사
    pv = client.post(f"/api/versions/{vid}/fit-contract", json={"target_amount": float(target), "include_vat": True, "mat_pct": 87.747, "lab_pct": 87.747, "only_preview": True}).json()
    assert Decimal(pv["summary"]["grand"]) == target, pv["summary"]
    assert Decimal(pv["summary"]["total_cost"]) + Decimal(pv["summary"]["vat"]) == target
    profit_prev = Decimal(pv["profit"])
    # 정산 비목 4종은 원 내역서 금액 고정, 건강보험 등 나머지 요율 비목은 직접노무비 감소에 따라 감소
    for l in pv["cost_sheet"]:
        n = l["name"].replace(" ", "")
        if any(w in n for w in ("연금보험", "노인장기요양", "퇴직금공제", "산업안전보건관리비")):
            assert l["fixed"] and Decimal(l["amount"]) == Decimal(l["original_amount"]), l
        if n.startswith("건강보험") or n.startswith("산재보험") or n.startswith("고용보험"):
            assert not l["fixed"] and Decimal(l["amount"]) < Decimal(l["original_amount"]), l
    # 미리보기는 저장하지 않음
    items = client.get(f"/api/versions/{vid}/items").json()["items"]
    assert Decimal(client.get(f"/api/versions/{vid}").json()["totals"]["mat_amt"]) == Decimal("98821566")
    # 적용
    r = client.post(f"/api/versions/{vid}/fit-contract", json={"target_amount": float(target), "include_vat": True, "mat_pct": 87.747, "lab_pct": 87.747, "only_preview": False, "reason": "낙찰"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert Decimal(d["profit"]) == profit_prev and Decimal(d["summary"]["grand"]) == target
    rules = client.get(f"/api/projects/{pid}/cost-rules", params={"version_id": vid}).json()
    profit_rule = next(x for x in rules if x["name"].replace(" ", "").startswith("이윤"))
    assert profit_rule["fixed"] and Decimal(profit_rule["amount"]) == profit_prev
    assert Decimal(client.get(f"/api/projects/{pid}").json()["contract_amount"]) == target
    # 원본양식 출력: 이윤 셀이 값으로 들어가고 Excel 재계산 시 총공사비 = 낙찰금액
    r = client.get(f"/api/versions/{vid}/export")
    out = TMP / "fit.xlsm"
    out.write_bytes(r.content)
    wb = openpyxl.load_workbook(out, keep_vba=True)
    ws = wb["원가"]
    row = next(rr for rr in range(1, 50) if any(str(ws.cell(rr, c).value or "").replace(" ", "").startswith("이윤") for c in (1, 2, 3)))
    assert ws.cell(row, 5).value == int(profit_prev)
    import shutil, subprocess
    if shutil.which("soffice"):
        subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", str(TMP / "rc"), str(out)], check=True, timeout=180, capture_output=True)
        wv = openpyxl.load_workbook(TMP / "rc" / "fit.xlsx", data_only=True)["원가"]
        grow = next(rr for rr in range(1, 50) if any(str(wv.cell(rr, c).value or "").replace(" ", "").startswith("(총계") for c in (1, 2, 3)))
        assert wv.cell(grow, 5).value == int(target), (wv.cell(grow, 5).value, target)
