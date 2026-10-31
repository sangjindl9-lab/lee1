"""운영체제 차이(리눅스·윈도우)를 한곳에서 처리한다.

- 하위 프로세스: 윈도우에서 콘솔 창을 띄우지 않음(CREATE_NO_WINDOW)
- 서비스 정지 신호: SIGTERM(리눅스·Docker), SIGINT(Ctrl+C·WinSW), SIGBREAK(윈도우)
- FFmpeg 정상 종료: 리눅스는 SIGINT, 윈도우는 표준입력 'q'(윈도우 서비스에는 콘솔이 없어 Ctrl 이벤트를 보낼 수 없음)
- 파일 교체·삭제: 윈도우는 다른 프로세스가 연 파일을 바꾸거나 지울 수 없어 잠시 재시도
"""
from __future__ import annotations

import os
import signal
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

IS_WINDOWS = os.name == "nt"


def popen_flags() -> dict:
    if os.name == "nt":  # 실제 운영체제 기준(시험에서 IS_WINDOWS 를 바꿔도 영향 없음)
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)}
    return {}


def install_stop_handler(fn: Callable[..., None]) -> None:
    for name in ("SIGTERM", "SIGINT", "SIGBREAK"):
        sig = getattr(signal, name, None)
        if sig is not None:
            try:
                signal.signal(sig, fn)
            except (OSError, ValueError):  # 주 스레드가 아니거나 지원하지 않는 신호
                pass


def ffmpeg_stdin() -> int:
    """FFmpeg 표준입력: 윈도우는 'q' 를 보내 정상 종료하기 위해 파이프."""
    return subprocess.PIPE if IS_WINDOWS else subprocess.DEVNULL


def ffmpeg_nostdin() -> list[str]:
    return [] if IS_WINDOWS else ["-nostdin"]


def ffmpeg_graceful_stop(proc: subprocess.Popen, timeout: float = 15) -> None:
    """현재 구간을 닫고 끝나도록 요청하고, 시간 안에 안 끝나면 강제 종료."""
    if proc.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            if proc.stdin:
                proc.stdin.write(b"q")
                proc.stdin.flush()
                proc.stdin.close()
            else:
                proc.terminate()
        else:
            proc.send_signal(signal.SIGINT)
        proc.wait(timeout=timeout)
    except (subprocess.TimeoutExpired, OSError, ValueError):
        proc.kill()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def kill_orphan(pid: int, must_contain: str, timeout: float = 15) -> bool:
    """pid 가 아직 살아 있고 명령줄에 must_contain(작업 폴더)이 있으면 종료. 다른 프로세스는 건드리지 않는다."""
    import psutil

    try:
        p = psutil.Process(pid)
        cmd = " ".join(p.cmdline())
    except (psutil.Error, OSError):
        return False
    if must_contain not in cmd:
        return False
    try:
        if IS_WINDOWS:
            p.kill()  # 콘솔·표준입력이 없어 정상 종료 요청 불가 — 조각화 MP4 라 마지막 조각까지 복구됨
        else:
            p.send_signal(signal.SIGINT)
        p.wait(timeout)
    except psutil.TimeoutExpired:
        p.kill()
    except psutil.Error:
        pass
    return True


def replace_retry(src: str | os.PathLike, dst: str | os.PathLike, tries: int = 30, delay: float = 0.1) -> None:
    for i in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if not IS_WINDOWS or i == tries - 1:
                raise
            time.sleep(delay)


def unlink_retry(path: str | os.PathLike, tries: int = 5, delay: float = 0.2, missing_ok: bool = True) -> None:
    for i in range(tries):
        try:
            os.unlink(path)
            return
        except FileNotFoundError:
            if missing_ok:
                return
            raise
        except PermissionError:
            if not IS_WINDOWS or i == tries - 1:
                raise
            time.sleep(delay)


def ca_file() -> str:
    """RTSPS 인증서 검증용 CA 묶음."""
    if not IS_WINDOWS and Path("/etc/ssl/certs/ca-certificates.crt").exists():
        return "/etc/ssl/certs/ca-certificates.crt"
    try:
        import certifi

        return certifi.where()
    except ImportError:
        return ""


def default_font() -> str:
    if IS_WINDOWS:
        windir = os.environ.get("WINDIR", r"C:\Windows")
        for name in ("malgun.ttf", "arial.ttf"):
            p = Path(windir) / "Fonts" / name
            if p.exists():
                return str(p)
        return str(Path(windir) / "Fonts" / "arial.ttf")
    return "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def ffmpeg_filter_path(path: str) -> str:
    """FFmpeg 필터 인자 안의 파일 경로(윈도우 'C:\\..' → 'C\\:/..')."""
    p = path.replace("\\", "/")
    return p.replace(":", "\\:")
