"""데이터 모델. 모든 업무 데이터는 company_id 를 가지며 서버에서 회사별로 분리한다."""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON, BigInteger, Boolean, LargeBinary, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
    UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

J = JSON().with_variant(JSONB(), "postgresql")
MONEY = Numeric(18, 0)     # 원 단위 금액
PRICE = Numeric(18, 2)     # 단가
QTY = Numeric(18, 3)       # 수량


def ts():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    biz_no: Mapped[str | None] = mapped_column(String(20))
    ceo_name: Mapped[str | None] = mapped_column(String(50))
    address: Mapped[str | None] = mapped_column(String(300))
    phone: Mapped[str | None] = mapped_column(String(50))
    logo_file_id: Mapped[int | None] = mapped_column(BigInteger)
    seal_file_id: Mapped[int | None] = mapped_column(BigInteger)
    # doc_formats, amount_rounding, vat_rate 등
    settings: Mapped[dict] = mapped_column(J, default=dict)
    created_at: Mapped[datetime] = ts()


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Position(Base):
    __tablename__ = "positions"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("company_id", "code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(100))
    permissions: Mapped[list] = mapped_column(J, default=list)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("company_id", "login_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    login_id: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    password_hash: Mapped[str] = mapped_column(String(255))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    position_id: Mapped[int | None] = mapped_column(ForeignKey("positions.id"))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    extra_permissions: Mapped[list] = mapped_column(J, default=list)
    denied_permissions: Mapped[list] = mapped_column(J, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()

    role: Mapped[Role] = relationship(lazy="joined")
    department: Mapped[Department | None] = relationship(lazy="joined")
    position: Mapped[Position | None] = relationship(lazy="joined")


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = ts()


class DocSequence(Base):
    __tablename__ = "doc_sequences"
    __table_args__ = (UniqueConstraint("company_id", "kind", "period"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    kind: Mapped[str] = mapped_column(String(20))
    period: Mapped[str] = mapped_column(String(10))
    last_no: Mapped[int] = mapped_column(Integer, default=0)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(50))
    entity: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[int | None] = mapped_column(BigInteger)
    project_id: Mapped[int | None] = mapped_column(Integer)
    summary: Mapped[str | None] = mapped_column(String(500))
    before: Mapped[dict | None] = mapped_column(J)
    after: Mapped[dict | None] = mapped_column(J)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = ts()
    __table_args__ = (Index("ix_audit_entity", "company_id", "entity", "entity_id"),)


# ---------------------------------------------------------------- 공사
class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("company_id", "code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(300))
    client: Mapped[str | None] = mapped_column(String(200))           # 발주처
    prime_contractor: Mapped[str | None] = mapped_column(String(200)) # 원도급사
    supervisor: Mapped[str | None] = mapped_column(String(200))       # 감리단
    sector: Mapped[str] = mapped_column(String(10), default="민간")    # 관급/민간
    contract_type: Mapped[str] = mapped_column(String(10), default="원도급")  # 원도급/하도급
    work_kind: Mapped[str] = mapped_column(String(10), default="전기")  # 전기/통신/복합
    contract_date: Mapped[date | None] = mapped_column(Date)
    start_date: Mapped[date | None] = mapped_column(Date)
    planned_end_date: Mapped[date | None] = mapped_column(Date)
    actual_end_date: Mapped[date | None] = mapped_column(Date)
    supply_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    vat_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    original_supply_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    site_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    admin_staff_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), default="준비")  # 준비/진행/중지/준공/정산완료
    note: Mapped[str | None] = mapped_column(Text)
    progress_method: Mapped[str] = mapped_column(String(10), default="amount")  # amount/custom
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role_in_project: Mapped[str | None] = mapped_column(String(50))


class ProjectChange(Base):
    """설계변경·계약변경 이력."""
    __tablename__ = "project_changes"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # 계약변경/설계변경
    change_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(Text)
    amount_delta: Mapped[Decimal] = mapped_column(MONEY, default=0)
    before: Mapped[dict | None] = mapped_column(J)
    after: Mapped[dict | None] = mapped_column(J)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts()


# ---------------------------------------------------------------- 설계내역
class BoqGroup(Base):
    __tablename__ = "boq_groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("boq_groups.id"))
    level: Mapped[int] = mapped_column(Integer, default=1)  # 1=대공종, 2=중공종
    name: Mapped[str] = mapped_column(String(200))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BoqItem(Base):
    __tablename__ = "boq_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("boq_groups.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str | None] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(20))
    design_qty: Mapped[Decimal] = mapped_column(QTY, default=0)
    mat_unit_price: Mapped[Decimal] = mapped_column(PRICE, default=0)
    labor_unit_price: Mapped[Decimal] = mapped_column(PRICE, default=0)
    exp_unit_price: Mapped[Decimal] = mapped_column(PRICE, default=0)
    amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    plan_start: Mapped[date | None] = mapped_column(Date)
    plan_end: Mapped[date | None] = mapped_column(Date)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    include_in_progress: Mapped[bool] = mapped_column(Boolean, default=True)
    custom_weight: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BoqPlan(Base):
    """기간별 계획 누계수량 (공정계획). 없으면 계획기간 균등배분으로 계산."""
    __tablename__ = "boq_plans"
    __table_args__ = (UniqueConstraint("boq_item_id", "plan_date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    boq_item_id: Mapped[int] = mapped_column(ForeignKey("boq_items.id", ondelete="CASCADE"), index=True)
    plan_date: Mapped[date] = mapped_column(Date)
    planned_cum_qty: Mapped[Decimal] = mapped_column(QTY)


# ---------------------------------------------------------------- 작업일보
class DailyReport(Base):
    __tablename__ = "daily_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    report_no: Mapped[str | None] = mapped_column(String(50))
    report_date: Mapped[date] = mapped_column(Date)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    weather: Mapped[str | None] = mapped_column(String(50))
    temp_low: Mapped[str | None] = mapped_column(String(10))
    temp_high: Mapped[str | None] = mapped_column(String(10))
    work_summary: Mapped[str | None] = mapped_column(Text)
    work_location: Mapped[str | None] = mapped_column(String(300))
    safety_education: Mapped[str | None] = mapped_column(Text)
    hazards: Mapped[str | None] = mapped_column(Text)
    safety_actions: Mapped[str | None] = mapped_column(Text)
    delay_reason: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    tomorrow_plan: Mapped[str | None] = mapped_column(Text)
    # draft 작성중 / submitted 제출 / rejected 반려 / approved 승인 / correcting 정정중
    status: Mapped[str] = mapped_column(String(20), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    copied_from_id: Mapped[int | None] = mapped_column(Integer)
    needs_confirm: Mapped[list] = mapped_column(J, default=list)  # 복사 후 확인 필요 섹션
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reject_reason: Mapped[str | None] = mapped_column(Text)
    correction_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    items: Mapped[list["DailyReportItem"]] = relationship(cascade="all, delete-orphan", order_by="DailyReportItem.id")
    labor: Mapped[list["DailyReportLabor"]] = relationship(cascade="all, delete-orphan", order_by="DailyReportLabor.id")
    equipment: Mapped[list["DailyReportEquipment"]] = relationship(cascade="all, delete-orphan", order_by="DailyReportEquipment.id")
    materials: Mapped[list["DailyReportMaterial"]] = relationship(cascade="all, delete-orphan", order_by="DailyReportMaterial.id")


Index("uq_daily_report_project_date", DailyReport.project_id, DailyReport.report_date,
      unique=True, postgresql_where=text("deleted_at IS NULL"))


class DailyReportItem(Base):
    __tablename__ = "daily_report_items"
    __table_args__ = (UniqueConstraint("report_id", "boq_item_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("daily_reports.id", ondelete="CASCADE"), index=True)
    boq_item_id: Mapped[int] = mapped_column(ForeignKey("boq_items.id"))
    qty_today: Mapped[Decimal] = mapped_column(QTY, default=0)
    location: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(String(300))


class DailyReportLabor(Base):
    __tablename__ = "daily_report_labor"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("daily_reports.id", ondelete="CASCADE"), index=True)
    trade: Mapped[str] = mapped_column(String(50))
    affiliation: Mapped[str | None] = mapped_column(String(100))
    headcount: Mapped[Decimal] = mapped_column(Numeric(8, 1), default=0)
    note: Mapped[str | None] = mapped_column(String(200))


class DailyReportEquipment(Base):
    __tablename__ = "daily_report_equipment"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("daily_reports.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(100))
    spec: Mapped[str | None] = mapped_column(String(100))
    count: Mapped[Decimal] = mapped_column(Numeric(8, 1), default=0)
    hours: Mapped[Decimal] = mapped_column(Numeric(8, 1), default=0)
    note: Mapped[str | None] = mapped_column(String(200))


class DailyReportMaterial(Base):
    __tablename__ = "daily_report_materials"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("daily_reports.id", ondelete="CASCADE"), index=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id"))
    name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str | None] = mapped_column(String(200))
    unit: Mapped[str | None] = mapped_column(String(20))
    qty: Mapped[Decimal] = mapped_column(QTY, default=0)
    note: Mapped[str | None] = mapped_column(String(200))


class ProgressEntry(Base):
    """승인 시점에 고정된 시공실적. 공정률은 이 표만 합산한다(중복 방지)."""
    __tablename__ = "progress_entries"
    __table_args__ = (UniqueConstraint("report_id", "boq_item_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    boq_item_id: Mapped[int] = mapped_column(ForeignKey("boq_items.id"), index=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("daily_reports.id"), index=True)
    work_date: Mapped[date] = mapped_column(Date, index=True)
    qty: Mapped[Decimal] = mapped_column(QTY)
    design_qty_at_approval: Mapped[Decimal] = mapped_column(QTY)
    prev_cum_at_approval: Mapped[Decimal] = mapped_column(QTY)
    approved_at: Mapped[datetime] = ts()


class DailyReportRevision(Base):
    """승인본 원문 보존 (정정 이력)."""
    __tablename__ = "daily_report_revisions"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("daily_reports.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(J)
    reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts()


class WorkLog(Base):
    """본사 업무일지."""
    __tablename__ = "work_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    log_date: Mapped[date] = mapped_column(Date)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    task: Mapped[str] = mapped_column(String(300))
    detail: Mapped[str | None] = mapped_column(Text)
    progress_status: Mapped[str] = mapped_column(String(20), default="진행중")
    due_date: Mapped[date | None] = mapped_column(Date)
    follow_up: Mapped[str | None] = mapped_column(Text)
    cooperation: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reject_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()


# ---------------------------------------------------------------- 거래처·자재
class Vendor(Base):
    __tablename__ = "vendors"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="자재업체")
    biz_no: Mapped[str | None] = mapped_column(String(20))
    contact_name: Mapped[str | None] = mapped_column(String(50))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(300))
    note: Mapped[str | None] = mapped_column(Text)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (UniqueConstraint("company_id", "code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str | None] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(20))
    maker: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(100))
    default_vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id"))
    ref_price: Mapped[Decimal] = mapped_column(PRICE, default=0)
    stock_managed: Mapped[bool] = mapped_column(Boolean, default=False)
    min_stock: Mapped[Decimal] = mapped_column(QTY, default=0)
    supply_type: Mapped[str] = mapped_column(String(10), default="사급")  # 관급/사급
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MaterialRequest(Base):
    __tablename__ = "material_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    req_no: Mapped[str] = mapped_column(String(50))
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    req_date: Mapped[date] = mapped_column(Date)
    need_date: Mapped[date | None] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text)
    urgent: Mapped[bool] = mapped_column(Boolean, default=False)
    # draft / in_approval / approved / rejected / closed
    status: Mapped[str] = mapped_column(String(20), default="draft")
    approval_doc_id: Mapped[int | None] = mapped_column(BigInteger)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()
    items: Mapped[list["MaterialRequestItem"]] = relationship(cascade="all, delete-orphan", order_by="MaterialRequestItem.id")


class MaterialRequestItem(Base):
    __tablename__ = "material_request_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("material_requests.id", ondelete="CASCADE"), index=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id"))
    name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str | None] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(20))
    qty: Mapped[Decimal] = mapped_column(QTY)
    boq_item_id: Mapped[int | None] = mapped_column(ForeignKey("boq_items.id"))
    use_location: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(String(300))


class Quote(Base):
    __tablename__ = "quotes"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("material_requests.id"), index=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("vendors.id"))
    quote_date: Mapped[date | None] = mapped_column(Date)
    delivery_date: Mapped[date | None] = mapped_column(Date)
    freight: Mapped[Decimal] = mapped_column(MONEY, default=0)
    payment_terms: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(Text)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    select_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = ts()
    items: Mapped[list["QuoteItem"]] = relationship(cascade="all, delete-orphan", order_by="QuoteItem.id")


class QuoteItem(Base):
    __tablename__ = "quote_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("quotes.id", ondelete="CASCADE"), index=True)
    request_item_id: Mapped[int] = mapped_column(ForeignKey("material_request_items.id"))
    unit_price: Mapped[Decimal] = mapped_column(PRICE, default=0)
    amount: Mapped[Decimal] = mapped_column(MONEY, default=0)


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    po_no: Mapped[str] = mapped_column(String(50))
    vendor_id: Mapped[int] = mapped_column(ForeignKey("vendors.id"))
    request_id: Mapped[int | None] = mapped_column(ForeignKey("material_requests.id"))
    quote_id: Mapped[int | None] = mapped_column(ForeignKey("quotes.id"))
    order_date: Mapped[date] = mapped_column(Date)
    delivery_date: Mapped[date | None] = mapped_column(Date)
    delivery_place: Mapped[str | None] = mapped_column(String(300))
    receiver_name: Mapped[str | None] = mapped_column(String(100))
    payment_terms: Mapped[str | None] = mapped_column(String(200))
    remarks: Mapped[str | None] = mapped_column(Text)
    # draft / in_approval / rejected / ordered(확정) / partial(부분입고) / received(입고완료) / cancelled
    status: Mapped[str] = mapped_column(String(20), default="draft")
    supply_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    vat_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    approval_doc_id: Mapped[int | None] = mapped_column(BigInteger)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    send_status: Mapped[str] = mapped_column(String(20), default="미발송")  # 외부 연동 전: 미발송 고정
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()
    items: Mapped[list["PurchaseOrderItem"]] = relationship(cascade="all, delete-orphan", order_by="PurchaseOrderItem.id")


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True)
    request_item_id: Mapped[int | None] = mapped_column(ForeignKey("material_request_items.id"), index=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id"))
    name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str | None] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(20))
    qty: Mapped[Decimal] = mapped_column(QTY)
    unit_price: Mapped[Decimal] = mapped_column(PRICE, default=0)
    supply_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    vat_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    cancelled_qty: Mapped[Decimal] = mapped_column(QTY, default=0)
    received_qty: Mapped[Decimal] = mapped_column(QTY, default=0)   # 입고 누계(반품 차감 전)
    returned_qty: Mapped[Decimal] = mapped_column(QTY, default=0)   # 반품 누계


class Receipt(Base):
    """입고/반품 전표. 입고량 집계는 PurchaseOrderItem 의 누계 컬럼과 동일 트랜잭션에서 갱신."""
    __tablename__ = "receipts"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    receipt_no: Mapped[str] = mapped_column(String(50))
    kind: Mapped[str] = mapped_column(String(10), default="입고")  # 입고/반품
    receipt_date: Mapped[date] = mapped_column(Date)
    received_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
    request_key: Mapped[str] = mapped_column(String(64), unique=True)  # 중복 요청 방지 키
    created_at: Mapped[datetime] = ts()
    items: Mapped[list["ReceiptItem"]] = relationship(cascade="all, delete-orphan")


class ReceiptItem(Base):
    __tablename__ = "receipt_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("receipts.id", ondelete="CASCADE"), index=True)
    po_item_id: Mapped[int] = mapped_column(ForeignKey("purchase_order_items.id"), index=True)
    qty: Mapped[Decimal] = mapped_column(QTY)


# ---------------------------------------------------------------- 전자결재
class ApprovalLineTemplate(Base):
    __tablename__ = "approval_line_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    doc_type: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(100))
    min_amount: Mapped[Decimal | None] = mapped_column(MONEY)
    max_amount: Mapped[Decimal | None] = mapped_column(MONEY)
    steps: Mapped[list] = mapped_column(J, default=list)  # [{user_id, kind}]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ApprovalDoc(Base):
    __tablename__ = "approval_docs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), index=True)
    doc_type: Mapped[str] = mapped_column(String(30))  # material_request / purchase_order / general
    ref_id: Mapped[int | None] = mapped_column(BigInteger)
    doc_no: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal | None] = mapped_column(MONEY)
    # draft / in_progress / approved / rejected / withdrawn
    status: Mapped[str] = mapped_column(String(20), default="draft")
    drafter_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    content_snapshot: Mapped[dict | None] = mapped_column(J)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    round: Mapped[int] = mapped_column(Integer, default=1)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = ts()
    steps: Mapped[list["ApprovalStep"]] = relationship(cascade="all, delete-orphan", order_by="ApprovalStep.seq")


class ApprovalStep(Base):
    __tablename__ = "approval_steps"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    doc_id: Mapped[int] = mapped_column(ForeignKey("approval_docs.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))  # 결재/합의/참조
    approver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="waiting")  # waiting/pending/approved/rejected/reference
    comment: Mapped[str | None] = mapped_column(Text)
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApprovalHistory(Base):
    __tablename__ = "approval_history"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    doc_id: Mapped[int] = mapped_column(ForeignKey("approval_docs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(20))
    comment: Mapped[str | None] = mapped_column(Text)
    round: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = ts()


# ---------------------------------------------------------------- 파일·사진
class FileObject(Base):
    __tablename__ = "files"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), index=True)
    owner_type: Mapped[str] = mapped_column(String(30))  # project/daily_report/material_request/quote/po/approval/material/company
    owner_id: Mapped[int | None] = mapped_column(BigInteger)
    category: Mapped[str] = mapped_column(String(30), default="첨부")  # 사진/계약서/도면/내역서/시방서/견적서/...
    original_name: Mapped[str] = mapped_column(String(300))
    stored_path: Mapped[str] = mapped_column(String(500))
    thumb_path: Mapped[str | None] = mapped_column(String(500))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    # 사진 분류
    taken_date: Mapped[date | None] = mapped_column(Date)
    work_type: Mapped[str | None] = mapped_column(String(100))
    location: Mapped[str | None] = mapped_column(String(200))
    phase: Mapped[str | None] = mapped_column(String(10))  # 작업전/작업중/작업후
    title: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_files_owner", "company_id", "owner_type", "owner_id"),)


class FileBlob(Base):
    """FILE_STORAGE_MODE=db 일 때 파일 원본 보관 (key = stored_path / thumb_path)."""
    __tablename__ = "file_blobs"
    key: Mapped[str] = mapped_column(String(500), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = ts()


# ---------------------------------------------------------------- 공지·알림
class Notice(Base):
    __tablename__ = "notices"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = ts()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(300))
    link: Mapped[str | None] = mapped_column(String(300))
    channel: Mapped[str] = mapped_column(String(20), default="app")  # app / (email, sms 확장)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts()


class ImportJob(Base):
    """엑셀 업로드 미리보기 → 반영 사이의 임시 보관."""
    __tablename__ = "import_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(20))  # boq / material
    project_id: Mapped[int | None] = mapped_column(Integer)
    headers: Mapped[list] = mapped_column(J)
    rows: Mapped[list] = mapped_column(J)
    status: Mapped[str] = mapped_column(String(20), default="preview")
    created_at: Mapped[datetime] = ts()
