"""외곽 도형(앵커) + 내부 내용 기반 기호 검출 — 벡터 PDF·폭발 블록용.

범례 기호를 '가장 큰 닫힌 도형(원/사각형/다각형)' 과 '그 안의 내용(빈칸, J, M, X, 채움 삼각형 …)' 으로 분해한다.
도면에서는 같은 종류·종횡비·색의 닫힌 도형을 후보로 잡고, 후보 안의 내용을 앵커 틀 기준으로 비트맵화해 비교한다.
기호에 붙은 배선·받침·화살표(방향이 제각각)는 비교에서 빠지므로 회전·연결 상태에 강하다.
"""
from __future__ import annotations

import math
from collections import defaultdict

from .geometry import bitmap_signature, bitmap_similarity, bbox_of, prim_bbox

CLOSE_TOL = 0.06


def _color(layer: str | None) -> str:
    return (layer or "").split(" ")[-1]


def closed_kind(p: dict) -> str | None:
    """닫힌 도형이면 'circle' | 'rect' | 'poly', 아니면 None."""
    pts = p.get("p") or []
    if len(pts) < 3:
        return None
    b = prim_bbox(p)
    size = max(b["x1"] - b["x0"], b["y1"] - b["y0"])
    if size <= 0:
        return None
    t = p.get("t")
    if t == "c":
        return "circle"
    if t == "f":
        return None   # 채움(글자 윤곽·삼각형 채움)은 내부 내용으로만 사용
    if len(pts) < 4 or math.dist(pts[0], pts[-1]) > CLOSE_TOL * size:
        return None
    if t == "a":
        return "circle"   # 곡선을 포함한 닫힌 도형 (원·타원, 받침이 붙은 원 포함)
    if len(pts) in (5, 4):
        return "rect"
    return "poly"


def _aspect(b: dict) -> float:
    w, h = b["x1"] - b["x0"], b["y1"] - b["y0"]
    return round(min(w, h) / max(w, h, 1e-9), 3)


def _interior(prims_iter, anchor_idx: int, b: dict, color: str) -> list[dict]:
    """앵커 bbox 안(2% 여유)에 완전히 들어오는 같은 색 프리미티브 (앵커 자신 제외)."""
    w, h = b["x1"] - b["x0"], b["y1"] - b["y0"]
    m = 0.02 * max(w, h)
    out = []
    for j, q in prims_iter:
        if j == anchor_idx:
            continue
        qc = _color(q.get("layer"))
        if color and qc != color:
            continue
        qb = prim_bbox(q)
        if qb["x0"] >= b["x0"] - m and qb["x1"] <= b["x1"] + m and qb["y0"] >= b["y0"] - m and qb["y1"] <= b["y1"] + m:
            if q.get("t") == "l" and len(q["p"]) > 2:
                # 한 선에 테두리와 대각선이 섞여 있으면 선분 단위로 나눠 테두리 선분만 버린다
                for a_, c_ in zip(q["p"], q["p"][1:]):
                    seg = {"t": "l", "p": [a_, c_], "layer": q.get("layer")}
                    if not _on_border(seg, b):
                        out.append(seg)
                continue
            if q.get("t") != "f" and _on_border(q, b):
                continue   # 테두리를 이루는 조각(ㄱ자·파선) 은 내부 내용이 아님
            out.append(q)
    return out


def _interior_desc(inner: list[dict], b: dict) -> dict:
    area = max((b["x1"] - b["x0"]) * (b["y1"] - b["y0"]), 1e-9)
    sig = bitmap_signature([{"t": q["t"], "p": q["p"]} for q in inner], frame=b) if inner else {}
    frac = 0.0
    if sig.get("bm"):
        import numpy as np
        n = sig["n"]
        frac = float(np.unpackbits(np.frombuffer(bytes.fromhex(sig["bm"]), np.uint8))[: n * n].mean())
    empty = frac <= 0.015
    has_fill = any(q.get("t") == "f" and len(q["p"]) <= 12 and (prim_bbox(q)["x1"] - prim_bbox(q)["x0"]) * (prim_bbox(q)["y1"] - prim_bbox(q)["y0"]) > 0.08 * area for q in inner)
    return {"empty": empty, "bm": sig.get("bm"), "n": sig.get("n"), "fill": has_fill, "frac": round(frac, 4)}


def anchor_descriptor(cluster: list[dict]) -> dict | None:
    """범례 기호 묶음 → 앵커 서술자. 닫힌 도형이 없으면 None (템플릿 매칭으로 넘김)."""
    best = None
    for i, p in enumerate(cluster):
        k = closed_kind(p)
        if not k:
            continue
        b = prim_bbox(p)
        size = max(b["x1"] - b["x0"], b["y1"] - b["y0"])
        if best is None or size > best[0]:
            best = (size, i, k, b)
    dashed = False
    for r in assemble_rects(enumerate(cluster)):
        b = r["bbox"]
        size = max(b["x1"] - b["x0"], b["y1"] - b["y0"])
        if best is None or size > best[0] * 1.02:
            best = (size, -1, "rect", b)
            dashed = r["coverage"] < 0.85
            best_color = r["color"]
    if not best:
        return None
    size, i, kind, b = best
    color = _color(cluster[i].get("layer")) if i >= 0 else best_color
    inner = _interior(enumerate(cluster), i, b, color)
    d = _interior_desc(inner, b)
    cl_bb = bbox_of([q for p in cluster for q in p["p"]])
    return {"kind": kind, "size": round(size, 3), "aspect": _aspect(b), "color": color, "dashed": dashed,
            "interior": d, "outer_ratio": round(max(cl_bb["x1"] - cl_bb["x0"], cl_bb["y1"] - cl_bb["y0"]) / size, 3)}


def _axis_edges(prims_iter, max_len: float):
    """축 정렬 선분: H[(color)] = [(y, x0, x1)], V = [(x, y0, y1)] 및 직각 모서리 [(x, y, dx, dy, color)]"""
    H, V, corners = defaultdict(list), defaultdict(list), []
    for j, p in prims_iter:
        if p.get("t") not in ("l",) or len(p["p"]) < 2:
            continue
        col = _color(p.get("layer"))
        pts = p["p"]
        segs = []
        for a, b in zip(pts, pts[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy)
            if L < 0.2 or L > max_len:
                segs.append(None)
                continue
            if abs(dy) < 0.02 * L:
                H[col].append(((a[1] + b[1]) / 2, min(a[0], b[0]), max(a[0], b[0])))
                segs.append(("h", 1 if dx > 0 else -1))
            elif abs(dx) < 0.02 * L:
                V[col].append(((a[0] + b[0]) / 2, min(a[1], b[1]), max(a[1], b[1])))
                segs.append(("v", 1 if dy > 0 else -1))
            else:
                segs.append(None)
        for k in range(1, len(pts) - 1):
            s1, s2 = segs[k - 1], segs[k]
            if s1 and s2 and s1[0] != s2[0]:
                # 모서리에서 나가는 두 다리 방향 (+x/-x, +y/-y) 과 다리 길이
                hx = -s1[1] if s1[0] == "h" else s2[1]
                vy = -s1[1] if s1[0] == "v" else s2[1]
                l1 = math.dist(pts[k - 1], pts[k])
                l2 = math.dist(pts[k], pts[k + 1])
                lx, ly = (l1, l2) if s1[0] == "h" else (l2, l1)
                corners.append((pts[k][0], pts[k][1], hx, vy, col, lx, ly))
    return H, V, corners


def _coverage(intervals, c, lo, hi, tol):
    """좌표 c(±tol) 위의 구간들이 [lo, hi] 를 덮는 비율"""
    segs = sorted((max(a, lo), min(b, hi)) for cc, a, b in intervals if abs(cc - c) <= tol and b > lo and a < hi)
    tot, cur = 0.0, lo
    for a, b in segs:
        if b <= cur:
            continue
        tot += b - max(a, cur)
        cur = b
    return tot / max(hi - lo, 1e-9)


def assemble_rects(prims_iter, max_size: float = 40.0, min_size: float = 1.5) -> list[dict]:
    """ㄱ자 조각·파선으로 그려진 사각형 복원. 마주보는 두 모서리(좌상+우하 또는 우상+좌하) 와 네 변 덮임률로 판정.
    반환: [{bbox, color, coverage}] — coverage < 0.85 이면 파선 사각형."""
    items = list(prims_iter)
    H, V, corners = _axis_edges(items, max_size)
    cell = max_size
    by = defaultdict(list)
    for c in corners:
        by[(int(c[0] // cell), int(c[1] // cell))].append(c)
    Hi = {col: defaultdict(list) for col in H}
    Vi = {col: defaultdict(list) for col in V}
    for col, lst in H.items():
        for e in lst:
            Hi[col][round(e[0])].append(e)
    for col, lst in V.items():
        for e in lst:
            Vi[col][round(e[0])].append(e)

    def hcov(col, y, x0, x1, tol):
        return _coverage([e for k in (round(y) - 1, round(y), round(y) + 1) for e in Hi.get(col, {}).get(k, ())], y, x0, x1, tol)

    def vcov(col, x, y0, y1, tol):
        return _coverage([e for k in (round(x) - 1, round(x), round(x) + 1) for e in Vi.get(col, {}).get(k, ())], x, y0, y1, tol)

    out = []
    seen = set()

    def try_rect(x0, y0, x1, y1, col):
        w, h = x1 - x0, y1 - y0
        if not (min_size <= w <= max_size and min_size <= h <= max_size):
            return
        key = (round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1), col)
        if key in seen:
            return
        tol = 0.03 * max(w, h) + 0.15
        cv = [hcov(col, y0, x0, x1, tol), hcov(col, y1, x0, x1, tol), vcov(col, x0, y0, y1, tol), vcov(col, x1, y0, y1, tol)]
        if min(cv) < 0.35:
            return
        seen.add(key)
        out.append({"bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1}, "color": col, "coverage": round(sum(cv) / 4, 3)})

    # (a) 모서리 하나 + 두 다리 길이 (ㄱ자 조각이 변 전체를 그린 경우)
    for (x, y, hx, vy, col, lx, ly) in corners:
        x2, y2 = x + hx * lx, y + vy * ly
        try_rect(min(x, x2), min(y, y2), max(x, x2), max(y, y2), col)
    # (b) 마주보는 모서리 쌍 (파선 사각형: 모서리 조각이 짧음)
    for (x, y, hx, vy, col, lx, ly) in corners:
        # 좌상(오른쪽·아래로 다리) → 우하 / 좌하(오른쪽·위) → 우상 을 찾는다 (y-up 좌표)
        if hx != 1:
            continue
        gx, gy = int(x // cell), int(y // cell)
        for dx_ in (0, 1):
            for dy_ in (-1, 0, 1):
                for (x2, y2, hx2, vy2, col2, _, _) in by.get((gx + dx_, gy + dy_), ()):
                    if col2 != col or hx2 != -1 or vy2 != -vy or (y2 - y) * vy <= 0 or x2 <= x:
                        continue
                    try_rect(x, min(y, y2), x2, max(y, y2), col)
    # 같은 사각형 중복(조각 여러 개) 제거
    return out


def _on_border(q: dict, b: dict) -> bool:
    """프리미티브의 모든 점이 사각형 테두리 위(3% 이내)에 있으면 테두리 조각."""
    size = max(b["x1"] - b["x0"], b["y1"] - b["y0"])
    t = 0.04 * size + 0.1
    pts = q["p"]
    # 꼭짓점뿐 아니라 선분 중간점도 테두리 위여야 한다 (모서리→모서리 대각선 X 는 내부 내용)
    checks = list(pts) + [((a[0] + c[0]) / 2, (a[1] + c[1]) / 2) for a, c in zip(pts, pts[1:])]
    for x, y in checks:
        if not (abs(x - b["x0"]) <= t or abs(x - b["x1"]) <= t or abs(y - b["y0"]) <= t or abs(y - b["y1"]) <= t):
            return False
    return True


def _sheet_index(sheet: dict):
    """시트별 1회: 닫힌 도형 목록 + 공간 격자."""
    cache = sheet.setdefault("_anchor_cache", {})
    if "closed" in cache:
        return cache["closed"], cache["grid"], cache["cell"]
    prims = sheet["prims"]
    closed = []
    sizes = []
    for i, p in enumerate(prims):
        k = closed_kind(p)
        if k:
            b = prim_bbox(p)
            s = max(b["x1"] - b["x0"], b["y1"] - b["y0"])
            closed.append((i, k, b, s, _aspect(b), _color(p.get("layer"))))
            sizes.append(s)
    for r in assemble_rects(((j, q) for j, q in enumerate(prims) if q.get("t") == "l"), max_size=60.0):
        b = r["bbox"]
        s_ = max(b["x1"] - b["x0"], b["y1"] - b["y0"])
        closed.append((-1, "rect", b, s_, _aspect(b), r["color"], r["coverage"] < 0.85))
        sizes.append(s_)
    closed = [c if len(c) == 7 else (*c, False) for c in closed]
    sizes.sort()
    cell = max(sizes[len(sizes) // 2] if sizes else 10.0, 2.0)
    grid = defaultdict(list)
    for j, q in enumerate(prims):
        if len(q.get("p") or []) < 1:
            continue
        qb = prim_bbox(q)
        if max(qb["x1"] - qb["x0"], qb["y1"] - qb["y0"]) > 8 * cell:
            continue
        for gx in range(int(qb["x0"] // cell), int(qb["x1"] // cell) + 1):
            for gy in range(int(qb["y0"] // cell), int(qb["y1"] // cell) + 1):
                grid[(gx, gy)].append(j)
    cache.update(closed=closed, grid=grid, cell=cell)
    return closed, grid, cell


def anchor_matches(desc: dict, sheet: dict, size_range=(0.6, 1.8)) -> list[dict]:
    """도면에서 앵커 서술자와 맞는 후보 → [{x, y, bbox, sim, size, handle}]"""
    prims = sheet["prims"]
    closed, grid, cell = _sheet_index(sheet)
    lo, hi = desc["size"] * size_range[0], desc["size"] * size_range[1]
    out = []
    for i, k, b, s, asp, col, dashed in closed:
        if k != desc["kind"] or not (lo <= s <= hi):
            continue
        if k == "rect" and bool(desc.get("dashed")) != bool(dashed):
            continue   # 실선(신설) / 파선(기존) 구분
        if abs(asp - desc["aspect"]) > (0.25 if k == "circle" else 0.15):
            continue
        if desc["color"] and col != desc["color"]:
            continue
        near = set()
        for gx in range(int(b["x0"] // cell), int(b["x1"] // cell) + 1):
            for gy in range(int(b["y0"] // cell), int(b["y1"] // cell) + 1):
                near.update(grid.get((gx, gy), ()))
        inner = _interior(((j, prims[j]) for j in near), i, b, col)
        d = _interior_desc(inner, b)
        li = desc["interior"]
        if li["empty"]:
            # 범례는 빈 도형: 후보 내부에 잉크가 조금(겹친 선 조각) 있으면 점수를 깎아 '검토' 로
            sim = max(0.0, 1.0 - max(0.0, d.get("frac", 0.0) - 0.015) / 0.06)
        elif d["empty"]:
            sim = 0.0
        else:
            sim = bitmap_similarity({"bm": li["bm"], "n": li["n"]}, {"bm": d["bm"], "n": d["n"]}, dil=1)
            if li["fill"] != d["fill"]:
                sim *= 0.5
        out.append({"x": (b["x0"] + b["x1"]) / 2, "y": (b["y0"] + b["y1"]) / 2, "bbox": b, "sim": sim, "size": s,
                    "handle": prims[i].get("h") if i >= 0 else f"rect@{round(b['x0'],1)},{round(b['y0'],1)}"})
    # 같은 위치의 이중 테두리(외곽·내곽) 는 큰 쪽 1개만
    out.sort(key=lambda c: -c["size"])
    kept = []
    for c in out:
        if any(abs(c["x"] - k["x"]) < 0.3 * k["size"] and abs(c["y"] - k["y"]) < 0.3 * k["size"] for k in kept):
            continue
        kept.append(c)
    return kept


STOP = {"신설", "기존", "또는", "설치", "표시", "참조", "상세도", "평면도", "도면", "규격", "사용", "용", "및"}


def _tokens(name: str) -> list[str]:
    import re
    toks = re.findall(r"[가-힣]{2,}|[A-Za-z]{3,}", name or "")
    return [t.upper() for t in toks if t not in STOP]


def is_sample(det_xy: tuple, det_size: float, item_name: str, texts: list[dict]) -> bool:
    """기호 바로 오른쪽(같은 줄)에 그 품명을 설명하는 문자가 있으면 범례·주기사항의 견본 기호로 본다."""
    x, y = det_xy
    toks = _tokens(item_name)
    if not toks:
        return False
    for t in texts:
        tb = t.get("bbox") or {"x0": t["x"], "y0": t["y"], "x1": t["x"], "y1": t["y"]}
        cy = (tb["y0"] + tb["y1"]) / 2
        if abs(cy - y) > max(0.8 * det_size, 0.8 * (tb["y1"] - tb["y0"])):
            continue
        if not (x < tb["x0"] <= x + max(6 * det_size, 40)):
            continue
        s = (t.get("text") or "").replace(" ", "").upper()
        if any(tok in s for tok in toks):
            return True
    return False
