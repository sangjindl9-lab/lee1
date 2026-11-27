"""데이터베이스 모델 (26개 테이블). PostgreSQL 기준, 테스트는 SQLite에서도 동작한다."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def uid() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(timezone.utc)


class Row:
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    def dict(self, *exclude: str) -> dict:
        out = {}
        for c in self.__table__.columns:  # type: ignore[attr-defined]
            if c.name in exclude:
                continue
            v = getattr(self, c.name)
            out[c.name] = v.isoformat() if isinstance(v, datetime) else v
        return out


def fk(table: str, nullable: bool = False):
    return mapped_column(String(32), ForeignKey(f"{table}.id", ondelete="CASCADE"), nullable=nullable, index=True)


# 작업 상태 --------------------------------------------------------------
STATUSES = [
    "PENDING", "RESEARCHING", "SCRIPTING", "STORYBOARDING", "GENERATING", "EDITING",
    "REVIEWING", "RENDERING", "COMPLETED", "FAILED", "CANCELLED", "AWAITING_APPROVAL",
]
ACTIVE = ["RESEARCHING", "SCRIPTING", "STORYBOARDING", "GENERATING", "EDITING", "REVIEWING", "RENDERING"]


class User(Row, Base):
    __tablename__ = "users"
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user")  # user | admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    locale: Mapped[str] = mapped_column(String(8), default="ko")
    plan: Mapped[str] = mapped_column(String(32), default="free")  # 유료 구독 확장용(결제 미활성)
    daily_cost_limit_usd: Mapped[float] = mapped_column(Float, default=20.0)
    monthly_cost_limit_usd: Mapped[float] = mapped_column(Float, default=200.0)
    daily_video_limit: Mapped[int] = mapped_column(Integer, default=20)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class Project(Row, Base):
    __tablename__ = "projects"
    user_id: Mapped[str] = fk("users")
    topic: Mapped[str] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    mode: Mapped[str] = mapped_column(String(16), default="auto")  # economy|quality|cinematic|auto
    language: Mapped[str] = mapped_column(String(8), default="ko")
    target_duration: Mapped[int] = mapped_column(Integer, default=0)  # 0 = AI 자동
    current_stage: Mapped[str | None] = mapped_column(String(32))
    progress: Mapped[int] = mapped_column(Integer, default=0)
    stage_state: Mapped[dict] = mapped_column(JSON, default=dict)
    stage_data: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    max_cost_usd: Mapped[float] = mapped_column(Float, default=3.0)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    actual_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    package: Mapped[dict] = mapped_column(JSON, default=dict)
    output_video_key: Mapped[str | None] = mapped_column(String(512))
    regen_rounds: Mapped[int] = mapped_column(Integer, default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    locked_by: Mapped[str | None] = mapped_column(String(64))
    lock_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    batch_id: Mapped[str | None] = mapped_column(String(32), index=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProjectSettings(Row, Base):
    __tablename__ = "project_settings"
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    resolution: Mapped[str] = mapped_column(String(16), default="1080x1920")
    fps: Mapped[int] = mapped_column(Integer, default=30)
    style: Mapped[str | None] = mapped_column(String(128))
    voice: Mapped[str | None] = mapped_column(String(128))
    llm_model: Mapped[str | None] = mapped_column(String(128))
    image_model: Mapped[str | None] = mapped_column(String(128))
    video_model: Mapped[str | None] = mapped_column(String(128))
    tts_model: Mapped[str | None] = mapped_column(String(128))
    character_id: Mapped[str | None] = mapped_column(String(32))
    allow_unpriced: Mapped[bool] = mapped_column(Boolean, default=False)
    subtitle_style: Mapped[dict] = mapped_column(JSON, default=dict)
    branding: Mapped[dict] = mapped_column(JSON, default=dict)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)


class ResearchSource(Row, Base):
    __tablename__ = "research_sources"
    project_id: Mapped[str] = fk("projects")
    kind: Mapped[str] = mapped_column(String(16), default="web")  # web | fact
    claim: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    snippet: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[str | None] = mapped_column(String(64))
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    reliability: Mapped[str | None] = mapped_column(String(16))
    conflicting: Mapped[bool] = mapped_column(Boolean, default=False)
    engine: Mapped[str | None] = mapped_column(String(32))


class YoutubeReference(Row, Base):
    __tablename__ = "youtube_references"
    user_id: Mapped[str] = fk("users")
    project_id: Mapped[str | None] = fk("projects", nullable=True)
    video_id: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(255))
    channel_id: Mapped[str | None] = mapped_column(String(64))
    channel_title: Mapped[str | None] = mapped_column(String(255))
    subscriber_count: Mapped[int | None] = mapped_column(Integer)
    view_count: Mapped[int | None] = mapped_column(Integer)
    like_count: Mapped[int | None] = mapped_column(Integer)
    comment_count: Mapped[int | None] = mapped_column(Integer)
    published_at: Mapped[str | None] = mapped_column(String(64))
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    thumbnail: Mapped[str | None] = mapped_column(Text)
    is_short_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    query: Mapped[str | None] = mapped_column(String(255))
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)


class YoutubeMetricSnapshot(Row, Base):
    __tablename__ = "youtube_metric_snapshots"
    video_id: Mapped[str] = mapped_column(String(32), index=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    view_count: Mapped[int | None] = mapped_column(Integer)
    like_count: Mapped[int | None] = mapped_column(Integer)
    comment_count: Mapped[int | None] = mapped_column(Integer)


class Script(Row, Base):
    __tablename__ = "scripts"
    project_id: Mapped[str] = fk("projects")
    version: Mapped[int] = mapped_column(Integer, default=1)
    title_candidates: Mapped[list] = mapped_column(JSON, default=list)
    final_title: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[str | None] = mapped_column(String(64))
    sections: Mapped[list] = mapped_column(JSON, default=list)
    full_text: Mapped[str | None] = mapped_column(Text)
    est_duration: Mapped[float | None] = mapped_column(Float)
    policy_notes: Mapped[list] = mapped_column(JSON, default=list)


class Storyboard(Row, Base):
    __tablename__ = "storyboards"
    project_id: Mapped[str] = fk("projects")
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    character_bible: Mapped[dict] = mapped_column(JSON, default=dict)
    visual_bible: Mapped[dict] = mapped_column(JSON, default=dict)


class Scene(Row, Base):
    __tablename__ = "scenes"
    project_id: Mapped[str] = fk("projects")
    idx: Mapped[int] = mapped_column(Integer)
    start: Mapped[float] = mapped_column(Float, default=0.0)
    end: Mapped[float] = mapped_column(Float, default=0.0)
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    narration: Mapped[str] = mapped_column(Text, default="")
    tts_text: Mapped[str | None] = mapped_column(Text)
    image_prompt: Mapped[str | None] = mapped_column(Text)
    video_prompt: Mapped[str | None] = mapped_column(Text)
    negative_prompt: Mapped[str | None] = mapped_column(Text)
    characters: Mapped[list] = mapped_column(JSON, default=list)
    background: Mapped[str | None] = mapped_column(Text)
    shot: Mapped[str | None] = mapped_column(String(64))
    camera_move: Mapped[str | None] = mapped_column(String(64))
    lens: Mapped[str | None] = mapped_column(String(128))
    lighting: Mapped[str | None] = mapped_column(String(255))
    color_mood: Mapped[str | None] = mapped_column(String(255))
    subject_motion: Mapped[str | None] = mapped_column(Text)
    subtitle_position: Mapped[str] = mapped_column(String(16), default="lower")
    emphasis_words: Mapped[list] = mapped_column(JSON, default=list)
    sfx: Mapped[str | None] = mapped_column(String(255))
    transition: Mapped[str] = mapped_column(String(32), default="cut")
    motion_need: Mapped[int] = mapped_column(Integer, default=0)
    importance: Mapped[int] = mapped_column(Integer, default=3)
    kind: Mapped[str] = mapped_column(String(16), default="image")  # image | video
    image_model: Mapped[str | None] = mapped_column(String(128))
    video_model: Mapped[str | None] = mapped_column(String(128))
    est_cost_usd: Mapped[float | None] = mapped_column(Float)
    quality_bar: Mapped[str | None] = mapped_column(String(255))
    refs: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|ready|redo|failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    redo_reason: Mapped[str | None] = mapped_column(Text)
    image_asset_id: Mapped[str | None] = mapped_column(String(32))
    video_asset_id: Mapped[str | None] = mapped_column(String(32))
    audio_asset_id: Mapped[str | None] = mapped_column(String(32))
    words: Mapped[list] = mapped_column(JSON, default=list)
    sync_method: Mapped[str | None] = mapped_column(String(32))


class Character(Row, Base):
    __tablename__ = "characters"
    user_id: Mapped[str] = fk("users")
    project_id: Mapped[str | None] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(128))
    bible: Mapped[dict] = mapped_column(JSON, default=dict)
    reference_image_key: Mapped[str | None] = mapped_column(String(512))
    provider_ref: Mapped[dict] = mapped_column(JSON, default=dict)  # 예: {"higgsfield_soul_id": "..."}
    seed: Mapped[int | None] = mapped_column(Integer)


class VisualProfile(Row, Base):
    __tablename__ = "visual_profiles"
    user_id: Mapped[str] = fk("users")
    project_id: Mapped[str | None] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16), default="visual")  # visual | branding
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class GeneratedAsset(Row, Base):
    __tablename__ = "generated_assets"
    project_id: Mapped[str] = fk("projects")
    scene_id: Mapped[str | None] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # image|video|audio|cover|final|subtitle|zip
    storage_key: Mapped[str] = mapped_column(String(512))
    source_url: Mapped[str | None] = mapped_column(Text)
    provider: Mapped[str | None] = mapped_column(String(32))
    model_key: Mapped[str | None] = mapped_column(String(128))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration: Mapped[float | None] = mapped_column(Float)
    sha256: Mapped[str | None] = mapped_column(String(64))
    license_id: Mapped[str | None] = mapped_column(String(32))
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class AudioTrack(Row, Base):
    __tablename__ = "audio_tracks"
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)  # None = 전체 공용(관리자 등록)
    project_id: Mapped[str | None] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # narration|music|sfx
    title: Mapped[str | None] = mapped_column(String(255))
    mood: Mapped[str | None] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(512))
    duration: Mapped[float | None] = mapped_column(Float)
    license_id: Mapped[str | None] = mapped_column(String(32))
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class Subtitle(Row, Base):
    __tablename__ = "subtitles"
    project_id: Mapped[str] = fk("projects")
    language: Mapped[str] = mapped_column(String(8), default="ko")
    format: Mapped[str] = mapped_column(String(8))  # srt|vtt|ass
    storage_key: Mapped[str] = mapped_column(String(512))
    sync_method: Mapped[str | None] = mapped_column(String(32))
    cues: Mapped[list] = mapped_column(JSON, default=list)


class RenderJob(Row, Base):
    __tablename__ = "render_jobs"
    project_id: Mapped[str] = fk("projects")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    timeline: Mapped[dict] = mapped_column(JSON, default=dict)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    output_key: Mapped[str | None] = mapped_column(String(512))
    probe: Mapped[dict] = mapped_column(JSON, default=dict)
    log: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProviderConfig(Row, Base):
    __tablename__ = "provider_configs"
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)  # None = 서비스 공용 키(관리자)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    credentials_enc: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(16), default="untested")  # untested|ok|error
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class ProviderModel(Row, Base):
    __tablename__ = "provider_models"
    provider: Mapped[str] = mapped_column(String(32), index=True)
    model_key: Mapped[str] = mapped_column(String(128), unique=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # llm|image|t2v|i2v|tts|stt
    display_name: Mapped[str] = mapped_column(String(128))
    endpoint: Mapped[str] = mapped_column(String(255))  # 공급자 측 모델 경로/이름
    tier: Mapped[str] = mapped_column(String(16), default="standard")  # economy|standard|premium
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    default_params: Mapped[dict] = mapped_column(JSON, default=dict)
    unit: Mapped[str] = mapped_column(String(24), default="per_image")
    unit_cost_usd: Mapped[float | None] = mapped_column(Float)  # None = 가격 미등록
    unit_cost_out_usd: Mapped[float | None] = mapped_column(Float)  # LLM 출력 토큰 단가
    price_source: Mapped[str | None] = mapped_column(Text)
    schema_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)


class ProviderRequest(Row, Base):
    __tablename__ = "provider_requests"
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    project_id: Mapped[str | None] = mapped_column(String(32), index=True)
    scene_id: Mapped[str | None] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(32), index=True)
    model_key: Mapped[str | None] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16))
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True)
    external_id: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|submitted|completed|failed
    request: Mapped[dict] = mapped_column(JSON, default=dict)
    response: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    error_kind: Mapped[str | None] = mapped_column(String(24))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    billed: Mapped[bool | None] = mapped_column(Boolean)  # 실패 요청의 과금 여부 기록
    cost_usd: Mapped[float | None] = mapped_column(Float)
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class ApiUsageLog(Row, Base):
    __tablename__ = "api_usage_logs"
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    project_id: Mapped[str | None] = mapped_column(String(32), index=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    endpoint: Mapped[str | None] = mapped_column(String(255))
    units: Mapped[float] = mapped_column(Float, default=0)
    unit_type: Mapped[str | None] = mapped_column(String(24))
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer)


class CostRecord(Row, Base):
    __tablename__ = "cost_records"
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    project_id: Mapped[str | None] = mapped_column(String(32), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    model_key: Mapped[str | None] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16))
    amount_usd: Mapped[float] = mapped_column(Float, default=0.0)
    estimated: Mapped[bool] = mapped_column(Boolean, default=True)  # 공급자 응답에 금액이 없어 단가표로 계산
    request_id: Mapped[str | None] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(Text)


class QualityReport(Row, Base):
    __tablename__ = "quality_reports"
    project_id: Mapped[str] = fk("projects")
    round: Mapped[int] = mapped_column(Integer, default=0)
    scores: Mapped[dict] = mapped_column(JSON, default=dict)
    total: Mapped[float] = mapped_column(Float, default=0.0)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    partial: Mapped[bool] = mapped_column(Boolean, default=False)  # AI 시각 검수 미실시
    fatal: Mapped[list] = mapped_column(JSON, default=list)
    issues: Mapped[list] = mapped_column(JSON, default=list)
    technical: Mapped[dict] = mapped_column(JSON, default=dict)


class YoutubeChannel(Row, Base):
    __tablename__ = "youtube_channels"
    user_id: Mapped[str] = fk("users")
    channel_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(String(255))
    thumbnail: Mapped[str | None] = mapped_column(Text)
    tokens_enc: Mapped[str] = mapped_column(Text, default="")
    scopes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="connected")


class YoutubeUpload(Row, Base):
    __tablename__ = "youtube_uploads"
    project_id: Mapped[str] = fk("projects")
    channel_row_id: Mapped[str] = mapped_column(String(32))
    video_id: Mapped[str | None] = mapped_column(String(32))
    privacy: Mapped[str] = mapped_column(String(16), default="private")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    approved_by_user: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    response: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)


class ChannelAnalytics(Row, Base):
    __tablename__ = "channel_analytics"
    channel_row_id: Mapped[str] = mapped_column(String(32), index=True)
    project_id: Mapped[str | None] = mapped_column(String(32), index=True)
    video_id: Mapped[str] = mapped_column(String(32), index=True)
    window: Mapped[str] = mapped_column(String(8))  # 24h|3d|7d|manual
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)


class License(Row, Base):
    __tablename__ = "licenses"
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(255))
    license_type: Mapped[str | None] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(Text)
    commercial_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    attribution: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)


class AuditLog(Row, Base):
    __tablename__ = "audit_logs"
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    project_id: Mapped[str | None] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(64))
    level: Mapped[str] = mapped_column(String(8), default="info")
    message: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class AppSetting(Row, Base):
    """관리자가 운영 중에 바꾸는 전역 설정(품질 기준, 한도, 정책 등)."""
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), unique=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)


GLOBAL_DEFAULTS = {
    "quality_pass_score": 90, "max_regen_rounds": 2, "youtube_quota_per_project": 900, "allow_signup": True,
    "default_max_cost_usd": 3.0, "default_daily_cost_limit_usd": 20.0, "default_monthly_cost_limit_usd": 200.0,
    "default_daily_video_limit": 20, "blocked_keywords": [],
}


def gset(db, key: str):
    row = db.query(AppSetting).filter_by(key="global").first()
    return {**GLOBAL_DEFAULTS, **((row.value if row else None) or {})}.get(key)


Index("ix_scene_project_idx", Scene.project_id, Scene.idx)
Index("ix_cost_user_created", CostRecord.user_id, CostRecord.created_at)
