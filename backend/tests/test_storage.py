"""녹화 구간 확정·복구·보관 정리·내보내기 시험 (FFmpeg 합성 영상 사용 — 실제 카메라 영상 아님)."""
from __future__ import annotations

import datetime as dt
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from nvr.config import get_settings
from nvr.db import session_scope
from nvr.models import Camera, ExportJob, RecordingSegment, Site, User
from nvr.recorder.segments import finalize_segment, reindex_orphans
from nvr.storage import segment_rel_path


def make_frag_mp4(path: Path, seconds: int = 6):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=320x240:rate=10:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:v", "libx264", "-g", "20",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
                    str(path)], check=True)


@pytest.fixture(scope="module")
def cam():
    with session_scope() as db:
        s = Site(name="저장시험", code="ST", allowed_networks=["192.0.2.0/24"])
        db.add(s)
        db.flush()
        c = Camera(site_id=s.id, name="저장-1", connection_type="rtsp", host="192.0.2.30",
                   main_stream_url="rtsp://192.0.2.30/m", retention_days=1)
        db.add(c)
        db.flush()
        return c.id


def test_finalize_atomic_and_indexed(cam, tmp_path):
    src = tmp_path / "seg_1.mp4"
    make_frag_mp4(src)
    start = dt.datetime(2026, 5, 1, 1, 0, 0, tzinfo=dt.timezone.utc)
    seg = finalize_segment(cam, src, start, 6.0, "continuous", {"video": "h264"})
    assert seg is not None and not src.exists()
    final = get_settings().recordings_dir / seg.rel_path
    assert final.exists() and not list(final.parent.glob(".*.tmp"))
    head = final.read_bytes()[:4096]
    assert b"moov" in head  # faststart: 브라우저가 바로 탐색 가능
    assert seg.video_codec == "h264" and seg.audio_codec == "aac" and seg.duration_ms == 6000


def test_reindex_orphan_files(cam, tmp_path):
    """DB 삽입 전에 죽은 경우: 파일은 있고 인덱스가 없음 → 재색인."""
    src = tmp_path / "seg_2.mp4"
    make_frag_mp4(src, 4)
    start = dt.datetime(2026, 5, 1, 2, 0, 0, tzinfo=dt.timezone.utc)
    rel = segment_rel_path(cam, start, 4000)
    dst = get_settings().recordings_dir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c", "copy", "-movflags", "+faststart", str(dst)], check=True)
    assert reindex_orphans() >= 1
    with session_scope() as db:
        s = db.scalar(select(RecordingSegment).where(RecordingSegment.rel_path == rel))
        assert s and s.start_at == start and s.duration_ms == 4000


def test_retention_keeps_protected(cam, tmp_path):
    from nvr.worker.retention import apply_retention

    old = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)
    paths = []
    with session_scope() as db:
        for i, prot in enumerate((False, True)):
            rel = segment_rel_path(cam, old + dt.timedelta(minutes=i), 1000)
            p = get_settings().recordings_dir / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"x" * 2048)
            paths.append(p)
            db.add(RecordingSegment(camera_id=cam, start_at=old + dt.timedelta(minutes=i),
                                    end_at=old + dt.timedelta(minutes=i, seconds=1), duration_ms=1000, rel_path=rel,
                                    size_bytes=2048, protected=prot))
    rep = apply_retention()
    assert rep["by_age"] >= 1
    assert not paths[0].exists() and paths[1].exists()  # 보호 구간 유지
    with session_scope() as db:
        rows = db.scalars(select(RecordingSegment).where(RecordingSegment.camera_id == cam,
                                                         RecordingSegment.start_at < dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2))).all()
        assert len(rows) == 1 and rows[0].protected


def test_deleting_rows_resume(cam):
    """'deleting' 표시 후 중단된 삭제를 다음 회차에 마무리(파일·인덱스 일관성)."""
    from nvr.worker.retention import finish_deleting

    t = dt.datetime(2026, 5, 2, tzinfo=dt.timezone.utc)
    rel = segment_rel_path(cam, t, 1000)
    p = get_settings().recordings_dir / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"y" * 100)
    with session_scope() as db:
        db.add(RecordingSegment(camera_id=cam, start_at=t, end_at=t + dt.timedelta(seconds=1), duration_ms=1000,
                                rel_path=rel, size_bytes=100, status="deleting"))
    removed, _ = finish_deleting()
    assert removed >= 1 and not p.exists()
    with session_scope() as db:
        assert db.scalar(select(RecordingSegment).where(RecordingSegment.rel_path == rel)) is None


@pytest.mark.parametrize("mode,wm", [("copy", False), ("exact", True)])
def test_export_job(cam, tmp_path, mode, wm):
    from nvr.worker.exports import run_job

    base = dt.datetime(2026, 6, 1, 3, 0, 0, tzinfo=dt.timezone.utc)
    with session_scope() as db:
        for i in range(2):
            src = tmp_path / f"e{mode}{i}.mp4"
            make_frag_mp4(src, 6)
            finalize_segment(cam, src, base + dt.timedelta(seconds=6 * i), 6.0, "continuous")
        uid = db.scalar(select(User.id).where(User.username == "admin"))
        job = ExportJob(user_id=uid, camera_id=cam, start_at=base + dt.timedelta(seconds=2.5),
                        end_at=base + dt.timedelta(seconds=9.5), mode=mode, watermark=wm)
        db.add(job)
        db.flush()
        jid = job.id
    run_job(jid)
    with session_scope() as db:
        j = db.get(ExportJob, jid)
        assert j.status == "done", j.error
        out = get_settings().exports_dir / j.rel_path
        assert out.exists() and len(j.sha256) == 64
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
                                   capture_output=True, text=True).stdout)
        if mode == "exact":
            assert abs(dur - 7.0) < 0.3
        else:
            assert dur >= 6.9 and "키프레임" in j.note  # 원본 복사는 앞 키프레임부터 시작함을 명시
        # 디코딩 검증(재생 가능 여부)
        r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(out), "-f", "null", "-"], capture_output=True, text=True)
        assert r.returncode == 0 and not r.stderr.strip()
