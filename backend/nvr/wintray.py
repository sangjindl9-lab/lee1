"""WebNVR 서버 관리(작업표시줄 아이콘) — 서버 PC 에서 서비스 상태를 보고 다시 시작·백업·폴더 열기.

서비스 시작·정지·백업은 관리자 권한이 필요해 윈도우 '사용자 계정 컨트롤' 확인 창을 거쳐 nvrctl 을 실행한다.
"""
from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from .winctl import ALL_SERVICES, layout, settings

LABEL = {"WebNVR-DB": "데이터베이스", "WebNVR-API": "관리 API", "WebNVR-Media": "영상 중계", "WebNVR-Recorder": "녹화",
         "WebNVR-Worker": "작업", "WebNVR-Analytics": "지능형 분석", "WebNVR-Proxy": "웹 접속"}
STATE = {"running": "실행 중", "stopped": "정지", "start_pending": "시작 중", "stop_pending": "정지 중",
         "not_installed": "설치 안 됨"}


def service_states() -> dict[str, str]:
    import psutil

    out = {}
    for sid in ALL_SERVICES:
        try:
            out[sid] = psutil.win_service_get(sid).status()
        except Exception:  # noqa: BLE001
            out[sid] = "not_installed"
    return out


def run_elevated(args: list[str]) -> None:
    """nvrctl 을 관리자 권한으로(UAC 확인) 실행."""
    lay = layout()
    params = "-m nvr.winctl " + subprocess.list2cmdline(args)
    ctypes.windll.shell32.ShellExecuteW(None, "runas", str(lay.python), params, str(lay.backend), 0)


def icon_image(ok: bool):
    from PIL import Image, ImageDraw

    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((4, 12, 60, 52), radius=8, fill=(23, 28, 33, 255), outline=(245, 183, 0, 255), width=3)
    d.ellipse((22, 22, 42, 42), fill=(63, 185, 80, 255) if ok else (229, 72, 77, 255))
    return im


class Tray:
    def __init__(self):
        self.states: dict[str, str] = {}
        self.icon = None
        self.running = True

    def ok(self) -> bool:
        return bool(self.states) and all(s == "running" for s in self.states.values())

    def url(self) -> str:
        cfg = settings(layout())
        port = cfg.get("NVR_HTTPS_PORT", "443")
        return f"https://{cfg.get('NVR_SITE_ADDRESS') or 'localhost'}" + ("" if port == "443" else f":{port}")

    def poll(self) -> None:
        prev_ok = None
        while self.running:
            try:
                self.states = service_states()
            except Exception:  # noqa: BLE001
                self.states = {}
            ok = self.ok()
            if self.icon:
                self.icon.icon = icon_image(ok)
                self.icon.title = "WebNVR 서버 — " + ("정상" if ok else "일부 서비스가 동작하지 않음")
                self.icon.update_menu()
                if prev_ok is True and not ok:
                    bad = [LABEL[k] for k, v in self.states.items() if v != "running"]
                    self.icon.notify("서비스가 멈췄습니다: " + ", ".join(bad) + "\n자동 재시작을 시도합니다.", "WebNVR 서버")
            prev_ok = ok
            time.sleep(10)

    def status_text(self, sid: str):
        return lambda item: f"{LABEL[sid]}: {STATE.get(self.states.get(sid, ''), self.states.get(sid, '확인 중'))}"

    def open_client(self, *_):
        lay = layout()
        pyw = lay.python.with_name("pythonw.exe")
        subprocess.Popen([str(pyw), "-m", "nvr.winclient"], cwd=str(lay.backend))

    def open_browser(self, *_):
        os.startfile(self.url())  # noqa: S606

    def open_folder(self, which: str):
        def _f(*_):
            lay = layout()
            path = {"logs": lay.logs, "recordings": Path(settings(lay)["NVR_RECORDINGS_DIR"]), "data": lay.data}[which]
            os.startfile(str(path))  # noqa: S606
        return _f

    def restart(self, *_):
        run_elevated(["restart"])

    def backup(self, *_):
        dest = Path.home() / "Documents" / "WebNVR-백업"
        run_elevated(["backup", str(dest)])
        if self.icon:
            self.icon.notify(f"백업을 시작했습니다. 저장 위치: {dest}", "WebNVR 서버")

    def fingerprint(self, *_):
        from .winclient import fingerprint

        ca = layout().public / "ca.crt"
        try:
            fp = fingerprint(ca.read_bytes())
            msg = (f"관제 프로그램이 처음 접속할 때 보여 주는 지문과 같은지 확인하세요.\n\n{fp}\n\n"
                   f"인증서 파일: {ca}")
        except OSError:
            msg = "웹 접속 인증서가 아직 없습니다. 서비스를 다시 시작해 보세요."
        ctypes.windll.user32.MessageBoxW(None, msg, "WebNVR 서버 인증서 지문", 0x40)

    def quit(self, icon, *_):
        self.running = False
        icon.stop()

    def run(self) -> None:
        import pystray
        from pystray import Menu, MenuItem as Item

        items = [Item(self.status_text(sid), None, enabled=False) for sid in ALL_SERVICES]
        menu = Menu(
            Item("관제 프로그램 열기", self.open_client, default=True),
            Item("웹 브라우저로 열기", self.open_browser),
            Menu.SEPARATOR,
            Item("서비스 상태", Menu(*items)),
            Item("서비스 다시 시작(관리자)", self.restart),
            Item("지금 백업(관리자)", self.backup),
            Item("인증서 지문 보기", self.fingerprint),
            Menu.SEPARATOR,
            Item("녹화 폴더 열기", self.open_folder("recordings")),
            Item("로그 폴더 열기", self.open_folder("logs")),
            Menu.SEPARATOR,
            Item("서버 관리 아이콘 닫기(서비스는 계속 동작)", self.quit),
        )
        self.icon = pystray.Icon("WebNVR", icon_image(False), "WebNVR 서버", menu)
        threading.Thread(target=self.poll, daemon=True).start()
        self.icon.run()


def main() -> int:
    if os.name != "nt":
        print("윈도우 전용입니다.", file=sys.stderr)
        return 2
    ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\WebNVRTray")
    if ctypes.windll.kernel32.GetLastError() == 183:
        return 0
    Tray().run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
