"""지능형 분석 시험: 규칙 계산(합성 장면·합성 추적 결과), 이벤트 열고 닫기, 설정 API·권한.

합성 장면은 tools/test-camera/make_scenes.py 로 만든 인공 영상이다(실제 화재·침수·현장 정확도와 무관).
사람 검출 모델(YOLOX) 자체는 여기서 돌리지 않는다 — 모델 동작은 docs/03-검증결과.md 의 샘플 영상 시험 참조.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import cv2
import numpy as np
import pytest
from sqlalchemy import select

from nvr.analytics.person import Track, Tracker, helmet_ratio
from nvr.analytics.rules import Persist, RuleSpec, make_rule
from nvr.db import session_scope
from nvr.models import Camera, Event, Site

ROOT = Path(__file__).resolve().parents[2]


def _scenes():
    spec = importlib.util.spec_from_file_location("make_scenes", ROOT / "tools/test-camera/make_scenes.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture(scope="module")
def scenes(tmp_path_factory):
    out = tmp_path_factory.mktemp("scenes")
    m = _scenes()
    m.fire_scene(out / "fire")
    m.water_scene(out / "water")
    return out


def test_persist_window():
    p = Persist(3)
    assert not p.update(0, True)
    assert not p.update(1.5, True)
    assert p.update(3.0, True)       # 3초 관찰 + 전부 참
    assert not p.update(4.5, False)  # 거짓이면 즉시 비활성
    q = Persist(0)
    assert q.update(0, True)


def test_fire_synthetic(scenes):
    rule = make_rule(RuleSpec(1, "fire"))
    frames = sorted((scenes / "fire").glob("*.jpg"))[::5]  # 10fps → 2fps
    active = [i * 0.5 for i, f in enumerate(frames) if rule.update(cv2.imread(str(f)), i * 0.5).active]
    assert active, "합성 불꽃을 감지하지 못함"
    assert 20 <= min(active) <= 27 and max(active) < 52  # 불꽃 20~50초, 지속 3초 판정
    assert not any(t < 20 for t in active)  # 정지한 주황색 드럼은 감지하지 않음


def test_fire_static_orange_rejected():
    img = np.full((360, 640, 3), 110, np.uint8)
    cv2.rectangle(img, (200, 150), (300, 300), (0, 120, 255), -1)  # 주황
    cv2.circle(img, (250, 220), 15, (210, 250, 255), -1)          # 밝은 중심부까지 있어도
    rule = make_rule(RuleSpec(1, "fire", params={"persist_seconds": 1}))
    assert not any(rule.update(img.copy(), t * 0.5).active for t in range(20))


def test_water_level_synthetic(scenes):
    files = sorted((scenes / "water").glob("*.jpg"))[::2]  # 5fps → 2.5fps
    gray = [cv2.cvtColor(cv2.imread(str(f)), cv2.COLOR_BGR2GRAY) for f in files]
    spec = RuleSpec(2, "water_level", zone=[[0, 0.6], [0.85, 0.6], [0.85, 1], [0, 1]], line=[[0.875, 0.94], [0.875, 0.42]])
    rule = make_rule(spec)
    assert rule.update(gray[0], 0).info.get("need_reference")
    rule.set_reference(gray[0])
    res = [(i * 0.4, rule.update(g, i * 0.4)) for i, g in enumerate(gray)]
    dry = [c.info["level_percent"] for t, c in res if t < 40]
    assert max(dry) <= 10
    peak = [c.info["level_percent"] for t, c in res if 105 < t < 135]
    assert min(peak) >= 85
    on = [t for t, c in res if c.active]
    assert on and 95 <= min(on) <= 115  # 70% 도달(약 82초) + 20초 지속
    # 눈금선 없이 구역 변화 비율 방식
    r2 = make_rule(RuleSpec(3, "water_level", zone=spec.zone, params={"persist_seconds": 0}))
    r2.set_reference(gray[0])
    assert not r2.update(gray[10], 4).active
    assert r2.update(gray[300], 120).active


def test_water_lighting_change_ignored(scenes):
    g = cv2.cvtColor(cv2.imread(str(sorted((scenes / "water").glob("*.jpg"))[0])), cv2.COLOR_BGR2GRAY)
    rule = make_rule(RuleSpec(4, "water_level", zone=[[0, 0.6], [1, 0.6], [1, 1], [0, 1]],
                              params={"persist_seconds": 0}))
    rule.set_reference(g)
    darker = np.clip(g.astype(np.float32) * 0.7 + 10, 0, 255).astype(np.uint8)  # 흐린 날·저녁
    c = rule.update(darker, 1)
    assert not c.active and c.info["changed_ratio"] < 0.2


def _track(tid, box, hist):
    t = Track(id=tid, box=box, first_seen=hist[0][0], last_seen=hist[-1][0], history=list(hist))
    return t


def test_person_rules_logic():
    frame = np.zeros((480, 640, 3), np.uint8)
    zone = [[0, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]]
    intr = make_rule(RuleSpec(1, "intrusion", zone=zone, params={"min_seconds": 2}))
    inside = (100, 200, 40, 120)   # 발 (120, 320) → 구역 안
    outside = (450, 200, 40, 120)  # 발 (470, 320) → 구역 밖
    for t in range(4):
        trs = [_track(1, inside, [(t, inside)]), _track(2, outside, [(t, outside)])]
        c = intr.update(trs, frame, float(t))
    assert c.active and len(c.boxes) == 1 and c.boxes[0] == inside

    crowd = make_rule(RuleSpec(2, "crowd", params={"min_count": 3, "persist_seconds": 2}))
    trs = [_track(i, (50 * i, 100, 30, 90), [(0, (50 * i, 100, 30, 90))]) for i in range(1, 5)]
    assert [crowd.update(trs, frame, float(t)).active for t in range(4)][-1]
    assert not crowd.update(trs[:2], frame, 4.0).active

    # 쓰러짐: 서 있다가(세로) 가로로 누워 3초 이상
    fall = make_rule(RuleSpec(3, "fall", params={"persist_seconds": 3}))
    up, down = (100, 100, 40, 120), (80, 190, 120, 40)
    hist = [(0.0, up), (1.0, up), (2.0, down)]
    res = []
    for t in (2.0, 3.0, 4.0, 5.0, 6.0):
        hist.append((t, down))
        res.append(fall.update([_track(7, down, hist)], frame, t).active)
    assert res == [False, False, False, True, True]
    lying_only = make_rule(RuleSpec(4, "fall", params={"persist_seconds": 1}))
    assert not lying_only.update([_track(8, down, [(0.0, down), (5.0, down)])], frame, 5.0).active  # 처음부터 누운 박스

    # 뛰기: 2초에 몸 높이 4배 이동
    run = make_rule(RuleSpec(5, "running", params={"speed": 1.5}))
    h = [(0.0, (0, 100, 30, 100)), (1.0, (200, 100, 30, 100)), (2.0, (400, 100, 30, 100))]
    assert run.update([_track(9, h[-1][1], h)], frame, 2.0).active
    walk = [(0.0, (0, 100, 30, 100)), (1.0, (60, 100, 30, 100)), (2.0, (120, 100, 30, 100))]
    assert not run.update([_track(10, walk[-1][1], walk)], frame, 2.0).active

    # 장시간 정지
    st = make_rule(RuleSpec(6, "stationary", params={"seconds": 10}))
    box = (300, 100, 40, 120)
    hist = []
    for t in range(0, 13):
        hist.append((float(t), (box[0] + (t % 2), box[1], box[2], box[3])))
        c = st.update([_track(11, hist[-1][1], hist)], frame, float(t))
    assert c.active


def test_helmet_ratio():
    img = np.full((300, 300, 3), 60, np.uint8)
    box = (100, 50, 60, 200)
    cv2.rectangle(img, (100, 50), (160, 250), (40, 40, 40), -1)   # 어두운 옷·머리
    bare = helmet_ratio(img, box)
    cv2.ellipse(img, (130, 62), (26, 14), 0, 180, 360, (0, 220, 255), -1)  # 노란 안전모
    cv2.rectangle(img, (104, 56), (156, 76), (0, 220, 255), -1)
    hat = helmet_ratio(img, box)
    assert bare is not None and hat is not None and bare < 0.1 < 0.5 < hat
    assert helmet_ratio(img, (10, 10, 8, 20)) is None  # 너무 작으면 판정 불가

    rule = make_rule(RuleSpec(7, "no_helmet", params={"persist_seconds": 2, "min_person_px": 60}))
    plain = np.full((300, 300, 3), 60, np.uint8)
    cv2.rectangle(plain, (100, 50), (160, 250), (40, 40, 40), -1)
    res = [rule.update([_track(1, box, [(float(t), box)])], plain, float(t)).active for t in range(3)]
    assert res[-1]
    rule2 = make_rule(RuleSpec(8, "no_helmet", params={"persist_seconds": 2, "min_person_px": 60}))
    assert not any(rule2.update([_track(1, box, [(float(t), box)])], img, float(t)).active for t in range(4))


def test_tracker_keeps_identity():
    tr = Tracker()
    ids = []
    for t in range(6):
        out = tr.update([(100 + 15 * t, 100, 40, 120, 0.9), (400 - 15 * t, 120, 40, 120, 0.9)], float(t))
        ids.append(sorted(x.id for x in out))
    assert all(i == ids[0] for i in ids)
    tr.update([], 6.0)
    tr.update([], 7.0)
    assert len(tr.tracks) == 2  # 짧은 놓침은 유지
    for t in (8.0, 9.0, 10.0):
        tr.update([], t)
    assert not tr.tracks


# ─────────────────────────── 이벤트 열고 닫기(분석 서비스 로직, 영상 입력 없이)
@pytest.fixture()
def acam():
    import secrets

    with session_scope() as db:
        s = Site(name="분석현장", code="AN" + secrets.token_hex(3), allowed_networks=["192.0.2.0/24"])
        db.add(s)
        db.flush()
        c = Camera(site_id=s.id, name="분석-1", connection_type="rtsp", host="192.0.2.60",
                   main_stream_url="rtsp://192.0.2.60/m", record_mode="event")
        db.add(c)
        db.flush()
        return {"site": s.id, "cam": c.id}


def test_event_lifecycle(acam, monkeypatch, tmpdir_root):
    from nvr.analytics import main as am
    from nvr.analytics.rules import Condition
    from nvr.media.ffmpeg import StreamSource

    am.dirs()
    info = am.CamInfo(acam["cam"], acam["site"], "분석-1", True, StreamSource("rtsp://x", "rtsp://x", "tcp"), sig=())
    ca = am.CameraAnalyzer(info, lambda f: [])
    ca.apply_rules([{"id": 990, "type": "fire", "name": "적치장", "zone": [], "line": [], "params": {}, "severity": "critical",
                     "cooldown_seconds": 30, "ref_requested": False, "ref_set_at": None}])
    rt = ca.rules[990]
    clock = {"t": 1000.0}
    monkeypatch.setattr(am.time, "monotonic", lambda: clock["t"])
    seq = iter([True] * 3 + [False] * 25 + [True] * 3 + [False] * 12 + [True] * 3)

    class Fake:
        spec = RuleSpec(990, "fire")

        def update(self, frame, t):
            return Condition(next(seq), score=0.5, boxes=[(10, 10, 20, 20)], info={"area": 0.01})

    rt.impl = Fake()
    frame = np.zeros((360, 640, 3), np.uint8)
    for i in range(46):
        clock["t"] = 1000.0 + i
        ca.process(frame, clock["t"])
    with session_scope() as db:
        evs = db.scalars(select(Event).where(Event.camera_id == acam["cam"]).order_by(Event.id)).all()
        assert len(evs) == 2  # 첫 감지 → 10초 뒤 닫힘 → 재알림 간격(30초) 안의 재감지(28~30초)는 무시 → 그 뒤 재감지 1건
        e = evs[0]
        assert e.source == "analytics" and e.type == "analytics" and e.severity == "critical"
        assert e.triggers_recording and e.ended_at is not None and evs[1].ended_at is None
        assert e.details["rule_type"] == "fire" and e.details["snapshot"] is True
        assert e.details["boxes"] == [[round(10 / 640, 4), round(10 / 360, 4), round(20 / 640, 4), round(20 / 360, 4)]]
        eid = e.id
    assert am.snap_path(eid).is_file()
    assert am.live_path(acam["cam"]).is_file()


# ─────────────────────────── 설정 API·권한
def test_rules_api(admin, make_client, acam):
    cid = acam["cam"]
    base = f"/api/cameras/{cid}/analytics/rules"
    r = admin.req("POST", base, json={"type": "water_level", "name": "배수로", "zone": [[0, 0.5], [1, 0.5], [1, 1]],
                                      "line": [[0.9, 0.95], [0.9, 0.4]], "params": {"danger_percent": 60}})
    assert r.status_code == 200, r.text
    w = r.json()
    assert w["params"]["danger_percent"] == 60 and w["params"]["persist_seconds"] == 20 and w["severity"] == "critical"
    bad = [
        {"type": "nope"},
        {"type": "fire", "params": {"danger_percent": 50}},       # 다른 규칙의 설정
        {"type": "fire", "params": {"sensitivity": 5}},           # 범위 밖
        {"type": "fire", "params": {"sensitivity": "abc"}},
        {"type": "intrusion", "line": [[0, 0], [1, 1]]},          # 눈금선은 수위만
        {"type": "intrusion", "severity": "panic"},
    ]
    for b in bad:
        assert admin.req("POST", base, json=b).status_code == 400, b
    for b in ({"type": "fire", "zone": [[0, 0], [1, 1]]}, {"type": "fire", "zone": [[0, 0], [2, 0], [1, 1]]},
              {"type": "water_level", "line": [[0, 0]]}):
        assert admin.req("POST", base, json=b).status_code == 422, b
    p = admin.req("POST", base, json={"type": "intrusion", "zone": [[0, 0], [0.5, 0], [0.5, 1]]}).json()
    assert admin.req("PATCH", f"/api/analytics/rules/{p['id']}", json={"params": {"min_seconds": 3}, "enabled": False}).json()["enabled"] is False
    assert admin.req("POST", f"/api/analytics/rules/{p['id']}/reference").status_code == 400
    assert admin.req("POST", f"/api/analytics/rules/{w['id']}/reference").status_code == 200
    with session_scope() as db:
        from nvr.models import AnalyticsRule

        assert db.get(AnalyticsRule, w["id"]).ref_requested_at is not None
    assert len(admin.req("GET", base).json()) == 2
    meta = admin.req("GET", "/api/analytics/meta").json()
    assert {t["type"] for t in meta["types"]} >= {"fire", "no_helmet", "water_level", "intrusion", "loitering", "fall"}
    st = admin.req("GET", "/api/analytics/status").json()
    assert st["service_alive"] is False  # 시험에는 분석 서비스가 없음 — 화면에 '동작하지 않음' 표시
    assert admin.req("GET", f"/api/cameras/{cid}/analytics/preview").status_code in (200, 404)

    # 다른 현장 사용자는 규칙·스냅샷에 접근 불가, 조회 전용 사용자는 변경 불가
    with session_scope() as db:
        s2 = Site(name="다른현장", code="AX" + str(acam["cam"]), allowed_networks=["192.0.2.0/24"])
        db.add(s2)
        db.flush()
        s2id = s2.id
        ev = Event(camera_id=cid, site_id=acam["site"], type="analytics", source="analytics", message="시험",
                   details={"snapshot": True})
        db.add(ev)
        db.flush()
        evid = ev.id
    from nvr.analytics.main import dirs, snap_path

    dirs()
    snap_path(evid).write_bytes(b"\xff\xd8\xff\xd9")
    assert admin.req("GET", f"/api/events/{evid}/snapshot").status_code == 200
    admin.req("POST", "/api/users", json={"username": "anviewer", "role": "viewer", "password": "View#Analytic-26",
                                         "site_ids": [acam["site"]]})
    admin.req("POST", "/api/users", json={"username": "another", "role": "site_admin", "password": "Other#Analytic-26",
                                         "site_ids": [s2id]})
    for name, pw in (("anviewer", "View#Analytic-26"), ("another", "Other#Analytic-26")):
        u = make_client()
        u.login(name, pw)
        u.req("POST", "/api/auth/change-password", json={"current_password": pw, "new_password": pw + "x"})
        u = make_client()
        assert u.login(name, pw + "x").status_code == 200
        if name == "anviewer":
            assert u.req("GET", base).status_code == 200
            assert u.req("POST", base, json={"type": "fire"}).status_code == 403
            assert u.req("DELETE", f"/api/analytics/rules/{p['id']}").status_code == 403
            assert u.req("GET", f"/api/events/{evid}/snapshot").status_code == 200
        else:
            assert u.req("GET", base).status_code == 404
            assert u.req("PATCH", f"/api/analytics/rules/{p['id']}", json={"enabled": True}).status_code == 404
            assert u.req("GET", f"/api/events/{evid}/snapshot").status_code == 404
            assert str(cid) not in u.req("GET", "/api/analytics/status").json()["rule_counts"]
    assert admin.req("DELETE", f"/api/analytics/rules/{p['id']}").status_code == 200
