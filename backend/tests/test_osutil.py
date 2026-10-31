"""윈도우 호환 처리 시험(리눅스에서 윈도우 경로를 흉내 내어 확인할 수 있는 부분).

실제 윈도우에서의 동작(서비스·파일 잠금·FFmpeg 윈도우 빌드)은 docs/03-검증결과.md 의 윈도우 항목 참조.
"""
from __future__ import annotations

import datetime as dt
import shutil
import subprocess
import sys
import time

import pytest

from nvr import osutil
from nvr.recorder.segments import SEG_PATTERN, name_epoch, seg_files

FFMPEG = shutil.which("ffmpeg")


def test_segment_names_new_and_old():
    t = dt.datetime(2026, 10, 31, 1, 2, 3, tzinfo=dt.timezone.utc)
    e = int(t.timestamp())
    assert name_epoch(t.strftime(SEG_PATTERN)) == e
    assert name_epoch(f"seg_{e}.mp4") == e  # 이전 버전 이름(복구 호환)
    assert name_epoch("seg_abc.mp4") is None and name_epoch("list.csv") is None
    # FFmpeg 가 UTC 대신 현지 시각(KST, +9h)으로 이름을 쓴 경우 파일 수정 시각으로 보정
    kst_name = (t + dt.timedelta(hours=9)).strftime(SEG_PATTERN)
    assert name_epoch(kst_name, ref=e + 10) == e
    # 인도(+5:30)처럼 30분 단위 시차도 보정
    ist_name = (t + dt.timedelta(hours=5, minutes=30)).strftime(SEG_PATTERN)
    assert name_epoch(ist_name, ref=e + 59) == e
    # 정상(UTC) 이름은 그대로
    assert name_epoch(t.strftime(SEG_PATTERN), ref=e + 60) == e


def test_seg_files_sorted(tmp_path):
    for n in ("seg_20261031010203.mp4", "seg_20261031010103.mp4", "seg_1793000000.mp4", "other.mp4"):
        (tmp_path / n).write_bytes(b"x")
    assert seg_files(tmp_path)[0] == "seg_1793000000.mp4"
    assert seg_files(tmp_path)[1:] == ["seg_20261031010103.mp4", "seg_20261031010203.mp4"]


def test_filter_path_and_font():
    assert osutil.ffmpeg_filter_path(r"C:\Windows\Fonts\malgun.ttf") == "C\\:/Windows/Fonts/malgun.ttf"
    assert osutil.ffmpeg_filter_path("/usr/share/fonts/a.ttf") == "/usr/share/fonts/a.ttf"
    assert osutil.default_font()
    assert osutil.ca_file()


def test_stop_handler_installs():
    called = []
    osutil.install_stop_handler(lambda *a: called.append(a))
    import signal

    assert signal.getsignal(signal.SIGTERM) is not signal.SIG_DFL
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.default_int_handler)


@pytest.mark.skipif(not FFMPEG, reason="ffmpeg 없음")
@pytest.mark.parametrize("windows", [False, True])
def test_ffmpeg_graceful_stop_closes_segment(tmp_path, monkeypatch, windows):
    """윈도우 방식(표준입력 'q')과 리눅스 방식(SIGINT) 모두 마지막 구간이 재생 가능한 상태로 닫혀야 한다."""
    monkeypatch.setattr(osutil, "IS_WINDOWS", windows)
    args = [FFMPEG, "-hide_banner", *osutil.ffmpeg_nostdin(), "-loglevel", "error", "-re", "-f", "lavfi",
            "-i", "testsrc=size=320x240:rate=10", "-c:v", "libx264", "-g", "10", "-f", "segment", "-segment_time", "2",
            "-reset_timestamps", "1", "-strftime", "1", "-segment_format", "mp4",
            "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
            str(tmp_path / SEG_PATTERN)]
    proc = subprocess.Popen(args, stdin=osutil.ffmpeg_stdin(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            env={"TZ": "UTC0", "PATH": "/usr/bin:/bin"})
    time.sleep(3.2)
    t0 = time.time()
    osutil.ffmpeg_graceful_stop(proc, timeout=10)
    assert time.time() - t0 < 8, "정상 종료 요청이 무시되어 강제 종료됨"
    assert proc.returncode in (0, 255), proc.stderr.read()  # SIGINT 정상 종료는 255(received signal 2)
    files = seg_files(tmp_path)
    assert len(files) >= 2
    from nvr.media.ffmpeg import ffprobe_file

    last = ffprobe_file(str(tmp_path / files[-1]))
    assert last and float(last["format"]["duration"]) > 0.3
    # 이름의 시각이 UTC 현재 시각과 맞는지(TZ=UTC0 적용)
    assert abs(name_epoch(files[0]) - (time.time() - 3.5)) < 3


def test_kill_orphan_only_matching(tmp_path):
    marker = str(tmp_path / "run_123")
    p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", marker])
    q = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        assert osutil.kill_orphan(q.pid, marker) is False
        assert q.poll() is None
        assert osutil.kill_orphan(p.pid, marker) is True
        p.wait(5)
        assert p.poll() is not None
        assert osutil.kill_orphan(999999, marker) is False
    finally:
        for x in (p, q):
            if x.poll() is None:
                x.kill()


def test_replace_and_unlink_retry(tmp_path, monkeypatch):
    a, b = tmp_path / "a", tmp_path / "b"
    a.write_text("1")
    calls = {"n": 0}
    real = osutil.os.replace

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] < 3:
            raise PermissionError("in use")  # 윈도우: 다른 프로세스가 열어 둔 파일
        return real(src, dst)

    monkeypatch.setattr(osutil, "IS_WINDOWS", True)
    monkeypatch.setattr(osutil.os, "replace", flaky)
    osutil.replace_retry(a, b, delay=0.01)
    assert b.read_text() == "1" and calls["n"] == 3
    osutil.unlink_retry(tmp_path / "none")
    monkeypatch.setattr(osutil, "IS_WINDOWS", False)
    monkeypatch.setattr(osutil.os, "replace", lambda s, d: (_ for _ in ()).throw(PermissionError("x")))
    with pytest.raises(PermissionError):
        osutil.replace_retry(b, a)  # 리눅스는 재시도하지 않음(권한 문제는 즉시 오류)


def test_interfaces_and_encoder():
    from nvr.onvif.discovery import local_interfaces
    from nvr.worker.exports import h264_encoder_args

    ifs = local_interfaces()
    assert all(not i["ip"].startswith("127.") for i in ifs)
    if FFMPEG:
        assert h264_encoder_args()[1] in ("libx264", "libopenh264", "h264_mf")


def test_mediamtx_listen_host(monkeypatch):
    from nvr.config import get_settings
    from nvr.worker import mediamtx_config

    s = get_settings()
    monkeypatch.setattr(s, "mediamtx_listen_host", "127.0.0.1")
    out = mediamtx_config.render()
    assert 'hlsAddress: "127.0.0.1:8888"' in out and 'webrtcAddress: "127.0.0.1:8889"' in out
    assert "webrtcLocalUDPAddress: :8189" in out  # 미디어 UDP 는 공개
    monkeypatch.setattr(s, "mediamtx_listen_host", "")
    assert "hlsAddress: :8888" in mediamtx_config.render()
