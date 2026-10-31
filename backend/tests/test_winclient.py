"""관제 프로그램(윈도우) — 화면 없이 확인할 수 있는 부분: 설정 저장, 주소 검사, 영상벽 주소, 인증서 지문·신뢰 확인."""
from __future__ import annotations

import hashlib
import ssl
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from nvr import winclient as wc


def test_normalize_url():
    assert wc.normalize_url("192.168.0.10") == "https://192.168.0.10"
    assert wc.normalize_url(" https://nvr.example.com:8443/live ") == "https://nvr.example.com:8443"
    for bad in ("", "http://x", "https://a b", "https://user@host", "ftp://x"):
        with pytest.raises(ValueError):
            wc.normalize_url(bad)


def test_wall_url_escapes():
    assert wc.wall_url("https://h", "모니터2") == "https://h/live?kiosk=1&layout=%EB%AA%A8%EB%8B%88%ED%84%B02"
    assert wc.wall_url("https://h", "a&b=c", 30).endswith("layout=a%26b%3Dc&tour=30")


def test_config_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "local_server_url", lambda: "https://localhost")
    p = tmp_path / "c.json"
    cfg = wc.load_config(p)
    assert cfg["servers"] == [{"name": "이 컴퓨터(서버)", "url": "https://localhost"}]
    cfg["walls"] = [{"screen": 1, "layout": "모니터2", "tour": 0}]
    wc.save_config(cfg, p)
    assert wc.load_config(p)["walls"][0]["layout"] == "모니터2"
    p.write_text("{broken", encoding="utf-8")
    assert wc.load_config(p)["servers"]  # 손상된 설정은 기본값으로


def test_api_validation(tmp_path, monkeypatch):
    monkeypatch.setattr(wc, "config_dir", lambda: tmp_path)
    monkeypatch.setattr(wc, "local_server_url", lambda: None)
    app = wc.ClientApp()
    app.screens = lambda: [{"width": 1920, "height": 1080}, {"width": 1920, "height": 1080}]
    api = wc.Api(app)
    assert "error" in api.add_server("x", "http://plain")
    st = api.add_server("", "10.0.0.5")["state"]
    assert st["servers"][0] == {"name": "10.0.0.5", "url": "https://10.0.0.5"}
    st = api.save_walls([{"screen": 0, "layout": "주"}, {"screen": 1, "layout": "모니터2", "tour": "30"},
                         {"screen": "x"}, {"screen": 2, "layout": ""}], True)
    assert st["walls"] == [{"screen": 1, "layout": "모니터2", "tour": 30}]
    assert api.remove_server(0)["servers"] == []


@pytest.fixture()
def tls_server(tmp_path):
    """자체 CA 로 서명한 HTTPS 서버 + /ca.crt 를 주는 HTTP 서버(설치판 Caddy 구성 흉내)."""
    d = tmp_path
    run = partial(subprocess.run, check=True, capture_output=True, cwd=d)
    run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "2",
         "-subj", "/CN=Test Local Authority"])
    run(["openssl", "req", "-newkey", "rsa:2048", "-nodes", "-keyout", "srv.key", "-out", "srv.csr", "-subj", "/CN=127.0.0.1"])
    (d / "ext").write_text("subjectAltName=IP:127.0.0.1\n")
    run(["openssl", "x509", "-req", "-in", "srv.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out",
         "srv.crt", "-days", "2", "-extfile", "ext"])
    (d / "api").mkdir()
    (d / "api" / "health").write_text('{"ok":true}')
    h = partial(SimpleHTTPRequestHandler, directory=str(d))
    https = ThreadingHTTPServer(("127.0.0.1", 0), h)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(d / "srv.crt", d / "srv.key")
    https.socket = ctx.wrap_socket(https.socket, server_side=True)
    http = ThreadingHTTPServer(("127.0.0.1", 0), h)
    for s in (https, http):
        threading.Thread(target=s.serve_forever, daemon=True).start()
    yield d, f"https://127.0.0.1:{https.server_address[1]}", http.server_address[1]
    https.shutdown()
    http.shutdown()


def test_trust_flow(tls_server, monkeypatch):
    d, base, http_port = tls_server
    ok, why = wc.is_trusted(base)
    assert not ok and why == "certificate"  # 시스템 신뢰 목록에 없는 사설 CA
    pem = wc.fetch_ca(base, http_port)
    der = ssl.PEM_cert_to_DER_cert(pem.decode())
    assert wc.fingerprint(pem).replace(":", "") == hashlib.sha256(der).hexdigest().upper()
    monkeypatch.setenv("SSL_CERT_FILE", str(d / "ca.crt"))  # 신뢰 목록에 넣은 뒤와 같은 상태
    assert wc.is_trusted(base) == (True, "")
    assert wc.is_trusted("https://127.0.0.1:1")[1].startswith("connect")
    (d / "ca.crt").write_text("<html>not a cert</html>")
    with pytest.raises(ValueError):
        wc.fetch_ca(base, http_port)
