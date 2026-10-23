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
