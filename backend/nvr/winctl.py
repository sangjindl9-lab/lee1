"""윈도우 설치판 관리 도구(nvrctl).

설치 프로그램(setup.exe)이 호출하고, 관리자가 명령 프롬프트에서 직접 쓸 수도 있다.

  nvrctl setup   [--data D] [--recordings R] [--address 주소] [--admin-password-file F]   최초 설정
  nvrctl upgrade                     업데이트 후 서비스 정의·DB 마이그레이션 갱신
  nvrctl start|stop|restart [이름…]   서비스 시작·정지(이름 생략 시 전체)
  nvrctl status [--json]             서비스 상태
  nvrctl config [KEY=VALUE …]        설정 보기·바꾸기(바꾼 뒤 restart 필요)
  nvrctl backup 폴더                 DB·비밀 파일·설정 백업(zip)
  nvrctl restore 백업.zip            복구(서비스 정지 후)
  nvrctl remove [--purge]            서비스·방화벽 규칙 제거(--purge: 데이터까지 삭제)

구성
  설치 폴더(INSTALL): python\\, app\\backend, app\\web, bin\\(ffmpeg·mediamtx·caddy·WinSW), pgsql\\, models\\
  데이터 폴더(DATA, 기본 %ProgramData%\\WebNVR): nvr.env(설정), secrets\\, pgdata\\, config\\, services\\, logs\\, caddy\\, public\\
  서비스: WebNVR-DB(PostgreSQL, pg_ctl 등록) / -API / -Media / -Recorder / -Worker / -Analytics / -Proxy (WinSW)
  서비스 계정: NT AUTHORITY\\NetworkService(관리자 권한 없음). 데이터·녹화 폴더에만 쓰기 권한을 준다.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

IS_WINDOWS = os.name == "nt"
NETWORK_SERVICE_SID = "*S-1-5-20"
SYSTEM_SID = "*S-1-5-18"
ADMINS_SID = "*S-1-5-32-544"
FIREWALL_RULES = ("WebNVR HTTPS", "WebNVR HTTP", "WebNVR WebRTC UDP", "WebNVR WebRTC TCP")

DEFAULTS = {
    "NVR_SITE_ADDRESS": "",
    "NVR_PUBLIC_HOSTS": "",
    "NVR_HTTPS_PORT": "443",
    "NVR_HTTP_PORT": "80",
    "NVR_DB_PORT": "54329",
    "NVR_API_PORT": "18000",
    "NVR_API_WORKERS": "2",
    "NVR_WEBRTC_TCP": "false",
    "NVR_RECORDINGS_DIR": "",
    "NVR_EXPORTS_DIR": "",
    "NVR_LOG_LEVEL": "INFO",
}


# ─────────────────────────────── 경로 ───────────────────────────────
def install_dir() -> Path:
    if os.environ.get("NVR_INSTALL_DIR"):
        return Path(os.environ["NVR_INSTALL_DIR"])
    return Path(sys.executable).resolve().parent.parent  # <INSTALL>\python\python.exe


def default_data_dir() -> Path:
    return Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "WebNVR"


def data_dir() -> Path:
    if os.environ.get("NVR_HOME"):
        return Path(os.environ["NVR_HOME"])
    marker = install_dir() / "data-path.txt"
    if marker.exists():
        return Path(marker.read_text(encoding="utf-8").strip())
    return default_data_dir()


@dataclass
class Layout:
    install: Path
    data: Path

    @property
    def python(self) -> Path:
        return self.install / "python" / "python.exe"

    @property
    def backend(self) -> Path:
        return self.install / "app" / "backend"

    @property
    def web(self) -> Path:
        return self.install / "app" / "web"

    @property
    def bin(self) -> Path:
        return self.install / "bin"

    @property
    def pgbin(self) -> Path:
        return self.install / "pgsql" / "bin"

    @property
    def env_file(self) -> Path:
        return self.data / "nvr.env"

    @property
    def secrets(self) -> Path:
        return self.data / "secrets"

    @property
    def pgdata(self) -> Path:
        return self.data / "pgdata"

    @property
    def config(self) -> Path:
        return self.data / "config"

    @property
    def services(self) -> Path:
        return self.data / "services"

    @property
    def logs(self) -> Path:
        return self.data / "logs"

    @property
    def caddy(self) -> Path:
        return self.data / "caddy"

    @property
    def public(self) -> Path:
        return self.data / "public"


def layout() -> Layout:
    return Layout(install_dir(), data_dir())


# ─────────────────────────────── 설정 파일 ───────────────────────────────
def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def write_env(path: Path, values: dict[str, str]) -> None:
    lines = ["# WebNVR 설정. 바꾼 뒤 '서버 관리' 또는 'nvrctl restart' 로 다시 시작하세요.",
             "# 비밀번호·키는 이 파일에 넣지 않습니다(secrets 폴더).", ""]
    for k in sorted(values):
        v = values[k]
        if "\n" in v or "\r" in v:
            raise ValueError(f"{k}: 줄바꿈은 쓸 수 없습니다")
        lines.append(f"{k}={v}")
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def settings(lay: Layout) -> dict[str, str]:
    v = dict(DEFAULTS)
    v.update(read_env(lay.env_file))
    if not v["NVR_RECORDINGS_DIR"]:
        v["NVR_RECORDINGS_DIR"] = str(lay.data / "recordings")
    if not v["NVR_EXPORTS_DIR"]:
        v["NVR_EXPORTS_DIR"] = str(lay.data / "exports")
    return v


def service_env(lay: Layout, cfg: dict[str, str]) -> dict[str, str]:
    """서비스 프로세스에 넘길 환경변수(설정 + 설치 경로에서 정해지는 값)."""
    env = {k: v for k, v in cfg.items() if k.startswith("NVR_")}
    for k in ("NVR_HTTPS_PORT", "NVR_HTTP_PORT", "NVR_API_PORT", "NVR_DB_PORT"):
        env.pop(k, None)
    api = f"127.0.0.1:{cfg['NVR_API_PORT']}"
    env.update({
        "NVR_DATABASE_URL": f"postgresql+psycopg://nvr@127.0.0.1:{cfg['NVR_DB_PORT']}/nvr",
        "NVR_DATABASE_PASSWORD_FILE": str(lay.secrets / "db.pass"),
        "NVR_MASTER_KEY_FILE": str(lay.secrets / "master.key"),
        "NVR_MEDIAMTX_CONFIG_PATH": str(lay.config / "mediamtx.yml"),
        "NVR_MEDIAMTX_BASE_CONFIG_PATH": str(lay.install / "app" / "deploy" / "mediamtx" / "mediamtx.base.yml"),
        "NVR_MEDIAMTX_AUTH_URL": f"http://{api}/internal/mediamtx/auth",
        "NVR_MEDIAMTX_LISTEN_HOST": "127.0.0.1",
        "NVR_TRUSTED_PROXIES": "127.0.0.1/32",
        "NVR_FFMPEG_PATH": str(lay.bin / "ffmpeg.exe"),
        "NVR_FFPROBE_PATH": str(lay.bin / "ffprobe.exe"),
        "NVR_ANALYTICS_MODEL_PATH": str(lay.install / "models" / "yolox_s.onnx"),
        "NVR_DISCOVERY_URL": "",
        "PYTHONPATH": str(lay.backend),
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "XDG_DATA_HOME": str(lay.caddy),
        "XDG_CONFIG_HOME": str(lay.caddy),
    })
    if not env.get("NVR_PUBLIC_HOSTS") and cfg.get("NVR_SITE_ADDRESS"):
        env["NVR_PUBLIC_HOSTS"] = cfg["NVR_SITE_ADDRESS"]
    return env


# ─────────────────────────────── 서비스 정의 ───────────────────────────────
@dataclass
class Svc:
    id: str
    name: str
    desc: str
    exe: str
    args: list[str]
    depends: tuple[str, ...] = ("WebNVR-DB",)
    stop_timeout: int = 30


def service_defs(lay: Layout, cfg: dict[str, str]) -> list[Svc]:
    py = str(lay.python)
    port = cfg["NVR_API_PORT"]
    return [
        Svc("WebNVR-API", "WebNVR 관리 API", "로그인·카메라·녹화 검색·설정 API(내부 주소에서만 응답)",
            py, ["-m", "uvicorn", "nvr.api.main:app", "--host", "127.0.0.1", "--port", port,
                 "--workers", cfg.get("NVR_API_WORKERS", "2"), "--no-server-header"]),
        Svc("WebNVR-Media", "WebNVR 영상 중계", "MediaMTX — 브라우저 실시간 시청(WebRTC·HLS) 중계",
            str(lay.bin / "mediamtx.exe"), [str(lay.config / "mediamtx.yml")], depends=("WebNVR-API",)),
        Svc("WebNVR-Recorder", "WebNVR 녹화", "카메라별 녹화(FFmpeg) — 브라우저를 닫아도 계속 녹화",
            py, ["-m", "nvr.recorder.main"], stop_timeout=60),
        Svc("WebNVR-Worker", "WebNVR 작업", "보관 정리·내보내기·알림·카메라 이벤트 수신·중계 설정 생성",
            py, ["-m", "nvr.worker.main"]),
        Svc("WebNVR-Analytics", "WebNVR 지능형 분석", "불꽃·안전모·수위·침입 등 CPU 분석",
            py, ["-m", "nvr.analytics.main"]),
        Svc("WebNVR-Proxy", "WebNVR 웹 접속", "Caddy — HTTPS 웹 화면·API·영상 중계 연결",
            str(lay.bin / "caddy.exe"), ["run", "--config", str(lay.config / "Caddyfile"), "--adapter", "caddyfile"],
            depends=("WebNVR-API",)),
    ]


ALL_SERVICES = ["WebNVR-DB", "WebNVR-API", "WebNVR-Media", "WebNVR-Recorder", "WebNVR-Worker", "WebNVR-Analytics",
                "WebNVR-Proxy"]


def _winarg(a: str) -> str:
    """윈도우 명령줄 인자 하나를 따옴표 처리(subprocess.list2cmdline 과 같은 규칙)."""
    return subprocess.list2cmdline([a])


def winsw_xml(svc: Svc, lay: Layout, env: dict[str, str]) -> str:
    x = ['<?xml version="1.0" encoding="UTF-8"?>', "<service>",
         f"  <id>{escape(svc.id)}</id>", f"  <name>{escape(svc.name)}</name>",
         f"  <description>{escape(svc.desc)}</description>",
         f"  <executable>{escape(svc.exe)}</executable>",
         f"  <arguments>{escape(' '.join(_winarg(a) for a in svc.args))}</arguments>",
         f"  <workingdirectory>{escape(str(lay.backend))}</workingdirectory>"]
    for k in sorted(env):
        x.append(f"  <env name={quoteattr(k)} value={quoteattr(env[k])}/>")
    for d in svc.depends:
        x.append(f"  <depend>{escape(d)}</depend>")
    x += ["  <startmode>Automatic</startmode>",
          '  <onfailure action="restart" delay="5 sec"/>',
          '  <onfailure action="restart" delay="20 sec"/>',
          '  <onfailure action="restart" delay="60 sec"/>',
          "  <resetfailure>1 hour</resetfailure>",
          f"  <stoptimeout>{svc.stop_timeout} sec</stoptimeout>",
          "  <stopparentprocessfirst>true</stopparentprocessfirst>",
          f"  <logpath>{escape(str(lay.logs))}</logpath>",
          '  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>',
          "  <serviceaccount><domain>NT AUTHORITY</domain><user>NetworkService</user></serviceaccount>",
          "</service>", ""]
    return "\n".join(x)


def _caddy_path(p: Path) -> str:
    return json.dumps(str(p).replace("\\", "/"), ensure_ascii=False)


def caddyfile(lay: Layout, cfg: dict[str, str]) -> str:
    https_port, http_port, api = cfg["NVR_HTTPS_PORT"], cfg["NVR_HTTP_PORT"], cfg["NVR_API_PORT"]
    hosts = ["localhost", "127.0.0.1"]
    for h in [cfg.get("NVR_SITE_ADDRESS", "")] + cfg.get("NVR_PUBLIC_HOSTS", "").split(","):
        h = h.strip()
        if h and h not in hosts and all(c.isalnum() or c in ".-:[]" for c in h):
            hosts.insert(0, h)
    https_suffix = "" if https_port == "443" else f":{https_port}"
    sites = ", ".join(f"https://{h}:{https_port}" if https_port != "443" else f"https://{h}" for h in hosts)
    csp = ("default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; "
           "style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; "
           "base-uri 'none'; form-action 'self'")
    return f"""# 자동 생성 파일(nvrctl). 직접 고치지 말고 nvr.env 를 바꾼 뒤 'nvrctl upgrade' 를 실행하세요.
{{
	admin off
	skip_install_trust
	http_port {http_port}
	https_port {https_port}
	auto_https disable_redirects
	storage file_system {_caddy_path(lay.caddy)}
}}

{sites} {{
	tls internal
	header {{
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "same-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		Content-Security-Policy "{csp}"
		-Server
	}}
	@internal path /internal/*
	handle @internal {{
		respond 404
	}}
	handle /api/* {{
		request_body {{
			max_size 2MB
		}}
		reverse_proxy 127.0.0.1:{api} {{
			flush_interval -1
		}}
	}}
	handle_path /rtc/* {{
		reverse_proxy 127.0.0.1:8889
	}}
	handle_path /hls/* {{
		reverse_proxy 127.0.0.1:8888
	}}
	handle {{
		root * {_caddy_path(lay.web)}
		encode zstd gzip
		@assets path /assets/*
		header @assets Cache-Control "public, max-age=31536000, immutable"
		try_files {{path}} /index.html
		file_server
	}}
	log {{
		output file {_caddy_path(lay.logs / "access.log")} {{
			roll_size 20MiB
			roll_keep 5
		}}
	}}
}}

# 평문 HTTP: 관제 프로그램이 서버 인증서(사설 CA)를 받아 가는 주소 + 나머지는 HTTPS 로 이동
http://:{http_port} {{
	handle /ca.crt {{
		root * {_caddy_path(lay.public)}
		header Content-Type application/x-x509-ca-cert
		file_server
	}}
	handle {{
		redir https://{{host}}{https_suffix}{{uri}} 308
	}}
}}
"""


def pg_conf_extra(cfg: dict[str, str], lay: Layout) -> str:
    return f"""
# ── WebNVR(nvrctl) ──
listen_addresses = '127.0.0.1'
port = {int(cfg['NVR_DB_PORT'])}
max_connections = 100
password_encryption = scram-sha-256
logging_collector = on
log_directory = {json.dumps(str(lay.logs).replace(chr(92), '/'))}
log_filename = 'postgresql-%a.log'
log_truncate_on_rotation = on
log_rotation_age = 1d
"""


# ─────────────────────────────── 실행 도우미 ───────────────────────────────
class Ctl:
    def __init__(self, lay: Layout, dry_run: bool = False, quiet: bool = False):
        self.lay = lay
        self.dry = dry_run
        self.quiet = quiet
        self.done: list[list[str]] = []

    def say(self, msg: str) -> None:
        if not self.quiet:
            print(msg, flush=True)

    def run(self, args: list[str], check: bool = True, env: dict | None = None, capture: bool = False,
            input_text: str | None = None) -> subprocess.CompletedProcess:
        self.done.append([str(a) for a in args])
        if self.dry:
            return subprocess.CompletedProcess(args, 0, "", "")
        full_env = dict(os.environ)
        if env:
            full_env.update(env)
        kw = {"creationflags": 0x08000000} if IS_WINDOWS else {}
        p = subprocess.run([str(a) for a in args], env=full_env, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", input=input_text, check=False, **kw)
        if check and p.returncode != 0:
            raise SystemExit(f"명령 실패({p.returncode}): {' '.join(str(a) for a in args[:3])} …\n{p.stdout[-800:]}\n{p.stderr[-800:]}")
        return p

    def write(self, path: Path, text: str) -> None:
        if self.dry:
            self.done.append(["write", str(path)])
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)

    # ── 권한 ──
    def acl_private(self, path: Path, network_service: str = "R") -> None:
        """SYSTEM·Administrators 전체, NetworkService 는 지정 권한만. 상속 끊음."""
        self.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{SYSTEM_SID}:(OI)(CI)F",
                  f"{ADMINS_SID}:(OI)(CI)F", f"{NETWORK_SERVICE_SID}:(OI)(CI){network_service}", "/T", "/Q"])

    def acl_service_write(self, path: Path) -> None:
        self.run(["icacls", str(path), "/grant", f"{NETWORK_SERVICE_SID}:(OI)(CI)M", "/T", "/Q"])

    # ── 서비스 ──
    def winsw(self, sid: str, verb: str, check: bool = True) -> subprocess.CompletedProcess:
        return self.run([str(self.lay.services / f"{sid}.exe"), verb], check=check)

    def service_state(self, sid: str) -> str:
        if self.dry or not IS_WINDOWS:
            return "unknown"
        try:
            import psutil

            return psutil.win_service_get(sid).status()  # running / stopped / start_pending …
        except Exception:  # noqa: BLE001
            return "not_installed"

    def sc(self, verb: str, sid: str, check: bool = False) -> None:
        self.run(["sc.exe", verb, sid], check=check)

    def wait_state(self, sid: str, want: str, timeout: float = 90) -> bool:
        if self.dry or not IS_WINDOWS:
            return True
        end = time.time() + timeout
        while time.time() < end:
            if self.service_state(sid) == want:
                return True
            time.sleep(1)
        return False


# ─────────────────────────────── 단계 ───────────────────────────────
def ensure_dirs(c: Ctl, cfg: dict[str, str]) -> None:
    lay = c.lay
    for d in (lay.data, lay.secrets, lay.config, lay.services, lay.logs, lay.caddy, lay.public,
              Path(cfg["NVR_RECORDINGS_DIR"]), Path(cfg["NVR_EXPORTS_DIR"])):
        if not c.dry:
            d.mkdir(parents=True, exist_ok=True)
    if IS_WINDOWS:
        c.acl_private(lay.secrets, "R")
        c.acl_private(lay.config, "M")
        for d in (lay.logs, lay.caddy, lay.public, Path(cfg["NVR_RECORDINGS_DIR"]), Path(cfg["NVR_EXPORTS_DIR"])):
            c.acl_service_write(d)


def ensure_secrets(c: Ctl) -> None:
    s = c.lay.secrets
    files = {"master.key": lambda: base64.b64encode(os.urandom(32)).decode(),
             "db.pass": lambda: secrets.token_urlsafe(24),
             "pg_super.pass": lambda: secrets.token_urlsafe(24)}
    for name, gen in files.items():
        p = s / name
        if not c.dry and (not p.exists() or not p.read_text(encoding="utf-8").strip()):
            p.write_text(gen(), encoding="utf-8")
            c.say(f"  비밀 파일 생성: {name}")


def setup_db(c: Ctl, cfg: dict[str, str]) -> None:
    lay = c.lay
    pg = lay.pgbin
    super_pw_file = lay.secrets / "pg_super.pass"
    if c.dry or not (lay.pgdata / "PG_VERSION").exists():
        c.say("데이터베이스 초기화…")
        c.run([pg / "initdb.exe", "-D", lay.pgdata, "-U", "postgres", f"--pwfile={super_pw_file}", "-E", "UTF8",
               "--locale=C", "-A", "scram-sha-256"])
        conf = lay.pgdata / "postgresql.conf"
        if not c.dry:
            with open(conf, "a", encoding="utf-8") as f:
                f.write(pg_conf_extra(cfg, lay))
        if IS_WINDOWS:
            c.run(["icacls", str(lay.pgdata), "/grant", f"{NETWORK_SERVICE_SID}:(OI)(CI)F", "/T", "/Q"])
            c.acl_service_write(lay.logs)
    if c.service_state("WebNVR-DB") == "not_installed" or c.dry:
        c.run([pg / "pg_ctl.exe", "register", "-N", "WebNVR-DB", "-U", r"NT AUTHORITY\NetworkService",
               "-D", lay.pgdata, "-S", "auto", "-w"])
    start_services(c, ["WebNVR-DB"])
    env = {"PGPASSWORD": super_pw_file.read_text(encoding="utf-8").strip() if not c.dry else ""}
    port = cfg["NVR_DB_PORT"]
    for _ in range(60 if not c.dry else 1):
        if c.run([pg / "pg_isready.exe", "-h", "127.0.0.1", "-p", port], check=False).returncode == 0:
            break
        time.sleep(1)
    psql = [pg / "psql.exe", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-tA"]
    dbpw = (lay.secrets / "db.pass").read_text(encoding="utf-8").strip() if not c.dry else "x"
    has_role = c.run(psql + ["-c", "SELECT 1 FROM pg_roles WHERE rolname='nvr'"], env=env, capture=True).stdout.strip()
    sql_pw = dbpw.replace("'", "''")
    if has_role != "1":
        c.run(psql + ["-c", f"CREATE ROLE nvr LOGIN PASSWORD '{sql_pw}'"], env=env)
    else:
        c.run(psql + ["-c", f"ALTER ROLE nvr PASSWORD '{sql_pw}'"], env=env)
    has_db = c.run(psql + ["-c", "SELECT 1 FROM pg_database WHERE datname='nvr'"], env=env, capture=True).stdout.strip()
    if has_db != "1":
        c.run(psql + ["-c", "CREATE DATABASE nvr OWNER nvr ENCODING 'UTF8' TEMPLATE template0"], env=env)


def migrate(c: Ctl, cfg: dict[str, str]) -> None:
    c.say("DB 구조 갱신(마이그레이션)…")
    c.run([c.lay.python, "-m", "alembic", "-c", c.lay.backend / "alembic.ini", "upgrade", "head"],
          env=service_env(c.lay, cfg))


def create_admin(c: Ctl, cfg: dict[str, str], username: str, pw_file: str | None) -> None:
    if not pw_file:
        return
    env = service_env(c.lay, cfg)
    code = ("import sys;from sqlalchemy import select;from nvr.db import session_scope;from nvr.models import User\n"
            "with session_scope() as db: sys.exit(1 if db.scalar(select(User).where(User.role=='superadmin')) else 0)")
    if c.run([c.lay.python, "-c", code], env=env, check=False).returncode == 1 and not c.dry:
        c.say("  최고관리자가 이미 있어 새로 만들지 않습니다.")
        return
    c.run([c.lay.python, "-m", "nvr.cli", "create-admin", "--username", username, "--password-file", pw_file], env=env)
    c.say(f"  최고관리자 '{username}' 생성(첫 로그인 때 비밀번호 변경)")


def write_service_files(c: Ctl, cfg: dict[str, str]) -> None:
    lay = c.lay
    env = service_env(lay, cfg)
    winsw_src = lay.bin / "WinSW-x64.exe"
    for svc in service_defs(lay, cfg):
        c.write(lay.services / f"{svc.id}.xml", winsw_xml(svc, lay, env))
        if not c.dry:
            shutil.copy2(winsw_src, lay.services / f"{svc.id}.exe")
    c.write(lay.config / "Caddyfile", caddyfile(lay, cfg))
    # mediamtx 설정은 worker 가 계속 갱신하지만, 서비스가 처음 뜰 때 파일이 있어야 한다
    c.run([lay.python, "-c", "from nvr.worker import mediamtx_config as m; m.sync()"], env=env)


def install_services(c: Ctl, cfg: dict[str, str]) -> None:
    for svc in service_defs(c.lay, cfg):
        if c.service_state(svc.id) == "not_installed" or c.dry:
            c.winsw(svc.id, "install")
        else:
            c.winsw(svc.id, "refresh", check=False)  # 정의(XML) 변경 반영


def firewall(c: Ctl, cfg: dict[str, str], remove: bool = False) -> None:
    for name in FIREWALL_RULES:
        c.run(["netsh", "advfirewall", "firewall", "delete", "rule", f"name={name}"], check=False)
    if remove:
        return
    rules = [("WebNVR HTTPS", "TCP", cfg["NVR_HTTPS_PORT"]), ("WebNVR HTTP", "TCP", cfg["NVR_HTTP_PORT"]),
             ("WebNVR WebRTC UDP", "UDP", "8189")]
    if cfg.get("NVR_WEBRTC_TCP", "false").lower() == "true":
        rules.append(("WebNVR WebRTC TCP", "TCP", "8189"))
    for name, proto, port in rules:
        c.run(["netsh", "advfirewall", "firewall", "add", "rule", f"name={name}", "dir=in", "action=allow",
               f"protocol={proto}", f"localport={port}", "profile=domain,private"])


def publish_ca(c: Ctl, timeout: float = 60) -> Path | None:
    """Caddy 가 처음 만든 사설 루트 인증서를 public\\ca.crt 로 복사하고 이 컴퓨터의 신뢰 목록에 넣는다."""
    root = c.lay.caddy / "pki" / "authorities" / "local" / "root.crt"
    end = time.time() + (0 if c.dry else timeout)
    while not root.exists() and time.time() < end:
        time.sleep(1)
    if c.dry:
        c.run(["certutil", "-addstore", "-f", "Root", c.lay.public / "ca.crt"])
        return None
    if not root.exists():
        c.say("  경고: 웹 접속 인증서가 아직 만들어지지 않았습니다(서버 관리에서 다시 시작해 보세요).")
        return None
    dst = c.lay.public / "ca.crt"
    shutil.copy2(root, dst)
    if IS_WINDOWS:
        c.run(["certutil", "-addstore", "-f", "Root", str(dst)], check=False)
    return dst


def start_services(c: Ctl, names: list[str] | None = None) -> None:
    for sid in names or ALL_SERVICES:
        if c.service_state(sid) == "not_installed":
            continue
        c.sc("start", sid)
        if sid == "WebNVR-DB":
            c.wait_state(sid, "running", 60)


def stop_services(c: Ctl, names: list[str] | None = None) -> None:
    for sid in reversed(names or ALL_SERVICES):
        if c.service_state(sid) in ("not_installed", "stopped"):
            continue
        c.sc("stop", sid)
        c.wait_state(sid, "stopped", 90)


def port_free(port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def detect_address() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        if not ip.startswith("127."):
            return ip
    except OSError:
        pass
    return "localhost"


# ─────────────────────────────── 명령 ───────────────────────────────
def cmd_setup(a, c: Ctl) -> int:
    lay = c.lay
    c.say(f"설치 폴더: {lay.install}\n데이터 폴더: {lay.data}")
    if not c.dry:
        lay.data.mkdir(parents=True, exist_ok=True)
        (lay.install / "data-path.txt").write_text(str(lay.data), encoding="utf-8")
    cfg = settings(lay)
    if a.recordings:
        cfg["NVR_RECORDINGS_DIR"] = a.recordings
    if a.address:
        cfg["NVR_SITE_ADDRESS"] = a.address
    if not cfg.get("NVR_SITE_ADDRESS"):
        cfg["NVR_SITE_ADDRESS"] = detect_address()
    for k, v in (("NVR_HTTPS_PORT", a.https_port), ("NVR_HTTP_PORT", a.http_port)):
        if v:
            cfg[k] = str(v)
    fresh = not lay.env_file.exists()
    for k, alt, given in (("NVR_HTTPS_PORT", "8443", a.https_port), ("NVR_HTTP_PORT", "8080", a.http_port)):
        if fresh and not given and not c.dry and not port_free(int(cfg[k])):
            c.say(f"  포트 {cfg[k]} 을(를) 다른 프로그램(IIS 등)이 쓰고 있어 {alt} 로 설정합니다.")
            cfg[k] = alt
    if not c.dry:
        write_env(lay.env_file, {k: v for k, v in cfg.items() if v != ""})
    ensure_dirs(c, cfg)
    ensure_secrets(c)
    setup_db(c, cfg)
    migrate(c, cfg)
    create_admin(c, cfg, a.admin_user, a.admin_password_file)
    if a.admin_password_file and not c.dry:
        try:
            os.remove(a.admin_password_file)  # 설치 프로그램이 넘긴 임시 파일
        except OSError:
            pass
    write_service_files(c, cfg)
    install_services(c, cfg)
    firewall(c, cfg)
    start_services(c)
    publish_ca(c)
    c.say(f"\n설치 완료 — 브라우저 또는 관제 프로그램에서 https://{cfg['NVR_SITE_ADDRESS']}"
          f"{'' if cfg['NVR_HTTPS_PORT'] == '443' else ':' + cfg['NVR_HTTPS_PORT']} 로 접속하세요.")
    return 0


def cmd_upgrade(a, c: Ctl) -> int:
    cfg = settings(c.lay)
    stop_services(c, [s for s in ALL_SERVICES if s != "WebNVR-DB"])
    ensure_dirs(c, cfg)
    ensure_secrets(c)
    start_services(c, ["WebNVR-DB"])
    migrate(c, cfg)
    write_service_files(c, cfg)
    install_services(c, cfg)
    firewall(c, cfg)
    start_services(c)
    publish_ca(c, timeout=20)
    c.say("업데이트 완료")
    return 0


def cmd_status(a, c: Ctl) -> int:
    rows = [{"id": s, "state": c.service_state(s)} for s in ALL_SERVICES]
    cfg = settings(c.lay)
    out = {"services": rows, "data": str(c.lay.data), "install": str(c.lay.install),
           "address": cfg.get("NVR_SITE_ADDRESS", ""), "https_port": cfg.get("NVR_HTTPS_PORT", "443"),
           "recordings": cfg.get("NVR_RECORDINGS_DIR", "")}
    try:
        out["disk_free_gb"] = round(shutil.disk_usage(cfg["NVR_RECORDINGS_DIR"]).free / 1024 ** 3, 1)
    except OSError:
        out["disk_free_gb"] = None
    if a.json:
        print(json.dumps(out, ensure_ascii=False))
    else:
        label = {"running": "실행 중", "stopped": "정지", "not_installed": "설치 안 됨", "start_pending": "시작 중",
                 "stop_pending": "정지 중", "paused": "일시정지", "unknown": "알 수 없음"}
        for r in rows:
            print(f"{r['id']:<18} {label.get(r['state'], r['state'])}")
        print(f"접속 주소: https://{out['address']}  녹화 폴더: {out['recordings']}  남은 공간: {out['disk_free_gb']}GB")
    return 0 if all(r["state"] == "running" for r in rows) else 3


def cmd_config(a, c: Ctl) -> int:
    cfg = read_env(c.lay.env_file)
    if not a.pairs:
        for k, v in sorted(settings(c.lay).items()):
            print(f"{k}={v}")
        return 0
    for p in a.pairs:
        if "=" not in p:
            raise SystemExit(f"KEY=VALUE 형식이어야 합니다: {p}")
        k, v = p.split("=", 1)
        k = k.strip().upper()
        if not k.startswith("NVR_") or "PASSWORD" in k or "KEY" in k and k != "NVR_KEY":
            raise SystemExit(f"바꿀 수 없는 설정입니다: {k}")
        cfg[k] = v.strip()
    write_env(c.lay.env_file, cfg)
    print("저장했습니다. 'nvrctl upgrade' 로 반영하세요(서비스 정의·인증서 주소·방화벽 갱신 후 재시작).")
    return 0


def cmd_backup(a, c: Ctl) -> int:
    cfg = settings(c.lay)
    dest = Path(a.dest)
    dest.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    dump = dest / f"webnvr-db-{stamp}.dump"
    env = {"PGPASSWORD": (c.lay.secrets / "db.pass").read_text(encoding="utf-8").strip()}
    c.run([c.lay.pgbin / "pg_dump.exe", "-h", "127.0.0.1", "-p", cfg["NVR_DB_PORT"], "-U", "nvr", "-Fc", "-f", dump,
           "nvr"], env=env)
    out = dest / f"webnvr-backup-{stamp}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(dump, "db.dump")
        for f in ("master.key", "db.pass"):
            z.write(c.lay.secrets / f, f"secrets/{f}")
        z.write(c.lay.env_file, "nvr.env")
        ca = c.lay.caddy / "pki" / "authorities" / "local"
        for f in ("root.crt", "root.key", "intermediate.crt", "intermediate.key"):
            if (ca / f).exists():
                z.write(ca / f, f"ca/{f}")
    dump.unlink()
    c.say(f"백업 완료: {out}\n※ 이 파일에는 카메라 비밀번호를 풀 수 있는 마스터 키가 들어 있습니다. 안전한 곳에 보관하세요."
          f"\n※ 녹화 영상 파일은 포함하지 않습니다(녹화 폴더를 따로 복사).")
    return 0


def cmd_restore(a, c: Ctl) -> int:
    cfg = settings(c.lay)
    src = Path(a.file)
    tmp = c.lay.data / "restore-tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    with zipfile.ZipFile(src) as z:
        names = set(z.namelist())
        for need in ("db.dump", "secrets/master.key", "secrets/db.pass"):
            if need not in names:
                raise SystemExit(f"백업 파일이 아닙니다(없음: {need})")
        z.extractall(tmp)
    stop_services(c, [s for s in ALL_SERVICES if s != "WebNVR-DB"])
    start_services(c, ["WebNVR-DB"])
    shutil.copy2(tmp / "secrets" / "master.key", c.lay.secrets / "master.key")
    shutil.copy2(tmp / "secrets" / "db.pass", c.lay.secrets / "db.pass")
    for f in (tmp / "ca").glob("*") if (tmp / "ca").exists() else []:
        d = c.lay.caddy / "pki" / "authorities" / "local"
        d.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, d / f.name)
    env = {"PGPASSWORD": (c.lay.secrets / "pg_super.pass").read_text(encoding="utf-8").strip()}
    pg = c.lay.pgbin
    port = cfg["NVR_DB_PORT"]
    psql = [pg / "psql.exe", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1"]
    c.run(psql + ["-c", "DROP DATABASE IF EXISTS nvr WITH (FORCE)"], env=env)
    sql_pw = (c.lay.secrets / "db.pass").read_text(encoding="utf-8").strip().replace("'", "''")
    c.run(psql + ["-c", f"ALTER ROLE nvr PASSWORD '{sql_pw}'"], env=env)
    c.run(psql + ["-c", "CREATE DATABASE nvr OWNER nvr ENCODING 'UTF8' TEMPLATE template0"], env=env)
    c.run([pg / "pg_restore.exe", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "nvr", "--no-owner",
           "--role=nvr", tmp / "db.dump"], env=env)
    shutil.rmtree(tmp, ignore_errors=True)
    migrate(c, cfg)
    write_service_files(c, cfg)
    start_services(c)
    publish_ca(c, timeout=20)
    c.say("복구 완료. 녹화 영상 파일은 원래 녹화 폴더에 있어야 재생됩니다.")
    return 0


def ca_thumbprint(pem: bytes) -> str | None:
    import hashlib
    import ssl

    try:
        return hashlib.sha1(ssl.PEM_cert_to_DER_cert(pem.decode("ascii"))).hexdigest()  # noqa: S324 (인증서 저장소 식별자)
    except (ValueError, UnicodeDecodeError):
        return None


def cmd_remove(a, c: Ctl) -> int:
    cfg = settings(c.lay)
    stop_services(c)
    for svc in service_defs(c.lay, cfg):
        if c.service_state(svc.id) != "not_installed" and (c.lay.services / f"{svc.id}.exe").exists():
            c.winsw(svc.id, "uninstall", check=False)
    if c.service_state("WebNVR-DB") != "not_installed":
        c.run([c.lay.pgbin / "pg_ctl.exe", "unregister", "-N", "WebNVR-DB"], check=False)
    firewall(c, cfg, remove=True)
    ca = c.lay.public / "ca.crt"
    if ca.exists():
        thumb = ca_thumbprint(ca.read_bytes())
        if thumb:
            c.run(["certutil", "-delstore", "Root", thumb], check=False)
    if a.purge:
        keep = {Path(cfg["NVR_RECORDINGS_DIR"]).resolve(), Path(cfg["NVR_EXPORTS_DIR"]).resolve()}
        c.say("설정·DB·로그를 삭제합니다(녹화·내보내기 폴더는 남김).")
        if not c.dry and c.lay.data.exists():
            for child in c.lay.data.iterdir():
                if child.resolve() in keep:
                    continue
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    child.unlink(missing_ok=True)
    c.say("서비스를 제거했습니다.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="nvrctl", description="WebNVR 윈도우 설치판 관리")
    ap.add_argument("--data", help="데이터 폴더(기본 %%ProgramData%%\\WebNVR)")
    ap.add_argument("--dry-run", action="store_true", help="실행할 명령만 표시")
    ap.add_argument("--quiet", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("setup")
    s.add_argument("--recordings")
    s.add_argument("--address")
    s.add_argument("--https-port", type=int)
    s.add_argument("--http-port", type=int)
    s.add_argument("--admin-user", default="admin")
    s.add_argument("--admin-password-file")
    sub.add_parser("upgrade")
    for n in ("start", "stop", "restart"):
        x = sub.add_parser(n)
        x.add_argument("names", nargs="*")
    st = sub.add_parser("status")
    st.add_argument("--json", action="store_true")
    cf = sub.add_parser("config")
    cf.add_argument("pairs", nargs="*")
    b = sub.add_parser("backup")
    b.add_argument("dest")
    r = sub.add_parser("restore")
    r.add_argument("file")
    rm = sub.add_parser("remove")
    rm.add_argument("--purge", action="store_true")
    sub.add_parser("tray")
    a = ap.parse_args(argv)
    if a.data:
        os.environ["NVR_HOME"] = a.data
    c = Ctl(layout(), dry_run=a.dry_run, quiet=a.quiet)
    if a.cmd == "tray":
        from .wintray import main as tray_main

        return tray_main()
    if not IS_WINDOWS and not a.dry_run and a.cmd not in ("config", "status"):
        print("이 명령은 윈도우 설치판 전용입니다(--dry-run 으로 확인 가능).", file=sys.stderr)
        return 2
    names = [("WebNVR-" + n if not n.startswith("WebNVR-") else n) for n in getattr(a, "names", [])] or None
    handlers = {
        "setup": cmd_setup, "upgrade": cmd_upgrade, "status": cmd_status, "config": cmd_config,
        "backup": cmd_backup, "restore": cmd_restore, "remove": cmd_remove,
        "start": lambda a, c: (start_services(c, names), 0)[1],
        "stop": lambda a, c: (stop_services(c, names), 0)[1],
        "restart": lambda a, c: (stop_services(c, names), start_services(c, names), 0)[2],
    }
    return handlers[a.cmd](a, c)


if __name__ == "__main__":
    sys.exit(main())
