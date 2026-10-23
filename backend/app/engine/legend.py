"""범례표 자동 인식 엔진.

1) 제목 키워드(범례/LEGEND/일람표…) 문자 탐색 → 2) 표 경계(수평선/문자 정렬) 추정 →
3) 행 분할 → 4) 기호(블록/도형 클러스터/이미지) + 품명·규격·단위 열 분리 → 5) 신뢰도 산정.
결정론적 규칙 기반이며, 외부 AI 는 ai_assist 에서 보조 후보만 제안한다.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .geometry import bbox_of, bitmap_signature, in_region, shape_fingerprint

TITLE_KEYS = ["범례표", "범례", "전기설비범례", "통신설비범례", "설비기호", "LEGEND", "SYMBOLLEGEND", "SYMBOL", "기호및약어",
              "장비일람표", "케이블일람표", "기기일람표", "조명기구일람표", "SCHEDULE", "CABLESCHEDULE", "배관배선표", "케이블일람"]
HEADER_KEYS = {
    "symbol": ["기호", "심벌", "심볼", "심불", "SYMBOL", "SYM", "MARK", "범례"],
    "item": ["품명", "명칭", "품목", "자재명", "기기명", "장비명", "내용", "내역", "설명", "NAME", "DESCRIPTION", "ITEM", "DESC"],
    "disc": ["공종", "구분", "DIV"],
    "height": ["설치높이", "높이", "HEIGHT"],
    "spec": ["규격", "사양", "형식", "SPEC", "TYPE", "SIZE", "CABLESIZE", "간선규격", "케이블규격", "WIRE"],
    "unit": ["단위", "UNIT"],
    "qty": ["수량", "QTY", "Q'TY", "QUANTITY"],
    "from": ["FROM", "출발", "기점"],
    "to": ["TO", "도착", "종점"],
    "conduit": ["전선관", "배관", "CONDUIT", "CONDUITSIZE", "배관및배선"],
    "no": ["NO", "NO.", "회로", "회로번호", "기호"],
    "note": ["비고", "REMARK", "REMARKS", "NOTE"],
}
UNIT_RE = re.compile(r"^(대|개|조|식|SET|EA|M|m|㎡|m²|본|련|회선|포트|PORT|KG|kg|조|면|개소|공|구|련|매|매|롤|ROLL|라인|LOT)$", re.I)
SPEC_HINT_RE = re.compile(r"(\d+\s*(mm|㎜|MM|m|M|C|P|W|A|V|KW|kW|㎟|SQ|sq|인치|\")|×|x|X|CAT\.?\s*\d|SM|MM|HFIX|F-CV|CV|HIV|CD|ELP|PE|W\d+|UTP|STP|PTZ|LED|IP\d{2}|MP|배|CH|TB|GB)")
LINE_WORDS = ["관", "케이블", "트레이", "전선", "배선", "덕트", "CABLE", "TRAY", "CONDUIT", "WIRE", "DUCT", "UTP", "광케이블", "FIBER", "배관", "PIPE"]
CABLE_WORDS = ["케이블", "전선", "배선", "CABLE", "WIRE", "UTP", "광케이블", "광섬유", "FIBER", "HFIX", "F-CV", "CV ", "HIV", "FR-8", "동축", "COAX"]
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
    discipline: str | None = None
    install_height: str | None = None
    symbol_cell: dict | None = None
    extra: dict = field(default_factory=dict)
    _cbb: dict | None = None


@dataclass
class LegendResult:
    title: str
    region: dict
    rows: list[LegendRow]
    confidence: float
    header_found: bool
    title_handle: str | None = None
    region_from_grid: bool = False


def _norm(s: str) -> str:
    return re.sub(r"[\s\(\)\[\]:：\-_.]", "", s).upper()


def find_title_texts(texts: list[dict]) -> list[dict]:
    out = []
    for t in texts:
        n = _norm(t["text"])
        if not n or len(n) > 12:
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
    tw = min(max(tb["x1"] - tb["x0"], h), 12 * h)   # 긴(가상) 제목은 폭 조건을 완화
    hl = [L for L in _horizontal_lines(prims) if L[2] <= ty + 2 * h and L[2] >= ty - 400 * h
          and (L[1] - L[0]) >= 2 * tw
          and (L[0] - 10 * h <= tcx <= L[1] + 10 * h or (L[0] <= tb["x1"] and L[1] >= tb["x0"]))]
    if len(hl) >= 2:
        # 기준선 = 제목(또는 헤더) 바로 아래 첫 수평선. 표 폭은 기준선 폭으로 고정하고,
        # 그 폭 안(±2h)에 들어오는 선만 아래로 이어 붙인다 (페이지 외곽선·표제란 배제)
        hl.sort(key=lambda L: -L[2])
        below = [L for L in hl if L[2] <= ty + 0.5 * h]
        ref = below[0] if below else hl[0]
        chain = [ref]
        for L in hl:
            if L is ref or L[2] > ref[2]:
                continue
            inside = L[0] >= ref[0] - 2 * h and L[1] <= ref[1] + 2 * h and (L[1] - L[0]) >= 0.5 * (ref[1] - ref[0])
            if chain[-1][2] - L[2] > 20 * h:
                break
            if inside:
                chain.append(L)
        x0, x1 = ref[0], ref[1]
        y0 = min(L[2] for L in chain)
        y1 = max(tb["y1"], max(L[2] for L in chain))
        return {"x0": x0 - 0.5 * h, "y0": y0 - 0.5 * h, "x1": x1 + 0.5 * h, "y1": y1 + 0.5 * h, "_grid": len(chain)}
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


def _vertical_xs(prims: list[dict], region: dict) -> list[float]:
    """영역 높이의 30% 이상인 세로 선의 x 좌표 (표 칸 경계)."""
    rh = region["y1"] - region["y0"]
    xs = []
    for pr in prims:
        if pr.get("t") not in ("l",) or pr.get("blk"):
            continue
        pts = pr["p"]
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            if abs(x0 - x1) < 1e-6 and abs(y1 - y0) >= 0.3 * rh and region["x0"] - 1 <= x0 <= region["x1"] + 1:
                xs.append(x0)
    xs.sort()
    out: list[float] = []
    for x in xs:
        if not out or x - out[-1] > 2.0:
            out.append(x)
    return out


def _cell_bounds(c: float, vxs: list[float], region: dict) -> tuple[float, float]:
    left = max([x for x in vxs if x < c], default=region["x0"])
    right = min([x for x in vxs if x > c], default=region["x1"])
    return left, right


def _overlap_ratio(a: dict, b: dict) -> float:
    ix = max(0.0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    iy = max(0.0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    area = min((a["x1"] - a["x0"]) * (a["y1"] - a["y0"]), (b["x1"] - b["x0"]) * (b["y1"] - b["y0"])) or 1e-9
    return ix * iy / area


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
        if not n:
            continue
        for key, words in HEADER_KEYS.items():
            if any(_norm(w) == n or (len(_norm(w)) >= 2 and _norm(w) in n and len(n) <= len(_norm(w)) + 5) for w in words):
                cols.setdefault(key, i)
                break
    # 품명 열이 OCR 로 깨져도 기호+단위/높이/비고 등 2개 이상이면 헤더로 인정 (품명 열은 위치로 추정)
    if "from" in cols and "to" in cols:
        return cols   # 케이블 일람표 / 배관배선표
    return cols if (len(cols) >= 2 and ("item" in cols or "symbol" in cols)) else None


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


def extract_legend(sheet: dict, title: dict, region: dict | None = None, ocr_cell=None) -> LegendResult:
    """ocr_cell(region)->str : 셀 단위 재인식 콜백(래스터가 있는 PDF). 희소 OCR 이 비면 품명/규격 칸을 다시 읽는다."""
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
    # OCR 줄 분리로 한 행이 둘로 나뉜 경우: 행 간격 중앙값의 45% 이내면 합친다
    if len(rows) >= 3:
        cys = [r[0]["_cy"] for r in rows]
        gaps = sorted(abs(a - b) for a, b in zip(cys, cys[1:]) if abs(a - b) > 1e-6)
        med = gaps[len(gaps) // 2] if gaps else tol
        merged: list[list[dict]] = []
        for r in rows:
            if merged and abs(merged[-1][0]["_cy"] - r[0]["_cy"]) < 0.45 * med:
                merged[-1].extend(r)
                merged[-1].sort(key=lambda t: t["_cx"])
            else:
                merged.append(r)
        rows = merged
        tol = max(tol, 0.45 * med)

    header_cols = None
    header_x: dict[str, float] = {}
    data_rows = []
    skip_next = False
    for ri_, r in enumerate(rows):
        if skip_next:
            skip_next = False
            continue
        tx = [it for it in r if it["_kind"] == "text"]
        if header_cols is None and tx:
            hc = _classify_header([t["text"] for t in tx])
            if not hc and ri_ + 1 < len(rows):
                # 헤더가 글자 크기 차이로 두 줄로 나뉜 경우: 다음 행과 합쳐 재시도
                tx2 = tx + [it for it in rows[ri_ + 1] if it["_kind"] == "text"]
                tx2.sort(key=lambda t: t["_cx"])
                hc2 = _classify_header([t["text"] for t in tx2])
                if hc2 and len(hc2) >= 2:
                    hc, tx, skip_next = hc2, tx2, True
            if hc:
                header_cols = hc
                header_x = {k: tx[i]["_cx"] for k, i in hc.items()}
                if "item" not in header_x:
                    # 품명 열 = 기호 열 오른쪽의 첫 헤더 열 사이 (헤더 문자가 깨진 경우)
                    sc = header_x.get("symbol", region["x0"])
                    right = min([v for v in header_x.values() if v > sc], default=region["x1"])
                    header_x["item"] = (sc + right) / 2 if right != region["x1"] else sc + 0.3 * (region["x1"] - region["x0"])
                    header_cols["item"] = -1
                continue
        data_rows.append(r)

    out_rows: list[LegendRow] = []
    last_disc = [None]
    last_no = [None]
    vxs = _vertical_xs(prims, region)
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
            # 행 밴드 안 기호 열(헤더가 있으면 심벌 열 범위, 없으면 품명 열 왼쪽) 도형 클러스터 → 지문
            sx0, sx1 = region["x0"], (sym_x_limit if sym_x_limit is not None else region["x1"])
            if "symbol" in header_x:
                if vxs:
                    sx0, sx1 = _cell_bounds(header_x["symbol"], vxs, region)
                else:
                    cols_sorted = sorted(header_x.values())
                    sc = header_x["symbol"]
                    left = max([c for c in cols_sorted if c < sc], default=region["x0"])
                    right = min([c for c in cols_sorted if c > sc], default=region["x1"])
                    sx0, sx1 = (left + sc) / 2 if left != region["x0"] else region["x0"], (sc + right) / 2
            lr.symbol_cell = {"x0": sx0, "x1": sx1, "y0": row_bb["y0"], "y1": row_bb["y1"]}
            cl = [p for p in rprims if row_bb["y0"] <= p["_cy"] <= row_bb["y1"] and sx0 <= p["_cx"] <= sx1
                  and p["_bb"]["y0"] >= row_bb["y0"] - tol and p["_bb"]["y1"] <= row_bb["y1"] + tol
                  and p.get("layer") != "RASTER-LINE"]
            if cl:
                lr.fingerprint = shape_fingerprint([{"t": p["t"], "p": p["p"], "r": p.get("r")} for p in cl], [])
                cbb = bbox_of([q for p in cl for q in p["p"]])
                lr.fingerprint["_cbb"] = cbb
                lr.region = {"x0": cbb["x0"] - h, "y0": min(row_bb["y0"], cbb["y0"] - h), "x1": max(row_bb["x1"], cbb["x1"] + h), "y1": max(row_bb["y1"], cbb["y1"] + h)}
                hs = sorted(float(t.get("height") or h) for t in tx) or [h]
                hr = hs[len(hs) // 2]
                lines_only = [p for p in cl if p["t"] in ("l", "a")]
                no_shapes = not any(p["t"] == "c" for p in cl) and all((p["_bb"]["y1"] - p["_bb"]["y0"]) < 1.5 * hr for p in cl)
                if (cbb["x1"] - cbb["x0"]) > 4 * hr and (cbb["y1"] - cbb["y0"]) < 1.5 * hr and lines_only and no_shapes:
                    # 선형 기호: 스타일(레이어) + 파선 패턴 서명
                    lr.fingerprint["line_symbol"] = True
                    layers = {p.get("layer") for p in lines_only if p.get("layer")}
                    if len(layers) == 1:
                        lr.layer_hint = layers.pop()
                    segs = sorted(lines_only, key=lambda p: p["_bb"]["x0"])
                    lens = sorted(max(p["_bb"]["x1"] - p["_bb"]["x0"], p["_bb"]["y1"] - p["_bb"]["y0"]) for p in segs)
                    gaps = sorted(max(0.0, b["_bb"]["x0"] - a["_bb"]["x1"]) for a, b in zip(segs, segs[1:]))
                    lr.fingerprint["dash"] = {"n": len(segs), "seg": lens[len(lens) // 2], "gap": (gaps[len(gaps) // 2] if gaps else 0.0),
                                              "total": cbb["x1"] - cbb["x0"]}
                else:
                    # 앵커(닫힌 도형·원·작은 채움) = 가장 큰 닫힌 도형. 그 중심 기준으로 방향 정규화한 비트맵 지문
                    anc = []
                    for p in cl:
                        d = max(p["_bb"]["x1"] - p["_bb"]["x0"], p["_bb"]["y1"] - p["_bb"]["y0"])
                        closed = p["t"] == "c" or (p["t"] == "f" and 3 <= len(p["p"]) <= 12) or (len(p["p"]) >= 4 and math.dist(p["p"][0], p["p"][-1]) <= 0.05 * max(d, 1e-9))
                        if closed and d > 0:
                            anc.append((d, p))
                    lr.fingerprint.update(bitmap_signature([{"t": p["t"], "p": p["p"]} for p in cl]))
                    if anc:
                        d, ap = max(anc, key=lambda t: t[0])
                        lr.fingerprint["anchor_bm"] = bitmap_signature([{"t": ap["t"], "p": ap["p"]}]).get("bm")
                    lr.fingerprint["layers"] = sorted({p.get("layer") for p in cl if p.get("layer")})
                    sz = lr.fingerprint.get("size") or 1.0
                    lr.fingerprint["anchor_ratio"] = round(max(a[0] for a in anc) / sz, 3) if anc else None
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
            lr.install_height = " ".join(buckets.get("height", [])) or None
            if ocr_cell and "item" in header_x:
                # 품명/규격 칸 재인식 — 세로 격자선으로 칸 경계를 잡는다
                for key in ("item", "spec"):
                    if key not in header_x:
                        continue
                    left, right = _cell_bounds(header_x[key], vxs, region)
                    better = ocr_cell({"x0": left + 1, "x1": right - 1, "y0": row_bb["y0"], "y1": row_bb["y1"]})
                    cur_v = getattr(lr, "item_name" if key == "item" else "spec")
                    if better and (not cur_v or len(better) > len(cur_v)):
                        setattr(lr, "item_name" if key == "item" else "spec", better)
            if buckets.get("disc"):
                last_disc[0] = " ".join(buckets["disc"])
            lr.discipline = last_disc[0]
            if lr.symbol_name is None and buckets.get("symbol"):
                lr.symbol_name = " ".join(buckets["symbol"])
            if lr.spec is None and buckets.get("note") and SPEC_HINT_RE.search(" ".join(buckets["note"])):
                lr.spec = " ".join(buckets["note"])
            if "conduit" in header_cols and "from" not in header_cols:
                lr.extra = {**lr.extra, "conduit": " ".join(buckets.get("conduit", []))}
                if not lr.item_name and lr.spec:
                    lr.item_name = "배선 " + lr.spec
            if "from" in header_cols and "to" in header_cols:
                # 케이블 일람표(배관배선표): 회로번호 FROM TO 규격 전선관 → 케이블 품목 (경로·회선은 사용자가 지정)
                no = " ".join(buckets.get("no", [])) or (lr.symbol_name or "")
                if no:
                    last_no[0] = no
                lr.symbol_name = last_no[0] or None
                lr.extra = {"from": " ".join(buckets.get("from", [])), "to": " ".join(buckets.get("to", [])),
                            "conduit": " ".join(buckets.get("conduit", [])), "schedule": True}
                if not lr.spec and lr.item_name and SPEC_HINT_RE.search(lr.item_name):
                    lr.spec, lr.item_name = lr.item_name, None
                lr.item_name = lr.item_name or ("케이블 " + (lr.spec or "")).strip()
                lr.unit = lr.unit or "m"
                lr.category = "cable"
                lr.fingerprint = {"n": 0, "schedule": True}
                if lr.extra["conduit"]:
                    lr.extra["conduit_item"] = lr.extra["conduit"]
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
        if not (lr.fingerprint and lr.fingerprint.get("schedule")):
            lr.category = _category(lr.item_name, lr.spec, lr.unit, has_line)
        if not lr.item_name:
            lr.status = "unresolved"
            conf = min(conf, 0.3)
        if not (lr.block_name or (lr.fingerprint and (lr.fingerprint.get("n", 0) > 0 or lr.fingerprint.get("schedule"))) or lr.symbol_name):
            # 기호 없는 행(비고/주석) → 제외
            continue
        if lr.item_name and not re.search(r"[가-힣A-Za-z]{2,}", lr.item_name):
            lr.item_name = None   # 격자 노이즈('00000', '_')
            lr.status = "unresolved"
        fp = lr.fingerprint or {}
        if not lr.item_name and not lr.block_name and not (fp.get("bm") or fp.get("dash") or fp.get("schedule")):
            continue   # 빈 행 (OCR 노이즈 기호명만 있는 행 포함)
        if fp.get("schedule") and not lr.spec:
            continue
        if sheet.get("_raster") and lr.item_name and lr.symbol_cell and not fp.get("bm"):
            fp = lr.fingerprint = {**fp, "raster_cell": True, "n": 1}   # 스캔 도면: 기호는 이미지 크롭으로 매칭
        # 같은 기호 묶음이 두 행으로 쪼개진 경우(OCR 줄 분리) 중복 제거: 기호 bbox 60% 이상 겹침
        cbb = fp.get("_cbb")
        if out_rows and cbb and out_rows[-1]._cbb and _overlap_ratio(cbb, out_rows[-1]._cbb) > 0.6:
            prev = out_rows[-1]
            if not prev.item_name and lr.item_name:
                prev.item_name, prev.spec, prev.unit, prev.status = lr.item_name, lr.spec, lr.unit, "auto"
            continue
        lr._cbb = cbb
        fp.pop("_cbb", None)
        lr.confidence = round(min(conf, 0.98), 2)
        out_rows.append(lr)

    total_conf = round(sum(r.confidence for r in out_rows) / len(out_rows), 2) if out_rows else 0.0
    from_grid = int(region.pop("_grid", 0) or 0) >= 4
    return LegendResult(title=title["text"], region=region, rows=out_rows, confidence=total_conf,
                        header_found=header_cols is not None, title_handle=title.get("h"), region_from_grid=from_grid)


def find_header_rows(texts: list[dict]) -> list[dict]:
    """제목 키워드가 없어도 '기호|품명(내용)|...' 헤더 행이 있으면 범례표로 본다. 가상 제목(헤더 바로 위)을 돌려준다."""
    items = []
    for t in texts:
        h = float(t.get("height") or 3.0)
        bb = t.get("bbox") or {"x0": t["x"], "y0": t["y"], "x1": t["x"] + h, "y1": t["y"] + h}
        items.append({**t, "_cx": (bb["x0"] + bb["x1"]) / 2, "_cy": (bb["y0"] + bb["y1"]) / 2, "_bb": bb, "_h": h})
    hs = sorted(i["_h"] for i in items) or [3.0]
    rows = _cluster_rows(items, hs[len(hs) // 2] * 0.8)
    out = []
    for r in rows:
        if _classify_header([t["text"] for t in r]):
            x0 = min(t["_bb"]["x0"] for t in r)
            x1 = max(t["_bb"]["x1"] for t in r)
            y1 = max(t["_bb"]["y1"] for t in r)
            h = max(t["_h"] for t in r)
            out.append({"text": "범례(헤더 인식)", "x": x0, "y": y1, "height": h, "h": "__hdr__",
                        "bbox": {"x0": x0, "y0": y1, "x1": x1, "y1": y1 + h}, "_hdr_row": r})
    return out


def grid_tables(sheet: dict, ocr_cell, min_rows: int = 4) -> list[LegendResult]:
    """스캔 도면용 '격자 우선' 범례 추출: 래스터에서 뽑은 가로선 묶음(같은 폭, 5줄 이상)을 표로 보고
    행(가로선 사이)·열(세로선)을 만든 뒤 칸마다 OCR 한다. 헤더 행에 기호/명칭 열이 있으면 범례표로 채택."""
    hl = [(x0, x1, y) for (x0, x1, y, layer) in _horizontal_lines(sheet["prims"]) if layer == "RASTER-LINE" and x1 - x0 > 40]
    if not hl or ocr_cell is None:
        return []
    groups: list[list[tuple]] = []
    for L in sorted(hl, key=lambda t: -(t[1] - t[0])):   # 긴 선부터: 그룹 대표 폭 = 가장 긴 선
        for g in groups:
            w = g[0][1] - g[0][0]
            if abs(g[0][0] - L[0]) <= 0.02 * w + 4 and (L[1] - L[0]) >= 0.45 * w and L[1] <= g[0][1] + 0.02 * w + 4:
                g.append(L)
                break
        else:
            groups.append([L])
    out = []
    for g in groups:
        ys = sorted({round(y, 1) for _, _, y in g}, reverse=True)
        if len(ys) < min_rows:
            continue
        x0 = min(a for a, _, _ in g)
        x1 = g[0][1]
        region = {"x0": x0, "y0": ys[-1], "x1": x1, "y1": ys[0]}
        vxs = _vertical_xs([pr for pr in sheet["prims"] if pr.get("layer") == "RASTER-LINE"], region)
        cols = sorted({round(x, 1) for x in vxs if x0 - 3 <= x <= x1 + 3})
        if len(cols) < 2:
            continue
        rows = [(ys[i + 1], ys[i]) for i in range(len(ys) - 1) if ys[i] - ys[i + 1] > 4]
        cells = []   # rows × cols 텍스트 (기호 열로 보이는 좁은 첫 열은 OCR 생략)
        for (ry0, ry1) in rows[: min(len(rows), 60)]:
            row = []
            for c in range(len(cols) - 1):
                narrow_first = c == 0 and (cols[1] - cols[0]) < 0.12 * (x1 - x0)
                row.append("" if narrow_first and cells else ocr_cell({"x0": cols[c] + 1, "x1": cols[c + 1] - 1, "y0": ry0 + 1, "y1": ry1 - 1}))
            cells.append(row)
        header_i, hc = None, None
        for i, row in enumerate(cells[:3]):
            hc = _classify_header(row)
            if hc:
                header_i = i
                break
        if hc is None:
            continue
        # 열 인덱스: 기호 열은 헤더에 없으면 0열
        sym_c = hc.get("symbol", 0)
        item_c = hc.get("item")
        if item_c is None or item_c == sym_c:
            item_c = sym_c + 1 if sym_c + 1 < len(cols) - 1 else sym_c
        lrows: list[LegendRow] = []
        for i, row in enumerate(cells):
            if i <= header_i:
                continue
            ry0, ry1 = rows[i]
            item = row[item_c] if item_c < len(row) else ""
            if not item or not re.search(r"[가-힣A-Za-z]{2,}", item):
                continue
            spec = row[hc["spec"]] if "spec" in hc and hc["spec"] < len(row) else None
            if spec is None:
                m = re.search(r"\(([^()]{2,40})\)", item)
                spec = m.group(1) if m else None
            lr = LegendRow(row_no=len(lrows) + 1, item_name=item.strip(), spec=spec, unit=(row[hc["unit"]] if "unit" in hc and hc["unit"] < len(row) else None),
                           install_height=(row[hc["height"]] if "height" in hc and hc["height"] < len(row) else None),
                           symbol_cell={"x0": cols[sym_c], "x1": cols[sym_c + 1], "y0": ry0, "y1": ry1},
                           region={"x0": x0, "x1": x1, "y0": ry0, "y1": ry1}, confidence=0.7, texts=[c for c in row if c])
            lr.fingerprint = {"raster_cell": True, "n": 1}
            lr.category = _category(lr.item_name, lr.spec, lr.unit, False)
            lrows.append(lr)
        if lrows:
            out.append(LegendResult(title="범례(격자 인식)", region=region, rows=lrows, confidence=0.7, header_found=True, region_from_grid=True))
    return out


def auto_detect_legends(sheet: dict, ocr_cell=None) -> list[LegendResult]:
    results = []
    used: list[dict] = []
    if sheet.get("_raster"):
        for res in grid_tables(sheet, ocr_cell):
            results.append(res)
            used.append(res.region)
    cands = find_title_texts(sheet["texts"]) + find_header_rows(sheet["texts"])
    for title in cands:
        if any(in_region(title["x"], title["y"], u) for u in used):
            continue
        res = extract_legend(sheet, title, ocr_cell=ocr_cell)
        # 근거 없는 표(헤더도 격자도 없음)는 제외 — 주기사항 본문 오탐 방지
        with_sym = sum(1 for r in res.rows if r.block_name or (r.fingerprint and (r.fingerprint.get("bm") or r.fingerprint.get("dash") or r.fingerprint.get("schedule"))))
        # 기호(도형) 가 있는 행이 있어야 범례표 — 도면목록표·일람표 같은 문자 표 배제
        if res.rows and with_sym >= 1 and (res.header_found or (res.region_from_grid and with_sym >= max(2, len(res.rows) // 2))):
            results.append(res)
            used.append(res.region)
    return results


def legend_from_region(sheet: dict, region: dict, title: str = "사용자 지정 범례", ocr_cell=None) -> LegendResult:
    """사용자가 마우스로 지정한 영역. 가상 제목을 영역 상단에 둔다."""
    hs = [float(t.get("height") or 0) for t in sheet["texts"] if in_region(t["x"], t["y"], region)]
    h = sorted(hs)[len(hs) // 2] if hs else 3.0
    vt = {"text": title, "x": region["x0"], "y": region["y1"], "height": h, "h": "__manual__",
          "bbox": {"x0": region["x0"], "y0": region["y1"], "x1": region["x1"], "y1": region["y1"] + h}}
    return extract_legend(sheet, vt, region, ocr_cell=ocr_cell)


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
