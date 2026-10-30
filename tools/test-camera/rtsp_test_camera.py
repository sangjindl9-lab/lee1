#!/usr/bin/env python3
"""
[시험 전용] 합성 RTSP 카메라 (GStreamer RTSP Server)

실제 카메라가 아닙니다. 웹 NVR의 녹화·재생·내보내기·재연결을 시험하기 위해
videotestsrc 기반 H.264(+선택적 AAC/G.711) 스트림을 RTSP로 제공합니다.
영상 화면에 "TEST STREAM" 문구와 시각이 표시되어 실제 카메라 영상과 구분됩니다.

요구: python3-gi, gir1.2-gst-rtsp-server-1.0, gstreamer1.0-plugins-{base,good,ugly,bad}
  (Ubuntu 24.04에서는 시스템 python3.12 로 실행: /usr/bin/python3.12)

사용 예:
  python3.12 rtsp_test_camera.py --port 8554 --user cam --password-file ./cam.pass
  -> rtsp://cam:<pw>@127.0.0.1:8554/main  (1280x720 H.264 15fps)
  -> rtsp://cam:<pw>@127.0.0.1:8554/sub   (640x360 H.264 10fps)
  -> rtsp://cam:<pw>@127.0.0.1:8554/h265  (1280x720 H.265, 브라우저 호환 시험용)

비밀번호는 명령줄에 남지 않도록 파일 또는 환경변수 TEST_CAM_PASSWORD 로 받습니다.
"""
import argparse
import os
import signal
import sys

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstRtspServer", "1.0")
gi.require_version("GstRtsp", "1.0")
from gi.repository import GLib, Gst, GstRtsp, GstRtspServer  # noqa: E402


def pipeline(width, height, fps, codec, audio, label, kbps=1500):
    overlay = (
        f'textoverlay text="TEST STREAM - {label}" valignment=top halignment=left font-desc="Sans 20" ! '
        'clockoverlay time-format="%Y-%m-%d %H:%M:%S" halignment=right valignment=bottom font-desc="Sans 18" ! '
    )
    if codec == "h265":
        enc = "x265enc tune=zerolatency speed-preset=ultrafast key-int-max={gop} bitrate={kbps} ! h265parse ! rtph265pay name=pay0 pt=96 config-interval=1"
    else:
        enc = ("x264enc tune=zerolatency speed-preset=ultrafast key-int-max={gop} bitrate={kbps} bframes=0 ! "
               "video/x-h264,profile=baseline ! h264parse ! rtph264pay name=pay0 pt=96 config-interval=1")
    gop = fps * 2
    v = (
        f"( videotestsrc is-live=true pattern=smpte ! video/x-raw,width={width},height={height},framerate={fps}/1 ! "
        f"{overlay}videoconvert ! video/x-raw,format=I420 ! {enc.format(gop=gop, kbps=kbps)} "
    )
    if audio == "aac":
        v += "audiotestsrc is-live=true wave=sine freq=440 volume=0.1 ! audioconvert ! audioresample ! avenc_aac ! aacparse ! rtpmp4gpay name=pay1 pt=97 "
    elif audio == "pcmu":
        v += "audiotestsrc is-live=true wave=sine freq=440 volume=0.1 ! audioconvert ! audioresample ! audio/x-raw,rate=8000,channels=1 ! mulawenc ! rtppcmupay name=pay1 pt=0 "
    v += ")"
    return v


def main():
    ap = argparse.ArgumentParser(description="[시험 전용] 합성 RTSP 카메라")
    ap.add_argument("--port", default="8554")
    ap.add_argument("--main-kbps", type=int, default=1500)
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--user", default="")
    ap.add_argument("--password-file", default="")
    ap.add_argument("--audio", choices=["none", "aac", "pcmu"], default="aac")
    args = ap.parse_args()

    password = os.environ.get("TEST_CAM_PASSWORD", "")
    if args.password_file:
        with open(args.password_file, encoding="utf-8") as f:
            password = f.read().strip()

    Gst.init(None)
    server = GstRtspServer.RTSPServer()
    server.set_address(args.bind)
    server.set_service(args.port)
    mounts = server.get_mount_points()

    streams = {
        "/main": pipeline(1280, 720, 15, "h264", args.audio, "MAIN 1280x720", kbps=args.main_kbps),
        "/sub": pipeline(640, 360, 10, "h264", "none", "SUB 640x360", kbps=max(200, args.main_kbps // 3)),
        "/h265": pipeline(1280, 720, 15, "h265", "none", "H265 1280x720"),
    }
    for path, launch in streams.items():
        factory = GstRtspServer.RTSPMediaFactory()
        factory.set_launch(launch)
        factory.set_shared(True)  # 여러 클라이언트가 하나의 인코더를 공유
        if args.user:
            perms = GstRtspServer.RTSPPermissions()
            perms.add_role_from_structure(
                Gst.Structure.new_from_string(
                    "camera, media.factory.access=(boolean)true, media.factory.construct=(boolean)true"
                )
            )
            factory.set_permissions(perms)
        mounts.add_factory(path, factory)

    if args.user:
        auth = GstRtspServer.RTSPAuth()
        token = GstRtspServer.RTSPToken()
        token.set_string("media.factory.role", "camera")
        basic = GstRtspServer.RTSPAuth.make_basic(args.user, password)
        auth.add_basic(basic, token)
        # Digest 인증도 함께 제공 (실제 카메라 다수가 Digest 사용)
        auth.add_digest(args.user, password, token)
        auth.set_supported_methods(GstRtsp.RTSPAuthMethod.DIGEST)  # Digest 우선 요구
        server.set_auth(auth)

    server.attach(None)
    print(f"[TEST CAMERA] rtsp://{args.bind}:{args.port}/{{main,sub,h265}} auth={'on' if args.user else 'off'} audio={args.audio}", flush=True)
    loop = GLib.MainLoop()
    signal.signal(signal.SIGTERM, lambda *_: loop.quit())
    signal.signal(signal.SIGINT, lambda *_: loop.quit())
    loop.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
