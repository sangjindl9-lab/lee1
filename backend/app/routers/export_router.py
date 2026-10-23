import json
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import services
from ..auth import audit, current_user, get_project_or_403
from ..config import settings
from ..db import get_db
from ..engine.export_xlsx import build_workbook, fill_company_template
from ..models import (Circuit, DetectedSymbol, LegendSymbol, LegendTable, QuantityEvidence, QuantityItem, ReviewIssue,
                      Route, User)
from .takeoff_router import _item_out

router = APIRouter(prefix="/api/projects/{pid}/export", tags=["export"])
KIND_KO = {"conduit": "전선관", "tray": "트레이", "cable": "케이블"}


def collect(db: Session, pid: int) -> dict:
    p = db.get(__import__("app.models", fromlist=["Project"]).Project, pid)
    sheets = {s.id: s for s in services.project_sheets(db, pid)}
    syms = {s.id: s for s in db.query(LegendSymbol).filter_by(project_id=pid).all()}
    tables = {t.id: t for t in db.query(LegendTable).filter_by(project_id=pid).all()}
    items = [_item_out(db, q) for q in db.query(QuantityItem).filter_by(project_id=pid).order_by(QuantityItem.discipline, QuantityItem.item_name).all()]
    revs = sorted({(s.revision.rev_no) for s in sheets.values()})
    meta = {"name": p.name, "client": p.client or "", "author": p.author or "", "reviewer": p.reviewer or "",
            "date": date.today().isoformat(), "rev": ", ".join(revs)}
    by_sheet = []
    for q in db.query(QuantityItem).filter_by(project_id=pid).all():
        per: dict[int, float] = {}
        for e in db.query(QuantityEvidence).filter_by(item_id=q.id).all():
            per[e.sheet_id] = per.get(e.sheet_id, 0) + e.value
        for sid, v in per.items():
            s = sheets.get(sid)
            by_sheet.append({"drawing_no": (s.drawing_no or s.sheet_name) if s else "?", "drawing_title": s.drawing_title if s else "",
                             "item_name": q.item_name, "spec": q.spec, "unit": q.unit, "qty": round(v, 3),
                             "basis": "기호 검출" if q.unit in ("개", "대", "조", "식", "EA") else "선로 길이"})
    routes = []
    for r in db.query(Route).filter_by(project_id=pid).all():
        ls = syms.get(r.legend_symbol_id)
        s = sheets.get(r.sheet_id)
        circ = db.query(Circuit).filter_by(route_id=r.id).all()
        routes.append({"drawing_no": (s.drawing_no or s.sheet_name) if s else "?", "kind_ko": KIND_KO[r.kind.value], "item_name": ls.item_name if ls else "?",
                       "spec": ls.spec if ls else "", "segment_count": r.segment_count, "horizontal_m": r.horizontal_m, "vertical_m": r.vertical_m,
                       "slack_m": r.slack_m, "circuits": "; ".join(f"{syms[c.cable_symbol_id].item_name}×{c.circuit_count}" for c in circ if c.cable_symbol_id in syms),
                       "status": r.status.value})
    dets = []
    for d in db.query(DetectedSymbol).filter_by(project_id=pid).order_by(DetectedSymbol.sheet_id, DetectedSymbol.legend_symbol_id, DetectedSymbol.seq_no).all():
        ls = syms.get(d.legend_symbol_id)
        s = sheets.get(d.sheet_id)
        dets.append({"id": d.id, "drawing_no": (s.drawing_no or s.sheet_name) if s else "?", "item_name": ls.item_name if ls else "?", "spec": ls.spec if ls else "",
                     "seq_no": d.seq_no, "x": d.x, "y": d.y, "method": d.method, "confidence": d.confidence, "status": d.status.value})
    legend = []
    for ls in syms.values():
        legend.append({"table_title": tables[ls.table_id].title if ls.table_id in tables else "", "symbol_name": ls.symbol_name, "block_name": ls.block_name,
                       "item_name": ls.item_name, "spec": ls.spec, "unit": ls.unit, "category": ls.category, "confidence": ls.confidence,
                       "status": ls.status.value,
                       "detected_count": db.query(DetectedSymbol).filter(DetectedSymbol.legend_symbol_id == ls.id, DetectedSymbol.status != "excluded").count()})
    issues = [{"severity": i.severity, "code": i.code, "message": i.message, "resolved": i.resolved}
              for i in db.query(ReviewIssue).filter_by(project_id=pid).all()]
    return {"meta": meta, "items": items, "items_by_sheet": by_sheet, "routes": routes, "detections": dets, "legend": legend, "issues": issues}


@router.get("/xlsx")
def export_xlsx(pid: int, a3: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_project_or_403(db, user, pid)
    data = collect(db, pid)
    out = settings.processed_dir / str(pid) / "export" / f"물량산출조서_{p.name}_{date.today().isoformat()}.xlsx"
    build_workbook(data, out, a3=a3)
    audit(db, user, "export_xlsx", pid)
    db.commit()
    return FileResponse(out, filename=out.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.post("/template")
async def export_template(pid: int, template: UploadFile = File(...), mapping: str = Form(...), sheet_name: str | None = Form(None),
                          start_row: int | None = Form(None), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """회사 표준 Excel 양식 업로드 + 컬럼 매핑(JSON {"A":"item_name",...}) → 양식에 채워서 반환."""
    p = get_project_or_403(db, user, pid)
    try:
        m = json.loads(mapping)
    except json.JSONDecodeError:
        raise HTTPException(400, "mapping 은 JSON 이어야 합니다.")
    tdir = settings.processed_dir / str(pid) / "export"
    tdir.mkdir(parents=True, exist_ok=True)
    tpath = tdir / f"template_{template.filename}"
    tpath.write_bytes(await template.read())
    items = collect(db, pid)["items"]
    out = tdir / f"양식출력_{p.name}_{date.today().isoformat()}.xlsx"
    fill_company_template(tpath, m, items, out, sheet_name, start_row)
    return FileResponse(out, filename=out.name)


@router.get("/pdf")
def export_pdf(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """물량집계표 PDF (reportlab 없이 PyMuPDF 로 생성, 한글 폰트 포함)."""
    import pymupdf
    p = get_project_or_403(db, user, pid)
    data = collect(db, pid)
    out = settings.processed_dir / str(pid) / "export" / f"물량집계표_{p.name}_{date.today().isoformat()}.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    font = _korean_font()
    rows = [["번호", "공종", "품명", "규격", "단위", "수량", "상태"]] + [
        [str(i), q["discipline"] or "", q["item_name"], q["spec"] or "", q["unit"] or "", f"{q['qty_total']:.2f}" if q["qty_total"] is not None else "미산출", q["status"]]
        for i, q in enumerate(data["items"], start=1)]
    per_page = 38
    for pg in range(0, max(1, len(rows) - 1), per_page):
        page = doc.new_page(width=842, height=595)  # A4 가로
        tw = pymupdf.TextWriter(page.rect)
        y = 40
        tw.append((40, y), f"물량집계표 — {data['meta']['name']}", font=font, fontsize=16)
        y += 20
        tw.append((40, y), f"발주처: {data['meta']['client']}  작성자: {data['meta']['author']}  검토자: {data['meta']['reviewer']}  작성일: {data['meta']['date']}  개정: {data['meta']['rev']}", font=font, fontsize=9)
        y += 24
        xs = [40, 80, 160, 380, 560, 610, 690]
        for row in [rows[0]] + rows[1 + pg: 1 + pg + per_page]:
            for x, v in zip(xs, row):
                tw.append((x, y), str(v)[:40], font=font, fontsize=8)
            y += 13
        tw.append((400, 575), f"{pg // per_page + 1} / {(len(rows) - 2) // per_page + 1}", font=font, fontsize=8)
        tw.write_text(page)
    doc.save(out)
    return FileResponse(out, filename=out.name, media_type="application/pdf")


def _korean_font():
    import glob
    import pymupdf
    for pat in ("/usr/share/fonts/**/NanumGothic*.ttf", "/usr/share/fonts/**/NotoSansCJK*-Regular.ttc", "/usr/share/fonts/**/NotoSansCJK*.ttc"):
        for f in glob.glob(pat, recursive=True):
            try:
                return pymupdf.Font(fontfile=f)
            except Exception:
                continue
    return pymupdf.Font("cjk")
