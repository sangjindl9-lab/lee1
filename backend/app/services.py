"""엔진 ↔ DB 연결 서비스: 범례 인식 저장, 기호 검출 저장(사용자 수정 보존), 선로 생성, 물량 집계, 교차검증."""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from sqlalchemy.orm import Session

from .config import settings
from .engine import legend as legend_engine
from .engine.detect import detect_in_sheet
from .engine.geometry import in_region, polyline_length
from .engine.routes import build_routes, match_segments_for_symbol
from .models import (Circuit, DetectedSymbol, DetectStatus, DrawingFile, DrawingSheet, LegendSymbol, LegendTable,
                     Project, QuantityEvidence, QuantityItem, QuantityStatus, ReviewIssue, Route, RouteKind,
                     RouteSegment, SymbolMapping, SymbolStatus)


def load_geometry(sheet: DrawingSheet) -> dict:
    with open(sheet.geometry_path, encoding="utf-8") as fp:
        geo = json.load(fp)
    geo["_raster"] = sheet.source_kind in ("pdf_raster", "pdf_mixed", "image")
    geo["bbox"] = sheet.bbox
    return geo


def project_sheets(db: Session, pid: int) -> list[DrawingSheet]:
    out = []
    for f in db.query(DrawingFile).filter_by(project_id=pid).all():
        for rev in f.revisions:
            if rev.is_current:
                out.extend(rev.sheets)
    return [s for s in out if s.geometry_path and Path(s.geometry_path).exists()]


def crop_symbol_image(sheet: DrawingSheet, region: dict, out_path: Path) -> str | None:
    """래스터 시트에서 기호 이미지 크롭 (템플릿 매칭·화면 표시용)."""
    if not sheet.raster_path or not Path(sheet.raster_path).exists():
        return None
    try:
        import cv2
        img = cv2.imread(sheet.raster_path)
        meta = (sheet.stats or {}).get("render") or {}
        dpi = meta.get("dpi", 150)
        k = dpi / 72.0
        H = img.shape[0]
        x0, x1 = int(region["x0"] * k), int(region["x1"] * k)
        y0, y1 = int(H - region["y1"] * k), int(H - region["y0"] * k)
        crop = img[max(0, y0):max(0, y1), max(0, x0):max(0, x1)]
        if crop.size == 0:
            return None
        out_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_path), crop)
        return str(out_path)
    except Exception:
        return None


# ---------------- 범례 ----------------
def _save_legend(db: Session, pid: int, sheet: DrawingSheet | None, res: legend_engine.LegendResult, source: str) -> LegendTable:
    tbl = LegendTable(project_id=pid, sheet_id=sheet.id if sheet else None, title=res.title, region=res.region,
                      source=source, confidence=res.confidence)
    db.add(tbl)
    db.flush()
    for r in res.rows:
        img = None
        if sheet and sheet.source_kind in ("pdf_raster", "pdf_mixed", "image") and r.region:
            cell = r.symbol_cell or _symbol_cell(r.region, res.region)
            img = crop_symbol_image(sheet, cell, settings.processed_dir / str(pid) / "legend" / f"{tbl.id}_{r.row_no}.png")
        db.add(LegendSymbol(table_id=tbl.id, project_id=pid, row_no=r.row_no, symbol_name=r.symbol_name, block_name=r.block_name,
                            fingerprint=r.fingerprint, image_path=img, item_name=r.item_name, spec=r.spec, unit=r.unit,
                            discipline=(r.discipline or (sheet.discipline if sheet else None)), category=r.category, layer_hint=r.layer_hint,
                            confidence=r.confidence, status=SymbolStatus(r.status), region=r.region,
                            extra={"texts": r.texts, "install_height": r.install_height, **(r.extra or {})}))
    return tbl


def _symbol_cell(row_region: dict, table_region: dict) -> dict:
    """기호 열 = 행 밴드의 좌측 18% (헤더 없을 때 기본)."""
    w = table_region["x1"] - table_region["x0"]
    return {"x0": table_region["x0"], "x1": table_region["x0"] + 0.18 * w, "y0": row_region["y0"], "y1": row_region["y1"]}


def _ocr_cell_fn(s: DrawingSheet):
    if not s.raster_path or not Path(s.raster_path).exists() or not s.bbox:
        return None
    # 실제 텍스트 레이어가 있는 벡터 PDF 는 셀 OCR 불필요 (오히려 정확한 문자를 덮어쓴다)
    if s.source_kind == "pdf_vector" and not (s.stats or {}).get("outline_text"):
        return None
    from .engine.pdf_parser import ocr_cell
    dpi = ((s.stats or {}).get("render") or {}).get("dpi", 150)
    H = s.bbox["y1"] - s.bbox["y0"]
    return lambda region: ocr_cell(s.raster_path, dpi, H, region)


def auto_detect_legends(db: Session, pid: int, progress=None) -> list[LegendTable]:
    """모든 시트에서 범례표 자동 탐색. 이미 같은 시트·영역에 승인된 범례가 있으면 건너뜀."""
    created = []
    sheets_ = project_sheets(db, pid)
    for si, s in enumerate(sheets_):
        if progress:
            progress(100 * si / max(len(sheets_), 1), f"범례표 탐색 {si + 1}/{len(sheets_)} ({s.drawing_no or s.sheet_name})")
        if "목록" in (s.drawing_title or "").replace(" ", ""):
            continue   # 도면목록표는 범례 탐색 대상 아님
        geo = load_geometry(s)
        existing = db.query(LegendTable).filter_by(project_id=pid, sheet_id=s.id).all()
        for res in legend_engine.auto_detect_legends(geo, _ocr_cell_fn(s)):
            if any(_overlap(e.region, res.region) > 0.5 for e in existing if e.region):
                continue
            created.append(_save_legend(db, pid, s, res, "auto"))
        # 엑셀 범례 보강: 시트 없는 xlsx 파일
    for f in db.query(DrawingFile).filter_by(project_id=pid, kind="xlsx").all():
        if db.query(LegendTable).filter_by(project_id=pid, title=f"[XLSX] {f.original_name}").first():
            continue
        rows = legend_engine.legend_from_xlsx(f.stored_path)
        if rows:
            res = legend_engine.LegendResult(title=f"[XLSX] {f.original_name}", region=None, rows=rows, confidence=0.9, header_found=True)
            created.append(_save_legend(db, pid, None, res, "xlsx"))
    db.commit()
    return created


def legend_from_region(db: Session, pid: int, sheet: DrawingSheet, region: dict, title: str | None) -> LegendTable:
    geo = load_geometry(sheet)
    res = legend_engine.legend_from_region(geo, region, title or "사용자 지정 범례", _ocr_cell_fn(sheet))
    tbl = _save_legend(db, pid, sheet, res, "manual")
    db.commit()
    return tbl


def _overlap(a: dict | None, b: dict | None) -> float:
    if not a or not b:
        return 0.0
    ix = max(0.0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    iy = max(0.0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    inter = ix * iy
    area = min((a["x1"] - a["x0"]) * (a["y1"] - a["y0"]), (b["x1"] - b["x0"]) * (b["y1"] - b["y0"])) or 1e-9
    return inter / area


def apply_library(db: Session, pid: int, company_id: int) -> int:
    """회사 라이브러리로 미확인 범례 행 보강 (프로젝트 범례 우선 — 이미 품명 있으면 건드리지 않음)."""
    n = 0
    libs = db.query(SymbolMapping).filter_by(company_id=company_id).all()
    for ls in db.query(LegendSymbol).filter_by(project_id=pid).all():
        if ls.item_name or ls.status == SymbolStatus.approved:
            continue
        for m in libs:
            if (ls.block_name and m.block_name and ls.block_name.upper() == m.block_name.upper()) or \
               (ls.fingerprint and m.fingerprint and ls.fingerprint.get("hash") == m.fingerprint.get("hash")):
                ls.item_name, ls.spec, ls.unit = m.item_name, m.spec, m.unit
                ls.discipline = ls.discipline or m.discipline
                ls.category = m.category
                ls.confidence = max(ls.confidence, 0.7)
                ls.status = SymbolStatus.auto
                ls.extra = {**(ls.extra or {}), "from_library": m.id}
                n += 1
                break
    db.commit()
    return n


def legend_exclude_regions(db: Session, pid: int, sheet_id: int) -> list[dict]:
    regs = [t.region for t in db.query(LegendTable).filter_by(project_id=pid, sheet_id=sheet_id).all() if t.region]
    return regs


# ---------------- 기호 검출 ----------------
def run_detection(db: Session, pid: int, sheet_ids: list[int] | None = None, progress=None) -> dict:
    """프로젝트 전체(또는 지정 시트) 기호 검출. 사용자 잠금(user_locked) 행은 보존."""
    symbols = [ls for ls in db.query(LegendSymbol).filter_by(project_id=pid).all()
               if ls.category == "device" and ls.status != SymbolStatus.unresolved]
    sym_dicts = [{"id": s.id, "block_name": s.block_name, "fingerprint": s.fingerprint, "symbol_name": s.symbol_name,
                  "category": s.category, "image_path": s.image_path, "item_name": s.item_name} for s in symbols]
    summary = {"sheets": 0, "detected": 0, "preserved": 0}
    _clear_evidence(db, pid)
    sheets_ = project_sheets(db, pid)
    for si, s in enumerate(sheets_):
        if sheet_ids and s.id not in sheet_ids:
            continue
        if progress:
            progress(100 * si / max(len(sheets_), 1), f"기호 검출 {si + 1}/{len(sheets_)} ({s.drawing_no or s.sheet_name})")
        geo = load_geometry(s)
        excl = legend_exclude_regions(db, pid, s.id)
        # 도면종류=범례 시트의 검출은 설치 수량·교차검증에서 제외된다 (recompute/cross_validate 참고)
        meta = None
        if s.raster_path and s.source_kind in ("pdf_raster", "pdf_mixed", "image"):
            r = (s.stats or {}).get("render") or {}
            meta = {"w": r.get("w"), "h": r.get("h"), "dpi": r.get("dpi", 150)}
        dets = detect_in_sheet(geo, sym_dicts, excl, s.raster_path if meta else None, meta)

        locked = db.query(DetectedSymbol).filter_by(project_id=pid, sheet_id=s.id, user_locked=True).all()
        for old in db.query(DetectedSymbol).filter_by(project_id=pid, sheet_id=s.id, user_locked=False).all():
            db.delete(old)
        db.flush()
        summary["preserved"] += len(locked)
        seq = defaultdict(int)
        for L in locked:
            seq[L.legend_symbol_id] += 1
        for d in dets:
            # 사용자가 제외/수정한 위치 근처의 재검출은 생성하지 않음
            size = max(d.bbox["x1"] - d.bbox["x0"], d.bbox["y1"] - d.bbox["y0"], 1e-6) if d.bbox else 1.0
            if any(math.dist((L.x, L.y), (d.x, d.y)) <= size * 0.5 for L in locked):
                continue
            seq[d.legend_symbol_id] += 1
            st = DetectStatus(d.status)
            note = None
            if not s.drawing_type:
                st, note = DetectStatus.review, "도면 종류 미확정 시트 — 평면도이면 시트 종류를 지정하십시오"
            db.add(DetectedSymbol(project_id=pid, sheet_id=s.id, legend_symbol_id=d.legend_symbol_id, entity_handle=d.handle,
                                  method=d.method, x=d.x, y=d.y, bbox=d.bbox, confidence=d.confidence, seq_no=seq[d.legend_symbol_id],
                                  status=st, install_type=d.install_type, floor_zone=s.floor_zone, note=note))
            summary["detected"] += 1
        summary["sheets"] += 1
    db.commit()
    return summary


# ---------------- 선로 ----------------
def run_routes(db: Session, pid: int, sheet_ids: list[int] | None = None) -> dict:
    line_syms = [ls for ls in db.query(LegendSymbol).filter_by(project_id=pid).all() if ls.category in ("conduit", "tray", "cable")]
    summary = {"routes": 0, "segments": 0, "duplicates": 0, "unscaled_sheets": []}
    _clear_evidence(db, pid)
    for s in project_sheets(db, pid):
        if sheet_ids and s.id not in sheet_ids:
            continue
        geo = load_geometry(s)
        excl = legend_exclude_regions(db, pid, s.id)
        scale = s.scale_factor if s.scale_confirmed else None
        if not scale:
            _issue(db, pid, s.id, "SCALE_UNCONFIRMED", "warn",
                   f"시트 '{s.drawing_no or s.sheet_name}' 의 축척/단위가 확정되지 않아 길이를 산출할 수 없습니다. 축척 또는 기준거리를 입력하십시오.")
            summary["unscaled_sheets"].append(s.id)
        bb = s.bbox or {"x0": 0, "y0": 0, "x1": 1, "y1": 1}
        tol = max((bb["x1"] - bb["x0"]), (bb["y1"] - bb["y0"])) * 1e-5 or 1e-6
        # 기존 자동 경로 제거(잠금 제외). 확정된 회선 지정은 (시트, 범례, 경로명) 키로 보존 후 재연결
        carry: dict[tuple, list[tuple]] = defaultdict(list)
        for r in db.query(Route).filter_by(project_id=pid, sheet_id=s.id).all():
            segs = db.query(RouteSegment).filter_by(route_id=r.id).all()
            if any(sg.user_locked for sg in segs) or r.status in (DetectStatus.verified, DetectStatus.edited):
                continue
            for sg in segs:
                db.delete(sg)
            for c in db.query(Circuit).filter_by(route_id=r.id).all():
                if c.confirmed:
                    carry[(s.id, r.legend_symbol_id, r.name)].append((c.cable_symbol_id, c.circuit_count, c.note))
                db.delete(c)
            db.flush()   # 세그먼트·회선 먼저 삭제 (FK)
            db.delete(r)
        db.flush()
        if s.source_kind != "dxf":
            # PDF: 선종(실선/파선/일점쇄선) + 기호 접속 기반 선로 (레이어가 없는 도면)
            n_r, n_s = _pdf_routes(db, pid, s, geo, excl, scale, line_syms, carry)
            summary["routes"] += n_r
            summary["segments"] += n_s
            line_syms_this = []
        else:
            line_syms_this = line_syms
        for ls in line_syms_this:
            geo["bbox"] = s.bbox
            segs = match_segments_for_symbol(geo, {"id": ls.id, "layer_hint": ls.layer_hint, "symbol_name": ls.symbol_name,
                                                   "spec": ls.spec, "item_name": ls.item_name}, excl)
            if not segs:
                continue
            kind = RouteKind(ls.category)
            dash = (ls.fingerprint or {}).get("dash")
            seg_tol = tol
            if dash and s.source_kind != "dxf":
                seg_tol = max(tol, float(dash.get("gap") or 0) * 1.6 + 0.5)   # 파선 간격을 건너 연결
            for ri, ro in enumerate(build_routes(segs, scale, seg_tol, dash if s.source_kind != "dxf" else None, dup_tol=tol), start=1):
                route = Route(project_id=pid, sheet_id=s.id, legend_symbol_id=ls.id, kind=kind,
                              name=f"{ls.symbol_name or ls.item_name}-{s.drawing_no or s.page_no}-{ri}",
                              horizontal_m=ro.length_m, segment_count=len(ro.segments),
                              status=DetectStatus.review if (scale is None or ro.duplicates) else DetectStatus.auto)
                db.add(route)
                db.flush()
                for cable_id, n, note in carry.pop((s.id, ls.id, route.name), []):
                    db.add(Circuit(project_id=pid, route_id=route.id, cable_symbol_id=cable_id, circuit_count=n, confirmed=True, note=note))
                ids = []
                for sg in ro.segments:
                    seg = RouteSegment(project_id=pid, sheet_id=s.id, legend_symbol_id=ls.id, route_id=route.id,
                                       entity_handle=sg["handle"], layer=sg["layer"], points=sg["points"],
                                       length_du=sg["length_du"], length_m=sg["length_m"],
                                       status=DetectStatus.review if sg["dup_of"] is not None else DetectStatus.auto)
                    db.add(seg)
                    db.flush()
                    ids.append(seg.id)
                    if sg["dup_of"] is not None:
                        seg.is_duplicate_of = ids[sg["dup_of"]] if sg["dup_of"] < len(ids) else None
                summary["segments"] += len(ro.segments)
                if ro.duplicates:
                    summary["duplicates"] += len(ro.duplicates)
                    _issue(db, pid, s.id, "DUPLICATE_SEGMENT", "warn",
                           f"'{ls.item_name}' 선로에서 겹치는 선분 {len(ro.duplicates)}쌍이 검출되었습니다. 중복이면 제외, 별도 선로이면 포함 처리하십시오.",
                           {"route_id": route.id})
                summary["routes"] += 1
        for (sid, lid, name), lst in carry.items():
            _issue(db, pid, sid, "CIRCUIT_ORPHAN", "warn",
                   f"재분석 후 경로 '{name}' 이(가) 사라져 확정된 회선 지정 {len(lst)}건을 다시 지정해야 합니다.")
    db.commit()
    return summary


def _pdf_routes(db: Session, pid: int, s: DrawingSheet, geo: dict, excl: list[dict], scale, line_syms, carry) -> tuple[int, int]:
    from .engine.linetype import classify_pattern, pdf_route_groups
    if not line_syms or not s.drawing_type or s.drawing_type in NON_INSTALL_TYPES:
        return 0, 0   # 선로 길이는 평면도 계열에서만
    bb = s.bbox or {"x0": 0, "y0": 0, "x1": 1, "y1": 1}
    page_dim = max(bb["x1"] - bb["x0"], bb["y1"] - bb["y0"])
    syms = [{"bbox": d.bbox or {"x0": d.x - 2, "y0": d.y - 2, "x1": d.x + 2, "y1": d.y + 2}}
            for d in db.query(DetectedSymbol).filter_by(project_id=pid, sheet_id=s.id).all() if d.status != DetectStatus.excluded]
    groups = pdf_route_groups(geo["prims"], excl, page_dim, syms)
    # 조각이 적은 그룹은 같은 스타일 전체의 선종을 따른다 (모서리 사선 조각 등)
    # 스타일 대표 선종: 그 스타일의 긴 그룹들(조각 5개 이상) 길이의 80% 이상이 한 선종일 때만 짧은 그룹에 적용
    style_len = defaultdict(lambda: defaultdict(float))
    for g in groups:
        if len(g["pieces"]) >= 5:
            style_len[g["style"]][g["pattern"]] += g["length"]
    style_pat = {}
    for st, d in style_len.items():
        tot = sum(d.values())
        pat, L = max(d.items(), key=lambda kv: kv[1])
        if tot > 0 and L / tot >= 0.8:
            style_pat[st] = pat
    sizes = sorted(max(sb["bbox"]["x1"] - sb["bbox"]["x0"], sb["bbox"]["y1"] - sb["bbox"]["y0"]) for sb in syms) or [5.0]
    min_len = max(3.0, 1.5 * sizes[len(sizes) // 2])   # 기호 크기보다 짧은 선 조각은 선로로 보지 않는다
    n_r = n_s = 0

    def long_dash(pieces_lens):
        L = sorted(pieces_lens)
        top = L[len(L) // 2:] or L
        return top[len(top) // 2] if top else 0.0

    # 그룹 → 범례 배정: 선종이 같은 범례 중 범주(배관/케이블/트레이)별로 대시 길이가 가장 가까운 1개
    assign: dict[int, list] = defaultdict(list)
    for g in groups:
        gp = g["pattern"] if len(g["pieces"]) >= 5 else style_pat.get(g["style"], g["pattern"])
        if g["length"] < min_len or g["touches"] < 1:
            continue   # 짧은 조각, 어떤 기호에도 닿지 않는 선(표 칸·치수선·견본 선) 은 선로가 아님
        gd = long_dash([math.dist(p["p"][0], p["p"][-1]) for p in g["pieces"]])
        by_cat = defaultdict(list)
        for ls in line_syms:
            dash = (ls.fingerprint or {}).get("dash") or {}
            if dash.get("pattern") == gp:
                by_cat[ls.category].append((ls, long_dash(dash.get("pieces") or [dash.get("seg") or 0])))
        for cat, cands in by_cat.items():
            if gp == "solid" or len(cands) == 1 or gd <= 0:
                best = cands[0][0]
            else:
                best = min(cands, key=lambda c: abs(math.log(max(gd, 1e-3) / max(c[1], 1e-3))))[0]
            assign[best.id].append(g)
    for ls in line_syms:
        mine = assign.get(ls.id, [])
        for ri, g in enumerate(sorted(mine, key=lambda g: -g["length"]), start=1):
            lm = g["length"] * scale if scale else None
            route = Route(project_id=pid, sheet_id=s.id, legend_symbol_id=ls.id, kind=RouteKind(ls.category),
                          name=f"{(ls.item_name or '')[:12]}-{s.drawing_no or s.page_no}-{ri}", horizontal_m=lm,
                          segment_count=len(g["pieces"]), status=DetectStatus.review if scale is None else DetectStatus.auto)
            db.add(route)
            db.flush()
            for cable_id, n, note in carry.pop((s.id, ls.id, route.name), []):
                db.add(Circuit(project_id=pid, route_id=route.id, cable_symbol_id=cable_id, circuit_count=n, confirmed=True, note=note))
            for p in g["pieces"]:
                L = math.dist(p["p"][0], p["p"][-1]) if len(p["p"]) == 2 else polyline_length(p["p"])
                db.add(RouteSegment(project_id=pid, sheet_id=s.id, legend_symbol_id=ls.id, route_id=route.id,
                                    entity_handle=p.get("h"), layer=g["style"], points=p["p"], length_du=L,
                                    length_m=(L * scale) if scale else None))
            n_r += 1
            n_s += len(g["pieces"])
    db.flush()
    return n_r, n_s


NON_INSTALL_TYPES = {"계통도", "일람표", "범례", "상세도", "기타"}


def _clear_evidence(db: Session, pid: int):
    """검출/선로 재생성 전 근거 연결 제거 (집계는 recompute 에서 다시 만든다)."""
    ids = [q.id for q in db.query(QuantityItem.id).filter_by(project_id=pid).all()]
    if ids:
        db.query(QuantityEvidence).filter(QuantityEvidence.item_id.in_(ids)).delete(synchronize_session=False)
        db.flush()


def _issue(db: Session, pid: int, sheet_id: int | None, code: str, sev: str, msg: str, data: dict | None = None):
    ex = db.query(ReviewIssue).filter_by(project_id=pid, sheet_id=sheet_id, code=code, message=msg, resolved=False).first()
    if not ex:
        db.add(ReviewIssue(project_id=pid, sheet_id=sheet_id, code=code, severity=sev, message=msg, data=data or {}))


# ---------------- 물량 집계 ----------------
def recompute_quantities(db: Session, pid: int) -> list[QuantityItem]:
    """검출·선로·회선 → 물량산출조서 재작성. 사용자가 edited 로 고정한 행의 총량은 보존."""
    proj = db.get(Project, pid)
    st = proj.takeoff_settings or {}
    sheets = {s.id: s for s in project_sheets(db, pid)}
    old = {(q.legend_symbol_id, q.install_type, q.floor_zone): q for q in db.query(QuantityItem).filter_by(project_id=pid).all()}
    edited = {k: v for k, v in old.items() if v.status == QuantityStatus.edited}
    for q in old.values():
        db.delete(q)
    db.flush()
    items: list[QuantityItem] = []
    syms = {s.id: s for s in db.query(LegendSymbol).filter_by(project_id=pid).all()}

    # 1) 기구 수량 — 계통도·일람표·범례 시트의 기호는 설치 수량이 아니라 교차검증용이므로 제외
    non_install = NON_INSTALL_TYPES
    untyped: dict[tuple, int] = defaultdict(int)
    groups: dict[tuple, list[DetectedSymbol]] = defaultdict(list)
    for d in db.query(DetectedSymbol).filter_by(project_id=pid).all():
        if d.status == DetectStatus.excluded or d.legend_symbol_id not in syms:
            continue
        sh = sheets.get(d.sheet_id)
        if sh is not None and (sh.drawing_type or "") in non_install:
            continue
        if sh is not None and not sh.drawing_type and d.status not in (DetectStatus.verified, DetectStatus.edited, DetectStatus.manual):
            untyped[(sh.drawing_no or sh.sheet_name, d.legend_symbol_id)] += 1
            continue   # 종류 미상 시트의 자동 검출은 합계에서 빼고 검토 목록으로
        groups[(d.legend_symbol_id, d.install_type, d.floor_zone)].append(d)
    for (lid, itype, fz), ds in groups.items():
        ls = syms[lid]
        by_sheet = defaultdict(int)
        for d in ds:
            by_sheet[sheets[d.sheet_id].drawing_no or sheets[d.sheet_id].sheet_name if d.sheet_id in sheets else "?"] += 1
        formula = " + ".join(f"{k}: {v}{ls.unit or '개'}" for k, v in by_sheet.items())
        all_verified = all(d.status in (DetectStatus.verified, DetectStatus.edited, DetectStatus.manual) for d in ds)
        any_review = any(d.status == DetectStatus.review for d in ds)
        status = QuantityStatus.verified if all_verified else (QuantityStatus.review if any_review else QuantityStatus.auto)
        if ls.status == SymbolStatus.unresolved or not ls.item_name:
            status = QuantityStatus.insufficient
        q = QuantityItem(project_id=pid, discipline=ls.discipline, sub_discipline=_sub_disc(ls), item_name=ls.item_name or f"(미확인 기호 {ls.symbol_name or ls.block_name})",
                         spec=ls.spec, unit=ls.unit or "개", formula=formula, qty_drawing=float(len(ds)), qty_total=float(len(ds)),
                         drawing_nos=sorted(by_sheet.keys()), floor_zone=fz, legend_symbol_id=lid, install_type=itype, status=status)
        _apply_edit(q, edited.get((lid, itype, fz)))
        db.add(q)
        db.flush()
        for d in ds:
            db.add(QuantityEvidence(item_id=q.id, sheet_id=d.sheet_id, detected_symbol_id=d.id, value=1.0))
        items.append(q)

    for (sname, lid), n in untyped.items():
        ls = syms.get(lid)
        _issue(db, pid, None, "UNTYPED_SHEET", "warn",
               f"시트 '{sname}' 에서 '{ls.item_name if ls else lid}' {n}개가 검출되었으나 도면 종류가 미확정이라 수량에서 제외했습니다. "
               f"평면도이면 시트 종류를 '평면도'로 지정하거나 검출 기호를 승인하십시오.")
    # 2) 전선관·트레이 길이
    routes = db.query(Route).filter_by(project_id=pid).all()
    for kind in (RouteKind.conduit, RouteKind.tray):
        rg: dict[int, list[Route]] = defaultdict(list)
        for r in routes:
            if r.kind == kind and r.legend_symbol_id in syms:
                rg[r.legend_symbol_id].append(r)
        for lid, rs in rg.items():
            items.append(_length_item(db, pid, syms[lid], rs, sheets, st, edited))

    # 3) 케이블 = 경로길이 × 회선수 (회선 확정 필요)
    cg: dict[int, list[tuple[Route, Circuit]]] = defaultdict(list)
    for c in db.query(Circuit).filter_by(project_id=pid).all():
        r = db.get(Route, c.route_id)
        if r and c.cable_symbol_id in syms:
            cg[c.cable_symbol_id].append((r, c))
    for lid, rcs in cg.items():
        items.append(_cable_item(db, pid, syms[lid], rcs, sheets, st, edited))
    # 케이블 범례는 있으나 회선 미지정 → 미확정 행
    for lid, ls in syms.items():
        if ls.category == "cable" and lid not in cg:
            cable_routes = [r for r in routes if r.legend_symbol_id == lid]
            if cable_routes:
                items.append(_length_item(db, pid, ls, cable_routes, sheets, st, edited, note="케이블 자체 선형(회선수 1 가정 아님: 경로별 회선 수 확정 필요)", force_status=QuantityStatus.review))
            else:
                q = QuantityItem(project_id=pid, discipline=ls.discipline, sub_discipline=_sub_disc(ls), item_name=ls.item_name or "?",
                                 spec=ls.spec, unit=ls.unit or "m", formula="경로·회선 미지정", qty_total=None,
                                 legend_symbol_id=lid, status=QuantityStatus.insufficient, note="전선관/트레이 경로에 회선 수를 지정하면 산출됩니다.")
                db.add(q)
                items.append(q)
    items.extend(_tally_items(db, pid))
    db.commit()
    return items


def _tally_items(db: Session, pid: int) -> list[QuantityItem]:
    """수동 영역 집계 → 물량 행. 같은 품명·규격·단위끼리 합산하고 영역별 내역을 산출식에 남긴다."""
    from .models import RegionTally
    groups: dict[tuple, list] = defaultdict(list)
    for t in db.query(RegionTally).filter_by(project_id=pid).order_by(RegionTally.id).all():
        groups[(t.discipline, t.item_name.strip(), (t.spec or "").strip(), t.unit, t.kind)].append(t)
    out = []
    for (disc, name, spec, unit, kind), ts in groups.items():
        total = sum(t.qty or 0 for t in ts)
        formula = " + ".join(f"{t.drawing_no or '도면'} 영역#{t.id}: {fmt_num(t.qty)}{unit}" for t in ts)
        q = QuantityItem(project_id=pid, discipline=disc, item_name=name, spec=spec or None, unit=unit,
                         formula=f"수동 영역 집계 — {formula}", qty_drawing=total, qty_total=total,
                         drawing_nos=sorted({t.drawing_no for t in ts if t.drawing_no}), status=QuantityStatus.verified,
                         note="사용자 드래그 집계" + (" (케이블 길이 직접 입력)" if kind == "cable" else ""))
        db.add(q)
        out.append(q)
    return out


def fmt_num(v) -> str:
    v = float(v or 0)
    return str(int(v)) if v == int(v) else f"{v:.2f}"


def _sub_disc(ls: LegendSymbol) -> str | None:
    s = f"{ls.item_name or ''} {ls.spec or ''}".upper()
    for k, words in {"CCTV": ["CCTV", "카메라", "CAMERA", "NVR"], "광통신": ["광", "FIBER", "ODF"], "방송": ["방송", "스피커", "앰프", "SPEAKER", "PA"],
                     "접지·피뢰": ["접지", "피뢰", "GND", "EARTH"], "조명": ["조명", "LED", "등기구", "LIGHT"], "소방전기": ["감지기", "소방", "FIRE"]}.items():
        if any(w in s for w in words):
            return k
    return None


def _apply_edit(q: QuantityItem, prev: QuantityItem | None):
    if prev:
        q.qty_total, q.qty_vertical, q.qty_slack, q.qty_markup, q.note, q.status = prev.qty_total, prev.qty_vertical, prev.qty_slack, prev.qty_markup, prev.note, QuantityStatus.edited


def _markup(st: dict, ls: LegendSymbol, base: float | None) -> float | None:
    if base is None:
        return None
    pct = (st.get("markup_pct") or {}).get(ls.category)
    return round(base * pct / 100.0, 3) if pct is not None else None


def _length_item(db, pid, ls, rs, sheets, st, edited, note=None, force_status=None) -> QuantityItem:
    unscaled = [r for r in rs if r.horizontal_m is None]
    horiz = sum(r.horizontal_m or 0 for r in rs) if not unscaled else None
    vert = sum(r.vertical_m for r in rs if r.vertical_m is not None) if any(r.vertical_m is not None for r in rs) else None
    slack = sum(r.slack_m for r in rs if r.slack_m is not None) if any(r.slack_m is not None for r in rs) else None
    markup = _markup(st, ls, (horiz or 0) + (vert or 0) + (slack or 0)) if horiz is not None else None
    total = round((horiz or 0) + (vert or 0) + (slack or 0) + (markup or 0), 3) if horiz is not None else None
    parts = [f"{sheets[r.sheet_id].drawing_no or sheets[r.sheet_id].sheet_name}: {r.horizontal_m:.2f}m" if r.horizontal_m is not None else f"{sheets[r.sheet_id].drawing_no or '?'}: 축척미확정" for r in rs if r.sheet_id in sheets]
    formula = " + ".join(parts)
    if vert is not None:
        formula += f" + 수직 {vert:.2f}m"
    if slack is not None:
        formula += f" + 여장 {slack:.2f}m"
    if markup is not None:
        formula += f" + 할증 {markup:.2f}m"
    status = QuantityStatus.insufficient if unscaled else (QuantityStatus.review if any(r.status == DetectStatus.review for r in rs) else QuantityStatus.auto)
    if force_status and status == QuantityStatus.auto:
        status = force_status
    q = QuantityItem(project_id=pid, discipline=ls.discipline, sub_discipline=_sub_disc(ls), item_name=ls.item_name or "?", spec=ls.spec, unit=ls.unit or "m",
                     formula=formula, qty_drawing=round(horiz, 3) if horiz is not None else None, qty_vertical=vert, qty_slack=slack, qty_markup=markup,
                     qty_total=total, drawing_nos=sorted({sheets[r.sheet_id].drawing_no or sheets[r.sheet_id].sheet_name for r in rs if r.sheet_id in sheets}),
                     legend_symbol_id=ls.id, status=status, note=note or ("축척 미확정 시트 포함" if unscaled else None))
    _apply_edit(q, edited.get((ls.id, "new", None)))
    db.add(q)
    db.flush()
    for r in rs:
        db.add(QuantityEvidence(item_id=q.id, sheet_id=r.sheet_id, route_id=r.id, value=r.horizontal_m or 0))
    return q


def _cable_item(db, pid, ls, rcs, sheets, st, edited) -> QuantityItem:
    unscaled = [r for r, c in rcs if r.horizontal_m is None]
    unconfirmed = [c for r, c in rcs if not c.confirmed]
    horiz = sum((r.horizontal_m or 0) * c.circuit_count for r, c in rcs) if not unscaled else None
    vert = sum((r.vertical_m or 0) * c.circuit_count for r, c in rcs if r.vertical_m is not None) if any(r.vertical_m is not None for r, c in rcs) else None
    slack = sum((r.slack_m or 0) * c.circuit_count for r, c in rcs if r.slack_m is not None) if any(r.slack_m is not None for r, c in rcs) else None
    markup = _markup(st, ls, (horiz or 0) + (vert or 0) + (slack or 0)) if horiz is not None else None
    total = round((horiz or 0) + (vert or 0) + (slack or 0) + (markup or 0), 3) if horiz is not None else None
    formula = " + ".join((f"{r.name}: {r.horizontal_m:.2f}m × {c.circuit_count}회선" if r.horizontal_m is not None else f"{r.name}: 축척미확정") for r, c in rcs)
    if vert is not None:
        formula += f" + 수직 {vert:.2f}m"
    if slack is not None:
        formula += f" + 여장 {slack:.2f}m"
    if markup is not None:
        formula += f" + 할증 {markup:.2f}m"
    status = QuantityStatus.insufficient if unscaled else (QuantityStatus.review if unconfirmed else QuantityStatus.auto)
    q = QuantityItem(project_id=pid, discipline=ls.discipline, sub_discipline=_sub_disc(ls), item_name=ls.item_name or "?", spec=ls.spec, unit=ls.unit or "m",
                     formula=formula, qty_drawing=round(horiz, 3) if horiz is not None else None, qty_vertical=vert, qty_slack=slack, qty_markup=markup, qty_total=total,
                     drawing_nos=sorted({sheets[r.sheet_id].drawing_no or sheets[r.sheet_id].sheet_name for r, c in rcs if r.sheet_id in sheets}),
                     legend_symbol_id=ls.id, status=status, note="회선 수 미확정 경로 포함" if unconfirmed else None)
    _apply_edit(q, edited.get((ls.id, "new", None)))
    db.add(q)
    db.flush()
    for r, c in rcs:
        db.add(QuantityEvidence(item_id=q.id, sheet_id=r.sheet_id, route_id=r.id, value=(r.horizontal_m or 0) * c.circuit_count))
    return q


# ---------------- 교차 검증 ----------------
def cross_validate(db: Session, pid: int) -> list[ReviewIssue]:
    """평면도 vs 계통도 vs 일람표 동일 품목 수량 비교. 다르면 일치시키지 않고 검토 메시지 생성."""
    sheets = {s.id: s for s in project_sheets(db, pid)}
    syms = {s.id: s for s in db.query(LegendSymbol).filter_by(project_id=pid).all()}
    counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for d in db.query(DetectedSymbol).filter_by(project_id=pid).all():
        if d.status == DetectStatus.excluded or d.sheet_id not in sheets:
            continue
        t = sheets[d.sheet_id].drawing_type or "기타"
        if t == "범례":
            continue
        counts[d.legend_symbol_id][t] += 1
    # 일람표 수량(엑셀/범례 extra.qty)
    for lid, ls in syms.items():
        qv = (ls.extra or {}).get("schedule_qty")
        if qv:
            counts[lid]["일람표"] = int(qv)
    issues = []
    for lid, by in counts.items():
        if len(by) < 2:
            continue
        vals = list(by.values())
        if len(set(vals)) > 1:
            ls = syms.get(lid)
            name = f"{ls.item_name or ''} {ls.spec or ''}".strip() if ls else str(lid)
            parts = ", ".join(f"{k}에서 {name} {v}{(ls.unit if ls and ls.unit else '개')}" for k, v in by.items())
            diff = max(vals) - min(vals)
            msg = f"{parts}가 검출되었습니다. 차이 {diff}{(ls.unit if ls and ls.unit else '개')}를 확인하십시오."
            _issue(db, pid, None, "CROSS_CHECK", "warn", msg, {"legend_symbol_id": lid, "counts": dict(by)})
    db.commit()
    return db.query(ReviewIssue).filter_by(project_id=pid, code="CROSS_CHECK", resolved=False).all()


def sample_symbol_from_sheet(db: Session, ls: LegendSymbol, sheet: DrawingSheet, x: float, y: float, radius: float | None = None) -> dict:
    """도면 위 기호 1개를 클릭 → 그 기호의 외곽 도형 + 내부 내용을 이 범례 기호의 검색 지문으로 학습.
    기존 지문은 변형(variants)으로 보존되어, 같은 품목이 여러 모양으로 그려져도 모두 검색된다."""
    from .engine.anchor import _interior, _interior_desc, _aspect, _color, _sheet_index
    from .engine.geometry import bbox_of, bitmap_signature, prim_bbox
    import math
    geo = load_geometry(sheet)
    prims = geo["prims"]
    closed, grid, cell = _sheet_index(geo)
    bb = sheet.bbox or {"x0": 0, "y0": 0, "x1": 1, "y1": 1}
    r = radius or max(bb["x1"] - bb["x0"], bb["y1"] - bb["y0"]) * 0.01
    # 클릭점을 포함하거나 가장 가까운 닫힌 도형(원·사각형·조립 사각형)
    def greyness(col: str) -> float:
        try:
            v = [int(col[i:i + 2], 16) / 255 for i in (1, 3, 5)]
            return sum(v) / 3   # 0=검정, 1=흰색
        except Exception:
            return 0.0

    best = None
    for (i, k, b, s_, asp, col, dashed) in closed:
        if s_ > 6 * r or s_ < 1.5:
            continue
        cx, cy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
        inside = b["x0"] - 0.5 <= x <= b["x1"] + 0.5 and b["y0"] - 0.5 <= y <= b["y1"] + 0.5
        d = 0.0 if inside else math.dist((cx, cy), (x, y))
        if d > 2 * r:
            continue
        # 우선순위: 회색 배경선(건축 참조) 보다 진한 기호선 → 클릭을 포함 → 포함하는 것 중 가장 작은 도형
        score = (greyness(col) > 0.45, d, s_)
        if best is None or score < best[0]:
            best = (score, i, k, b, s_, col, dashed)
    if not best:
        return {"ok": False, "error": "클릭 위치에서 원·사각형 같은 닫힌 도형을 찾지 못했습니다. 기호 바깥 테두리를 클릭하십시오."}
    _, i, k, b, s_, col, dashed = best
    near = set()
    for gx in range(int(b["x0"] // cell), int(b["x1"] // cell) + 1):
        for gy in range(int(b["y0"] // cell), int(b["y1"] // cell) + 1):
            near.update(grid.get((gx, gy), ()))
    inner = _interior(((j, prims[j]) for j in near), i, b, col)
    anchor = {"kind": k, "size": round(s_, 3), "aspect": _aspect(b), "color": col, "dashed": bool(dashed),
              "interior": _interior_desc(inner, b), "outer_ratio": 1.0, "sampled": True}
    fp = {"n": 1 + len(inner), "anchor": anchor, "size": round(s_, 3), "sampled_from": {"sheet_id": sheet.id, "x": x, "y": y}}
    old = ls.fingerprint or {}
    variants = list(old.get("variants") or [])
    if old.get("anchor") or old.get("bm"):
        variants.append({k2: v for k2, v in old.items() if k2 != "variants"})
    fp["variants"] = variants[-8:]
    ls.fingerprint = fp
    ls.status = SymbolStatus.edited
    ls.confidence = 1.0
    db.commit()
    return {"ok": True, "kind": k, "size": round(s_, 2), "dashed": bool(dashed), "interior_empty": anchor["interior"]["empty"],
            "prims": len(inner) + 1, "layers": [col], "bbox": b}



def purge_legend_symbols(db: Session, pid: int, symbol_ids: list[int]) -> None:
    """범례 기호 삭제 전, 그 기호로 검출·산출된 데이터를 FK 순서대로 정리한다."""
    from sqlalchemy import delete, select, update
    from .models import Circuit, DetectedSymbol, QuantityEvidence, QuantityItem, Route, RouteSegment
    if not symbol_ids:
        return
    det_ids = select(DetectedSymbol.id).where(DetectedSymbol.legend_symbol_id.in_(symbol_ids))
    route_ids = select(Route.id).where(Route.legend_symbol_id.in_(symbol_ids))
    seg_ids = select(RouteSegment.id).where(RouteSegment.route_id.in_(route_ids))
    item_ids = select(QuantityItem.id).where(QuantityItem.legend_symbol_id.in_(symbol_ids))
    db.execute(delete(QuantityEvidence).where(QuantityEvidence.detected_symbol_id.in_(det_ids) | QuantityEvidence.route_id.in_(route_ids)
                                              | QuantityEvidence.segment_id.in_(seg_ids) | QuantityEvidence.item_id.in_(item_ids)))
    db.execute(delete(QuantityItem).where(QuantityItem.legend_symbol_id.in_(symbol_ids)))
    db.execute(delete(Circuit).where(Circuit.cable_symbol_id.in_(symbol_ids) | Circuit.route_id.in_(route_ids)))
    db.execute(update(RouteSegment).where(RouteSegment.legend_symbol_id.in_(symbol_ids)).values(legend_symbol_id=None))
    db.execute(delete(RouteSegment).where(RouteSegment.route_id.in_(route_ids)))
    db.execute(delete(Route).where(Route.id.in_(route_ids)))
    db.execute(delete(DetectedSymbol).where(DetectedSymbol.legend_symbol_id.in_(symbol_ids)))
    db.flush()
