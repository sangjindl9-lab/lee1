import secrets
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (ApprovalLineTemplate, AuditLog, BoqItem, Company, DailyReport, Department, FileObject, Material,
                      Position, Project, Role, User, UserSession, Vendor)
from ..permissions import DOC_TYPES, PERMISSIONS
from ..security import Ctx, get_ctx, hash_password, perm, validate_password_policy
from ..services.common import audit, company_settings, row_dict
from ..util import D, s

router = APIRouter(prefix="/api", tags=["admin"])


def user_out(u: User) -> dict:
    return {
        "id": u.id, "login_id": u.login_id, "name": u.name, "email": u.email, "phone": u.phone,
        "department_id": u.department_id, "department": u.department.name if u.department else None,
        "position_id": u.position_id, "position": u.position.name if u.position else None,
        "role_id": u.role_id, "role": u.role.name, "is_active": u.is_active,
        "extra_permissions": u.extra_permissions or [], "denied_permissions": u.denied_permissions or [],
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "locked": bool(u.locked_until),
    }


# ---------------------------------------------------------------- 조회용(모든 로그인 사용자)
@router.get("/lookup/users")
def lookup_users(ctx: Ctx = Depends(get_ctx)):
    rows = ctx.db.execute(select(User).where(User.company_id == ctx.company_id, User.is_active.is_(True))
                          .order_by(User.name)).scalars().all()
    return [{"id": u.id, "name": u.name, "department": u.department.name if u.department else None,
             "position": u.position.name if u.position else None} for u in rows]


@router.get("/lookup/codes")
def lookup_codes(ctx: Ctx = Depends(get_ctx)):
    db = ctx.db
    st = company_settings(db, ctx.company_id)
    return {
        "departments": [{"id": d.id, "name": d.name} for d in db.execute(select(Department).where(
            Department.company_id == ctx.company_id, Department.is_active.is_(True)).order_by(Department.sort)).scalars()],
        "positions": [{"id": p.id, "name": p.name} for p in db.execute(select(Position).where(
            Position.company_id == ctx.company_id, Position.is_active.is_(True)).order_by(Position.sort)).scalars()],
        "trades": st["trades"], "weather_options": st["weather_options"], "photo_phases": st["photo_phases"],
        "doc_types": DOC_TYPES,
    }


# ---------------------------------------------------------------- 사용자
class UserIn(BaseModel):
    login_id: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=50)
    email: str | None = None
    phone: str | None = None
    department_id: int | None = None
    position_id: int | None = None
    role_id: int
    password: str = Field(min_length=8, max_length=200)
    extra_permissions: list[str] = []
    denied_permissions: list[str] = []


class UserUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    email: str | None = None
    phone: str | None = None
    department_id: int | None = None
    position_id: int | None = None
    role_id: int
    is_active: bool = True
    extra_permissions: list[str] = []
    denied_permissions: list[str] = []


def _check_refs(ctx: Ctx, role_id, dept_id, pos_id, perms_lists):
    r = ctx.db.get(Role, role_id)
    if not r or r.company_id != ctx.company_id:
        raise HTTPException(400, "역할이 올바르지 않습니다.")
    for model, i in ((Department, dept_id), (Position, pos_id)):
        if i is not None:
            o = ctx.db.get(model, i)
            if not o or o.company_id != ctx.company_id:
                raise HTTPException(400, "부서 또는 직책이 올바르지 않습니다.")
    for lst in perms_lists:
        bad = [p for p in lst if p not in PERMISSIONS]
        if bad:
            raise HTTPException(400, f"알 수 없는 권한: {bad}")


@router.get("/admin/users")
def list_users(ctx: Ctx = Depends(perm("admin.users"))):
    rows = ctx.db.execute(select(User).where(User.company_id == ctx.company_id).order_by(User.is_active.desc(), User.name)).scalars()
    return [user_out(u) for u in rows]


@router.post("/admin/users")
def create_user(body: UserIn, ctx: Ctx = Depends(perm("admin.users"))):
    _check_refs(ctx, body.role_id, body.department_id, body.position_id, [body.extra_permissions, body.denied_permissions])
    validate_password_policy(body.password)
    if ctx.db.execute(select(User).where(User.login_id == body.login_id)).first():
        raise HTTPException(409, "이미 사용 중인 아이디입니다.")
    u = User(company_id=ctx.company_id, login_id=body.login_id, name=body.name, email=body.email, phone=body.phone,
             department_id=body.department_id, position_id=body.position_id, role_id=body.role_id,
             password_hash=hash_password(body.password), must_change_password=True,
             extra_permissions=body.extra_permissions, denied_permissions=body.denied_permissions)
    ctx.db.add(u)
    ctx.db.flush()
    audit(ctx, "create", "user", u.id, f"사용자 생성: {u.name}({u.login_id})")
    ctx.db.commit()
    ctx.db.refresh(u)
    return user_out(u)


@router.put("/admin/users/{uid}")
def update_user(uid: int, body: UserUpdate, ctx: Ctx = Depends(perm("admin.users"))):
    u = ctx.db.get(User, uid)
    if not u or u.company_id != ctx.company_id:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")
    _check_refs(ctx, body.role_id, body.department_id, body.position_id, [body.extra_permissions, body.denied_permissions])
    if u.id == ctx.user.id and (not body.is_active or body.role_id != u.role_id):
        raise HTTPException(400, "본인 계정의 역할 변경·비활성화는 다른 관리자가 해야 합니다.")
    before = user_out(u)
    for k, v in body.model_dump().items():
        setattr(u, k, v)
    if not body.is_active:
        ctx.db.query(UserSession).filter(UserSession.user_id == u.id).delete()
    ctx.db.flush()
    ctx.db.refresh(u)
    audit(ctx, "update", "user", u.id, f"사용자 수정: {u.name}", before=before, after=user_out(u))
    ctx.db.commit()
    return user_out(u)


@router.post("/admin/users/{uid}/reset-password")
def reset_password(uid: int, ctx: Ctx = Depends(perm("admin.users"))):
    u = ctx.db.get(User, uid)
    if not u or u.company_id != ctx.company_id:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")
    temp = "Tmp-" + secrets.token_urlsafe(7)
    u.password_hash = hash_password(temp)
    u.must_change_password = True
    u.failed_logins, u.locked_until = 0, None
    ctx.db.query(UserSession).filter(UserSession.user_id == u.id).delete()
    audit(ctx, "reset_password", "user", u.id, f"비밀번호 초기화: {u.name}")
    ctx.db.commit()
    return {"temporary_password": temp, "notice": "임시 비밀번호는 지금 한 번만 표시됩니다. 첫 로그인 시 변경해야 합니다."}


# ---------------------------------------------------------------- 역할·권한
@router.get("/admin/roles")
def list_roles(ctx: Ctx = Depends(perm("admin.users"))):
    rows = ctx.db.execute(select(Role).where(Role.company_id == ctx.company_id).order_by(Role.id)).scalars()
    return {"roles": [{"id": r.id, "code": r.code, "name": r.name, "permissions": r.permissions, "is_system": r.is_system}
                      for r in rows], "catalog": PERMISSIONS}


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str | None = Field(default=None, pattern=r"^[a-z0-9_]+$")
    permissions: list[str]


@router.post("/admin/roles")
def create_role(body: RoleIn, ctx: Ctx = Depends(perm("admin.users"))):
    if not body.code:
        raise HTTPException(400, "역할 코드를 입력하세요(영문 소문자·숫자·_).")
    _check_refs_perm(body.permissions)
    r = Role(company_id=ctx.company_id, code=body.code, name=body.name, permissions=body.permissions)
    ctx.db.add(r)
    ctx.db.flush()
    audit(ctx, "create", "role", r.id, f"역할 생성: {r.name}", after={"permissions": body.permissions})
    ctx.db.commit()
    return {"id": r.id}


def _check_refs_perm(perms: list[str]):
    bad = [p for p in perms if p not in PERMISSIONS]
    if bad:
        raise HTTPException(400, f"알 수 없는 권한: {bad}")


@router.put("/admin/roles/{rid}")
def update_role(rid: int, body: RoleIn, ctx: Ctx = Depends(perm("admin.users"))):
    r = ctx.db.get(Role, rid)
    if not r or r.company_id != ctx.company_id:
        raise HTTPException(404, "역할을 찾을 수 없습니다.")
    _check_refs_perm(body.permissions)
    if r.code == "admin" and not {"admin.users", "admin.settings"} <= set(body.permissions):
        raise HTTPException(400, "시스템 관리자 역할에서 관리자 권한을 제거할 수 없습니다.")
    before = {"name": r.name, "permissions": r.permissions}
    r.name, r.permissions = body.name, body.permissions
    audit(ctx, "update", "role", r.id, f"역할 권한 변경: {r.name}", before=before, after=body.model_dump())
    ctx.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 부서·직책
class CodeIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort: int = 0
    is_active: bool = True


def _code_model(kind: str):
    if kind == "departments":
        return Department
    if kind == "positions":
        return Position
    raise HTTPException(404, "알 수 없는 코드")


@router.get("/admin/codes/{kind}")
def list_codes(kind: str, ctx: Ctx = Depends(perm("admin.settings"))):
    m = _code_model(kind)
    return [{"id": o.id, "name": o.name, "sort": o.sort, "is_active": o.is_active}
            for o in ctx.db.execute(select(m).where(m.company_id == ctx.company_id).order_by(m.sort, m.id)).scalars()]


@router.post("/admin/codes/{kind}")
def add_code(kind: str, body: CodeIn, ctx: Ctx = Depends(perm("admin.settings"))):
    m = _code_model(kind)
    o = m(company_id=ctx.company_id, **body.model_dump())
    ctx.db.add(o)
    ctx.db.flush()
    audit(ctx, "create", kind, o.id, f"코드 추가: {o.name}")
    ctx.db.commit()
    return {"id": o.id}


@router.put("/admin/codes/{kind}/{cid}")
def upd_code(kind: str, cid: int, body: CodeIn, ctx: Ctx = Depends(perm("admin.settings"))):
    m = _code_model(kind)
    o = ctx.db.get(m, cid)
    if not o or o.company_id != ctx.company_id:
        raise HTTPException(404, "코드를 찾을 수 없습니다.")
    for k, v in body.model_dump().items():
        setattr(o, k, v)
    audit(ctx, "update", kind, o.id, f"코드 수정: {o.name}")
    ctx.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 회사 설정
class CompanyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    biz_no: str | None = None
    ceo_name: str | None = None
    address: str | None = None
    phone: str | None = None
    logo_file_id: int | None = None
    seal_file_id: int | None = None
    doc_formats: dict[str, str] = {}
    amount_rounding: str = Field(default="floor", pattern="^(floor|half_up)$")
    vat_rate: str = "0.1"
    trades: list[str] = []
    weather_options: list[str] = []
    photo_phases: list[str] = []


@router.get("/admin/company")
def get_company(ctx: Ctx = Depends(get_ctx)):
    c = ctx.db.get(Company, ctx.company_id)
    st = company_settings(ctx.db, ctx.company_id)
    return {"name": c.name, "biz_no": c.biz_no, "ceo_name": c.ceo_name, "address": c.address, "phone": c.phone,
            "logo_file_id": c.logo_file_id, "seal_file_id": c.seal_file_id, **st}


@router.put("/admin/company")
def put_company(body: CompanyIn, ctx: Ctx = Depends(perm("admin.settings"))):
    c = ctx.db.get(Company, ctx.company_id)
    for fid in (body.logo_file_id, body.seal_file_id):
        if fid:
            f = ctx.db.get(FileObject, fid)
            if not f or f.company_id != ctx.company_id or not f.mime.startswith("image/"):
                raise HTTPException(400, "로고·직인은 업로드한 이미지 파일이어야 합니다.")
    try:
        vr = D(body.vat_rate)
        assert Decimal(0) <= vr < Decimal(1)
    except Exception:
        raise HTTPException(400, "부가세율은 0~1 사이 소수로 입력하세요(예: 0.1).")
    for k, fmt in body.doc_formats.items():
        if k not in ("MR", "PO", "RC", "DR", "AP"):
            raise HTTPException(400, f"알 수 없는 문서번호 종류: {k}")
        if k != "DR" and "{SEQ" not in fmt:
            raise HTTPException(400, f"{k} 문서번호 형식에는 일련번호 {{SEQ:n}} 가 필요합니다.")
    before = {"name": c.name, "settings": c.settings}
    c.name, c.biz_no, c.ceo_name, c.address, c.phone = body.name, body.biz_no, body.ceo_name, body.address, body.phone
    c.logo_file_id, c.seal_file_id = body.logo_file_id, body.seal_file_id
    newst = dict(c.settings or {})
    newst.update({"doc_formats": body.doc_formats, "amount_rounding": body.amount_rounding, "vat_rate": s(vr)})
    for k in ("trades", "weather_options", "photo_phases"):
        v = [x.strip() for x in getattr(body, k) if x.strip()]
        if v:
            newst[k] = v
    c.settings = newst
    audit(ctx, "update", "company", c.id, "회사 설정 변경", before=before, after={"name": c.name, "settings": newst})
    ctx.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 결재선
class StepIn(BaseModel):
    user_id: int
    kind: str = Field(pattern="^(결재|합의|참조)$")


class LineIn(BaseModel):
    doc_type: str
    name: str = Field(min_length=1, max_length=100)
    min_amount: str | None = None
    max_amount: str | None = None
    steps: list[StepIn]
    is_active: bool = True


def _line_out(t: ApprovalLineTemplate) -> dict:
    return {"id": t.id, "doc_type": t.doc_type, "doc_type_label": DOC_TYPES.get(t.doc_type), "name": t.name,
            "min_amount": s(t.min_amount), "max_amount": s(t.max_amount), "steps": t.steps, "is_active": t.is_active}


@router.get("/approval-lines")
def list_lines(doc_type: str | None = None, ctx: Ctx = Depends(get_ctx)):
    q = select(ApprovalLineTemplate).where(ApprovalLineTemplate.company_id == ctx.company_id)
    if doc_type:
        q = q.where(ApprovalLineTemplate.doc_type == doc_type)
    return [_line_out(t) for t in ctx.db.execute(q.order_by(ApprovalLineTemplate.doc_type, ApprovalLineTemplate.min_amount)).scalars()]


def _apply_line(ctx: Ctx, t: ApprovalLineTemplate, body: LineIn):
    if body.doc_type not in DOC_TYPES:
        raise HTTPException(400, "알 수 없는 문서 종류")
    for st in body.steps:
        u = ctx.db.get(User, st.user_id)
        if not u or u.company_id != ctx.company_id:
            raise HTTPException(400, "결재선 사용자가 올바르지 않습니다.")
    if not any(st.kind != "참조" for st in body.steps):
        raise HTTPException(400, "결재 또는 합의 단계가 최소 1명 필요합니다.")
    t.doc_type, t.name, t.is_active = body.doc_type, body.name, body.is_active
    t.min_amount = D(body.min_amount) if body.min_amount not in (None, "") else None
    t.max_amount = D(body.max_amount) if body.max_amount not in (None, "") else None
    t.steps = [st.model_dump() for st in body.steps]


@router.post("/approval-lines")
def add_line(body: LineIn, ctx: Ctx = Depends(perm("admin.settings"))):
    t = ApprovalLineTemplate(company_id=ctx.company_id)
    _apply_line(ctx, t, body)
    ctx.db.add(t)
    ctx.db.flush()
    audit(ctx, "create", "approval_line", t.id, f"결재선 생성: {t.name}", after=_line_out(t))
    ctx.db.commit()
    return _line_out(t)


@router.put("/approval-lines/{tid}")
def upd_line(tid: int, body: LineIn, ctx: Ctx = Depends(perm("admin.settings"))):
    t = ctx.db.get(ApprovalLineTemplate, tid)
    if not t or t.company_id != ctx.company_id:
        raise HTTPException(404, "결재선을 찾을 수 없습니다.")
    before = _line_out(t)
    _apply_line(ctx, t, body)
    audit(ctx, "update", "approval_line", t.id, f"결재선 수정: {t.name}", before=before, after=_line_out(t))
    ctx.db.commit()
    return _line_out(t)


# ---------------------------------------------------------------- 휴지통·감사로그
TRASH = {"project": (Project, "name"), "boq_item": (BoqItem, "name"), "file": (FileObject, "original_name"),
         "material": (Material, "name"), "vendor": (Vendor, "name"), "daily_report": (DailyReport, "report_date")}


@router.get("/admin/trash")
def trash(ctx: Ctx = Depends(perm("admin.trash"))):
    out = []
    for kind, (m, label) in TRASH.items():
        for o in ctx.db.execute(select(m).where(m.company_id == ctx.company_id, m.deleted_at.is_not(None))
                                .order_by(m.deleted_at.desc()).limit(200)).scalars():
            out.append({"kind": kind, "id": o.id, "label": str(getattr(o, label)), "deleted_at": o.deleted_at.isoformat()})
    return sorted(out, key=lambda x: x["deleted_at"], reverse=True)


@router.post("/admin/trash/{kind}/{oid}/restore")
def restore(kind: str, oid: int, ctx: Ctx = Depends(perm("admin.trash"))):
    if kind not in TRASH:
        raise HTTPException(404, "알 수 없는 종류")
    m = TRASH[kind][0]
    o = ctx.db.get(m, oid)
    if not o or o.company_id != ctx.company_id or not o.deleted_at:
        raise HTTPException(404, "복구할 자료가 없습니다.")
    if kind == "daily_report":
        dup = ctx.db.execute(select(DailyReport).where(DailyReport.project_id == o.project_id,
                             DailyReport.report_date == o.report_date, DailyReport.deleted_at.is_(None))).first()
        if dup:
            raise HTTPException(409, "같은 날짜의 일보가 이미 있어 복구할 수 없습니다.")
    o.deleted_at = None
    audit(ctx, "restore", kind, oid, f"휴지통 복구: {kind} {oid}")
    ctx.db.commit()
    return {"ok": True}


@router.get("/admin/audit")
def audit_list(entity: str | None = None, entity_id: int | None = None, project_id: int | None = None,
               limit: int = Query(200, le=1000), ctx: Ctx = Depends(perm("audit.view"))):
    q = select(AuditLog, User.name).outerjoin(User, User.id == AuditLog.user_id).where(AuditLog.company_id == ctx.company_id)
    if entity:
        q = q.where(AuditLog.entity == entity)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    if project_id:
        q = q.where(AuditLog.project_id == project_id)
    rows = ctx.db.execute(q.order_by(AuditLog.id.desc()).limit(limit)).all()
    return [{"id": a.id, "at": a.created_at.isoformat(), "user": n, "action": a.action, "entity": a.entity,
             "entity_id": a.entity_id, "summary": a.summary, "before": a.before, "after": a.after, "ip": a.ip}
            for a, n in rows]
