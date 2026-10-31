"""녹화 서비스(recorder).

카메라별 FFmpeg 프로세스를 감독한다. 웹 화면·API와 무관하게 동작하므로 브라우저를 닫거나
로그아웃해도 녹화는 계속된다. 원하는 상태는 DB(cameras)에서 읽는다.
"""
from __future__ import annotations

import collections
import datetime as dt
import logging
import os
import shutil
import socket
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select

from ..camera_util import camera_source
from ..config import get_settings
from ..db import session_scope
from ..events import close_event, open_event, point_event
from ..media.ffmpeg import (AUDIO_TRANSCODE, ERROR_TEXT, MP4_AUDIO_COPY, SUPPORTED_VIDEO, StreamSource,
                            classify_error, input_args, probe_stream)
from ..models import Camera, CameraStatus, ServiceHeartbeat, utcnow
from ..policy import CamPolicy
from ..security.netguard import TargetDenied
from ..security.redact import redact
from ..storage import disk_info
from ..osutil import ffmpeg_graceful_stop, ffmpeg_nostdin, ffmpeg_stdin, install_stop_handler, kill_orphan, popen_flags
from .segments import (SEG_PATTERN, FinalizeError, finalize_segment, name_epoch, parse_list, probe_duration,
                       reindex_orphans, seg_files)

log = logging.getLogger("nvr.recorder")

BACKOFF_MIN, BACKOFF_MAX = 2, 60
AUTH_BACKOFF_MIN, AUTH_BACKOFF_MAX = 60, 600
SENTINEL = ".nvr-volume"


def _epoch(run_dir: Path, name: str) -> int | None:
    """구간 파일 시작 시각. 파일 수정 시각으로 시간대 오류를 보정(구간 길이 < 20분 전제)."""
    try:
        ref = (run_dir / name).stat().st_mtime
    except OSError:
        ref = None
    return name_epoch(name, ref)


@dataclass
class Run:
    proc: subprocess.Popen
    run_dir: Path
    started_wall: float
    source: StreamSource
    codecs: dict
    kind: str
    stderr: collections.deque = field(default_factory=lambda: collections.deque(maxlen=60))
    processed: set = field(default_factory=set)
    anchor: float | None = None
    last_growth: float = field(default_factory=time.time)
    last_size: int = -1
    segments_done: int = 0
    stop_requested: bool = False
    retry_finalize_at: float = 0.0


@dataclass
class CamState:
    camera_id: int
    site_id: int
    name: str
    config_version: int
    kind: str
    run: Run | None = None
    retry_count: int = 0
    next_start: float = 0.0
    last_error: str = ""
    error_message: str = ""
    offline_open: bool = False
    status_dirty: bool = True
    state: str = "connecting"
    last_status_write: float = 0.0
    last_segment_at: dt.datetime | None = None
    connected_since: dt.datetime | None = None


class Recorder:
    def __init__(self):
        self.s = get_settings()
        self.cams: dict[int, CamState] = {}
        self.running = True
        self.instance = f"{socket.gethostname()}:{os.getpid()}"
        self.started_at = utcnow()
        self.last_desired = 0.0
        self.last_hb = 0.0
        self.last_sweep = time.time()
        self.storage_ok = True
        self.policies: dict[int, CamPolicy] = {}

    # ------------------------------------------------------------ 시작·복구
    def startup(self) -> None:
        self.s.recordings_dir.mkdir(parents=True, exist_ok=True)
        self.s.incoming_dir.mkdir(parents=True, exist_ok=True)
        sentinel = self.s.recordings_dir / SENTINEL
        with session_scope() as db:
            from sqlalchemy import func

            from ..models import RecordingSegment

            n = db.scalar(select(func.count()).select_from(RecordingSegment)) or 0
            if not sentinel.exists() and n > 0:
                self.storage_ok = False
                open_event(db, type="storage_full", dedup_key="storage:mount", severity="critical",
                           message="녹화 저장소 표식 파일이 없습니다. 저장 볼륨 마운트를 확인하세요(재색인 생략).")
            point_event(db, type="service_started", message=f"녹화 서비스 시작 ({self.instance})")
        if not sentinel.exists():
            sentinel.write_text("web-nvr recordings volume\n", encoding="utf-8")
        with session_scope() as db:  # 복구 구간에도 카메라 녹화 정책을 적용
            for c in db.scalars(select(Camera)):
                self.policies[c.id] = CamPolicy.of(c)
        recovered = self.recover_incoming()
        added = reindex_orphans() if self.storage_ok else 0
        log.info("복구 완료: 미확정 구간 %d개 확정, 미색인 파일 %d개 재색인", recovered, added)

    def recover_incoming(self) -> int:
        n = 0
        for cam_dir in sorted(self.s.incoming_dir.glob("cam*")):
            try:
                cam_id = int(cam_dir.name[3:])
            except ValueError:
                continue
            kind = "continuous"
            for run_dir in sorted(cam_dir.glob("run_*")):
                self._kill_orphan(run_dir)
                n += self._drain_run_dir(cam_id, run_dir, kind, anchor=None, codecs={}, final=True)
                self._remove_if_done(run_dir)
        return n

    @staticmethod
    def _remove_if_done(run_dir: Path) -> None:
        """확정하지 못한 구간 파일이 남아 있으면 폴더를 지우지 않는다(다음 정리·재시작 때 재시도)."""
        if not seg_files(run_dir):
            shutil.rmtree(run_dir, ignore_errors=True)

    def sweep_leftovers(self) -> None:
        """실행 중이 아닌 run 폴더(저장공간 부족 등으로 확정이 미뤄진 구간)를 다시 처리."""
        active = {cs.run.run_dir for cs in self.cams.values() if cs.run}
        for cam_dir in self.s.incoming_dir.glob("cam*"):
            try:
                cam_id = int(cam_dir.name[3:])
            except ValueError:
                continue
            for run_dir in cam_dir.glob("run_*"):
                if run_dir in active:
                    continue
                self._drain_run_dir(cam_id, run_dir, "continuous", anchor=None, codecs={}, final=True)
                self._remove_if_done(run_dir)

    @staticmethod
    def _kill_orphan(run_dir: Path) -> None:
        """이전 recorder 가 비정상 종료돼 남은 FFmpeg 가 같은 폴더에 계속 쓰지 않도록 정리."""
        pidf = run_dir / "ffmpeg.pid"
        try:
            pid = int(pidf.read_text().strip())
        except (OSError, ValueError):
            return
        if kill_orphan(pid, str(run_dir)):
            log.warning("이전 실행에서 남은 FFmpeg(pid %d)를 정리했습니다", pid)

    # ------------------------------------------------------------ 원하는 상태
    def load_desired(self) -> dict[int, Camera]:
        now = utcnow()
        with session_scope() as db:
            cams = db.scalars(select(Camera).where(Camera.deleted_at.is_(None), Camera.enabled.is_(True))).all()
            out = {}
            for c in cams:
                pol = CamPolicy.of(c)
                if pol.decide(now) is not None:
                    _ = c.site.allowed_networks  # 관계 로드
                    out[c.id] = c
                    self.policies[c.id] = pol
            # 녹화 꺼진 카메라 상태 표시
            for c in db.scalars(select(Camera).where(Camera.deleted_at.is_(None))):
                if c.id not in out:
                    st = db.get(CameraStatus, c.id) or CameraStatus(camera_id=c.id)
                    want = "stopped" if c.enabled else "idle"
                    if st.recorder_state != want:
                        st.recorder_state, st.error_code, st.error_message = want, "", ""
                        st.updated_at = utcnow()
                        db.merge(st)
            return out

    def reconcile(self) -> None:
        desired = self.load_desired()
        for cid in list(self.cams):
            cs = self.cams[cid]
            cam = desired.get(cid)
            if cam is None or cam.config_version != cs.config_version:
                log.info("카메라 %s 녹화 중지(%s)", cid, "설정 변경" if cam else "녹화 꺼짐")
                self.stop_run(cs)
                if cam is None:
                    if cs.offline_open:
                        with session_scope() as db:
                            close_event(db, f"cam:{cid}:offline")
                    del self.cams[cid]
                else:
                    cs.config_version = cam.config_version
                    cs.retry_count, cs.next_start = 0, 0
        for cid, cam in desired.items():
            kind = (self.policies[cid].decide(utcnow()) or ("continuous", "ready"))[0]
            if cid not in self.cams:
                self.cams[cid] = CamState(camera_id=cid, site_id=cam.site_id, name=cam.name,
                                          config_version=cam.config_version, kind=kind)
            cs = self.cams[cid]
            cs.kind = kind
            if cs.run is None and time.time() >= cs.next_start:
                self.start_run(cs, cam)

    # ------------------------------------------------------------ 프로세스
    def start_run(self, cs: CamState, cam: Camera) -> None:
        cs.state = "connecting"
        cs.status_dirty = True
        try:
            d = disk_info()
            if d.free < self.s.recorder_min_free_mb * 1024 * 1024:
                self.fail(cs, "disk_full", "남은 저장공간이 너무 적어 녹화를 시작하지 않습니다(보관 정리 대기).")
                return
        except OSError as exc:
            self.fail(cs, "disk_write_error", f"저장소 확인 실패: {exc}")
            return
        try:
            src = camera_source(cam, "main")
        except TargetDenied as exc:
            self.fail(cs, exc.code, exc.message, long=True)
            return
        except RuntimeError as exc:
            self.fail(cs, "credential_error", str(exc), long=True)
            return
        probe = probe_stream(src, sample_seconds=1, timeout_s=20)
        if not probe.ok:
            self.fail(cs, probe.error_code, probe.error_message, long=probe.error_code in ("auth_failed", "codec_unsupported"))
            return
        vcodec = (probe.video or {}).get("codec", "")
        acodec = (probe.audio or {}).get("codec", "") if probe.audio else ""
        if vcodec not in SUPPORTED_VIDEO:
            self.fail(cs, "codec_unsupported", f"{ERROR_TEXT['codec_unsupported']} (감지: {vcodec})", long=True)
            return
        self._save_stream_info(cs.camera_id, probe)
        run_dir = self.s.incoming_dir / f"cam{cs.camera_id}" / f"run_{int(time.time() * 1000)}"
        run_dir.mkdir(parents=True, exist_ok=True)
        args = [self.s.ffmpeg_path, "-hide_banner", *ffmpeg_nostdin(), "-loglevel", "warning", "-fflags", "+genpts",
                *input_args(src, timeout_s=10), "-map", "0:v:0"]
        if acodec in MP4_AUDIO_COPY:
            args += ["-map", "0:a:0", "-c:v", "copy", "-c:a", "copy"]
        elif acodec in AUDIO_TRANSCODE or acodec:
            args += ["-map", "0:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "64k"]
        else:
            args += ["-c:v", "copy"]
        if vcodec == "hevc":
            args += ["-tag:v", "hvc1"]
        args += [
            "-f", "segment", "-segment_time", str(self._segment_seconds(cs.camera_id)), "-segment_atclocktime", "1",
            "-reset_timestamps", "1", "-strftime", "1", "-segment_format", "mp4",
            "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
            "-segment_list", str(run_dir / "list.csv"), "-segment_list_type", "csv", "-segment_list_flags", "live",
            str(run_dir / SEG_PATTERN),
        ]
        env = dict(os.environ, TZ="UTC0")  # 구간 파일 이름(strftime)을 UTC 로
        extra = popen_flags() if os.name == "nt" else {"start_new_session": True}
        try:
            proc = subprocess.Popen(args, stdin=ffmpeg_stdin(), stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE, env=env, **extra)
        except OSError as exc:
            self.fail(cs, "unknown", f"FFmpeg 실행 실패: {exc}")
            return
        (run_dir / "ffmpeg.pid").write_text(str(proc.pid))
        run = Run(proc=proc, run_dir=run_dir, started_wall=time.time(), source=src,
                  codecs={"video": vcodec, "audio": acodec}, kind=cs.kind)
        threading.Thread(target=self._read_stderr, args=(run,), daemon=True).start()
        cs.run = run
        log.info("카메라 %s 녹화 프로세스 시작 (%s, video=%s audio=%s)", cs.camera_id, src.safe_url, vcodec, acodec or "-")

    def _segment_seconds(self, camera_id: int) -> int:
        """이벤트 녹화를 쓰는 카메라는 전·후 버퍼 정밀도를 위해 짧은 구간(기본 10초)."""
        pol = self.policies.get(camera_id)
        if pol and pol.uses_events():
            return max(4, self.s.event_segment_seconds)
        return self.s.segment_seconds

    @staticmethod
    def _save_stream_info(camera_id: int, probe) -> None:
        """녹화 시작 시 확인한 코덱·해상도를 카메라 정보에 기록(설정 버전은 바꾸지 않음)."""
        try:
            with session_scope() as db:
                cam = db.get(Camera, camera_id)
                if cam:
                    info = dict(cam.stream_info or {})
                    info["main"] = {"video": probe.video, "audio": probe.audio, "bitrate_kbps": probe.bitrate_kbps,
                                    "measured_fps": probe.measured_fps, "tested_at": utcnow().isoformat(),
                                    "source": "recorder"}
                    cam.stream_info = info
        except Exception:  # noqa: BLE001
            log.exception("스트림 정보 저장 실패")

    @staticmethod
    def _read_stderr(run: Run) -> None:
        assert run.proc.stderr is not None
        for raw in iter(run.proc.stderr.readline, b""):
            line = redact(raw.decode("utf-8", "replace").rstrip(), run.source.secrets)
            # RTSP 복사 시 반복되는 무해한 경고는 원인 표시를 가리므로 제외
            if line and "Timestamps are unset in a packet" not in line:
                run.stderr.append(line)

    def stop_run(self, cs: CamState) -> None:
        run = cs.run
        if not run:
            return
        run.stop_requested = True
        ffmpeg_graceful_stop(run.proc, timeout=15)  # segment 먹서가 현재 구간을 닫도록
        self.drain(cs, final=True)
        self._remove_if_done(run.run_dir)
        cs.run = None

    # ------------------------------------------------------------ 구간 처리
    def drain(self, cs: CamState, final: bool = False) -> None:
        run = cs.run
        if not run:
            return
        if not final and time.time() < run.retry_finalize_at:
            return
        n = self._drain_run_dir(cs.camera_id, run.run_dir, run.kind, anchor=run.anchor, codecs=run.codecs,
                                final=final, run=run, cs=cs)
        run.segments_done += n

    def _drain_run_dir(self, camera_id: int, run_dir: Path, kind: str, anchor: float | None, codecs: dict,
                       final: bool, run: Run | None = None, cs: CamState | None = None) -> int:
        lines = parse_list(run_dir / "list.csv")
        files = seg_files(run_dir)
        done = 0
        processed = run.processed if run else set()
        last_end = None
        for ln in lines:
            last_end = ln.end
            if ln.name in processed:
                continue
            path = run_dir / ln.name
            if not path.exists():
                processed.add(ln.name)
                continue
            if anchor is None:
                # 다음 구간 파일 이름(=시계 경계에서 열린 시각)으로 기준점 계산
                nxt = [f for f in files if (name_epoch(f) or 0) > (name_epoch(ln.name) or 0)]
                if nxt:
                    anchor = _epoch(run_dir, nxt[0]) + 0.5 - ln.end
                else:
                    anchor = (_epoch(run_dir, ln.name) or time.time()) - ln.start
                if run:
                    run.anchor = anchor
            start = dt.datetime.fromtimestamp(anchor + ln.start, tz=dt.timezone.utc)
            res = self._finalize(camera_id, path, start, ln.end - ln.start, kind, codecs, cs)
            if res == "retry":
                # 저장공간 부족: 파일을 남겨 두고 나중에(공간 확보 후·재시작 시) 다시 확정
                if run:
                    run.retry_finalize_at = time.time() + 10
                return done
            if res == "ok":
                done += 1
            processed.add(ln.name)
        if final:
            # 목록에 없는 마지막(열려 있던) 구간: 조각화 MP4라 마지막 조각까지 복구 가능
            for f in files:
                if f in processed:
                    continue
                path = run_dir / f
                dur = probe_duration(path)
                if not dur:
                    path.unlink(missing_ok=True)
                    continue
                if last_end is not None and anchor is not None:
                    start_epoch = anchor + last_end
                else:
                    start_epoch = float(_epoch(run_dir, f) or time.time())
                start = dt.datetime.fromtimestamp(start_epoch, tz=dt.timezone.utc)
                res = self._finalize(camera_id, path, start, dur, kind, codecs, cs)
                if res == "retry":
                    return done
                if res == "ok":
                    done += 1
                processed.add(f)
                last_end = (last_end or 0) + dur
        return done

    def _finalize(self, camera_id: int, path: Path, start: dt.datetime, dur: float, kind: str, codecs: dict,
                  cs: CamState | None) -> str:
        """'ok' 확정 / 'skip' 버림(손상·너무 짧음) / 'retry' 저장공간 문제로 나중에 재시도"""
        pol = self.policies.get(camera_id)
        decided = pol.decide(start + dt.timedelta(seconds=min(1.0, dur / 2))) if pol else None
        # 정책 경계(일정 종료 직후 등)에 걸친 구간은 버퍼로 두어 이벤트가 없으면 정리된다
        kind, status = decided if decided else ("event", "buffer") if pol else (kind, "ready")
        try:
            seg = finalize_segment(camera_id, path, start, dur, kind, codecs, status=status)
        except FinalizeError as exc:
            log.error("카메라 %s 구간 확정 실패: %s", camera_id, exc)
            with session_scope() as db:
                if exc.code in ("disk_full", "disk_write_error"):
                    open_event(db, type="disk_write_error", dedup_key="storage:write", severity="critical",
                               message=str(exc), camera_id=camera_id)
                else:
                    point_event(db, type="disk_write_error", severity="warning", message=str(exc), camera_id=camera_id)
            if exc.code in ("disk_full", "disk_write_error", "remux_timeout"):
                if cs:
                    cs.state, cs.last_error, cs.error_message = "error", exc.code, str(exc)
                    cs.status_dirty = True
                return "retry"
            return "skip"
        if seg and cs:
            cs.last_segment_at = seg.end_at
            self.mark_recording(cs)
        if seg:
            with session_scope() as db:
                close_event(db, "storage:write")
        return "ok" if seg is not None else "skip"

    # ------------------------------------------------------------ 상태
    def mark_recording(self, cs: CamState) -> None:
        if cs.state != "recording":
            cs.connected_since = cs.connected_since or utcnow()
        cs.state = "recording"
        cs.retry_count = 0
        cs.last_error = ""
        cs.status_dirty = True
        if cs.offline_open:
            with session_scope() as db:
                close_event(db, f"cam:{cs.camera_id}:offline")
                point_event(db, type="camera_online", message=f"{cs.name}: 연결 복구, 녹화 재개", camera_id=cs.camera_id,
                            site_id=cs.site_id)
            cs.offline_open = False

    def fail(self, cs: CamState, code: str, message: str, long: bool = False) -> None:
        if code == "auth_failed":
            long = True
        lo, hi = (AUTH_BACKOFF_MIN, AUTH_BACKOFF_MAX) if long else (BACKOFF_MIN, BACKOFF_MAX)
        delay = min(hi, lo * (2 ** min(cs.retry_count, 10)))
        cs.retry_count += 1
        cs.next_start = time.time() + delay
        cs.state = "retry_wait"
        cs.last_error = code
        cs.connected_since = None
        cs.status_dirty = True
        cs.error_message = message
        log.warning("카메라 %s: %s — %s (%d초 후 재시도)", cs.camera_id, code, message[:200], delay)
        if not cs.offline_open:
            with session_scope() as db:
                open_event(db, type="camera_offline", dedup_key=f"cam:{cs.camera_id}:offline",
                                severity="critical" if code in ("disk_full", "disk_write_error") else "warning",
                                message=f"{cs.name}: 녹화 중단 — {ERROR_TEXT.get(code, code)}", camera_id=cs.camera_id,
                                site_id=cs.site_id, details={"error_code": code})
            cs.offline_open = True

    def write_status(self, cs: CamState, force: bool = False) -> None:
        now = time.time()
        if not (cs.status_dirty or force or now - cs.last_status_write > 15):
            return
        with session_scope() as db:
            st = db.get(CameraStatus, cs.camera_id)
            if not st:
                st = CameraStatus(camera_id=cs.camera_id)
                db.add(st)
            st.recorder_state = cs.state
            st.error_code = cs.last_error
            st.error_message = cs.error_message if cs.last_error else ""
            st.retry_count = cs.retry_count
            st.next_retry_at = (dt.datetime.fromtimestamp(cs.next_start, tz=dt.timezone.utc)
                                if cs.state == "retry_wait" else None)
            st.connected_since = cs.connected_since
            if cs.last_segment_at:
                st.last_segment_at = cs.last_segment_at
            st.updated_at = utcnow()
        cs.status_dirty = False
        cs.last_status_write = now

    def check_runs(self) -> None:
        for cs in list(self.cams.values()):
            run = cs.run
            if not run:
                continue
            self.drain(cs)
            # 진행 감시: 가장 최근 구간 파일 크기 증가 여부
            files = seg_files(run.run_dir)
            if files:
                try:
                    size = (run.run_dir / files[-1]).stat().st_size
                except FileNotFoundError:
                    size = run.last_size
                if size != run.last_size:
                    run.last_size, run.last_growth = size, time.time()
                    if cs.state != "recording" and size > 0:
                        cs.state = "recording"
                        cs.connected_since = cs.connected_since or utcnow()
                        cs.status_dirty = True
            elif time.time() - run.started_wall > 30:
                run.last_growth = min(run.last_growth, run.started_wall)
            stalled = time.time() - run.last_growth > 40
            rc = run.proc.poll()
            if rc is None and stalled:
                log.warning("카메라 %s: 40초간 데이터 수신 없음 — 프로세스 재시작", cs.camera_id)
                run.stderr.append("stall: no data for 40s (timed out)")
                run.proc.kill()
                run.proc.wait(timeout=5)
                rc = run.proc.returncode
            if rc is not None:
                self.drain(cs, final=True)
                self._remove_if_done(run.run_dir)
                err = "\n".join(run.stderr)
                code = classify_error(err, timed_out=stalled)
                if code == "unknown" and rc == 0:
                    code = "stream_ended"
                msg = ERROR_TEXT.get(code, "") + (f" — {run.stderr[-1][:200]}" if run.stderr else "")
                cs.run = None
                if run.segments_done == 0 and cs.retry_count == 0 and code == "unknown":
                    code = "stream_ended"
                self.fail(cs, code, msg)

    def heartbeat(self) -> None:
        if time.time() - self.last_hb < 10:
            return
        self.last_hb = time.time()
        info = {"cameras": len(self.cams), "running": sum(1 for c in self.cams.values() if c.run),
                "storage_ok": self.storage_ok}
        with session_scope() as db:
            hb = db.get(ServiceHeartbeat, "recorder")
            if not hb:
                hb = ServiceHeartbeat(name="recorder", started_at=self.started_at, last_seen_at=utcnow())
                db.add(hb)
            if hb.instance != self.instance:
                hb.started_at = self.started_at
            hb.instance, hb.last_seen_at, hb.info = self.instance, utcnow(), info

    # ------------------------------------------------------------ 루프
    def loop(self) -> None:
        self.startup()
        while self.running:
            try:
                if time.time() - self.last_desired > 5:
                    self.reconcile()
                    self.last_desired = time.time()
                if time.time() - self.last_sweep > 60:
                    self.sweep_leftovers()
                    self.last_sweep = time.time()
                self.check_runs()
                for cs in self.cams.values():
                    self.write_status(cs)
                self.heartbeat()
            except Exception:  # noqa: BLE001
                log.exception("녹화 감독 루프 오류(계속 진행)")
                time.sleep(2)
            time.sleep(1)
        log.info("종료 요청 — 진행 중인 구간을 닫습니다")
        for cs in list(self.cams.values()):
            try:
                self.stop_run(cs)
                cs.state = "idle"
                self.write_status(cs, force=True)
            except Exception:  # noqa: BLE001
                log.exception("카메라 %s 정지 중 오류", cs.camera_id)


def main() -> None:
    s = get_settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # 이벤트 수신 요청마다 남는 로그 억제
    r = Recorder()

    def _stop(*_):
        r.running = False

    install_stop_handler(_stop)
    r.loop()


if __name__ == "__main__":
    main()
