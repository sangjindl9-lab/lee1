"""내역서 시트 파서: 행 유형 판별, 공종 트리, 품목 추출, 수식 출처·반올림 규칙 감지."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from openpyxl.worksheet.worksheet import Worksheet

from .column_mapper import ColumnMap
from .loader import cell_text, norm_text

ROW_SECTION = "section"     # 공종 제목행
ROW_ITEM = "item"           # 품목행
ROW_SUBTOTAL = "subtotal"   # 소계/합계
ROW_BLANK = "blank"
ROW_CHANGE = "change_row"   # 변경내역서의 변경행(2행형)
ROW_OTHER = "other"

SECTION_MARKERS = {"공종줄"}
SUBTOTAL_MARKERS = {"합계줄", "소계줄"}
SUBTOTAL_WORDS = ["합계", "소계", "계", "총계", "총합계"]
REGION_WORDS = {"재료비": "mat", "직접재료비": "mat", "사급": "mat", "지입": "mat", "관급": "mat",
                "직접노무비": "lab", "노무비": "lab", "간접노무비": "cost", "경비": "exp", "도급분경비": "cost",
                "일반관리비": "cost", "이윤": "cost", "총공사비": "cost", "추정금액": "cost", "추정가격": "cost",
                "부가가치세": "cost", "총원가": "cost", "순공사비": "cost"}
SECTION_NUM_RE = re.compile(r"^\s*[\dⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ①-⑩]+[\.\-\d]*\s*[\.\)]?\s*\S")
ROUND_RE = re.compile(r"(TRUNC|ROUNDDOWN|ROUNDUP|ROUND|INT)\s*\(([^()]*(?:\([^()]*\))*[^()]*)\)", re.I)
SHEET_REF_RE = re.compile(r"(?:'((?:[^']|'')+)'|([A-Za-z0-9_가-힣\.\-\(\) ]+))!\$?([A-Z]{1,3})\$?(\d+)")


def to_decimal(v: Any) -> Decimal | None:
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        try:
            return Decimal(str(v))
        except InvalidOperation:
            return None
    s = str(v).replace(",", "").strip()
    if s in ("", "-"):
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


@dataclass
class RoundingRule:
    func: str = "none"   # trunc / round / rounddown / roundup / int / none
    digits: int = 0

    def as_dict(self):
        return {"func": self.func, "digits": self.digits}


@dataclass
class ParsedItem:
    uid: str
    row: int
    row_type: str
    level: int
    section_path: list[str]
    name: str
    spec: str = ""
    unit: str = ""
    qty: Decimal | None = None
    mat_price: Decimal | None = None
    mat_amt: Decimal | None = None
    lab_price: Decimal | None = None
    lab_amt: Decimal | None = None
    exp_price: Decimal | None = None
    exp_amt: Decimal | None = None
    tot_price: Decimal | None = None
    tot_amt: Decimal | None = None
    note: str = ""
    work_code: str = ""
    item_code: str = ""
    code: str = ""
    cost_region: str = ""           # 단일금액 양식의 재료비/노무비 구역
    price_source: dict[str, str] = field(default_factory=dict)   # mat_price -> "일대목차!I37"
    qty_source: str = ""
    formulas: dict[str, str] = field(default_factory=dict)
    issues: list[str] = field(default_factory=list)
    change: dict[str, Any] = field(default_factory=dict)   # 2행형 변경내역서: 변경행 값

    def as_dict(self):
        d = {
            "uid": self.uid, "row": self.row, "row_type": self.row_type, "level": self.level,
            "section_path": self.section_path, "name": self.name, "spec": self.spec, "unit": self.unit,
            "note": self.note, "work_code": self.work_code, "item_code": self.item_code, "code": self.code,
            "cost_region": self.cost_region, "price_source": self.price_source, "qty_source": self.qty_source,
            "issues": self.issues, "change": {k: (str(v) if isinstance(v, Decimal) else v) for k, v in self.change.items()},
        }
        for k in ("qty", "mat_price", "mat_amt", "lab_price", "lab_amt", "exp_price", "exp_amt", "tot_price", "tot_amt"):
            v = getattr(self, k)
            d[k] = str(v) if v is not None else None
        return d


@dataclass
class ParsedSheet:
    sheet: str
    column_map: ColumnMap
    items: list[ParsedItem]
    rounding: dict[str, RoundingRule]
    is_two_row_change: bool = False
    issues: list[str] = field(default_factory=list)

    def item_rows(self) -> list[ParsedItem]:
        return [i for i in self.items if i.row_type == ROW_ITEM]

    def totals(self) -> dict[str, Decimal]:
        t = {k: Decimal(0) for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt")}
        for i in self.item_rows():
            for k in t:
                v = getattr(i, k)
                if v is not None:
                    t[k] += v
        return t


def detect_rounding(formula: str | None) -> RoundingRule:
    if not formula or not isinstance(formula, str):
        return RoundingRule()
    m = ROUND_RE.search(formula)
    if not m:
        return RoundingRule()
    fn = m.group(1).upper()
    inner = m.group(2)
    digits = 0
    parts = inner.rsplit(",", 1)
    if len(parts) == 2 and parts[1].strip().lstrip("-").isdigit():
        digits = int(parts[1].strip())
    return RoundingRule(func=fn.lower(), digits=digits)


def _formula_ref(formula: Any) -> str:
    """단가 수식의 참조 대상(시트!셀)을 문자열로."""
    if not isinstance(formula, str) or not formula.startswith("="):
        return ""
    m = SHEET_REF_RE.search(formula)
    if m:
        return f"{(m.group(1) or m.group(2)).strip()}!{m.group(3)}{m.group(4)}"
    return formula[:60]


def _get(ws_v: Worksheet, ws_f: Worksheet, r: int, c: int | None):
    if not c:
        return None, None
    return ws_v.cell(r, c).value, ws_f.cell(r, c).value


def make_uid(sheet: str, path: list[str], row: int, code: str, name: str, spec: str, unit: str) -> str:
    key = "|".join([sheet, "::".join(path), code or "", name, spec, unit, str(row)])
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def _row_values(ws_v, r, cm: ColumnMap) -> dict[str, Any]:
    return {f: ws_v.cell(r, c).value for f, c in cm.fields.items()}


def _is_section_text(name: str) -> bool:
    if not name:
        return False
    if "::" in name:
        return True
    if name.startswith("[") and name.endswith("]"):
        return True
    n = norm_text(name)
    if n in ("재료비", "노무비", "경비", "사급분", "지입분", "관급분"):
        return True
    return bool(SECTION_NUM_RE.match(name)) and not re.match(r"^\d+(\.\d+)?$", name.strip())


def _fallback_name(ws_v, r: int, cm: ColumnMap) -> str:
    """품명 열이 비어 있으면 왼쪽 열(No./코드 열)의 문자 텍스트를 제목으로 사용 (한전형 '[ 재 료 비 ]' 등)."""
    name_c = cm.col("name") or 1
    for c in range(1, name_c):
        t = cell_text(ws_v.cell(r, c).value)
        if t and not re.match(r"^[\d\.\-]+$", t) and t not in ("공종줄", "합계줄", "일목줄", "소계줄") and len(t) <= 60 \
                and re.search(r"[가-힣A-Za-z]", t):
            return t
    return ""


def row_name(ws_v, r: int, cm: ColumnMap, vals: dict | None = None) -> str:
    vals = vals or _row_values(ws_v, r, cm)
    return cell_text(vals.get("name")) or _fallback_name(ws_v, r, cm)


def classify_row(ws_v, ws_f, r: int, cm: ColumnMap, marker_col: int | None) -> str:
    vals = _row_values(ws_v, r, cm)
    name = row_name(ws_v, r, cm, vals)
    marker = cell_text(ws_v.cell(r, marker_col).value) if marker_col else ""
    if marker in SECTION_MARKERS:
        return ROW_SECTION
    if marker in SUBTOTAL_MARKERS:
        return ROW_SUBTOTAL
    qty = to_decimal(vals.get("qty"))
    amts = [to_decimal(vals.get(k)) for k in ("tot_amt", "mat_amt", "lab_amt", "exp_amt", "chg_amt", "orig_amt")]
    has_amt = any(a is not None for a in amts)
    unit = cell_text(vals.get("unit"))
    spec = cell_text(vals.get("spec"))
    if not name and qty is None and not has_amt and not unit:
        return ROW_BLANK
    n = norm_text(name)
    if name and any(n == norm_text(w) or n.startswith("(" + w) or n.replace("(", "").replace(")", "").strip() == w
                    for w in SUBTOTAL_WORDS):
        return ROW_SUBTOTAL
    if name and re.sub(r"[\s\(\)\[\]]", "", name) in ("합계", "소계", "총계", "총합계"):
        return ROW_SUBTOTAL
    if name and not unit and qty is None and not has_amt:
        return ROW_SECTION
    if name and not unit and qty is None and has_amt and _is_section_text(name):
        return ROW_SECTION  # 한전형 구역 합계행 (예: 'Ⅰ. 사급분' 금액만 있음)
    if not name and (qty is not None or has_amt):
        # 명칭 없는 수량/금액 행: 2행형 변경행 후보
        return ROW_CHANGE
    if name and (qty is not None or has_amt or unit):
        return ROW_ITEM
    return ROW_OTHER


def parse_estimate_sheet(ws_v: Worksheet, ws_f: Worksheet, cm: ColumnMap) -> ParsedSheet:
    items: list[ParsedItem] = []
    issues: list[str] = []
    rounding: dict[str, RoundingRule] = {}
    marker_col = cm.col("work_code")
    # 마커 열 추정: B열에 '공종줄'이 있으면 B
    for c in (2, 1, 3):
        for r in range(cm.data_start_row, min(ws_v.max_row, cm.data_start_row + 300) + 1):
            if cell_text(ws_v.cell(r, c).value) in SECTION_MARKERS | SUBTOTAL_MARKERS:
                marker_col = c
                break
        if marker_col == c:
            break

    path: list[str] = []
    marker_path: list[str] | None = None   # '::' 마커 공종 경로 (하위 제목행은 이 아래에 붙인다)
    region = ""
    last_item: ParsedItem | None = None
    two_row = False
    rounding_samples: dict[str, list[RoundingRule]] = {}

    for r in range(cm.data_start_row, ws_v.max_row + 1):
        rt = classify_row(ws_v, ws_f, r, cm, marker_col)
        if rt == ROW_BLANK:
            continue
        vals = _row_values(ws_v, r, cm)
        name = row_name(ws_v, r, cm, vals)
        if rt == ROW_SECTION:
            # 구역 판별 (단일 금액 양식)
            n = re.sub(r"^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\d가-힣]{0,2}[\.\)]?", "", norm_text(name).replace("[", "").replace("]", "")) \
                if not norm_text(name).startswith(("재료", "노무", "경비")) else norm_text(name).replace("[", "").replace("]", "")
            n0 = norm_text(name).replace("[", "").replace("]", "")
            for w, reg in sorted(REGION_WORDS.items(), key=lambda kv: -len(kv[0])):
                wn = norm_text(w)
                if n0.startswith(wn) or n.startswith(wn) or n0 == wn:
                    region = reg
                    break
            if "::" in name:
                path = [p.strip() for p in name.split("::") if p.strip()]
                marker_path = list(path)
            elif marker_path is not None and cell_text(ws_v.cell(r, marker_col).value) != "공종줄" if marker_col else False:
                # 마커 기반 시트의 비마커 제목행: 현재 공종 아래 하위 제목
                path = marker_path + [name]
            else:
                # 번호 깊이로 레벨 추정 (1. / 1-1. / 1-1-1.)
                m = re.match(r"^\s*([\d]+(?:[\-\.][\d]+)*)", name)
                level = len(re.split(r"[\-\.]", m.group(1))) if m else 1
                if level <= len(path):
                    path = path[: level - 1]
                path = path + [name]
            items.append(ParsedItem(uid=make_uid(ws_v.title, path, r, "", name, "", ""), row=r, row_type=rt,
                                    level=len(path), section_path=list(path), name=name, cost_region=region))
            last_item = None
            continue
        if rt == ROW_SUBTOTAL:
            it = ParsedItem(uid=make_uid(ws_v.title, path, r, "", name or "합계", "", ""), row=r, row_type=rt,
                            level=len(path), section_path=list(path), name=name or "합계")
            for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt"):
                setattr(it, k, to_decimal(vals.get(k)))
            items.append(it)
            last_item = None
            continue
        if rt == ROW_CHANGE:
            if last_item is not None:
                two_row = True
                ch = {}
                for k in ("qty", "mat_price", "mat_amt", "lab_price", "lab_amt", "exp_price", "exp_amt", "tot_price", "tot_amt"):
                    ch[k] = to_decimal(vals.get(k))
                last_item.change = ch
            else:
                issues.append(f"{r}행: 품명 없는 수량/금액 행")
            continue
        if rt != ROW_ITEM:
            continue
        if region == "cost" and not cm.has_cost_split():
            # 원가계산 구역(일반관리비/이윤/총공사비 등)의 행은 품목이 아님
            items.append(ParsedItem(uid=make_uid(ws_v.title, path, r, "", name, "", ""), row=r, row_type=ROW_OTHER,
                                    level=len(path) + 1, section_path=list(path), name=name, cost_region="cost"))
            continue

        spec = cell_text(vals.get("spec"))
        unit = cell_text(vals.get("unit"))
        code = cell_text(vals.get("code")) or cell_text(vals.get("item_code"))
        it = ParsedItem(uid=make_uid(ws_v.title, path, r, code, name, spec, unit), row=r, row_type=ROW_ITEM,
                        level=len(path) + 1, section_path=list(path), name=name, spec=spec, unit=unit,
                        note=cell_text(vals.get("note")), work_code=cell_text(vals.get("work_code")),
                        item_code=cell_text(vals.get("item_code")), code=cell_text(vals.get("code")), cost_region=region)
        it.qty = to_decimal(vals.get("qty"))
        qf = ws_f.cell(r, cm.col("qty")).value if cm.col("qty") else None
        if isinstance(qf, str) and qf.startswith("="):
            it.qty_source = _formula_ref(qf)
            it.formulas["qty"] = qf
        for k in ("mat_price", "mat_amt", "lab_price", "lab_amt", "exp_price", "exp_amt", "tot_price", "tot_amt"):
            c = cm.col(k)
            if not c:
                continue
            v, f = _get(ws_v, ws_f, r, c)
            dv = to_decimal(v)
            if isinstance(v, str) and v.startswith("#"):
                it.issues.append(f"{k} 오류값 {v}")
            setattr(it, k, dv)
            if isinstance(f, str) and f.startswith("="):
                it.formulas[k] = f
                if k.endswith("_price"):
                    it.price_source[k] = _formula_ref(f)
                if k.endswith("_amt"):
                    rr = detect_rounding(f)
                    rounding_samples.setdefault(k, []).append(rr)
        # 단일 금액 양식: 구역에 따라 재료/노무로 배분
        if not cm.has_cost_split() and it.tot_amt is not None and region in ("mat", "lab", "exp"):
            setattr(it, f"{region}_amt", it.tot_amt)
            if it.tot_price is not None:
                setattr(it, f"{region}_price", it.tot_price)
        # 합계 보정
        if it.tot_amt is None and any(getattr(it, k) is not None for k in ("mat_amt", "lab_amt", "exp_amt")):
            it.tot_amt = sum((getattr(it, k) or Decimal(0)) for k in ("mat_amt", "lab_amt", "exp_amt"))
        if it.tot_price is None and any(getattr(it, k) is not None for k in ("mat_price", "lab_price", "exp_price")):
            it.tot_price = sum((getattr(it, k) or Decimal(0)) for k in ("mat_price", "lab_price", "exp_price"))
        if it.qty is None:
            it.issues.append("수량 없음")
        items.append(it)
        last_item = it

    # 2행형(당초/변경) 판정: 변경행이 품목의 절반 이상일 때만
    n_items = sum(1 for i in items if i.row_type == ROW_ITEM)
    n_change = sum(1 for i in items if i.row_type == ROW_ITEM and i.change)
    has_diff_header = "diff_amt" in cm.fields or any("증감" in norm_text(h) for h in cm.raw_headers.values())
    if two_row and n_items and n_change < n_items * (0.1 if has_diff_header else 0.5):
        two_row = False
    # 동일 품목 2행 반복형 (집계표: 같은 이름/규격/단위 연속 + 증감 열 존재)
    if not two_row and has_diff_header:
        merged: list[ParsedItem] = []
        prev: ParsedItem | None = None
        pairs = 0
        for it in items:
            if it.row_type == ROW_ITEM and prev is not None and prev.row_type == ROW_ITEM and not prev.change \
                    and (prev.name, prev.spec, prev.unit, prev.code) == (it.name, it.spec, it.unit, it.code) and it.row == prev.row + 1:
                prev.change = {k: getattr(it, k) for k in ("qty", "mat_price", "mat_amt", "lab_price", "lab_amt",
                                                           "exp_price", "exp_amt", "tot_price", "tot_amt")}
                pairs += 1
                continue
            merged.append(it)
            prev = it
        if n_items and pairs >= n_items * 0.3:
            items = merged
            two_row = True

    for k, samples in rounding_samples.items():
        # 최빈 규칙
        keyd: dict[tuple, int] = {}
        for s in samples:
            keyd[(s.func, s.digits)] = keyd.get((s.func, s.digits), 0) + 1
        fn, dg = max(keyd.items(), key=lambda kv: kv[1])[0]
        rounding[k] = RoundingRule(fn, dg)

    return ParsedSheet(sheet=ws_v.title, column_map=cm, items=items, rounding=rounding,
                       is_two_row_change=two_row, issues=issues)


# ---------------------------------------------------------------- 원가계산서
RATE_TEXT_RE = re.compile(r"\(?\s*([가-힣\s\+\·,]+?)\s*\)?\s*[\*×x]\s*([\d\.]+)\s*%")
COST_ITEM_WORDS = ["재료비", "노무비", "경비", "보험", "공제", "안전", "관리비", "이윤", "부가", "환경", "손료", "소계", "합계", "총", "품질", "폐기물", "관급", "도급", "순공사", "현장", "지급"]


@dataclass
class CostLine:
    row: int
    name: str
    amount: Decimal | None
    amount2: Decimal | None = None   # 변경후 (대비형)
    amount_orig: Decimal | None = None  # 당초/발주부서 금액 (대비형)
    rate: Decimal | None = None
    rate_base: str = ""
    base_text: str = ""
    formula: str = ""
    kind: str = "line"               # line / subtotal / total

    def as_dict(self):
        return {"row": self.row, "name": self.name, "amount": str(self.amount) if self.amount is not None else None,
                "amount2": str(self.amount2) if self.amount2 is not None else None,
                "amount_orig": str(self.amount_orig) if self.amount_orig is not None else None,
                "rate": str(self.rate) if self.rate is not None else None, "rate_base": self.rate_base,
                "base_text": self.base_text, "formula": self.formula, "kind": self.kind}


def parse_cost_sheet(ws_v: Worksheet, ws_f: Worksheet) -> dict[str, Any]:
    """원가계산서: 비목명 / 금액 / 요율 / 산식 텍스트 추출. 열 위치는 자동 탐색."""
    name_col = amount_col = amount2_col = rate_col = orig_col = None
    header_row = None
    name_cols: list[int] = []
    for r in range(1, min(ws_v.max_row, 10) + 1):
        for c in range(1, min(ws_v.max_column, 20) + 1):
            t = norm_text(ws_v.cell(r, c).value)
            if not t:
                continue
            if t in ("구분", "비목", "항목", "비목구분", "공종"):
                if header_row is None or header_row == r:
                    name_cols.append(c)
                    name_col, header_row = c, r   # 가장 오른쪽 구분 열
            elif "금액" in t and amount_col is None and len(t) <= 10:
                amount_col = c
            elif ("변경전" in t or "당초" in t or t.startswith("발주")) and orig_col is None and len(t) <= 12:
                orig_col = c
            elif ("변경후" in t or t == "변경") and amount2_col is None:
                amount2_col = c
            elif "요율" in t and rate_col is None:
                rate_col = c
    if name_col is None:
        # 폴백: 이름이 가장 많은 열
        name_col, header_row = 3, 4
    if amount_col is None and orig_col is not None:
        amount_col, orig_col = orig_col, None
    if amount_col is None:
        amount_col = name_col + 1
    if orig_col is not None and amount2_col is None:
        # 발주(a)/금액(b) 대비형: 현재금액=금액, 당초=발주
        pass
    lines: list[CostLine] = []
    for r in range((header_row or 1) + 1, ws_v.max_row + 1):
        name = ""
        for cc in sorted(set(name_cols or [name_col]), reverse=True):
            t = cell_text(ws_v.cell(r, cc).value)
            if t and len(t.replace(" ", "")) >= 2:
                name = t
                break
        if not name:
            # 비목 열이 비면 왼쪽 열도 확인
            for cc in range(1, name_col):
                t = cell_text(ws_v.cell(r, cc).value)
                if t and len(t.replace(" ", "")) >= 2 and any(w in t.replace(" ", "") for w in COST_ITEM_WORDS):
                    name = t
                    break
        if not name:
            continue
        # 금액: amount_col 부터 오른쪽으로 숫자 탐색 (병합 대비)
        amt = None
        f = ""
        for cc in range(amount_col, min(amount_col + 3, ws_v.max_column) + 1):
            v = ws_v.cell(r, cc).value
            d = to_decimal(v)
            if d is not None:
                amt = d
                ff = ws_f.cell(r, cc).value
                f = ff if isinstance(ff, str) and ff.startswith("=") else ""
                break
        amt2 = to_decimal(ws_v.cell(r, amount2_col).value) if amount2_col else None
        amt_orig = to_decimal(ws_v.cell(r, orig_col).value) if orig_col else None
        rate = to_decimal(ws_v.cell(r, rate_col).value) if rate_col else None
        base_text = ""
        rate_base = ""
        for cc in range(1, min(ws_v.max_column, 24) + 1):
            t = cell_text(ws_v.cell(r, cc).value)
            m = RATE_TEXT_RE.search(t) if t else None
            if m:
                base_text = t
                rate_base = m.group(1).replace(" ", "")
                if rate is None:
                    rate = to_decimal(m.group(2))
                break
        if rate is None and f:
            # 수식에서 *J8 같은 비율 셀 참조 → 값 확인
            m = re.search(r"\*\s*\$?([A-Z]{1,2})\$?(\d+)", f)
            if m:
                rv = to_decimal(ws_v[f"{m.group(1)}{m.group(2)}"].value)
                if rv is not None and rv < 1:
                    rate = rv * 100
                elif rv is not None and rv < 100:
                    rate = rv
            if not rate_base:
                # 수식 안의 다른 비목 참조
                m2 = re.search(r"\(?\$?[A-Z]{1,2}\$?(\d+)\s*[\*]", f)
                if m2:
                    rate_base = cell_text(ws_v.cell(int(m2.group(1)), name_col).value).replace(" ", "")
        n = name.replace(" ", "")
        kind = "subtotal" if ("소계" in n or n.startswith("계")) else ("total" if ("합계" in n or "총" in n) else "line")
        lines.append(CostLine(row=r, name=name.replace("  ", " "), amount=amt, amount2=amt2, amount_orig=amt_orig, rate=rate,
                              rate_base=rate_base, base_text=base_text, formula=f, kind=kind))
    return {
        "sheet": ws_v.title,
        "name_col": name_col, "amount_col": amount_col, "amount2_col": amount2_col, "rate_col": rate_col,
        "orig_col": orig_col,
        "is_compare": amount2_col is not None or orig_col is not None,
        "lines": [l.as_dict() for l in lines],
    }


# ---------------------------------------------------------------- 일위대가
def parse_unit_price_sheet(ws_v: Worksheet, ws_f: Worksheet, cm: ColumnMap) -> list[dict[str, Any]]:
    """일위대가표: '일목줄'/호표 제목행 → 구성품 → 합계. 범용 2행형 양식 기준."""
    groups: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    marker_col = 2
    name_c = cm.col("name") or 4
    for r in range(cm.data_start_row, ws_v.max_row + 1):
        marker = cell_text(ws_v.cell(r, marker_col).value)
        name = cell_text(ws_v.cell(r, name_c).value)
        if not name and not marker:
            continue
        is_title = marker == "일목줄" or re.match(r"^\s*\[?\s*(제\s*\d+\s*호|일위\s*\d+\s*호|호표\s*\d+)", name) or \
            (name.startswith("[") and "호" in name and "]" in name) or re.search(r"\(\s*호표\s*\d+\s*\)", name) or \
            re.match(r"^\s*품\s*\d+[\-\.]\d+", name)
        if is_title:
            m = re.search(r"(제\s*\d+\s*호|일위\s*\d+\s*호|호표\s*\d+|품\s*\d+[\-\.]\d+)", name)
            no = re.sub(r"\s", "", m.group(1)) if m else name[:20]
            cur = {"no": no, "title": name, "row": r, "components": [], "total": {}}
            groups.append(cur)
            continue
        if cur is None:
            continue
        vals = _row_values(ws_v, r, cm)
        n = norm_text(name)
        if marker in SUBTOTAL_MARKERS or n in ("합계", "(합계)", "계", "소계"):
            cur["total"] = {k: str(to_decimal(vals.get(k))) for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt")
                            if to_decimal(vals.get(k)) is not None}
            cur = None
            continue
        comp = {"row": r, "name": name, "spec": cell_text(vals.get("spec")), "unit": cell_text(vals.get("unit"))}
        for k in ("qty", "mat_price", "mat_amt", "lab_price", "lab_amt", "exp_price", "exp_amt", "tot_price", "tot_amt"):
            d = to_decimal(vals.get(k))
            comp[k] = str(d) if d is not None else None
        pf = ws_f.cell(r, cm.col("mat_price")).value if cm.col("mat_price") else None
        comp["price_source"] = _formula_ref(pf) if isinstance(pf, str) else ""
        cur["components"].append(comp)
    return groups
