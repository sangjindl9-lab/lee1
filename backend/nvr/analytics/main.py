"""지능형 분석 서비스(analytics): 규칙이 켜진 카메라의 보조 스트림을 받아 CPU 로 분석하고 이벤트를 기록한다.

- 카메라마다 FFmpeg 1개(초당 analytics_fps 장, 폭 analytics_width 로 축소, BMP 파이프)와 분석 스레드 1개
- 사람 검출(YOLOX)은 프로세스 전체에서 모델 1개를 공유(잠금) — CPU 부하가 여기에 몰린다
- 이벤트: type=analytics, source=analytics, dedup_key=analytics:rule:<id>. 조건이 사라지고 10초 뒤 닫고,
  닫힌 뒤 cooldown 동안은 다시 열지 않는다. 열릴 때 표시가 그려진 스냅샷 JPEG 를 저장한다.
- 녹화 연동: 카메라의 이벤트 녹화 설정(event_triggers 에 analytics 포함)을 그대로 따른다.
"""
from __future__ import annotations

import logging
import os
import signal
import socket
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from ..camera_util import camera_source
from ..config import get_settings
from ..db import session_scope
from ..events import close_event, open_event
from ..media.ffmpeg import StreamSource, input_args
from ..models import AnalyticsRule, Camera, Event, ServiceHeartbeat, utcnow
from ..policy import triggers
from ..security.redact import redact
from . import LABELS, PERSON_RULES
from .person import Tracker, YoloXPerson
from .rules import Condition, RuleSpec, WaterLevelRule, make_rule

log = logging.getLogger("nvr.analytics")

HOLD_SECONDS = 10.0
TAG = {"fire": "FIRE", "smoke": "SMOKE", "no_helmet": "NO HELMET", "water_level": "WATER", "intrusion": "INTRUSION",
       "loitering": "LOITERING", "crowd": "CROWD", "fall": "FALL", "running": "RUNNING", "stationary": "STATIONARY"}


def dirs() -> dict[str, Path]:
    base = get_settings().analytics_dir
    d = {"snap": base / "snap", "live": base / "live", "ref": base / "ref"}
    for p in d.values():
        p.mkdir(parents=True, exist_ok=True)
    return d


def ref_path(rule_id: int) -> Path:
    return get_settings().analytics_dir / "ref" / f"rule{rule_id}.png"


def snap_path(event_id: int) -> Path:
    return get_settings().analytics_dir / "snap" / f"{event_id}.jpg"


def live_path(camera_id: int) -> Path:
    return get_settings().analytics_dir / "live" / f"cam{camera_id}.jpg"


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


# ───────────────────────── 프레임 입력 ─────────────────────────
class FrameReader:
    """FFmpeg → BMP 연속 이미지(파일 크기가 헤더에 있어 프레임 경계가 확실함)."""

    def __init__(self, src: StreamSource, fps: float, width: int):
        s = get_settings()
        self.src = src
        self.args = [s.ffmpeg_path, "-hide_banner", "-nostdin", "-loglevel", "error", *input_args(src, timeout_s=10),
                     "-an", "-vf", f"fps={fps},scale={int(width)}:-2", "-f", "image2pipe", "-c:v", "bmp", "pipe:1"]
        self.proc: subprocess.Popen | None = None
        self.err_tail = ""

    def start(self) -> None:
        self.proc = subprocess.Popen(self.args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, bufsize=0)
        threading.Thread(target=self._stderr, daemon=True).start()

    def _stderr(self) -> None:
        assert self.proc and self.proc.stderr
        for line in iter(self.proc.stderr.readline, b""):
            self.err_tail = redact(line.decode("utf-8", "replace").strip(), self.src.secrets)[-300:]

    def _read(self, n: int) -> bytes | None:
        assert self.proc and self.proc.stdout
        buf = bytearray()
        while len(buf) < n:
            chunk = self.proc.stdout.read(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return bytes(buf)

    def read(self) -> np.ndarray | None:
        head = self._read(14)
        if not head or head[:2] != b"BM":
            return None
        size = int.from_bytes(head[2:6], "little")
        if size < 54 or size > 64 * 1024 * 1024:
            return None
        rest = self._read(size - 14)
        if rest is None:
            return None
        return cv2.imdecode(np.frombuffer(head + rest, np.uint8), cv2.IMREAD_COLOR)

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


# ───────────────────────── 규칙 실행 상태 ─────────────────────────
@dataclass
class RuleRuntime:
    id: int
    type: str
    name: str
    severity: str
    cooldown: int
    impl: Any
    sig: tuple
    ref_requested: bool = False
    open: bool = False
    last_true: float = 0.0
    last_closed: float = -1e9
    last: Condition | None = None
    events: int = 0


@dataclass
class CamInfo:
    id: int
    site_id: int
    name: str
    triggers_analytics: bool
    src: StreamSource
    sig: tuple
    rules: list[dict[str, Any]] = field(default_factory=list)


class CameraAnalyzer:
    def __init__(self, info: CamInfo, detector_fn):
        self.info = info
        self.detector_fn = detector_fn
        self.rules: dict[int, RuleRuntime] = {}
        self.tracker = Tracker()
        self.running = True
        self.thread = threading.Thread(target=self.run, daemon=True, name=f"cam{info.id}")
        self.lock = threading.Lock()
        self.status: dict[str, Any] = {"state": "starting"}
        self.last_detect = 0.0
        self.last_preview = 0.0
        self.tracks = []
        self.reader: FrameReader | None = None
        self.apply_rules(info.rules)

    # 규칙 갱신(서비스 스레드에서 호출)
    def apply_rules(self, rules: list[dict[str, Any]]) -> None:
        with self.lock:
            keep = {}
            for r in rules:
                sig = (r["type"], r["zone"], r["line"], r["params"], r["ref_set_at"])
                cur = self.rules.get(r["id"])
                if cur and cur.sig == repr(sig):
                    cur.name, cur.severity, cur.cooldown = r["name"], r["severity"], r["cooldown_seconds"]
                    cur.ref_requested = r["ref_requested"]
                    keep[r["id"]] = cur
                    continue
                spec = RuleSpec(r["id"], r["type"], r["zone"], r["line"], r["params"])
                ref = None
                if r["type"] == "water_level" and ref_path(r["id"]).exists():
                    ref = cv2.imread(str(ref_path(r["id"])), cv2.IMREAD_GRAYSCALE)
                rt = RuleRuntime(r["id"], r["type"], r["name"], r["severity"], r["cooldown_seconds"],
                                 make_rule(spec, ref), repr(sig), ref_requested=r["ref_requested"])
                if cur:
                    rt.open, rt.last_true, rt.last_closed, rt.events = cur.open, cur.last_true, cur.last_closed, cur.events
                keep[r["id"]] = rt
            for rid, rt in self.rules.items():
                if rid not in keep and rt.open:
                    self._close(rt)
            self.rules = keep

    def stop(self) -> None:
        self.running = False
        if self.reader:
            self.reader.stop()  # 막혀 있는 read() 를 풀어 준다

    # 이벤트 열기·닫기
    def _open(self, rt: RuleRuntime, cond: Condition, frame: np.ndarray) -> None:
        h, w = frame.shape[:2]
        boxes = [[round(b[0] / w, 4), round(b[1] / h, 4), round(b[2] / w, 4), round(b[3] / h, 4)] for b in cond.boxes]
        label = LABELS.get(rt.type, rt.type)
        msg = f"{label} 감지 — {self.info.name}" + (f" ({rt.name})" if rt.name else "")
        details = {"label": label, "rule_type": rt.type, "rule_id": rt.id, "rule_name": rt.name,
                   "score": cond.score, "boxes": boxes, "info": cond.info, "detector": "nvr-analytics"}
        with session_scope() as db:
            ev = open_event(db, type="analytics", dedup_key=f"analytics:rule:{rt.id}", message=msg, severity=rt.severity,
                            camera_id=self.info.id, site_id=self.info.site_id, details=details, source="analytics",
                            triggers_recording=self.info.triggers_analytics)
            if ev is not None:
                db.flush()
                img = annotate(frame, [(rt.type, cond)], self.tracks, zones=[(rt.type, rt.impl.spec)], highlight=True)
                ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                if ok:
                    try:
                        _atomic_write(snap_path(ev.id), jpg.tobytes())
                        ev.details = {**details, "snapshot": True}
                    except OSError:
                        log.warning("스냅샷 저장 실패(event %s)", ev.id)
                log.info("분석 이벤트 시작: cam=%s rule=%s(%s) score=%s", self.info.id, rt.id, rt.type, cond.score)
        rt.open = True
        rt.events += 1

    def _close(self, rt: RuleRuntime) -> None:
        with session_scope() as db:
            close_event(db, f"analytics:rule:{rt.id}")
        rt.open = False
        rt.last_closed = time.monotonic()
        log.info("분석 이벤트 종료: cam=%s rule=%s(%s)", self.info.id, rt.id, rt.type)

    def _save_reference(self, rt: RuleRuntime, gray: np.ndarray) -> None:
        cv2.imwrite(str(ref_path(rt.id)), gray)
        if isinstance(rt.impl, WaterLevelRule):
            rt.impl.set_reference(gray)
        with session_scope() as db:
            r = db.get(AnalyticsRule, rt.id)
            if r:
                r.ref_set_at, r.ref_requested_at = utcnow(), None
        rt.ref_requested = False
        log.info("기준 영상 저장: rule=%s", rt.id)

    def process(self, frame: np.ndarray, t: float) -> None:
        with self.lock:
            rules = list(self.rules.values())
        need_person = any(r.type in PERSON_RULES for r in rules)
        if need_person and t - self.last_detect >= get_settings().analytics_detect_interval:
            self.last_detect = t
            a = time.monotonic()
            dets = self.detector_fn(frame)
            self.status["detect_ms"] = round((time.monotonic() - a) * 1000)
            self.tracks = self.tracker.update(dets, t)
            person_tick = True
        else:
            person_tick = False
        gray = None
        results = []
        for rt in rules:
            try:
                if rt.type in PERSON_RULES:
                    if not person_tick:
                        if rt.last:
                            results.append((rt.type, rt.last))
                        continue
                    cond = rt.impl.update(self.tracks, frame, t)
                elif rt.type == "water_level":
                    gray = gray if gray is not None else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    if rt.ref_requested:
                        self._save_reference(rt, gray)
                    cond = rt.impl.update(gray, t)
                else:
                    cond = rt.impl.update(frame, t)
            except Exception:  # noqa: BLE001
                log.exception("규칙 처리 오류 rule=%s", rt.id)
                continue
            rt.last = cond
            results.append((rt.type, cond))
            now = time.monotonic()
            if cond.active:
                rt.last_true = now
                if not rt.open and now - rt.last_closed >= rt.cooldown:
                    self._open(rt, cond, frame)
            elif rt.open and now - rt.last_true >= HOLD_SECONDS:
                self._close(rt)
        if t - self.last_preview >= 1.0:
            self.last_preview = t
            img = annotate(frame, results, self.tracks, zones=[(r.type, r.impl.spec) for r in rules])
            ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ok:
                try:
                    _atomic_write(live_path(self.info.id), jpg.tobytes())
                except OSError:
                    pass

    def run(self) -> None:
        s = get_settings()
        backoff = 2.0
        while self.running:
            reader = self.reader = FrameReader(self.info.src, s.analytics_fps, s.analytics_width)
            try:
                reader.start()
            except OSError as e:
                self.status.update(state="error", error=f"FFmpeg 실행 실패: {e}")
                time.sleep(10)
                continue
            # 입력은 별도 스레드가 계속 읽고 최신 프레임만 남긴다(분석이 느려도 FFmpeg·카메라 연결이 밀리지 않음)
            box = {"frame": None, "n": 0, "eof": False}
            cv = threading.Condition()

            def pump(reader=reader, box=box, cv=cv):
                while self.running:
                    f = reader.read()
                    with cv:
                        if f is None:
                            box["eof"] = True
                        else:
                            box["frame"], box["n"] = f, box["n"] + 1
                        cv.notify()
                    if f is None:
                        return

            threading.Thread(target=pump, daemon=True).start()
            seen = done = 0
            t0 = time.monotonic()
            while self.running:
                with cv:
                    cv.wait_for(lambda: box["n"] != seen or box["eof"] or not self.running, timeout=30)
                    if box["n"] == seen:
                        if not box["eof"] and self.running:
                            reader.err_tail = reader.err_tail or "30초 동안 영상 프레임이 없습니다."
                        break
                    seen, frame = box["n"], box["frame"]
                done += 1
                backoff = 2.0
                t = time.monotonic()
                self.status.update(state="running", error="", frames=seen, dropped=seen - done, width=frame.shape[1],
                                   height=frame.shape[0], last_frame_at=utcnow().isoformat(),
                                   fps=round(done / max(1e-3, t - t0), 2))
                try:
                    self.process(frame, t)
                except Exception:  # noqa: BLE001
                    log.exception("분석 처리 오류 cam=%s", self.info.id)
            reader.stop()
            if not self.running:
                break
            self.status.update(state="reconnecting", error=reader.err_tail or "영상 입력이 끊겼습니다.")
            log.warning("분석 입력 끊김 cam=%s: %s", self.info.id, reader.err_tail)
            time.sleep(backoff)
            backoff = min(60.0, backoff * 2)
        for rt in list(self.rules.values()):
            if rt.open:
                try:
                    self._close(rt)
                except Exception:  # noqa: BLE001
                    pass

    def snapshot_status(self) -> dict[str, Any]:
        out = dict(self.status)
        out["rules"] = {}
        for rid, rt in list(self.rules.items()):
            c = rt.last
            out["rules"][str(rid)] = {"type": rt.type, "active": bool(c.active) if c else False, "open": rt.open,
                                      "events": rt.events, "info": c.info if c else {},
                                      "ref_required": rt.type == "water_level" and getattr(rt.impl, "ref", None) is None}
        out["persons"] = len(self.tracks)
        return out


# ───────────────────────── 표시 그리기 ─────────────────────────
def annotate(frame: np.ndarray, results, tracks, zones=None, highlight=False) -> np.ndarray:
    img = frame.copy()
    h, w = img.shape[:2]
    for typ, spec in zones or []:
        if len(spec.zone) >= 3:
            pts = np.array([[int(x * w), int(y * h)] for x, y in spec.zone], np.int32)
            cv2.polylines(img, [pts], True, (0, 200, 255), 1, cv2.LINE_AA)
        if len(spec.line) == 2:
            (bx, by), (tx, ty) = spec.line
            cv2.line(img, (int(bx * w), int(by * h)), (int(tx * w), int(ty * h)), (255, 200, 0), 2)
    for tr in tracks:
        x, y, bw, bh = [int(v) for v in tr.box]
        cv2.rectangle(img, (x, y), (x + bw, y + bh), (80, 200, 80), 1)
    for typ, cond in results:
        color = (0, 0, 255) if cond.active else (0, 165, 255)
        for b in cond.boxes:
            x, y, bw, bh = [int(v) for v in b]
            cv2.rectangle(img, (x, y), (x + bw, y + bh), color, 2)
            cv2.putText(img, TAG.get(typ, typ), (x, max(12, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)
    y = h - 8
    for typ, cond in results:
        if cond.active or highlight:
            extra = ""
            if "level_percent" in cond.info:
                extra = f" {cond.info['level_percent']}%"
            cv2.putText(img, f"[{TAG.get(typ, typ)}]{extra}", (6, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2,
                        cv2.LINE_AA)
            y -= 18
    return img


# ───────────────────────── 서비스 ─────────────────────────
class Service:
    def __init__(self):
        self.running = True
        self.instance = f"{socket.gethostname()}:{os.getpid()}"
        self.started_at = utcnow()
        self.cams: dict[int, CameraAnalyzer] = {}
        self.detector: YoloXPerson | None = None
        self.model_error = ""

    def detect(self, frame):
        if self.detector is None:
            return []
        return self.detector.detect(frame)

    def load_model(self) -> None:
        s = get_settings()
        if not Path(s.analytics_model_path).exists():
            self.model_error = f"사람 검출 모델 파일이 없습니다: {s.analytics_model_path} (사람 관련 규칙은 동작하지 않음)"
            log.error(self.model_error)
            return
        try:
            self.detector = YoloXPerson(s.analytics_model_path, threads=s.analytics_threads)
        except Exception as e:  # noqa: BLE001
            self.model_error = f"모델을 읽지 못했습니다: {e}"
            log.exception("모델 로드 실패")

    def close_orphans(self) -> None:
        with session_scope() as db:
            evs = db.scalars(select(Event).where(Event.source == "analytics", Event.ended_at.is_(None),
                                                 Event.dedup_key.like("analytics:rule:%"))).all()
            for ev in evs:
                ev.ended_at = utcnow()
            if evs:
                log.info("이전 실행에서 열린 분석 이벤트 %d건 종료 처리", len(evs))

    def desired(self) -> dict[int, CamInfo]:
        s = get_settings()
        out: dict[int, CamInfo] = {}
        with session_scope() as db:
            rules = db.scalars(select(AnalyticsRule).where(AnalyticsRule.enabled.is_(True))
                               .order_by(AnalyticsRule.camera_id, AnalyticsRule.id)).all()
            by_cam: dict[int, list[AnalyticsRule]] = {}
            for r in rules:
                by_cam.setdefault(r.camera_id, []).append(r)
            if not by_cam:
                return {}
            cams = db.scalars(select(Camera).options(joinedload(Camera.site)).where(Camera.id.in_(list(by_cam)),
                                                                                    Camera.enabled.is_(True))).all()
            for cam in cams[: s.analytics_max_cameras]:
                try:
                    src = camera_source(cam, "sub")
                except Exception as e:  # noqa: BLE001
                    log.warning("분석 입력 주소 오류 cam=%s: %s", cam.id, e)
                    continue
                rl = [{"id": r.id, "type": r.type, "name": r.name, "zone": r.zone or [], "line": r.line or [],
                       "params": r.params or {}, "severity": r.severity, "cooldown_seconds": r.cooldown_seconds,
                       "ref_requested": r.ref_requested_at is not None,
                       "ref_set_at": r.ref_set_at.isoformat() if r.ref_set_at else None} for r in by_cam[cam.id]]
                out[cam.id] = CamInfo(cam.id, cam.site_id, cam.name, triggers(cam, "analytics"), src,
                                      sig=(src.url, cam.config_version), rules=rl)
        return out

    def reconcile(self) -> None:
        want = self.desired()
        for cid in list(self.cams):
            ca = self.cams[cid]
            if cid not in want or want[cid].sig != ca.info.sig:
                ca.stop()
                ca.thread.join(timeout=15)
                del self.cams[cid]
        for cid, info in want.items():
            if cid in self.cams:
                self.cams[cid].info.name = info.name
                self.cams[cid].info.triggers_analytics = info.triggers_analytics
                self.cams[cid].apply_rules(info.rules)
            else:
                ca = CameraAnalyzer(info, self.detect)
                self.cams[cid] = ca
                ca.thread.start()
                log.info("분석 시작 cam=%s 규칙 %d개", cid, len(info.rules))

    def cleanup(self) -> None:
        keep_days = get_settings().default_retention_days
        cutoff = time.time() - keep_days * 86400
        for f in (get_settings().analytics_dir / "snap").glob("*.jpg"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                pass
        live = {f"cam{c}.jpg" for c in self.cams}
        for f in (get_settings().analytics_dir / "live").glob("*.jpg"):
            if f.name not in live:
                f.unlink(missing_ok=True)

    def heartbeat(self) -> None:
        s = get_settings()
        info = {"model": "YOLOX-s (OpenCV Zoo, Apache-2.0)" if self.detector else None, "model_error": self.model_error,
                "fps": s.analytics_fps, "detect_interval": s.analytics_detect_interval,
                "cameras": {str(cid): ca.snapshot_status() for cid, ca in self.cams.items()}}
        with session_scope() as db:
            hb = db.get(ServiceHeartbeat, "analytics")
            if not hb:
                hb = ServiceHeartbeat(name="analytics", started_at=self.started_at, last_seen_at=utcnow())
                db.add(hb)
            if hb.instance != self.instance:
                hb.started_at = self.started_at
            hb.instance, hb.last_seen_at, hb.info = self.instance, utcnow(), info

    def loop(self) -> None:
        dirs()
        self.load_model()
        self.close_orphans()
        last = {"rec": 0.0, "hb": 0.0, "clean": 0.0}
        while self.running:
            now = time.monotonic()
            try:
                if now - last["rec"] >= 5:
                    last["rec"] = now
                    self.reconcile()
                if now - last["hb"] >= 5:
                    last["hb"] = now
                    self.heartbeat()
                if now - last["clean"] >= 3600:
                    last["clean"] = now
                    self.cleanup()
            except Exception:  # noqa: BLE001
                log.exception("분석 서비스 루프 오류(계속 진행)")
            time.sleep(1)
        for ca in self.cams.values():
            ca.stop()
        for ca in self.cams.values():
            ca.thread.join(timeout=15)


def main() -> None:
    s = get_settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    svc = Service()

    def _stop(*_):
        svc.running = False

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    svc.loop()


if __name__ == "__main__":
    main()
