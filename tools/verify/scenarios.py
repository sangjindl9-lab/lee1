#!/usr/bin/env python3
"""
[검증 도구] 녹화 서비스 장애 시나리오 시험 — 합성 RTSP 카메라(tools/test-camera)를 사용한다.

실행 중인 api·recorder·worker 와 시험 카메라가 필요하다(docs/04-검증결과.md 의 시험 환경 참조).
결과는 표준출력에 JSON 줄로 남긴다. 실제 카메라 시험이 아니다.

  NVR_BASE=http://127.0.0.1:8000 NVR_ADMIN_PW=... python scenarios.py --camera 1 \
      --cam-start "<시험 카메라 시작 명령>" --cam-stop "<중지 명령>" --recorder-kill "<recorder 강제종료 명령>" --recorder-start "<시작 명령>"
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import time

import httpx

B = os.environ.get("NVR_BASE", "http://127.0.0.1:8000")


class C:
    def __init__(self):
        self.h = httpx.Client(base_url=B, timeout=60, verify=False)
        self.csrf = ""

    def login(self, u, p):
        r = self.h.post("/api/auth/login", json={"username": u, "password": p})
        r.raise_for_status()
        self.csrf = r.json()["csrf_token"]

    def get(self, path, **kw):
        return self.h.get(path, **kw).json()

    def req(self, m, path, **kw):
        return self.h.request(m, path, headers={"X-CSRF-Token": self.csrf}, **kw)


def now():
    return dt.datetime.now(dt.timezone.utc)


def wait(pred, timeout, step=2.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = pred()
        if v:
            return v, round(time.time() - t0, 1)
        time.sleep(step)
    return None, round(time.time() - t0, 1)


def status(c, cam):
    return c.get(f"/api/cameras/{cam}")["status"]


def report(name, ok, **kw):
    print(json.dumps({"scenario": name, "result": "PASS" if ok else "FAIL", **kw}, ensure_ascii=False), flush=True)


def sh(cmd):
    subprocess.run(cmd, shell=True, check=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, required=True)
    ap.add_argument("--cam-start", required=True)
    ap.add_argument("--cam-stop", required=True)
    ap.add_argument("--recorder-kill", required=True)
    ap.add_argument("--recorder-start", required=True)
    ap.add_argument("--cam-password", required=True)
    a = ap.parse_args()
    c = C()
    c.login("admin", os.environ["NVR_ADMIN_PW"])
    cam = a.camera

    # 0) 정상 녹화 확인
    st, t = wait(lambda: status(c, cam)["state"] == "recording", 90)
    report("baseline_recording", bool(st), waited_s=t, state=status(c, cam)["state"])

    # 1) 카메라 단절 → 오프라인 감지 → 복구 후 자동 재연결 + 누락 구간 기록
    t_down = now()
    sh(a.cam_stop)
    st, t = wait(lambda: status(c, cam)["state"] == "retry_wait", 90)
    s1 = status(c, cam)
    report("camera_disconnect_detected", bool(st), waited_s=t, error_code=s1["error_code"], message=s1["error_message"][:120])
    time.sleep(20)
    sh(a.cam_start)
    t_up = now()
    st, t = wait(lambda: status(c, cam)["state"] == "recording" and status(c, cam)["retry_count"] == 0, 150)
    report("camera_reconnect_auto", bool(st), waited_s=t)
    wait(lambda: any(e["type"] == "camera_online" for e in c.get("/api/events", params={"camera_id": cam, "limit": 5})["items"]), 120)
    tl = c.get("/api/recordings/timeline", params={"camera_id": cam, "start": (t_down - dt.timedelta(minutes=2)).isoformat(),
                                                  "end": now().isoformat()})
    gaps = [g for g in tl["gaps"] if dt.datetime.fromisoformat(g["end"]) > t_down and dt.datetime.fromisoformat(g["start"]) < t_up]
    evs = c.get("/api/events", params={"camera_id": cam, "limit": 10})["items"]
    off = [e for e in evs if e["type"] == "camera_offline" and dt.datetime.fromisoformat(e["start"]) >= t_down - dt.timedelta(seconds=5)]
    on = [e for e in evs if e["type"] == "camera_online"]
    report("gap_and_events_recorded", bool(gaps) and bool(off) and off[0]["end"] is not None and bool(on),
           gap=gaps[0] if gaps else None, offline_event=bool(off), offline_closed=bool(off and off[0]["end"]))

    # 2) 인증 실패 구분 → 비밀번호 수정 후 즉시 재인증
    c.req("PATCH", f"/api/cameras/{cam}", json={"password": "wrong-password"})
    st, t = wait(lambda: status(c, cam)["error_code"] == "auth_failed", 120)
    s2 = status(c, cam)
    report("auth_failure_classified", bool(st), waited_s=t, next_retry_at=s2["next_retry_at"])
    c.req("PATCH", f"/api/cameras/{cam}", json={"password": a.cam_password})
    st, t = wait(lambda: status(c, cam)["state"] == "recording", 90)
    report("reauth_after_password_change", bool(st), waited_s=t)

    # 3) recorder 강제 종료(kill -9) → 재시작 시 미확정 구간 복구 + 녹화 재개
    time.sleep(15)
    before = len(c.get("/api/recordings/timeline", params={"camera_id": cam, "start": (now() - dt.timedelta(hours=1)).isoformat(),
                                                           "end": now().isoformat()})["segments"])
    t_kill = now()
    sh(a.recorder_kill)
    time.sleep(3)
    sh(a.recorder_start)
    def recovered():
        segs = c.get("/api/recordings/timeline", params={"camera_id": cam, "start": (t_kill - dt.timedelta(minutes=2)).isoformat(),
                                                         "end": now().isoformat()})["segments"]
        tail = [s for s in segs if dt.datetime.fromisoformat(s["end"]) > t_kill - dt.timedelta(seconds=5)
                and dt.datetime.fromisoformat(s["start"]) < t_kill]
        after = [s for s in segs if dt.datetime.fromisoformat(s["start"]) > t_kill]
        return (tail, after) if after else None
    res, t = wait(recovered, 150, 3)
    report("recorder_crash_recovery", bool(res and res[0]), waited_s=t, before=before,
           recovered_partial_segment=bool(res and res[0]), resumed=bool(res and res[1]))


if __name__ == "__main__":
    main()
