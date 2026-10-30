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
from .models import Camera, CameraStatus, Site, User
from .security.crypto import encrypt_secret
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
