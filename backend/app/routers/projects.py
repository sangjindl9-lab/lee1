from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from ..models import BoqItem, Project, ProjectChange, ProjectMember, User
from ..security import Ctx, get_ctx, perm
from ..services.common import audit, bump, check_version, company_settings, row_dict
from ..services.progress import compute_project_progress
from ..util import D, now_kst, round_amount, s, today_kst, vat_of

router = APIRouter(prefix="/api/projects", tags=["projects"])

STATUSES = ["준비", "진행", "중지", "준공", "정산완료"]
AMOUNT_FIELDS = ("supply_amount", "vat_amount", "total_amount", "original_supply_amount")


def project_out(ctx: Ctx, p: Project, detail: bool = False) -> dict:
    d = row_dict(p, exclude=("company_id",))
    if not ctx.has("amount.contract"):
        for k in AMOUNT_FIELDS:
            d[k] = None
    names = {}
    for k in ("site_manager_id", "admin_staff_id"):
        if getattr(p, k):
            u = ctx.db.get(User, getattr(p, k))
            names[k.replace("_id", "_name")] = u.name if u else None
    d.update(names)
    if detail:
        mem = ctx.db.execute(select(ProjectMember, User).join(User, User.id == ProjectMember.user_id)
                             .where(ProjectMember.project_id == p.id)).all()
        d["members"] = [{"user_id": u.id, "name": u.name, "role_in_project": m.role_in_project,
                         "position": u.position.name if u.position else None} for m, u in mem]
    return d


class ProjectIn(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    address: str | None = None
    client: str | None = None
    prime_contractor: str | None = None
    supervisor: str | None = None
    sector: str = Field("민간", pattern="^(관급|민간)$")
    contract_type: str = Field("원도급", pattern="^(원도급|하도급)$")
    work_kind: str = Field("전기", pattern="^(전기|통신|복합)$")
    contract_date: date | None = None
    start_date: date | None = None
    planned_end_date: date | None = None
    actual_end_date: date | None = None
    supply_amount: str | None = "0"
    vat_amount: str | None = None   # 비우면 부가세율로 자동 계산
    site_manager_id: int | None = None
    admin_staff_id: int | None = None
    status: str = "준비"
    note: str | None = None
    progress_method: str = Field("amount", pattern="^(amount|custom)$")
    version: int | None = None


def _validate(ctx: Ctx, body: ProjectIn):
    if body.status not in STATUSES:
        raise HTTPException(400, "공사 상태가 올바르지 않습니다.")
    if body.start_date and body.planned_end_date and body.planned_end_date < body.start_date:
        raise HTTPException(400, "준공예정일이 착공일보다 빠릅니다.")
    for uid in (body.site_manager_id, body.admin_staff_id):
        if uid:
            u = ctx.db.get(User, uid)
            if not u or u.company_id != ctx.company_id:
                raise HTTPException(400, "담당자가 올바르지 않습니다.")


@router.get("")
def list_projects(q: str | None = None, status: str | None = None, include_demo: bool = True, ctx: Ctx = Depends(get_ctx)):
    stmt = select(Project).where(Project.company_id == ctx.company_id, Project.deleted_at.is_(None))
    ids = ctx.project_ids()
    if ids is not None:
        stmt = stmt.where(Project.id.in_(ids or [0]))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Project.name.ilike(like), Project.code.ilike(like), Project.client.ilike(like)))
    if status:
        stmt = stmt.where(Project.status.in_(status.split(",")))
    if not include_demo:
        stmt = stmt.where(Project.is_demo.is_(False))
    rows = ctx.db.execute(stmt.order_by(Project.status, Project.start_date.desc().nulls_last(), Project.id.desc())).scalars().all()
    return [project_out(ctx, p) for p in rows]


@router.post("")
def create_project(body: ProjectIn, ctx: Ctx = Depends(perm("project.create"))):
    _validate(ctx, body)
    if ctx.db.execute(select(Project).where(Project.company_id == ctx.company_id, Project.code == body.code)).first():
        raise HTTPException(409, "이미 사용 중인 공사번호입니다.")
    st = company_settings(ctx.db, ctx.company_id)
    supply = round_amount(D(body.supply_amount), st["amount_rounding"])
    vat = round_amount(D(body.vat_amount), st["amount_rounding"]) if body.vat_amount not in (None, "") \
        else round_amount(supply * D(st["vat_rate"]), st["amount_rounding"])
    data = body.model_dump(exclude={"version", "supply_amount", "vat_amount"})
    p = Project(company_id=ctx.company_id, **data, supply_amount=supply, vat_amount=vat, total_amount=supply + vat,
                original_supply_amount=supply, created_by=ctx.user.id)
    ctx.db.add(p)
    ctx.db.flush()
    audit(ctx, "create", "project", p.id, f"공사 등록: {p.name}", after=row_dict(p), project_id=p.id)
    ctx.db.commit()
    return project_out(ctx, p)


@router.get("/{pid}")
def get_project(pid: int, ctx: Ctx = Depends(get_ctx)):
    p = ctx.project(pid)
    d = project_out(ctx, p, detail=True)
    pr = compute_project_progress(ctx.db, p, today_kst())
    d["progress"] = {"actual_rate": pr["actual_rate"], "plan_rate": pr["plan_rate"], "deviation": pr["deviation"],
                     "basis_date": pr["basis_date"]}
    if ctx.has("amount.contract"):
        d["boq_total"] = s(ctx.db.execute(select(func.coalesce(func.sum(BoqItem.amount), 0)).where(
            BoqItem.project_id == p.id, BoqItem.deleted_at.is_(None))).scalar())
    return d


@router.put("/{pid}")
def update_project(pid: int, body: ProjectIn, ctx: Ctx = Depends(perm("project.edit"))):
    p = ctx.project(pid)
    check_version(p, body.version)
    _validate(ctx, body)
    if body.code != p.code and ctx.db.execute(select(Project).where(
            Project.company_id == ctx.company_id, Project.code == body.code, Project.id != p.id)).first():
        raise HTTPException(409, "이미 사용 중인 공사번호입니다.")
    before = row_dict(p)
    # 계약금액은 '계약변경 등록'으로만 변경 (이력 보존)
    for k, v in body.model_dump(exclude={"version", "supply_amount", "vat_amount"}).items():
        setattr(p, k, v)
    bump(p)
    ctx.db.flush()
    audit(ctx, "update", "project", p.id, f"공사 수정: {p.name}", before=before, after=row_dict(p), project_id=p.id)
    ctx.db.commit()
    return project_out(ctx, p)


@router.delete("/{pid}")
def delete_project(pid: int, ctx: Ctx = Depends(perm("project.delete"))):
    p = ctx.project(pid)
    p.deleted_at = now_kst()
    audit(ctx, "delete", "project", p.id, f"공사 삭제(휴지통): {p.name}", project_id=p.id)
    ctx.db.commit()
    return {"ok": True}


class MemberIn(BaseModel):
    user_id: int
    role_in_project: str | None = None


@router.put("/{pid}/members")
def set_members(pid: int, body: list[MemberIn], ctx: Ctx = Depends(perm("project.edit"))):
    p = ctx.project(pid)
    before = [m.user_id for m in ctx.db.execute(select(ProjectMember).where(ProjectMember.project_id == p.id)).scalars()]
    ctx.db.query(ProjectMember).filter(ProjectMember.project_id == p.id).delete()
    seen = set()
    for m in body:
        u = ctx.db.get(User, m.user_id)
        if not u or u.company_id != ctx.company_id:
            raise HTTPException(400, "참여 직원이 올바르지 않습니다.")
        if u.id in seen:
            continue
        seen.add(u.id)
        ctx.db.add(ProjectMember(company_id=ctx.company_id, project_id=p.id, user_id=u.id, role_in_project=m.role_in_project))
    audit(ctx, "update", "project_members", p.id, f"참여 직원 변경: {p.name}",
          before={"users": before}, after={"users": sorted(seen)}, project_id=p.id)
    ctx.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 계약변경·설계변경 이력
class ChangeIn(BaseModel):
    kind: str = Field(pattern="^(계약변경|설계변경)$")
    change_date: date
    reason: str = Field(min_length=1)
    new_supply_amount: str | None = None   # 계약변경 시 변경 후 공급가액
    amount_delta: str | None = None        # 설계변경 시 증감액(선택)


def _boq_snapshot(ctx: Ctx, pid: int) -> dict:
    items = ctx.db.execute(select(BoqItem).where(BoqItem.project_id == pid, BoqItem.deleted_at.is_(None))).scalars()
    lst = [{"id": i.id, "name": i.name, "spec": i.spec, "unit": i.unit, "design_qty": s(i.design_qty),
            "amount": s(i.amount)} for i in items]
    return {"items": lst, "total": s(sum((D(x["amount"]) for x in lst), Decimal(0)))}


@router.get("/{pid}/changes")
def list_changes(pid: int, ctx: Ctx = Depends(get_ctx)):
    p = ctx.project(pid)
    rows = ctx.db.execute(select(ProjectChange, User.name).outerjoin(User, User.id == ProjectChange.created_by)
                          .where(ProjectChange.project_id == p.id).order_by(ProjectChange.change_date, ProjectChange.id)).all()
    show_amt = ctx.has("amount.contract")
    out = []
    for c, n in rows:
        d = row_dict(c, exclude=("company_id",))
        d["created_by_name"] = n
        if not show_amt:
            d["amount_delta"] = None
            d["before"] = d["after"] = None
        out.append(d)
    return out


@router.post("/{pid}/changes")
def add_change(pid: int, body: ChangeIn, ctx: Ctx = Depends(perm("project.edit"))):
    p = ctx.project(pid)
    st = company_settings(ctx.db, ctx.company_id)
    if body.kind == "계약변경":
        ctx.require("amount.contract")
        if body.new_supply_amount in (None, ""):
            raise HTTPException(400, "변경 후 공급가액을 입력하세요.")
        new_supply = round_amount(D(body.new_supply_amount), st["amount_rounding"])
        new_vat = round_amount(new_supply * D(st["vat_rate"]), st["amount_rounding"])
        before = {"supply_amount": s(p.supply_amount), "vat_amount": s(p.vat_amount), "total_amount": s(p.total_amount)}
        delta = new_supply - Decimal(p.supply_amount)
        p.supply_amount, p.vat_amount, p.total_amount = new_supply, new_vat, new_supply + new_vat
        bump(p)
        after = {"supply_amount": s(new_supply), "vat_amount": s(new_vat), "total_amount": s(new_supply + new_vat)}
    else:
        last = ctx.db.execute(select(ProjectChange).where(ProjectChange.project_id == p.id, ProjectChange.kind == "설계변경")
                              .order_by(ProjectChange.id.desc())).scalars().first()
        before = last.after if last else None
        after = _boq_snapshot(ctx, p.id)
        if body.amount_delta not in (None, ""):
            delta = D(body.amount_delta)
        elif before:
            delta = D(after["total"]) - D(before.get("total"))
        else:
            delta = Decimal(0)
    c = ProjectChange(company_id=ctx.company_id, project_id=p.id, kind=body.kind, change_date=body.change_date,
                      reason=body.reason, amount_delta=delta, before=before, after=after, created_by=ctx.user.id)
    ctx.db.add(c)
    ctx.db.flush()
    audit(ctx, "create", "project_change", c.id, f"{body.kind} 등록: {p.name}", before=before, after=after, project_id=p.id)
    ctx.db.commit()
    return {"id": c.id}
