from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import services
from ..auth import EDIT_ROLES, REVIEW_ROLES, audit, current_user, get_project_or_403, require_role
from ..db import get_db
from ..models import (Circuit, DetectedSymbol, DetectStatus, DrawingSheet, LegendSymbol, QuantityEvidence, QuantityItem,
                      QuantityRevision, QuantityStatus, ReviewIssue, Route, RouteSegment, User)
from ..schemas import CircuitIn, DetectedSymbolIn, ManualSymbolIn, QuantityItemIn, RouteIn

router = APIRouter(prefix="/api/projects/{pid}/takeoff", tags=["takeoff"])


def _det_out(d: DetectedSymbol) -> dict:
    return {"id": d.id, "sheet_id": d.sheet_id, "legend_symbol_id": d.legend_symbol_id, "handle": d.entity_handle, "method": d.method,
            "x": d.x, "y": d.y, "bbox": d.bbox, "confidence": d.confidence, "seq_no": d.seq_no, "status": d.status.value,
            "install_type": d.install_type, "floor_zone": d.floor_zone, "note": d.note, "locked": d.user_locked}


def _route_out(db: Session, r: Route) -> dict:
    segs = db.query(RouteSegment).filter_by(route_id=r.id).all()
    circ = db.query(Circuit).filter_by(route_id=r.id).all()
    return {"id": r.id, "sheet_id": r.sheet_id, "legend_symbol_id": r.legend_symbol_id, "kind": r.kind.value, "name": r.name,
            "horizontal_m": r.horizontal_m, "vertical_m": r.vertical_m, "slack_m": r.slack_m, "segment_count": r.segment_count,
            "status": r.status.value,
            "segments": [{"id": s.id, "handle": s.entity_handle, "layer": s.layer, "points": s.points, "length_du": s.length_du,
                          "length_m": s.length_m, "dup_of": s.is_duplicate_of, "status": s.status.value} for s in segs],
            "circuits": [{"id": c.id, "cable_symbol_id": c.cable_symbol_id, "circuit_count": c.circuit_count, "confirmed": c.confirmed, "note": c.note} for c in circ]}


def _item_out(db: Session, q: QuantityItem) -> dict:
    ev = db.query(QuantityEvidence).filter_by(item_id=q.id).all()
    return {"id": q.id, "discipline": q.discipline, "sub_discipline": q.sub_discipline, "item_name": q.item_name, "spec": q.spec, "unit": q.unit,
            "formula": q.formula, "qty_drawing": q.qty_drawing, "qty_vertical": q.qty_vertical, "qty_slack": q.qty_slack, "qty_markup": q.qty_markup,
            "qty_total": q.qty_total, "drawing_nos": q.drawing_nos, "floor_zone": q.floor_zone, "legend_symbol_id": q.legend_symbol_id,
            "install_type": q.install_type, "status": q.status.value, "note": q.note,
            "evidence": [{"sheet_id": e.sheet_id, "detected_symbol_id": e.detected_symbol_id, "route_id": e.route_id, "value": e.value} for e in ev]}


@router.post("/run")
def run_all(pid: int, wait: bool = False, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """기호 검출 → 선로 → 집계 → 교차검증. 사용자 수정은 보존.
    기본은 백그라운드 작업으로 실행하고 {job_id} 를 즉시 반환 (GET /api/jobs/{id} 로 진행률 확인). wait=1 이면 끝까지 기다림."""
    get_project_or_403(db, user, pid)
    if not wait:
        from ..jobs import submit_job
        return {"job_id": submit_job(pid, user.id, "takeoff")}
    d = services.run_detection(db, pid)
    r = services.run_routes(db, pid)
    items = services.recompute_quantities(db, pid)
    issues = services.cross_validate(db, pid)
    audit(db, user, "takeoff_run", pid, **d, routes=r["routes"])
    db.commit()
    return {"detection": d, "routes": r, "items": len(items), "cross_issues": len(issues)}


@router.post("/recompute")
def recompute(pid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """수정 후 즉시 재계산 (검출/선로는 유지, 집계만)."""
    get_project_or_403(db, user, pid)
    items = services.recompute_quantities(db, pid)
    services.cross_validate(db, pid)
    return [_item_out(db, q) for q in items]


# ---- 검출 기호 ----
@router.get("/symbols")
def list_detected(pid: int, sheet_id: int | None = None, legend_symbol_id: int | None = None,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    q = db.query(DetectedSymbol).filter_by(project_id=pid)
    if sheet_id:
        q = q.filter_by(sheet_id=sheet_id)
    if legend_symbol_id:
        q = q.filter_by(legend_symbol_id=legend_symbol_id)
    return [_det_out(d) for d in q.order_by(DetectedSymbol.seq_no).all()]


@router.put("/symbols/{did}")
def update_detected(pid: int, did: int, body: DetectedSymbolIn, user: User = Depends(require_role(*REVIEW_ROLES)), db: Session = Depends(get_db)):
    """승인/제외/품목 변경/층 지정. 변경 즉시 집계 재계산."""
    get_project_or_403(db, user, pid)
    d = db.get(DetectedSymbol, did)
    if not d or d.project_id != pid:
        raise HTTPException(404)
    data = body.model_dump(exclude_none=True)
    st = data.pop("status", None)
    for k, v in data.items():
        setattr(d, k, v)
    if st:
        d.status = DetectStatus(st)
    elif data:
        d.status = DetectStatus.edited
    d.user_locked = True
    audit(db, user, "detected_update", pid, id=did, status=d.status.value)
    db.commit()
    services.recompute_quantities(db, pid)
    return _det_out(d)


@router.post("/symbols/bulk")
def bulk_update(pid: int, ids: list[int], status: str, user: User = Depends(require_role(*REVIEW_ROLES)), db: Session = Depends(get_db)):
    """여러 객체 일괄 승인/제외."""
    get_project_or_403(db, user, pid)
    st = DetectStatus(status)
    n = 0
    for d in db.query(DetectedSymbol).filter(DetectedSymbol.project_id == pid, DetectedSymbol.id.in_(ids)).all():
        d.status = st
        d.user_locked = True
        n += 1
    db.commit()
    services.recompute_quantities(db, pid)
    return {"updated": n}


@router.post("/symbols/manual")
def add_manual(pid: int, body: ManualSymbolIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """누락 기호 수동 추가."""
    get_project_or_403(db, user, pid)
    s = db.get(DrawingSheet, body.sheet_id)
    ls = db.get(LegendSymbol, body.legend_symbol_id)
    if not s or not ls or ls.project_id != pid:
        raise HTTPException(404)
    seq = db.query(DetectedSymbol).filter_by(project_id=pid, sheet_id=s.id, legend_symbol_id=ls.id).count() + 1
    d = DetectedSymbol(project_id=pid, sheet_id=s.id, legend_symbol_id=ls.id, method="manual", x=body.x, y=body.y, confidence=1.0,
                       seq_no=seq, status=DetectStatus.manual, floor_zone=body.floor_zone or s.floor_zone, note=body.note, user_locked=True)
    db.add(d)
    db.commit()
    services.recompute_quantities(db, pid)
    return _det_out(d)


# ---- 선로 / 회선 ----
@router.get("/routes")
def list_routes(pid: int, sheet_id: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    q = db.query(Route).filter_by(project_id=pid)
    if sheet_id:
        q = q.filter_by(sheet_id=sheet_id)
    return [_route_out(db, r) for r in q.all()]


@router.put("/routes/{rid}")
def update_route(pid: int, rid: int, body: RouteIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """입상(수직)·여장 입력, 승인."""
    get_project_or_403(db, user, pid)
    r = db.get(Route, rid)
    if not r or r.project_id != pid:
        raise HTTPException(404)
    data = body.model_dump(exclude_none=True)
    st = data.pop("status", None)
    for k, v in data.items():
        setattr(r, k, v)
    r.status = DetectStatus(st) if st else DetectStatus.edited
    db.commit()
    services.recompute_quantities(db, pid)
    return _route_out(db, r)


@router.put("/segments/{sid}")
def update_segment(pid: int, sid: int, status: str, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """중복 선분 확인: excluded(중복) / verified(별도 선로로 포함)."""
    get_project_or_403(db, user, pid)
    s = db.get(RouteSegment, sid)
    if not s or s.project_id != pid:
        raise HTTPException(404)
    s.status = DetectStatus(status)
    s.user_locked = True
    r = db.get(Route, s.route_id)
    segs = db.query(RouteSegment).filter_by(route_id=r.id).all()
    total_du = sum(x.length_du for x in segs if x.status != DetectStatus.excluded and (x.is_duplicate_of is None or x.status == DetectStatus.verified))
    sheet = db.get(DrawingSheet, r.sheet_id)
    r.horizontal_m = total_du * sheet.scale_factor if sheet.scale_confirmed and sheet.scale_factor else None
    if all(x.status != DetectStatus.review for x in segs):
        r.status = DetectStatus.verified
    db.commit()
    services.recompute_quantities(db, pid)
    return _route_out(db, r)


@router.post("/circuits")
def set_circuit(pid: int, body: CircuitIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """경로에 케이블 회선 수 확정 → 케이블 = 경로길이 × 회선수, 전선관은 그대로."""
    get_project_or_403(db, user, pid)
    r = db.get(Route, body.route_id)
    ls = db.get(LegendSymbol, body.cable_symbol_id)
    if not r or r.project_id != pid or not ls or ls.project_id != pid:
        raise HTTPException(404)
    if ls.category != "cable":
        raise HTTPException(400, "케이블 범주의 범례 기호만 회선으로 지정할 수 있습니다.")
    c = db.query(Circuit).filter_by(route_id=r.id, cable_symbol_id=ls.id).first()
    if not c:
        c = Circuit(project_id=pid, route_id=r.id, cable_symbol_id=ls.id)
        db.add(c)
    c.circuit_count, c.confirmed, c.note = body.circuit_count, body.confirmed, body.note
    audit(db, user, "circuit_set", pid, route=r.id, cable=ls.id, n=body.circuit_count)
    db.commit()
    services.recompute_quantities(db, pid)
    return _route_out(db, r)


@router.delete("/circuits/{cid}")
def del_circuit(pid: int, cid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    c = db.get(Circuit, cid)
    if not c or c.project_id != pid:
        raise HTTPException(404)
    db.delete(c)
    db.commit()
    services.recompute_quantities(db, pid)
    return {"ok": True}


# ---- 물량 ----
@router.get("/items")
def list_items(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    return [_item_out(db, q) for q in db.query(QuantityItem).filter_by(project_id=pid).order_by(QuantityItem.discipline, QuantityItem.item_name).all()]


@router.put("/items/{iid}")
def update_item(pid: int, iid: int, body: QuantityItemIn, user: User = Depends(require_role(*REVIEW_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    q = db.get(QuantityItem, iid)
    if not q or q.project_id != pid:
        raise HTTPException(404)
    data = body.model_dump(exclude_none=True)
    st = data.pop("status", None)
    for k, v in data.items():
        setattr(q, k, v)
    q.status = QuantityStatus(st) if st else QuantityStatus.edited
    audit(db, user, "item_update", pid, item=iid)
    db.commit()
    return _item_out(db, q)


@router.get("/summary")
def summary(pid: int, group: str = "discipline", user: User = Depends(current_user), db: Session = Depends(get_db)):
    """공종별/층별/도면별 집계."""
    get_project_or_403(db, user, pid)
    out: dict[str, list] = {}
    for q in db.query(QuantityItem).filter_by(project_id=pid).all():
        keys = [q.discipline or "미분류"] if group == "discipline" else ([q.floor_zone or "미지정"] if group == "floor" else (q.drawing_nos or ["-"]))
        for k in keys:
            out.setdefault(k, []).append(_item_out(db, q))
    return out


@router.get("/issues")
def issues(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    return [{"id": i.id, "sheet_id": i.sheet_id, "severity": i.severity, "code": i.code, "message": i.message, "data": i.data,
             "resolved": i.resolved, "created_at": i.created_at.isoformat()}
            for i in db.query(ReviewIssue).filter_by(project_id=pid).order_by(ReviewIssue.resolved, ReviewIssue.id.desc()).all()]


@router.put("/issues/{iid}/resolve")
def resolve_issue(pid: int, iid: int, user: User = Depends(require_role(*REVIEW_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    i = db.get(ReviewIssue, iid)
    if not i or i.project_id != pid:
        raise HTTPException(404)
    i.resolved = True
    db.commit()
    return {"ok": True}


# ---- 이력 / 변경 비교 ----
@router.post("/snapshot")
def snapshot(pid: int, reason: str = "", user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    items = db.query(QuantityItem).filter_by(project_id=pid).all()
    n = db.query(QuantityRevision).filter_by(project_id=pid).count() + 1
    snap = [{"legend_symbol_id": q.legend_symbol_id, "item_name": q.item_name, "spec": q.spec, "unit": q.unit, "install_type": q.install_type,
             "floor_zone": q.floor_zone, "qty_total": q.qty_total, "drawing_nos": q.drawing_nos} for q in items]
    rev = QuantityRevision(project_id=pid, revision_no=n, snapshot=snap, reason=reason, created_by=user.id)
    db.add(rev)
    db.commit()
    return {"revision_no": n, "items": len(snap)}


@router.get("/revisions")
def revisions(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    return [{"id": r.id, "revision_no": r.revision_no, "reason": r.reason, "created_at": r.created_at.isoformat(), "items": len(r.snapshot)}
            for r in db.query(QuantityRevision).filter_by(project_id=pid).all()]


@router.get("/diff")
def diff(pid: int, a: int, b: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """변경 전(a) vs 변경 후(b 또는 현재) 물량 차이."""
    get_project_or_403(db, user, pid)
    ra = db.query(QuantityRevision).filter_by(project_id=pid, revision_no=a).first()
    if not ra:
        raise HTTPException(404, "리비전이 없습니다.")
    if b:
        rb = db.query(QuantityRevision).filter_by(project_id=pid, revision_no=b).first()
        cur = rb.snapshot if rb else []
    else:
        cur = [{"legend_symbol_id": q.legend_symbol_id, "item_name": q.item_name, "spec": q.spec, "unit": q.unit, "install_type": q.install_type,
                "floor_zone": q.floor_zone, "qty_total": q.qty_total, "drawing_nos": q.drawing_nos} for q in db.query(QuantityItem).filter_by(project_id=pid).all()]

    def key(x):
        return (x["item_name"], x["spec"], x["install_type"], x["floor_zone"])
    A = {key(x): x for x in ra.snapshot}
    B = {key(x): x for x in cur}
    rows = []
    for k in sorted(set(A) | set(B), key=lambda t: str(t)):
        qa = (A.get(k) or {}).get("qty_total") or 0
        qb = (B.get(k) or {}).get("qty_total") or 0
        if qa != qb:
            rows.append({"item_name": k[0], "spec": k[1], "install_type": k[2], "floor_zone": k[3], "before": qa, "after": qb,
                         "increase": max(0, qb - qa), "decrease": max(0, qa - qb),
                         "drawing_nos": (B.get(k) or A.get(k) or {}).get("drawing_nos"), "reason": ""})
    return rows
