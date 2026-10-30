#!/usr/bin/env python3
"""
[시험 전용] ONVIF 장치 시뮬레이터 — 실제 카메라가 아닙니다.

웹 NVR 의 ONVIF 수동 등록 흐름(인증 → 장치 정보 → 서비스 → 프로파일 → 스트림/스냅샷 URI)을
실장비 없이 시험하기 위한 최소 구현입니다. ONVIF 적합성과 무관하며, 실제 장치의 다양한 동작
(펌웨어별 차이, 이벤트, PTZ 등)을 재현하지 않습니다. 스트림은 rtsp_test_camera.py 를 가리킵니다.

지원 요청: GetSystemDateAndTime(인증 없음), GetDeviceInformation, GetServices, GetCapabilities,
          Media2 GetProfiles/GetStreamUri/GetSnapshotUri, Media(ver10) GetProfiles/GetStreamUri/GetSnapshotUri
인증: WS-UsernameToken PasswordDigest (Created 시각 ±5분 허용, --clock-offset 으로 장치 시계 오차 재현)
스냅샷: GET /snapshot.jpg (HTTP Basic), 합성 JPEG

예) python3.12 onvif_simulator.py --bind 192.0.2.2 --port 18080 --user cam --password-file cam.pass --rtsp-port 18554
"""
import argparse
import base64
import datetime as dt
import hashlib
import os
import socket
import struct
import subprocess
import sys
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOAP = "http://www.w3.org/2003/05/soap-envelope"
NS_PTZ = "http://www.onvif.org/ver20/ptz/wsdl"
NS_EV = "http://www.onvif.org/ver10/events/wsdl"
NS_SE = "http://www.onvif.org/ver10/search/wsdl"
NS_RP = "http://www.onvif.org/ver10/replay/wsdl"
NS = {"tds": "http://www.onvif.org/ver10/device/wsdl", "trt": "http://www.onvif.org/ver10/media/wsdl",
      "tr2": "http://www.onvif.org/ver20/media/wsdl", "tt": "http://www.onvif.org/ver10/schema"}
CFG = {}
# PTZ 상태·프리셋, 모션 이벤트 상태(시뮬레이션)
STATE = {"pan": 0.0, "tilt": 0.0, "zoom": 0.0, "vel": (0.0, 0.0, 0.0), "until": 0.0,
         "presets": {"1": ("정문", 0.0, 0.0, 0.0), "2": ("주차장", 0.6, -0.2, 0.3)}, "motion": False, "changes": [], "subs": {}}
LOCK = threading.Lock()


def ptz_tick():
    with LOCK:
        now = time.time()
        if now < STATE["until"]:
            vx, vy, vz = STATE["vel"]
            STATE["pan"] = max(-1, min(1, STATE["pan"] + vx * 0.1))
            STATE["tilt"] = max(-1, min(1, STATE["tilt"] + vy * 0.1))
            STATE["zoom"] = max(0, min(1, STATE["zoom"] + vz * 0.1))


def motion_loop(period, length):
    """period 초마다 length 초 동안 모션 이벤트 발생(시험용)."""
    while period > 0:
        time.sleep(period - length)
        push_motion(True)
        time.sleep(length)
        push_motion(False)


def push_motion(active):
    with LOCK:
        STATE["motion"] = active
        t = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for q in STATE["subs"].values():
            q.append((t, active, "Changed"))


def envelope(body):
    return (f'<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="{SOAP}" xmlns:tds="{NS["tds"]}" '
            f'xmlns:trt="{NS["trt"]}" xmlns:tr2="{NS["tr2"]}" xmlns:tt="{NS["tt"]}"><s:Body>{body}</s:Body></s:Envelope>')


def fault(code, reason):
    return envelope(f'<s:Fault><s:Code><s:Value>s:Sender</s:Value><s:Subcode><s:Value>ter:{code}</s:Value></s:Subcode>'
                    f'</s:Code><s:Reason><s:Text xml:lang="en">{reason}</s:Text></s:Reason></s:Fault>')


def now_cam():
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=CFG["offset"])


def check_auth(root):
    sec = root.find(".//{*}Security")
    if sec is None:
        return False
    user = sec.findtext(".//{*}Username") or ""
    pwd = sec.findtext(".//{*}Password") or ""
    nonce = sec.findtext(".//{*}Nonce") or ""
    created = sec.findtext(".//{*}Created") or ""
    try:
        c = dt.datetime.strptime(created[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return False
    if abs((c - now_cam()).total_seconds()) > 300:
        return False
    expect = base64.b64encode(hashlib.sha1(base64.b64decode(nonce) + created.encode() + CFG["password"].encode()).digest()).decode()
    return user == CFG["user"] and pwd == expect


def profiles_m2():
    out = ""
    for tok, name, w, h, fps, br, path in CFG["profiles"]:
        out += (f'<tr2:Profiles token="{tok}" fixed="true"><tr2:Name>{name}</tr2:Name><tr2:Configurations>'
                f'<tr2:VideoSource token="vs0"><tt:Name>vs</tt:Name></tr2:VideoSource>'
                f'<tr2:VideoEncoder token="ve_{tok}"><tt:Name>enc</tt:Name><tt:Encoding>H264</tt:Encoding>'
                f'<tt:Resolution><tt:Width>{w}</tt:Width><tt:Height>{h}</tt:Height></tt:Resolution>'
                f'<tt:RateControl><tt:FrameRateLimit>{fps}</tt:FrameRateLimit><tt:BitrateLimit>{br}</tt:BitrateLimit></tt:RateControl>'
                f'</tr2:VideoEncoder></tr2:Configurations></tr2:Profiles>')
    return out


def profiles_m1():
    out = ""
    for tok, name, w, h, fps, br, path in CFG["profiles"]:
        out += (f'<trt:Profiles token="{tok}" fixed="true"><tt:Name>{name}</tt:Name>'
                f'<tt:VideoEncoderConfiguration token="ve_{tok}"><tt:Name>enc</tt:Name><tt:Encoding>H264</tt:Encoding>'
                f'<tt:Resolution><tt:Width>{w}</tt:Width><tt:Height>{h}</tt:Height></tt:Resolution>'
                f'<tt:RateControl><tt:FrameRateLimit>{fps}</tt:FrameRateLimit><tt:BitrateLimit>{br}</tt:BitrateLimit></tt:RateControl>'
                f'</tt:VideoEncoderConfiguration></trt:Profiles>')
    return out


def stream_uri(token):
    for tok, *_rest, path in CFG["profiles"]:
        if tok == token:
            return f"rtsp://{CFG['xaddr_host']}:{CFG['rtsp_port']}/{path}"
    return None


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # 조용히
        pass

    def send(self, code, body, ctype="application/soap+xml; charset=utf-8"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != "/snapshot.jpg":
            return self.send(404, "not found", "text/plain")
        auth = self.headers.get("Authorization", "")
        good = "Basic " + base64.b64encode(f"{CFG['user']}:{CFG['password']}".encode()).decode()
        if auth != good:
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="onvif-sim"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send(200, CFG["jpeg"], "image/jpeg")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(min(n, 1024 * 1024))
        try:
            root = ET.fromstring(raw)
        except ET.ParseError:
            return self.send(400, fault("BadXml", "bad xml"))
        body = root.find(f"{{{SOAP}}}Body")
        op = body[0] if body is not None and len(body) else None
        if op is None:
            return self.send(400, fault("NoOp", "no operation"))
        name = op.tag.split("}")[-1]
        ns = op.tag.split("}")[0][1:]
        x = CFG["xaddr_host"]
        p = CFG["port"]
        if name == "GetSystemDateAndTime":
            t = now_cam()
            return self.send(200, envelope(
                f"<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:DateTimeType>NTP</tt:DateTimeType>"
                f"<tt:UTCDateTime><tt:Time><tt:Hour>{t.hour}</tt:Hour><tt:Minute>{t.minute}</tt:Minute><tt:Second>{t.second}</tt:Second></tt:Time>"
                f"<tt:Date><tt:Year>{t.year}</tt:Year><tt:Month>{t.month}</tt:Month><tt:Day>{t.day}</tt:Day></tt:Date></tt:UTCDateTime>"
                f"</tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>"))
        if not check_auth(root):
            return self.send(400, fault("NotAuthorized", "Sender not Authorized"))
        if name == "GetDeviceInformation":
            return self.send(200, envelope(
                "<tds:GetDeviceInformationResponse><tds:Manufacturer>TEST-SIMULATOR</tds:Manufacturer>"
                "<tds:Model>ONVIF-SIM-1</tds:Model><tds:FirmwareVersion>0.1-test</tds:FirmwareVersion>"
                "<tds:SerialNumber>SIM-0001</tds:SerialNumber><tds:HardwareId>sim</tds:HardwareId>"
                "</tds:GetDeviceInformationResponse>"))
        if name == "GetServices":
            svcs = [(NS["tds"], "/onvif/device_service"), (NS["trt"], "/onvif/media_service")]
            if CFG["media2"]:
                svcs.append((NS["tr2"], "/onvif/media2_service"))
            svcs += [(NS_PTZ, "/onvif/ptz_service"), (NS_EV, "/onvif/event_service"),
                     (NS_SE, "/onvif/search_service"), (NS_RP, "/onvif/replay_service"),
                     ("http://www.onvif.org/ver10/recording/wsdl", "/onvif/recording_service")]
            items = "".join(f"<tds:Service><tds:Namespace>{n_}</tds:Namespace><tds:XAddr>http://{x}:{p}{path}</tds:XAddr>"
                            f"<tds:Version><tt:Major>2</tt:Major><tt:Minor>0</tt:Minor></tds:Version></tds:Service>"
                            for n_, path in svcs)
            return self.send(200, envelope(f"<tds:GetServicesResponse>{items}</tds:GetServicesResponse>"))
        if name == "GetCapabilities":
            return self.send(200, envelope(
                f"<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Device><tt:XAddr>http://{x}:{p}/onvif/device_service</tt:XAddr></tt:Device>"
                f"<tt:Media><tt:XAddr>http://{x}:{p}/onvif/media_service</tt:XAddr></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>"))
        if ns == NS["tr2"] and not CFG["media2"]:
            return self.send(400, fault("ActionNotSupported", "Media2 not supported"))
        token = (op.findtext(".//{*}ProfileToken") or "").strip()
        if name == "GetProfiles":
            if ns == NS["tr2"]:
                return self.send(200, envelope(f"<tr2:GetProfilesResponse>{profiles_m2()}</tr2:GetProfilesResponse>"))
            return self.send(200, envelope(f"<trt:GetProfilesResponse>{profiles_m1()}</trt:GetProfilesResponse>"))
        if name == "GetStreamUri":
            uri = stream_uri(token)
            if not uri:
                return self.send(400, fault("NoProfile", "no such profile"))
            if ns == NS["tr2"]:
                return self.send(200, envelope(f"<tr2:GetStreamUriResponse><tr2:Uri>{uri}</tr2:Uri></tr2:GetStreamUriResponse>"))
            return self.send(200, envelope(f"<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>{uri}</tt:Uri>"
                                           f"<tt:InvalidAfterConnect>false</tt:InvalidAfterConnect></trt:MediaUri></trt:GetStreamUriResponse>"))
        if name == "GetSnapshotUri":
            uri = f"http://{x}:{p}/snapshot.jpg"
            if ns == NS["tr2"]:
                return self.send(200, envelope(f"<tr2:GetSnapshotUriResponse><tr2:Uri>{uri}</tr2:Uri></tr2:GetSnapshotUriResponse>"))
            return self.send(200, envelope(f"<trt:GetSnapshotUriResponse><trt:MediaUri><tt:Uri>{uri}</tt:Uri></trt:MediaUri></trt:GetSnapshotUriResponse>"))
        r = self.extra(name, ns, op, root, token)
        if r is not None:
            return self.send(*r) if isinstance(r, tuple) else self.send(200, r)
        return self.send(400, fault("ActionNotSupported", f"{name} not supported"))

    def extra(self, name, ns, op, root, token):
        x, p = CFG["xaddr_host"], CFG["port"]
        if ns == NS_PTZ:
            ptz_tick()
            if name == "ContinuousMove":
                pt = op.find(".//{*}PanTilt")
                zm = op.find(".//{*}Zoom")
                vx = float(pt.get("x", 0)) if pt is not None else 0.0
                vy = float(pt.get("y", 0)) if pt is not None else 0.0
                vz = float(zm.get("x", 0)) if zm is not None else 0.0
                with LOCK:
                    STATE["vel"], STATE["until"] = (vx, vy, vz), time.time() + 1.0
                    # 시뮬레이션: 요청 1회 = 즉시 한 걸음 이동
                    STATE["pan"] = max(-1, min(1, STATE["pan"] + vx * 0.1))
                    STATE["tilt"] = max(-1, min(1, STATE["tilt"] + vy * 0.1))
                    STATE["zoom"] = max(0, min(1, STATE["zoom"] + vz * 0.1))
                return envelope(f'<tptz:ContinuousMoveResponse xmlns:tptz="{NS_PTZ}"/>')
            if name == "Stop":
                with LOCK:
                    STATE["until"] = 0
                return envelope(f'<tptz:StopResponse xmlns:tptz="{NS_PTZ}"/>')
            if name == "GetPresets":
                items = "".join(f'<tptz:Preset token="{k}"><tt:Name>{v[0]}</tt:Name></tptz:Preset>' for k, v in STATE["presets"].items())
                return envelope(f'<tptz:GetPresetsResponse xmlns:tptz="{NS_PTZ}">{items}</tptz:GetPresetsResponse>')
            if name == "GotoPreset":
                t = (op.findtext(".//{*}PresetToken") or "").strip()
                if t not in STATE["presets"]:
                    return (400, fault("NoToken", "no such preset"))
                with LOCK:
                    _, STATE["pan"], STATE["tilt"], STATE["zoom"] = STATE["presets"][t]
                return envelope(f'<tptz:GotoPresetResponse xmlns:tptz="{NS_PTZ}"/>')
            if name == "SetPreset":
                nm = (op.findtext(".//{*}PresetName") or "프리셋").strip()[:40]
                with LOCK:
                    tok = str(len(STATE["presets"]) + 1)
                    STATE["presets"][tok] = (nm, STATE["pan"], STATE["tilt"], STATE["zoom"])
                return envelope(f'<tptz:SetPresetResponse xmlns:tptz="{NS_PTZ}"><tptz:PresetToken>{tok}</tptz:PresetToken></tptz:SetPresetResponse>')
            if name == "GetStatus":
                return envelope(f'<tptz:GetStatusResponse xmlns:tptz="{NS_PTZ}"><tptz:PTZStatus><tt:Position>'
                                f'<tt:PanTilt x="{STATE["pan"]:.3f}" y="{STATE["tilt"]:.3f}"/><tt:Zoom x="{STATE["zoom"]:.3f}"/>'
                                f'</tt:Position></tptz:PTZStatus></tptz:GetStatusResponse>')
        if ns == NS_EV and name == "CreatePullPointSubscription":
            sid = uuid.uuid4().hex[:12]
            with LOCK:
                t = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                STATE["subs"][sid] = [(t, STATE["motion"], "Initialized")]
            addr = f"http://{x}:{p}/onvif/subscription/{sid}"
            return envelope(f'<tev:CreatePullPointSubscriptionResponse xmlns:tev="{NS_EV}" xmlns:wsa="http://www.w3.org/2005/08/addressing">'
                            f'<tev:SubscriptionReference><wsa:Address>{addr}</wsa:Address></tev:SubscriptionReference>'
                            f'<wsnt:CurrentTime xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">{t}</wsnt:CurrentTime></tev:CreatePullPointSubscriptionResponse>')
        if self.path.startswith("/onvif/subscription/"):
            sid = self.path.rsplit("/", 1)[-1]
            if sid not in STATE["subs"]:
                return (400, fault("ResourceUnknown", "unknown subscription"))
            if name == "PullMessages":
                deadline = time.time() + 2
                while time.time() < deadline and not STATE["subs"][sid]:
                    time.sleep(0.2)
                with LOCK:
                    msgs, STATE["subs"][sid] = STATE["subs"][sid], []
                body = "".join(
                    f'<wsnt:NotificationMessage><wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">'
                    f'tns1:VideoSource/MotionAlarm</wsnt:Topic><wsnt:Message><tt:Message UtcTime="{t}" PropertyOperation="{op_}">'
                    f'<tt:Source><tt:SimpleItem Name="Source" Value="vs0"/></tt:Source>'
                    f'<tt:Data><tt:SimpleItem Name="State" Value="{"true" if a else "false"}"/></tt:Data></tt:Message></wsnt:Message>'
                    f'</wsnt:NotificationMessage>' for t, a, op_ in msgs)
                return envelope(f'<tev:PullMessagesResponse xmlns:tev="{NS_EV}" xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">{body}</tev:PullMessagesResponse>')
            if name == "Renew":
                return envelope('<wsnt:RenewResponse xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"/>')
            if name == "Unsubscribe":
                with LOCK:
                    STATE["subs"].pop(sid, None)
                return envelope('<wsnt:UnsubscribeResponse xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"/>')
        if ns == NS_SE:
            if name == "FindRecordings":
                return envelope(f'<tse:FindRecordingsResponse xmlns:tse="{NS_SE}"><tse:SearchToken>s1</tse:SearchToken></tse:FindRecordingsResponse>')
            if name == "GetRecordingSearchResults":
                now = dt.datetime.now(dt.timezone.utc)
                e = (now - dt.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
                ln = now.strftime("%Y-%m-%dT%H:%M:%SZ")
                return envelope(f'<tse:GetRecordingSearchResultsResponse xmlns:tse="{NS_SE}"><tse:ResultList><tt:SearchState>Completed</tt:SearchState>'
                                f'<tt:RecordingInformation><tt:RecordingToken>SD_REC_1</tt:RecordingToken><tt:Source><tt:Name>SIM SD card</tt:Name></tt:Source>'
                                f'<tt:EarliestRecording>{e}</tt:EarliestRecording><tt:LatestRecording>{ln}</tt:LatestRecording>'
                                f'<tt:Content>continuous</tt:Content><tt:RecordingStatus>Recording</tt:RecordingStatus></tt:RecordingInformation>'
                                f'</tse:ResultList></tse:GetRecordingSearchResultsResponse>')
        if ns == NS_RP and name == "GetReplayUri":
            return envelope(f'<trp:GetReplayUriResponse xmlns:trp="{NS_RP}"><trp:Uri>rtsp://{x}:{CFG["rtsp_port"]}/main</trp:Uri></trp:GetReplayUriResponse>')
        return None


def discovery_responder(bind_ip):
    """WS-Discovery Probe 에 ProbeMatch 로 응답(시험용)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", 3702))
    mreq = struct.pack("4s4s", socket.inet_aton("239.255.255.250"), socket.inet_aton(bind_ip))
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    while True:
        data, addr = sock.recvfrom(65535)
        if b"Probe" not in data or b"ProbeMatch" in data:
            continue
        rel = ""
        try:
            rel = ET.fromstring(data).findtext(".//{*}MessageID") or ""
        except ET.ParseError:
            continue
        resp = (f'<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="{SOAP}" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
                f'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><s:Header><a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</a:Action>'
                f'<a:RelatesTo>{rel}</a:RelatesTo></s:Header><s:Body><d:ProbeMatches><d:ProbeMatch><a:EndpointReference><a:Address>urn:uuid:sim-0001</a:Address></a:EndpointReference>'
                f'<d:Types>dn:NetworkVideoTransmitter</d:Types><d:Scopes>onvif://www.onvif.org/name/ONVIF_SIM_1 onvif://www.onvif.org/hardware/TEST-SIMULATOR '
                f'onvif://www.onvif.org/Profile/Streaming onvif://www.onvif.org/Profile/T onvif://www.onvif.org/Profile/G</d:Scopes>'
                f'<d:XAddrs>http://{CFG["xaddr_host"]}:{CFG["port"]}/onvif/device_service</d:XAddrs><d:MetadataVersion>1</d:MetadataVersion>'
                f'</d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>')
        sock.sendto(resp.encode(), addr)


def make_jpeg():
    try:
        return subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1", "-frames:v", "1",
                               "-f", "image2", "-c:v", "mjpeg", "pipe:1"], capture_output=True, check=True).stdout
    except Exception:  # noqa: BLE001
        return b"\xff\xd8\xff\xd9"


def main():
    ap = argparse.ArgumentParser(description="[시험 전용] ONVIF 장치 시뮬레이터")
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=18080)
    ap.add_argument("--user", default="cam")
    ap.add_argument("--password-file", default="")
    ap.add_argument("--rtsp-port", type=int, default=18554)
    ap.add_argument("--clock-offset", type=int, default=0, help="장치 시계 오차(초)")
    ap.add_argument("--no-media2", action="store_true")
    ap.add_argument("--xaddr-host", default="", help="응답 주소에 넣을 호스트(NAT/잘못된 주소 재현)")
    ap.add_argument("--motion-period", type=int, default=0, help="N초마다 모션 이벤트(0=끔)")
    ap.add_argument("--motion-length", type=int, default=8)
    ap.add_argument("--discovery", action="store_true", help="WS-Discovery 응답(UDP 3702)")
    a = ap.parse_args()
    pw = os.environ.get("TEST_CAM_PASSWORD", "")
    if a.password_file:
        pw = open(a.password_file, encoding="utf-8").read().strip()
    CFG.update(user=a.user, password=pw, port=a.port, rtsp_port=a.rtsp_port, offset=a.clock_offset,
               media2=not a.no_media2, xaddr_host=a.xaddr_host or a.bind, jpeg=make_jpeg(),
               profiles=[("main", "MainStream", 1280, 720, 15, 1500, "main"), ("sub", "SubStream", 640, 360, 10, 500, "sub")])
    srv = ThreadingHTTPServer((a.bind, a.port), H)
    if a.motion_period:
        threading.Thread(target=motion_loop, args=(a.motion_period, a.motion_length), daemon=True).start()
    if a.discovery:
        threading.Thread(target=discovery_responder, args=(a.bind,), daemon=True).start()
    print(f"[TEST ONVIF SIMULATOR] http://{a.bind}:{a.port}/onvif/device_service media2={CFG['media2']} offset={a.clock_offset}s", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
