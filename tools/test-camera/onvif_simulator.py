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
import subprocess
import sys
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOAP = "http://www.w3.org/2003/05/soap-envelope"
NS = {"tds": "http://www.onvif.org/ver10/device/wsdl", "trt": "http://www.onvif.org/ver10/media/wsdl",
      "tr2": "http://www.onvif.org/ver20/media/wsdl", "tt": "http://www.onvif.org/ver10/schema"}
CFG = {}


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
        return self.send(400, fault("ActionNotSupported", f"{name} not supported"))


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
    a = ap.parse_args()
    pw = os.environ.get("TEST_CAM_PASSWORD", "")
    if a.password_file:
        pw = open(a.password_file, encoding="utf-8").read().strip()
    CFG.update(user=a.user, password=pw, port=a.port, rtsp_port=a.rtsp_port, offset=a.clock_offset,
               media2=not a.no_media2, xaddr_host=a.xaddr_host or a.bind, jpeg=make_jpeg(),
               profiles=[("main", "MainStream", 1280, 720, 15, 1500, "main"), ("sub", "SubStream", 640, 360, 10, 500, "sub")])
    srv = ThreadingHTTPServer((a.bind, a.port), H)
    print(f"[TEST ONVIF SIMULATOR] http://{a.bind}:{a.port}/onvif/device_service media2={CFG['media2']} offset={a.clock_offset}s", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
