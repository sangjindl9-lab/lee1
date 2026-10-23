"""기호 자동 검출 (하이브리드) 및 중복 제거.

방법 우선순위: block(블록명·속성) > fingerprint(기하 지문: 다른 블록명/폭발 도형/벡터PDF) > text(문자 라벨)
> template(스캔 이미지 템플릿 매칭). 동일 위치 다중 검출은 1개만 남긴다.
범례표 영역 안의 참조 기호는 제외한다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .anchor import anchor_matches, is_sample
from .geometry import bbox_of, bitmap_signature, bitmap_similarity, cluster_prims, fingerprint_similarity, in_region, prim_bbox

EXISTING_WORDS = ["기존", "EXIST", "EXISTING", "EX-", "EX_", "현황"]
REMOVE_WORDS = ["철거", "DEMO", "REMOVE", "DEL"]
RELOCATE_WORDS = ["이설", "RELOC", "MOVE"]


@dataclass
class Detection:
    legend_symbol_id: int
    x: float
    y: float
    bbox: dict | None
    method: str
    confidence: float
    handle: str | None
    install_type: str = "new"
    status: str = "auto"   # auto | review


def install_type_of(layer: str | None, block: str | None = None) -> str:
    s = f"{layer or ''} {block or ''}".upper()
    if any(w in s for w in REMOVE_WORDS):
        return "remove"
    if any(w in s for w in RELOCATE_WORDS):
        return "relocate"
    if any(w in s for w in EXISTING_WORDS):
        return "existing"
    return "new"


def _excluded(x: float, y: float, exclude_regions: list[dict]) -> bool:
    return any(in_region(x, y, r) for r in exclude_regions)


def detect_in_sheet(sheet: dict, legend_symbols: list[dict], exclude_regions: list[dict],
                    raster_path: str | None = None, raster_meta: dict | None = None) -> list[Detection]:
    """legend_symbols: [{id, block_name, fingerprint, symbol_name, category, image_path}] (device 만 전달)."""
    entities, prims, texts, blocks = sheet["entities"], sheet["prims"], sheet["texts"], sheet.get("blocks", {})
    dets: list[Detection] = []
    inserts = [e for e in entities if e["t"] == "INSERT"]

    for ls in legend_symbols:
        lid = ls["id"]
        bname = (ls.get("block_name") or "").upper()
        fp = ls.get("fingerprint")

        # 1) 블록명 일치
        if bname:
            for e in inserts:
                if e["block"].upper() == bname and not _excluded(e["x"], e["y"], exclude_regions):
                    dets.append(Detection(lid, e["x"], e["y"], e.get("bbox"), "block", 0.97, e["h"],
                                          install_type_of(e.get("layer"), e["block"])))
        # 2) 기하 지문 — 블록명이 다르지만 같은 모양 (CAM1 vs CAM-1 복사본 등)
        if fp and fp.get("n", 0) > 0:
            for bn, bdef in blocks.items():
                if bn.upper() == bname:
                    continue
                sim = fingerprint_similarity(fp, bdef.get("fingerprint"))
                if sim >= 0.92:
                    for e in inserts:
                        if e["block"] == bn and not _excluded(e["x"], e["y"], exclude_regions):
                            dets.append(Detection(lid, e["x"], e["y"], e.get("bbox"), "fingerprint", round(0.6 + 0.3 * sim, 2), e["h"],
                                                  install_type_of(e.get("layer"), bn), "review" if sim < 1.0 else "auto"))
            # 폭발 도형 / 벡터 PDF: 비트맵 지문이 있으면 일반 클러스터 비교, 없으면 원 중심 클러스터 비교
            if (not bname or sheet.get("_force_cluster")) and fp.get("anchor"):
                # 외곽 도형 + 내부 내용 (주 방식). 학습된 변형(variants)도 같은 방식으로
                for variant in [fp] + list(fp.get("variants") or []):
                    ad = variant.get("anchor")
                    if not ad:
                        continue
                    for c in anchor_matches(ad, sheet):
                        if c["sim"] < 0.7 or _excluded(c["x"], c["y"], exclude_regions):
                            continue
                        dets.append(Detection(lid, c["x"], c["y"], c["bbox"], "anchor", round(0.5 + 0.5 * c["sim"], 3), c["handle"],
                                              "new", "auto" if c["sim"] >= 0.85 else "review"))
            elif not bname or sheet.get("_force_cluster"):
                if fp.get("bm"):
                    for variant in [fp] + list(fp.get("variants") or []):
                        if variant.get("bm"):
                            dets.extend(_vector_cluster_matches(lid, variant, prims, exclude_regions, sheet))
                else:
                    dets.extend(_cluster_matches(lid, fp, prims, exclude_regions))
        # 3) 문자 라벨 (블록·지문 없이 엑셀 등에서 등록된 기호명)
        sname = (ls.get("symbol_name") or "").strip()
        if sname and not bname and not (fp and fp.get("n", 0) > 0) and len(sname) <= 8:
            for t in texts:
                if t["text"].strip().upper() == sname.upper() and not _excluded(t["x"], t["y"], exclude_regions):
                    dets.append(Detection(lid, t["x"], t["y"], t.get("bbox"), "text", 0.6, t["h"],
                                          install_type_of(t.get("layer")), "review"))
        # 4) 스캔 이미지 템플릿 매칭
        if raster_path and ls.get("image_path") and raster_meta:
            dets.extend(_template_matches(lid, ls["image_path"], raster_path, raster_meta, exclude_regions))

    # 범례·주기사항 안 견본 기호(오른쪽에 품명 설명이 붙은 기호) 제외
    names = {ls["id"]: ls.get("item_name") or "" for ls in legend_symbols}
    kept = []
    for d in dets:
        size = max(d.bbox["x1"] - d.bbox["x0"], d.bbox["y1"] - d.bbox["y0"]) if d.bbox else 5.0
        if names.get(d.legend_symbol_id) and is_sample((d.x, d.y), size, names[d.legend_symbol_id], texts):
            continue
        kept.append(d)
    return dedupe(kept, sheet)


def _vector_cluster_matches(lid: int, fp: dict, prims: list[dict], exclude_regions: list[dict], sheet: dict) -> list[Detection]:
    """비트맵 지문 기반 검출.
    닫힌 도형·원·작은 채움(앵커)을 중심으로 범례 기호 크기의 창을 잡아 같은 스타일의 프리미티브를 모으고,
    회전·반전 IoU 로 비교한다. 선로가 기호에 붙어 들어온 경우를 대비해 프리미티브를 최대 3개까지 빼 보며 최적을 찾는다."""
    size = float(fp.get("size") or 0)
    if size <= 0:
        return []
    layers = set(fp.get("layers") or ())
    fill_ok = any(L.startswith("FILL") for L in layers)

    def style_ok(p):
        if p.get("t") == "f" and len(p["p"]) > 12:
            return False
        return (not layers) or p.get("layer") in layers or (p.get("t") == "f" and fill_ok)

    # 스타일별 공간 격자 (시트당 1회)
    cache = sheet.setdefault("_grid_cache", {})
    gkey = (tuple(sorted(layers)), round(size, 1))
    if gkey not in cache:
        cell = max(size, 1e-6)
        grid: dict[tuple[int, int], list[int]] = {}
        for i, p in enumerate(prims):
            if not style_ok(p) or len(p["p"]) < 2:
                continue
            b = prim_bbox(p)
            if max(b["x1"] - b["x0"], b["y1"] - b["y0"]) > 1.4 * size:
                continue
            for gx in range(int(b["x0"] // cell), int(b["x1"] // cell) + 1):
                for gy in range(int(b["y0"] // cell), int(b["y1"] // cell) + 1):
                    grid.setdefault((gx, gy), []).append(i)
        cache[gkey] = (grid, cell)
    grid, cell = cache[gkey]

    ar = fp.get("anchor_ratio")
    lo, hi = (0.25 * size, 1.4 * size) if not ar else (0.6 * ar * size, 1.6 * ar * size)

    def is_anchor(p):
        b = prim_bbox(p)
        d = max(b["x1"] - b["x0"], b["y1"] - b["y0"])
        if not (lo <= d <= hi):
            return False
        if p.get("t") == "c":
            return True
        if p.get("t") == "f" and 3 <= len(p["p"]) <= 12:
            return True
        pts = p["p"]
        return len(pts) >= 4 and math.dist(pts[0], pts[-1]) <= 0.05 * size

    half = 0.8 * size
    thr = 0.86 if (fp.get("lines", 0) + fp.get("circles", 0) + fp.get("arcs", 0) <= 2) else 0.78
    out = []
    seen: set[tuple[int, int]] = set()
    for i, p in enumerate(prims):
        if not style_ok(p) or not is_anchor(p):
            continue
        b = prim_bbox(p)
        cx, cy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
        if _excluded(cx, cy, exclude_regions):
            continue
        key = (int(cx // (size * 0.5)), int(cy // (size * 0.5)))
        if key in seen:
            continue
        win = {"x0": cx - half, "y0": cy - half, "x1": cx + half, "y1": cy + half}
        members = set()
        for gx in range(int(win["x0"] // cell), int(win["x1"] // cell) + 1):
            for gy in range(int(win["y0"] // cell), int(win["y1"] // cell) + 1):
                for j in grid.get((gx, gy), ()):
                    bj = prim_bbox(prims[j])
                    inside = bj["x0"] >= win["x0"] and bj["x1"] <= win["x1"] and bj["y0"] >= win["y0"] and bj["y1"] <= win["y1"]
                    # 창 안에 완전히 들어오거나, 앵커에 붙어 있으면서(화살표 등) 기호 크기의 1.2배 이하인 부속
                    touch = bj["x0"] <= b["x1"] + 0.1 * size and bj["x1"] >= b["x0"] - 0.1 * size and bj["y0"] <= b["y1"] + 0.1 * size and bj["y1"] >= b["y0"] - 0.1 * size \
                        and max(bj["x1"] - bj["x0"], bj["y1"] - bj["y0"]) <= 1.2 * size
                    if inside or touch:
                        members.add(j)
        members.add(i)
        mem = list(members)
        if len(mem) > 40:   # 글자·해치 밀집 구역은 기호가 아님
            continue
        best_sim, best_mem = _best_subset(fp, prims, mem, i, thr, (cx, cy))
        # 2단계: 전체 모양은 다르지만(화살표 방향·길이가 제각각 등) 앵커 도형이 같으면 '추가 검토' 로 후보 등록
        review_only = False
        if best_sim < thr and fp.get("anchor_bm") and best_sim >= 0.5:
            asig = bitmap_signature([{"t": p["t"], "p": p["p"]}])
            if bitmap_similarity({"bm": fp["anchor_bm"], "n": asig.get("n")}, asig, dil=2) >= 0.8:
                review_only = True
        if best_sim >= thr or review_only:
            seen.add(key)
            pts = [q for j in best_mem for q in prims[j]["p"]]
            bb = bbox_of(pts)
            csize = max(bb["x1"] - bb["x0"], bb["y1"] - bb["y0"])
            if not (0.55 * size <= csize <= 1.7 * size):
                continue
            out.append(Detection(lid, (bb["x0"] + bb["x1"]) / 2, (bb["y0"] + bb["y1"]) / 2, bb, "fingerprint",
                                 round(0.5 + 0.5 * best_sim, 2), p.get("h"), "new",
                                 "auto" if (best_sim >= 0.9 and not review_only) else "review"))
    return out


def _rotated(prims_sel: list[dict], center, deg: float) -> list[dict]:
    if deg == 0:
        return prims_sel
    ca, sa = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    cx, cy = center
    return [{**pr, "p": [(cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca) for x, y in pr["p"]]} for pr in prims_sel]


def _best_subset(fp: dict, prims: list[dict], mem: list[int], anchor: int, thr: float, center=None) -> tuple[float, list[int]]:
    """후보 묶음에서 범례 지문과 가장 비슷한 부분집합(최대 4개 제거)·회전각(15° 단위) 을 찾는다."""
    def sim_of(ids):
        sel = [{"t": prims[j]["t"], "p": prims[j]["p"]} for j in ids]
        best = bitmap_similarity(fp, bitmap_signature(sel))
        if best < thr and center is not None:
            for deg in range(15, 90, 15):
                best = max(best, bitmap_similarity(fp, bitmap_signature(_rotated(sel, center, deg))))
                if best >= thr:
                    break
        return best
    cur = list(mem)
    best = sim_of(cur)
    for _ in range(4):
        if best >= thr or len(cur) <= 1:
            break
        trial = None
        for j in cur:
            if j == anchor:
                continue
            ids = [k for k in cur if k != j]
            sm = sim_of(ids)
            if trial is None or sm > trial[0]:
                trial = (sm, ids)
        if trial and trial[0] > best:
            best, cur = trial
        else:
            break
    return best, cur


def _cluster_matches(lid: int, fp: dict, prims: list[dict], exclude_regions: list[dict]) -> list[Detection]:
    """지문에 원이 포함된 기호: 도면의 비블록 원을 중심으로 주변 프리미티브를 모아 비교."""
    from .geometry import shape_fingerprint
    if fp.get("circles", 0) == 0:
        return []
    out = []
    circles = [p for p in prims if p.get("t") == "c" and not p.get("blk") and p.get("c")]
    others = [p for p in prims if not p.get("blk") and p.get("t") in ("l", "a", "c")]
    for c in circles:
        cx, cy = c["c"]
        r = c.get("r", 0) or 0
        if r <= 0 or _excluded(cx, cy, exclude_regions):
            continue
        R = r * 2.5
        cl = [p for p in others if all(abs(x - cx) <= R and abs(y - cy) <= R for x, y in p["p"])]
        if not cl:
            continue
        sig = shape_fingerprint([{"t": p["t"], "p": p["p"], "r": p.get("r")} for p in cl], [])
        sim = fingerprint_similarity(fp, sig)
        if sim >= 0.9:
            out.append(Detection(lid, cx, cy, bbox_of([q for p in cl for q in p["p"]]), "fingerprint",
                                 round(0.55 + 0.35 * sim, 2), c.get("h"), "new", "review" if sim < 1.0 else "auto"))
    return out


def _template_matches(lid: int, tmpl_path: str, raster_path: str, meta: dict, exclude_regions: list[dict]) -> list[Detection]:
    """OpenCV 템플릿 매칭 (0/90/180/270 회전). meta: {w,h,dpi, page_w_pt, page_h_pt}."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []
    img = cv2.imread(raster_path, cv2.IMREAD_GRAYSCALE)
    tm = cv2.imread(tmpl_path, cv2.IMREAD_GRAYSCALE)
    if img is None or tm is None or tm.shape[0] < 10 or tm.shape[1] < 10:
        return []
    # 템플릿 여백 제거(잉크 bbox) 후 매칭 — 칸 전체가 아니라 기호만 비교
    ys_, xs_ = np.where(tm < 128)
    if len(xs_) < 20:
        return []
    tm = tm[max(0, ys_.min() - 2):ys_.max() + 3, max(0, xs_.min() - 2):xs_.max() + 3]
    if tm.shape[0] < 10 or tm.shape[1] < 10:
        return []
    px_per_pt = meta["dpi"] / 72.0
    H = meta["h"]
    out = []
    for k in range(4):
        t = np.rot90(tm, k)
        if t.shape[0] >= img.shape[0] or t.shape[1] >= img.shape[1]:
            continue
        res = cv2.matchTemplate(img, t, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(res >= 0.82)
        th, tw = t.shape
        for yy, xx in zip(ys, xs):
            score = float(res[yy, xx])
            cx = (xx + tw / 2) / px_per_pt
            cy = (H - (yy + th / 2)) / px_per_pt
            if _excluded(cx, cy, exclude_regions):
                continue
            out.append(Detection(lid, cx, cy, {"x0": xx / px_per_pt, "y0": (H - yy - th) / px_per_pt, "x1": (xx + tw) / px_per_pt, "y1": (H - yy) / px_per_pt},
                                 "template", round(score, 2), None, "new", "review"))
    return out


def dedupe(dets: list[Detection], sheet: dict) -> list[Detection]:
    """같은 범례기호가 같은 위치에 여러 방법으로 검출되면 신뢰도 높은 1개만. 거리 임계 = 기호 크기의 50%."""
    dets.sort(key=lambda d: -d.confidence)
    kept: list[Detection] = []
    for d in dets:
        size = 1.0
        if d.bbox:
            size = max(d.bbox["x1"] - d.bbox["x0"], d.bbox["y1"] - d.bbox["y0"], 1e-6)
        tol = max(size * 0.5, 1e-6)
        dup = False
        for k in kept:
            if k.legend_symbol_id == d.legend_symbol_id and math.dist((k.x, k.y), (d.x, d.y)) <= tol:
                dup = True
                break
            # 다른 범례기호라도 같은 CAD 핸들이면 중복(한 객체 = 1수량)
            if d.handle and k.handle == d.handle:
                dup = True
                break
        if not dup:
            kept.append(d)
    return kept
