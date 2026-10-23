"""기호 자동 검출 (하이브리드) 및 중복 제거.

방법 우선순위: block(블록명·속성) > fingerprint(기하 지문: 다른 블록명/폭발 도형/벡터PDF) > text(문자 라벨)
> template(스캔 이미지 템플릿 매칭). 동일 위치 다중 검출은 1개만 남긴다.
범례표 영역 안의 참조 기호는 제외한다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .geometry import bbox_of, fingerprint_similarity, in_region

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
            # 폭발 도형 / 벡터 PDF: 원(circle) 중심 클러스터 비교
            if not bname or sheet.get("_force_cluster"):
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

    return dedupe(dets, sheet)


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
    if img is None or tm is None or tm.shape[0] < 8 or tm.shape[1] < 8:
        return []
    px_per_pt = meta["dpi"] / 72.0
    H = meta["h"]
    out = []
    for k in range(4):
        t = np.rot90(tm, k)
        if t.shape[0] >= img.shape[0] or t.shape[1] >= img.shape[1]:
            continue
        res = cv2.matchTemplate(img, t, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(res >= 0.75)
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
