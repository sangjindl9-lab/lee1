"""ONVIF 자동 탐색 보조 서비스 — Docker 에서 host 네트워크로 실행해 현장망에 WS-Discovery 를 보낸다.

  python -m nvr.discovery_service   (NVR_DISCOVERY_BIND=172.31.250.1:8099 기본)

- 탐색과 인터페이스 조회만 하며 카메라에 접속하거나 인증정보를 다루지 않는다.
- 요청에는 마스터 키에서 파생한 X-NVR-Key 가 필요하다. NVR 내부 Docker 망 게이트웨이 주소에만 바인딩한다.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import get_keys
from .onvif import discovery

log = logging.getLogger("nvr.discovery")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _ok(self) -> bool:
        if not hmac.compare_digest(self.headers.get("X-NVR-Key", ""), get_keys().discovery_key):
            self.send_response(403)
            self.end_headers()
            return False
        return True

    def _json(self, code: int, obj) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self._ok():
            self._json(200, discovery.local_interfaces()) if self.path == "/interfaces" else self._json(404, {})

    def do_POST(self):
        if not self._ok():
            return
        if self.path != "/discover":
            return self._json(404, {})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", "0")), 4096)) or b"{}")
            res = discovery.probe(body.get("interface_ip") or None, float(min(10, max(1, body.get("timeout", 3)))))
            self._json(200, res)
        except (ValueError, OSError) as exc:
            self._json(400, {"detail": str(exc)})


def main() -> None:
    logging.basicConfig(level="INFO")
    host, _, port = os.environ.get("NVR_DISCOVERY_BIND", "172.31.250.1:8099").rpartition(":")
    get_keys()
    log.info("탐색 서비스 %s:%s", host, port)
    ThreadingHTTPServer((host, int(port)), H).serve_forever()


if __name__ == "__main__":
    main()
