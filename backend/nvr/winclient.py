"""WebNVR 관제 프로그램(윈도우).

- 서버 목록에서 골라 접속하면 관제 화면(웹 화면)을 프로그램 창으로 연다(WebView2 — 윈도우 10/11 기본 포함).
- 영상벽: 모니터마다 저장해 둔 화면 배치(실시간 관제의 '새 배치로 저장')를 전체화면으로 띄운다.
  모든 창이 같은 로그인을 공유한다(한 번만 로그인).
- 서버 인증서(사설 CA)를 처음 접속할 때 지문을 보여 주고, 사용자가 확인하면 현재 사용자 신뢰 목록에 넣는다.

화면 구성(웹 화면·영상 재생)은 서버의 웹 화면과 같다. 이 프로그램은 창·모니터·인증서·서버 목록을 맡는다.
"""
from __future__ import annotations

import hashlib
import json
import os
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlsplit

APP_NAME = "WebNVR 관제"
VERSION = "0.4.0"


# ─────────────────────────────── 설정 ───────────────────────────────
def config_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    return Path(base) / "WebNVR"


def storage_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".cache")
    return Path(base) / "WebNVR" / "webview"


def load_config(path: Path | None = None) -> dict:
    path = path or config_dir() / "client.json"
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cfg = {}
    cfg.setdefault("servers", [])
    cfg.setdefault("last", 0)
    cfg.setdefault("walls", [])
    cfg.setdefault("open_walls_on_connect", True)
    if not cfg["servers"]:
        local = local_server_url()
        if local:
            cfg["servers"].append({"name": "이 컴퓨터(서버)", "url": local})
    return cfg


def save_config(cfg: dict, path: Path | None = None) -> None:
    path = path or config_dir() / "client.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def local_server_url() -> str | None:
    """이 컴퓨터에 서버가 설치돼 있으면 그 주소."""
    try:
        from .winctl import layout, settings

        lay = layout()
        if not lay.env_file.exists():
            return None
        cfg = settings(lay)
        port = cfg.get("NVR_HTTPS_PORT", "443")
        return "https://localhost" + ("" if port == "443" else f":{port}")
    except Exception:  # noqa: BLE001
        return None


def normalize_url(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("서버 주소를 입력하세요.")
    if "://" not in raw:
        raw = "https://" + raw
    u = urlsplit(raw)
    if u.scheme != "https":
        raise ValueError("https 주소만 사용할 수 있습니다.")
    if not u.hostname or any(c in u.netloc for c in " /\\@"):
        raise ValueError("주소 형식이 올바르지 않습니다.")
    return f"https://{u.netloc}"


def wall_url(base: str, layout_name: str, tour: int = 0) -> str:
    q = f"kiosk=1&layout={quote(layout_name, safe='')}"
    if tour:
        q += f"&tour={int(tour)}"
    return f"{base}/live?{q}"


# ─────────────────────────────── 인증서 ───────────────────────────────
def is_trusted(base: str, timeout: float = 5) -> tuple[bool, str]:
    """이 PC 의 신뢰 목록으로 HTTPS 검증이 되는지. (성공 여부, 실패 이유)"""
    ctx = ssl.create_default_context()  # 윈도우: 시스템 인증서 저장소 사용
    try:
        with urllib.request.urlopen(base + "/api/health", timeout=timeout, context=ctx) as r:
            r.read(200)
        return True, ""
    except urllib.error.HTTPError:
        return True, ""  # TLS 는 통과(응답 코드는 무관)
    except (ssl.SSLError, urllib.error.URLError) as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(reason):
            return False, "certificate"
        return False, f"connect: {reason}"
    except OSError as e:
        return False, f"connect: {e}"


def fetch_ca(base: str, http_port: int = 80, timeout: float = 5) -> bytes:
    host = urlsplit(base).hostname or ""
    if ":" in host:
        host = f"[{host}]"
    url = f"http://{host}{'' if http_port == 80 else f':{http_port}'}/ca.crt"
    with urllib.request.urlopen(url, timeout=timeout) as r:  # 평문: 지문을 사용자가 서버 화면과 대조
        data = r.read(64 * 1024)
    if b"BEGIN CERTIFICATE" not in data:
        raise ValueError("서버가 인증서 대신 다른 내용을 보냈습니다.")
    return data


def fingerprint(pem: bytes) -> str:
    der = ssl.PEM_cert_to_DER_cert(pem.decode("ascii", "replace"))
    h = hashlib.sha256(der).hexdigest().upper()
    return ":".join(h[i:i + 2] for i in range(0, len(h), 2))


def install_ca_current_user(pem: bytes) -> bool:
    """현재 사용자 '신뢰할 수 있는 루트 인증 기관'에 추가(윈도우가 확인 창을 띄움)."""
    with tempfile.NamedTemporaryFile("wb", suffix=".crt", delete=False) as f:
        f.write(pem)
        name = f.name
    try:
        p = subprocess.run(["certutil", "-user", "-addstore", "Root", name], capture_output=True,
                           creationflags=0x08000000 if os.name == "nt" else 0, check=False)
        return p.returncode == 0
    finally:
        os.unlink(name)


# ─────────────────────────────── 시작 화면(HTML) ───────────────────────────────
LAUNCHER_HTML = r"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>WebNVR 관제</title>
<style>
:root{--bg:#0f1316;--panel:#171c21;--line:#2a3138;--text:#e6e9ec;--muted:#8b949c;--signal:#f5b700;--rec:#e5484d;--ok:#3fb950}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 "Malgun Gothic","Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 24px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.muted{color:var(--muted)}.small{font-size:13px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.srv{display:flex;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--line)}
.srv:last-child{border-bottom:0}.srv .nm{flex:1;min-width:0}.srv .nm b{display:block}
button{font:inherit;color:var(--text);background:#232a31;border:1px solid var(--line);border-radius:4px;padding:7px 14px;cursor:pointer}
button.primary{background:var(--signal);border-color:var(--signal);color:#111;font-weight:700}button.ghost{background:transparent}
input,select{font:inherit;color:var(--text);background:#0c1013;border:1px solid var(--line);border-radius:4px;padding:7px 10px}
.msg{margin:12px 0;padding:10px 12px;border-left:3px solid var(--signal);background:#1c2228}.msg.err{border-color:var(--rec)}
code{font-size:12px;word-break:break-all;color:#cfd6dc}table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-bottom:1px solid var(--line)}
</style></head><body><main>
<h1>WebNVR 관제</h1><p class="muted small">서버를 골라 접속합니다. 영상벽 모니터는 아래에서 정합니다.</p>
<div id="msg"></div>
<h2>서버</h2><div class="panel" id="servers"></div>
<div class="row" style="margin-top:10px"><input id="nm" placeholder="이름(예: 본사 현장)" style="width:180px">
<input id="url" placeholder="주소(예: 192.168.0.10 또는 https://nvr.example.com)" style="flex:1;min-width:260px"><button onclick="add()">서버 추가</button></div>
<h2>영상벽 모니터</h2><div class="panel"><table id="walls"></table>
<p class="muted small">배치 이름은 실시간 관제 화면에서 ‘새 배치로 저장’한 이름입니다. 비우면 그 모니터는 쓰지 않습니다.</p>
<label class="small"><input type="checkbox" id="auto"> 접속하면 영상벽을 자동으로 엽니다</label>
<div class="row" style="margin-top:8px"><button onclick="saveWalls()">영상벽 설정 저장</button></div></div>
<p class="muted small" id="ver"></p>
</main><script>
const $=id=>document.getElementById(id);let state=null;
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function msg(t,err){$("msg").innerHTML=t?`<div class="msg${err?" err":""}">${t}</div>`:""}
async function load(){state=await pywebview.api.state();render()}
function render(){const s=state;$("ver").textContent="관제 프로그램 "+s.version;
 $("servers").innerHTML=s.servers.length?s.servers.map((x,i)=>`<div class="srv"><div class="nm"><b>${esc(x.name)}</b><span class="muted small">${esc(x.url)}</span></div>
 <button class="primary" onclick="connect(${i})">접속</button><button class="ghost" onclick="del(${i})">삭제</button></div>`).join(""):'<p class="muted">등록된 서버가 없습니다.</p>';
 $("walls").innerHTML=s.screens.map((sc,i)=>{const w=s.walls.find(w=>w.screen===i)||{};return `<tr><td>모니터 ${i+1}${i===0?" (주 모니터·관제 창)":""}<div class="muted small">${sc.width}×${sc.height}</div></td>
 <td><input data-i="${i}" class="wl" placeholder="${i===0?"주 모니터는 관제 창":"배치 이름(예: 모니터2)"}" value="${esc(w.layout||"")}" ${i===0?"disabled":""}></td>
 <td><select data-i="${i}" class="wt">${[0,10,20,30,60].map(v=>`<option value="${v}" ${(w.tour||0)==v?"selected":""}>${v?v+"초 순환":"순환 없음"}</option>`).join("")}</select></td></tr>`}).join("");
 $("auto").checked=s.open_walls_on_connect}
async function add(){const r=await pywebview.api.add_server($("nm").value,$("url").value);if(r.error)return msg(esc(r.error),1);$("nm").value=$("url").value="";state=r.state;render();msg("")}
async function del(i){if(!confirm("이 서버를 목록에서 지울까요?"))return;state=await pywebview.api.remove_server(i);render()}
async function saveWalls(){const walls=[...document.querySelectorAll(".wl")].map(e=>({screen:+e.dataset.i,layout:e.value.trim(),tour:+document.querySelector(`.wt[data-i="${e.dataset.i}"]`).value})).filter(w=>w.layout);
 state=await pywebview.api.save_walls(walls,$("auto").checked);render();msg("영상벽 설정을 저장했습니다.")}
async function connect(i){msg("접속 확인 중…");const r=await pywebview.api.connect(i);
 if(r.need_trust){msg(`처음 접속하는 서버입니다. 서버의 ‘서버 관리 → 인증서 지문’과 아래 지문이 같은지 확인한 뒤 신뢰하세요.<br><code>${esc(r.fingerprint)}</code><div class="row" style="margin-top:8px"><button class="primary" onclick="trust(${i})">이 서버 신뢰</button><button class="ghost" onclick="msg('')">취소</button></div>`);return}
 if(r.error)msg(esc(r.error),1)}
async function trust(i){const r=await pywebview.api.trust(i);if(r.error)return msg(esc(r.error),1);connect(i)}
window.addEventListener("pywebviewready",load);
</script></body></html>"""


# ─────────────────────────────── 앱 ───────────────────────────────
class Api:
    def __init__(self, app: "ClientApp"):
        self._app = app

    def state(self) -> dict:
        return self._app.state()

    def add_server(self, name: str, url: str) -> dict:
        try:
            u = normalize_url(url)
        except ValueError as e:
            return {"error": str(e)}
        cfg = self._app.cfg
        cfg["servers"].append({"name": (name or "").strip()[:60] or u.split("//", 1)[1], "url": u})
        save_config(cfg)
        return {"state": self._app.state()}

    def remove_server(self, i: int) -> dict:
        cfg = self._app.cfg
        if 0 <= i < len(cfg["servers"]):
            cfg["servers"].pop(i)
            save_config(cfg)
        return self._app.state()

    def save_walls(self, walls: list, auto: bool) -> dict:
        clean = []
        for w in walls or []:
            try:
                clean.append({"screen": int(w["screen"]), "layout": str(w["layout"])[:60], "tour": int(w.get("tour") or 0)})
            except (KeyError, TypeError, ValueError):
                continue
        self._app.cfg["walls"] = [w for w in clean if w["screen"] > 0 and w["layout"]]
        self._app.cfg["open_walls_on_connect"] = bool(auto)
        save_config(self._app.cfg)
        return self._app.state()

    def connect(self, i: int) -> dict:
        return self._app.connect(i)

    def trust(self, i: int) -> dict:
        return self._app.trust(i)


class ClientApp:
    def __init__(self):
        self.cfg = load_config()
        self.main = None
        self.walls: list = []
        self.base: str | None = None
        self._pem: dict[int, bytes] = {}

    def screens(self) -> list[dict]:
        import webview

        try:
            return [{"width": s.width, "height": s.height} for s in webview.screens]
        except Exception:  # noqa: BLE001
            return [{"width": 0, "height": 0}]

    def state(self) -> dict:
        return {"servers": self.cfg["servers"], "walls": self.cfg["walls"], "screens": self.screens(),
                "open_walls_on_connect": self.cfg["open_walls_on_connect"], "version": VERSION}

    def connect(self, i: int) -> dict:
        try:
            srv = self.cfg["servers"][i]
        except IndexError:
            return {"error": "서버를 찾을 수 없습니다."}
        ok, why = is_trusted(srv["url"])
        if not ok and why == "certificate":
            try:
                pem = fetch_ca(srv["url"], int(srv.get("http_port", 80)))
            except Exception as e:  # noqa: BLE001
                return {"error": f"서버 인증서를 신뢰할 수 없고, 서버에서 인증서를 받지도 못했습니다({e})."}
            self._pem[i] = pem
            return {"need_trust": True, "fingerprint": fingerprint(pem)}
        if not ok:
            return {"error": f"서버에 연결하지 못했습니다. 주소·네트워크·서버 상태를 확인하세요. ({why})"}
        self.cfg["last"] = i
        save_config(self.cfg)
        self.base = srv["url"]
        self.main.load_url(self.base + "/")
        self.main.set_title(f"{APP_NAME} — {srv['name']}")
        if self.cfg["open_walls_on_connect"]:
            threading.Timer(4.0, self.open_walls).start()  # 로그인 쿠키가 생긴 뒤 열리도록 약간 늦게
        return {"ok": True}

    def trust(self, i: int) -> dict:
        pem = self._pem.get(i)
        if not pem:
            return {"error": "인증서를 다시 받아 주세요."}
        if not install_ca_current_user(pem):
            return {"error": "인증서를 신뢰 목록에 넣지 못했습니다(확인 창에서 취소했거나 권한 문제)."}
        return {"ok": True}

    def open_walls(self) -> None:
        import webview

        self.close_walls()
        if not self.base:
            return
        screens = webview.screens
        for w in self.cfg["walls"]:
            if 0 < w["screen"] < len(screens):
                win = webview.create_window(f"영상벽 {w['screen'] + 1} — {w['layout']}", wall_url(self.base, w["layout"], w["tour"]),
                                            screen=screens[w["screen"]], fullscreen=True, background_color="#000000")
                self.walls.append(win)

    def close_walls(self) -> None:
        for w in self.walls:
            try:
                w.destroy()
            except Exception:  # noqa: BLE001
                pass
        self.walls = []

    def show_launcher(self) -> None:
        self.close_walls()
        self.base = None
        self.main.load_html(LAUNCHER_HTML)
        self.main.set_title(APP_NAME)

    def toggle_full(self) -> None:
        self.main.toggle_fullscreen()

    def run(self) -> None:
        import webview
        from webview.menu import Menu, MenuAction, MenuSeparator

        self.main = webview.create_window(APP_NAME, html=LAUNCHER_HTML, js_api=Api(self), width=1400, height=880,
                                          min_size=(900, 600), background_color="#0f1316", text_select=True)
        menu = [
            Menu("서버", [MenuAction("서버 선택 화면", self.show_launcher), MenuSeparator(),
                         MenuAction("끝내기", lambda: [w.destroy() for w in list(webview.windows)])]),
            Menu("영상벽", [MenuAction("영상벽 열기", self.open_walls), MenuAction("영상벽 닫기", self.close_walls)]),
            Menu("보기", [MenuAction("전체화면 전환(F11)", self.toggle_full),
                         MenuAction("새로 고침", lambda: self.main.evaluate_js("location.reload()"))]),
        ]
        webview.settings["ALLOW_DOWNLOADS"] = True  # 내보내기 MP4·스냅샷 저장(저장 위치 선택 창)
        webview.settings["IGNORE_SSL_ERRORS"] = False  # 인증서 오류는 무시하지 않음(신뢰 절차를 거침)
        storage = storage_dir()
        storage.mkdir(parents=True, exist_ok=True)
        webview.start(menu=menu, private_mode=False, storage_path=str(storage), gui="edgechromium")


def single_instance() -> bool:
    if os.name != "nt":
        return True
    import ctypes

    ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\WebNVRClient")
    return ctypes.windll.kernel32.GetLastError() != 183  # ERROR_ALREADY_EXISTS


def main() -> int:
    if not single_instance():
        return 0
    try:
        ClientApp().run()
    except Exception as e:  # noqa: BLE001
        if os.name == "nt":
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, f"관제 프로그램을 시작하지 못했습니다.\n{e}\n\n"
                                             "Microsoft Edge WebView2 런타임이 설치돼 있는지 확인하세요.", APP_NAME, 0x10)
        else:
            print(e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
