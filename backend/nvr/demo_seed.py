"""[클라우드 데모 전용] 초기 데이터 준비.

- 관리자 계정이 없으면 NVR_DEMO_ADMIN_PASSWORD 로 admin 생성(첫 로그인 시 비밀번호 변경 강제)
- '데모 현장'과 '시험 카메라(합성 영상)'를 만들고, 컨테이너 IP 가 바뀌면 허용망·주소를 갱신
  (합성 카메라는 같은 컨테이너 안에서 실행되며 실제 카메라가 아님)
"""
from __future__ import annotations

import ipaddress
import os
import sys

from sqlalchemy import select

from .db import session_scope
from .models import AnalyticsRule, Camera, CameraStatus, EdgeNode, Site, User, utcnow
from .security.crypto import encrypt_secret, new_token, sha256_hex
from .security.passwords import hash_password


def main() -> int:
    ip = sys.argv[1]
    cam_port = sys.argv[2]
    cam_pw = open(sys.argv[3], encoding="utf-8").read().strip()
    addr = ipaddress.ip_address(ip)
    net = f"{ip}/{32 if addr.version == 4 else 128}"
    host = f"[{ip}]" if addr.version == 6 else ip
    with session_scope() as db:
        if not db.scalar(select(User).where(User.role == "superadmin")):
            pw = os.environ.get("NVR_DEMO_ADMIN_PASSWORD", "")
            if not pw:
                print("NVR_DEMO_ADMIN_PASSWORD 가 없어 관리자 계정을 만들지 않았습니다.", file=sys.stderr)
            else:
                db.add(User(username="admin", display_name="데모 관리자", role="superadmin",
                            password_hash=hash_password(pw), must_change_password=True))
                print("데모 관리자 admin 생성")
        site = db.scalar(select(Site).where(Site.code == "DEMO"))
        if not site:
            site = Site(name="데모 현장(클라우드)", code="DEMO", allowed_networks=[net],
                        description="클라우드 데모용. 합성 시험 카메라만 연결됩니다. 실제 현장 카메라는 현장 서버 설치가 필요합니다.")
            db.add(site)
            db.flush()
        else:
            site.allowed_networks = [net]
        cam = db.scalar(select(Camera).where(Camera.site_id == site.id, Camera.is_test_source.is_(True),
                                             Camera.connection_type == "rtsp", Camera.model == "합성 RTSP",
                                             Camera.deleted_at.is_(None)))
        main_url = f"rtsp://{host}:{cam_port}/main"
        sub_url = f"rtsp://{host}:{cam_port}/sub"
        if not cam:
            cam = Camera(site_id=site.id, name="시험 카메라 (합성 영상)", building="데모", zone="-",
                         connection_type="rtsp", host=ip, rtsp_transport="tcp", main_stream_url=main_url,
                         sub_stream_url=sub_url, username="cam", password_enc=encrypt_secret(cam_pw),
                         vendor="TEST", model="합성 RTSP", is_test_source=True, record_mode="continuous",
                         retention_days=1, tags=["데모"], location_note="컨테이너 내부 GStreamer 합성 스트림")
            db.add(cam)
            db.flush()
            db.add(CameraStatus(camera_id=cam.id))
            print("데모 카메라 생성")
        elif cam.main_stream_url != main_url:
            cam.host, cam.main_stream_url, cam.sub_stream_url = ip, main_url, sub_url
            cam.password_enc = encrypt_secret(cam_pw)
            cam.config_version += 1
            print("데모 카메라 주소 갱신")
        # 2) ONVIF 시뮬레이터 카메라: PTZ·모션 이벤트·Profile G, 이벤트 발생 시에만 녹화
        onvif_port = int(sys.argv[4]) if len(sys.argv) > 4 else 18080
        ev = db.scalar(select(Camera).where(Camera.site_id == site.id, Camera.connection_type == "onvif",
                                            Camera.deleted_at.is_(None)))
        if not ev:
            ev = Camera(site_id=site.id, name="PTZ·이벤트 시험 카메라 (ONVIF 시뮬레이터)", building="데모", zone="-",
                        connection_type="onvif", host=ip, onvif_port=onvif_port, rtsp_transport="tcp",
                        main_stream_url=main_url, sub_stream_url=sub_url, main_profile_token="main", sub_profile_token="sub",
                        snapshot_url=f"http://{host}:{onvif_port}/snapshot.jpg", username="cam",
                        password_enc=encrypt_secret(cam_pw), vendor="TEST-SIMULATOR", model="ONVIF-SIM-1", serial="SIM-0001",
                        is_test_source=True, record_mode="event", event_pre_seconds=10, event_post_seconds=15,
                        events_enabled=True, retention_days=1, tags=["데모", "이벤트"],
                        capabilities={"media2": True, "media1": True, "ptz": True, "events": True, "imaging": False,
                                      "analytics": False, "recording_profile_g": True},
                        location_note="시뮬레이터가 약 1분마다 8초간 모션 이벤트를 보냅니다(실제 모션 아님).")
            db.add(ev)
            db.flush()
            db.add(CameraStatus(camera_id=ev.id))
            print("데모 ONVIF 카메라 생성")
        elif ev.host != ip:
            ev.host, ev.main_stream_url, ev.sub_stream_url = ip, main_url, sub_url
            ev.snapshot_url = f"http://{host}:{onvif_port}/snapshot.jpg"
            ev.password_enc = encrypt_secret(cam_pw)
            ev.config_version += 1
        # 4) 지능형 분석 시연용 합성 장면 카메라(make_scenes.py) — 규칙은 처음 만들 때만 넣는다
        if os.environ.get("NVR_DEMO_SCENES"):
            seed_scenes(db, site, host, ip, cam_port, cam_pw)
        # 3) 여러 현장 통합 화면 시연: 이 서버가 자기 자신에게 현장 보고
        tok_file = os.environ.get("NVR_CENTRAL_TOKEN_FILE", "")
        if tok_file and not db.scalar(select(EdgeNode).where(EdgeNode.name == "데모 현장 서버(자기 자신)")):
            token = "edge_" + new_token(32)
            db.add(EdgeNode(name="데모 현장 서버(자기 자신)", url="", token_hash=sha256_hex(token)))
            with open(tok_file, "w", encoding="utf-8") as f:
                f.write(token)
            print("데모 Edge 등록")
    return 0


SCENES = [
    ("fire", "분석 시험: 합성 불꽃 장면", "20~50초 구간에 합성 불꽃이 나타나는 60초 반복 영상(오른쪽 주황색 드럼은 오탐 시험용)",
     [dict(type="fire", name="자재 적치장", cooldown_seconds=20)]),
    ("water", "분석 시험: 합성 수위 장면", "3분 주기로 물이 차오르고 빠지는 인공 영상. 수위봉을 따라 눈금선을 그려 둠",
     [dict(type="water_level", name="지하 배수로", zone=[[0, 0.6], [0.85, 0.6], [0.85, 1], [0, 1]],
           line=[[0.875, 0.94], [0.875, 0.42]], cooldown_seconds=20)]),
    ("people", "분석 시험: 보행자 샘플 영상", "OpenCV 공개 샘플(vtest.avi) 반복 — 실제 공사 현장이 아님(안전모 착용자 없음)",
     [dict(type="intrusion", name="잔디 출입금지 구역", zone=[[0, 0.62], [0.42, 0.62], [0.42, 1], [0, 1]],
           params={"min_seconds": 1}, cooldown_seconds=30),
      dict(type="loitering", name="광장 배회", params={"dwell_seconds": 30}, cooldown_seconds=60),
      dict(type="crowd", name="군집(6명)", params={"min_count": 6, "persist_seconds": 3}, severity="info", cooldown_seconds=60),
      dict(type="no_helmet", name="안전모 착용 구역", params={"persist_seconds": 3}, cooldown_seconds=60),
      dict(type="running", name="급이동", cooldown_seconds=60)]),
]


def seed_scenes(db, site, host, ip, port, pw) -> None:
    from .analytics import DEFAULT_SEVERITY

    for key, name, note, rules in SCENES:
        url = f"rtsp://{host}:{port}/{key}"
        c = db.scalar(select(Camera).where(Camera.site_id == site.id, Camera.model == f"SCENE-{key}",
                                           Camera.deleted_at.is_(None)))
        if c:
            if c.main_stream_url != url:
                c.host, c.main_stream_url = ip, url
                c.password_enc = encrypt_secret(pw)
                c.config_version += 1
            continue
        c = Camera(site_id=site.id, name=name, building="데모", zone="분석", connection_type="rtsp", host=ip,
                   rtsp_transport="tcp", main_stream_url=url, username="cam", password_enc=encrypt_secret(pw),
                   vendor="TEST", model=f"SCENE-{key}", is_test_source=True, record_mode="event", event_pre_seconds=5,
                   event_post_seconds=10, event_triggers=["analytics"], retention_days=1, tags=["데모", "분석"],
                   location_note=note)
        db.add(c)
        db.flush()
        db.add(CameraStatus(camera_id=c.id))
        for r in rules:
            db.add(AnalyticsRule(camera_id=c.id, type=r["type"], name=r["name"], zone=r.get("zone", []),
                                 line=r.get("line", []), params=r.get("params", {}),
                                 severity=r.get("severity", DEFAULT_SEVERITY[r["type"]]),
                                 cooldown_seconds=r["cooldown_seconds"], updated_at=utcnow(),
                                 ref_requested_at=utcnow() if r["type"] == "water_level" else None))
        print(f"분석 시험 카메라 생성: {key}")


if __name__ == "__main__":
    sys.exit(main())
