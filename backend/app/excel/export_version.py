"""계약내역 버전을 원본 엑셀 양식 그대로 출력 (수정된 셀만 바꿈).

- 원본 통합문서를 열어(매크로·외부링크 보존) 내역서 시트의 해당 행에 수정 값(품명/규격/단위/수량/단가/비고)만 기록
- 단가가 바뀐 품목만 단가 셀의 수식을 값으로 교체, 금액 수식은 그대로 두고 Excel 이 열 때 전체 재계산
- 추가 품목은 기준 행 아래에 행을 삽입하고 서식을 복사하며, 수식·병합·소계 범위를 함께 보정
- 삭제 품목은 수량 0 처리(행 유지) 또는 행 삭제 선택
"""
from __future__ import annotations

import re
from copy import copy
from decimal import Decimal
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.cell_range import CellRange

REF_RE = re.compile(r"(?P<sheet>(?:'(?:[^']|'')+'|[A-Za-z0-9_가-힣\.\-\(\)]+)!)?(?P<c1>\$?[A-Z]{1,3})(?P<r1abs>\$?)(?P<r1>\d+)(?::(?P<c2>\$?[A-Z]{1,3})(?P<r2abs>\$?)(?P<r2>\d+))?")


def _q(name: str) -> str:
    return f"'{name}'" if re.search(r"[^A-Za-z0-9_]", name) else name


def _shift_formula(formula: str, sheet: str, cur_sheet: str, at: int, extend_end_at: int | None) -> str:
    """시트 `sheet` 의 at 행 이상 참조를 +1. 범위 끝이 at-1 이면 끝을 +1 (소계 범위 확장)."""
    def repl(m: re.Match) -> str:
        sh = m.group("sheet")
        target = sh[:-1].strip("'").replace("''", "'") if sh else cur_sheet
        if target != sheet:
            return m.group(0)
        r1 = int(m.group("r1"))
        out = (sh or "") + m.group("c1") + m.group("r1abs") + str(r1 + 1 if r1 >= at else r1)
        if m.group("c2"):
            r2 = int(m.group("r2"))
            nr2 = r2 + 1 if r2 >= at else (r2 + 1 if (extend_end_at is not None and r2 == extend_end_at and r1 < at) else r2)
            out += ":" + m.group("c2") + m.group("r2abs") + str(nr2)
        return out
    # 문자열 리터럴 안은 건드리지 않도록 분리
    parts = re.split(r'("(?:[^"]|"")*")', formula)
    return "".join(p if p.startswith('"') else REF_RE.sub(repl, p) for p in parts)


def insert_row_shifted(wb, ws, at: int, style_from: int, extend_subtotals: bool = True) -> None:
    """ws 의 at 위치에 행 삽입 + 통합문서 전체 수식/병합/행높이 보정. style_from 행의 서식 복사."""
    extend_end = at - 1 if extend_subtotals else None
    # 1) 수식 보정 (모든 시트)
    for other in wb.worksheets:
        for row in other.iter_rows():
            for cell in row:
                v = cell.value
                if isinstance(v, str) and v.startswith("="):
                    cell.value = _shift_formula(v, ws.title, other.title, at, extend_end)
    # 2) 병합 셀 보정
    merged = [CellRange(str(r)) for r in ws.merged_cells.ranges]
    for r in merged:
        ws.merged_cells.remove(str(r))
    # 3) 셀 이동
    ws.insert_rows(at)
    for r in merged:
        if r.min_row >= at:
            r.shift(row_shift=1)
        elif r.max_row >= at:
            r.expand(down=1)
        ws.merge_cells(str(r))
    # 4) 행 높이 이동
    heights = {k: v.height for k, v in ws.row_dimensions.items() if v.height is not None and k >= at}
    for k in sorted(heights, reverse=True):
        ws.row_dimensions[k + 1].height = heights[k]
        ws.row_dimensions[k].height = ws.row_dimensions[style_from].height if k == at else None
    # 5) 서식 복사
    for c in range(1, ws.max_column + 1):
        src = ws.cell(style_from if style_from < at else style_from + 1, c)
        dst = ws.cell(at, c)
        dst.font, dst.border, dst.fill, dst.number_format, dst.alignment, dst.protection = (
            copy(src.font), copy(src.border), copy(src.fill), src.number_format, copy(src.alignment), copy(src.protection))
    # 6) 인쇄영역
    if ws.print_area:
        ws.print_area = _shift_formula(str(ws.print_area).replace("$", "$"), ws.title, ws.title, at, None)


def _num(v: Decimal | None):
    if v is None:
        return None
    return int(v) if v == v.to_integral_value() else float(v)


def write_version_original(src_path: Path, out_path: Path, version, sheet_maps: dict[str, dict], original_items: dict[str, dict] | None,
                           delete_mode: str = "zero", title_suffix: str = "", cost_overrides: list[dict] | None = None) -> dict:
    """cost_overrides: [{"sheet","row","col","amount","name"}] — 원가계산서에서 값으로 고정할 비목(낙찰금액 맞추기 이윤 등)."""
    """
    version: ContractVersion (items 포함). sheet_maps: {sheet: column_map dict}.
    original_items: {uid: 원본(최초 가져오기) 값 dict} — 없으면 모든 셀을 현재 값으로 기록.
    """
    is_xlsm = src_path.suffix.lower() == ".xlsm"
    wb = openpyxl.load_workbook(src_path, keep_vba=is_xlsm, keep_links=True)
    wbv = openpyxl.load_workbook(src_path, data_only=True, keep_links=True)
    stats = {"modified": 0, "added": 0, "deleted": 0, "notes": []}
    # 매크로 함수(UDF)·외부 링크가 있으면 내역서 품목 행의 '다른 시트 참조' 수식(수량·단가)은 저장값으로 고정
    # (매크로 비활성 환경이나 LibreOffice 에서 #NAME?/#VALUE! 가 번지는 것을 방지; 금액·소계 수식은 유지)
    from .export_progress import KNOWN, udf_re
    def _has_udf(f: str) -> bool:
        return any(m.group(0)[:-1].strip().upper() not in KNOWN for m in udf_re.finditer(f.replace("_xlfn.", "")))
    fragile = any(isinstance(c.value, str) and c.value.startswith("=") and ("[" in c.value or _has_udf(c.value))
                  for w in wb.worksheets for row in w.iter_rows() for c in row)
    if fragile:
        stats["notes"].append("원본에 매크로 함수/외부 링크 수식이 있어 내역서 품목 행의 수량·단가 참조 수식은 저장된 값으로 고정했습니다.")
        # 외부 파일 링크([1]옵션!$D$2 등)는 어디서든 끊어진 참조이므로 저장값으로 고정
        for w in wb.worksheets:
            wv_ = wbv[w.title]
            for row in w.iter_rows():
                for c in row:
                    if isinstance(c.value, str) and c.value.startswith("=") and "[" in c.value:
                        c.value = wv_[c.coordinate].value
    items = sorted(version.items, key=lambda i: i.seq)
    by_sheet: dict[str, list] = {}
    for it in items:
        if it.sheet:
            by_sheet.setdefault(it.sheet, []).append(it)

    for sheet, sitems in by_sheet.items():
        if sheet not in wb.sheetnames or sheet not in sheet_maps:
            stats["notes"].append(f"[{sheet}] 원본 시트 또는 열 매핑이 없어 건너뜀")
            continue
        ws = wb[sheet]
        fields = {k: v["col"] for k, v in sheet_maps[sheet].get("fields", {}).items()}
        col = lambda f: fields.get(f)  # noqa: E731
        # 행 삽입 때문에 원본 행 번호가 밀리므로 현재 행 번호를 추적
        row_of: dict[str, int] = {it.uid: it.source_row for it in sitems if it.source_row}
        prev_with_row = None
        for it in sitems:
            if it.row_type == "section":
                continue
            if it.row_type != "item":
                continue
            r = row_of.get(it.uid)
            if r is None:
                # 신규 품목: 직전 품목 아래 행 삽입
                if prev_with_row is None:
                    stats["notes"].append(f"'{it.name}' 삽입 위치를 찾지 못해 건너뜀")
                    continue
                at = row_of[prev_with_row.uid] + 1
                insert_row_shifted(wb, ws, at, style_from=row_of[prev_with_row.uid])
                for uid, rr in row_of.items():
                    if rr >= at:
                        row_of[uid] = rr + 1
                row_of[it.uid] = at
                r = at
                stats["added"] += 1
                # 신규 행: 값 전부 기록, 금액은 직전 행의 수식을 복사해 행 번호만 바꿈
                prev_r = row_of[prev_with_row.uid]
                for f, c in fields.items():
                    if f in ("name", "spec", "unit", "note", "qty", "mat_price", "lab_price", "exp_price", "work_code", "item_code", "code"):
                        continue
                    pv = ws.cell(prev_r, c).value
                    if isinstance(pv, str) and pv.startswith("=") and not re.search(r"!", pv):
                        ws.cell(r, c, re.sub(r"(\$?[A-Z]{1,3})(\$?)" + str(prev_r) + r"(?!\d)", lambda m: f"{m.group(1)}{m.group(2)}{r}", pv))
                for f, val in (("name", it.name), ("spec", it.spec), ("unit", it.unit), ("note", it.note), ("work_code", it.work_code)):
                    if col(f):
                        ws.cell(r, col(f), val or None)
                for f, val in (("qty", it.qty), ("mat_price", it.mat_price), ("lab_price", it.lab_price), ("exp_price", it.exp_price), ("tot_price", it.tot_price)):
                    if col(f):
                        ws.cell(r, col(f), _num(val))
                if col("lab_qty"):
                    ws.cell(r, col("lab_qty"), _num(it.qty))
                prev_with_row = it
                continue
            prev_with_row = it
            if fragile:
                for f in ("qty", "lab_qty", "mat_price", "lab_price", "exp_price"):
                    if col(f):
                        cv = ws.cell(r, col(f)).value
                        if isinstance(cv, str) and cv.startswith("=") and "!" in cv:
                            ws.cell(r, col(f), wbv[sheet].cell(it.source_row, col(f)).value)
            orig = (original_items or {}).get(it.uid)
            if it.is_deleted:
                stats["deleted"] += 1
                if col("qty"):
                    ws.cell(r, col("qty"), 0)
                if col("lab_qty"):
                    ws.cell(r, col("lab_qty"), 0)
                if col("note"):
                    ws.cell(r, col("note"), ((it.note or "") + " (삭제)").strip())
                continue
            changed = False

            def diff(f, cur):
                if orig is None:
                    return True
                ov = orig.get(f)
                if isinstance(cur, Decimal) or isinstance(ov, (int, float, Decimal)):
                    q = Decimal("0.0001")
                    return Decimal(str(ov or 0)).quantize(q) != Decimal(str(cur or 0)).quantize(q)
                return (ov or "") != (cur or "")

            for f, val in (("name", it.name), ("spec", it.spec), ("unit", it.unit), ("note", it.note)):
                if col(f) and diff(f, val):
                    ws.cell(r, col(f), val or None)
                    changed = True
            if col("qty") and diff("qty", it.qty):
                ws.cell(r, col("qty"), _num(it.qty))
                if col("lab_qty"):
                    ws.cell(r, col("lab_qty"), _num(it.qty))
                changed = True
            for f in ("mat_price", "lab_price", "exp_price", "tot_price"):
                val = getattr(it, f)
                if col(f) and val is not None and diff(f, val):
                    cv = ws.cell(r, col(f)).value
                    if f == "tot_price" and isinstance(cv, str) and cv.startswith("="):
                        continue   # 합계단가 수식은 유지 (구성 단가 변경으로 자동 반영)
                    if isinstance(cv, str) and cv.startswith("=") and (it.price_source or {}).get("rate_row"):
                        continue   # 요율행(공구손료 등)의 기준금액 수식은 유지 → 엑셀이 재계산
                    ws.cell(r, col(f), _num(val))   # 수식(일위대가 참조)을 승인된 단가 값으로 교체
                    changed = True
            if changed:
                stats["modified"] += 1
        # 제목에 버전 표기
        if title_suffix:
            for rr in range(1, min(ws.max_row, 3) + 1):
                for cc in range(1, 8):
                    v = ws.cell(rr, cc).value
                    if isinstance(v, str) and len(v) > 4 and ("[" in v or "내역" in v or "공사" in v) and title_suffix not in v:
                        ws.cell(rr, cc, f"{v}  - {title_suffix}")
                        break
    # 원가계산서 고정 비목 (이윤 역산 등) 값 기록
    for co in cost_overrides or []:
        if co.get("sheet") in wb.sheetnames and co.get("row") and co.get("col") and co.get("amount") is not None:
            c = wb[co["sheet"]].cell(co["row"], co["col"])
            is_formula = isinstance(c.value, str) and c.value.startswith("=")
            if co.get("force") or (not is_formula and c.value is not None):
                # 수식 비목은 Excel 재계산에 맡기고, 값으로 입력된 비목(건강보험 등)과 이윤(역산값)만 기록
                c.value = _num(Decimal(str(co["amount"])))
                stats["cost_fixed"] = stats.get("cost_fixed", 0) + 1
    # Excel 이 열 때 전체 재계산 (금액·소계·원가 수식 반영)
    wb.calculation.fullCalcOnLoad = True
    wb.save(out_path)
    return stats
