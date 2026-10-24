from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

QTY = Numeric(20, 4)
MONEY = Numeric(22, 4)


def now() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(64), default="")
    role: Mapped[str] = mapped_column(String(16), default="user")  # admin / user / viewer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    client: Mapped[str] = mapped_column(String(255), default="")          # 발주처
    contractor: Mapped[str] = mapped_column(String(255), default="")      # 계약상대자
    work_type: Mapped[str] = mapped_column(String(32), default="전기")     # 전기/정보통신/건축/토목/소방
    contract_type: Mapped[str] = mapped_column(String(32), default="국가계약")  # 국가/지방/민간/하도급
    contract_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    start_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    end_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    rounding: Mapped[dict] = mapped_column(JSON, default=dict)  # {"amount": {"func":"trunc","digits":0}, "qty_digits": 4}
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    files: Mapped[list["SourceFile"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    versions: Mapped[list["ContractVersion"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    claims: Mapped[list["ProgressClaim"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    access: Mapped[str] = mapped_column(String(16), default="edit")  # view / edit / approve


class SourceFile(Base):
    __tablename__ = "source_files"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(512))
    size: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    purpose: Mapped[str] = mapped_column(String(32), default="contract")  # contract / progress_qty / template / change
    status: Mapped[str] = mapped_column(String(16), default="uploaded")  # uploaded / analyzing / analyzed / error
    analysis: Mapped[dict] = mapped_column(JSON, default=dict)   # analyzer 결과(내부 제외)
    error: Mapped[str] = mapped_column(Text, default="")
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    project: Mapped[Project] = relationship(back_populates="files")
    sheets: Mapped[list["WorkbookSheet"]] = relationship(back_populates="file", cascade="all, delete-orphan")


class WorkbookSheet(Base):
    __tablename__ = "workbook_sheets"
    id: Mapped[int] = mapped_column(primary_key=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    index: Mapped[int] = mapped_column(Integer, default=0)
    role: Mapped[str] = mapped_column(String(32), default="unknown")
    role_confidence: Mapped[float] = mapped_column(default=0.0)
    user_role: Mapped[str | None] = mapped_column(String(32), nullable=True)   # 사용자 지정 역할
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    column_map: Mapped[dict] = mapped_column(JSON, default=dict)
    user_column_map: Mapped[dict] = mapped_column(JSON, default=dict)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)

    file: Mapped[SourceFile] = relationship(back_populates="sheets")


class MappingRule(Base):
    """양식별 열 매핑 규칙 저장 (헤더 서명 기준)."""
    __tablename__ = "mapping_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    signature: Mapped[str] = mapped_column(String(64), index=True)   # 헤더 텍스트 해시
    name: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[str] = mapped_column(String(32), default="estimate")
    column_map: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ContractVersion(Base):
    """계약내역 버전: 0=최초계약, n=n차 설계변경 승인본."""
    __tablename__ = "contract_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer, default=0)
    label: Mapped[str] = mapped_column(String(64), default="최초계약")
    source_file_id: Mapped[int | None] = mapped_column(ForeignKey("source_files.id"), nullable=True)
    design_change_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft / approved
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    totals: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    project: Mapped[Project] = relationship(back_populates="versions")
    items: Mapped[list["EstimateItem"]] = relationship(back_populates="version", cascade="all, delete-orphan",
                                                      order_by="EstimateItem.seq")


class EstimateItem(Base):
    __tablename__ = "estimate_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("contract_versions.id", ondelete="CASCADE"), index=True)
    uid: Mapped[str] = mapped_column(String(32), index=True)       # 원본 기준 고유 ID (버전 간 동일 유지)
    seq: Mapped[int] = mapped_column(Integer, default=0)
    row_type: Mapped[str] = mapped_column(String(16), default="item")  # section / item / subtotal
    level: Mapped[int] = mapped_column(Integer, default=1)
    section_path: Mapped[list] = mapped_column(JSON, default=list)
    sheet: Mapped[str] = mapped_column(String(255), default="")
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    work_code: Mapped[str] = mapped_column(String(64), default="")
    item_code: Mapped[str] = mapped_column(String(64), default="")
    code: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(255), default="")
    spec: Mapped[str] = mapped_column(String(255), default="")
    unit: Mapped[str] = mapped_column(String(32), default="")
    qty: Mapped[Decimal | None] = mapped_column(QTY, nullable=True)
    mat_price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    mat_amt: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    lab_price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    lab_amt: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    exp_price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    exp_amt: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    tot_price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    tot_amt: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    note: Mapped[str] = mapped_column(String(255), default="")
    unit_price_ref: Mapped[str] = mapped_column(String(64), default="")   # 일위대가 번호
    price_source: Mapped[dict] = mapped_column(JSON, default=dict)
    cost_region: Mapped[str] = mapped_column(String(16), default="")
    is_new: Mapped[bool] = mapped_column(Boolean, default=False)     # 설계변경 신규 품목
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    issues: Mapped[list] = mapped_column(JSON, default=list)

    version: Mapped[ContractVersion] = relationship(back_populates="items")


class UnitPriceAnalysis(Base):
    __tablename__ = "unit_price_analyses"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_file_id: Mapped[int | None] = mapped_column(ForeignKey("source_files.id"), nullable=True)
    sheet: Mapped[str] = mapped_column(String(255), default="")
    no: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    components: Mapped[list] = mapped_column(JSON, default=list)
    total: Mapped[dict] = mapped_column(JSON, default=dict)
    is_new: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class PriceTable(Base):
    """원본의 자재단가·단가조사·노임·일위대가목록 등 참조 표 (열 라벨 + 행 dict)."""
    __tablename__ = "price_tables"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_file_id: Mapped[int | None] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"), nullable=True)
    sheet: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32), default="material")   # material / labor / unit_price_index / quantity
    title: Mapped[str] = mapped_column(String(255), default="")
    name_key: Mapped[str] = mapped_column(String(8), default="")
    columns: Mapped[list] = mapped_column(JSON, default=list)
    rows: Mapped[list] = mapped_column(JSON, default=list)
    groups: Mapped[list] = mapped_column(JSON, default=list)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class CostRateRule(Base):
    """원가계산서 비목/요율 (버전별)."""
    __tablename__ = "cost_rate_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    version_id: Mapped[int | None] = mapped_column(ForeignKey("contract_versions.id"), nullable=True)
    seq: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16), default="line")
    rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    rate_base: Mapped[str] = mapped_column(String(128), default="")
    base_text: Mapped[str] = mapped_column(String(255), default="")
    amount: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    fixed: Mapped[bool] = mapped_column(Boolean, default=False)   # 정산 비목(변경 시 재계산 제외)
    source: Mapped[str] = mapped_column(String(255), default="")   # 적용 근거/출처
    effective_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    round_digits: Mapped[int | None] = mapped_column(Integer, default=0, nullable=True)    # 비목 금액 절사 자리 (-2 = 백원 절사, None = 절사 없음)
    sheet: Mapped[str] = mapped_column(String(255), default="")      # 원본 원가계산서 시트
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    amount_col: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ProgressClaim(Base):
    __tablename__ = "progress_claims"
    __table_args__ = (UniqueConstraint("project_id", "claim_no"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    claim_no: Mapped[int] = mapped_column(Integer)           # 1,2,3... (0 = 준공정산 아님, is_final 사용)
    title: Mapped[str] = mapped_column(String(64), default="")
    base_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    contract_version_id: Mapped[int] = mapped_column(ForeignKey("contract_versions.id"))
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    is_adjustment: Mapped[bool] = mapped_column(Boolean, default=False)  # 정산/수정 회차 (음수 허용)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft / confirmed
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    input_mode: Mapped[str] = mapped_column(String(16), default="qty")  # qty / cumulative / rate / upload
    totals: Mapped[dict] = mapped_column(JSON, default=dict)
    memo: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    project: Mapped[Project] = relationship(back_populates="claims")
    items: Mapped[list["ProgressItem"]] = relationship(back_populates="claim", cascade="all, delete-orphan")


class ProgressItem(Base):
    __tablename__ = "progress_items"
    __table_args__ = (UniqueConstraint("claim_id", "uid"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("progress_claims.id", ondelete="CASCADE"), index=True)
    uid: Mapped[str] = mapped_column(String(32), index=True)
    this_qty: Mapped[Decimal] = mapped_column(QTY, default=0)        # 금회 수량
    this_mat_amt: Mapped[Decimal] = mapped_column(MONEY, default=0)
    this_lab_amt: Mapped[Decimal] = mapped_column(MONEY, default=0)
    this_exp_amt: Mapped[Decimal] = mapped_column(MONEY, default=0)
    this_tot_amt: Mapped[Decimal] = mapped_column(MONEY, default=0)
    prev_qty: Mapped[Decimal] = mapped_column(QTY, default=0)        # 확정 시점 전회 누계 스냅샷
    prev_tot_amt: Mapped[Decimal] = mapped_column(MONEY, default=0)
    memo: Mapped[str] = mapped_column(String(255), default="")
    override_approved: Mapped[bool] = mapped_column(Boolean, default=False)  # 초과/음수 승인

    claim: Mapped[ProgressClaim] = relationship(back_populates="items")


class DesignChange(Base):
    __tablename__ = "design_changes"
    __table_args__ = (UniqueConstraint("project_id", "change_no"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    change_no: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(128), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    base_version_id: Mapped[int] = mapped_column(ForeignKey("contract_versions.id"))
    result_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft / submitted / approved
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    applied_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    price_rule: Mapped[str] = mapped_column(String(32), default="contract")  # 단가 적용 규칙
    totals: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    items: Mapped[list["DesignChangeItem"]] = relationship(back_populates="change", cascade="all, delete-orphan")


class DesignChangeItem(Base):
    __tablename__ = "design_change_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    change_id: Mapped[int] = mapped_column(ForeignKey("design_changes.id", ondelete="CASCADE"), index=True)
    uid: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(16), default="modify")  # modify / add / delete / move / spec_change
    new_qty: Mapped[Decimal | None] = mapped_column(QTY, nullable=True)
    new_mat_price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    new_lab_price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    new_exp_price: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    price_type: Mapped[str] = mapped_column(String(32), default="contract")  # contract/estimate/negotiated/new_unit_price/user
    price_basis: Mapped[str] = mapped_column(Text, default="")
    new_item: Mapped[dict] = mapped_column(JSON, default=dict)   # 신규 품목 정보 / 규격변경 내용
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    reason: Mapped[str] = mapped_column(String(255), default="")

    change: Mapped[DesignChange] = relationship(back_populates="items")


class ExportTemplate(Base):
    __tablename__ = "export_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(32), default="progress")   # progress / change
    file_path: Mapped[str] = mapped_column(String(512), default="")
    mapping: Mapped[dict] = mapped_column(JSON, default=dict)   # {"sheet":..., "start_row":..., "cols": {...}}
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(128), default="")
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
