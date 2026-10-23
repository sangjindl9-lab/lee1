from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..auth import audit, create_token, current_user, hash_password, verify_password
from ..db import get_db
from ..models import Company, Role, User
from ..schemas import LoginOut, RegisterIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role.value,
            "company_id": u.company_id, "company": u.company.name if u.company else None}


@router.post("/register", response_model=LoginOut)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    """회사 + 첫 사용자(회사관리자) 생성. 기존 회사명이면 가입 불가(관리자가 초대)."""
    if db.query(User).filter_by(email=body.email).first():
        raise HTTPException(400, "이미 등록된 이메일입니다.")
    comp = db.query(Company).filter_by(name=body.company_name).first()
    if comp:
        raise HTTPException(400, "이미 등록된 회사입니다. 회사관리자에게 계정 생성을 요청하십시오.")
    comp = Company(name=body.company_name)
    db.add(comp)
    db.flush()
    first = db.query(User).count() == 0
    u = User(company_id=comp.id, email=body.email, name=body.name, password_hash=hash_password(body.password),
             role=Role.superadmin if first else Role.company_admin)
    db.add(u)
    db.flush()
    audit(db, u, "register", company=comp.name)
    db.commit()
    return LoginOut(access_token=create_token(u), user=_user_out(u))


@router.post("/login", response_model=LoginOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    u = db.query(User).filter_by(email=form.username).first()
    if not u or not verify_password(form.password, u.password_hash):
        raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다.")
    if not u.is_active:
        raise HTTPException(403, "비활성 계정입니다.")
    audit(db, u, "login")
    db.commit()
    return LoginOut(access_token=create_token(u), user=_user_out(u))


@router.get("/me")
def me(user: User = Depends(current_user)):
    return _user_out(user)


@router.post("/users")
def create_user(body: RegisterIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """회사관리자가 같은 회사 사용자 추가. company_name 필드는 role 로 사용(estimator|reviewer|viewer)."""
    if user.role not in (Role.superadmin, Role.company_admin):
        raise HTTPException(403, "회사관리자만 사용자를 추가할 수 있습니다.")
    if db.query(User).filter_by(email=body.email).first():
        raise HTTPException(400, "이미 등록된 이메일입니다.")
    try:
        role = Role(body.company_name)
    except ValueError:
        role = Role.estimator
    if role == Role.superadmin and user.role != Role.superadmin:
        raise HTTPException(403, "최고관리자는 생성할 수 없습니다.")
    u = User(company_id=user.company_id, email=body.email, name=body.name,
             password_hash=hash_password(body.password), role=role)
    db.add(u)
    audit(db, user, "create_user", email=body.email, role=role.value)
    db.commit()
    return _user_out(u)
