"""설계변경 API."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import audit, get_current_user, get_project_for
from ..config import settings
from ..db import get_db
from ..excel.export_change import write_change_workbook
from ..models import ContractVersion, DesignChange, DesignChangeItem, User
from ..schemas import ChangeIn, ChangeItemIn
from ..services.design_change import PRICE_TYPES, approve_change, compute_change

router = APIRouter(prefix="/api")


def change_out(dc: DesignChange) -> dict:
    return {"id": dc.id, "project_id": dc.project_id, "change_no": dc.change_no, "title": dc.title or f"{dc.change_no}차 설계변경",
            "reason": dc.reason, "base_version_id": dc.base_version_id, "result_version_id": dc.result_version_id,
            "status": dc.status, "approved_at": dc.approved_at.isoformat() if dc.approved_at else None,
            "applied_date": dc.applied_date, "price_rule": dc.price_rule, "totals": dc.totals, "item_count": len(dc.items),
            "created_at": dc.created_at.isoformat()}


def _dc(db, cid, user, need="view") -> DesignChange:
    dc = db.get(DesignChange, cid)
    if not dc:
        raise HTTPException(404, "설계변경을 찾을 수 없습니다.")
    get_project_for(db, dc.project_id, user, need)
    return dc


@router.get("/price-types")
def price_types():
    return [{"code": k, "label": v} for k, v in PRICE_TYPES.items()]


@router.get("/projects/{pid}/changes")
def list_changes(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    return [change_out(c) for c in db.query(DesignChange).filter_by(project_id=pid).order_by(DesignChange.change_no)]


@router.post("/projects/{pid}/changes")
def create_change(pid: int, body: ChangeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = get_project_for(db, pid, user, "edit")
    versions = db.query(ContractVersion).filter_by(project_id=pid).order_by(ContractVersion.version_no).all()
    if not versions:
        raise HTTPException(400, "먼저 계약내역서를 가져오기 하세요.")
    open_dc = db.query(DesignChange).filter_by(project_id=pid).filter(DesignChange.status != "approved").first()
    if open_dc:
        raise HTTPException(400, f"진행 중인 설계변경({open_dc.change_no}차)을 먼저 승인하거나 삭제하세요.")
    base = db.get(ContractVersion, body.base_version_id) if body.base_version_id else ([v for v in versions if v.status == "approved"] or versions)[-1]
    if base.status != "approved":
        base.status = "approved"
        base.approved_at = datetime.utcnow()
        audit(db, user, "version.approve", pid, target=f"v{base.version_no} (설계변경 기준으로 자동 확정)")
    last = db.query(DesignChange).filter_by(project_id=pid).order_by(DesignChange.change_no.desc()).first()
    dc = DesignChange(project_id=pid, change_no=(last.change_no + 1) if last else 1, title=body.title, reason=body.reason,
                      base_version_id=base.id, price_rule=body.price_rule, applied_date=body.applied_date)
    db.add(dc)
    audit(db, user, "change.create", pid, target=f"{dc.change_no}차", after={"base_version": base.version_no})
    db.commit()
    return change_out(dc)


@router.get("/changes/{cid}")
def get_change(cid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    dc = _dc(db, cid, user)
    p = get_project_for(db, dc.project_id, user)
    lines, summary = compute_change(db, p, dc)
    return {"change": change_out(dc), "summary": summary, "lines": [l.as_dict() for l in lines]}


@router.put("/changes/{cid}")
def update_change(cid: int, body: ChangeIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    dc = _dc(db, cid, user, "edit")
    if dc.status == "approved":
        raise HTTPException(400, "승인된 설계변경은 수정할 수 없습니다.")
    dc.title, dc.reason, dc.price_rule, dc.applied_date = body.title, body.reason, body.price_rule, body.applied_date
    db.commit()
    return change_out(dc)


@router.put("/changes/{cid}/items")
def put_items(cid: int, items: list[ChangeItemIn], db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """변경 항목 일괄 저장 (uid 기준 upsert, 신규는 new_item 필수). action=reset 이면 해당 uid 변경 취소."""
    dc = _dc(db, cid, user, "edit")
    if dc.status == "approved":
        raise HTTPException(400, "승인된 설계변경은 수정할 수 없습니다.")
    existing = {ci.uid: ci for ci in dc.items if ci.action != "add"}
    new_existing = {ci.uid: ci for ci in dc.items if ci.action == "add"}
    for it in items:
        if it.action == "reset" and it.uid:
            for store in (existing, new_existing):
                if it.uid in store:
                    obj = store.pop(it.uid)
                    dc.items.remove(obj)
                    db.delete(obj)
            continue
        if it.action == "add":
            if not it.new_item or not it.new_item.get("name"):
                raise HTTPException(400, "신규 품목은 품명이 필요합니다.")
            uid = it.uid or f"new{int(datetime.utcnow().timestamp()*1000) % 10**9}{len(new_existing)}"
            ci = new_existing.get(uid)
            if ci is None:
                ci = DesignChangeItem(change_id=dc.id, uid=uid, action="add")
                dc.items.append(ci)
            new_existing[uid] = ci
        else:
            if not it.uid:
                raise HTTPException(400, "uid 가 필요합니다.")
            ci = existing.get(it.uid)
            if ci is None:
                ci = DesignChangeItem(change_id=dc.id, uid=it.uid)
                dc.items.append(ci)
            existing[it.uid] = ci
            ci.action = it.action
        ci.new_qty = Decimal(str(it.new_qty)) if it.new_qty is not None else None
        ci.new_mat_price = Decimal(str(it.new_mat_price)) if it.new_mat_price is not None else None
        ci.new_lab_price = Decimal(str(it.new_lab_price)) if it.new_lab_price is not None else None
        ci.new_exp_price = Decimal(str(it.new_exp_price)) if it.new_exp_price is not None else None
        ci.price_type, ci.price_basis, ci.reason = it.price_type, it.price_basis, it.reason
        if it.new_item is not None:
            ci.new_item = it.new_item
    audit(db, user, "change.items", dc.project_id, target=f"{dc.change_no}차", after={"count": len(items)})
    db.commit()
    db.refresh(dc)
    p = get_project_for(db, dc.project_id, user)
    lines, summary = compute_change(db, p, dc)
    dc.totals = {k: v for k, v in summary.items() if k in ("orig", "chg", "diff", "counts")}
    db.commit()
    return {"change": change_out(dc), "summary": summary, "lines": [l.as_dict() for l in lines]}


@router.post("/changes/{cid}/approve")
def approve(cid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    dc = _dc(db, cid, user, "approve")
    p = get_project_for(db, dc.project_id, user, "approve")
    try:
        nv = approve_change(db, p, dc, user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit(db, user, "change.approve", p.id, target=f"{dc.change_no}차 → v{nv.version_no}", after=nv.totals)
    db.commit()
    return {"change": change_out(dc), "version": {"id": nv.id, "version_no": nv.version_no, "label": nv.label, "totals": nv.totals}}


@router.delete("/changes/{cid}")
def delete_change(cid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    dc = _dc(db, cid, user, "approve")
    if dc.status == "approved":
        raise HTTPException(400, "승인된 설계변경은 삭제할 수 없습니다.")
    audit(db, user, "change.delete", dc.project_id, target=f"{dc.change_no}차")
    db.delete(dc)
    db.commit()
    return {"ok": True}


@router.get("/changes/{cid}/export")
def export_change(cid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    dc = _dc(db, cid, user)
    p = get_project_for(db, dc.project_id, user)
    lines, summary = compute_change(db, p, dc)
    out_dir = settings.storage_dir / f"project_{p.id}" / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{p.name[:20]}_{dc.change_no}차설계변경_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    write_change_workbook(out, p, dc, lines, summary)
    audit(db, user, "change.export", p.id, target=f"{dc.change_no}차", after={"file": out.name})
    db.commit()
    return FileResponse(out, filename=out.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
