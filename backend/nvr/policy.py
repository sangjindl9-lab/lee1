"""녹화 정책: 연속 / 주간 일정 / 이벤트(사전·사후 버퍼) / 수동.

우선순위(겹칠 때)
  1. 수동 녹화(기간 지정)   → kind=manual, 확정
  2. 연속 녹화              → kind=continuous, 확정
  3. 일정 'C'(그 시간 연속) → kind=schedule, 확정
  4. 일정 'E' 또는 이벤트 모드 → kind=event, 우선 '버퍼'로 저장 → 이벤트 구간(전·후 여유 포함)에 걸치면 확정, 아니면 삭제
  5. 그 외                  → 녹화하지 않음
연속·일정 녹화 중에 발생한 이벤트는 같은 영상을 중복 저장하지 않고 이벤트 표시(시간축 표식)만 남긴다.
"""
from __future__ import annotations

import datetime as dt
import zoneinfo
from dataclasses import dataclass

RECORD_MODES = ("off", "continuous", "schedule", "event")
EVENT_TRIGGER_TYPES = ("motion", "tamper", "input", "manual", "analytics")
SCHEDULE_VALUES = set("0CE")


def validate_schedule(schedule: list[str] | None) -> list[str]:
    if not schedule:
        return []
    if len(schedule) != 7 or any(len(d) != 24 or set(d) - SCHEDULE_VALUES for d in schedule):
        raise ValueError("일정은 7일 × 24시간, 각 칸 '0'(안 함)·'C'(연속)·'E'(이벤트)여야 합니다.")
    return list(schedule)


@dataclass
class CamPolicy:
    record_mode: str
    schedule: list[str]
    timezone: str
    manual_until: dt.datetime | None

    @classmethod
    def of(cls, cam) -> CamPolicy:
        return cls(record_mode=cam.record_mode, schedule=list(cam.schedule or []), timezone=cam.site.timezone,
                   manual_until=cam.manual_record_until)

    def slot(self, at: dt.datetime) -> str:
        if not self.schedule:
            return "0"
        local = at.astimezone(zoneinfo.ZoneInfo(self.timezone))
        return self.schedule[local.weekday()][local.hour]

    def decide(self, at: dt.datetime) -> tuple[str, str] | None:
        """(kind, status) 또는 None(녹화 안 함). status: ready=바로 확정, buffer=이벤트 대기"""
        if self.manual_until and self.manual_until > at:
            return ("manual", "ready")
        if self.record_mode == "continuous":
            return ("continuous", "ready")
        if self.record_mode == "schedule":
            s = self.slot(at)
            if s == "C":
                return ("schedule", "ready")
            if s == "E":
                return ("event", "buffer")
            return None
        if self.record_mode == "event":
            return ("event", "buffer")
        return None

    def uses_events(self) -> bool:
        return self.record_mode == "event" or (self.record_mode == "schedule" and any("E" in d for d in self.schedule))


def triggers(cam, event_type: str) -> bool:
    """이 카메라에서 해당 이벤트가 녹화를 일으키는지."""
    if event_type not in EVENT_TRIGGER_TYPES:
        return False
    allowed = list(cam.event_triggers or []) or list(EVENT_TRIGGER_TYPES)
    return event_type in allowed
