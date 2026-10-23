"""PDF 선로 추출: 굵은 선(채움 띠) 중심선 변환, 선종(실선·파선·일점쇄선) 판정, 간격 포함 경로 길이."""
from __future__ import annotations

import math
from collections import defaultdict

from .geometry import UnionFind, bbox_of, polyline_length, prim_bbox


def thick_centerline(p: dict) -> dict | None:
    """가늘고 긴 채움 도형(굵은 선이 띠로 저장된 것) → 중심선. 폭 ≤ 3pt, 길이/폭 ≥ 2."""
    pts = p.get("p") or []
    if p.get("t") != "f" or len(pts) < 3 or len(pts) > 12:
        return None
    cx = sum(x for x, _ in pts) / len(pts)
    cy = sum(y for _, y in pts) / len(pts)
    sxx = sum((x - cx) ** 2 for x, _ in pts)
    syy = sum((y - cy) ** 2 for _, y in pts)
    sxy = sum((x - cx) * (y - cy) for x, y in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang)
    along = [(x - cx) * ux + (y - cy) * uy for x, y in pts]
    perp = [-(x - cx) * uy + (y - cy) * ux for x, y in pts]
    L = max(along) - min(along)
    w = max(perp) - min(perp)
    if w < 0.3 or w > 3.0 or L < 2.5 or L < 2 * w:
        return None
    # 띠 모양 확인: 다각형 면적 ≈ 길이×폭 (글자 획 조각·삼각형 배제)
    area = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        area += x1 * y2 - x2 * y1
    # 굵은 선이 삼각형 2개로 저장된 경우(점 3개)도 띠의 절반으로 인정 — 중복 중심선은 그룹화 전에 제거
    if abs(area) / 2 < (0.35 if len(pts) == 3 else 0.7) * L * w:
        return None
    a, b = min(along), max(along)
    col = (p.get("layer") or "").split(" ")[-1]
    return {"t": "l", "p": [(cx + a * ux, cy + a * uy), (cx + b * ux, cy + b * uy)], "layer": f"W{round(w, 1)} {col}",
            "h": p.get("h"), "cl": True, "w": round(w, 2)}


def _merge_triangle_pairs(prims: list[dict]):
    """굵은 선이 삼각형 2개(공유 변)로 저장된 경우 사각형 1개로 합친다. 나머지는 그대로 통과."""
    tri_by_edge = {}
    used = set()
    tris = []
    for i, p in enumerate(prims):
        if p.get("t") == "f" and len(p.get("p") or []) == 3:
            tris.append(i)
            pts = [tuple(round(v, 2) for v in q) for q in p["p"]]
            for a, b in ((0, 1), (1, 2), (0, 2)):
                tri_by_edge.setdefault(frozenset((pts[a], pts[b])), []).append(i)
    merged = {}
    for edge, lst in tri_by_edge.items():
        if len(lst) == 2 and lst[0] not in used and lst[1] not in used:
            i, j = lst
            pts = list({tuple(round(v, 2) for v in q) for q in prims[i]["p"] + prims[j]["p"]})
            if len(pts) != 4:
                continue
            cx = sum(x for x, _ in pts) / 4
            cy = sum(y for _, y in pts) / 4
            pts.sort(key=lambda q: math.atan2(q[1] - cy, q[0] - cx))
            merged[i] = {**prims[i], "p": pts}
            used.update((i, j))
    for i, p in enumerate(prims):
        if i in merged:
            yield merged[i]
        elif i not in used:
            yield p


def _dot_piece(p: dict) -> dict | None:
    """일점쇄선의 '점' — 굵은 선 폭 정도 크기의 작은 채움 사각형 → 길이 ≈ 짧은 변 인 점 조각."""
    pts = p.get("p") or []
    if len(pts) != 4:
        return None
    b = prim_bbox(p)
    w, h = b["x1"] - b["x0"], b["y1"] - b["y0"]
    if not (0.3 <= max(w, h) <= 3.0) or min(w, h) < 0.2:
        return None
    col = (p.get("layer") or "").split(" ")[-1]
    cx, cy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
    if w >= h:   # 가로로 넓다 = 세로 방향 선의 점
        a, c = (cx, cy - h / 2), (cx, cy + h / 2)
    else:
        a, c = (cx - w / 2, cy), (cx + w / 2, cy)
    return {"t": "l", "p": [a, c], "layer": f"W{round(max(w, h), 1)} {col}", "h": p.get("h"), "cl": True, "dot": True}


def classify_pattern(lengths: list[float]) -> str:
    """조각 길이 분포로 선종 판정."""
    L = sorted(x for x in lengths if x > 0.05)
    if len(L) <= 1:
        return "solid"
    mx = L[-1]
    short = sum(1 for x in L if x < 0.35 * mx)
    long_ = sum(1 for x in L if x >= 0.6 * mx)
    if short >= 0.2 * len(L) and long_ >= 0.2 * len(L):
        return "dashdot"
    med = L[len(L) // 2]
    if len(L) >= 3 and mx / max(med, 1e-6) < 2.0:
        return "dashed"
    return "solid"


def _color_dark(layer: str) -> bool:
    col = (layer or "").split(" ")[-1]
    try:
        v = [int(col[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        return sum(v) / 3 < 0.45
    except Exception:
        return True


def pdf_route_groups(prims: list[dict], exclude: list[dict], page_dim: float, symbols: list[dict]) -> list[dict]:
    """같은 스타일(굵기·색) 선 조각을 간격 허용으로 연결 → 그룹.
    각 그룹: {style, pattern, pieces:[prim], length (간격 포함), touches: 기호 접속 수}"""
    def inside(pt):
        return any(r["x0"] <= pt[0] <= r["x1"] and r["y0"] <= pt[1] <= r["y1"] for r in exclude)

    # 검출된 기호 영역(50% 확장) 안에 양 끝이 모두 들어가는 선 = 기호 자체의 선(받침·눈금·X) → 선로 아님
    sym_boxes = []
    for sb in symbols:
        b = sb["bbox"]
        m = 0.5 * max(b["x1"] - b["x0"], b["y1"] - b["y0"], 1.0)
        sym_boxes.append((b["x0"] - m, b["y0"] - m, b["x1"] + m, b["y1"] + m))

    def in_symbol(a, c):
        return any(x0 <= a[0] <= x1 and y0 <= a[1] <= y1 and x0 <= c[0] <= x1 and y0 <= c[1] <= y1 for x0, y0, x1, y1 in sym_boxes)

    by_style: dict[str, list[dict]] = defaultdict(list)
    for p in _merge_triangle_pairs(prims):
        if p.get("t") == "f":
            c = thick_centerline(p) or _dot_piece(p)
            if c:
                p = c
            else:
                continue
        if p.get("t") not in ("l", "a") or len(p["p"]) < 2 or p.get("blk"):
            continue
        if not _color_dark(p.get("layer")):
            continue   # 회색 건축 배경선 제외
        pts = p["p"]
        if len(pts) >= 4 and math.dist(pts[0], pts[-1]) < 1e-6:
            continue   # 닫힌 도형(기호 테두리·표 칸)
        L = polyline_length(pts)
        if L <= 0.05 or (page_dim and L > 0.4 * page_dim) or inside(pts[0]) or inside(pts[-1]) or in_symbol(pts[0], pts[-1]):
            continue
        by_style[p.get("layer") or ""].append(p)

    # 같은 중심선 중복 제거 (삼각형 2개 → 같은 중심선 2개, 이중 출력선)
    for style, ps in list(by_style.items()):
        seen, uniq = set(), []
        for p in ps:
            a, b = p["p"][0], p["p"][-1]
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            L = math.dist(a, b)
            ang = round((math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180) / 6) % 30
            key = (round(mx / 1.5), round(my / 1.5), round(L), ang)
            if key in seen:
                continue
            seen.add(key)
            uniq.append(p)
        by_style[style] = uniq

    groups = []
    for style, ps in by_style.items():
        plen = [polyline_length(p["p"]) for p in ps]
        lens = sorted(plen)
        p75 = lens[int(len(lens) * 0.75)]
        tol = min(10.0, max(1.2, 1.2 * p75))   # 탐색 반경 (실제 허용은 쌍마다 판정)
        ends = [(p["p"][0], p["p"][-1]) for p in ps]
        uf = UnionFind(len(ps))
        cell = tol
        grid = defaultdict(list)
        for i, (a, b) in enumerate(ends):
            for q in (a, b):
                grid[(int(q[0] // cell), int(q[1] // cell))].append((i, q))
        edges = []
        for (gx, gy), lst in grid.items():
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j, q2 in grid.get((gx + dx, gy + dy), ()):
                        for i, q1 in lst:
                            if i < j:
                                d = math.dist(q1, q2)
                                if d > tol:
                                    continue
                                # 맞닿음(≤1.2pt) 은 방향 무관, 그 이상 간격은 같은 직선 위 + 조각 길이 1.2배 이내만
                                lim = 1.2 if d <= 1.2 else min(10.0, 1.2 * max(plen[i], plen[j], 1.0))
                                if d <= lim and _collinear_ok(ps[i], ps[j], q1, q2, d):
                                    edges.append((d, i, j))
        edges.sort()
        gap_sum = defaultdict(float)
        for d, i, j in edges:           # Kruskal: 최소 간격으로 이어 붙이고 간격 길이를 누적
            ri, rj = uf.find(i), uf.find(j)
            if ri != rj:
                uf.union(ri, rj)
                nr = uf.find(ri)
                gap_sum[nr] = gap_sum.pop(ri, 0.0) + gap_sum.pop(rj, 0.0) + d
        comp = defaultdict(list)
        for i in range(len(ps)):
            comp[uf.find(i)].append(i)
        for root, idx in comp.items():
            pieces = [ps[i] for i in idx]
            plens = [polyline_length(p["p"]) for p in pieces]
            pts = [q for p in pieces for q in p["p"]]
            groups.append({"style": style, "pattern": classify_pattern(plens), "pieces": pieces,
                           "drawn": sum(plens), "length": sum(plens) + gap_sum.get(root, 0.0), "bbox": bbox_of(pts),
                           "touches": _touches(pieces, symbols)})
    return groups


def _collinear_ok(p1, p2, q1, q2, d) -> bool:
    """간격을 건너 연결할 때는 두 조각 방향이 비슷해야 한다(직각 모서리는 거리 0 으로 이미 맞닿음)."""
    if d < 0.3:
        return True
    def direction(p, q):
        a, b = p["p"][0], p["p"][-1]
        if math.dist(q, a) < math.dist(q, b):
            a, b = b, a
        return (b[0] - a[0], b[1] - a[1])
    if p1.get("dot") or p2.get("dot"):
        # 점 조각은 상대 조각의 연장선 위(수직거리 ≤ 1pt)에 있어야 연결
        dot, line = (p1, p2) if p1.get("dot") else (p2, p1)
        if line.get("dot"):
            return False
        (ax, ay), (bx, by) = line["p"][0], line["p"][-1]
        dx, dy = bx - ax, by - ay
        n = math.hypot(dx, dy)
        if n < 1e-6:
            return False
        px = sum(x for x, _ in dot["p"]) / len(dot["p"])
        py = sum(y for _, y in dot["p"]) / len(dot["p"])
        return abs((px - ax) * dy - (py - ay) * dx) / n <= 1.0
    if d <= 1.2:
        return True
    v1, v2 = direction(p1, q1), direction(p2, q2)
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return False
    cos = abs((v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2))
    if cos < 0.985:
        return False
    # 상대 끝점이 이 조각의 연장선 위에 있어야 한다 (평행하지만 어긋난 선 배제)
    (ax, ay), (bx, by) = p1["p"][0], p1["p"][-1]
    dx, dy = bx - ax, by - ay
    return abs((q2[0] - ax) * dy - (q2[1] - ay) * dx) / max(math.hypot(dx, dy), 1e-9) <= 0.6


def _touches(pieces: list[dict], symbols: list[dict]) -> int:
    n = 0
    for s in symbols:
        b = s["bbox"]
        m = 0.6 * max(b["x1"] - b["x0"], b["y1"] - b["y0"], 2.0)
        for p in pieces:
            for q in (p["p"][0], p["p"][-1]):
                if b["x0"] - m <= q[0] <= b["x1"] + m and b["y0"] - m <= q[1] <= b["y1"] + m:
                    n += 1
                    break
            else:
                continue
            break
    return n
