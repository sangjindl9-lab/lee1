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
from .models import Camera, CameraStatus, EdgeNode, Site, User
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
                                             Camera.connection_type == "rtsp",
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
        # 3) 여러 현장 통합 화면 시연: 이 서버가 자기 자신에게 현장 보고
        tok_file = os.environ.get("NVR_CENTRAL_TOKEN_FILE", "")
        if tok_file and not db.scalar(select(EdgeNode).where(EdgeNode.name == "데모 현장 서버(자기 자신)")):
            token = "edge_" + new_token(32)
            db.add(EdgeNode(name="데모 현장 서버(자기 자신)", url="", token_hash=sha256_hex(token)))
            with open(tok_file, "w", encoding="utf-8") as f:
                f.write(token)
            print("데모 Edge 등록")
    return 0


if __name__ == "__main__":
    sys.exit(main())
