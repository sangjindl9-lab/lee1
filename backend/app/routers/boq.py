from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..models import BoqGroup, BoqItem, BoqPlan, ProgressEntry, User
from ..permissions import SAMPLE_WORK_TYPES
from ..security import Ctx, get_ctx, perm
from ..services.common import audit, bump, check_version, company_settings, row_dict
from ..services.progress import compute_project_progress
from ..util import D, now_kst, q_price, q_qty, round_amount, s, today_kst

router = APIRouter(prefix="/api/projects/{pid}/boq", tags=["boq"])
PRICE_FIELDS = ("mat_unit_price", "labor_unit_price", "exp_unit_price", "amount")


def item_out(ctx: Ctx, it: BoqItem) -> dict:
    d = row_dict(it, exclude=("company_id",))
    if not ctx.has("amount.contract"):
        for k in PRICE_FIELDS:
            d[k] = None
    return d


@router.get("")
def get_boq(pid: int, ctx: Ctx = Depends(get_ctx)):
    p = ctx.project(pid)
    groups = ctx.db.execute(select(BoqGroup).where(BoqGroup.project_id == p.id, BoqGroup.deleted_at.is_(None))
                            .order_by(BoqGroup.level, BoqGroup.sort, BoqGroup.id)).scalars().all()
    items = ctx.db.execute(select(BoqItem).where(BoqItem.project_id == p.id, BoqItem.deleted_at.is_(None))
                           .order_by(BoqItem.sort, BoqItem.id)).scalars().all()
    plans = ctx.db.execute(select(BoqPlan).where(BoqPlan.boq_item_id.in_([i.id for i in items] or [0]))
                           .order_by(BoqPlan.plan_date)).scalars().all()
    pm: dict[int, list] = {}
    for pl in plans:
        pm.setdefault(pl.boq_item_id, []).append({"plan_date": pl.plan_date.isoformat(), "planned_cum_qty": s(pl.planned_cum_qty)})
    users = {u.id: u.name for u in ctx.db.execute(select(User).where(User.company_id == ctx.company_id)).scalars()}
    out_items = []
    for i in items:
        d = item_out(ctx, i)
        d["plans"] = pm.get(i.id, [])
        d["assignee_name"] = users.get(i.assignee_id)
        out_items.append(d)
    return {
        "progress_method": p.progress_method,
        "show_amounts": ctx.has("amount.contract"),
        "groups": [{"id": g.id, "parent_id": g.parent_id, "level": g.level, "name": g.name, "sort": g.sort} for g in groups],
        "items": out_items,
    }


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: int | None = None
    sort: int = 0


def _group(ctx: Ctx, pid: int, gid: int) -> BoqGroup:
    g = ctx.db.get(BoqGroup, gid)
    if not g or g.project_id != pid or g.company_id != ctx.company_id or g.deleted_at:
        raise HTTPException(404, "공종을 찾을 수 없습니다.")
    return g


@router.post("/groups")
def add_group(pid: int, body: GroupIn, ctx: Ctx = Depends(perm("boq.edit"))):
    p = ctx.project(pid)
    level = 1
    if body.parent_id:
        parent = _group(ctx, p.id, body.parent_id)
        if parent.level != 1:
            raise HTTPException(400, "중공종 아래에는 공종을 추가할 수 없습니다(대공종>중공종>세부항목).")
        level = 2
    g = BoqGroup(company_id=ctx.company_id, project_id=p.id, parent_id=body.parent_id, level=level, name=body.name, sort=body.sort)
    ctx.db.add(g)
    ctx.db.flush()
    audit(ctx, "create", "boq_group", g.id, f"공종 추가: {g.name}", project_id=p.id)
    ctx.db.commit()
    return {"id": g.id}


@router.put("/groups/{gid}")
def upd_group(pid: int, gid: int, body: GroupIn, ctx: Ctx = Depends(perm("boq.edit"))):
    p = ctx.project(pid)
    g = _group(ctx, p.id, gid)
    before = {"name": g.name, "sort": g.sort}
    g.name, g.sort = body.name, body.sort
    audit(ctx, "update", "boq_group", g.id, f"공종 수정: {g.name}", before=before, after={"name": g.name, "sort": g.sort}, project_id=p.id)
    ctx.db.commit()
    return {"ok": True}


@router.delete("/groups/{gid}")
def del_group(pid: int, gid: int, ctx: Ctx = Depends(perm("boq.edit"))):
    p = ctx.project(pid)
    g = _group(ctx, p.id, gid)
    has_child = ctx.db.execute(select(BoqGroup.id).where(BoqGroup.parent_id == g.id, BoqGroup.deleted_at.is_(None))).first()
    has_item = ctx.db.execute(select(BoqItem.id).where(BoqItem.group_id == g.id, BoqItem.deleted_at.is_(None))).first()
    if has_child or has_item:
        raise HTTPException(409, "하위 공종이나 세부항목이 있는 공종은 삭제할 수 없습니다.")
    g.deleted_at = now_kst()
    audit(ctx, "delete", "boq_group", g.id, f"공종 삭제: {g.name}", project_id=p.id)
    ctx.db.commit()
    return {"ok": True}


@router.post("/sample")
def add_sample(pid: int, ctx: Ctx = Depends(perm("boq.edit"))):
    """전기·통신 공종 샘플(대공종)만 추가. 사용자가 자유롭게 수정·삭제 가능."""
    p = ctx.project(pid)
    exists = ctx.db.execute(select(BoqGroup.id).where(BoqGroup.project_id == p.id, BoqGroup.deleted_at.is_(None))).first()
    if exists:
        raise HTTPException(409, "이미 공종이 있습니다. 샘플은 빈 내역에만 추가할 수 있습니다.")
    for i, n in enumerate(SAMPLE_WORK_TYPES):
        ctx.db.add(BoqGroup(company_id=ctx.company_id, project_id=p.id, level=1, name=n, sort=(i + 1) * 10))
    audit(ctx, "create", "boq_group", None, "공종 샘플 추가", project_id=p.id)
    ctx.db.commit()
    return {"ok": True}


class ItemIn(BaseModel):
    group_id: int
    name: str = Field(min_length=1, max_length=200)
    spec: str | None = None
    unit: str = Field(min_length=1, max_length=20)
    design_qty: str = "0"
    mat_unit_price: str | None = None
    labor_unit_price: str | None = None
    exp_unit_price: str | None = None
    plan_start: date | None = None
    plan_end: date | None = None
    assignee_id: int | None = None
    include_in_progress: bool = True
    custom_weight: str | None = None
    sort: int = 0
    version: int | None = None


def apply_item(ctx: Ctx, it: BoqItem, body: ItemIn, rounding: str):
    g = _group(ctx, it.project_id, body.group_id)
    if body.plan_start and body.plan_end and body.plan_end < body.plan_start:
        raise HTTPException(400, f"[{body.name}] 계획 종료일이 시작일보다 빠릅니다.")
    qty = q_qty(body.design_qty)
    if qty < 0:
        raise HTTPException(400, f"[{body.name}] 설계수량은 0 이상이어야 합니다.")
    it.group_id = g.id
    it.name, it.spec, it.unit, it.design_qty = body.name, body.spec, body.unit.strip(), qty
    it.plan_start, it.plan_end, it.assignee_id = body.plan_start, body.plan_end, body.assignee_id
    it.include_in_progress, it.sort = body.include_in_progress, body.sort
    it.custom_weight = D(body.custom_weight) if body.custom_weight not in (None, "") else None
    if ctx.has("amount.contract"):
        it.mat_unit_price = q_price(body.mat_unit_price or 0)
        it.labor_unit_price = q_price(body.labor_unit_price or 0)
        it.exp_unit_price = q_price(body.exp_unit_price or 0)
    unit_sum = Decimal(it.mat_unit_price or 0) + Decimal(it.labor_unit_price or 0) + Decimal(it.exp_unit_price or 0)
    it.amount = round_amount(qty * unit_sum, rounding)


@router.post("/items")
def add_item(pid: int, body: ItemIn, ctx: Ctx = Depends(perm("boq.edit"))):
    p = ctx.project(pid)
    it = BoqItem(company_id=ctx.company_id, project_id=p.id)
    apply_item(ctx, it, body, company_settings(ctx.db, ctx.company_id)["amount_rounding"])
    ctx.db.add(it)
    ctx.db.flush()
    audit(ctx, "create", "boq_item", it.id, f"세부항목 추가: {it.name}", after=row_dict(it), project_id=p.id)
    ctx.db.commit()
    return item_out(ctx, it)


def _item(ctx: Ctx, pid: int, iid: int) -> BoqItem:
    it = ctx.db.get(BoqItem, iid)
    if not it or it.project_id != pid or it.company_id != ctx.company_id or it.deleted_at:
        raise HTTPException(404, "세부항목을 찾을 수 없습니다.")
    return it


@router.put("/items/{iid}")
def upd_item(pid: int, iid: int, body: ItemIn, ctx: Ctx = Depends(perm("boq.edit"))):
    p = ctx.project(pid)
    it = _item(ctx, p.id, iid)
    check_version(it, body.version)
    before = row_dict(it)
    apply_item(ctx, it, body, company_settings(ctx.db, ctx.company_id)["amount_rounding"])
    bump(it)
    ctx.db.flush()
    audit(ctx, "update", "boq_item", it.id, f"세부항목 수정: {it.name}", before=before, after=row_dict(it), project_id=p.id)
    ctx.db.commit()
    return item_out(ctx, it)


@router.delete("/items/{iid}")
def del_item(pid: int, iid: int, ctx: Ctx = Depends(perm("boq.edit"))):
    p = ctx.project(pid)
    it = _item(ctx, p.id, iid)
    used = ctx.db.execute(select(func.count()).select_from(ProgressEntry).where(ProgressEntry.boq_item_id == it.id)).scalar()
    if used:
        raise HTTPException(409, "승인된 시공실적이 있는 항목은 삭제할 수 없습니다. '공정률 반영'을 해제하거나 설계변경으로 처리하세요.")
    it.deleted_at = now_kst()
    audit(ctx, "delete", "boq_item", it.id, f"세부항목 삭제(휴지통): {it.name}", project_id=p.id)
    ctx.db.commit()
    return {"ok": True}


class PlanIn(BaseModel):
    plan_date: date
    planned_cum_qty: str


@router.put("/items/{iid}/plans")
def set_plans(pid: int, iid: int, body: list[PlanIn], ctx: Ctx = Depends(perm("boq.edit"))):
    p = ctx.project(pid)
    it = _item(ctx, p.id, iid)
    seen = set()
    last = Decimal(-1)
    for pl in sorted(body, key=lambda x: x.plan_date):
        if pl.plan_date in seen:
            raise HTTPException(400, f"계획일 중복: {pl.plan_date}")
        seen.add(pl.plan_date)
        q = q_qty(pl.planned_cum_qty)
        if q < last:
            raise HTTPException(400, "계획 누계수량은 날짜순으로 감소할 수 없습니다.")
        last = q
    ctx.db.query(BoqPlan).filter(BoqPlan.boq_item_id == it.id).delete()
    for pl in body:
        ctx.db.add(BoqPlan(company_id=ctx.company_id, boq_item_id=it.id, plan_date=pl.plan_date, planned_cum_qty=q_qty(pl.planned_cum_qty)))
    audit(ctx, "update", "boq_plan", it.id, f"공정계획 변경: {it.name}", after={"plans": [x.model_dump() for x in body]}, project_id=p.id)
    ctx.db.commit()
    return {"ok": True}


@router.get("/progress")
def progress(pid: int, basis: date | None = None, ctx: Ctx = Depends(get_ctx)):
    p = ctx.project(pid)
    r = compute_project_progress(ctx.db, p, basis or today_kst())
    if not ctx.has("amount.contract") and p.progress_method == "amount":
        for i in r["items"]:
            i["weight"] = None  # 금액 비노출, 비율만 표시
    # 간트용 실적 시작/종료일
    rows = ctx.db.execute(select(ProgressEntry.boq_item_id, func.min(ProgressEntry.work_date), func.max(ProgressEntry.work_date))
                          .where(ProgressEntry.project_id == p.id, ProgressEntry.qty != 0)
                          .group_by(ProgressEntry.boq_item_id)).all()
    span = {a: (b.isoformat(), c.isoformat()) for a, b, c in rows}
    for i in r["items"]:
        i["actual_start"], i["actual_end"] = span.get(i["id"], (None, None))
    return r


@router.get("/progress-series")
def progress_series(pid: int, unit: str = "week", ctx: Ctx = Depends(get_ctx)):
    """주간/월간 계획·실적 공정률 추이."""
    from datetime import timedelta
    p = ctx.project(pid)
    start = p.start_date or today_kst()
    end = max(p.planned_end_date or today_kst(), today_kst())
    pts = []
    d = start
    step = timedelta(days=7)
    guard = 0
    while d <= end and guard < 200:
        r = compute_project_progress(ctx.db, p, d)
        pts.append({"date": d.isoformat(), "plan": r["plan_rate"], "actual": r["actual_rate"] if d <= today_kst() else None})
        guard += 1
        if unit == "month":
            d = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        else:
            d = d + step
    return pts
