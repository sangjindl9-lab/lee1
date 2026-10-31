"""윈도우 설치판 관리 도구(nvrctl) — 리눅스에서 확인할 수 있는 부분(생성 파일·명령 순서).

실제 윈도우 서비스 등록·icacls·netsh·PostgreSQL 윈도우 빌드 동작은 윈도우 PC 에서 확인해야 한다.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from nvr import winctl

CADDY = os.environ.get("NVR_TEST_CADDY") or shutil.which("caddy")


@pytest.fixture()
def lay(tmp_path):
    inst = tmp_path / "Program Files" / "WebNVR"
    data = tmp_path / "Program Data" / "WebNVR"  # 공백 포함 경로
    (inst / "app" / "web").mkdir(parents=True)
    data.mkdir(parents=True)
    return winctl.Layout(inst, data)


def test_env_roundtrip_and_defaults(lay):
    winctl.write_env(lay.env_file, {"NVR_SITE_ADDRESS": "192.168.0.10", "NVR_ANALYTICS_FPS": "1"})
    cfg = winctl.settings(lay)
    assert cfg["NVR_SITE_ADDRESS"] == "192.168.0.10" and cfg["NVR_DB_PORT"] == "54329"
    assert cfg["NVR_RECORDINGS_DIR"].endswith("recordings")
    with pytest.raises(ValueError):
        winctl.write_env(lay.env_file, {"NVR_X": "a\nNVR_EVIL=1"})
    env = winctl.service_env(lay, cfg)
    assert env["NVR_DATABASE_URL"] == "postgresql+psycopg://nvr@127.0.0.1:54329/nvr"
    assert env["NVR_MEDIAMTX_AUTH_URL"] == "http://127.0.0.1:18000/internal/mediamtx/auth"
    assert env["NVR_MEDIAMTX_LISTEN_HOST"] == "127.0.0.1" and env["NVR_PUBLIC_HOSTS"] == "192.168.0.10"
    assert env["NVR_ANALYTICS_FPS"] == "1" and "NVR_DB_PORT" not in env
    assert not any("PASSWORD" in k and not k.endswith("_FILE") for k in env)  # 비밀번호 값 자체는 넣지 않음


def test_winsw_xml_valid(lay):
    cfg = winctl.settings(lay)
    env = winctl.service_env(lay, cfg)
    defs = winctl.service_defs(lay, cfg)
    assert [d.id for d in defs] == winctl.ALL_SERVICES[1:]
    for svc in defs:
        root = ET.fromstring(winctl.winsw_xml(svc, lay, env).encode("utf-8"))
        assert root.findtext("id") == svc.id
        assert root.find("serviceaccount/user").text == "NetworkService"
        envs = {e.get("name"): e.get("value") for e in root.findall("env")}
        assert envs["NVR_MASTER_KEY_FILE"].endswith("master.key")
        assert root.findtext("depend") in ("WebNVR-DB", "WebNVR-API")
    rec = next(d for d in defs if d.id == "WebNVR-Recorder")
    assert "60 sec" in winctl.winsw_xml(rec, lay, env)
    # 공백이 있는 경로는 따옴표로 묶여야 한다
    api = ET.fromstring(winctl.winsw_xml(defs[0], lay, env).encode())
    assert api.findtext("executable").endswith("python.exe")
    px = ET.fromstring(winctl.winsw_xml(defs[-1], lay, env).encode()).findtext("arguments")
    assert '"' in px and "Caddyfile" in px


@pytest.mark.skipif(not CADDY, reason="caddy 없음(NVR_TEST_CADDY)")
def test_caddyfile_valid(lay, tmp_path):
    winctl.write_env(lay.env_file, {"NVR_SITE_ADDRESS": "192.168.0.10", "NVR_PUBLIC_HOSTS": "nvr.example.com, bad host;x"})
    cfg = winctl.settings(lay)
    text = winctl.caddyfile(lay, cfg)
    assert "https://192.168.0.10" in text and "https://nvr.example.com" in text and "bad host" not in text
    f = tmp_path / "Caddyfile"
    f.write_text(text, encoding="utf-8")
    p = subprocess.run([CADDY, "adapt", "--config", str(f), "--adapter", "caddyfile"], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "127.0.0.1:18000" in p.stdout and "ca.crt" in p.stdout
    cfg["NVR_HTTPS_PORT"] = "8443"
    assert "https://localhost:8443" in winctl.caddyfile(lay, cfg)
    assert "redir https://{host}:8443{uri} 308" in winctl.caddyfile(lay, cfg)
    cfg["NVR_HTTPS_PORT"] = "443"
    assert "redir https://{host}{uri} 308" in winctl.caddyfile(lay, cfg)


def test_setup_dry_run_order(lay, monkeypatch, tmp_path):
    monkeypatch.setenv("NVR_INSTALL_DIR", str(lay.install))
    monkeypatch.setenv("NVR_HOME", str(lay.data))
    c = winctl.Ctl(lay, dry_run=True, quiet=True)
    pw = tmp_path / "pw"
    pw.write_text("x")

    class A:
        recordings = str(tmp_path / "rec")
        address = "192.168.0.10"
        https_port = None
        http_port = None
        admin_user = "admin"
        admin_password_file = str(pw)

    assert winctl.cmd_setup(A, c) == 0
    flat = [" ".join(x) for x in c.done]
    def idx(sub):
        return next(i for i, s in enumerate(flat) if sub in s)
    assert idx("initdb.exe") < idx("pg_ctl.exe register") < idx("CREATE ROLE nvr") < idx("CREATE DATABASE nvr")
    assert idx("CREATE DATABASE nvr") < idx("alembic") < idx("nvr.cli create-admin") < idx("WebNVR-API.exe install")
    assert idx("WebNVR-API.exe install") < idx("advfirewall firewall add") < idx("certutil")
    assert any("NT AUTHORITY\\NetworkService" in s for s in flat)
    assert not any("x" == part for x in c.done for part in x if "PASSWORD" in part)  # 비밀번호가 명령줄 인자로 가지 않음
    fw = [s for s in flat if "firewall add" in s]
    assert len(fw) == 3 and all("profile=domain,private" in s for s in fw)


def test_config_rejects_secrets(lay, monkeypatch, capsys):
    monkeypatch.setenv("NVR_HOME", str(lay.data))
    monkeypatch.setenv("NVR_INSTALL_DIR", str(lay.install))
    assert winctl.main(["config", "NVR_ANALYTICS_FPS=1"]) == 0
    assert winctl.read_env(lay.env_file)["NVR_ANALYTICS_FPS"] == "1"
    for bad in ("NVR_DATABASE_PASSWORD_FILE=x", "PATH=x", "NVR_MASTER_KEY_FILE=x"):
        with pytest.raises(SystemExit):
            winctl.main(["config", bad])


def test_pg_conf(lay):
    s = winctl.pg_conf_extra(winctl.settings(lay), lay)
    assert "listen_addresses = '127.0.0.1'" in s and "port = 54329" in s and "\\" not in s.split("log_directory")[1].splitlines()[0]


def test_install_dir_from_python(monkeypatch):
    monkeypatch.delenv("NVR_INSTALL_DIR", raising=False)
    monkeypatch.setattr(winctl.sys, "executable", str(Path("/opt/WebNVR/python/python.exe")))
    assert winctl.install_dir() == Path("/opt/WebNVR")
