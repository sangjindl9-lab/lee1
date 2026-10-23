"""계약내역 버전 / 품목 조회·편집 / 원가 비목 / 일위대가."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import audit, get_current_user, get_project_for
from ..db import get_db
from ..models import ContractVersion, CostRateRule, EstimateItem, UnitPriceAnalysis, User
from ..schemas import CostRuleIn, ItemEdit
from ..services.calc import D, line_amounts, project_rounding, s

router = APIRouter(prefix="/api")


def item_out(it: EstimateItem) -> dict:
    return {
        "id": it.id, "uid": it.uid, "seq": it.seq, "row_type": it.row_type, "level": it.level, "section_path": it.section_path,
        "sheet": it.sheet, "source_row": it.source_row, "work_code": it.work_code, "item_code": it.item_code, "code": it.code,
        "name": it.name, "spec": it.spec, "unit": it.unit, "qty": s(it.qty),
        "mat_price": s(it.mat_price), "mat_amt": s(it.mat_amt), "lab_price": s(it.lab_price), "lab_amt": s(it.lab_amt),
        "exp_price": s(it.exp_price), "exp_amt": s(it.exp_amt), "tot_price": s(it.tot_price), "tot_amt": s(it.tot_amt),
        "note": it.note, "unit_price_ref": it.unit_price_ref, "price_source": it.price_source, "cost_region": it.cost_region,
        "is_new": it.is_new, "is_deleted": it.is_deleted, "issues": it.issues,
    }


def version_out(v: ContractVersion) -> dict:
    return {"id": v.id, "project_id": v.project_id, "version_no": v.version_no, "label": v.label, "status": v.status,
            "source_file_id": v.source_file_id, "design_change_id": v.design_change_id, "totals": v.totals,
            "approved_at": v.approved_at.isoformat() if v.approved_at else None, "created_at": v.created_at.isoformat(),
            "item_count": sum(1 for i in v.items if i.row_type == "item")}


def _version(db, vid, user, need="view") -> ContractVersion:
    v = db.get(ContractVersion, vid)
    if not v:
        raise HTTPException(404, "계약내역 버전을 찾을 수 없습니다.")
    get_project_for(db, v.project_id, user, need)
    return v


@router.get("/projects/{pid}/versions")
def list_versions(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    return [version_out(v) for v in db.query(ContractVersion).filter_by(project_id=pid).order_by(ContractVersion.version_no)]


@router.get("/versions/{vid}")
def get_version(vid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return version_out(_version(db, vid, user))


@router.get("/versions/{vid}/items")
def version_items(vid: int, q: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user)
    items = v.items
    if q:
        ql = q.lower()
        items = [i for i in items if i.row_type == "section" or ql in (i.name or "").lower() or ql in (i.spec or "").lower()]
    return {"version": version_out(v), "items": [item_out(i) for i in items]}


@router.put("/versions/{vid}/items/{uid}")
def edit_item(vid: int, uid: str, body: ItemEdit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """draft 버전의 품목 수정 (수량·단가·명칭). 금액은 현장 반올림 규칙으로 재계산."""
    v = _version(db, vid, user, "edit")
    if v.status != "draft":
        raise HTTPException(400, "확정(승인)된 계약내역은 직접 수정할 수 없습니다. 설계변경으로 처리하세요.")
    p = get_project_for(db, v.project_id, user, "edit")
    it = db.query(EstimateItem).filter_by(version_id=vid, uid=uid).first()
    if not it:
        raise HTTPException(404, "품목이 없습니다.")
    before = item_out(it)
    for k in ("name", "spec", "unit", "note"):
        val = getattr(body, k)
        if val is not None:
            setattr(it, k, val)
    for k in ("qty", "mat_price", "lab_price", "exp_price"):
        val = getattr(body, k)
        if val is not None:
            setattr(it, k, Decimal(str(val)))
    if it.row_type == "item":
        am = line_amounts(D(it.qty), it.mat_price, it.lab_price, it.exp_price, project_rounding(p))
        it.mat_amt, it.lab_amt, it.exp_amt = am["mat_amt"], am["lab_amt"], am["exp_amt"]
        it.tot_price = D(it.mat_price) + D(it.lab_price) + D(it.exp_price)
        it.tot_amt = am["tot_amt"]
    _recalc_totals(v)
    audit(db, user, "item.edit", v.project_id, target=f"v{v.version_no}/{it.name}", before=before, after=item_out(it), reason=body.reason)
    db.commit()
    return item_out(it)


def _recalc_totals(v: ContractVersion):
    t = {k: Decimal(0) for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt")}
    for i in v.items:
        if i.row_type == "item" and not i.is_deleted:
            for k in t:
                t[k] += D(getattr(i, k))
    v.totals = {k: str(x) for k, x in t.items()}


@router.post("/versions/{vid}/approve")
def approve_version(vid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user, "approve")
    v.status = "approved"
    v.approved_at = datetime.utcnow()
    audit(db, user, "version.approve", v.project_id, target=f"v{v.version_no} {v.label}")
    db.commit()
    return version_out(v)


@router.delete("/versions/{vid}")
def delete_version(vid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user, "approve")
    if v.status != "draft":
        raise HTTPException(400, "승인된 버전은 삭제할 수 없습니다.")
    audit(db, user, "version.delete", v.project_id, target=f"v{v.version_no}")
    db.delete(v)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 원가 비목
def rule_out(r: CostRateRule) -> dict:
    return {"id": r.id, "version_id": r.version_id, "seq": r.seq, "name": r.name, "kind": r.kind, "rate": s(r.rate),
            "rate_base": r.rate_base, "base_text": r.base_text, "amount": s(r.amount), "fixed": r.fixed,
            "source": r.source, "effective_date": r.effective_date}


@router.get("/projects/{pid}/cost-rules")
def cost_rules(pid: int, version_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    q = db.query(CostRateRule).filter_by(project_id=pid)
    if version_id:
        q = q.filter_by(version_id=version_id)
    return [rule_out(r) for r in q.order_by(CostRateRule.version_id, CostRateRule.seq)]


@router.put("/cost-rules/{rid}")
def update_rule(rid: int, body: CostRuleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(CostRateRule, rid)
    if not r:
        raise HTTPException(404)
    get_project_for(db, r.project_id, user, "edit")
    before = rule_out(r)
    if body.rate is not None:
        r.rate = Decimal(str(body.rate))
    for k in ("rate_base", "fixed", "source", "effective_date"):
        if getattr(body, k) is not None:
            setattr(r, k, getattr(body, k))
    if body.amount is not None:
        r.amount = Decimal(str(body.amount))
    audit(db, user, "cost_rule.update", r.project_id, target=r.name, before=before, after=rule_out(r))
    db.commit()
    return rule_out(r)


@router.get("/projects/{pid}/unit-prices")
def unit_prices(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    return [{"id": u.id, "sheet": u.sheet, "no": u.no, "title": u.title, "components": u.components, "total": u.total, "is_new": u.is_new}
            for u in db.query(UnitPriceAnalysis).filter_by(project_id=pid).order_by(UnitPriceAnalysis.id)]


@router.post("/projects/{pid}/unit-prices")
def create_unit_price(pid: int, body: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """신규 일위대가 작성: components [{name,spec,unit,qty,mat_price,lab_price,exp_price}] → 합계 자동."""
    p = get_project_for(db, pid, user, "edit")
    comps = body.get("components", [])
    rounding = {"amount": {"func": "trunc", "digits": 1}}
    tot = {"mat_amt": Decimal(0), "lab_amt": Decimal(0), "exp_amt": Decimal(0)}
    for c in comps:
        am = line_amounts(D(c.get("qty")), c.get("mat_price"), c.get("lab_price"), c.get("exp_price"), rounding)
        for k in tot:
            tot[k] += am[k]
            c[k] = s(am[k])
    total = {k: s(v.quantize(Decimal(1))) for k, v in tot.items()}
    total["tot_amt"] = s(sum(tot.values()).quantize(Decimal(1)))
    u = UnitPriceAnalysis(project_id=p.id, sheet="신규", no=body.get("no") or f"신규 {db.query(UnitPriceAnalysis).filter_by(project_id=pid, is_new=True).count() + 1}호",
                          title=body.get("title", ""), components=comps, total=total, is_new=True)
    db.add(u)
    audit(db, user, "unit_price.create", p.id, target=u.no, after=total)
    db.commit()
    return {"id": u.id, "no": u.no, "title": u.title, "components": u.components, "total": u.total, "is_new": True}
