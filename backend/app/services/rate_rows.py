"""요율행(공구손료 "노무비의 2%" 등) 기준금액 수식의 간이 평가기.

내역서에서 단가칸이 =SUMIF(O6:O17,"02",H6:H17) 또는 =SUM(H6:H17) 처럼 같은 시트의 금액 열을 합산하는 수식인 경우,
조정된 금액(새 노무비/재료비)으로 다시 합산해 기준금액을 구한다. 그 외 수식은 None 을 돌려주고 호출측이 비례 조정으로 대체한다.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Callable

from openpyxl.utils import column_index_from_string, get_column_letter

Lookup = Callable[[int, int], object]   # (row, col) -> 값 (조정 반영)

_REF = r"\$?([A-Z]{1,3})\$?(\d+)"
_RANGE = rf"{_REF}:{_REF}"
_SUMIF = re.compile(rf'SUMIF\(\s*{_RANGE}\s*,\s*("(?:[^"]*)"|[^,()]+)\s*,\s*{_RANGE}\s*\)', re.I)
_SUM = re.compile(rf"SUM\(\s*{_RANGE}\s*\)", re.I)
_CELL = re.compile(rf"(?<![A-Z!\"]){_REF}(?![\d(])")
_SAFE = re.compile(r"^[\d\s.+\-*/()]+$")


def _num(v) -> Decimal:
    if v is None or v == "":
        return Decimal(0)
    if isinstance(v, bool):
        return Decimal(int(v))
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v))
    try:
        return Decimal(str(v).replace(",", ""))
    except Exception:
        return Decimal(0)


def _crit_match(v, crit: str) -> bool:
    c = crit.strip()
    if c.startswith('"') and c.endswith('"'):
        c = c[1:-1]
    if c[:2] in (">=", "<=", "<>") or c[:1] in ("<", ">"):
        op = c[:2] if c[:2] in (">=", "<=", "<>") else c[:1]
        rhs = _num(c[len(op):])
        lv = _num(v)
        return {"<>": lv != rhs, ">=": lv >= rhs, "<=": lv <= rhs, ">": lv > rhs, "<": lv < rhs}[op]
    if v is None:
        return c == ""
    sv = str(v).strip()
    if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool):
        try:
            return _num(v) == _num(c)
        except Exception:
            return False
    return sv.lower() == c.lower()


def evaluate_base(formula: str, lookup: Lookup) -> Decimal | None:
    """같은 시트 안의 SUM/SUMIF/셀참조 + 사칙연산으로만 이뤄진 수식을 평가. 지원 못 하면 None."""
    if not formula or not formula.startswith("="):
        return None
    f = formula[1:]
    if "!" in f:
        return None   # 다른 시트 참조는 미지원

    def sumif(m: re.Match) -> str:
        c1, r1, c2, r2, crit, s1, sr1, s2, sr2 = m.groups()
        c1i, c2i = column_index_from_string(c1), column_index_from_string(c2)
        s1i = column_index_from_string(s1)
        total = Decimal(0)
        for i, r in enumerate(range(int(r1), int(r2) + 1)):
            for j, c in enumerate(range(c1i, c2i + 1)):
                if _crit_match(lookup(r, c), crit):
                    total += _num(lookup(int(sr1) + i, s1i + j))
        return f"({total})"

    def summ(m: re.Match) -> str:
        c1, r1, c2, r2 = m.groups()
        total = Decimal(0)
        for r in range(int(r1), int(r2) + 1):
            for c in range(column_index_from_string(c1), column_index_from_string(c2) + 1):
                total += _num(lookup(r, c))
        return f"({total})"

    def cell(m: re.Match) -> str:
        return f"({_num(lookup(int(m.group(2)), column_index_from_string(m.group(1))))})"

    f = _SUMIF.sub(sumif, f)
    f = _SUM.sub(summ, f)
    f = _CELL.sub(cell, f)
    if not _SAFE.match(f):
        return None
    try:
        return Decimal(str(eval(f, {"__builtins__": {}}, {})))  # noqa: S307 - 숫자/사칙연산만 통과시킨 문자열
    except Exception:
        return None


__all__ = ["evaluate_base", "get_column_letter"]
