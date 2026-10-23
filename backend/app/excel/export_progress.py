"""기성내역서 엑셀 출력.

A. 표준양식  : 새 통합문서 (총괄표, 공종별 기성내역서, 전회·금회·누계·잔여 비교표, 집계표)
B. 원본서식  : 원본 통합문서를 복사해 내역서 시트를 '기성내역서' 시트로 복제하고 기성 열을 추가
"""
from __future__ import annotations

from copy import copy
from decimal import Decimal
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from ..services.progress import ProgressLine

THIN = Side(style="thin", color="000000")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD_FILL = PatternFill("solid", fgColor="D9E1F2")
SEC_FILL = PatternFill("solid", fgColor="F2F2F2")
NUM = "#,##0"
NUM2 = "#,##0.00"
QTYF = "#,##0.###"
FONT = Font(name="맑은 고딕", size=9)
BOLD = Font(name="맑은 고딕", size=9, bold=True)
TITLE = Font(name="맑은 고딕", size=16, bold=True)


def _num(v: Decimal | None):
    if v is None:
        return None
    return float(v) if v != v.to_integral_value() else int(v)


def _cell(ws, r, c, v=None, fmt=None, bold=False, align=None, fill=None):
    cell = ws.cell(r, c, v)
    cell.font = BOLD if bold else FONT
    cell.border = BORDER
    if fmt:
        cell.number_format = fmt
    if align:
        cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=True)
    if fill:
        cell.fill = fill
    return cell


def _setup_print(ws, title: str, landscape=True, cols: int = 20):
    ws.print_title_rows = "1:4" if ws.max_row > 4 else None
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.oddFooter.center.text = "&P / &N"
    ws.oddHeader.left.text = title
    ws.print_options.horizontalCentered = True


def _title_block(ws, title: str, project_name: str, claim_label: str, base_date: str | None, ncols: int):
    ws.cell(1, 1, title).font = TITLE
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    ws.cell(1, 1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 28
    ws.cell(2, 1, f"공사명 : {project_name}").font = FONT
    ws.cell(2, ncols - 3, f"{claim_label}").font = BOLD
    ws.cell(2, ncols - 1, f"기성기준일 : {base_date or ''}").font = FONT
    ws.cell(2, ncols, "(단위 : 원)").font = FONT


# ------------------------------------------------------------------ 표준양식
HEADERS = [
    ("품명", 24), ("규격", 22), ("단위", 6),
    ("계약\n수량", 10), ("계약\n단가", 11), ("계약\n금액", 13),
    ("전회\n수량", 10), ("전회\n금액", 13),
    ("금회\n수량", 10), ("금회\n재료비", 12), ("금회\n노무비", 12), ("금회\n경비", 10), ("금회\n금액", 13),
    ("누계\n수량", 10), ("누계\n금액", 13),
    ("잔여\n수량", 10), ("잔여\n금액", 13), ("기성률\n(%)", 8), ("비고", 10),
]


def write_standard(path: Path, project, claim, lines: list[ProgressLine], summary: dict, cost_lines: list | None = None) -> Path:
    wb = openpyxl.Workbook()
    label = f"{'준공정산' if claim.is_final else f'제 {claim.claim_no} 회 기성'}"
    # ---- 공종별 기성내역서
    ws = wb.active
    ws.title = "기성내역서"
    ncols = len(HEADERS)
    _title_block(ws, "기 성 내 역 서", project.name, label, claim.base_date, ncols)
    r = 4
    for i, (h, w) in enumerate(HEADERS, start=1):
        _cell(ws, r, i, h, bold=True, align="center", fill=HEAD_FILL)
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[r].height = 30
    r += 1
    first_data = r
    sec_rows: list[tuple[int, int, int]] = []   # (section_row, first, last)
    cur_sec_row = None
    cur_first = None
    for pl in lines:
        it = pl.item
        if it.row_type == "section":
            if cur_sec_row is not None and cur_first is not None and r > cur_first:
                sec_rows.append((cur_sec_row, cur_first, r - 1))
            _cell(ws, r, 1, " > ".join(it.section_path) if it.section_path else it.name, bold=True, fill=SEC_FILL)
            for c in range(2, ncols + 1):
                _cell(ws, r, c, fill=SEC_FILL)
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
            cur_sec_row, cur_first = r, r + 1
            r += 1
            continue
        if it.row_type != "item":
            continue
        _cell(ws, r, 1, it.name)
        _cell(ws, r, 2, it.spec)
        _cell(ws, r, 3, it.unit, align="center")
        _cell(ws, r, 4, _num(pl.contract_qty), QTYF)
        _cell(ws, r, 5, _num(it.tot_price), NUM)
        _cell(ws, r, 6, _num(pl.contract_amt), NUM)
        _cell(ws, r, 7, _num(pl.prev_qty), QTYF)
        _cell(ws, r, 8, _num(pl.prev_amt), NUM)
        _cell(ws, r, 9, _num(pl.this_qty), QTYF)
        _cell(ws, r, 10, _num(pl.this_mat), NUM)
        _cell(ws, r, 11, _num(pl.this_lab), NUM)
        _cell(ws, r, 12, _num(pl.this_exp), NUM)
        _cell(ws, r, 13, f"=J{r}+K{r}+L{r}", NUM)
        _cell(ws, r, 14, f"=G{r}+I{r}", QTYF)
        _cell(ws, r, 15, f"=H{r}+M{r}", NUM)
        _cell(ws, r, 16, f"=D{r}-N{r}", QTYF)
        _cell(ws, r, 17, f"=F{r}-O{r}", NUM)
        _cell(ws, r, 18, f'=IF(F{r}=0,"",ROUND(O{r}/F{r}*100,2))', NUM2)
        _cell(ws, r, 19, it.note)
        r += 1
    if cur_sec_row is not None and cur_first is not None and r > cur_first:
        sec_rows.append((cur_sec_row, cur_first, r - 1))
    # 공종 소계는 섹션 행에 수식으로
    for sr, a, b in sec_rows:
        for c in (6, 8, 10, 11, 12, 13, 15, 17):
            col = get_column_letter(c)
            ws.cell(sr, c, f"=SUM({col}{a}:{col}{b})").number_format = NUM
            ws.cell(sr, c).font = BOLD
    # 총계
    _cell(ws, r, 1, "총    계", bold=True, align="center", fill=HEAD_FILL)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
    for c in range(2, ncols + 1):
        _cell(ws, r, c, fill=HEAD_FILL)
    for c in (6, 8, 10, 11, 12, 13, 15, 17):
        col = get_column_letter(c)
        rows = [f"{col}{sr}" for sr, _, _ in sec_rows] or [f"{col}{first_data}:{col}{r-1}"]
        ws.cell(r, c, f"=SUM({','.join(rows)})").number_format = NUM
        ws.cell(r, c).font = BOLD
    ws.cell(r, 18, f'=IF(F{r}=0,"",ROUND(O{r}/F{r}*100,2))').number_format = NUM2
    total_row = r
    ws.freeze_panes = "D5"
    _setup_print(ws, f"{project.name} {label}")

    # ---- 기성 총괄표 (공종별)
    ws2 = wb.create_sheet("기성총괄표")
    h2 = [("공종", 40), ("계약금액", 15), ("전회기성", 15), ("금회기성", 15), ("누계기성", 15), ("잔여금액", 15), ("기성률(%)", 10)]
    _title_block(ws2, "기 성 총 괄 표", project.name, label, claim.base_date, len(h2))
    for i, (h, w) in enumerate(h2, start=1):
        _cell(ws2, 4, i, h, bold=True, align="center", fill=HEAD_FILL)
        ws2.column_dimensions[get_column_letter(i)].width = w
    rr = 5
    for sr, a, b in sec_rows:
        _cell(ws2, rr, 1, ws.cell(sr, 1).value)
        _cell(ws2, rr, 2, f"=기성내역서!F{sr}", NUM)
        _cell(ws2, rr, 3, f"=기성내역서!H{sr}", NUM)
        _cell(ws2, rr, 4, f"=기성내역서!M{sr}", NUM)
        _cell(ws2, rr, 5, f"=C{rr}+D{rr}", NUM)
        _cell(ws2, rr, 6, f"=B{rr}-E{rr}", NUM)
        _cell(ws2, rr, 7, f'=IF(B{rr}=0,"",ROUND(E{rr}/B{rr}*100,2))', NUM2)
        rr += 1
    _cell(ws2, rr, 1, "합    계", bold=True, align="center", fill=HEAD_FILL)
    for c in range(2, 7):
        col = get_column_letter(c)
        _cell(ws2, rr, c, f"=SUM({col}5:{col}{rr-1})", NUM, bold=True, fill=HEAD_FILL)
    _cell(ws2, rr, 7, f'=IF(B{rr}=0,"",ROUND(E{rr}/B{rr}*100,2))', NUM2, bold=True, fill=HEAD_FILL)
    _setup_print(ws2, f"{project.name} {label}", landscape=False)

    # ---- 기성 집계표 (재료비/노무비/경비)
    ws3 = wb.create_sheet("기성집계표")
    _title_block(ws3, "기 성 금 액 집 계 표", project.name, label, claim.base_date, 5)
    heads = ["구분", "계약금액", "전회기성", "금회기성", "누계기성"]
    for i, h in enumerate(heads, start=1):
        _cell(ws3, 4, i, h, bold=True, align="center", fill=HEAD_FILL)
        ws3.column_dimensions[get_column_letter(i)].width = 18
    cat_tot = {"mat": Decimal(0), "lab": Decimal(0), "exp": Decimal(0)}
    cat_prev = {"mat": Decimal(0), "lab": Decimal(0), "exp": Decimal(0)}
    for pl in lines:
        if pl.item.row_type != "item":
            continue
        it = pl.item
        cat_tot["mat"] += it.mat_amt or Decimal(0)
        cat_tot["lab"] += it.lab_amt or Decimal(0)
        cat_tot["exp"] += it.exp_amt or Decimal(0)
        cat_prev["mat"] += pl.prev_mat
        cat_prev["lab"] += pl.prev_lab
        cat_prev["exp"] += pl.prev_exp
    rows3 = [("직접재료비", "mat", "J"), ("직접노무비", "lab", "K"), ("기계경비", "exp", "L")]
    rr = 5
    for name, k, col in rows3:
        _cell(ws3, rr, 1, name, bold=True)
        _cell(ws3, rr, 2, _num(cat_tot[k]), NUM)
        _cell(ws3, rr, 3, _num(cat_prev[k]), NUM)
        _cell(ws3, rr, 4, f"=기성내역서!{col}{total_row}", NUM)
        _cell(ws3, rr, 5, f"=C{rr}+D{rr}", NUM)
        rr += 1
    _cell(ws3, rr, 1, "직접공사비 계", bold=True, fill=HEAD_FILL)
    for c in range(2, 6):
        col = get_column_letter(c)
        _cell(ws3, rr, c, f"=SUM({col}5:{col}{rr-1})", NUM, bold=True, fill=HEAD_FILL)
    direct_row = rr
    rr += 1
    # 원가 비목 (요율 적용) - 원본 요율을 그대로 적용한 참고 산출
    if cost_lines:
        rr += 1
        _cell(ws3, rr, 1, "※ 제비율 적용 참고 (원본 원가계산서 요율)", bold=True)
        rr += 1
        for cl in cost_lines:
            if cl.rate is None or cl.kind != "line":
                continue
            base = (cl.rate_base or "").replace(" ", "")
            if "직접노무" in base or base == "직노":
                ref = "D7"
            elif base.startswith("노무"):
                ref = "D7"
            elif "재료+직노" in base or "재료+노무" in base or "재료비+노무비" in base:
                ref = "(D5+D7)"
            elif base.startswith("재료"):
                ref = "D5"
            else:
                ref = None
            _cell(ws3, rr, 1, f"{cl.name}  ({cl.base_text or cl.rate_base} {cl.rate}%)")
            if ref:
                _cell(ws3, rr, 4, f"=TRUNC({ref}*{cl.rate}/100)", NUM)
            else:
                _cell(ws3, rr, 4, "수동 산정", align="center")
            rr += 1
    _setup_print(ws3, f"{project.name} {label}", landscape=False)
    wb.save(path)
    return path


# ------------------------------------------------------------------ 원본 서식 기반
PROG_HEADS = ["전회수량", "전회금액", "금회수량", "금회재료비", "금회노무비", "금회경비", "금회금액", "누계수량", "누계금액", "잔여수량", "잔여금액", "기성률(%)"]


def write_original_format(src_path: Path, out_path: Path, sheet_name: str, column_map: dict, data_start_row: int,
                          lines: list[ProgressLine], claim_label: str, keep_other_sheets: bool = True,
                          freeze_other_sheets: bool = True) -> dict:
    """원본 통합문서를 열어 내역서 시트를 복제('기성내역서')하고 기성 열을 추가한다.
    원본 시트의 서식(열너비, 병합, 테두리, 글꼴, 숫자서식, 인쇄설정)은 copy_worksheet 로 보존된다."""
    wb = openpyxl.load_workbook(src_path, data_only=False, keep_vba=False, keep_links=True)
    wbv = openpyxl.load_workbook(src_path, data_only=True, keep_links=False)
    src = wb[sheet_name]
    srcv = wbv[sheet_name]
    ws = wb.copy_worksheet(src)
    ws.title = "기성내역서"[:31]
    notes: list[str] = []
    import re as _re
    udf_re = _re.compile(r"(?<![A-Z0-9_\.])[A-Za-z_][A-Za-z0-9_]*\s*\(")
    KNOWN = set("SUM IF TRUNC ROUND ROUNDDOWN ROUNDUP INT SUMIF SUMIFS VLOOKUP HLOOKUP INDEX MATCH AND OR NOT ABS MAX MIN COUNT COUNTA COUNTIF IFERROR ISERROR ISBLANK ISNUMBER TEXT VALUE LEN LEFT RIGHT MID CONCATENATE RIGHTB LEFTB MOD OFFSET INDIRECT SUMPRODUCT AVERAGE SUBTOTAL CEILING FLOOR N T ROW COLUMN ROWS COLUMNS CHOOSE DATE TODAY NOW YEAR MONTH DAY FIXED REPT TRIM UPPER LOWER PROPER SEARCH FIND SUBSTITUTE REPLACE EXACT ISTEXT IFS SWITCH MAXIFS MINIFS AVERAGEIF ISNA NA POWER SQRT EXP LN LOG LOG10 PI RAND RANDBETWEEN".split())

    def has_udf(f: str) -> bool:
        return any(m.group(0)[:-1].strip().upper() not in KNOWN for m in udf_re.finditer(f.replace("_xlfn.", "")))

    udf_count = 0
    # 1) 복제된 기성내역서: 다른 시트/외부 참조/매크로 함수 수식은 캐시값으로 치환 (시트 삭제·외부참조·VBA 부재로 깨짐 방지)
    for row in ws.iter_rows():
        for cell in row:
            v = cell.value
            if isinstance(v, str) and v.startswith("=") and ("!" in v or "[" in v or has_udf(v)):
                if has_udf(v):
                    udf_count += 1
                cell.value = srcv[cell.coordinate].value
    # 2) 나머지 원본 시트: 수식을 모두 저장값으로 고정 (매크로 함수·외부참조가 재계산 시 #NAME? 가 되는 것을 방지)
    if freeze_other_sheets:
        for other in wb.worksheets:
            if other.title == ws.title:
                continue
            ov = wbv[other.title]
            for row in other.iter_rows():
                for cell in row:
                    v = cell.value
                    if isinstance(v, str) and v.startswith("="):
                        if has_udf(v):
                            udf_count += 1
                        cell.value = ov[cell.coordinate].value
        notes.append("원본 시트의 수식은 저장된 계산값으로 고정했습니다 (기성내역서 시트의 기성 열 수식은 유지).")
    if udf_count:
        notes.append(f"원본에 적산프로그램 매크로 함수 수식 {udf_count}개가 있어 계산값으로 대체했습니다.")
    fields = {k: v["col"] for k, v in column_map.get("fields", {}).items()}
    # 기성 열 시작: 사용된 열 중 비고 열 다음 (보조열 W~ 이후면 그 뒤)
    last_used = max([c for c in fields.values()] + [src.max_column])
    start = last_used + 1
    header_row = column_map.get("header_row", data_start_row - 1)
    h_rows = column_map.get("header_rows", 1)
    # 헤더 스타일 복제 (품명 헤더 셀)
    name_c = fields.get("name", 4)
    sample = src.cell(header_row, name_c)
    for i, h in enumerate(PROG_HEADS):
        c = start + i
        cell = ws.cell(header_row, c, h)
        cell.font = copy(sample.font)
        cell.border = copy(sample.border)
        cell.fill = copy(sample.fill)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        if h_rows == 2:
            ws.merge_cells(start_row=header_row, start_column=c, end_row=header_row + 1, end_column=c)
            ws.cell(header_row + 1, c).border = copy(sample.border)
        ws.column_dimensions[get_column_letter(c)].width = 11
    # 수식용 열 문자
    qty_l = get_column_letter(fields["qty"]) if "qty" in fields else None
    amt_l = get_column_letter(fields.get("tot_amt") or fields.get("amt") or fields.get("mat_amt"))
    mp = get_column_letter(fields["mat_price"]) if "mat_price" in fields else None
    lp = get_column_letter(fields["lab_price"]) if "lab_price" in fields else None
    ep = get_column_letter(fields["exp_price"]) if "exp_price" in fields else None
    tp = get_column_letter(fields["tot_price"]) if "tot_price" in fields else None
    by_row = {pl.item.source_row: pl for pl in lines if pl.item.row_type == "item"}
    L = lambda i: get_column_letter(start + i)  # noqa: E731
    sample_num = src.cell(data_start_row, fields.get("tot_amt") or fields.get("mat_amt") or name_c)
    fmt_num = sample_num.number_format if sample_num.number_format != "General" else "#,##0"
    written = 0
    for r in range(data_start_row, ws.max_row + 1):
        pl = by_row.get(r)
        if pl is None:
            continue
        written += 1
        vals = [
            _num(pl.prev_qty), _num(pl.prev_amt), _num(pl.this_qty),
            f"=TRUNC({L(2)}{r}*{mp}{r})" if mp else _num(pl.this_mat),
            f"=TRUNC({L(2)}{r}*{lp}{r})" if lp else _num(pl.this_lab),
            f"=TRUNC({L(2)}{r}*{ep}{r})" if ep else _num(pl.this_exp),
            f"={L(3)}{r}+{L(4)}{r}+{L(5)}{r}" if (mp or lp or ep) else (f"=TRUNC({L(2)}{r}*{tp}{r})" if tp else _num(pl.this_amt)),
            f"={L(0)}{r}+{L(2)}{r}",
            f"={L(1)}{r}+{L(6)}{r}",
            f"={qty_l}{r}-{L(7)}{r}" if qty_l else _num(pl.remain_qty),
            f"={amt_l}{r}-{L(8)}{r}",
            f'=IF({amt_l}{r}=0,"",ROUND({L(8)}{r}/{amt_l}{r}*100,2))',
        ]
        for i, v in enumerate(vals):
            cell = ws.cell(r, start + i, v)
            cell.font = copy(sample_num.font)
            cell.border = copy(sample_num.border)
            cell.number_format = "#,##0.###" if i in (0, 2, 7, 9) else ("0.00" if i == 11 else fmt_num)
    # 소계/합계 행: 원본의 금액 열 수식 패턴을 기성열에도 적용 (SUM 범위 유지)
    import re
    for r in range(data_start_row, ws.max_row + 1):
        f = src.cell(r, fields.get("tot_amt") or fields.get("mat_amt") or name_c).value
        if isinstance(f, str) and f.startswith("=") and "SUM(" in f.upper() and r not in by_row:
            m = re.search(r"SUM\(\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)\)", f, re.I)
            if m:
                a, b = int(m.group(2)), int(m.group(4))
                for i in (1, 3, 4, 5, 6, 8, 10):
                    col = L(i)
                    cell = ws.cell(r, start + i, f"=SUM({col}{a}:{col}{b})")
                    cell.font = copy(sample_num.font)
                    cell.border = copy(sample_num.border)
                    cell.number_format = fmt_num
    # 제목 셀에 회차 표기
    for r in range(1, header_row):
        for c in range(1, 8):
            v = ws.cell(r, c).value
            if isinstance(v, str) and ("[" in v or "내역" in v or "공사" in v) and len(v) > 4:
                ws.cell(r, c, f"{v}  - {claim_label}")
                break
    if not keep_other_sheets:
        for name in list(wb.sheetnames):
            if name != ws.title:
                del wb[name]
    else:
        wb.move_sheet(ws.title, offset=-(len(wb.sheetnames) - 1))
    # 인쇄영역 확장
    ws.print_area = f"A{1}:{L(len(PROG_HEADS)-1)}{ws.max_row}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    if src.freeze_panes:
        ws.freeze_panes = src.freeze_panes
    # 보존 한계 안내
    if src._images or getattr(src, "_charts", None):
        notes.append("원본 시트의 이미지/도형은 복제되지 않습니다.")
    if src.conditional_formatting:
        notes.append("조건부 서식은 일부만 보존될 수 있습니다.")
    wb.save(out_path)
    return {"written_rows": written, "progress_col_start": get_column_letter(start), "notes": notes}
