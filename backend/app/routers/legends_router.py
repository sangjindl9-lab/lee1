from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import services
from ..auth import EDIT_ROLES, audit, current_user, get_project_or_403, require_role
from ..db import get_db
from ..models import Approval, DetectedSymbol, DrawingSheet, LegendSymbol, LegendTable, SymbolMapping, SymbolStatus, User
from ..schemas import LegendRegionIn, LegendSymbolIn, ManualSymbolIn

router = APIRouter(prefix="/api/projects/{pid}/legends", tags=["legends"])


def _sym_out(db: Session, s: LegendSymbol) -> dict:
    n = db.query(DetectedSymbol).filter(DetectedSymbol.legend_symbol_id == s.id, DetectedSymbol.status != "excluded").count()
    return {"id": s.id, "table_id": s.table_id, "row_no": s.row_no, "symbol_name": s.symbol_name, "block_name": s.block_name,
            "fingerprint": s.fingerprint, "has_image": bool(s.image_path), "item_name": s.item_name, "spec": s.spec, "unit": s.unit,
            "discipline": s.discipline, "category": s.category, "layer_hint": s.layer_hint, "confidence": s.confidence,
            "status": s.status.value, "region": s.region, "extra": s.extra or {}, "detected_count": n}


def _tbl_out(db: Session, t: LegendTable) -> dict:
    return {"id": t.id, "sheet_id": t.sheet_id, "title": t.title, "region": t.region, "source": t.source,
            "confidence": t.confidence, "symbols": [_sym_out(db, s) for s in sorted(t.symbols, key=lambda s: s.row_no)]}


@router.get("")
def list_legends(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    return [_tbl_out(db, t) for t in db.query(LegendTable).filter_by(project_id=pid).all()]


@router.post("/auto")
def auto_detect(pid: int, wait: bool = False, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """모든 시트에서 범례표 자동 탐색 → 회사 라이브러리로 보강. 기본 백그라운드 실행(job_id 반환), wait=1 이면 동기."""
    get_project_or_403(db, user, pid)
    if not wait:
        from ..jobs import submit_job
        return {"job_id": submit_job(pid, user.id, "legend_auto")}
    created = services.auto_detect_legends(db, pid)
    n = services.apply_library(db, pid, user.company_id)
    audit(db, user, "legend_auto", pid, tables=len(created), library_hits=n)
    db.commit()
    return {"created": [_tbl_out(db, t) for t in created], "library_hits": n}


@router.post("/region")
def from_region(pid: int, body: LegendRegionIn, force: bool = False, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """자동 검출 실패 시 사용자가 마우스로 지정한 표 영역."""
    get_project_or_403(db, user, pid)
    s = db.get(DrawingSheet, body.sheet_id)
    if not s or s.revision.file.project_id != pid:
        raise HTTPException(404, "시트가 없습니다.")
    r = body.region
    if not all(k in r for k in ("x0", "y0", "x1", "y1")) or r["x1"] <= r["x0"] or r["y1"] <= r["y0"]:
        raise HTTPException(400, "영역이 올바르지 않습니다.")
    # 범례 영역은 '산출 제외' 영역이 된다 — 도면 대부분을 덮으면 수량이 0 이 되므로 막는다
    b = s.bbox or {}
    sheet_area = max((b.get("x1", 0) - b.get("x0", 0)) * (b.get("y1", 0) - b.get("y0", 0)), 1e-9)
    ratio = (r["x1"] - r["x0"]) * (r["y1"] - r["y0"]) / sheet_area
    if ratio > 0.35 and not force:
        raise HTTPException(400, f"지정한 범례 영역이 도면의 {ratio * 100:.0f}% 입니다. 범례 영역 안의 기호는 수량에서 빠지므로, "
                                 "범례 '표'만 작게 드래그하십시오. 기호 개수를 세려면 '영역 집계'를 쓰십시오.")
    t = services.legend_from_region(db, pid, s, r, body.title)
    audit(db, user, "legend_region", pid, sheet=s.id, rows=len(t.symbols))
    db.commit()
    return _tbl_out(db, t)


@router.delete("/{tid}")
def delete_table(pid: int, tid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    t = db.get(LegendTable, tid)
    if not t or t.project_id != pid:
        raise HTTPException(404, "범례표가 없습니다.")
    services.purge_legend_symbols(db, pid, [x.id for x in t.symbols])
    audit(db, user, "legend_delete", pid, table=t.title)
    db.delete(t)
    db.commit()
    services.recompute_quantities(db, pid)
    return {"ok": True}


@router.delete("")
def delete_all_tables(pid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """이 프로젝트의 범례표 전체 삭제 (잘못 지정한 범례 영역 초기화)."""
    get_project_or_403(db, user, pid)
    tables = db.query(LegendTable).filter_by(project_id=pid).all()
    services.purge_legend_symbols(db, pid, [x.id for t in tables for x in t.symbols])
    for t in tables:
        db.delete(t)
    audit(db, user, "legend_delete_all", pid, tables=len(tables))
    db.commit()
    services.recompute_quantities(db, pid)
    return {"deleted": len(tables)}


@router.post("/{tid}/symbols")
def add_symbol(pid: int, tid: int, body: LegendSymbolIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """미인식 기호 수동 등록 (블록명 또는 기호명 필요)."""
    get_project_or_403(db, user, pid)
    t = db.get(LegendTable, tid)
    if not t or t.project_id != pid:
        raise HTTPException(404)
    if not (body.block_name or body.symbol_name):
        raise HTTPException(400, "블록명 또는 기호명이 필요합니다.")
    s = LegendSymbol(table_id=tid, project_id=pid, row_no=len(t.symbols) + 1, status=SymbolStatus.edited, confidence=1.0,
                     **{k: v for k, v in body.model_dump(exclude_none=True).items() if k not in ("status", "save_to_library")})
    db.add(s)
    db.commit()
    return _sym_out(db, s)


@router.put("/symbols/{sid}")
def update_symbol(pid: int, sid: int, body: LegendSymbolIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """사용자 수정·승인. 승인 시 회사 라이브러리 저장 가능. 재산출은 /takeoff/run 호출."""
    get_project_or_403(db, user, pid)
    s = db.get(LegendSymbol, sid)
    if not s or s.project_id != pid:
        raise HTTPException(404)
    data = body.model_dump(exclude_none=True)
    save_lib = data.pop("save_to_library", False)
    new_status = data.pop("status", None)
    for k, v in data.items():
        setattr(s, k, v)
    if new_status:
        s.status = SymbolStatus(new_status)
    elif data:
        s.status = SymbolStatus.edited
    if s.status == SymbolStatus.approved and not s.item_name:
        raise HTTPException(400, "품명이 없는 기호는 승인할 수 없습니다(미확인 항목으로 유지).")
    if s.status == SymbolStatus.approved:
        db.add(Approval(project_id=pid, target_type="legend", target_id=s.id, user_id=user.id, decision="approved"))
        if save_lib:
            m = SymbolMapping(company_id=user.company_id, block_name=s.block_name, symbol_name=s.symbol_name, fingerprint=s.fingerprint,
                              item_name=s.item_name, spec=s.spec, unit=s.unit, discipline=s.discipline, category=s.category)
            db.add(m)
    audit(db, user, "legend_update", pid, symbol=s.id, status=s.status.value)
    db.commit()
    return _sym_out(db, s)


@router.post("/approve-all")
def approve_all(pid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """품명이 있는 모든 자동 인식 기호 일괄 승인."""
    get_project_or_403(db, user, pid)
    n = 0
    for s in db.query(LegendSymbol).filter_by(project_id=pid).all():
        if s.item_name and s.status in (SymbolStatus.auto, SymbolStatus.edited):
            s.status = SymbolStatus.approved
            n += 1
    audit(db, user, "legend_approve_all", pid, count=n)
    db.commit()
    return {"approved": n}


@router.delete("/symbols/{sid}")
def delete_symbol(pid: int, sid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    s = db.get(LegendSymbol, sid)
    if not s or s.project_id != pid:
        raise HTTPException(404, "범례 행이 없습니다.")
    services.purge_legend_symbols(db, pid, [s.id])
    db.delete(s)
    db.commit()
    services.recompute_quantities(db, pid)
    return {"ok": True}


@router.get("/symbols/{sid}/image")
def symbol_image(pid: int, sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    s = db.get(LegendSymbol, sid)
    if not s or s.project_id != pid or not s.image_path:
        raise HTTPException(404)
    return FileResponse(s.image_path, media_type="image/png")


@router.get("/library")
def library(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    return [{"id": m.id, "block_name": m.block_name, "symbol_name": m.symbol_name, "item_name": m.item_name, "spec": m.spec,
             "unit": m.unit, "discipline": m.discipline, "category": m.category}
            for m in db.query(SymbolMapping).filter_by(company_id=user.company_id).all()]


@router.post("/symbols/{sid}/sample")
def sample_symbol(pid: int, sid: int, body: ManualSymbolIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """도면 위 기호 1개를 클릭해 이 범례 기호의 검색 지문으로 등록 (범례 그림과 도면 기호가 다를 때, 미인식 기호 등록)."""
    get_project_or_403(db, user, pid)
    s = db.get(LegendSymbol, sid)
    sh = db.get(DrawingSheet, body.sheet_id)
    if not s or s.project_id != pid or not sh:
        raise HTTPException(404)
    r = services.sample_symbol_from_sheet(db, s, sh, body.x, body.y)
    if not r.get("ok"):
        raise HTTPException(400, r.get("error"))
    audit(db, user, "legend_sample", pid, symbol=sid, sheet=sh.id)
    db.commit()
    return {**r, "symbol": _sym_out(db, s)}



class LearnIn(BaseModel):
    sheet_id: int
    region: dict | None = None      # 없으면 시트 전체에서 범례표를 찾는다
    title: str | None = None


@router.post("/learn")
def learn_legend(pid: int, body: LearnIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """'범례 먼저 학습': 선택한 범례 도면(또는 드래그한 범례 영역)의 기호·품명을 익히고,
    바로 전체 도면 자동 검출(백그라운드 작업)을 시작한다. 범례 도면은 설치 수량에서 제외(도면 종류 = 범례)."""
    from ..jobs import submit_job
    get_project_or_403(db, user, pid)
    s = db.get(DrawingSheet, body.sheet_id)
    if not s or s.revision.file.project_id != pid:
        raise HTTPException(404, "시트가 없습니다.")
    if body.region:
        r = body.region
        if not all(k in r for k in ("x0", "y0", "x1", "y1")) or r["x1"] <= r["x0"] or r["y1"] <= r["y0"]:
            raise HTTPException(400, "영역이 올바르지 않습니다.")
        tables = [services.legend_from_region(db, pid, s, r, body.title or "범례(영역 학습)")]
    else:
        tables = services.auto_detect_legends(db, pid, sheet_ids=[s.id])
        if not tables:
            tables = db.query(LegendTable).filter_by(project_id=pid, sheet_id=s.id).all()
        if not tables:
            raise HTTPException(400, "이 도면에서 범례표를 찾지 못했습니다. 상단 '범례 영역 지정'으로 범례표 부분만 드래그해 학습하십시오.")
        s.drawing_type = "범례"
    services.apply_library(db, pid, user.company_id)
    syms = [x for t in tables for x in t.symbols]
    learned = [x for x in syms if x.category == "device" and x.status != SymbolStatus.unresolved and x.fingerprint]
    unresolved = [x for x in syms if x.status == SymbolStatus.unresolved or not x.item_name]
    audit(db, user, "legend_learn", pid, sheet=s.id, tables=len(tables), learned=len(learned))
    db.commit()
    job_id = submit_job(pid, user.id, "takeoff") if learned else None
    return {"tables": len(tables), "symbols": len(syms), "learned": len(learned), "unresolved": len(unresolved),
            "learned_names": [x.item_name for x in learned][:40], "job_id": job_id,
            "message": None if learned else "기호 모양이 있는 범례 행을 찾지 못했습니다. 범례 탭에서 품명·기호를 확인하십시오."}
