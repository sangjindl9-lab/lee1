"""수동 영역 집계 API — 드래그한 영역 안 객체 개수 집계 + 케이블 길이 직접 입력."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import services
from ..auth import EDIT_ROLES, audit, current_user, get_project_or_403, require_role
from ..db import get_db
from ..engine.region_tally import analyze_region
from ..models import RegionTally, User
from .projects_router import _sheet_checked

router = APIRouter(prefix="/api/projects/{pid}", tags=["region-tally"])


class RegionIn(BaseModel):
    region: dict
    hidden_layers: list[str] = []


class TallyRow(BaseModel):
    kind: str = "object"            # object | cable
    item_name: str = Field(min_length=1, max_length=200)
    spec: str | None = None
    unit: str | None = None
    qty: float = Field(ge=0)
    ref_length: float | None = None
    discipline: str | None = None
    marks: list = []
    note: str | None = None


class TallyIn(BaseModel):
    sheet_id: int
    region: dict
    rows: list[TallyRow]


def _norm_region(r: dict) -> dict:
    try:
        x0, x1 = sorted((float(r["x0"]), float(r["x1"])))
        y0, y1 = sorted((float(r["y0"]), float(r["y1"])))
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "영역 좌표(x0,y0,x1,y1)가 필요합니다.")
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        raise HTTPException(400, "영역이 너무 작습니다. 드래그하여 사각형을 그리십시오.")
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}


@router.post("/sheets/{sid}/region-analyze")
def region_analyze(pid: int, sid: int, body: RegionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _sheet_checked(db, user, pid, sid)
    if not s.geometry_path:
        raise HTTPException(404, "처리본이 없습니다. 재분석하십시오.")
    geo = services.load_geometry(s)
    res = analyze_region(geo, _norm_region(body.region), s.source_kind or "", s.scale_factor if s.scale_confirmed else None,
                         set(body.hidden_layers), s.discipline, services.legend_exclude_regions(db, pid, s.id))
    res["scale_confirmed"] = bool(s.scale_confirmed)
    res["units"] = s.units
    return res


def _tally_out(t: RegionTally) -> dict:
    return {"id": t.id, "sheet_id": t.sheet_id, "drawing_no": t.drawing_no, "region": t.region, "kind": t.kind,
            "discipline": t.discipline, "item_name": t.item_name, "spec": t.spec, "unit": t.unit, "qty": t.qty,
            "ref_length": t.ref_length, "marks": t.marks or [], "note": t.note, "created_at": t.created_at.isoformat()}


@router.get("/tallies")
def list_tallies(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    return [_tally_out(t) for t in db.query(RegionTally).filter_by(project_id=pid).order_by(RegionTally.id).all()]


@router.post("/tallies")
def add_tallies(pid: int, body: TallyIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    s = _sheet_checked(db, user, pid, body.sheet_id)
    region = _norm_region(body.region)
    rows = [r for r in body.rows if r.qty > 0]
    if not rows:
        raise HTTPException(400, "추가할 항목이 없습니다. 수량(또는 케이블 길이)을 입력하십시오.")
    out = []
    for r in rows:
        t = RegionTally(project_id=pid, sheet_id=s.id, drawing_no=s.drawing_no or s.sheet_name, region=region,
                        kind="cable" if r.kind == "cable" else "object", discipline=r.discipline or s.discipline,
                        item_name=r.item_name.strip(), spec=(r.spec or "").strip() or None,
                        unit=(r.unit or ("m" if r.kind == "cable" else "개")).strip(), qty=r.qty,
                        ref_length=r.ref_length, marks=r.marks[:2000], note=r.note, created_by=user.id)
        db.add(t)
        out.append(t)
    db.flush()
    audit(db, user, "region_tally_add", pid, sheet_id=s.id, rows=[(t.item_name, t.qty, t.unit) for t in out])
    db.commit()
    services.recompute_quantities(db, pid)
    return [_tally_out(t) for t in out]


@router.delete("/tallies/{tid}")
def delete_tally(pid: int, tid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    t = db.get(RegionTally, tid)
    if not t or t.project_id != pid:
        raise HTTPException(404, "집계 내역이 없습니다.")
    audit(db, user, "region_tally_delete", pid, tally_id=tid, item=t.item_name, qty=t.qty)
    db.delete(t)
    db.commit()
    services.recompute_quantities(db, pid)
    return {"ok": True}


lib_router = APIRouter(prefix="/api/symbol-library", tags=["symbol-library"])


@lib_router.get("")
def symbol_library(user: User = Depends(current_user)):
    """학습된 표준 심볼 라이브러리 (이름·공종·출처·축소 도형)."""
    from ..engine.symbol_library import load_library
    lib = load_library()
    return {"sources": lib.get("sources", []),
            "symbols": [{"id": e["id"], "name": e["name"], "code": e.get("code"), "discipline": e["discipline"], "source": e["source"],
                         "letters": e.get("letters", []), "thumb": e.get("thumb", [])} for e in lib.get("symbols", [])]}
