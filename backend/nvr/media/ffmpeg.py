"""FFmpeg/ffprobe 호출 도우미. 셸을 사용하지 않고 인자 배열로만 실행한다."""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from ..config import get_settings
from ..osutil import ca_file, popen_flags
from ..security.netguard import TargetDenied, check_url
from ..security.redact import redact

INPUT_PROTOCOLS = "rtsp,rtsps,rtp,srtp,udp,tcp,tls,https,http,crypto"

SUPPORTED_VIDEO = {"h264", "hevc"}
MP4_AUDIO_COPY = {"aac"}
AUDIO_TRANSCODE = {"pcm_mulaw", "pcm_alaw", "adpcm_g726", "g726", "g722"}

ERROR_TEXT = {
    "auth_failed": "인증 실패 — 카메라 아이디/비밀번호를 확인하세요.",
    "forbidden": "접근 거부(403) — 계정 권한 또는 카메라 접근 제한을 확인하세요.",
    "stream_not_found": "스트림 경로를 찾을 수 없음(404) — RTSP 주소를 확인하세요.",
    "connection_refused": "연결 거부 — 포트 번호와 카메라 RTSP 서비스 사용 여부를 확인하세요.",
    "timeout": "연결 시간 초과 — 네트워크 경로·방화벽·카메라 전원을 확인하세요.",
    "unreachable": "네트워크에 도달할 수 없음 — 라우팅·VPN을 확인하세요.",
    "server_error": "카메라 서버 오류(5xx) — 동시 접속 한도 초과일 수 있습니다.",
    "invalid_stream": "스트림 데이터 오류 — 코덱/전송 방식을 확인하세요.",
    "no_video": "영상 트랙이 없습니다.",
    "codec_unsupported": "지원하지 않는 영상 코덱입니다(H.264/H.265만 지원).",
    "stream_ended": "스트림이 끊어졌습니다.",
    "disk_full": "저장공간 부족 — 디스크에 쓸 수 없습니다.",
    "disk_write_error": "디스크 쓰기 실패.",
    "tls_error": "TLS 오류 — 인증서 또는 RTSPS 지원 여부를 확인하세요.",
    "unknown": "알 수 없는 오류",
}


def classify_error(stderr: str, timed_out: bool = False) -> str:
    s = stderr.lower()
    if "401" in s and "unauthorized" in s:
        return "auth_failed"
    if "403" in s and "forbidden" in s:
        return "forbidden"
    if "404" in s and "not found" in s:
        return "stream_not_found"
    if "no space left" in s:
        return "disk_full"
    if "connection refused" in s:
        return "connection_refused"
    if "no route to host" in s or "network is unreachable" in s:
        return "unreachable"
    if "tls" in s and ("handshake" in s or "certificate" in s):
        return "tls_error"
    if "5xx" in s or "503" in s or "500 internal" in s:
        return "server_error"
    if "timed out" in s or "timeout" in s or timed_out:
        return "timeout"
    if "error writing" in s or "i/o error" in s or "permission denied" in s and "/recordings" in s:
        return "disk_write_error"
    if "invalid data" in s or "could not find codec" in s:
        return "invalid_stream"
    return "unknown"


@dataclass
class StreamSource:
    """연결 직전에 만드는 입력 정보. url 에는 인증정보가 들어가므로 로그·응답에 쓰지 않는다."""

    url: str
    safe_url: str  # 인증정보 없는 표시용
    transport: str
    secrets: list[str] = field(default_factory=list)
    tls_insecure: bool = False


def build_source(url: str, username: str, password: str, transport: str, allowed_networks: list[str],
                 tls_insecure: bool = False) -> StreamSource:
    checked = check_url(url, allowed_networks, schemes={"rtsp", "rtsps"})
    if checked.scheme == "rtsps" and not tls_insecure:
        # 인증서 호스트 이름 검증을 위해 원래 호스트 이름을 유지(검증은 위에서 완료)
        parts = urlsplit(url)
        base = urlunsplit((parts.scheme, parts.netloc, parts.path or "/", parts.query, ""))
    else:
        base = checked.url
    parts = urlsplit(base)
    if username:
        userinfo = quote(username, safe="") + (":" + quote(password, safe="") if password else "")
        netloc = f"{userinfo}@{parts.netloc}"
    else:
        netloc = parts.netloc
    full = urlunsplit((parts.scheme, netloc, parts.path, parts.query, ""))
    if transport not in ("tcp", "udp"):
        transport = "tcp"
    return StreamSource(url=full, safe_url=base, transport=transport, secrets=[s for s in (password,) if s],
                        tls_insecure=tls_insecure)


def input_args(src: StreamSource, timeout_s: int = 10) -> list[str]:
    args = [
        "-rtsp_transport", src.transport,
        "-timeout", str(timeout_s * 1_000_000),
        "-protocol_whitelist", INPUT_PROTOCOLS,
    ]
    if src.url.startswith("rtsps://") and not src.tls_insecure:
        args += ["-tls_verify", "1", "-ca_file", ca_file()]
    if not (src.url.startswith("rtsp://") or src.url.startswith("rtsps://")):
        raise TargetDenied("bad_scheme", "RTSP/RTSPS 주소만 사용할 수 있습니다.")
    return args + ["-i", src.url]


@dataclass
class ProbeResult:
    ok: bool
    error_code: str = ""
    error_message: str = ""
    video: dict[str, Any] | None = None
    audio: dict[str, Any] | None = None
    bitrate_kbps: float | None = None
    measured_fps: float | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "video": self.video,
            "audio": self.audio,
            "bitrate_kbps": self.bitrate_kbps,
            "measured_fps": self.measured_fps,
            "warnings": self.warnings,
        }


def _fps(rate: str | None) -> float | None:
    try:
        n, d = (rate or "0/0").split("/")
        return round(int(n) / int(d), 2) if int(d) else None
    except (ValueError, ZeroDivisionError):
        return None


def probe_stream(src: StreamSource, sample_seconds: int = 4, timeout_s: int = 25) -> ProbeResult:
    """한 번의 연결로 스트림 정보 + 몇 초 분량 패킷 크기를 읽어 실측 비트레이트/FPS를 계산."""
    s = get_settings()
    args = [s.ffprobe_path, "-v", "error", *input_args(src, timeout_s=8)[:-2],
            "-read_intervals", f"%+{sample_seconds}",
            "-show_entries",
            "stream=index,codec_type,codec_name,profile,width,height,r_frame_rate,avg_frame_rate,"
            "sample_rate,channels,has_b_frames,pix_fmt:packet=stream_index,size,pts_time,flags",
            "-of", "json", src.url]
    try:
        proc = subprocess.run(args, capture_output=True, timeout=timeout_s, check=False, **popen_flags())
    except subprocess.TimeoutExpired:
        return ProbeResult(ok=False, error_code="timeout", error_message=ERROR_TEXT["timeout"])
    stderr = redact(proc.stderr.decode("utf-8", "replace"), src.secrets)
    if proc.returncode != 0:
        code = classify_error(stderr)
        return ProbeResult(ok=False, error_code=code, error_message=f"{ERROR_TEXT.get(code, '')} ({stderr.strip()[-300:]})")
    try:
        data = json.loads(proc.stdout or b"{}")
    except ValueError:
        return ProbeResult(ok=False, error_code="invalid_stream", error_message=ERROR_TEXT["invalid_stream"])
    streams = data.get("streams", [])
    packets = data.get("packets", [])
    v = next((x for x in streams if x.get("codec_type") == "video"), None)
    a = next((x for x in streams if x.get("codec_type") == "audio"), None)
    res = ProbeResult(ok=True)
    if not v:
        return ProbeResult(ok=False, error_code="no_video", error_message=ERROR_TEXT["no_video"])
    res.video = {
        "codec": v.get("codec_name"),
        "profile": v.get("profile"),
        "width": v.get("width"),
        "height": v.get("height"),
        "fps": _fps(v.get("avg_frame_rate")) or _fps(v.get("r_frame_rate")),
        "has_b_frames": int(v.get("has_b_frames") or 0),
        "pix_fmt": v.get("pix_fmt"),
    }
    if a:
        res.audio = {"codec": a.get("codec_name"), "sample_rate": a.get("sample_rate"), "channels": a.get("channels")}
    total = sum(int(p.get("size", 0)) for p in packets)
    times = [float(p["pts_time"]) for p in packets if p.get("pts_time") not in (None, "N/A")]
    span = (max(times) - min(times)) if len(times) > 1 else 0
    if span > 0.5:
        res.bitrate_kbps = round(total * 8 / span / 1000, 1)
        vidx = v.get("index")
        vframes = [p for p in packets if p.get("stream_index") == vidx]
        vt = [float(p["pts_time"]) for p in vframes if p.get("pts_time") not in (None, "N/A")]
        if len(vt) > 1 and max(vt) > min(vt):
            res.measured_fps = round((len(vt) - 1) / (max(vt) - min(vt)), 2)
    codec = res.video["codec"]
    if codec not in SUPPORTED_VIDEO:
        res.ok = False
        res.error_code = "codec_unsupported"
        res.error_message = f"{ERROR_TEXT['codec_unsupported']} (감지: {codec})"
    if codec == "hevc":
        res.warnings.append("H.265 영상은 브라우저 실시간 재생이 제한될 수 있습니다(Chrome은 Windows+지원 GPU, Safari 지원). 웹 시청용 서브 스트림은 H.264를 권장합니다.")
    if codec == "h264" and res.video["has_b_frames"]:
        res.warnings.append("B-프레임이 포함된 H.264는 WebRTC로 재생되지 않습니다. 카메라에서 B-프레임을 끄거나 HLS로 시청하세요.")
    if a and a.get("codec_name") in AUDIO_TRANSCODE:
        res.warnings.append("G.711 등 음성은 녹화 시 AAC로 변환 저장됩니다(영상은 원본 그대로).")
    return res


def grab_snapshot(src: StreamSource, timeout_s: int = 20) -> tuple[bytes | None, str, str]:
    """RTSP에서 키프레임 1장을 JPEG으로 추출. (jpeg, error_code, error_message)"""
    s = get_settings()
    args = [s.ffmpeg_path, "-hide_banner", "-nostdin", "-loglevel", "error", *input_args(src, timeout_s=8),
            "-frames:v", "1", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1"]
    try:
        proc = subprocess.run(args, capture_output=True, timeout=timeout_s, check=False, **popen_flags())
    except subprocess.TimeoutExpired:
        return None, "timeout", ERROR_TEXT["timeout"]
    if proc.returncode != 0 or not proc.stdout:
        err = redact(proc.stderr.decode("utf-8", "replace"), src.secrets)
        code = classify_error(err)
        return None, code, ERROR_TEXT.get(code, "") + f" ({err.strip()[-200:]})"
    return proc.stdout, "", ""


def ffprobe_file(path: str, timeout_s: int = 30) -> dict[str, Any] | None:
    s = get_settings()
    try:
        proc = subprocess.run(
            [s.ffprobe_path, "-v", "error", "-show_entries",
             "format=duration,size:stream=codec_type,codec_name,width,height", "-of", "json", path],
            capture_output=True, timeout=timeout_s, check=False, **popen_flags(),
        )
    except subprocess.TimeoutExpired:
        return None
    if proc.returncode != 0:
        return None
    try:
        return json.loads(proc.stdout or b"{}")
    except ValueError:
        return None
