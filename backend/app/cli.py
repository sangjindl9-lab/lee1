"""관리 명령.

  python -m app.cli init --company "회사명" --admin-login admin --admin-name "관리자"
      → 회사·기본 역할·부서·직책·최초 관리자 생성 (비밀번호는 입력받거나 INIT_ADMIN_PASSWORD 환경변수)
  python -m app.cli seed-demo
      → [데모] 표시가 붙은 샘플 현장·사용자·자재 생성 (실데이터와 구분)
"""
import argparse
import getpass
import os
import sys
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from .db import session_factory
from .models import (BoqGroup, BoqItem, Company, Department, Material, Position, Project, ProjectMember, Role, User,
                     Vendor)
from .permissions import DEFAULT_COMPANY_SETTINGS, DEFAULT_ROLES
from .security import hash_password, validate_password_policy
from .util import round_amount, today_kst


def cmd_init(a):
    db = session_factory()()
    if db.execute(select(Company)).first():
        print("이미 회사가 초기화되어 있습니다. (중복 초기화 방지)")
        return 0 if a.if_empty else 1
    pw = os.environ.get("INIT_ADMIN_PASSWORD") or getpass.getpass("최초 관리자 비밀번호(8자 이상, 영문·숫자 혼합): ")
    try:
        validate_password_policy(pw)
    except Exception as e:  # HTTPException
        print("비밀번호 정책 위반:", getattr(e, "detail", e))
        return 1
    c = Company(name=a.company, settings=dict(DEFAULT_COMPANY_SETTINGS))
    db.add(c)
    db.flush()
    roles = {}
    for code, name, perms in DEFAULT_ROLES:
        r = Role(company_id=c.id, code=code, name=name, permissions=list(perms), is_system=True)
        db.add(r)
        roles[code] = r
    for i, n in enumerate(["경영지원", "공무", "구매", "경리", "현장"]):
        db.add(Department(company_id=c.id, name=n, sort=i))
    for i, n in enumerate(["대표이사", "이사", "부장", "차장", "과장", "대리", "주임", "사원", "현장소장"]):
        db.add(Position(company_id=c.id, name=n, sort=i))
    db.flush()
    u = User(company_id=c.id, login_id=a.admin_login, name=a.admin_name, password_hash=hash_password(pw),
             role_id=roles["admin"].id, must_change_password=not a.no_force_change)
    db.add(u)
    db.commit()
    print(f"초기화 완료: 회사 '{c.name}', 관리자 '{u.login_id}' (첫 로그인 시 비밀번호 변경{'' if u.must_change_password else ' 생략'})")
    return 0


DEMO_PW = "Demo1234!"


def cmd_seed_demo(a):
    db = session_factory()()
    c = db.execute(select(Company)).scalars().first()
    if not c:
        print("먼저 init 을 실행하세요.")
        return 1
    if db.execute(select(Project).where(Project.is_demo.is_(True))).first():
        print("데모 데이터가 이미 있습니다.")
        return 0
    roles = {r.code: r for r in db.execute(select(Role).where(Role.company_id == c.id)).scalars()}
    deps = {d.name: d for d in db.execute(select(Department).where(Department.company_id == c.id)).scalars()}
    poss = {p.name: p for p in db.execute(select(Position).where(Position.company_id == c.id)).scalars()}
    users = {}
    for login, name, role, dep, pos in [
        ("demo_ceo", "[데모]김대표", "executive", "경영지원", "대표이사"),
        ("demo_office", "[데모]이공무", "office", "공무", "과장"),
        ("demo_buyer", "[데모]박구매", "purchase", "구매", "대리"),
        ("demo_site1", "[데모]최소장", "site_manager", "현장", "현장소장"),
        ("demo_staff1", "[데모]정현장", "site_staff", "현장", "사원"),
        ("demo_staff2", "[데모]한현장", "site_staff", "현장", "사원"),
    ]:
        if db.execute(select(User).where(User.login_id == login)).first():
            continue
        u = User(company_id=c.id, login_id=login, name=name, password_hash=hash_password(DEMO_PW), role_id=roles[role].id,
                 department_id=deps[dep].id, position_id=poss[pos].id, must_change_password=False)
        db.add(u)
        users[login] = u
    db.flush()
    t = today_kst()
    p1 = Project(company_id=c.id, code="DEMO-2026-01", name="[데모] OO초등학교 전기·통신 개보수공사", address="경기도 OO시",
                 client="OO교육지원청", supervisor="OO감리단", sector="관급", contract_type="원도급", work_kind="복합",
                 contract_date=t - timedelta(days=40), start_date=t - timedelta(days=30), planned_end_date=t + timedelta(days=60),
                 supply_amount=Decimal("480000000"), vat_amount=Decimal("48000000"), total_amount=Decimal("528000000"),
                 original_supply_amount=Decimal("480000000"), status="진행", is_demo=True,
                 site_manager_id=users["demo_site1"].id, admin_staff_id=users["demo_office"].id)
    p2 = Project(company_id=c.id, code="DEMO-2026-02", name="[데모] OO물류센터 CCTV·방송설비 공사", address="충청남도 OO군",
                 client="(주)OO물류", prime_contractor="OO건설", sector="민간", contract_type="하도급", work_kind="통신",
                 start_date=t - timedelta(days=10), planned_end_date=t + timedelta(days=20),
                 supply_amount=Decimal("120000000"), vat_amount=Decimal("12000000"), total_amount=Decimal("132000000"),
                 original_supply_amount=Decimal("120000000"), status="진행", is_demo=True)
    db.add_all([p1, p2])
    db.flush()
    db.add(ProjectMember(company_id=c.id, project_id=p1.id, user_id=users["demo_staff1"].id, role_in_project="현장 공사"))
    db.add(ProjectMember(company_id=c.id, project_id=p2.id, user_id=users["demo_staff2"].id, role_in_project="현장 공사"))
    db.add(ProjectMember(company_id=c.id, project_id=p2.id, user_id=users["demo_site1"].id, role_in_project="겸임 소장"))
    spec = [
        ("배관", "전선관", [("HI-PVC 전선관", "16C", "m", 1000, 1200, 3500, 0, -30, 20)]),
        ("배선", "전력간선", [("F-CV 케이블", "4C 16SQ", "m", 800, 9800, 5200, 0, -20, 30)]),
        ("분전반", None, [("분전반 설치", "LP-1", "면", 6, 850000, 210000, 0, -5, 25)]),
        ("CCTV", None, [("IP 카메라 설치", "4MP 돔", "대", 24, 180000, 60000, 0, 10, 50)]),
        ("시험·시운전", None, [("절연저항 측정", "", "식", 1, 0, 300000, 0, 50, 58)]),
    ]
    for gi, (g1, g2, items) in enumerate(spec):
        g = BoqGroup(company_id=c.id, project_id=p1.id, level=1, name=g1, sort=gi * 10)
        db.add(g)
        db.flush()
        tgt = g
        if g2:
            tgt = BoqGroup(company_id=c.id, project_id=p1.id, parent_id=g.id, level=2, name=g2, sort=0)
            db.add(tgt)
            db.flush()
        for n, sp, un, q, m, l, e, ds, de in items:
            db.add(BoqItem(company_id=c.id, project_id=p1.id, group_id=tgt.id, name=n, spec=sp, unit=un, design_qty=q,
                           mat_unit_price=m, labor_unit_price=l, exp_unit_price=e,
                           amount=round_amount(Decimal(q) * (Decimal(m) + Decimal(l) + Decimal(e))),
                           plan_start=t + timedelta(days=ds), plan_end=t + timedelta(days=de)))
    v1 = Vendor(company_id=c.id, name="[데모]한빛전선상사", kind="자재업체", phone="031-000-0000")
    v2 = Vendor(company_id=c.id, name="[데모]대성전기자재", kind="자재업체", phone="031-111-1111")
    db.add_all([v1, v2])
    db.flush()
    for code, n, sp, un, pr in [("DEMO-E001", "HI-PVC 전선관", "16C", "m", 1150), ("DEMO-E002", "F-CV 케이블", "4C 16SQ", "m", 9500),
                                ("DEMO-T001", "UTP 케이블", "CAT6", "m", 420)]:
        db.add(Material(company_id=c.id, code=code, name=n, spec=sp, unit=un, ref_price=pr, default_vendor_id=v1.id))
    db.commit()
    print(f"데모 데이터 생성 완료. 데모 계정 비밀번호: {DEMO_PW}  (demo_ceo, demo_office, demo_buyer, demo_site1, demo_staff1, demo_staff2)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init")
    i.add_argument("--company", required=True)
    i.add_argument("--admin-login", default="admin")
    i.add_argument("--admin-name", default="관리자")
    i.add_argument("--no-force-change", action="store_true")
    i.add_argument("--if-empty", action="store_true", help="이미 초기화돼 있으면 조용히 통과 (배포 시작 스크립트용)")
    sub.add_parser("seed-demo")
    a = ap.parse_args(argv)
    return {"init": cmd_init, "seed-demo": cmd_seed_demo}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
