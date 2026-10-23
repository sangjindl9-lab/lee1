"""엔진 단위 테스트: 합성 엑셀(양식 2종) 분석, 기성 계산 예시(명세서 4-4), 설계변경 계산, 반올림."""
from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
TMP = ROOT / "data" / "test"
TMP.mkdir(parents=True, exist_ok=True)

from app.excel.analyzer import analyze_file  # noqa: E402
from app.excel.parser import detect_rounding  # noqa: E402
from app.services.calc import line_amounts, round_by  # noqa: E402


def make_form_a(path: Path):
    """표준형 A: 2행 헤더, B열 공종줄/합계줄 마커, 재료비/노무비/경비 분리, TRUNC 수식."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "내역서"
    ws["A1"], ws["B1"] = "총줄수->", 20
    heads = ["번호", "공종코드", "코드", "명   칭", "규   격", "단위", "수량", "재료비", None, "노무비", None, None, "경비", None, "계", None, "비고"]
    for i, h in enumerate(heads, start=1):
        ws.cell(2, i, h)
    for i, h in [(8, "단가"), (9, "금액"), (10, "수량"), (11, "단가"), (12, "금액"), (13, "단가"), (14, "금액"), (15, "단가"), (16, "금액")]:
        ws.cell(3, i, h)
    ws["B4"], ws["D4"] = "공종줄", "1.전기공사::1-1.간선공사"
    rows = [("케이블", "CV 4sq", "M", 100, 10000, 2000, 0), ("전선관", "HI 22", "M", 50, 500, 1500, 10)]
    r = 5
    for name, spec, unit, qty, mp, lp, ep in rows:
        ws.cell(r, 1, f"C{r}"); ws.cell(r, 2, "0101"); ws.cell(r, 4, name); ws.cell(r, 5, spec); ws.cell(r, 6, unit)
        ws.cell(r, 7, qty); ws.cell(r, 8, mp); ws.cell(r, 9, f"=TRUNC(G{r}*H{r})"); ws.cell(r, 10, qty); ws.cell(r, 11, lp)
        ws.cell(r, 12, f"=TRUNC(G{r}*K{r})"); ws.cell(r, 13, ep); ws.cell(r, 14, f"=TRUNC(G{r}*M{r})")
        ws.cell(r, 15, f"=H{r}+K{r}+M{r}"); ws.cell(r, 16, f"=SUM(I{r},L{r},N{r})")
        r += 1
    ws.cell(r, 2, "합계줄"); ws.cell(r, 4, "( 합       계 )")
    ws.cell(r, 9, "=SUM(I5:I6)"); ws.cell(r, 12, "=SUM(L5:L6)"); ws.cell(r, 14, "=SUM(N5:N6)"); ws.cell(r, 16, "=SUM(P5:P6)")
    r += 1
    ws.cell(r, 2, "공종줄"); ws.cell(r, 4, "2.관급자관급::2-1.자재")
    r += 1
    ws.cell(r, 1, "M1"); ws.cell(r, 2, "0201"); ws.cell(r, 4, "변압기"); ws.cell(r, 5, "500kVA"); ws.cell(r, 6, "대"); ws.cell(r, 7, 1)
    ws.cell(r, 8, 30000000); ws.cell(r, 9, "=TRUNC(G10*H10)"); ws.cell(r, 10, 1); ws.cell(r, 11, 0); ws.cell(r, 12, 0); ws.cell(r, 13, 0); ws.cell(r, 14, 0)
    ws.cell(r, 15, "=H10+K10+M10"); ws.cell(r, 16, "=SUM(I10,L10,N10)")
    r += 1
    ws.cell(r, 2, "합계줄"); ws.cell(r, 4, "( 합       계 )"); ws.cell(r, 9, "=SUM(I10:I10)"); ws.cell(r, 12, 0); ws.cell(r, 14, 0); ws.cell(r, 16, "=SUM(P10:P10)")
    # 원가계산서
    wc = wb.create_sheet("원가")
    wc["A1"] = "원 가 계 산 서"
    wc["A4"], wc["C4"], wc["D4"], wc["I4"] = "비 목", "구  분", "금 액", "요율"
    wc["C5"], wc["D5"] = "직 접 재 료 비", 1025000
    wc["C6"], wc["D6"] = "직 접 노 무 비", 275000
    wc["C7"], wc["D7"], wc["E7"], wc["I7"] = "간 접 노 무 비", 41525, "(직접 노무비) * 15.1 %", 15.1
    wc["C8"], wc["D8"], wc["E8"], wc["I8"] = "산 재 보 험 료", 11268, "(노무비) * 3.56 %", 3.56
    wc["C9"], wc["D9"] = "( 소      계 )", 1352793
    # 일위대가
    wu = wb.create_sheet("일위대가")
    for i, h in enumerate(["번호", "목차코드", "코드", "명   칭", "규   격", "단위", "수량", "재료비", None, "노무비", None, None, "경비", None, "계"], start=1):
        wu.cell(2, i, h)
    for i, h in [(8, "단가"), (9, "금액"), (10, "수량"), (11, "단가"), (12, "금액"), (13, "단가"), (14, "금액"), (15, "단가"), (16, "금액")]:
        wu.cell(3, i, h)
    wu["B4"], wu["D4"] = "일목줄", "[제 1호] 케이블 포설  CV 4sq [M]"
    wu["B5"], wu["D5"], wu["E5"], wu["F5"], wu["G5"], wu["H5"], wu["I5"], wu["K5"], wu["L5"] = "제 1호", "케이블", "CV 4sq", "M", 1.03, 9700, 9991, 0, 0
    wu["B6"], wu["D6"], wu["E6"], wu["F6"], wu["G6"], wu["K6"], wu["L6"] = "제 1호", "내선전공", "", "인", 0.01, 200000, 2000
    wu["B7"], wu["D7"], wu["I7"], wu["L7"] = "합계줄", "( 합       계 )", 9991, 2000
    wb.save(path)


def make_form_b(path: Path):
    """양식 B: 헤더 1행, 공종 제목이 A열 번호 텍스트, 단일 단가/금액 (한전형 유사), 구역 라벨로 재료비/노무비 구분, INT 수식."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "설계명세서"
    for i, h in enumerate(["No.", "품    명", "규     격", "단위", "수량", "단  가", "금   액", "비  고"], start=1):
        ws.cell(4, i, h)
    ws["A5"] = "[ 재 료 비 ]"
    ws["A6"] = "1. 광케이블 공사"
    ws["B7"], ws["C7"], ws["D7"], ws["E7"], ws["F7"], ws["G7"] = "광케이블", "SM 12C", "m", 200, 1500, "=INT(E7*F7)"
    ws["B8"], ws["C8"], ws["D8"], ws["E8"], ws["F8"], ws["G8"] = "광접속함체", "24C", "개", 2, 150000, "=INT(E8*F8)"
    ws["A9"] = "[ 노 무 비 ]"
    ws["A10"] = "1. 광케이블 공사"
    ws["B11"], ws["C11"], ws["D11"], ws["E11"], ws["F11"], ws["G11"] = "광케이블 포설", "SM 12C", "m", 200, 2500, "=INT(E11*F11)"
    ws["A12"] = "[ 일반관리비 ]"
    ws["B13"], ws["D13"], ws["E13"], ws["F13"], ws["G13"] = "일반관리비", "식", 1, 6, 48000
    wb.save(path)


def test_form_a_analysis():
    p = TMP / "form_a.xlsx"
    make_form_a(p)
    r = analyze_file(p)
    roles = {x["sheet"]: x["role"] for x in r["roles"]}
    assert roles == {"내역서": "estimate", "원가": "cost_sheet", "일위대가": "unit_price"}
    assert r["estimate_sheets"] == ["내역서"]
    cm = r["column_maps"]["내역서"]["fields"]
    assert cm["name"]["letter"] == "D" and cm["mat_amt"]["letter"] == "I" and cm["lab_price"]["letter"] == "K" and cm["tot_amt"]["letter"] == "P"
    ps = r["_parsed"]["내역서"]
    items = ps.item_rows()
    assert [i.name for i in items] == ["케이블", "전선관", "변압기"]
    assert items[0].section_path == ["1.전기공사", "1-1.간선공사"]
    assert items[2].section_path == ["2.관급자관급", "2-1.자재"]
    # 캐시값 없는(저장 안 된) 수식 → 금액 None 이므로 검증에서 "수량 없음"이 아닌 금액 미확인으로 처리되는지: openpyxl 저장 파일은 캐시값이 없음
    assert ps.rounding["mat_amt"].func == "trunc"
    v = r["validations"]["내역서"]
    assert v["item_count"] == 3 and v["section_count"] == 2
    cost = r["cost_sheets"]["원가"]
    lines = {l["name"].replace(" ", ""): l for l in cost["lines"]}
    assert lines["간접노무비"]["rate"] == "15.1" and lines["간접노무비"]["rate_base"] == "직접노무비"
    assert lines["산재보험료"]["rate_base"] == "노무비"
    ups = r["_unit_prices"]["일위대가"]
    assert ups[0]["no"] == "제1호" and len(ups[0]["components"]) == 2 and ups[0]["total"]["mat_amt"] == "9991"


def test_form_b_analysis_regions():
    p = TMP / "form_b.xlsx"
    make_form_b(p)
    r = analyze_file(p)
    assert r["estimate_sheets"] == ["설계명세서"]
    ps = r["_parsed"]["설계명세서"]
    items = ps.item_rows()
    names = [(i.name, i.cost_region) for i in items]
    assert ("광케이블", "mat") in names and ("광케이블 포설", "lab") in names
    assert all(i.name != "일반관리비" for i in items)   # 원가 구역 행은 품목에서 제외
    assert ps.rounding["tot_amt"].func == "int"
    cm = r["column_maps"]["설계명세서"]["fields"]
    assert cm["tot_amt"]["letter"] == "G" and cm["tot_price"]["letter"] == "F"


def test_rounding_detection_and_apply():
    assert detect_rounding("=TRUNC(G5*H5)").func == "trunc"
    assert detect_rounding("=IF(G5*H5<>0, TRUNC(G5*H5, 1), \"\")").as_dict() == {"func": "trunc", "digits": 1}
    assert detect_rounding("=ROUNDDOWN(D6*E6, 0)").func == "rounddown"
    assert detect_rounding("=INT(E9*F9)").func == "int"
    assert detect_rounding("=G5*H5").func == "none"
    assert round_by(Decimal("1234.567"), {"func": "trunc", "digits": 0}) == Decimal("1234")
    assert round_by(Decimal("1234.567"), {"func": "trunc", "digits": 1}) == Decimal("1234.5")
    assert round_by(Decimal("1234.567"), {"func": "round", "digits": 0}) == Decimal("1235")
    assert round_by(Decimal("-1.5"), {"func": "int", "digits": 0}) == Decimal("-2")


def test_progress_example_from_spec():
    """명세서 4-4 예시: 계약 100m×10,000원, 전회 30m, 금회 20m."""
    rounding = {"amount": {"func": "trunc", "digits": 0}}
    contract = line_amounts(Decimal(100), 10000, 0, 0, rounding)
    assert contract["tot_amt"] == Decimal(1000000)
    prev = line_amounts(Decimal(30), 10000, 0, 0, rounding)["tot_amt"]
    this = line_amounts(Decimal(20), 10000, 0, 0, rounding)["tot_amt"]
    assert prev == 300000 and this == 200000
    cum_q, cum_a = Decimal(30) + 20, prev + this
    assert cum_q == 50 and cum_a == 500000
    assert Decimal(100) - cum_q == 50 and contract["tot_amt"] - cum_a == 500000
    assert (cum_a / contract["tot_amt"] * 100) == Decimal(50)


def test_decimal_no_float_error():
    am = line_amounts(Decimal("0.1"), Decimal("0.2"), 0, 0, {"amount": {"func": "none", "digits": 0}})
    assert am["mat_amt"] == Decimal("0.02")
    am = line_amounts(Decimal("3"), Decimal("1.1"), 0, 0, {"amount": {"func": "none", "digits": 0}})
    assert am["mat_amt"] == Decimal("3.3")
