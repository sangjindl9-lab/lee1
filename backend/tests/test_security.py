"""보안 단위 시험: SSRF 방어, 인증정보 가림, 토큰, 비밀번호 정책, 암호화."""
from __future__ import annotations

import time

import pytest

from nvr.security import crypto
from nvr.security.netguard import TargetDenied, check_host, check_url, validate_network_list
from nvr.security.passwords import hash_password, validate_password_policy, verify_password
from nvr.security.redact import redact

NETS = ["192.0.2.0/24", "10.20.0.0/16"]


@pytest.mark.parametrize("url", [
    "rtsp://127.0.0.1/stream",
    "rtsp://localhost:554/x",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "rtsp://0.0.0.0/",
    "rtsp://224.0.0.1/",
    "http://[::ffff:127.0.0.1]/",
])
def test_blocked_targets(url):
    # 관리자가 전체 대역을 허용해도 항상 차단 목록이 우선
    with pytest.raises(TargetDenied) as e:
        check_url(url, ["0.0.0.0/0", "::/0"])
    assert e.value.code == "address_blocked"


def test_outside_allowed_network():
    with pytest.raises(TargetDenied) as e:
        check_url("rtsp://8.8.8.8/x", NETS)
    assert e.value.code == "address_not_allowed"


def test_allowed_and_pinned():
    c = check_url("rtsp://192.0.2.5:554/live?ch=1", NETS)
    assert c.url == "rtsp://192.0.2.5:554/live?ch=1" and c.ip == "192.0.2.5"


def test_credentials_in_url_rejected():
    with pytest.raises(TargetDenied) as e:
        check_url("rtsp://admin:pw@192.0.2.5/x", NETS)
    assert e.value.code == "credentials_in_url"


@pytest.mark.parametrize("url", ["file:///etc/passwd", "concat:a|b", "rtsp://192.0.2.5/a b", "-i rtsp://192.0.2.5/", "gopher://192.0.2.5/"])
def test_bad_schemes_and_injection(url):
    with pytest.raises(TargetDenied):
        check_url(url, NETS, schemes={"rtsp", "rtsps"})


def test_no_networks_configured():
    with pytest.raises(TargetDenied) as e:
        check_host("192.0.2.5", [])
    assert e.value.code == "no_allowed_networks"


def test_network_list_validation():
    assert validate_network_list(["192.168.1.0/24"]) == ["192.168.1.0/24"]
    for bad in (["127.0.0.0/8"], ["169.254.0.0/16"], ["0.0.0.0/0"], ["10.0.0.0/7"], ["abc"]):
        with pytest.raises(TargetDenied):
            validate_network_list(bad)


def test_deny_networks_env(monkeypatch):
    from nvr.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("NVR_DENY_NETWORKS", "10.20.5.0/24")
    try:
        with pytest.raises(TargetDenied):
            check_host("10.20.5.9", NETS)
        assert check_host("10.20.6.9", NETS).ip == "10.20.6.9"
    finally:
        monkeypatch.delenv("NVR_DENY_NETWORKS")
        get_settings.cache_clear()


def test_redact():
    s = "rtsp://admin:S3cr%40t@192.0.2.5/x failed; pass=S3cr@t Authorization: Digest abc"
    out = redact(s, ["S3cr@t"])
    assert "S3cr" not in out and "admin:" not in out and "abc" not in out


def test_media_token_roundtrip_and_tamper():
    tok, exp = crypto.sign_media_token({"u": 1, "p": "cam1_sub"}, 60)
    assert crypto.verify_media_token(tok)["p"] == "cam1_sub"
    body, sig = tok.split(".")
    assert crypto.verify_media_token(body + "." + sig[:-2] + "AA") is None
    expired, _ = crypto.sign_media_token({"u": 1}, -1)
    assert crypto.verify_media_token(expired) is None


def test_secret_encryption():
    enc = crypto.encrypt_secret("카메라비번!")
    assert "카메라" not in enc and crypto.decrypt_secret(enc) == "카메라비번!"


def test_password_hash_and_policy():
    h = hash_password("Abcdef#12345")
    assert h.startswith("$argon2id$") and verify_password(h, "Abcdef#12345") and not verify_password(h, "x")
    assert verify_password(None, "anything") is False
    assert validate_password_policy("short") is not None
    assert validate_password_policy("alllowercase1") is not None
    assert validate_password_policy("Admin#2026xx", "admin") is not None
    assert validate_password_policy("Good#Pass2026") is None


def test_token_timing_cost_exists():
    t = time.perf_counter()
    verify_password(None, "x")
    assert time.perf_counter() - t > 0.005  # 없는 계정도 해시 비용 발생(계정 존재 추정 방지)
