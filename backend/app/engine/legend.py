"""범례표 자동 인식 엔진.

1) 제목 키워드(범례/LEGEND/일람표…) 문자 탐색 → 2) 표 경계(수평선/문자 정렬) 추정 →
3) 행 분할 → 4) 기호(블록/도형 클러스터/이미지) + 품명·규격·단위 열 분리 → 5) 신뢰도 산정.
결정론적 규칙 기반이며, 외부 AI 는 ai_assist 에서 보조 후보만 제안한다.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .geometry import bbox_of, in_region, shape_fingerprint

TITLE_KEYS = ["범례표", "범례", "전기설비범례", "통신설비범례", "설비기호", "LEGEND", "SYMBOLLEGEND", "SYMBOL", "기호및약어",
              "장비일람표", "케이블일람표", "기기일람표", "조명기구일람표", "SCHEDULE"]
HEADER_KEYS = {
    "symbol": ["기호", "심벌", "심볼", "SYMBOL", "SYM", "MARK"],
    "item": ["품명", "명칭", "품목", "자재명", "기기명", "장비명", "NAME", "DESCRIPTION", "ITEM", "DESC"],
    "spec": ["규격", "사양", "형식", "SPEC", "TYPE", "SIZE"],
    "unit": ["단위", "UNIT"],
    "qty": ["수량", "QTY", "Q'TY", "QUANTITY"],
    "note": ["비고", "REMARK", "REMARKS", "NOTE"],
}
UNIT_RE = re.compile(r"^(대|개|조|식|SET|EA|M|m|㎡|m²|본|련|회선|포트|PORT|KG|kg|조|면|개소|공|구|련|매|매|롤|ROLL|라인|LOT)$", re.I)
SPEC_HINT_RE = re.compile(r"(\d+\s*(mm|㎜|MM|m|M|C|P|W|A|V|KW|kW|㎟|SQ|sq|인치|\")|×|x|X|CAT\.?\s*\d|SM|MM|HFIX|F-CV|CV|HIV|CD|ELP|PE|W\d+|UTP|STP|PTZ|LED|IP\d{2}|MP|배|CH|TB|GB)")
LINE_WORDS = ["관", "케이블", "트레이", "전선", "배선", "덕트", "CABLE", "TRAY", "CONDUIT", "WIRE", "DUCT", "UTP", "광", "FIBER", "배관", "PIPE"]
CABLE_WORDS = ["케이블", "전선", "배선", "CABLE", "WIRE", "UTP", "광", "FIBER", "HFIX", "F-CV", "CV", "HIV", "FR-8", "동축", "COAX"]
TRAY_WORDS = ["트레이", "TRAY", "덕트", "DUCT", "래더", "LADDER"]


@dataclass
class LegendRow:
    row_no: int
    symbol_name: str | None = None
    block_name: str | None = None
    fingerprint: dict | None = None
    item_name: str | None = None
    spec: str | None = None
    unit: str | None = None
    category: str = "device"
    layer_hint: str | None = None
    confidence: float = 0.0
    region: dict | None = None
    texts: list[str] = field(default_factory=list)
    status: str = "auto"


@dataclass
class LegendResult:
    title: str
    region: dict
    rows: list[LegendRow]
    confidence: float
    header_found: bool
    title_handle: str | None = None


def _norm(s: str) -> str:
    return re.sub(r"[\s\(\)\[\]:：\-_.]", "", s).upper()


def find_title_texts(texts: list[dict]) -> list[dict]:
    out = []
    for t in texts:
        n = _norm(t["text"])
        if not n or len(n) > 24:
            continue
        for k in TITLE_KEYS:
            if _norm(k) in n:
                out.append({**t, "_key": k})
                break
    return out


def _horizontal_lines(prims: list[dict]) -> list[tuple[float, float, float, str]]:
    """(x0, x1, y, layer) — 수평 2점 선분."""
    out = []
    for pr in prims:
        if pr.get("t") != "l" or pr.get("blk"):
            continue
        pts = pr["p"]
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            if abs(y0 - y1) < 1e-6 and abs(x0 - x1) > 1e-6:
                out.append((min(x0, x1), max(x0, x1), y0, pr.get("layer", "")))
    return out


def estimate_region(title: dict, texts: list[dict], prims: list[dict]) -> dict:
    """제목 아래 표 영역 추정. 수평선 격자가 있으면 그 범위, 없으면 정렬된 문자 묶음."""
    h = float(title.get("height") or 3.0)
    tb = title.get("bbox") or {"x0": title["x"], "y0": title["y"], "x1": title["x"] + h, "y1": title["y"] + h}
    tcx = (tb["x0"] + tb["x1"]) / 2
    ty = tb["y0"]
    tw = max(tb["x1"] - tb["x0"], h)
    hl = [L for L in _horizontal_lines(prims) if L[2] <= ty + 2 * h and L[2] >= ty - 400 * h
          and (L[1] - L[0]) >= 2 * tw
          and (L[0] - 10 * h <= tcx <= L[1] + 10 * h or (L[0] <= tb["x1"] and L[1] >= tb["x0"]))]
    if len(hl) >= 2:
        # 연속된 격자만: 제목 바로 아래 첫 선을 기준으로, x 범위가 60% 이상 겹치고 간격 20h 이하인 선만 채택
        hl.sort(key=lambda L: -L[2])
        ref = hl[0]

        def overlap(L):
            inter = min(L[1], ref[1]) - max(L[0], ref[0])
            return inter / max(min(L[1] - L[0], ref[1] - ref[0]), 1e-9)
        chain = [ref]
        for L in hl[1:]:
            if chain[-1][2] - L[2] <= 20 * h and overlap(L) >= 0.6:
                chain.append(L)
            elif chain[-1][2] - L[2] > 20 * h:
                break
        x0 = min(L[0] for L in chain)
        x1 = max(L[1] for L in chain)
        y0 = min(L[2] for L in chain)
        y1 = max(tb["y1"], max(L[2] for L in chain))
        return {"x0": x0 - 0.5 * h, "y0": y0 - 0.5 * h, "x1": x1 + 0.5 * h, "y1": y1 + 0.5 * h}
    # 문자 정렬 fallback
    cand = [t for t in texts if t is not title and t["y"] < tb["y1"] and tb["x0"] - 8 * h <= t["x"] <= tb["x0"] + 80 * h]
    cand.sort(key=lambda t: -t["y"])
    rows, last_y = [], ty
    for t in cand:
        if last_y - t["y"] > 6 * h:
            break
        rows.append(t)
        last_y = t["y"]
    if not rows:
        return {"x0": tb["x0"] - h, "y0": ty - 12 * h, "x1": tb["x1"] + 40 * h, "y1": tb["y1"] + h}
    bbs = [r.get("bbox") or {"x0": r["x"], "y0": r["y"], "x1": r["x"] + h, "y1": r["y"] + h} for r in rows]
    return {"x0": min(b["x0"] for b in bbs) - 6 * h, "y0": min(b["y0"] for b in bbs) - h,
            "x1": max(b["x1"] for b in bbs) + 2 * h, "y1": tb["y1"] + h}


def _cluster_rows(items: list[dict], tol: float) -> list[list[dict]]:
    items = sorted(items, key=lambda t: -t["_cy"])
    rows: list[list[dict]] = []
    for it in items:
        if rows and abs(rows[-1][0]["_cy"] - it["_cy"]) <= tol:
            rows[-1].append(it)
        else:
            rows.append([it])
    for r in rows:
        r.sort(key=lambda t: t["_cx"])
    return rows


def _classify_header(row_texts: list[str]) -> dict[str, int] | None:
    cols = {}
    for i, s in enumerate(row_texts):
        n = _norm(s)
        for key, words in HEADER_KEYS.items():
            if any(_norm(w) == n or (_norm(w) in n and len(n) <= len(_norm(w)) + 2) for w in words):
                cols.setdefault(key, i)
    return cols if len(cols) >= 2 else None


def _category(item: str | None, spec: str | None, unit: str | None, has_line_symbol: bool) -> str:
    s = f"{item or ''} {spec or ''}".upper()
    if any(w.upper() in s for w in TRAY_WORDS):
        return "tray"
    if any(w.upper() in s for w in CABLE_WORDS) and "관" not in (item or ""):
        return "cable"
    if any(w.upper() in s for w in ["전선관", "배관", "CONDUIT", "PIPE", "관로", "ELP", "CD ", "HI-PVC", "PE "]) or ((item or "").endswith("관")):
        return "conduit"
    if (unit or "").lower() in ("m", "M") and (has_line_symbol or any(w.upper() in s for w in LINE_WORDS)):
        return "cable" if any(w.upper() in s for w in CABLE_WORDS) else "conduit"
    return "device"


def extract_legend(sheet: dict, title: dict, region: dict | None = None) -> LegendResult:
    """sheet: geometry json (prims, texts, entities, blocks). title: 제목 문자 dict (수동 영역 지정 시 region 필수, title 은 가상)."""
    texts, prims, entities, blocks = sheet["texts"], sheet["prims"], sheet["entities"], sheet.get("blocks", {})
    h = float(title.get("height") or 3.0)
    if region is None:
        region = estimate_region(title, texts, prims)

    def inr(t):
        return in_region(t["x"], t["y"], region)

    # 영역 안 문자 (제목 제외)
    rtexts = []
    for t in texts:
        if t is title or t.get("h") == title.get("h"):
            continue
        if not inr(t):
            continue
        bb = t.get("bbox") or {"x0": t["x"], "y0": t["y"], "x1": t["x"] + h, "y1": t["y"] + h}
        rtexts.append({**t, "_cx": (bb["x0"] + bb["x1"]) / 2, "_cy": (bb["y0"] + bb["y1"]) / 2, "_bb": bb, "_kind": "text"})
    # 영역 안 블록 삽입
    rblocks = []
    for e in entities:
        if e["t"] == "INSERT" and inr(e):
            bb = e.get("bbox") or {"x0": e["x"], "y0": e["y"], "x1": e["x"], "y1": e["y"]}
            rblocks.append({**e, "_cx": (bb["x0"] + bb["x1"]) / 2, "_cy": (bb["y0"] + bb["y1"]) / 2, "_bb": bb, "_kind": "block"})
    # 영역 안 비블록 프리미티브 (도형 클러스터용; 표 격자선 제외)
    rprims = []
    for pr in prims:
        if pr.get("blk") or pr.get("t") in ("h", "ld"):
            continue
        pts = pr["p"]
        if not pts or not all(in_region(x, y, region) for x, y in (pts[0], pts[-1])):
            continue
        bb = bbox_of(pts)
        w, hh = bb["x1"] - bb["x0"], bb["y1"] - bb["y0"]
        # 표의 긴 격자선 제외: 영역 폭의 40% 이상 가로선 / 영역 높이 40% 이상 세로선
        rw, rh = region["x1"] - region["x0"], region["y1"] - region["y0"]
        if (hh < 1e-6 and w > 0.4 * rw) or (w < 1e-6 and hh > 0.4 * rh):
            continue
        rprims.append({**pr, "_bb": bb, "_cx": (bb["x0"] + bb["x1"]) / 2, "_cy": (bb["y0"] + bb["y1"]) / 2})

    tol = max(h * 0.8, 1e-6)
    rows = _cluster_rows(rtexts + rblocks, tol)

    header_cols = None
    header_x: dict[str, float] = {}
    data_rows = []
    for r in rows:
        tx = [it for it in r if it["_kind"] == "text"]
        if header_cols is None and tx:
            hc = _classify_header([t["text"] for t in tx])
            if hc:
                header_cols = hc
                header_x = {k: tx[i]["_cx"] for k, i in hc.items()}
                continue
        data_rows.append(r)

    out_rows: list[LegendRow] = []
    region_h = region["y1"] - region["y0"]
    for idx, r in enumerate(data_rows, start=1):
        tx = [it for it in r if it["_kind"] == "text"]
        bl = [it for it in r if it["_kind"] == "block"]
        cy = r[0]["_cy"]
        row_bb = {"x0": region["x0"], "y0": cy - tol * 1.1, "x1": region["x1"], "y1": cy + tol * 1.1}
        lr = LegendRow(row_no=idx, texts=[t["text"] for t in tx], region=row_bb)
        conf = 0.35

        # ---- 기호 ----
        sym_x_limit = header_x.get("item", None)
        if bl:
            b = bl[0]
            lr.block_name = b["block"]
            lr.fingerprint = (blocks.get(b["block"]) or {}).get("fingerprint")
            lr.region = {"x0": b["_bb"]["x0"] - h, "y0": min(row_bb["y0"], b["_bb"]["y0"] - h), "x1": max(b["_bb"]["x1"] + h, row_bb["x1"]), "y1": max(row_bb["y1"], b["_bb"]["y1"] + h)}
            conf += 0.35
            # 블록 내부 문자(예: 원 안의 'C') 를 기호명으로
            if b.get("texts"):
                lr.symbol_name = " ".join(b["texts"])[:50]
        else:
            # 행 밴드 안 좌측 도형 클러스터 → 지문
            cl = [p for p in rprims if row_bb["y0"] <= p["_cy"] <= row_bb["y1"] and (sym_x_limit is None or p["_cx"] < sym_x_limit)]
            if cl:
                lr.fingerprint = shape_fingerprint([{"t": p["t"], "p": p["p"], "r": p.get("r")} for p in cl], [])
                cbb = bbox_of([q for p in cl for q in p["p"]])
                # 선형 기호(가로선)인지 — 행 문자 높이 기준
                hs = sorted(float(t.get("height") or h) for t in tx) or [h]
                hr = hs[len(hs) // 2]
                if (cbb["x1"] - cbb["x0"]) > 4 * hr and (cbb["y1"] - cbb["y0"]) < 1.5 * hr:
                    lr.fingerprint["line_symbol"] = True
                    layers = {p.get("layer") for p in cl if p.get("layer")}
                    if len(layers) == 1:
                        lr.layer_hint = layers.pop()
                conf += 0.25
        # 기호명: 좌측(품명 열 이전) 짧은 문자
        if lr.symbol_name is None:
            for t in tx:
                if (sym_x_limit is None or t["_cx"] < sym_x_limit) and len(t["text"]) <= 6 and not UNIT_RE.match(t["text"]):
                    lr.symbol_name = t["text"]
                    tx = [u for u in tx if u is not t]
                    break

        # ---- 열 분리 ----
        if header_cols:
            def nearest(t):
                return min(header_x.items(), key=lambda kv: abs(kv[1] - t["_cx"]))[0]
            buckets: dict[str, list[str]] = {}
            for t in tx:
                buckets.setdefault(nearest(t), []).append(t["text"])
            lr.item_name = " ".join(buckets.get("item", [])) or None
            lr.spec = " ".join(buckets.get("spec", [])) or None
            lr.unit = " ".join(buckets.get("unit", [])) or None
            if lr.symbol_name is None and buckets.get("symbol"):
                lr.symbol_name = " ".join(buckets["symbol"])
            conf += 0.2
        else:
            rest = [t["text"] for t in tx]
            units = [s for s in rest if UNIT_RE.match(s)]
            lr.unit = units[0] if units else None
            rest = [s for s in rest if s not in units]
            specs = [s for s in rest if SPEC_HINT_RE.search(s)]
            lr.spec = " ".join(specs) or None
            rest = [s for s in rest if s not in specs]
            lr.item_name = " ".join(rest) or None
            conf += 0.05

        has_line = bool(lr.fingerprint and lr.fingerprint.get("line_symbol"))
        lr.category = _category(lr.item_name, lr.spec, lr.unit, has_line)
        if not lr.item_name:
            lr.status = "unresolved"
            conf = min(conf, 0.3)
        if not (lr.block_name or (lr.fingerprint and lr.fingerprint.get("n", 0) > 0) or lr.symbol_name):
            # 기호 없는 행(비고/주석) → 제외
            continue
        lr.confidence = round(min(conf, 0.98), 2)
        out_rows.append(lr)

    total_conf = round(sum(r.confidence for r in out_rows) / len(out_rows), 2) if out_rows else 0.0
    return LegendResult(title=title["text"], region=region, rows=out_rows, confidence=total_conf,
                        header_found=header_cols is not None, title_handle=title.get("h"))


def auto_detect_legends(sheet: dict) -> list[LegendResult]:
    results = []
    used: list[dict] = []
    for title in find_title_texts(sheet["texts"]):
        if any(in_region(title["x"], title["y"], u) for u in used):
            continue
        res = extract_legend(sheet, title)
        if res.rows:
            results.append(res)
            used.append(res.region)
    return results


def legend_from_region(sheet: dict, region: dict, title: str = "사용자 지정 범례") -> LegendResult:
    """사용자가 마우스로 지정한 영역. 가상 제목을 영역 상단에 둔다."""
    hs = [float(t.get("height") or 0) for t in sheet["texts"] if in_region(t["x"], t["y"], region)]
    h = sorted(hs)[len(hs) // 2] if hs else 3.0
    vt = {"text": title, "x": region["x0"], "y": region["y1"], "height": h, "h": "__manual__",
          "bbox": {"x0": region["x0"], "y0": region["y1"], "x1": region["x1"], "y1": region["y1"] + h}}
    return extract_legend(sheet, vt, region)


def legend_from_xlsx(path: str) -> list[LegendRow]:
    """엑셀 범례/장비일람표 → 행. 헤더(기호/품명/규격/단위) 자동 탐색."""
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    rows: list[LegendRow] = []
    for ws in wb.worksheets:
        header = None
        for r in ws.iter_rows(values_only=True):
            vals = [str(v).strip() if v is not None else "" for v in r]
            if header is None:
                hc = _classify_header(vals)
                if hc:
                    header = hc
                continue
            if not any(vals):
                continue
            g = lambda k: vals[header[k]] if k in header and header[k] < len(vals) else None  # noqa: E731
            lr = LegendRow(row_no=len(rows) + 1, symbol_name=g("symbol") or None, item_name=g("item") or None,
                           spec=g("spec") or None, unit=g("unit") or None, confidence=0.9, texts=[v for v in vals if v])
            lr.category = _category(lr.item_name, lr.spec, lr.unit, False)
            if not lr.item_name:
                lr.status = "unresolved"
            rows.append(lr)
    return rows
