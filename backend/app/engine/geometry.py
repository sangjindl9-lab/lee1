"""결정론적 기하 유틸 — 길이 계산, 연결성, 중복 선분, 블록 지문."""
from __future__ import annotations

import hashlib
import math
from collections import defaultdict

Point = tuple[float, float]


def polyline_length(points: list[Point]) -> float:
    return sum(math.dist(points[i], points[i + 1]) for i in range(len(points) - 1))


def arc_points(cx: float, cy: float, r: float, a0: float, a1: float, n: int = 16) -> list[Point]:
    """각도(도) a0→a1 반시계 호를 n 분할한 점열."""
    a0r, a1r = math.radians(a0), math.radians(a1)
    if a1r <= a0r:
        a1r += 2 * math.pi
    return [(cx + r * math.cos(a0r + (a1r - a0r) * i / n), cy + r * math.sin(a0r + (a1r - a0r) * i / n))
            for i in range(n + 1)]


def arc_length(r: float, a0: float, a1: float) -> float:
    d = (a1 - a0) % 360
    if d == 0:
        d = 360
    return r * math.radians(d)


def bulge_to_arc_points(p0: Point, p1: Point, bulge: float, n: int = 12) -> list[Point]:
    """LWPOLYLINE bulge 세그먼트를 점열로 변환 (ezdxf 와 동일한 정의)."""
    if abs(bulge) < 1e-12:
        return [p0, p1]
    chord = math.dist(p0, p1)
    if chord < 1e-12:
        return [p0, p1]
    theta = 4 * math.atan(bulge)  # 중심각
    r = chord / (2 * math.sin(abs(theta) / 2))
    mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    d = math.sqrt(max(r * r - (chord / 2) ** 2, 0.0))
    dx, dy = (p1[0] - p0[0]) / chord, (p1[1] - p0[1]) / chord
    sign = 1 if bulge > 0 else -1
    cx, cy = mx - sign * d * dy, my + sign * d * dx
    a0 = math.atan2(p0[1] - cy, p0[0] - cx)
    pts = [(cx + r * math.cos(a0 + theta * i / n), cy + r * math.sin(a0 + theta * i / n)) for i in range(n + 1)]
    pts[0], pts[-1] = p0, p1
    return pts


def bbox_of(points: list[Point]) -> dict:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}


def in_region(x: float, y: float, region: dict | None) -> bool:
    if not region:
        return False
    return region["x0"] <= x <= region["x1"] and region["y0"] <= y <= region["y1"]


# ---------- 연결성 분석 (Union-Find) ----------
class UnionFind:
    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, a: int) -> int:
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a: int, b: int):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def group_connected(segments: list[list[Point]], tol: float) -> list[list[int]]:
    """끝점이 tol 이내로 맞닿은 선분을 하나의 경로로 묶는다. 반환: 세그먼트 인덱스 그룹."""
    uf = UnionFind(len(segments))
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    cell = max(tol, 1e-9)

    def key(p: Point):
        return (int(p[0] // cell), int(p[1] // cell))

    endpoints = []
    for i, seg in enumerate(segments):
        for p in (seg[0], seg[-1]):
            endpoints.append((i, p))
            grid[key(p)].append(len(endpoints) - 1)
    for idx, (i, p) in enumerate(endpoints):
        kx, ky = key(p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((kx + dx, ky + dy), []):
                    if j <= idx:
                        continue
                    i2, p2 = endpoints[j]
                    if i2 != i and math.dist(p, p2) <= tol:
                        uf.union(i, i2)
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(len(segments)):
        groups[uf.find(i)].append(i)
    return list(groups.values())


def find_duplicate_segments(segments: list[list[Point]], tol: float) -> list[tuple[int, int]]:
    """양 끝점이 (순서 무관) tol 이내로 같은 2점 선분 쌍 → 중복 의심."""
    dups = []
    simple = [(i, s[0], s[-1]) for i, s in enumerate(segments) if len(s) == 2]
    for a in range(len(simple)):
        i, a0, a1 = simple[a]
        for b in range(a + 1, len(simple)):
            j, b0, b1 = simple[b]
            if (math.dist(a0, b0) <= tol and math.dist(a1, b1) <= tol) or \
               (math.dist(a0, b1) <= tol and math.dist(a1, b0) <= tol):
                dups.append((i, j))
    return dups


# ---------- 블록/도형 지문 ----------
def shape_fingerprint(prims: list[dict], texts: list[str]) -> dict:
    """블록 정의(또는 벡터 클러스터)의 회전·축척 불변 지문.
    prims: [{"t":"l"|"c"|"a", "p":[...], "r":반지름}], texts: 블록 내부 문자.
    """
    counts = defaultdict(int)
    pts: list[Point] = []
    radii: list[float] = []
    for pr in prims:
        counts[pr["t"]] += 1
        pts.extend(pr.get("p", []))
        if pr.get("r"):
            radii.append(pr["r"])
    if not pts:
        return {"hash": "empty", "n": 0}
    bb = bbox_of(pts)
    w, h = bb["x1"] - bb["x0"], bb["y1"] - bb["y0"]
    size = max(w, h, 1e-9)
    aspect = round(min(w, h) / size, 2)
    rel_radii = sorted(round(r / size, 2) for r in radii)
    tset = sorted({t.strip().upper() for t in texts if t and t.strip()})
    sig = {"lines": counts["l"], "circles": counts["c"], "arcs": counts["a"], "aspect": aspect,
           "radii": rel_radii[:6], "texts": tset[:6]}
    h = hashlib.sha1(repr(sig).encode()).hexdigest()[:16]
    sig["hash"] = h
    sig["n"] = len(prims)
    return sig


def fingerprint_similarity(a: dict | None, b: dict | None) -> float:
    """0~1. 동일 hash 면 1. 그 외 구성요소 비교."""
    if not a or not b or a.get("n", 0) == 0 or b.get("n", 0) == 0:
        return 0.0
    if a.get("hash") == b.get("hash"):
        return 1.0
    score = 0.0
    for k in ("lines", "circles", "arcs"):
        av, bv = a.get(k, 0), b.get(k, 0)
        score += 1.0 if av == bv else max(0.0, 1 - abs(av - bv) / max(av, bv, 1))
    score += 1.0 - min(1.0, abs(a.get("aspect", 0) - b.get("aspect", 0)) * 4)
    ta, tb = set(a.get("texts", [])), set(b.get("texts", []))
    score += 1.0 if ta == tb else (len(ta & tb) / len(ta | tb) if (ta | tb) else 1.0)
    return round(score / 5.0, 3)


# ---------- 벡터 클러스터 + 비트맵 지문 (벡터 PDF / 폭발 블록 기호) ----------
BM_N = 24


def prim_bbox(pr: dict) -> dict:
    if "_bb" not in pr:
        pr["_bb"] = bbox_of(pr["p"])
    return pr["_bb"]


def cluster_prims(prims: list[dict], max_size: float, link: float) -> list[list[int]]:
    """bbox 최대변이 max_size 이하인 프리미티브를, bbox 간격이 link 이하면 같은 묶음으로 (grid + Union-Find)."""
    idx = [i for i, pr in enumerate(prims) if len(pr["p"]) >= 2 and max(prim_bbox(pr)["x1"] - prim_bbox(pr)["x0"], prim_bbox(pr)["y1"] - prim_bbox(pr)["y0"]) <= max_size]
    if not idx:
        return []
    cell = max(link, 1e-6) * 2
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i in idx:
        b = prim_bbox(prims[i])
        for gx in range(int(b["x0"] // cell), int(b["x1"] // cell) + 1):
            for gy in range(int(b["y0"] // cell), int(b["y1"] // cell) + 1):
                grid[(gx, gy)].append(i)
    pos = {i: k for k, i in enumerate(idx)}
    uf = UnionFind(len(idx))
    for cellidx in grid.values():
        for a in range(len(cellidx)):
            ba = prim_bbox(prims[cellidx[a]])
            for b in range(a + 1, len(cellidx)):
                bb = prim_bbox(prims[cellidx[b]])
                if ba["x0"] - link <= bb["x1"] and bb["x0"] - link <= ba["x1"] and ba["y0"] - link <= bb["y1"] and bb["y0"] - link <= ba["y1"]:
                    uf.union(pos[cellidx[a]], pos[cellidx[b]])
    groups: dict[int, list[int]] = defaultdict(list)
    for i in idx:
        groups[uf.find(pos[i])].append(i)
    return list(groups.values())


def bitmap_signature(prims: list[dict], n: int = BM_N, center: Point | None = None) -> dict:
    """프리미티브 묶음을 정사각 n×n 비트맵으로 래스터화 (bbox 정규화, 종횡비 유지).
    center(앵커 중심)가 주어지면 앵커에서 가장 먼 점이 +x 축을 향하도록 회전시켜 방향을 정규화한다
    (화살표 방향이 제각각인 등기구 기호 등). 90° 회전·반전은 비교 시 추가로 처리."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return {}
    pts = [q for pr in prims for q in pr["p"]]
    if not pts:
        return {}
    if center is not None:
        far = max(pts, key=lambda q: math.dist(q, center))
        ang = math.atan2(far[1] - center[1], far[0] - center[0])
        ca, sa = math.cos(-ang), math.sin(-ang)
        rot = lambda q: (center[0] + (q[0] - center[0]) * ca - (q[1] - center[1]) * sa,  # noqa: E731
                         center[1] + (q[0] - center[0]) * sa + (q[1] - center[1]) * ca)
        prims = [{**pr, "p": [rot(q) for q in pr["p"]]} for pr in prims]
        pts = [q for pr in prims for q in pr["p"]]
    bb = bbox_of(pts)
    w, h = bb["x1"] - bb["x0"], bb["y1"] - bb["y0"]
    size = max(w, h, 1e-9)
    img = np.zeros((n, n), np.uint8)
    pad = 1
    s = (n - 2 * pad - 1) / size
    ox = pad + ((n - 2 * pad - 1) - w * s) / 2
    oy = pad + ((n - 2 * pad - 1) - h * s) / 2
    for pr in prims:
        arr = np.array([[ox + (x - bb["x0"]) * s, oy + (bb["y1"] - y) * s] for x, y in pr["p"]], np.int32).reshape(-1, 1, 2)
        if pr.get("t") == "f" and len(pr["p"]) >= 3:
            cv2.fillPoly(img, [arr], 255)
        else:
            cv2.polylines(img, [arr], False, 255, 1)
    bits = np.packbits(img.flatten() > 0).tobytes().hex()
    return {"bm": bits, "n": n, "size": round(size, 3), "aspect": round(min(w, h) / size, 3)}


_BM_CACHE: dict = {}


def _bm_arrays(sig: dict, dil: int = 1):
    import cv2
    import numpy as np
    key = (sig["bm"], dil)
    if key in _BM_CACHE:
        return _BM_CACHE[key]
    n = sig["n"]
    A = np.unpackbits(np.frombuffer(bytes.fromhex(sig["bm"]), np.uint8))[: n * n].reshape(n, n)
    k = np.ones((2 * dil + 1, 2 * dil + 1), np.uint8)
    variants = []
    for flip in (False, True):
        Af = np.fliplr(A) if flip else A
        for r in range(4):
            Ar = np.ascontiguousarray(np.rot90(Af, r))
            variants.append((Ar.astype(bool), cv2.dilate(Ar, k).astype(bool), float(Ar.sum())))
    if len(_BM_CACHE) > 4096:
        _BM_CACHE.clear()
    val = (A.astype(bool), cv2.dilate(A, k).astype(bool), float(A.sum()), variants)
    _BM_CACHE[key] = val
    return val


def bitmap_similarity(a: dict | None, b: dict | None, dil: int = 1) -> float:
    """a(범례) 의 8개 변형(회전·반전) 과 b(후보) 의 양방향 포함률 기하평균 × IoU 보정. 최대값. dil=허용 오차 픽셀."""
    if not a or not b or not a.get("bm") or not b.get("bm") or a.get("n") != b.get("n"):
        return 0.0
    try:
        import numpy as np
        _, _, _, variants = _bm_arrays(a, dil)
        B, Bd, bsum = _bm_arrays(b, dil)[:3]
    except ImportError:
        return 0.0
    best = 0.0
    for Ar, Ard, asum in variants:
        a_in_b = float(np.logical_and(Ar, Bd).sum()) / max(asum, 1.0)
        b_in_a = float(np.logical_and(B, Ard).sum()) / max(bsum, 1.0)
        plain = float(np.logical_and(Ar, B).sum()) / max(float(np.logical_or(Ar, B).sum()), 1.0)
        score = (a_in_b * b_in_a) ** 0.5 * (0.6 + 0.4 * plain)
        if score > best:
            best = score
    return round(min(best, 1.0), 3)
