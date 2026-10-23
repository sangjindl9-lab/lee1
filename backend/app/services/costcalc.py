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


def compute_cost_sheet(rules: list[CostRateRule], direct: dict[str, Decimal], rounding_rule: dict | None = None) -> list[dict]:
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
    for r in rules:
        n = _norm(r.name)
        amt: Decimal | None = None
        if n.startswith("직접재료비"):
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
            elif base in ("총원가", "공급가액"):
                base_amt = values.get("총원가", values.get("공급가액", ZERO))
            if base_amt is not None:
                amt = round_by(base_amt * D(r.rate) / 100, rr)
        if amt is None and r.kind == "line" and r.amount is not None and r.rate is None:
            amt = D(r.amount)   # 요율 없는 고정 금액 비목
        if amt is None and r.kind in ("subtotal", "total"):
            amt = None  # 소계는 출력 시 수식으로
        if amt is not None:
            if n.startswith("간접노무비"):
                indirect_lab = amt
            elif n.startswith("일반관리비"):
                values["일반관리비"] = amt
            elif n.startswith("건강보험료"):
                values["건강보험료"] = amt
            elif r.kind == "line" and not (n.startswith("직접") or n.startswith("기계경비") or n.startswith("간접노무") or n.startswith("일반관리") or n.startswith("이윤") or n.startswith("부가")):
                exp_items.append(amt)
            if n.startswith("총원가") or n.startswith("공급가액"):
                values["총원가"] = amt
        out.append({"id": r.id, "name": r.name, "kind": r.kind, "rate": str(r.rate) if r.rate is not None else None,
                    "rate_base": r.rate_base, "base_text": r.base_text, "fixed": r.fixed,
                    "original_amount": str(r.amount) if r.amount is not None else None,
                    "amount": str(amt) if amt is not None else None})
    return out
