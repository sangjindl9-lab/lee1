"""저장소 경로 규칙과 디스크 상태."""
from __future__ import annotations

import datetime as dt
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from .config import get_settings

# 최종 구간 파일: cam<ID>/YYYY/MM/DD/<시작epoch_ms>_<길이ms>.mp4
_SEG_RE = re.compile(r"^cam(?P<cam>\d+)/(\d{4})/(\d{2})/(\d{2})/(?P<start>\d{13})_(?P<dur>\d{1,9})\.mp4$")


def segment_rel_path(camera_id: int, start: dt.datetime, duration_ms: int) -> str:
    start_utc = start.astimezone(dt.timezone.utc)
    ms = int(start_utc.timestamp() * 1000)
    return f"cam{camera_id}/{start_utc:%Y/%m/%d}/{ms:013d}_{int(duration_ms)}.mp4"


def parse_segment_rel_path(rel: str) -> tuple[int, dt.datetime, int] | None:
    m = _SEG_RE.match(rel)
    if not m:
        return None
    start = dt.datetime.fromtimestamp(int(m["start"]) / 1000, tz=dt.timezone.utc)
    return int(m["cam"]), start, int(m["dur"])


def safe_join(base: Path, rel: str) -> Path:
    """rel 경로가 base 밖으로 나가지 않는지 검사(심볼릭 링크 포함)."""
    base_r = base.resolve()
    p = (base / rel).resolve()
    if p != base_r and base_r not in p.parents:
        raise ValueError("허용되지 않은 경로")
    return p


@dataclass
class DiskInfo:
    path: str
    total: int
    used: int
    free: int

    @property
    def free_percent(self) -> float:
        return round(self.free * 100 / self.total, 2) if self.total else 0.0


def disk_info(path: Path | None = None) -> DiskInfo:
    p = path or get_settings().recordings_dir
    u = shutil.disk_usage(p)
    return DiskInfo(path=str(p), total=u.total, used=u.used, free=u.free)


def fsync_dir(path: Path) -> None:
    try:
        fd = os.open(path, os.O_DIRECTORY)
    except OSError:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
