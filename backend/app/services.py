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
from .engine.geometry import in_region
from .engine.routes import build_routes, match_segments_for_symbol
from .models import (Circuit, DetectedSymbol, DetectStatus, DrawingFile, DrawingSheet, LegendSymbol, LegendTable,
                     Project, QuantityEvidence, QuantityItem, QuantityStatus, ReviewIssue, Route, RouteKind,
                     RouteSegment, SymbolMapping, SymbolStatus)


def load_geometry(sheet: DrawingSheet) -> dict:
    with open(sheet.geometry_path, encoding="utf-8") as fp:
        return json.load(fp)


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
            img = crop_symbol_image(sheet, _symbol_cell(r.region, res.region), settings.processed_dir / str(pid) / "legend" / f"{tbl.id}_{r.row_no}.png")
        db.add(LegendSymbol(table_id=tbl.id, project_id=pid, row_no=r.row_no, symbol_name=r.symbol_name, block_name=r.block_name,
                            fingerprint=r.fingerprint, image_path=img, item_name=r.item_name, spec=r.spec, unit=r.unit,
                            discipline=(sheet.discipline if sheet else None), category=r.category, layer_hint=r.layer_hint,
                            confidence=r.confidence, status=SymbolStatus(r.status), region=r.region,
                            extra={"texts": r.texts}))
    return tbl


def _symbol_cell(row_region: dict, table_region: dict) -> dict:
    """기호 열 = 행 밴드의 좌측 18% (헤더 없을 때 기본)."""
    w = table_region["x1"] - table_region["x0"]
    return {"x0": table_region["x0"], "x1": table_region["x0"] + 0.18 * w, "y0": row_region["y0"], "y1": row_region["y1"]}


def auto_detect_legends(db: Session, pid: int) -> list[LegendTable]:
    """모든 시트에서 범례표 자동 탐색. 이미 같은 시트·영역에 승인된 범례가 있으면 건너뜀."""
    created = []
    for s in project_sheets(db, pid):
        geo = load_geometry(s)
        existing = db.query(LegendTable).filter_by(project_id=pid, sheet_id=s.id).all()
        for res in legend_engine.auto_detect_legends(geo):
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
    res = legend_engine.legend_from_region(geo, region, title or "사용자 지정 범례")
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
def run_detection(db: Session, pid: int, sheet_ids: list[int] | None = None) -> dict:
    """프로젝트 전체(또는 지정 시트) 기호 검출. 사용자 잠금(user_locked) 행은 보존."""
    symbols = [ls for ls in db.query(LegendSymbol).filter_by(project_id=pid).all()
               if ls.category == "device" and ls.status != SymbolStatus.unresolved]
    sym_dicts = [{"id": s.id, "block_name": s.block_name, "fingerprint": s.fingerprint, "symbol_name": s.symbol_name,
                  "category": s.category, "image_path": s.image_path} for s in symbols]
    summary = {"sheets": 0, "detected": 0, "preserved": 0}
    _clear_evidence(db, pid)
    for s in project_sheets(db, pid):
        if sheet_ids and s.id not in sheet_ids:
            continue
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
            db.add(DetectedSymbol(project_id=pid, sheet_id=s.id, legend_symbol_id=d.legend_symbol_id, entity_handle=d.handle,
                                  method=d.method, x=d.x, y=d.y, bbox=d.bbox, confidence=d.confidence, seq_no=seq[d.legend_symbol_id],
                                  status=DetectStatus(d.status), install_type=d.install_type, floor_zone=s.floor_zone))
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
        for ls in line_syms:
            segs = match_segments_for_symbol(geo, {"id": ls.id, "layer_hint": ls.layer_hint, "symbol_name": ls.symbol_name,
                                                   "spec": ls.spec, "item_name": ls.item_name}, excl)
            if not segs:
                continue
            kind = RouteKind(ls.category)
            for ri, ro in enumerate(build_routes(segs, scale, tol), start=1):
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
    non_install = {"계통도", "일람표", "범례"}
    groups: dict[tuple, list[DetectedSymbol]] = defaultdict(list)
    for d in db.query(DetectedSymbol).filter_by(project_id=pid).all():
        if d.status == DetectStatus.excluded or d.legend_symbol_id not in syms:
            continue
        sh = sheets.get(d.sheet_id)
        if sh is not None and (sh.drawing_type or "") in non_install:
            continue
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
    db.commit()
    return items


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
