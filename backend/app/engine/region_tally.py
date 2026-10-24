"""수동 영역 집계 — 사용자가 드래그한 영역 안의 객체(기호)를 같은 모양끼리 묶어 개수를 세고,
선(케이블·배관 후보)을 선 종류(레이어/스타일)별로 모아 보여준다.

자동 범례 인식이 실패하는 도면에서도 동작하도록 범례 정보 없이 기하만 사용한다.
- DXF: 블록 삽입(INSERT)은 블록명으로 집계, 블록이 아닌(분해된) 도형은 아래 벡터 방식으로 묶음
- 벡터 PDF / 분해된 DXF 도형: 연결된 프리미티브 묶음(cluster) → 비트맵 지문(회전·반전 8방향) 비교로 같은 모양 그룹화
- 스캔(래스터) 도면: 벡터가 없어 객체를 나눌 수 없음 → 안내만
길이는 참고값(축척 확정 시 m)이며, 케이블 길이는 사용자가 직접 입력한다.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict

from .anchor import _interior, _interior_desc, _sheet_index, anchor_descriptor
from .symbol_library import suggest
from .geometry import bbox_of, bitmap_signature, bitmap_similarity, prim_bbox

GROUP_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# 수량 대상이 아닌 주기·가닥수·화살표·회로번호·인출/입상 표시 블록 (기본 체크 해제·회색 표시)
NOTE_BLOCK = re.compile(r"^(arrow|m-|0-|t-|z-[2-9]$|z-회로번호|z-인출|z-입상|z-입하|z-g\d|a\$|범례|.*주기$|.*(표제|도곽|title|border|north|방위|축척))", re.I)


def _inside(bb: dict, r: dict) -> bool:
    return bb["x0"] >= r["x0"] and bb["x1"] <= r["x1"] and bb["y0"] >= r["y0"] and bb["y1"] <= r["y1"]


def _center_in(bb: dict, r: dict) -> bool:
    cx, cy = (bb["x0"] + bb["x1"]) / 2, (bb["y0"] + bb["y1"]) / 2
    return r["x0"] <= cx <= r["x1"] and r["y0"] <= cy <= r["y1"]


def _intersects(bb: dict, r: dict) -> bool:
    return bb["x0"] <= r["x1"] and bb["x1"] >= r["x0"] and bb["y0"] <= r["y1"] and bb["y1"] >= r["y0"]


def _clip(a, b, r):
    """선분 a-b 를 사각형 r 로 자름 (Liang–Barsky). 영역 밖이면 None."""
    x0, y0 = a
    dx, dy = b[0] - a[0], b[1] - a[1]
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - r["x0"]), (dx, r["x1"] - x0), (-dy, y0 - r["y0"]), (dy, r["y1"] - y0)):
        if p == 0:
            if q < 0:
                return None
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return None
    return (x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy)


def _overlap_ratio(bb: dict, other: dict) -> float:
    ix = min(bb["x1"], other["x1"]) - max(bb["x0"], other["x0"])
    iy = min(bb["y1"], other["y1"]) - max(bb["y0"], other["y0"])
    if ix <= 0 or iy <= 0:
        return 0.0
    area = max((bb["x1"] - bb["x0"]) * (bb["y1"] - bb["y0"]), 1e-12)
    return ix * iy / area


def _union_bb(bbs: list[dict]) -> dict:
    return {"x0": min(b["x0"] for b in bbs), "y0": min(b["y0"] for b in bbs),
            "x1": max(b["x1"] for b in bbs), "y1": max(b["y1"] for b in bbs)}


def _prim_len(pr: dict, region: dict) -> tuple[float, list]:
    """영역 안쪽 길이와 잘린 점열들."""
    total, pieces = 0.0, []
    p = pr["p"]
    cur: list = []
    for a, b in zip(p, p[1:]):
        c = _clip(a, b, region)
        if c is None:
            if len(cur) >= 2:
                pieces.append(cur)
            cur = []
            continue
        total += math.dist(c[0], c[1])
        if cur and math.dist(cur[-1], c[0]) < 1e-9:
            cur.append(c[1])
        else:
            if len(cur) >= 2:
                pieces.append(cur)
            cur = [c[0], c[1]]
    if len(cur) >= 2:
        pieces.append(cur)
    return total, pieces


def analyze_region(geo: dict, region: dict, source_kind: str, scale_factor: float | None,
                   excluded_layers: set[str] | None = None, discipline: str | None = None,
                   exclude_regions: list[dict] | None = None) -> dict:
    """영역 집계. 반환: {mode, objects:[...], lines:[...], notes:[...]}.
    objects 각 항목: {key, label, kind('block'|'shape'), block, count, items:[{bbox,h}], sample:[prims], size}
    lines 각 항목: {key(layer/style), length (도면단위), length_m (축척 있으면), pieces:[[pt..]..]}"""
    excluded_layers = excluded_layers or set()
    excl = [r for r in (exclude_regions or []) if r]
    notes: list[str] = []
    prims = [pr for pr in geo.get("prims", []) if len(pr.get("p", [])) >= 2 and pr.get("layer") not in excluded_layers]
    is_raster = source_kind in ("pdf_raster", "image") or (geo.get("_raster") and not any(
        pr.get("layer") not in ("RASTER-LINE",) for pr in prims))
    if is_raster:
        return {"mode": "raster", "objects": [], "lines": [], "notes": [
            "스캔(이미지) 도면이라 객체를 도형 단위로 나눌 수 없습니다. 상단 '기호 수동 추가'로 클릭하여 세거나, "
            "CAD 원본(DWG/DXF) 또는 벡터 PDF 를 올리십시오."]}
    bbox = geo.get("bbox") or bbox_of([q for pr in prims for q in pr["p"]] or [(0, 0), (1, 1)])
    diag = math.hypot(bbox["x1"] - bbox["x0"], bbox["y1"] - bbox["y0"]) or 1.0
    rw, rh = region["x1"] - region["x0"], region["y1"] - region["y0"]
    max_size = min(diag * 0.03, max(rw, rh) * 0.6)
    min_size = diag * 0.0008
    link = max_size * 0.02

    objects: list[dict] = []
    # 1) DXF 블록 삽입: 블록명으로 집계 (중심이 영역 안)
    blk_handles: set = set()
    by_block: dict[str, list[dict]] = defaultdict(list)
    for e in geo.get("entities", []):
        if e.get("t") != "INSERT" or e.get("layer") in excluded_layers:
            continue
        bb = e.get("bbox") or {"x0": e["x"], "y0": e["y"], "x1": e["x"], "y1": e["y"]}
        if any(rx["x0"] <= e["x"] <= rx["x1"] and rx["y0"] <= e["y"] <= rx["y1"] for rx in excl):
            continue   # 범례표 안의 견본 기호
        if r_ok := (region["x0"] <= e["x"] <= region["x1"] and region["y0"] <= e["y"] <= region["y1"]):
            by_block[e["block"]].append({"bbox": bb, "h": e.get("h"), "x": e["x"], "y": e["y"]})
        if r_ok or _intersects(bb, region):
            blk_handles.add(e.get("h"))
    blocks = geo.get("blocks", {})
    for name, items in sorted(by_block.items(), key=lambda kv: -len(kv[1])):
        bdef = blocks.get(name) or {}
        bprims = bdef.get("prims") or []
        try:
            sug = suggest(anchor_descriptor(bprims) if bprims else None, bdef.get("texts") or [], discipline, block=name,
                          whole=bitmap_signature(bprims) if bprims else None)
        except Exception:   # 추천 실패는 집계에 영향 없음
            sug = []
        note = bool(NOTE_BLOCK.match(name)) or any(len(t) > 10 for t in (bdef.get("texts") or []))
        objects.append({"key": f"blk:{name}", "kind": "block", "block": name, "label": name,
                        "shape": "주기·표시 블록 (수량 아님?)" if note else "CAD 블록", "note": note, "color": None,
                        "count": len(items), "items": items, "suggest": sug,
                        "sample": bprims[:400], "size": None})

    # 2) 블록이 아닌 도형: 닫힌 외곽 도형(원·사각형·다각형, ㄱ자 조각으로 그린 사각형 포함)을 기호의 '앵커'로 잡는다.
    #    기호에 붙은 배선·지시선은 비교에서 빠지므로 선이 연결된 기호도 따로 셀 수 있다.
    loose = [pr for pr in prims if not pr.get("blk")]
    sub = {"prims": loose}
    closed, grid, cell = _sheet_index(sub)
    texts_bb = [t["bbox"] for t in geo.get("texts", []) if t.get("bbox") and _intersects(t["bbox"], region)]
    cands = []
    for i, k, b, sz, asp, col, dashed in closed:
        if not (min_size <= sz <= max_size) or not _center_in(b, region):
            continue
        if any(_center_in(b, rx) for rx in excl):
            continue
        if i >= 0 and loose[i].get("h") in blk_handles:
            continue
        bw = b["x1"] - b["x0"]
        if any(_overlap_ratio(b, tb) > 0.8 and (tb["x1"] - tb["x0"]) >= 2.2 * bw and (tb["y1"] - tb["y0"]) <= 1.6 * (b["y1"] - b["y0"])
               for tb in texts_bb):
            continue   # 여러 글자 단어 속 닫힌 획(윤곽선 문자 'O','D' 등) — 기호 하나를 'O' 로 읽은 OCR 은 제외하지 않음
        cands.append({"i": i, "kind": k, "bbox": b, "size": sz, "aspect": asp, "color": col, "dashed": dashed})
    # 같은 자리의 이중 테두리·기호 안쪽 도형은 바깥 도형 하나로
    cands.sort(key=lambda c: -c["size"])
    kept: list[dict] = []
    for c in cands:
        b = c["bbox"]
        m = 0.05 * c["size"]
        if any(k["size"] <= 2.5 * c["size"] and b["x0"] >= k["bbox"]["x0"] - m and b["x1"] <= k["bbox"]["x1"] + m
               and b["y0"] >= k["bbox"]["y0"] - m and b["y1"] <= k["bbox"]["y1"] + m for k in kept):
            continue
        kept.append(c)
    for c in kept:
        near = set()
        b = c["bbox"]
        for gx in range(int(b["x0"] // cell), int(b["x1"] // cell) + 1):
            for gy in range(int(b["y0"] // cell), int(b["y1"] // cell) + 1):
                near.update(grid.get((gx, gy), ()))
        inner = _interior(((j, loose[j]) for j in near), c["i"], b, c["color"])
        c["inner"] = inner
        c["desc"] = _interior_desc(inner, b)
    groups: list[dict] = []
    for c in kept:
        d = c["desc"]
        best, bs = None, 0.0
        for g in groups:
            r = g
            if r["kind"] != c["kind"] or r["color"] != c["color"] or bool(r["dashed"]) != bool(c["dashed"]):
                continue
            if not (0.8 <= c["size"] / r["size"] <= 1.25) or abs(c["aspect"] - r["aspect"]) > (0.2 if c["kind"] == "circle" else 0.12):
                continue
            gd = r["desc"]
            if gd["empty"] or d["empty"]:
                sim = 1.0 if gd["empty"] and d["empty"] else 0.0
            else:
                sim = bitmap_similarity({"bm": gd["bm"], "n": gd["n"]}, {"bm": d["bm"], "n": d["n"]}, dil=1)
                if gd["fill"] != d["fill"]:
                    sim *= 0.5
            if sim > bs:
                best, bs = g, sim
        item = {"bbox": b if False else c["bbox"], "h": loose[c["i"]].get("h") if c["i"] >= 0 else None}
        if best is not None and bs >= 0.7:
            best["items"].append(item)
        else:
            outline = loose[c["i"]] if c["i"] >= 0 else {"t": "l", "p": [(c["bbox"]["x0"], c["bbox"]["y0"]), (c["bbox"]["x1"], c["bbox"]["y0"]),
                                                                          (c["bbox"]["x1"], c["bbox"]["y1"]), (c["bbox"]["x0"], c["bbox"]["y1"]), (c["bbox"]["x0"], c["bbox"]["y0"])]}
            groups.append({**c, "items": [item], "sample": [{"t": outline.get("t", "l"), "p": outline["p"]}] + [{"t": q["t"], "p": q["p"]} for q in c["inner"][:300]]})
    groups.sort(key=lambda g: -len(g["items"]))
    KIND = {"circle": "원형", "rect": "사각형", "poly": "다각형"}
    for gi, g in enumerate(groups):
        lab = GROUP_LABELS[gi] if gi < len(GROUP_LABELS) else f"{gi + 1}"
        desc = KIND.get(g["kind"], "") + (" 파선" if g["dashed"] else "") + (" (빈 도형)" if g["desc"]["empty"] else "")
        # 라이브러리 추천: 대표 객체의 외곽·내부 + 객체 안 문자(도면 문자/OCR)
        letters = []
        for it in g["items"][:8]:
            bb = it["bbox"]
            letters += [t["text"] for t in geo.get("texts", []) if t.get("bbox") and _center_in(t["bbox"], bb)]
        # 대표 객체 주변(외곽 1.35배 안에 완전히 들어오는 도형)의 전체 모양
        bb0 = g["items"][0]["bbox"]
        cx, cy = (bb0["x0"] + bb0["x1"]) / 2, (bb0["y0"] + bb0["y1"]) / 2
        hw, hh = (bb0["x1"] - bb0["x0"]) * 0.68 + 1e-9, (bb0["y1"] - bb0["y0"]) * 0.68 + 1e-9
        hw = hh = max(hw, hh)
        box = {"x0": cx - hw * 1.0, "x1": cx + hw * 1.0, "y0": cy - hh * 1.0, "y1": cy + hh * 1.0}
        near = set()
        for gx in range(int(box["x0"] // cell), int(box["x1"] // cell) + 1):
            for gy in range(int(box["y0"] // cell), int(box["y1"] // cell) + 1):
                near.update(grid.get((gx, gy), ()))
        local = [loose[j] for j in near if _inside(prim_bbox(loose[j]), box)]
        whole = bitmap_signature(local) if local else None
        try:
            sug = suggest({"kind": g["kind"], "aspect": g["aspect"], "dashed": g["dashed"], "interior": g["desc"]}, letters, discipline,
                          whole=whole)
        except Exception:
            sug = []
        objects.append({"key": f"shape:{gi}", "kind": "shape", "block": None, "label": f"객체 {lab}", "shape": desc, "color": g["color"],
                        "count": len(g["items"]), "items": g["items"], "sample": g["sample"], "size": round(g["size"], 3),
                        "letters": sorted(set(letters))[:6], "suggest": sug})
    in_cluster = {c["i"] for c in kept if c["i"] >= 0}
    for c in kept:
        in_cluster.update(id(q) for q in c["inner"])

    # 3) 선: 객체에 속하지 않은 선형 프리미티브를 스타일(레이어)별로 길이 합산 (영역 안쪽만)
    by_layer: dict[str, dict] = {}
    for i, pr in enumerate(loose):
        if not _intersects(prim_bbox(pr), region):
            continue
        if i in in_cluster or id(pr) in in_cluster or pr.get("t") in ("f", "h"):
            continue
        if pr.get("layer") == "RASTER-LINE":
            continue
        L, pieces = _prim_len(pr, region)
        if L <= 0:
            continue
        d = by_layer.setdefault(pr.get("layer") or "0", {"length": 0.0, "pieces": [], "n": 0})
        d["length"] += L
        d["n"] += 1
        if len(d["pieces"]) < 3000:
            d["pieces"].extend(pieces)
    min_line = max(rw, rh) * 0.05
    lines = []
    for k, d in sorted(by_layer.items(), key=lambda kv: -kv[1]["length"]):
        if d["length"] < min_line:
            continue
        lines.append({"key": k, "length": round(d["length"], 3), "count": d["n"],
                      "length_m": round(d["length"] * scale_factor, 2) if scale_factor else None,
                      "pieces": [[(round(x, 3), round(y, 3)) for x, y in pc] for pc in d["pieces"]]})
    if not scale_factor:
        notes.append("축척이 확정되지 않아 선 길이는 도면단위로만 표시합니다. 케이블 길이는 직접 입력하십시오.")
    notes.append("객체는 닫힌 외곽선(원·사각형·다각형)을 기준으로 셉니다. 외곽선이 없는 기호(화살표 등)는 '기호 수동 추가'로 더하십시오.")
    if len(groups) > 30:
        notes.append("모양 그룹이 많습니다. 영역을 기호가 있는 부분으로 좁혀 다시 드래그하면 정확해집니다.")
    return {"mode": "vector", "objects": objects, "lines": lines[:40], "notes": notes}
