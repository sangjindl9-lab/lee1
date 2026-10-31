"""mediamtx 설정 파일 생성(경로 목록 포함). mediamtx 의 공식 핫 리로드로 반영된다.

- mediamtx Control API 는 사용하지 않는다(api: no) — 관리 API 표면을 열지 않기 위함.
- 생성 파일에는 카메라 인증정보가 들어가므로 0600 권한으로 쓰고, mediamtx·worker 만 마운트한다.
- YAML 은 JSON 호환 문자열 표기를 사용해 특수문자 주입을 막는다.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

from sqlalchemy import select

from ..camera_util import mediamtx_path
from ..config import get_keys, get_settings
from ..db import session_scope
from ..models import Camera
from ..security.crypto import decrypt_secret
from ..security.netguard import TargetDenied, check_url
from ..osutil import replace_retry

log = logging.getLogger("nvr.worker.mediamtx")


def q(v: str) -> str:
    return json.dumps(v, ensure_ascii=False)


def _source_url(url: str, user: str, password: str, nets: list[str]) -> str | None:
    try:
        checked = check_url(url, nets, schemes={"rtsp"})  # RTSPS 시청은 인증서 지문 설정이 필요해 1단계 제외
    except TargetDenied as exc:
        log.warning("시청 경로 제외(%s): %s", exc.code, exc.message)
        return None
    parts = urlsplit(checked.url)
    netloc = parts.netloc
    if user:
        netloc = quote(user, safe="") + (":" + quote(password, safe="") if password else "") + "@" + netloc
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, ""))


def render() -> str:
    s = get_settings()
    base = Path(s.mediamtx_base_config_path).read_text(encoding="utf-8")
    hosts = [h.strip() for h in s.public_hosts.split(",") if h.strip()]
    stuns = [h.strip() for h in s.stun_servers.split(",") if h.strip()]
    auth_url = f"{s.mediamtx_auth_url}?key={get_keys().mediamtx_hook_key}"
    base = (base.replace("__AUTH_HTTP_ADDRESS__", q(auth_url))
                .replace("__WEBRTC_ADDITIONAL_HOSTS__", "[" + ", ".join(q(h) for h in hosts) + "]")
                .replace("__WEBRTC_TCP_ADDRESS__", q(":8189" if s.webrtc_tcp else ""))
                .replace("__WEBRTC_ICE_SERVERS__", "[" + ", ".join("{url: " + q(u) + "}" for u in stuns) + "]"))
    if s.mediamtx_listen_host:
        # 설치형(윈도우 등): HLS·WebRTC 신호 포트는 프록시(caddy)만 접근하도록 내부 주소에 묶는다(UDP 미디어 포트는 공개)
        h = s.mediamtx_listen_host
        base = (base.replace("hlsAddress: :8888", f"hlsAddress: {q(h + ':8888')}")
                    .replace("webrtcAddress: :8889", f"webrtcAddress: {q(h + ':8889')}"))
    lines = [base.rstrip(), "", "paths:"]
    with session_scope() as db:
        cams = db.scalars(select(Camera).where(Camera.deleted_at.is_(None), Camera.enabled.is_(True))
                          .order_by(Camera.id)).all()
        for c in cams:
            nets = [str(n) for n in c.site.allowed_networks]
            try:
                pw = decrypt_secret(c.password_enc)
            except RuntimeError:
                continue
            for which, url in (("main", c.main_stream_url), ("sub", c.sub_stream_url)):
                if not url:
                    continue
                src = _source_url(url, c.username, pw, nets)
                if not src:
                    continue
                lines += [
                    f"  {mediamtx_path(c.id, which)}:",
                    f"    source: {q(src)}",
                    "    sourceOnDemand: yes",
                    "    sourceOnDemandStartTimeout: 10s",
                    "    sourceOnDemandCloseAfter: 15s",
                    f"    rtspTransport: {q(c.rtsp_transport if c.rtsp_transport in ('tcp', 'udp') else 'tcp')}",
                ]
    if lines[-1] == "paths:":
        lines[-1] = "paths: {}"
    return "\n".join(lines) + "\n"


def sync() -> bool:
    """변경 시에만 원자적으로 교체. 바뀌었으면 True."""
    s = get_settings()
    path = Path(s.mediamtx_config_path)
    content = render()
    try:
        if path.read_text(encoding="utf-8") == content:
            return False
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("." + path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    replace_retry(tmp, path)  # 윈도우: mediamtx 가 읽는 중이면 잠시 재시도
    log.info("mediamtx 설정 갱신(%d bytes)", len(content))
    return True
