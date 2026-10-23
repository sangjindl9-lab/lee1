"""핵심 데이터 구조 (요청서 14장). 모든 물량은 파일→시트→범례→검출객체→규칙으로 역추적된다."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.utcnow()


class Role(str, enum.Enum):
    superadmin = "superadmin"   # 최고관리자
    company_admin = "company_admin"  # 회사관리자
    estimator = "estimator"     # 적산 담당자
    reviewer = "reviewer"       # 검토자
    viewer = "viewer"           # 조회 사용자


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    biz_no: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.estimator)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    company: Mapped[Company] = relationship()


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(300))          # 공사명
    client: Mapped[str | None] = mapped_column(String(200))  # 발주처
    location: Mapped[str | None] = mapped_column(String(300))
    work_type: Mapped[str | None] = mapped_column(String(100))  # 공사 종류
    start_date: Mapped[str | None] = mapped_column(String(10))
    end_date: Mapped[str | None] = mapped_column(String(10))
    author: Mapped[str | None] = mapped_column(String(100))
    reviewer: Mapped[str | None] = mapped_column(String(100))
    # 프로젝트별 산출 설정(5-5): 천장고·층고·여장·할증 등. 근거 없으면 null = 미확정
    takeoff_settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    files: Mapped[list[DrawingFile]] = relationship(back_populates="project", cascade="all, delete-orphan")


class FileStatus(str, enum.Enum):
    uploaded = "uploaded"
    queued = "queued"
    processing = "processing"
    done = "done"
    failed = "failed"
    needs_converter = "needs_converter"  # DWG인데 변환기 미설정


class DrawingFile(Base):
    __tablename__ = "drawing_files"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    original_name: Mapped[str] = mapped_column(String(300))
    stored_path: Mapped[str] = mapped_column(String(500))   # 원본 (불변)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))  # dxf|dwg|pdf|image|xlsx
    status: Mapped[FileStatus] = mapped_column(Enum(FileStatus), default=FileStatus.uploaded)
    error: Mapped[str | None] = mapped_column(Text)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    warnings: Mapped[list] = mapped_column(JSON, default=list)  # XREF 누락, 미지원 객체 등
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    project: Mapped[Project] = relationship(back_populates="files")
    revisions: Mapped[list[DrawingRevision]] = relationship(back_populates="file", cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("project_id", "sha256", name="uq_project_file_hash"),)


class DrawingRevision(Base):
    __tablename__ = "drawing_revisions"
    id: Mapped[int] = mapped_column(primary_key=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("drawing_files.id"), index=True)
    rev_no: Mapped[str] = mapped_column(String(20), default="0")
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    file: Mapped[DrawingFile] = relationship(back_populates="revisions")
    sheets: Mapped[list[DrawingSheet]] = relationship(back_populates="revision", cascade="all, delete-orphan")


class DrawingSheet(Base):
    """DXF의 모델공간/레이아웃, PDF의 페이지 1장 = 시트 1개."""
    __tablename__ = "drawing_sheets"
    id: Mapped[int] = mapped_column(primary_key=True)
    revision_id: Mapped[int] = mapped_column(ForeignKey("drawing_revisions.id"), index=True)
    page_no: Mapped[int] = mapped_column(Integer, default=1)
    sheet_name: Mapped[str | None] = mapped_column(String(200))
    drawing_no: Mapped[str | None] = mapped_column(String(100))   # 도면번호(자동 추출 or 사용자 입력)
    drawing_title: Mapped[str | None] = mapped_column(String(300))
    drawing_type: Mapped[str | None] = mapped_column(String(50))  # 평면도|계통도|범례|일람표|...
    discipline: Mapped[str | None] = mapped_column(String(50))    # 전기|정보통신|...
    floor_zone: Mapped[str | None] = mapped_column(String(100))   # 층·구역
    source_kind: Mapped[str] = mapped_column(String(10))          # dxf|pdf_vector|pdf_raster|pdf_mixed|image
    units: Mapped[str | None] = mapped_column(String(10))         # mm|cm|m|unknown
    scale_factor: Mapped[float | None] = mapped_column(Float)     # 도면단위 1 → 실제 m. 미확정 = null
    scale_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    bbox: Mapped[dict | None] = mapped_column(JSON)               # 도면 좌표계 경계
    geometry_path: Mapped[str | None] = mapped_column(String(500))  # 처리본(JSON 지오메트리)
    raster_path: Mapped[str | None] = mapped_column(String(500))    # PDF/이미지 렌더 PNG
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[DrawingRevision] = relationship(back_populates="sheets")
    layers: Mapped[list[CADLayer]] = relationship(back_populates="sheet", cascade="all, delete-orphan")


class CADLayer(Base):
    __tablename__ = "cad_layers"
    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("drawing_sheets.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    color: Mapped[int | None] = mapped_column(Integer)
    entity_count: Mapped[int] = mapped_column(Integer, default=0)
    discipline_guess: Mapped[str | None] = mapped_column(String(50))
    sheet: Mapped[DrawingSheet] = relationship(back_populates="layers")


class LegendTable(Base):
    __tablename__ = "legend_tables"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    sheet_id: Mapped[int | None] = mapped_column(ForeignKey("drawing_sheets.id"))
    title: Mapped[str | None] = mapped_column(String(200))
    region: Mapped[dict | None] = mapped_column(JSON)   # {x0,y0,x1,y1} 도면 좌표
    source: Mapped[str] = mapped_column(String(20), default="auto")  # auto|manual
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    symbols: Mapped[list[LegendSymbol]] = relationship(back_populates="table", cascade="all, delete-orphan")


class SymbolStatus(str, enum.Enum):
    auto = "auto"               # 자동 검출
    approved = "approved"       # 사용자 승인
    edited = "edited"           # 사용자 수정
    unresolved = "unresolved"   # 미확인(품명/규격 불명)


class LegendSymbol(Base):
    """범례 한 행 = 기호 1개 ↔ 품명·규격·단위."""
    __tablename__ = "legend_symbols"
    id: Mapped[int] = mapped_column(primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("legend_tables.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    row_no: Mapped[int] = mapped_column(Integer, default=0)
    symbol_name: Mapped[str | None] = mapped_column(String(100))   # 기호명(텍스트 라벨)
    block_name: Mapped[str | None] = mapped_column(String(200))    # CAD 블록명
    fingerprint: Mapped[dict | None] = mapped_column(JSON)          # 기하 지문(폭발 블록/벡터PDF 매칭용)
    image_path: Mapped[str | None] = mapped_column(String(500))     # 기호 이미지 크롭
    item_name: Mapped[str | None] = mapped_column(String(200))      # 품명
    spec: Mapped[str | None] = mapped_column(String(300))           # 규격
    unit: Mapped[str | None] = mapped_column(String(20))            # 단위
    discipline: Mapped[str | None] = mapped_column(String(50))      # 공종
    category: Mapped[str] = mapped_column(String(20), default="device")  # device|conduit|cable|tray
    layer_hint: Mapped[str | None] = mapped_column(String(200))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[SymbolStatus] = mapped_column(Enum(SymbolStatus), default=SymbolStatus.auto)
    region: Mapped[dict | None] = mapped_column(JSON)   # 범례 안의 기호 위치(산출 제외 영역)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)  # 케이블 회선수, 심수 등
    table: Mapped[LegendTable] = relationship(back_populates="symbols")


class SymbolMapping(Base):
    """회사 공통 범례 라이브러리 (승인된 범례를 저장). 프로젝트 범례가 우선."""
    __tablename__ = "symbol_mappings"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    block_name: Mapped[str | None] = mapped_column(String(200), index=True)
    symbol_name: Mapped[str | None] = mapped_column(String(100))
    fingerprint: Mapped[dict | None] = mapped_column(JSON)
    item_name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str | None] = mapped_column(String(300))
    unit: Mapped[str | None] = mapped_column(String(20))
    discipline: Mapped[str | None] = mapped_column(String(50))
    category: Mapped[str] = mapped_column(String(20), default="device")
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class DetectedEntity(Base):
    """시트에서 추출된 원시 CAD/PDF 객체 요약 (뷰어·근거용). 대량이므로 핵심 필드만."""
    __tablename__ = "detected_entities"
    id: Mapped[int] = mapped_column(primary_key=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("drawing_sheets.id"), index=True)
    handle: Mapped[str | None] = mapped_column(String(40), index=True)
    etype: Mapped[str] = mapped_column(String(30))
    layer: Mapped[str | None] = mapped_column(String(200))
    block_name: Mapped[str | None] = mapped_column(String(200), index=True)
    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    rotation: Mapped[float | None] = mapped_column(Float)
    scale: Mapped[float | None] = mapped_column(Float)
    text: Mapped[str | None] = mapped_column(Text)
    length: Mapped[float | None] = mapped_column(Float)   # 도면 단위
    bbox: Mapped[dict | None] = mapped_column(JSON)
    attrs: Mapped[dict | None] = mapped_column(JSON)


class DetectStatus(str, enum.Enum):
    auto = "auto"            # 자동 검출
    verified = "verified"    # 사용자 검증 완료
    edited = "edited"        # 사용자 수정 완료
    review = "review"        # 추가 검토 필요
    excluded = "excluded"    # 사용자 제외
    manual = "manual"        # 사용자 수동 추가


class DetectedSymbol(Base):
    """기구 1개 검출 = 수량 1 (근거 ID 보유)."""
    __tablename__ = "detected_symbols"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("drawing_sheets.id"), index=True)
    legend_symbol_id: Mapped[int | None] = mapped_column(ForeignKey("legend_symbols.id"), index=True)
    entity_handle: Mapped[str | None] = mapped_column(String(40))
    method: Mapped[str] = mapped_column(String(30))   # block|fingerprint|text|vision|manual
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    bbox: Mapped[dict | None] = mapped_column(JSON)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    seq_no: Mapped[int] = mapped_column(Integer, default=0)  # 도면 위 자동 번호
    status: Mapped[DetectStatus] = mapped_column(Enum(DetectStatus), default=DetectStatus.auto)
    install_type: Mapped[str] = mapped_column(String(10), default="new")  # new|existing|remove|relocate
    floor_zone: Mapped[str | None] = mapped_column(String(100))
    note: Mapped[str | None] = mapped_column(String(300))
    user_locked: Mapped[bool] = mapped_column(Boolean, default=False)  # 재분석 시 보존
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class RouteKind(str, enum.Enum):
    conduit = "conduit"
    tray = "tray"
    cable = "cable"


class RouteSegment(Base):
    """선로 1개 구간 (LINE/POLYLINE/ARC). 길이는 도면 단위와 m 를 모두 저장."""
    __tablename__ = "route_segments"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("drawing_sheets.id"), index=True)
    legend_symbol_id: Mapped[int | None] = mapped_column(ForeignKey("legend_symbols.id"), index=True)
    route_id: Mapped[int | None] = mapped_column(ForeignKey("routes.id"), index=True)
    entity_handle: Mapped[str | None] = mapped_column(String(40))
    layer: Mapped[str | None] = mapped_column(String(200))
    points: Mapped[list] = mapped_column(JSON)       # [[x,y],...]
    length_du: Mapped[float] = mapped_column(Float)  # drawing units
    length_m: Mapped[float | None] = mapped_column(Float)  # scale 미확정이면 null
    is_duplicate_of: Mapped[int | None] = mapped_column(Integer)  # 중복 선분 의심
    status: Mapped[DetectStatus] = mapped_column(Enum(DetectStatus), default=DetectStatus.auto)
    user_locked: Mapped[bool] = mapped_column(Boolean, default=False)


class Route(Base):
    """연결된 동일 규격 구간의 묶음 (ConduitRoute/TrayRoute/CableRoute 를 kind 로 구분)."""
    __tablename__ = "routes"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("drawing_sheets.id"), index=True)
    legend_symbol_id: Mapped[int | None] = mapped_column(ForeignKey("legend_symbols.id"))
    kind: Mapped[RouteKind] = mapped_column(Enum(RouteKind))
    name: Mapped[str | None] = mapped_column(String(100))
    horizontal_m: Mapped[float | None] = mapped_column(Float)
    vertical_m: Mapped[float | None] = mapped_column(Float)   # 입상, 미확정 null
    slack_m: Mapped[float | None] = mapped_column(Float)      # 여장, 미확정 null
    segment_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[DetectStatus] = mapped_column(Enum(DetectStatus), default=DetectStatus.auto)


class Circuit(Base):
    """경로를 이용하는 케이블 회선. 전선관 1경로에 회선 n개 → 케이블 길이 = 경로길이 × n."""
    __tablename__ = "circuits"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("routes.id"), index=True)
    cable_symbol_id: Mapped[int] = mapped_column(ForeignKey("legend_symbols.id"))
    circuit_count: Mapped[int] = mapped_column(Integer, default=1)   # 회선 수 (사용자 확정)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(String(300))


class QuantityRule(Base):
    __tablename__ = "quantity_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    rule: Mapped[dict] = mapped_column(JSON)  # {"type":"count"|"length"|"length_x_circuits", ...}


class QuantityStatus(str, enum.Enum):
    auto = "auto"            # 자동 검출
    verified = "verified"    # 사용자 검증 완료
    edited = "edited"        # 사용자 수정 완료
    review = "review"        # 추가 검토 필요
    insufficient = "insufficient"  # 도면 정보 부족
    impossible = "impossible"      # 산출 불가


class QuantityItem(Base):
    """물량산출조서 1행."""
    __tablename__ = "quantity_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    revision_no: Mapped[int] = mapped_column(Integer, default=1)
    discipline: Mapped[str | None] = mapped_column(String(50))
    sub_discipline: Mapped[str | None] = mapped_column(String(50))
    item_name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str | None] = mapped_column(String(300))
    unit: Mapped[str | None] = mapped_column(String(20))
    formula: Mapped[str | None] = mapped_column(Text)      # 산출식 (문자열)
    qty_drawing: Mapped[float | None] = mapped_column(Float)   # 순수 도면 수량/길이
    qty_vertical: Mapped[float | None] = mapped_column(Float)  # 수직 길이
    qty_slack: Mapped[float | None] = mapped_column(Float)     # 여장
    qty_markup: Mapped[float | None] = mapped_column(Float)    # 할증
    qty_total: Mapped[float | None] = mapped_column(Float)
    drawing_nos: Mapped[list] = mapped_column(JSON, default=list)
    floor_zone: Mapped[str | None] = mapped_column(String(100))
    legend_symbol_id: Mapped[int | None] = mapped_column(ForeignKey("legend_symbols.id"))
    install_type: Mapped[str] = mapped_column(String(10), default="new")
    status: Mapped[QuantityStatus] = mapped_column(Enum(QuantityStatus), default=QuantityStatus.auto)
    note: Mapped[str | None] = mapped_column(String(300))
    evidence: Mapped[list[QuantityEvidence]] = relationship(back_populates="item", cascade="all, delete-orphan")


class QuantityEvidence(Base):
    """수량 ↔ 원본 도면 객체 연결 (클릭 시 도면 위치 이동)."""
    __tablename__ = "quantity_evidence"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("quantity_items.id"), index=True)
    sheet_id: Mapped[int] = mapped_column(ForeignKey("drawing_sheets.id"))
    detected_symbol_id: Mapped[int | None] = mapped_column(ForeignKey("detected_symbols.id"))
    route_id: Mapped[int | None] = mapped_column(ForeignKey("routes.id"))
    segment_id: Mapped[int | None] = mapped_column(ForeignKey("route_segments.id"))
    value: Mapped[float] = mapped_column(Float)
    item: Mapped[QuantityItem] = relationship(back_populates="evidence")


class QuantityRevision(Base):
    __tablename__ = "quantity_revisions"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    revision_no: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[list] = mapped_column(JSON)   # 당시 집계표
    reason: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---- 적산 기준정보 (5단계). 공식 자료를 사용자가 등록 — 임의 생성 금지 ----
class MaterialCatalog(Base):
    __tablename__ = "material_catalog"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str | None] = mapped_column(String(50))
    item_name: Mapped[str] = mapped_column(String(200))
    spec: Mapped[str | None] = mapped_column(String(300))
    unit: Mapped[str | None] = mapped_column(String(20))
    discipline: Mapped[str | None] = mapped_column(String(50))
    supply_type: Mapped[str] = mapped_column(String(10), default="private")  # gov(관급)|private(사급)


class UnitPrice(Base):
    __tablename__ = "unit_prices"
    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("material_catalog.id"), index=True)
    price: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(200))     # 물가정보지/업체견적/조달
    effective_date: Mapped[str] = mapped_column(String(10))
    version: Mapped[str | None] = mapped_column(String(50))


class LaborRate(Base):
    __tablename__ = "labor_rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    trade: Mapped[str] = mapped_column(String(100))   # 내선전공, 통신내선공 ...
    daily_rate: Mapped[float] = mapped_column(Float)
    publisher: Mapped[str] = mapped_column(String(100))
    effective_date: Mapped[str] = mapped_column(String(10))
    version: Mapped[str | None] = mapped_column(String(50))


class StandardNorm(Base):
    """표준품셈 1항목 — 사용자가 적법하게 확보한 자료만 등록."""
    __tablename__ = "standard_norms"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(300))
    unit: Mapped[str] = mapped_column(String(20))
    labor: Mapped[dict] = mapped_column(JSON)  # {"내선전공":0.12, ...} 단위당 인/일
    publisher: Mapped[str] = mapped_column(String(100))
    year: Mapped[int] = mapped_column(Integer)
    effective_date: Mapped[str | None] = mapped_column(String(10))
    source: Mapped[str | None] = mapped_column(String(300))
    version: Mapped[str | None] = mapped_column(String(50))
    conditions: Mapped[dict] = mapped_column(JSON, default=dict)


class CostEstimate(Base):
    __tablename__ = "cost_estimates"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    revision_no: Mapped[int] = mapped_column(Integer, default=1)
    rates: Mapped[dict] = mapped_column(JSON, default=dict)   # 제경비 비율 + 근거
    lines: Mapped[list] = mapped_column(JSON, default=list)   # 품목별 재료비/노무비/경비, 미산정 표시
    finalized: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ReviewIssue(Base):
    """교차검증·중복·축척 미확정 등 사용자 확인 필요 항목."""
    __tablename__ = "review_issues"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    sheet_id: Mapped[int | None] = mapped_column(ForeignKey("drawing_sheets.id"))
    severity: Mapped[str] = mapped_column(String(10), default="warn")  # info|warn|error
    code: Mapped[str] = mapped_column(String(50))
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(30))  # legend|quantity|estimate
    target_id: Mapped[int | None] = mapped_column(Integer)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(20))
    comment: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[int | None] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(100))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Job(Base):
    """오래 걸리는 작업(범례 자동 인식·자동 물량산출) — 웹 요청 타임아웃 방지용 백그라운드 실행 기록."""
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(30))      # takeoff | legend_auto
    status: Mapped[str] = mapped_column(String(15), default="queued")   # queued|running|done|failed
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(String(300))
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
