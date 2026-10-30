"""MP4 구간 내보내기 작업 처리."""
from __future__ import annotations

import datetime as dt
import hashlib
import logging
import os
import subprocess
import time

from sqlalchemy import select, text

from ..config import get_settings
from ..db import session_scope
from ..models import Camera, ExportJob, RecordingSegment, User, utcnow
from ..settings_store import get_all
from ..storage import safe_join

log = logging.getLogger("nvr.worker.exports")


def claim_job() -> int | None:
    with session_scope() as db:
        row = db.execute(text(
            "SELECT id FROM export_jobs WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1")).first()
        if not row:
            return None
        job = db.get(ExportJob, row[0])
        job.status = "running"
        job.started_at = utcnow()
        job.progress = 0
        return job.id


def _set(job_id: int, **kw) -> ExportJob | None:
    with session_scope() as db:
        job = db.get(ExportJob, job_id)
        if not job:
            return None
        for k, v in kw.items():
            setattr(job, k, v)
        return job


def _cancel_requested(job_id: int) -> bool:
    with session_scope() as db:
        j = db.get(ExportJob, job_id)
        return bool(j and j.cancel_requested)


def _drawtext_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:").replace("%", "\\%")


def run_job(job_id: int) -> None:
    s = get_settings()
    with session_scope() as db:
        job = db.get(ExportJob, job_id)
        cam = db.get(Camera, job.camera_id)
        user = db.get(User, job.user_id)
        tzname = cam.site.timezone
        t0, t1 = job.start_at, job.end_at
        segs = db.scalars(select(RecordingSegment).where(
            RecordingSegment.camera_id == cam.id, RecordingSegment.status == "ready",
            RecordingSegment.end_at > t0, RecordingSegment.start_at < t1).order_by(RecordingSegment.start_at)).all()
        seg_rows = [(x.rel_path, x.start_at, x.end_at) for x in segs]
        mode, watermark, username, cam_name = job.mode, job.watermark, user.username if user else "?", cam.name
        ttl = get_all(db)["export_ttl_hours"]
    if not seg_rows:
        _set(job_id, status="failed", error="해당 구간의 녹화가 없습니다(보관 정책으로 삭제되었을 수 있음).", finished_at=utcnow())
        return
    work = s.exports_dir / ".work"
    work.mkdir(parents=True, exist_ok=True)
    listfile = work / f"job_{job_id}.txt"
    lines, gaps, gap_total = [], 0, 0.0
    prev_end = None
    for rel, st, en in seg_rows:
        p = safe_join(s.recordings_dir, rel)
        if not p.exists():
            continue
        if prev_end is not None and (st - prev_end).total_seconds() > 3:
            gaps += 1
            gap_total += (st - prev_end).total_seconds()
        prev_end = en
        lines.append("file '" + str(p).replace("'", "'\\''") + "'")
    if not lines:
        _set(job_id, status="failed", error="녹화 파일이 저장소에 없습니다.", finished_at=utcnow())
        return
    listfile.write_text("\n".join(lines) + "\n", encoding="utf-8")
    first_start = seg_rows[0][1]
    last_end = seg_rows[-1][2]
    offset = max(0.0, (t0 - first_start).total_seconds())
    eff_start = max(t0, first_start)
    eff_end = min(t1, last_end)
    # 누락 구간은 concat 시 건너뛰므로 실제 영상 길이 = 녹화가 있는 시간
    covered = max(0.1, (eff_end - eff_start).total_seconds() - gap_total)
    out_tmp = work / f"job_{job_id}.mp4.tmp"
    out_final = s.exports_dir / f"job_{job_id}.mp4"
    args = [s.ffmpeg_path, "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
            "-f", "concat", "-safe", "0", "-ss", f"{offset:.3f}", "-i", str(listfile), "-t", f"{covered:.3f}",
            "-map", "0:v:0", "-map", "0:a:0?"]
    if mode == "copy":
        args += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
    else:
        vf = []
        if watermark:
            font = s.watermark_font
            label = _drawtext_escape(f"EXPORT #{job_id} by {username} / CAM {job.camera_id}")
            epoch = int(eff_start.timestamp())
            clock = f"%{{pts\\:localtime\\:{epoch}\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}}"
            vf.append(f"drawtext=fontfile={font}:text='{label}':x=10:y=10:fontsize=20:fontcolor=white@0.85:"
                      "box=1:boxcolor=black@0.45:boxborderw=6")
            vf.append(f"drawtext=fontfile={font}:text='{clock}':x=10:y=h-th-10:fontsize=22:fontcolor=white@0.9:"
                      "box=1:boxcolor=black@0.45:boxborderw=6")
        if vf:
            args += ["-vf", ",".join(vf)]
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac",
                 "-b:a", "96k"]
    tz_local = eff_start.astimezone(__import__("zoneinfo").ZoneInfo(tzname))
    args += ["-metadata", f"title={cam_name} {tz_local:%Y-%m-%d %H:%M:%S}",
             "-metadata", f"comment=web-nvr export job={job_id} camera={job.camera_id} user={username} "
                          f"requested={t0.isoformat()}~{t1.isoformat()} mode={mode}",
             "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", "-f", "mp4", str(out_tmp)]
    env = dict(os.environ, TZ=tzname)
    log.info("내보내기 #%s 시작 (%s, %d개 구간)", job_id, mode, len(lines))
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, env=env)
    last_check = 0.0
    cancelled = False
    assert proc.stdout is not None
    for raw in iter(proc.stdout.readline, b""):
        line = raw.decode("utf-8", "replace").strip()
        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            try:
                us = int(line.split("=", 1)[1])
                _set(job_id, progress=min(99.0, us / 1e6 / covered * 100))
            except ValueError:
                pass
        if time.time() - last_check > 2:
            last_check = time.time()
            if _cancel_requested(job_id):
                proc.kill()
                cancelled = True
                break
    proc.wait()
    stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    listfile.unlink(missing_ok=True)
    if cancelled:
        out_tmp.unlink(missing_ok=True)
        _set(job_id, status="cancelled", finished_at=utcnow(), error="사용자가 취소했습니다.")
        return
    if proc.returncode != 0 or not out_tmp.exists():
        out_tmp.unlink(missing_ok=True)
        msg = "저장공간 부족" if "No space left" in stderr else stderr.strip()[-400:] or "알 수 없는 오류"
        _set(job_id, status="failed", finished_at=utcnow(), error=f"내보내기 실패: {msg}")
        return
    from ..media.ffmpeg import ffprobe_file

    info = ffprobe_file(str(out_tmp)) or {}
    try:
        out_dur = float(info["format"]["duration"])
    except (KeyError, TypeError, ValueError):
        out_tmp.unlink(missing_ok=True)
        _set(job_id, status="failed", finished_at=utcnow(), error="출력 파일 검증 실패(재생 불가)")
        return
    h = hashlib.sha256()
    with open(out_tmp, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
        os.fsync(f.fileno())
    os.replace(out_tmp, out_final)
    note = []
    actual_start = eff_start
    if mode == "copy":
        extra = out_dur - covered
        if extra > 0.05:
            actual_start = eff_start - dt.timedelta(seconds=extra)
            note.append(f"원본 복사 방식이라 직전 키프레임부터 시작합니다(요청보다 약 {extra:.1f}초 앞). 정확한 구간이 필요하면 '정확(재인코딩)'을 선택하세요.")
    if eff_start > t0 or eff_end < t1:
        note.append("요청 구간 일부에 녹화가 없어 녹화가 있는 범위만 내보냈습니다.")
    if gaps:
        note.append(f"녹화 누락 {gaps}곳(총 {gap_total:.0f}초)은 영상에서 건너뛰었습니다.")
    if watermark:
        note.append("표시용 워터마크(내보내기 번호·사용자·녹화 시각)가 영상에 합성되었습니다. 원본 녹화는 변경되지 않습니다.")
    _set(job_id, status="done", progress=100.0, finished_at=utcnow(), rel_path=out_final.name,
         size_bytes=out_final.stat().st_size, sha256=h.hexdigest(), actual_start_at=actual_start,
         actual_end_at=actual_start + dt.timedelta(seconds=out_dur), note=" ".join(note),
         expires_at=utcnow() + dt.timedelta(hours=int(ttl)))
    log.info("내보내기 #%s 완료 (%.1f초, %d bytes)", job_id, out_dur, out_final.stat().st_size)


def expire_exports() -> int:
    s = get_settings()
    n = 0
    with session_scope() as db:
        for j in db.scalars(select(ExportJob).where(ExportJob.status == "done", ExportJob.expires_at < utcnow())):
            if j.rel_path:
                try:
                    safe_join(s.exports_dir, j.rel_path).unlink(missing_ok=True)
                except ValueError:
                    pass
            j.status = "expired"
            n += 1
        # 작업 도중 worker 가 죽은 경우 → 실패 처리
        stale = utcnow() - dt.timedelta(hours=6)
        for j in db.scalars(select(ExportJob).where(ExportJob.status == "running", ExportJob.started_at < stale)):
            j.status, j.error, j.finished_at = "failed", "작업이 중단되었습니다(서비스 재시작).", utcnow()
    return n


def reset_orphan_running(instance_started: dt.datetime) -> None:
    """worker 시작 시, 이전 실행에서 running 으로 남은 작업을 다시 대기열로."""
    with session_scope() as db:
        for j in db.scalars(select(ExportJob).where(ExportJob.status == "running")):
            j.status, j.progress, j.cancel_requested = "queued", 0, False
    work = get_settings().exports_dir / ".work"
    if work.exists():
        for f in work.iterdir():
            try:
                f.unlink()
            except OSError:
                pass
