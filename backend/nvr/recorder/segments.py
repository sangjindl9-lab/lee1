"""구간 파일 확정(원자적)과 복구."""
from __future__ import annotations

import datetime as dt
import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..config import get_settings
from ..db import session_scope
from ..media.ffmpeg import ffprobe_file
from ..models import RecordingSegment
from ..storage import fsync_dir, segment_rel_path

log = logging.getLogger("nvr.recorder.segments")
SEG_NAME = re.compile(r"^seg_(\d{9,11})\.mp4$")


@dataclass
class CsvLine:
    name: str
    start: float
    end: float


def parse_list(path: Path) -> list[CsvLine]:
    out = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return out
    for line in text.splitlines():
        parts = line.strip().split(",")
        if len(parts) < 3:
            continue
        try:
            out.append(CsvLine(name=os.path.basename(parts[0]), start=float(parts[1]), end=float(parts[2])))
        except ValueError:
            continue
    return out


def name_epoch(name: str) -> int | None:
    m = SEG_NAME.match(name)
    return int(m.group(1)) if m else None


def seg_files(run_dir: Path) -> list[str]:
    try:
        names = [n for n in os.listdir(run_dir) if SEG_NAME.match(n)]
    except FileNotFoundError:
        return []
    return sorted(names, key=lambda n: name_epoch(n) or 0)


class FinalizeError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def finalize_segment(camera_id: int, src: Path, start: dt.datetime, duration_s: float, kind: str,
                     codecs: dict | None = None, status: str = "ready") -> RecordingSegment | None:
    """조각화 MP4 → faststart MP4 재다중화(복사) → 임시 파일 fsync → rename(원자적) → DB 인덱스.

    파일을 먼저 확정하고 DB에 넣는다. DB 삽입 전에 죽어도 다음 시작 때 파일명으로 재색인된다.
    """
    s = get_settings()
    if duration_s < 0.2 or not src.exists() or src.stat().st_size < 1024:
        src.unlink(missing_ok=True)
        return None
    duration_ms = int(round(duration_s * 1000))
    rel = segment_rel_path(camera_id, start, duration_ms)
    final = s.recordings_dir / rel
    final.parent.mkdir(parents=True, exist_ok=True)
    tmp = final.with_name("." + final.name + ".tmp")
    args = [s.ffmpeg_path, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", str(src), "-map", "0",
            "-c", "copy", "-movflags", "+faststart"]
    if (codecs or {}).get("video") == "hevc":
        args += ["-tag:v", "hvc1"]
    args += ["-f", "mp4", str(tmp)]
    try:
        proc = subprocess.run(args, capture_output=True, timeout=120, check=False)
    except subprocess.TimeoutExpired as exc:
        tmp.unlink(missing_ok=True)
        raise FinalizeError("remux_timeout", "구간 확정 시간 초과") from exc
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        err = proc.stderr.decode("utf-8", "replace")[-300:]
        if "No space left" in err:
            raise FinalizeError("disk_full", "저장공간 부족으로 구간을 확정하지 못했습니다.")
        # 손상된 조각 → 격리
        _quarantine(camera_id, src)
        raise FinalizeError("remux_failed", f"구간 확정 실패(격리됨): {err.strip()}")
    try:
        with open(tmp, "rb") as f:
            os.fsync(f.fileno())
        os.replace(tmp, final)
        fsync_dir(final.parent)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        code = "disk_full" if getattr(exc, "errno", 0) == 28 else "disk_write_error"
        raise FinalizeError(code, f"구간 파일 쓰기 실패: {exc}") from exc
    size = final.stat().st_size
    info = ffprobe_file(str(final)) or {}
    v = next((x for x in info.get("streams", []) if x.get("codec_type") == "video"), {})
    a = next((x for x in info.get("streams", []) if x.get("codec_type") == "audio"), {})
    seg = RecordingSegment(camera_id=camera_id, start_at=start, end_at=start + dt.timedelta(milliseconds=duration_ms),
                           duration_ms=duration_ms, rel_path=rel, size_bytes=size, video_codec=v.get("codec_name", ""),
                           audio_codec=a.get("codec_name", ""), width=v.get("width"), height=v.get("height"), kind=kind,
                           status=status)
    try:
        with session_scope() as db:
            db.add(seg)
    except IntegrityError:
        log.warning("이미 색인된 구간: %s", rel)
    src.unlink(missing_ok=True)
    return seg


def _quarantine(camera_id: int, src: Path) -> None:
    q = get_settings().recordings_dir / ".quarantine" / f"cam{camera_id}"
    q.mkdir(parents=True, exist_ok=True)
    try:
        shutil.move(str(src), q / f"{int(dt.datetime.now().timestamp())}_{src.name}")
    except OSError:
        src.unlink(missing_ok=True)


def probe_duration(path: Path) -> float | None:
    info = ffprobe_file(str(path))
    try:
        return float(info["format"]["duration"]) if info else None
    except (KeyError, TypeError, ValueError):
        return None


def reindex_orphans() -> int:
    """저장소에는 있으나 DB에 없는 확정 파일을 파일명으로 재색인(비정상 종료 복구)."""
    from ..storage import parse_segment_rel_path

    s = get_settings()
    base = s.recordings_dir
    if not base.exists():
        return 0
    with session_scope() as db:
        known = set(db.scalars(select(RecordingSegment.rel_path)))
    added = 0
    for cam_dir in base.glob("cam*"):
        for f in cam_dir.rglob("*.mp4"):
            rel = f.relative_to(base).as_posix()
            if rel in known:
                continue
            parsed = parse_segment_rel_path(rel)
            if not parsed:
                continue
            cam_id, start, dur = parsed
            info = ffprobe_file(str(f)) or {}
            if not info.get("streams"):
                continue
            v = next((x for x in info["streams"] if x.get("codec_type") == "video"), {})
            a = next((x for x in info["streams"] if x.get("codec_type") == "audio"), {})
            try:
                with session_scope() as db:
                    db.add(RecordingSegment(camera_id=cam_id, start_at=start,
                                            end_at=start + dt.timedelta(milliseconds=dur), duration_ms=dur,
                                            rel_path=rel, size_bytes=f.stat().st_size,
                                            video_codec=v.get("codec_name", ""), audio_codec=a.get("codec_name", ""),
                                            width=v.get("width"), height=v.get("height"), kind="continuous"))
                added += 1
            except IntegrityError:
                pass
    return added
