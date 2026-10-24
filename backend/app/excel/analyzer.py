"""업로드 파일 전체 분석 오케스트레이션."""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any

from . import classifier as C
from .column_mapper import apply_user_mapping, detect_columns
from .loader import WorkbookBundle, load_bundle
from .parser import ParsedSheet, parse_cost_sheet, parse_estimate_sheet, parse_table_sheet, parse_unit_price_sheet
from .validator import compare_with_cost_sheet, validate_sheet


def pick_estimate_sheets(roles: list[C.SheetRole], parsed: dict[str, ParsedSheet], bundle: WorkbookBundle) -> list[str]:
    """계약내역으로 쓸 공종별 내역서 시트 목록 (여러 시트 분리형 지원). 보이는 시트 우선, 품목 5개 이상."""
    hidden = {s.name: s.hidden for s in bundle.sheets}
    cands = [r.sheet for r in roles if r.role == C.ESTIMATE and r.sheet in parsed
             and len(parsed[r.sheet].item_rows()) >= 1 and parsed[r.sheet].column_map.col("qty")]
    visible = [c for c in cands if not hidden.get(c)]
    return visible or cands


def section_totals(ps: ParsedSheet) -> list[dict]:
    """최상위 공종별 합계 (도급/관급 구분 확인용)."""
    acc: dict[str, dict] = {}
    order: list[str] = []
    for it in ps.item_rows():
        top = it.section_path[0] if it.section_path else "(미분류)"
        if top not in acc:
            acc[top] = {"section": top, "mat_amt": Decimal(0), "lab_amt": Decimal(0), "exp_amt": Decimal(0), "tot_amt": Decimal(0), "items": 0}
            order.append(top)
        acc[top]["items"] += 1
        for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt"):
            v = getattr(it, k)
            if v is not None:
                acc[top][k] += v
    return [{k: (str(v) if isinstance(v, Decimal) else v) for k, v in acc[t].items()} for t in order]


def analyze_file(path: str | Path, work_dir: str | Path | None = None,
                 role_overrides: dict[str, str] | None = None,
                 mapping_overrides: dict[str, dict[str, int | None]] | None = None) -> dict[str, Any]:
    bundle = load_bundle(path, work_dir)
    roles = C.classify_workbook(bundle)
    if role_overrides:
        for r in roles:
            if r.sheet in role_overrides:
                r.role = role_overrides[r.sheet]
                r.confidence = 1.0
                r.reasons.append("사용자 지정")

    parsed: dict[str, ParsedSheet] = {}
    column_maps: dict[str, Any] = {}
    validations: dict[str, Any] = {}
    cost_sheets: dict[str, Any] = {}
    unit_prices: dict[str, Any] = {}
    price_tables: dict[str, Any] = {}     # 자재단가 / 노임 등 표
    unidentified: list[str] = []

    for r in roles:
        ws_f = bundle.formulas[r.sheet]
        ws_v = bundle.values[r.sheet]
        if r.role in (C.ESTIMATE, C.CHANGE_ESTIMATE, C.SUMMARY, C.CHANGE_COMPARE):
            cm = detect_columns(ws_f, r.header_row)
            if cm and mapping_overrides and r.sheet in mapping_overrides:
                cm = apply_user_mapping(cm, mapping_overrides[r.sheet])
            if not cm or "name" not in cm.fields:
                unidentified.append(f"[{r.sheet}] 열 구조를 인식하지 못함 - 열 매핑 편집기에서 지정하세요")
                continue
            column_maps[r.sheet] = cm.as_dict()
            ps = parse_estimate_sheet(ws_v, ws_f, cm)
            parsed[r.sheet] = ps
            if ps.is_two_row_change and r.role == C.ESTIMATE:
                r.role = C.CHANGE_ESTIMATE
                r.reasons.append("당초/변경 2행 구조 감지")
            validations[r.sheet] = validate_sheet(ps)
        elif r.role == C.COST:
            try:
                cost_sheets[r.sheet] = parse_cost_sheet(ws_v, ws_f)
            except Exception as e:  # noqa: BLE001
                unidentified.append(f"[{r.sheet}] 원가계산서 해석 실패: {e}")
        elif r.role == C.UNIT_PRICE:
            cm = detect_columns(ws_f, r.header_row)
            if cm and "name" in cm.fields:
                try:
                    unit_prices[r.sheet] = parse_unit_price_sheet(ws_v, ws_f, cm)
                except Exception as e:  # noqa: BLE001
                    unidentified.append(f"[{r.sheet}] 일위대가 해석 실패: {e}")
        elif r.role in (C.MATERIAL, C.LABOR, C.UNIT_PRICE_INDEX, C.QUANTITY):
            try:
                t = parse_table_sheet(ws_v, ws_f)
                if t["rows"]:
                    t["kind"] = {C.MATERIAL: "material", C.LABOR: "labor", C.UNIT_PRICE_INDEX: "unit_price_index", C.QUANTITY: "quantity"}[r.role]
                    price_tables[r.sheet] = t
            except Exception as e:  # noqa: BLE001
                unidentified.append(f"[{r.sheet}] 표 해석 실패: {e}")
        elif r.role == C.UNKNOWN:
            unidentified.append(f"[{r.sheet}] 역할 미확인 - 시트 역할을 지정하세요")

    estimate_sheets = pick_estimate_sheets(roles, parsed, bundle)
    primary = estimate_sheets[0] if estimate_sheets else None
    # 원가계산서: 금액이 가장 많이 채워진 것
    cost_cands = [cost_sheets[r.sheet] for r in roles if r.role == C.COST and r.sheet in cost_sheets]
    primary_cost = max(cost_cands, key=lambda c: sum(1 for l in c["lines"] if l["amount"] is not None), default=None)

    grand_d = {k: Decimal(0) for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt")}
    sec_totals: list[dict] = []
    for sname in estimate_sheets:
        for k, v in parsed[sname].totals().items():
            grand_d[k] += v
        for st in section_totals(parsed[sname]):
            st["sheet"] = sname
            sec_totals.append(st)
    cost_compare = compare_with_cost_sheet(grand_d, primary_cost, sec_totals) if primary else []
    grand = {k: str(v) for k, v in grand_d.items()}
    return {
        "file": bundle.summary(),
        "roles": [r.as_dict() for r in roles],
        "column_maps": column_maps,
        "estimate_sheets": estimate_sheets,
        "section_totals": sec_totals,
        "primary_estimate": primary,
        "primary_cost_sheet": primary_cost["sheet"] if primary_cost else None,
        "has_cost_sheet": bool(cost_sheets),
        "has_unit_price": bool(unit_prices),
        "grand_totals": grand,
        "validations": validations,
        "cost_sheets": cost_sheets,
        "cost_compare": cost_compare,
        "unit_price_count": {k: len(v) for k, v in unit_prices.items()},
        "price_tables": {k: {"kind": v["kind"], "title": v["title"], "rows": len(v["rows"]), "columns": len(v["columns"])} for k, v in price_tables.items()},
        "unidentified": unidentified,
        "_parsed": parsed,          # 내부용 (DB 저장 시 사용)
        "_unit_prices": unit_prices,
        "_price_tables": price_tables,
        "_bundle": bundle,
    }


def strip_internal(result: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in result.items() if not k.startswith("_")}
