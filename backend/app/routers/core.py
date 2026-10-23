"""인증 / 사용자 / 공사 / 대시보드."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..auth import (audit, create_token, get_current_user, get_project_for, hash_password, require_admin, verify_password)
from ..db import get_db
from ..models import AuditLog, ContractVersion, DesignChange, Project, ProjectMember, ProgressClaim, SourceFile, User
from ..schemas import LoginIn, MemberIn, ProjectIn, UserIn, UserOut

router = APIRouter(prefix="/api")


def _user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role, "is_active": u.is_active}


@router.post("/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    u = db.query(User).filter_by(username=form.username).first()
    if not u or not verify_password(form.password, u.password_hash) or not u.is_active:
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
    return {"access_token": create_token(u), "token_type": "bearer", "user": _user_out(u)}


@router.post("/auth/login-json")
def login_json(body: LoginIn, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(username=body.username).first()
    if not u or not verify_password(body.password, u.password_hash) or not u.is_active:
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
    return {"access_token": create_token(u), "token_type": "bearer", "user": _user_out(u)}


@router.get("/auth/me")
def me(user: User = Depends(get_current_user)):
    return _user_out(user)


@router.get("/admin/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return [_user_out(u) for u in db.query(User).order_by(User.id).all()]


@router.post("/admin/users")
def create_user(body: UserIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.query(User).filter_by(username=body.username).first():
        raise HTTPException(400, "이미 존재하는 아이디입니다.")
    u = User(username=body.username, password_hash=hash_password(body.password), display_name=body.display_name, role=body.role)
    db.add(u)
    audit(db, admin, "user.create", target=body.username)
    db.commit()
    return _user_out(u)


@router.put("/admin/users/{uid}")
def update_user(uid: int, body: dict, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404)
    for k in ("display_name", "role", "is_active"):
        if k in body:
            setattr(u, k, body[k])
    if body.get("password"):
        u.password_hash = hash_password(body["password"])
    audit(db, admin, "user.update", target=u.username, after={k: body[k] for k in body if k != "password"})
    db.commit()
    return _user_out(u)


# ---------------------------------------------------------------- projects
def _project_out(p: Project, db: Session) -> dict:
    versions = sorted(p.versions, key=lambda v: v.version_no)
    approved = [v for v in versions if v.status == "approved"]
    cur = (approved[-1] if approved else (versions[-1] if versions else None))
    claims = sorted(p.claims, key=lambda c: c.claim_no)
    confirmed = [c for c in claims if c.status == "confirmed"]
    cum = sum(Decimal(c.totals.get("this_amt", "0") or 0) for c in confirmed)
    contract_total = Decimal(cur.totals.get("tot_amt", "0") or 0) if cur else Decimal(p.contract_amount or 0)
    original = Decimal(versions[0].totals.get("tot_amt", "0") or 0) if versions else Decimal(p.contract_amount or 0)
    changes = db.query(DesignChange).filter_by(project_id=p.id).all()
    return {
        "id": p.id, "name": p.name, "client": p.client, "contractor": p.contractor, "work_type": p.work_type,
        "contract_type": p.contract_type, "contract_amount": str(p.contract_amount or 0),
        "start_date": p.start_date, "end_date": p.end_date, "rounding": p.rounding, "settings": p.settings,
        "created_at": p.created_at.isoformat(),
        "original_amount": str(original), "current_amount": str(contract_total),
        "cum_progress_amount": str(cum), "remaining_amount": str(contract_total - cum),
        "cum_rate": str((cum / contract_total * 100).quantize(Decimal("0.01"))) if contract_total else "0",
        "version_count": len(versions), "current_version": {"id": cur.id, "version_no": cur.version_no, "label": cur.label, "status": cur.status} if cur else None,
        "claim_count": len(claims), "confirmed_claims": len(confirmed),
        "last_claim": {"id": claims[-1].id, "claim_no": claims[-1].claim_no, "status": claims[-1].status} if claims else None,
        "change_count": len(changes), "open_changes": sum(1 for c in changes if c.status != "approved"),
        "file_count": len(p.files),
    }


@router.get("/projects")
def list_projects(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Project)
    if user.role != "admin":
        ids = [m.project_id for m in db.query(ProjectMember).filter_by(user_id=user.id)]
        q = q.filter((Project.created_by == user.id) | (Project.id.in_(ids)))
    return [_project_out(p, db) for p in q.order_by(Project.id.desc()).all()]


@router.post("/projects")
def create_project(body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = Project(name=body.name, client=body.client, contractor=body.contractor, work_type=body.work_type,
                contract_type=body.contract_type, contract_amount=Decimal(str(body.contract_amount or 0)),
                start_date=body.start_date, end_date=body.end_date, rounding=body.rounding or {}, settings=body.settings or {},
                created_by=user.id)
    db.add(p)
    db.flush()
    db.add(ProjectMember(project_id=p.id, user_id=user.id, access="approve"))
    audit(db, user, "project.create", p.id, target=p.name)
    db.commit()
    return _project_out(p, db)


@router.get("/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _project_out(get_project_for(db, pid, user), db)


@router.put("/projects/{pid}")
def update_project(pid: int, body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = get_project_for(db, pid, user, "edit")
    before = {"name": p.name, "contract_amount": str(p.contract_amount)}
    for k in ("name", "client", "contractor", "work_type", "contract_type", "start_date", "end_date"):
        setattr(p, k, getattr(body, k))
    if body.contract_amount is not None:
        p.contract_amount = Decimal(str(body.contract_amount))
    if body.rounding is not None:
        p.rounding = body.rounding
    if body.settings is not None:
        p.settings = body.settings
    audit(db, user, "project.update", p.id, before=before, after={"name": p.name, "contract_amount": str(p.contract_amount)})
    db.commit()
    return _project_out(p, db)


@router.delete("/projects/{pid}")
def delete_project(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = get_project_for(db, pid, user, "approve")
    audit(db, user, "project.delete", p.id, target=p.name)
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.get("/projects/{pid}/members")
def members(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    out = []
    for m in db.query(ProjectMember).filter_by(project_id=pid):
        u = db.get(User, m.user_id)
        out.append({"user_id": m.user_id, "username": u.username if u else "", "display_name": u.display_name if u else "", "access": m.access})
    return out


@router.post("/projects/{pid}/members")
def add_member(pid: int, body: MemberIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user, "approve")
    m = db.query(ProjectMember).filter_by(project_id=pid, user_id=body.user_id).first()
    if m:
        m.access = body.access
    else:
        db.add(ProjectMember(project_id=pid, user_id=body.user_id, access=body.access))
    audit(db, user, "member.set", pid, target=str(body.user_id), after={"access": body.access})
    db.commit()
    return {"ok": True}


@router.delete("/projects/{pid}/members/{uid}")
def remove_member(pid: int, uid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user, "approve")
    db.query(ProjectMember).filter_by(project_id=pid, user_id=uid).delete()
    db.commit()
    return {"ok": True}


@router.get("/projects/{pid}/audit")
def project_audit(pid: int, limit: int = 200, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    rows = db.query(AuditLog).filter_by(project_id=pid).order_by(AuditLog.id.desc()).limit(limit).all()
    users = {u.id: u.username for u in db.query(User).all()}
    return [{"id": a.id, "user": users.get(a.user_id, ""), "action": a.action, "target": a.target, "before": a.before,
             "after": a.after, "reason": a.reason, "at": a.created_at.isoformat()} for a in rows]


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    projects = list_projects(db, user)
    recent_files = db.query(SourceFile).order_by(SourceFile.id.desc()).limit(10).all()
    pids = {p["id"] for p in projects}
    return {
        "projects": projects,
        "recent_files": [{"id": f.id, "project_id": f.project_id, "name": f.original_name, "status": f.status,
                          "purpose": f.purpose, "at": f.uploaded_at.isoformat()} for f in recent_files if f.project_id in pids],
    }
