"""원본 금액 검증: 수량×단가 재계산, 공종 소계 대조, 원가계산서 대조."""
from __future__ import annotations

import re

from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP, ROUND_UP, ROUND_FLOOR
from typing import Any

from .parser import ParsedSheet, RoundingRule, ROW_ITEM, ROW_SUBTOTAL, ROW_SECTION


def apply_rounding(v: Decimal, rule: RoundingRule | None) -> Decimal:
    if v is None:
        return v
    if rule is None or rule.func == "none":
        return v
    q = Decimal(1).scaleb(-rule.digits)
    if rule.func in ("trunc", "rounddown"):
        return v.quantize(q, rounding=ROUND_DOWN)
    if rule.func == "int":
        return v.quantize(Decimal(1), rounding=ROUND_FLOOR)
    if rule.func == "roundup":
        return v.quantize(q, rounding=ROUND_UP)
    return v.quantize(q, rounding=ROUND_HALF_UP)


def validate_sheet(ps: ParsedSheet, tolerance: Decimal = Decimal("1")) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    checked = 0
    mismatch = 0
    # 1) 품목 수량×단가 = 금액
    for it in ps.item_rows():
        if it.qty is None:
            continue
        for k in ("mat", "lab", "exp"):
            price = getattr(it, f"{k}_price")
            amt = getattr(it, f"{k}_amt")
            if price is None or amt is None:
                continue
            checked += 1
            calc = apply_rounding(it.qty * price, ps.rounding.get(f"{k}_amt"))
            if abs(calc - amt) > tolerance:
                is_rate_row = it.unit in ("식", "식_") or any(w in it.name for w in ("손료", "잡재료", "부속", "잡비", "할증"))
                if is_rate_row:
                    findings.append({"type": "rate_row", "row": it.row, "uid": it.uid, "field": f"{k}_amt", "name": it.name,
                                     "expected": str(calc), "actual": str(amt),
                                     "message": f"{it.row}행 {it.name}: 요율 산정 행(식) - 수량×단가와 금액이 다름 (정상일 수 있음)"})
                    continue
                mismatch += 1
                findings.append({"type": "amount_mismatch", "row": it.row, "uid": it.uid, "field": f"{k}_amt",
                                 "name": it.name, "expected": str(calc), "actual": str(amt),
                                 "message": f"{it.row}행 {it.name}: {k} 수량×단가={calc} 이나 금액={amt}"})
        if it.tot_amt is not None and any(getattr(it, f"{k}_amt") is not None for k in ("mat", "lab", "exp")):
            s = sum((getattr(it, f"{k}_amt") or Decimal(0)) for k in ("mat", "lab", "exp"))
            if abs(s - it.tot_amt) > tolerance:
                findings.append({"type": "total_mismatch", "row": it.row, "uid": it.uid, "field": "tot_amt",
                                 "name": it.name, "expected": str(s), "actual": str(it.tot_amt),
                                 "message": f"{it.row}행 {it.name}: 재료+노무+경비={s} 이나 합계={it.tot_amt}"})
        for iss in it.issues:
            findings.append({"type": "item_issue", "row": it.row, "uid": it.uid, "name": it.name, "message": f"{it.row}행 {it.name}: {iss}"})

    # 2) 소계행 = 직전 구간 품목 합
    keys = ("mat_amt", "lab_amt", "exp_amt", "tot_amt")
    acc = {k: Decimal(0) for k in keys}
    acc2 = {k: Decimal(0) for k in keys}   # 2행형 변경값 합
    subtotal_checked = 0
    pending_subtotal = None
    for it in ps.items:
        if it.row_type == ROW_ITEM:
            for k in keys:
                v = getattr(it, k)
                if v is not None:
                    acc[k] += v
                cv = it.change.get(k) if it.change else None
                if cv is not None:
                    acc2[k] += cv
        elif it.row_type == ROW_SUBTOTAL:
            if ps.is_two_row_change and pending_subtotal is not None and it.row == pending_subtotal.row + 1:
                # 2행형 소계: 둘째 행은 변경 소계
                pending_subtotal = None
                continue
            subtotal_checked += 1
            for k in keys:
                v = getattr(it, k)
                if v is None:
                    continue
                if abs(acc[k] - v) > tolerance and not (ps.is_two_row_change and abs(acc2[k] - v) <= tolerance):
                    findings.append({"type": "subtotal_mismatch", "row": it.row, "field": k,
                                     "expected": str(acc[k]), "actual": str(v),
                                     "message": f"{it.row}행 소계 {k}: 품목합={acc[k]} 이나 소계={v}"})
            acc = {k: Decimal(0) for k in keys}
            acc2 = {k: Decimal(0) for k in keys}
            pending_subtotal = it

    totals = ps.totals()
    return {
        "sheet": ps.sheet,
        "item_count": len(ps.item_rows()),
        "section_count": sum(1 for i in ps.items if i.row_type == ROW_SECTION),
        "checked": checked,
        "mismatch": mismatch,
        "subtotal_checked": subtotal_checked,
        "totals": {k: str(v) for k, v in totals.items()},
        "rounding": {k: v.as_dict() for k, v in ps.rounding.items()},
        "findings": findings[:500],
        "finding_count": len(findings),
        "ok": len(findings) == 0,
    }


EXCLUDE_SECTION_WORDS = ("관급", "지급자재", "발주자", "별도")


def compare_with_cost_sheet(totals: dict[str, Decimal], cost: dict[str, Any] | None,
                            section_totals: list[dict] | None = None) -> list[dict[str, Any]]:
    """내역서 합계와 원가계산서의 직접재료비/직접노무비 대조.
    관급자재 등 최상위 공종은 제외한 합계와도 비교하여 일치하는 쪽을 보고한다."""
    out = []
    if not cost:
        return out
    # 관급 등 제외 합계
    excl = {k: Decimal(0) for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt")}
    excluded_names = []
    for st in section_totals or []:
        if any(w in st["section"].replace(" ", "") for w in EXCLUDE_SECTION_WORDS):
            excluded_names.append(st["section"])
            continue
        for k in excl:
            excl[k] += Decimal(st[k])
    want = {"mat_amt": ["직접재료비", "재료비", "사급재료비"], "lab_amt": ["직접노무비", "노무비"], "exp_amt": ["기계경비"]}
    for k, names in want.items():
        for line in cost["lines"]:
            n = re.sub(r"^[\(\[]?\s*[가-힣a-zA-Z0-9ⅠⅡⅢⅣⅤ]{1,2}[\.\)]\s*", "", line["name"].replace(" ", ""))
            if any(n.startswith(w) for w in names) and line["amount"] is not None:
                a = Decimal(line["amount"])
                b = totals.get(k, Decimal(0))
                c = excl.get(k, Decimal(0))
                ok_all = abs(a - b) <= 1
                ok_excl = abs(a - c) <= 1
                out.append({"field": k, "cost_line": line["name"], "cost_amount": str(a), "estimate_total": str(b),
                            "estimate_total_excl": str(c), "excluded_sections": excluded_names,
                            "diff": str(a - (c if (ok_excl and not ok_all) else b)), "ok": ok_all or ok_excl,
                            "matched": "all" if ok_all else ("excluding_sections" if ok_excl else "none")})
                break
    return out
