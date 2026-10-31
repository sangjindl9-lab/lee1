"""DB 모델. 시각은 모두 timestamptz(UTC)."""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, CIDR, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


TS = DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # superadmin/site_admin/operator/viewer
    permissions_override: Mapped[dict[str, bool]] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    last_login_at: Mapped[dt.datetime | None] = mapped_column(TS)
    sites: Mapped[list[Site]] = relationship(secondary="user_sites", lazy="selectin")


class UserSite(Base):
    __tablename__ = "user_sites"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)


class AuthSession(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    expires_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    idle_expires_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    ip: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    revoked_at: Mapped[dt.datetime | None] = mapped_column(TS)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    ip: Mapped[str] = mapped_column(String(64), nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_login_attempts_user_at", "username", "at"), Index("ix_login_attempts_ip_at", "ip", "at"))


class Site(Base):
    __tablename__ = "sites"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Seoul")
    allowed_networks: Mapped[list[str]] = mapped_column(ARRAY(CIDR), nullable=False, default=list)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())


class Driver(Base):
    __tablename__ = "drivers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vendor: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    models: Mapped[str] = mapped_column(Text, nullable=False, default="")
    firmware: Mapped[str] = mapped_column(Text, nullable=False, default="")
    doc_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    doc_checked_at: Mapped[dt.date | None] = mapped_column()
    doc_access: Mapped[str] = mapped_column(Text, nullable=False, default="")
    protocols: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    codecs: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    auth_methods: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    features: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    verification_status: Mapped[str] = mapped_column(String(20), nullable=False)  # real/test/unverified/unsupported
    implemented: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Camera(Base):
    __tablename__ = "cameras"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), nullable=False, index=True)
    building: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    zone: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    vendor: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    firmware: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    serial: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id"))
    connection_type: Mapped[str] = mapped_column(String(10), nullable=False)  # onvif / rtsp
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    onvif_port: Mapped[int | None] = mapped_column(Integer)
    onvif_scheme: Mapped[str] = mapped_column(String(5), nullable=False, default="http")
    onvif_device_path: Mapped[str] = mapped_column(String(255), nullable=False, default="/onvif/device_service")
    rtsp_transport: Mapped[str] = mapped_column(String(5), nullable=False, default="tcp")
    main_stream_url: Mapped[str] = mapped_column(Text, nullable=False)
    sub_stream_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    main_profile_token: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    sub_profile_token: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    snapshot_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    username: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    password_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tls_insecure: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tls_insecure_approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    tls_insecure_approved_at: Mapped[dt.datetime | None] = mapped_column(TS)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    location_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    record_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="continuous")  # off/continuous/schedule/event
    # 주간 일정: 7(월~일) × 24시간 문자열. '0'=녹화 안 함, 'C'=연속, 'E'=이벤트 시에만
    schedule: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    event_pre_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    event_post_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    # 녹화를 일으키는 이벤트 종류(motion, tamper, input, manual, analytics). 비면 전체
    event_triggers: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    events_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # ONVIF 이벤트 구독
    manual_record_until: Mapped[dt.datetime | None] = mapped_column(TS)
    retention_days: Mapped[int | None] = mapped_column(Integer)
    is_test_source: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    capabilities: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    stream_info: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    config_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    deleted_at: Mapped[dt.datetime | None] = mapped_column(TS)

    site: Mapped[Site] = relationship(lazy="joined")


class CameraStatus(Base):
    __tablename__ = "camera_status"
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), primary_key=True)
    recorder_state: Mapped[str] = mapped_column(String(20), nullable=False, default="idle")
    # idle / connecting / recording / retry_wait / stopped / error
    error_code: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    last_segment_at: Mapped[dt.datetime | None] = mapped_column(TS)
    connected_since: Mapped[dt.datetime | None] = mapped_column(TS)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_retry_at: Mapped[dt.datetime | None] = mapped_column(TS)
    updated_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())


class RecordingSegment(Base):
    __tablename__ = "recording_segments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"), nullable=False)
    start_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    end_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    rel_path: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    video_codec: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    audio_codec: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="continuous")  # continuous/schedule/event/manual
    protected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ready")  # ready/deleting/buffer
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    __table_args__ = (
        Index("ix_segments_camera_start", "camera_id", "start_at"),
        Index("ix_segments_start", "start_at"),
    )


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id"))
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id"))
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), nullable=False, default="info")  # info/warning/critical
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="system")  # system/camera/analytics
    started_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    ended_at: Mapped[dt.datetime | None] = mapped_column(TS)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    dedup_key: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    acknowledged_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    acknowledged_at: Mapped[dt.datetime | None] = mapped_column(TS)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    triggers_recording: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    __table_args__ = (Index("ix_events_started", "started_at"), Index("ix_events_dedup_open", "dedup_key", "ended_at"),
                      Index("ix_events_camera_started", "camera_id", "started_at"))


class ExportJob(Base):
    __tablename__ = "export_jobs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"), nullable=False)
    start_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    end_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default="copy")  # copy / exact
    watermark: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="queued")
    # queued / running / done / failed / cancelled / expired
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    actual_start_at: Mapped[dt.datetime | None] = mapped_column(TS)
    actual_end_at: Mapped[dt.datetime | None] = mapped_column(TS)
    rel_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    started_at: Mapped[dt.datetime | None] = mapped_column(TS)
    finished_at: Mapped[dt.datetime | None] = mapped_column(TS)
    expires_at: Mapped[dt.datetime | None] = mapped_column(TS)


class Layout(Base):
    __tablename__ = "layouts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    grid: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    cells: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint("user_id", "name"),)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    user_id: Mapped[int | None] = mapped_column(Integer)
    username: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    ip: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    target_id: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    result: Mapped[str] = mapped_column(String(10), nullable=False, default="ok")  # ok / denied / fail
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    __table_args__ = (Index("ix_audit_at", "at"),)


class ServiceHeartbeat(Base):
    __tablename__ = "service_heartbeats"
    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    instance: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    started_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    last_seen_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    info: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class SystemSetting(Base):
    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)


# ───────────────────────── 2·3단계 ─────────────────────────
class UserCamera(Base):
    """카메라 단위 접근 제한. 사용자에게 행이 하나라도 있으면 그 카메라만 볼 수 있다(현장 권한과 AND)."""
    __tablename__ = "user_cameras"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), primary_key=True)


class Bookmark(Base):
    __tablename__ = "bookmarks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"), nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    at: Mapped[dt.datetime] = mapped_column(TS, nullable=False)
    end_at: Mapped[dt.datetime | None] = mapped_column(TS)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    __table_args__ = (Index("ix_bookmarks_camera_at", "camera_id", "at"),)


class NotifyChannel(Base):
    __tablename__ = "notify_channels"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # email / webhook
    config_enc: Mapped[str] = mapped_column(Text, nullable=False)  # 암호화된 JSON(SMTP 비밀번호·웹훅 비밀키 포함)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    min_severity: Mapped[str] = mapped_column(String(10), nullable=False, default="warning")
    event_types: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)  # 비면 전체
    repeat_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0 = 반복 안 함
    suppress_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())


class NotifyLog(Base):
    __tablename__ = "notify_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("notify_channels.id", ondelete="CASCADE"), nullable=False)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"))
    dedup_key: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="new")  # new / repeat / resolved / test
    sent_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    __table_args__ = (Index("ix_notify_log_key", "channel_id", "dedup_key", "sent_at"),)


class EdgeNode(Base):
    """중앙 관리 서버에 상태를 보고하는 현장 서버(Edge)."""
    __tablename__ = "edge_nodes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    last_seen_at: Mapped[dt.datetime | None] = mapped_column(TS)
    last_ip: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    report: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ApiKey(Base):
    """외부 연동(분석 모듈 등) 키. 원문은 생성 시 한 번만 보여주고 해시만 저장."""
    __tablename__ = "api_keys"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    purpose: Mapped[str] = mapped_column(String(20), nullable=False, default="analytics")
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    site_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False, default=list)  # 비면 전체
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    last_used_at: Mapped[dt.datetime | None] = mapped_column(TS)


# ───────────────────────── 지능형 분석 ─────────────────────────
class AnalyticsRule(Base):
    """카메라별 분석 규칙. 좌표는 영상 크기에 대한 비율(0~1)."""
    __tablename__ = "analytics_rules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    # fire / smoke / no_helmet / water_level / intrusion / loitering / crowd / fall / running / stationary
    name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    zone: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)  # [[x,y], ...] 비면 화면 전체
    line: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)  # 수위 눈금선 [[x,y](바닥), [x,y](위)]
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    severity: Mapped[str] = mapped_column(String(10), nullable=False, default="warning")
    cooldown_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    ref_requested_at: Mapped[dt.datetime | None] = mapped_column(TS)
    ref_set_at: Mapped[dt.datetime | None] = mapped_column(TS)
    updated_at: Mapped[dt.datetime] = mapped_column(TS, nullable=False, server_default=func.now())
