"""원가계산서 제비율 재계산 (원본 비목 구조 + 요율 보존, 직접공사비 변경 시 재산정)."""
from __future__ import annotations

import re
from decimal import Decimal

from ..models import CostRateRule
from .calc import D, ZERO, round_by

BASE_ALIASES = {
    "직접재료비": ["직접재료비", "재료비", "직재"],
    "직접노무비": ["직접노무비", "직노", "직접노무"],
    "노무비": ["노무비", "노무"],
    "재료비+직접노무비": ["재료+직노", "재료비+직접노무비", "재료+직접노무비", "직재+직노", "재료비+직노"],
    "재료비+노무비": ["재료+노무", "재료비+노무비"],
    "재료비+노무비+경비": ["재료+노무+경비", "재료비+노무비+경비", "순공사비", "순공사원가"],
    "노무비+경비+일반관리비": ["노무+경비+일반관리비", "노무비+경비+일반관리비"],
    "건강보험료": ["건강보험료", "건강보험"],
    "총원가": ["총원가"],
}


def _norm(n: str) -> str:
    return re.sub(r"[\s\(\)\[\]·,]", "", n or "")


def classify_line(name: str) -> str:
    n = _norm(name)
    if n.startswith("직접재료비"):
        return "direct_mat"
    if n.startswith("직접노무비"):
        return "direct_lab"
    if n.startswith("간접노무비"):
        return "indirect_lab"
    if n.startswith("기계경비"):
        return "direct_exp"
    if n.startswith("일반관리비"):
        return "overhead"
    if n.startswith("이윤"):
        return "profit"
    if n.startswith("부가가치세") or n.startswith("부가세"):
        return "vat"
    if "순공사" in n:
        return "net"
    if n.startswith("총원가") or n.startswith("공급가액") or (n.startswith("계약금액") and "부가" not in n):
        return "total_cost"
    if n.startswith("총공사비") or n.startswith("도급") or n.startswith("총계") or n.startswith("합계"):
        return "grand"
    return "line"


def compute_cost_sheet(rules: list[CostRateRule], direct: dict[str, Decimal], rounding_rule: dict | None = None,
                       overrides: dict[str, Decimal] | None = None) -> list[dict]:
    """overrides: {"profit": 금액} 처럼 특정 비목 금액을 강제 (낙찰금액 맞추기)."""
    lines, _ = compute_cost_sheet_full(rules, direct, rounding_rule, overrides)
    return lines


def compute_cost_sheet_full(rules: list[CostRateRule], direct: dict[str, Decimal], rounding_rule: dict | None = None,
                            overrides: dict[str, Decimal] | None = None) -> tuple[list[dict], dict]:
    """direct = {"mat": 직접재료비, "lab": 직접노무비, "exp": 기계경비(직접경비)}
    각 비목을 순서대로 계산한다. 요율이 있는 비목은 rate_base 로 기준금액을 찾아 계산,
    요율이 없고 fixed 인 비목은 원본 금액 유지, 소계/합계는 구조상 직전 블록 합으로 추정."""
    rr = rounding_rule or {"func": "trunc", "digits": 0}
    values: dict[str, Decimal] = {}   # 정규화 비목명 -> 금액
    out = []
    mat, lab, exp = D(direct.get("mat")), D(direct.get("lab")), D(direct.get("exp"))
    values["직접재료비"] = mat
    values["직접노무비"] = lab
    values["기계경비"] = exp
    indirect_lab = ZERO
    exp_items: list[Decimal] = [exp]
    post_items: list[Decimal] = []     # 순공사비 이후(일반관리비/이윤 외) 비목: 총원가에는 포함, 순공사비에는 미포함
    seen_net = False
    overrides = overrides or {}
    summary: dict[str, Decimal | None] = {"overhead": ZERO, "profit": ZERO, "vat": None, "profit_rate_cap": None, "profit_base": None}
    for r in rules:
        n = _norm(r.name)
        cat = classify_line(r.name)
        amt: Decimal | None = None
        if cat in overrides and overrides[cat] is not None:
            amt = D(overrides[cat])
        elif n.startswith("직접재료비"):
            amt = mat
        elif n.startswith("직접노무비"):
            amt = lab
        elif n.startswith("기계경비"):
            amt = exp
        elif r.fixed and r.amount is not None:
            amt = D(r.amount)
        elif r.rate is not None:
            base = _norm(r.rate_base)
            base_amt = None
            if base in ("직접노무비", "직노", "직접노무"):
                base_amt = lab
            elif base in ("노무비", "노무"):
                base_amt = lab + indirect_lab
            elif base in ("재료+직노", "재료비+직접노무비", "재료+직접노무비", "직재+직노", "재료비+직노", "재료+직노비"):
                base_amt = mat + lab
            elif base in ("재료+노무", "재료비+노무비"):
                base_amt = mat + lab + indirect_lab
            elif base in ("재료+노무+경비", "재료비+노무비+경비", "순공사비", "순공사원가"):
                base_amt = mat + lab + indirect_lab + sum(exp_items)
            elif base in ("노무+경비+일반관리비", "노무비+경비+일반관리비"):
                base_amt = lab + indirect_lab + sum(exp_items) + values.get("일반관리비", ZERO)
            elif base in ("건강보험료", "건강보험"):
                base_amt = values.get("건강보험료", ZERO)
            elif base in ("순계약금액", "순계약", "순공사비+일반관리비+이윤", "계약금액"):
                base_amt = mat + lab + indirect_lab + sum(exp_items) + values.get("일반관리비", ZERO) + values.get("이윤", ZERO)
            elif base in ("총원가", "공급가액"):
                base_amt = values.get("총원가", values.get("공급가액", ZERO))
            if cat == "profit":
                summary["profit_rate_cap"] = D(r.rate)
                summary["profit_base"] = base_amt
            if base_amt is not None:
                lr = {"func": rr.get("func", "trunc"), "digits": int(r.round_digits or 0)} if (r.round_digits or 0) != 0 else rr
                amt = round_by(base_amt * D(r.rate) / 100, lr) if r.round_digits is not None else base_amt * D(r.rate) / 100
            if cat == "vat" and base_amt is None:
                # 부가세 기준을 못 읽으면 총원가(순공사비+일반관리비+이윤+후행비목) × 요율
                tc = mat + lab + indirect_lab + sum(exp_items) + values.get("일반관리비", ZERO) + values.get("이윤", ZERO) + sum(post_items)
                amt = round_by(tc * D(r.rate) / 100, rr)
                summary["vat_rate"] = D(r.rate)
        if amt is None and r.kind == "line" and r.amount is not None and r.rate is None:
            amt = D(r.amount)   # 요율 없는 고정 금액 비목
        if amt is None and r.kind in ("subtotal", "total"):
            amt = None  # 소계는 출력 시 수식으로
        if cat in ("net", "total_cost", "grand"):
            amt = None          # 구조 합계는 항상 재계산
        if amt is None and r.rate is not None and r.amount is not None and r.kind == "line" and cat == "line":
            amt = D(r.amount)   # 요율 기준을 해석하지 못한 비목은 원본 금액 유지
        if amt is None and cat == "profit" and r.rate is None and r.amount is not None:
            amt = D(r.amount)
        if amt is not None:
            if cat == "indirect_lab":
                indirect_lab = amt
            elif cat == "overhead":
                values["일반관리비"] = amt
                summary["overhead"] = amt
            elif cat == "profit":
                values["이윤"] = amt
                summary["profit"] = amt
            elif cat == "vat":
                summary["vat"] = amt
            elif n.startswith("건강보험료"):
                values["건강보험료"] = amt
                exp_items.append(amt)
            elif r.kind == "line" and cat == "line":
                (post_items if seen_net else exp_items).append(amt)
            if cat == "total_cost":
                values["총원가"] = amt
        # 소계/합계 행은 구조 합계로 산정
        if cat == "net":
            amt = mat + lab + indirect_lab + sum(exp_items)
            seen_net = True
        if cat in ("overhead", "profit"):
            seen_net = True
        if cat == "total_cost" and amt is None:
            amt = round_by(mat + lab + indirect_lab + sum(exp_items) + values.get("일반관리비", ZERO) + values.get("이윤", ZERO) + sum(post_items), rr)
            values["총원가"] = amt
        elif cat == "grand" and amt is None:
            amt = round_by(mat + lab + indirect_lab + sum(exp_items) + values.get("일반관리비", ZERO) + values.get("이윤", ZERO) + sum(post_items), rr) + (summary["vat"] or ZERO)
        out.append({"id": r.id, "name": r.name, "kind": r.kind, "cat": cat, "rate": str(r.rate) if r.rate is not None else None,
                    "rate_base": r.rate_base, "base_text": r.base_text, "fixed": r.fixed,
                    "original_amount": str(r.amount) if r.amount is not None else None,
                    "amount": str(amt) if amt is not None else None})
    net = mat + lab + indirect_lab + sum(exp_items)
    total_cost = round_by(net + D(summary["overhead"]) + D(summary["profit"]) + sum(post_items), rr)   # 총원가 = TRUNC(합계)
    vat = summary["vat"]
    if vat is None and any(classify_line(r.name) == "vat" for r in rules):
        vat = round_by(total_cost * Decimal("0.1"), rr)
    summary.update({"direct": mat + lab + exp, "indirect_lab": indirect_lab, "net": net, "total_cost": total_cost,
                    "vat": vat, "grand": total_cost + (vat or ZERO)})
    return out, summary


def fit_profit(rules: list[CostRateRule], direct: dict[str, Decimal], target: Decimal, include_vat: bool,
               rounding_rule: dict | None = None) -> dict:
    """낙찰금액(target)에 맞춰 이윤을 역산. include_vat 면 target 은 부가세 포함 총공사비."""
    rr = rounding_rule or {"func": "trunc", "digits": 0}
    _, base = compute_cost_sheet_full(rules, direct, rr, {"profit": ZERO})
    has_vat = base["vat"] is not None
    other = base["total_cost"]          # 이윤 0 일 때 총원가 (절사)
    warnings = []
    if include_vat and has_vat:
        vr = D(base.get("vat_rate") or 10) / 100
        # T + round(T*vr) == target 인 T 탐색 (부가세 절사 가정)
        t0 = (target / (1 + vr)).to_integral_value(rounding="ROUND_FLOOR")
        best = None
        for d in range(-3, 4):
            t = t0 + d
            if t + round_by(t * vr, rr) == target:
                best = t
                break
        if best is None:
            best = t0
            warnings.append("부가세 절사 때문에 총공사비를 1원 단위까지 정확히 맞출 수 없어 가장 가까운 값으로 맞췄습니다.")
        target_cost = best
    else:
        target_cost = target
    profit = target_cost - other
    lines, summ = compute_cost_sheet_full(rules, direct, rr, {"profit": profit})
    # 이윤에 연동되는 후행 비목(배상책임공제료 등)이 있으면 수렴할 때까지 보정
    for _ in range(8):
        gap = target_cost - summ["total_cost"]
        if gap == 0:
            break
        profit += gap
        lines, summ = compute_cost_sheet_full(rules, direct, rr, {"profit": profit})
    cap = summ.get("profit_rate_cap")
    pbase = summ.get("profit_base")
    rate = (profit / pbase * 100).quantize(Decimal("0.01")) if pbase else None
    if profit < 0:
        warnings.append(f"이윤이 음수({profit})가 됩니다. 재료비/노무비 적용률을 더 낮춰야 합니다.")
    if cap is not None and rate is not None and rate > cap:
        warnings.append(f"이윤율 {rate}% 가 원가계산서 요율 {cap}% 를 초과합니다. 재료비/노무비 적용률을 올리세요.")
    return {"lines": lines, "summary": summ, "profit": profit, "profit_rate": rate, "profit_cap": cap,
            "target": target, "target_cost": target_cost, "diff": summ["grand"] - target if include_vat else summ["total_cost"] - target,
            "warnings": warnings}

