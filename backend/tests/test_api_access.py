"""API 권한·세션·감사로그 시험 (실제 FastAPI 앱 + PostgreSQL)."""
from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select

from nvr.db import session_scope
from nvr.models import AuditLog, Camera, CameraStatus, LoginAttempt, RecordingSegment, Site
from nvr.security.crypto import encrypt_secret

PW = "Viewer#Pass2026"


@pytest.fixture(scope="module")
def world():
    with session_scope() as db:
        a = Site(name="A현장", code="SA", allowed_networks=["192.0.2.0/24"])
        b = Site(name="B현장", code="SB", allowed_networks=["198.51.100.0/24"])
        db.add_all([a, b])
        db.flush()
        ca = Camera(site_id=a.id, name="A-1", connection_type="rtsp", host="192.0.2.10",
                    main_stream_url="rtsp://192.0.2.10/main", username="cam", password_enc=encrypt_secret("CamSecret-XYZ"))
        cb = Camera(site_id=b.id, name="B-1", connection_type="rtsp", host="198.51.100.10",
                    main_stream_url="rtsp://198.51.100.10/main", username="cam", password_enc=encrypt_secret("CamSecret-XYZ"))
        db.add_all([ca, cb])
        db.flush()
        db.add_all([CameraStatus(camera_id=ca.id), CameraStatus(camera_id=cb.id)])
        now = dt.datetime.now(dt.timezone.utc)
        sa = RecordingSegment(camera_id=ca.id, start_at=now - dt.timedelta(minutes=2), end_at=now - dt.timedelta(minutes=1),
                              duration_ms=60000, rel_path="cam%d/x/a.mp4" % ca.id, size_bytes=10)
        sb = RecordingSegment(camera_id=cb.id, start_at=now - dt.timedelta(minutes=2), end_at=now - dt.timedelta(minutes=1),
                              duration_ms=60000, rel_path="cam%d/x/b.mp4" % cb.id, size_bytes=10)
        db.add_all([sa, sb])
        db.flush()
        return {"site_a": a.id, "site_b": b.id, "cam_a": ca.id, "cam_b": cb.id, "seg_a": sa.id, "seg_b": sb.id}


@pytest.fixture(scope="module")
def viewer_created(world):
    from fastapi.testclient import TestClient

    from nvr.api.main import app

    from .conftest import ADMIN_PW, Client

    c = Client(TestClient(app, client=("10.1.1.2", 5000)))
    c.login("admin", ADMIN_PW)
    r = c.req("POST", "/api/users", json={"username": "viewer1", "role": "viewer", "password": PW, "site_ids": [world["site_a"]]})
    assert r.status_code == 200, r.text
    # 첫 로그인 비밀번호 변경
    v = Client(TestClient(app, client=("10.1.1.3", 5000)))
    v.login("viewer1", PW)
    assert v.req("GET", "/api/cameras").status_code == 403  # 비밀번호 변경 전 차단
    assert v.req("POST", "/api/auth/change-password", json={"current_password": PW, "new_password": PW + "!"}).status_code == 200
    return PW + "!"


@pytest.fixture()
def viewer(make_client, viewer_created):
    c = make_client()
    assert c.login("viewer1", viewer_created).status_code == 200
    return c


def test_unauthenticated_blocked(make_client, world):
    c = make_client()
    for path in ("/api/cameras", f"/api/recordings/segments/{world['seg_a']}/media", "/api/exports", "/api/system/status"):
        assert c.req("GET", path).status_code == 401, path


def test_csrf_required(admin):
    r = admin.req("POST", "/api/sites", headers={"X-CSRF-Token": "wrong"}, json={"name": "x", "code": "X1"})
    assert r.status_code == 403


def test_viewer_site_scope(viewer, world):
    ids = [c["id"] for c in viewer.req("GET", "/api/cameras").json()["items"]]
    assert world["cam_a"] in ids and world["cam_b"] not in ids
    assert viewer.req("GET", f"/api/cameras/{world['cam_b']}").status_code == 404
    # 다른 현장 녹화 파일 직접 호출 차단(존재 여부도 숨김)
    assert viewer.req("GET", f"/api/recordings/segments/{world['seg_b']}/media").status_code == 404
    # 자기 현장 파일은 권한 통과 후 파일 없음(410)
    assert viewer.req("GET", f"/api/recordings/segments/{world['seg_a']}/media").status_code == 410


def test_viewer_cannot_change_or_download(viewer, world):
    assert viewer.req("POST", "/api/cameras", json={"site_id": world["site_a"], "name": "x", "main_stream_url": "rtsp://192.0.2.9/"}).status_code == 403
    assert viewer.req("PATCH", f"/api/cameras/{world['cam_a']}", json={"name": "y"}).status_code == 403
    now = dt.datetime.now(dt.timezone.utc)
    body = {"camera_id": world["cam_a"], "start": (now - dt.timedelta(minutes=2)).isoformat(), "end": now.isoformat()}
    assert viewer.req("POST", "/api/exports", json=body).status_code == 403
    assert viewer.req("POST", "/api/recordings/delete", json=body).status_code == 403
    assert viewer.req("GET", "/api/users").status_code == 403
    assert viewer.req("GET", "/api/audit").status_code == 403
    with session_scope() as db:
        denied = db.scalars(select(AuditLog).where(AuditLog.username == "viewer1", AuditLog.result == "denied")).all()
    assert len(denied) >= 3


def test_live_token_and_mediamtx_hook(viewer, admin, world, make_client):
    from nvr.config import get_keys

    r = viewer.req("POST", "/api/live/sessions", json={"camera_id": world["cam_a"], "stream": "sub"})
    assert r.status_code == 200
    j = r.json()
    key = get_keys().mediamtx_hook_key
    hook = lambda body, k=key: make_client().tc.post(f"/internal/mediamtx/auth?key={k}", json=body)  # noqa: E731
    ok_body = {"action": "read", "path": j["path"], "protocol": "webrtc", "token": j["token"], "user": "", "password": ""}
    assert hook(ok_body).status_code == 200
    assert hook(dict(ok_body, protocol="hls")).status_code == 200
    assert hook(ok_body, k="wrong").status_code == 403                       # 공유키 없음
    assert hook(dict(ok_body, path=f"cam{world['cam_b']}_main")).status_code == 403  # 다른 경로로 재사용
    assert hook(dict(ok_body, token="")).status_code == 401                   # 토큰 없이 직접 호출
    assert hook(dict(ok_body, action="publish")).status_code == 403            # 발행 금지
    assert hook(dict(ok_body, protocol="rtsp")).status_code == 403
    # 다른 현장 카메라 토큰 발급 불가
    assert viewer.req("POST", "/api/live/sessions", json={"camera_id": world["cam_b"]}).status_code == 404
    # 강제 로그아웃 → 기존 토큰 무효
    uid = admin.req("GET", "/api/users").json()["items"]
    vid = next(u["id"] for u in uid if u["username"] == "viewer1")
    assert admin.req("POST", f"/api/users/{vid}/revoke-sessions").status_code == 200
    assert hook(ok_body).status_code == 403
    assert viewer.req("GET", "/api/cameras").status_code == 401


def test_password_never_in_responses(admin, world):
    for path in ("/api/cameras", f"/api/cameras/{world['cam_a']}"):
        r = admin.req("GET", path)
        assert "CamSecret-XYZ" not in r.text and "password_enc" not in r.text
    r = admin.req("PATCH", f"/api/cameras/{world['cam_a']}", json={"password": "NewCam-Secret9"})
    assert r.status_code == 200 and "NewCam-Secret9" not in r.text
    with session_scope() as db:
        logs = db.scalars(select(AuditLog)).all()
        assert all("NewCam-Secret9" not in str(a.details) and "CamSecret-XYZ" not in str(a.details) for a in logs)
        cam = db.get(Camera, world["cam_a"])
        assert "NewCam" not in cam.password_enc and cam.config_version >= 2  # 재인증 유도


def test_login_lockout(make_client):
    c = make_client()
    for _ in range(5):
        assert c.login("ghost", "nope").status_code == 401
    r = c.login("ghost", "nope")
    assert r.status_code == 429
    with session_scope() as db:
        assert db.scalar(select(LoginAttempt).where(LoginAttempt.username == "ghost")) is not None


def test_ssrf_via_api(admin, world):
    for url in ("rtsp://127.0.0.1:554/x", "rtsp://198.51.100.10/x", "rtsp://169.254.169.254/"):
        r = admin.req("POST", "/api/cameras/test", json={"site_id": world["site_a"], "url": url})
        assert r.status_code == 400, url
    r = admin.req("POST", "/api/cameras/snapshot-preview", json={"site_id": world["site_a"], "snapshot_url": "http://169.254.169.254/"})
    assert r.status_code == 400
    r = admin.req("POST", "/api/onvif/probe", json={"site_id": world["site_a"], "host": "127.0.0.1", "port": 80})
    assert r.status_code == 400


def test_camera_delete_keeps_recordings(admin, world):
    with session_scope() as db:
        s = db.get(Site, world["site_a"])
        c = Camera(site_id=s.id, name="삭제시험", connection_type="rtsp", host="192.0.2.77", main_stream_url="rtsp://192.0.2.77/m")
        db.add(c)
        db.flush()
        now = dt.datetime.now(dt.timezone.utc)
        db.add(RecordingSegment(camera_id=c.id, start_at=now, end_at=now + dt.timedelta(seconds=60), duration_ms=60000,
                                rel_path=f"cam{c.id}/k.mp4", size_bytes=1))
        cid = c.id
    r = admin.req("DELETE", f"/api/cameras/{cid}")
    assert r.status_code == 200 and r.json()["recordings_kept"] == 1
    with session_scope() as db:
        assert db.scalar(select(RecordingSegment).where(RecordingSegment.camera_id == cid)) is not None
        assert db.get(Camera, cid).password_enc == ""


def test_timezone_days(admin, world):
    """KST 자정 직후(UTC 전날 15:xx) 녹화는 KST 날짜로 표시."""
    with session_scope() as db:
        st = dt.datetime(2026, 3, 1, 15, 30, tzinfo=dt.timezone.utc)  # = 2026-03-02 00:30 KST
        db.add(RecordingSegment(camera_id=world["cam_a"], start_at=st, end_at=st + dt.timedelta(minutes=1),
                                duration_ms=60000, rel_path="tz/test.mp4", size_bytes=1))
    days = admin.req("GET", "/api/recordings/days", params={"camera_id": world["cam_a"], "month": "2026-03"}).json()["days"]
    assert days == ["2026-03-02"]
    r = admin.req("GET", "/api/recordings/timeline", params={"camera_id": world["cam_a"], "start": "2026-03-02T00:00:00+09:00",
                                                             "end": "2026-03-02T01:00:00+09:00"})
    j = r.json()
    assert len(j["segments"]) == 1 and j["gaps"][0]["end"].startswith("2026-03-01T15:30")
    assert admin.req("GET", "/api/recordings/timeline", params={"camera_id": world["cam_a"], "start": "2026-03-02T00:00:00",
                                                                "end": "2026-03-02T01:00:00"}).status_code == 400  # 시간대 없는 시각 거부
