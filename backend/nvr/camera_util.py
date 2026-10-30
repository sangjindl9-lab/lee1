"""카메라 → 연결 정보 변환(api / recorder / worker 공용)."""
from __future__ import annotations

from .media.ffmpeg import StreamSource, build_source
from .models import Camera
from .security.crypto import decrypt_secret


def camera_source(cam: Camera, which: str = "main") -> StreamSource:
    url = cam.main_stream_url if which == "main" or not cam.sub_stream_url else cam.sub_stream_url
    password = decrypt_secret(cam.password_enc)
    return build_source(url, cam.username, password, cam.rtsp_transport,
                        [str(n) for n in cam.site.allowed_networks], tls_insecure=cam.tls_insecure)


def mediamtx_path(camera_id: int, which: str) -> str:
    return f"cam{camera_id}_{'main' if which == 'main' else 'sub'}"
