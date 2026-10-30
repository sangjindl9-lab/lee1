"""2·3단계 시험: 녹화 정책, 이벤트 녹화 확정, 카메라 단위 권한, 분석 연동, 알림, Edge, 북마크, ONVIF 이벤트 해석."""
from __future__ import annotations

import datetime as dt
import http.server
import json
import threading

import pytest
from lxml import etree
from sqlalchemy import select

from nvr.config import get_settings
from nvr.db import session_scope
from nvr.models import Camera, Event, NotifyChannel, NotifyLog, RecordingSegment, Site, User
from nvr.onvif.ext import classify_topic, parse_notification
from nvr.policy import CamPolicy, validate_schedule
from nvr.security.crypto import encrypt_secret
from nvr.storage import segment_rel_path

UTC = dt.timezone.utc


# ─────────────────────────── 정책
def test_schedule_policy_kst():
    sched = ["0" * 24] * 7
    sched[0] = "0" * 9 + "C" * 9 + "E" * 6  # 월요일 09~17 연속, 18~23 이벤트
    pol = CamPolicy(record_mode="schedule", schedule=validate_schedule(sched), timezone="Asia/Seoul", manual_until=None)
    mon_10_kst = dt.datetime(2026, 11, 2, 1, 0, tzinfo=UTC)  # 2026-11-02(월) 10:00 KST
    assert pol.decide(mon_10_kst) == ("schedule", "ready")
    assert pol.decide(mon_10_kst + dt.timedelta(hours=9)) == ("event", "buffer")  # 19시
    assert pol.decide(mon_10_kst - dt.timedelta(hours=3)) is None  # 07시
    assert pol.uses_events()
    pol.manual_until = mon_10_kst + dt.timedelta(hours=10)
    assert pol.decide(mon_10_kst - dt.timedelta(hours=3)) == ("manual", "ready")  # 수동 우선
    assert CamPolicy("continuous", [], "Asia/Seoul", None).decide(mon_10_kst) == ("continuous", "ready")
    assert CamPolicy("event", [], "Asia/Seoul", None).decide(mon_10_kst) == ("event", "buffer")
    assert CamPolicy("off", [], "Asia/Seoul", None).decide(mon_10_kst) is None
    for bad in (["C" * 24] * 6, ["X" * 24] * 7, ["C" * 23] * 7):
        with pytest.raises(ValueError):
            validate_schedule(bad)


# ─────────────────────────── ONVIF 이벤트 해석
def test_onvif_notification_parse():
    xml = b"""<wsnt:NotificationMessage xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2" xmlns:tt="http://www.onvif.org/ver10/schema">
      <wsnt:Topic>tns1:RuleEngine/CellMotionDetector/Motion</wsnt:Topic>
      <wsnt:Message><tt:Message UtcTime="2026-10-30T10:00:00Z" PropertyOperation="Changed">
        <tt:Source><tt:SimpleItem Name="VideoSourceConfigurationToken" Value="vs0"/></tt:Source>
        <tt:Data><tt:SimpleItem Name="IsMotion" Value="true"/></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>"""
    m = parse_notification(etree.fromstring(xml))
    assert m["kind"] == "motion" and m["active"] is True and m["operation"] == "Changed"
    assert m["utc"] == dt.datetime(2026, 10, 30, 10, tzinfo=UTC)
    assert classify_topic("tns1:VideoSource/GlobalSceneChange/ImagingService") == "tamper"
    assert classify_topic("tns1:Device/Trigger/DigitalInput") == "input"
    assert classify_topic("tns1:RuleEngine/LineDetector/Crossed") == "analytics"
    assert classify_topic("tns1:Monitoring/ProcessorUsage") == "other"


# ─────────────────────────── 이벤트 녹화 확정·버퍼 정리
@pytest.fixture(scope="module")
def evcam():
    with session_scope() as db:
        s = Site(name="이벤트시험", code="EV", allowed_networks=["192.0.2.0/24"])
        db.add(s)
        db.flush()
        c = Camera(site_id=s.id, name="이벤트-1", connection_type="rtsp", host="192.0.2.40", main_stream_url="rtsp://192.0.2.40/m",
                   record_mode="event", event_pre_seconds=10, event_post_seconds=10, event_triggers=["motion", "analytics"])
        db.add(c)
        db.flush()
        return {"site": s.id, "cam": c.id}


def _seg(cam_id, start, secs=10, status="buffer"):
    rel = segment_rel_path(cam_id, start, secs * 1000)
    p = get_settings().recordings_dir / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"v" * 100)
    return RecordingSegment(camera_id=cam_id, start_at=start, end_at=start + dt.timedelta(seconds=secs), duration_ms=secs * 1000,
                            rel_path=rel, size_bytes=100, status=status, kind="event")


def test_event_promotion_and_cleanup(evcam):
    from nvr.worker.event_rec import process

    cid = evcam["cam"]
    now = dt.datetime.now(UTC).replace(microsecond=0)
    base = now - dt.timedelta(minutes=10)
    with session_scope() as db:
        for i in range(12):  # base ~ base+120s, 10초 구간
            db.add(_seg(cid, base + dt.timedelta(seconds=10 * i)))
        # base+40 ~ +45 모션 → 창 [30, 55]
        db.add(Event(camera_id=cid, type="motion", source="camera", started_at=base + dt.timedelta(seconds=40),
                     ended_at=base + dt.timedelta(seconds=45), triggers_recording=True))
        # 녹화 트리거가 아닌 이벤트는 무시
        db.add(Event(camera_id=cid, type="tamper", source="camera", started_at=base + dt.timedelta(seconds=100),
                     ended_at=base + dt.timedelta(seconds=101), triggers_recording=False))
    process()
    with session_scope() as db:
        rows = db.scalars(select(RecordingSegment).where(RecordingSegment.camera_id == cid).order_by(RecordingSegment.start_at)).all()
        kept = [(int((r.start_at - base).total_seconds()), r.status) for r in rows]
    assert kept == [(30, "ready"), (40, "ready"), (50, "ready")]


def test_recent_buffer_kept_for_late_events(evcam):
    from nvr.worker.event_rec import process

    cid = evcam["cam"]
    now = dt.datetime.now(UTC)
    with session_scope() as db:
        db.add(_seg(cid, now - dt.timedelta(seconds=30)))
    process()
    with session_scope() as db:
        r = db.scalar(select(RecordingSegment).where(RecordingSegment.camera_id == cid, RecordingSegment.status == "buffer"))
        assert r is not None  # 2분 안의 버퍼는 늦게 들어오는 이벤트를 위해 유지


def test_timeline_hides_buffer(admin, evcam):
    now = dt.datetime.now(UTC)
    r = admin.req("GET", "/api/recordings/timeline", params={"camera_id": evcam["cam"], "start": (now - dt.timedelta(hours=1)).isoformat(),
                                                             "end": now.isoformat()}).json()
    assert all(s["kind"] == "event" for s in r["segments"]) and len(r["segments"]) == 3 and r["gaps_expected"] is True


# ─────────────────────────── 카메라 설정 API
def test_camera_policy_api(admin, evcam):
    cid = evcam["cam"]
    sched = ["C" * 24] * 5 + ["E" * 24] * 2
    r = admin.req("PATCH", f"/api/cameras/{cid}", json={"record_mode": "schedule", "schedule": sched, "event_triggers": ["motion"]})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["schedule"] == sched and j["event_triggers"] == ["motion"]
    assert admin.req("PATCH", f"/api/cameras/{cid}", json={"event_triggers": ["laser"]}).status_code == 400
    assert admin.req("PATCH", f"/api/cameras/{cid}", json={"events_enabled": True}).status_code == 400  # RTSP 카메라
    assert admin.req("PATCH", f"/api/cameras/{cid}", json={"record_mode": "schedule", "schedule": []}).status_code == 400
    admin.req("PATCH", f"/api/cameras/{cid}", json={"record_mode": "event", "event_triggers": ["motion", "analytics", "manual"]})


# ─────────────────────────── 카메라 단위 권한
def test_camera_level_permission(admin, make_client, evcam):
    with session_scope() as db:
        other = Camera(site_id=evcam["site"], name="이벤트-2", connection_type="rtsp", host="192.0.2.41",
                       main_stream_url="rtsp://192.0.2.41/m")
        db.add(other)
        db.flush()
        oid = other.id
    r = admin.req("POST", "/api/users", json={"username": "cctv1", "role": "operator", "password": "Op#Camera-2026",
                                              "site_ids": [evcam["site"]], "camera_ids": [evcam["cam"]]})
    assert r.status_code == 200 and r.json()["camera_ids"] == [evcam["cam"]]
    u = make_client()
    u.login("cctv1", "Op#Camera-2026")
    u.req("POST", "/api/auth/change-password", json={"current_password": "Op#Camera-2026", "new_password": "Op#Camera-2027"})
    u = make_client()
    assert u.login("cctv1", "Op#Camera-2027").status_code == 200
    ids = [c["id"] for c in u.req("GET", "/api/cameras").json()["items"]]
    assert evcam["cam"] in ids and oid not in ids
    assert u.req("GET", f"/api/cameras/{oid}").status_code == 404
    assert u.req("POST", "/api/live/sessions", json={"camera_id": oid}).status_code == 404
    tok = u.req("POST", "/api/live/sessions", json={"camera_id": evcam["cam"]}).json()
    # 같은 사용자 토큰으로 다른 카메라 경로 재사용 불가 + 제한 후 훅 검증
    from nvr.config import get_keys

    hook = make_client().tc.post(f"/internal/mediamtx/auth?key={get_keys().mediamtx_hook_key}",
                                 json={"action": "read", "path": tok["path"], "protocol": "hls", "token": tok["token"]})
    assert hook.status_code == 200
    with session_scope() as db:
        uid = db.scalar(select(User.id).where(User.username == "cctv1"))
    admin.req("PATCH", f"/api/users/{uid}", json={"camera_ids": [oid]})  # 제한 변경 → 세션 종료
    assert u.req("GET", "/api/cameras").status_code == 401


# ─────────────────────────── 분석 모듈 연동
def test_analytics_ingest(admin, make_client, evcam):
    k = admin.req("POST", "/api/integrations/keys", json={"name": "분석서버", "site_ids": [evcam["site"]]}).json()
    tc = make_client().tc
    ok = tc.post("/api/integrations/analytics/events", headers={"X-API-Key": k["key"]},
                 json={"camera_id": evcam["cam"], "label": "person", "state": "pulse", "duration_seconds": 5, "score": 0.8})
    assert ok.status_code == 200
    assert tc.post("/api/integrations/analytics/events", headers={"X-API-Key": "nvrk_bad"},
                   json={"camera_id": evcam["cam"], "label": "x"}).status_code == 401
    assert tc.post("/api/integrations/analytics/events", json={"camera_id": evcam["cam"], "label": "x"}).status_code == 401
    with session_scope() as db:
        e = db.scalars(select(Event).where(Event.camera_id == evcam["cam"], Event.source == "analytics")).first()
        assert e and e.triggers_recording and e.details["label"] == "person"
    # 키 폐기 후 거부
    admin.req("DELETE", f"/api/integrations/keys/{k['id']}")
    assert tc.post("/api/integrations/analytics/events", headers={"X-API-Key": k["key"]},
                   json={"camera_id": evcam["cam"], "label": "person"}).status_code == 401


def test_manual_event(admin, evcam):
    r = admin.req("POST", f"/api/cameras/{evcam['cam']}/events/manual", json={"seconds": 30, "note": "확인 요망"})
    assert r.status_code == 200 and r.json()["triggers_recording"] is True


# ─────────────────────────── 북마크
def test_bookmarks(admin, evcam):
    at = dt.datetime.now(UTC).isoformat()
    assert admin.req("POST", "/api/bookmarks", json={"camera_id": evcam["cam"], "at": at, "title": "자재 반입", "note": "레미콘 차량"}).status_code == 200
    items = admin.req("GET", "/api/bookmarks", params={"q": "레미콘"}).json()["items"]
    assert [b["title"] for b in items] == ["자재 반입"]
    assert admin.req("DELETE", f"/api/bookmarks/{items[0]['id']}").status_code == 200


# ─────────────────────────── 알림(웹훅)
def test_webhook_notification_flow(evcam, monkeypatch):
    from nvr.worker import notify

    got: list[dict] = []

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            got.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_port}/hook"
    monkeypatch.setattr(notify, "check_host", lambda *a, **k: None)  # 시험 수신기가 루프백이라 SSRF 검사만 우회
    with session_scope() as db:
        db.query(NotifyChannel).delete()
        db.add(NotifyChannel(name="t", type="webhook", config_enc=encrypt_secret(json.dumps({"url": url})), min_severity="warning",
                             event_types=["camera_offline"], suppress_minutes=10, repeat_minutes=0))
    notify.run_once()  # 커서 초기화
    with session_scope() as db:
        e1 = Event(type="camera_offline", severity="warning", camera_id=evcam["cam"], dedup_key="cam:x:offline", message="끊김")
        db.add(e1)
        db.add(Event(type="motion", severity="info", camera_id=evcam["cam"], message="무시될 이벤트"))
        db.flush()
        eid = e1.id
    notify.run_once()
    assert [g["kind"] for g in got] == ["new"] and got[0]["type"] == "camera_offline"
    with session_scope() as db:  # 같은 키 재발생 → 억제
        db.get(Event, eid).ended_at = dt.datetime.now(UTC) - dt.timedelta(seconds=1)
        db.add(Event(type="camera_offline", severity="warning", camera_id=evcam["cam"], dedup_key="cam:x:offline", message="또 끊김"))
    notify.run_once()
    kinds = [g["kind"] for g in got]
    assert kinds.count("new") == 1 and kinds.count("resolved") == 1
    with session_scope() as db:
        assert db.scalar(select(NotifyLog).where(NotifyLog.kind == "resolved")) is not None
    srv.shutdown()


def test_webhook_ssrf_blocked():
    from nvr.security.netguard import TargetDenied
    from nvr.worker.notify import send

    ch = NotifyChannel(name="x", type="webhook", config_enc=encrypt_secret(json.dumps({"url": "http://169.254.169.254/latest"})))
    with pytest.raises(TargetDenied):
        send(ch, {"kind": "test", "type": "t", "type_label": "t", "severity": "info", "message": "m", "started_at": None, "ended_at": None})


# ─────────────────────────── Edge
def test_edge_report_and_offline(admin, make_client):
    from nvr.worker.edge import check_offline

    e = admin.req("POST", "/api/edges", json={"name": "현장A", "url": "https://a.example"}).json()
    tc = make_client().tc
    assert tc.post("/api/edge/report", json={}).status_code == 401
    r = tc.post("/api/edge/report", headers={"Authorization": f"Bearer {e['token']}"},
                json={"version": "0.2.0", "cameras": [{"id": 1, "name": "c", "state": "recording"}, {"id": 2, "name": "d", "state": "retry_wait"}]})
    assert r.status_code == 200
    lst = admin.req("GET", "/api/edges").json()["items"]
    me = next(x for x in lst if x["id"] == e["id"])
    assert me["online"] and me["camera_recording"] == 1 and me["camera_problem"] == 1 and "token" not in me
    from nvr.models import EdgeNode

    with session_scope() as db:
        db.get(EdgeNode, e["id"]).last_seen_at = dt.datetime.now(UTC) - dt.timedelta(minutes=5)
    check_offline()
    with session_scope() as db:
        assert db.scalar(select(Event).where(Event.dedup_key == f"edge:{e['id']}:offline", Event.ended_at.is_(None)))
    tc.post("/api/edge/report", headers={"Authorization": f"Bearer {e['token']}"}, json={"version": "0.2.0", "cameras": []})
    with session_scope() as db:
        assert db.scalar(select(Event).where(Event.dedup_key == f"edge:{e['id']}:offline", Event.ended_at.is_(None))) is None


def test_viewer_cannot_manage_stage2(make_client, admin):
    admin.req("POST", "/api/users", json={"username": "viewer9", "role": "viewer", "password": "View#Only-2026"})
    v = make_client()
    v.login("viewer9", "View#Only-2026")
    v.req("POST", "/api/auth/change-password", json={"current_password": "View#Only-2026", "new_password": "View#Only-2027"})
    v = make_client()
    v.login("viewer9", "View#Only-2027")
    for m, path in (("GET", "/api/notify/channels"), ("GET", "/api/edges"), ("GET", "/api/integrations/keys"),
                    ("POST", "/api/onvif/discover"), ("GET", "/api/cameras/1/ptz")):
        assert v.req(m, path, json={"site_id": 1}).status_code in (403, 404, 422), path

