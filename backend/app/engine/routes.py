"""배관·트레이·케이블 선로 길이 산출 (결정론적).

- 범례 선형 기호 ↔ 레이어(layer_hint) 또는 선 주변 규격 문자(spec label) 로 선로 식별
- 끝점 연결성으로 구간을 묶어 경로 생성, 길이 = Σ 선분/호 길이 (도면 단위)
- 중복 선분 검출 → 사용자 확인 항목
- 길이(m) = 도면단위 × scale_factor, 축척 미확정이면 None
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .geometry import find_duplicate_segments, group_connected, in_region, polyline_length


@dataclass
class RouteOut:
    legend_symbol_id: int
    segments: list[dict] = field(default_factory=list)   # {handle, layer, points, length_du, length_m, dup_of}
    length_du: float = 0.0
    length_m: float | None = None
    duplicates: list[tuple[int, int]] = field(default_factory=list)


def _norm_spec(s: str) -> str:
    return re.sub(r"[\s\-_()]", "", s or "").upper()


def match_segments_for_symbol(sheet: dict, ls: dict, exclude_regions: list[dict]) -> list[dict]:
    """ls: {id, layer_hint, symbol_name, spec, item_name}. 선형 프리미티브 반환."""
    prims = sheet["prims"]
    texts = sheet["texts"]
    out = []
    layer_hint = (ls.get("layer_hint") or "").upper()
    label_keys = {k for k in (_norm_spec(ls.get("symbol_name") or ""), _norm_spec(ls.get("spec") or "")) if len(k) >= 2}

    def inside(pr):
        return any(in_region(x, y, r) for r in exclude_regions for x, y in (pr["p"][0], pr["p"][-1]))

    import math as _m
    bb = sheet.get("bbox") or {}
    page_dim = max(bb.get("x1", 0) - bb.get("x0", 0), bb.get("y1", 0) - bb.get("y0", 0)) if bb else 0

    def plausible(pr):
        pts = pr["p"]
        if len(pts) >= 4 and _m.dist(pts[0], pts[-1]) < 1e-6:
            return False   # 닫힌 도형(사각형·표 칸) 은 선로가 아님
        if page_dim and polyline_length(pts) > 0.4 * page_dim:
            return False   # 도면 외곽선·표제란 긴 선 제외
        return True

    cands = [pr for pr in prims if pr.get("t") in ("l", "a") and not pr.get("blk") and len(pr["p"]) >= 2 and not inside(pr) and plausible(pr)]
    if layer_hint:
        out = [pr for pr in cands if (pr.get("layer") or "").upper() == layer_hint]
    if not out and label_keys:
        # 규격 라벨이 선분 근처(선 길이의 30% 이내, 라벨 높이 4배 이내)에 있는 선분
        labels = [t for t in texts if _norm_spec(t["text"]) in label_keys]
        for pr in cands:
            L = polyline_length(pr["p"])
            if L <= 0:
                continue
            for t in labels:
                h = float(t.get("height") or 2.5)
                tx, ty = t["x"], t["y"]
                d = _point_polyline_dist((tx, ty), pr["p"])
                if d <= 4 * h:
                    out.append(pr)
                    break
    return out


def _point_polyline_dist(p, pts) -> float:
    best = float("inf")
    for i in range(len(pts) - 1):
        best = min(best, _pt_seg_dist(p, pts[i], pts[i + 1]))
    return best


def _pt_seg_dist(p, a, b) -> float:
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.dist(p, a)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.dist(p, (ax + t * dx, ay + t * dy))


def build_routes(segments: list[dict], scale_factor: float | None, tol: float, dash: dict | None = None, dup_tol: float | None = None) -> list[RouteOut]:
    """연결된 선분을 경로로 묶고 길이를 계산. 반환은 범례기호 1개 기준 (여러 경로).
    dash: 범례 선형 기호의 파선 서명 {n, seg, gap}. 주어지면 묶음의 선분 길이 패턴이 맞는 경로만 남긴다
    (PDF 처럼 레이어 대신 선 굵기·색만 있을 때 실선/파선/일점쇄선을 구분)."""
    pts_list = [s["p"] for s in segments]
    dups = find_duplicate_segments(pts_list, dup_tol if dup_tol is not None else tol)
    dup_of: dict[int, int] = {}
    for a, b in dups:
        dup_of[b] = a
    groups = group_connected(pts_list, tol)
    if dash:
        seg_len = float(dash.get("seg") or 0)
        dashed = int(dash.get("n") or 1) > 1
        kept = []
        for g in groups:
            lens = sorted(polyline_length(pts_list[i]) for i in g)
            med = lens[len(lens) // 2] if lens else 0
            total = sum(lens)
            if total < 2.5 * float(dash.get("total") or seg_len):
                continue   # 범례 그림보다 짧은 토막은 선로가 아님
            if dashed:
                if len(g) >= 3 and seg_len > 0 and 0.4 * seg_len <= med <= 2.5 * seg_len:
                    kept.append(g)
            else:
                if med >= 0.5 * seg_len:
                    kept.append(g)
        groups = kept
    routes = []
    for g in groups:
        r = RouteOut(legend_symbol_id=0)
        for i in g:
            L = polyline_length(pts_list[i])
            seg = {"handle": segments[i].get("h"), "layer": segments[i].get("layer"), "points": pts_list[i],
                   "length_du": L, "length_m": (L * scale_factor) if scale_factor else None, "dup_of": dup_of.get(i)}
            r.segments.append(seg)
            if i not in dup_of:   # 중복 의심 선분은 기본 합계에서 제외 (사용자 확인 후 포함)
                r.length_du += L
        r.length_m = r.length_du * scale_factor if scale_factor else None
        r.duplicates = [(a, b) for a, b in dups if a in g]
        routes.append(r)
    return routes
