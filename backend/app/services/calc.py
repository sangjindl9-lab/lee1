"""Decimal 기반 금액 계산 공통 규칙."""
from __future__ import annotations

from decimal import Decimal, ROUND_DOWN, ROUND_FLOOR, ROUND_HALF_UP, ROUND_UP

ZERO = Decimal(0)


def D(v) -> Decimal:
    if v is None or v == "":
        return ZERO
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def round_by(v: Decimal, rule: dict | None) -> Decimal:
    """rule: {"func": "trunc|round|rounddown|roundup|int|none", "digits": 0}"""
    if v is None:
        return ZERO
    if not rule or rule.get("func", "none") == "none":
        return v
    digits = int(rule.get("digits", 0))
    q = Decimal(1).scaleb(-digits)
    f = rule["func"]
    if f in ("trunc", "rounddown"):
        return v.quantize(q, rounding=ROUND_DOWN)
    if f == "int":
        return v.quantize(Decimal(1), rounding=ROUND_FLOOR)
    if f == "roundup":
        return v.quantize(q, rounding=ROUND_UP)
    return v.quantize(q, rounding=ROUND_HALF_UP)


DEFAULT_ROUNDING = {"amount": {"func": "trunc", "digits": 0}, "qty_digits": 4, "total": {"func": "none", "digits": 0}}


def project_rounding(project) -> dict:
    r = dict(DEFAULT_ROUNDING)
    if project and project.rounding:
        r.update(project.rounding)
    return r


def line_amounts(qty: Decimal, mat_price, lab_price, exp_price, rounding: dict) -> dict[str, Decimal]:
    rule = rounding.get("amount")
    mat = round_by(qty * D(mat_price), rule)
    lab = round_by(qty * D(lab_price), rule)
    exp = round_by(qty * D(exp_price), rule)
    return {"mat_amt": mat, "lab_amt": lab, "exp_amt": exp, "tot_amt": mat + lab + exp}


def s(v: Decimal | None) -> str | None:
    return None if v is None else format(v, "f")
