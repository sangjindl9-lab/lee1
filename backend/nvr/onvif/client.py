"""경량 ONVIF SOAP 클라이언트 (Device / Media ver10 / Media2 ver20).

- WS-Security UsernameToken(PasswordDigest) + 카메라 시계 오차 보정
- HTTP 401 시 HTTP Digest 를 함께 사용해 재시도
- 장치가 알려준 모든 주소(XAddr, StreamUri, SnapshotUri)는 현장 허용망 검사를 통과해야 사용
- 리다이렉트는 목적지를 다시 검사하고 최대 2회만 따른다

ONVIF 공식 WSDL(Device: ver10/device, Media: ver10/media, Media2: ver20/media)의 요청 구조를 따른다.
이것은 ONVIF 연동 구현이며 ONVIF 공식 적합성(Conformance) 인증과는 무관하다.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import os
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from lxml import etree

from ..security.netguard import TargetDenied, check_url, strip_credentials

NS = {
    "s": "http://www.w3.org/2003/05/soap-envelope",
    "tds": "http://www.onvif.org/ver10/device/wsdl",
    "trt": "http://www.onvif.org/ver10/media/wsdl",
    "tr2": "http://www.onvif.org/ver20/media/wsdl",
    "tt": "http://www.onvif.org/ver10/schema",
}
NS_PTZ = "http://www.onvif.org/ver20/ptz/wsdl"
NS_EVENTS = "http://www.onvif.org/ver10/events/wsdl"
NS_RECORDING = "http://www.onvif.org/ver10/recording/wsdl"
NS_SEARCH = "http://www.onvif.org/ver10/search/wsdl"
NS_REPLAY = "http://www.onvif.org/ver10/replay/wsdl"
NS_IMAGING = "http://www.onvif.org/ver20/imaging/wsdl"
NS_ANALYTICS = "http://www.onvif.org/ver20/analytics/wsdl"

WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
WSA = "http://www.w3.org/2005/08/addressing"
PWD_DIGEST = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest"
B64 = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-soap-message-security-1.0#Base64Binary"

MAX_RESPONSE = 2 * 1024 * 1024
_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, load_dtd=False)


class OnvifError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _local(el, name: str):
    """네임스페이스와 무관하게 하위 요소 1개 찾기."""
    res = el.xpath(f".//*[local-name()='{name}']")
    return res[0] if res else None


def _text(el, name: str) -> str:
    x = _local(el, name) if el is not None else None
    return (x.text or "").strip() if x is not None and x.text else ""


def _child_text(el, *path: str) -> str:
    cur = el
    for p in path:
        if cur is None:
            return ""
        nxt = None
        for c in cur:
            if isinstance(c.tag, str) and etree.QName(c).localname == p:
                nxt = c
                break
        cur = nxt
    return (cur.text or "").strip() if cur is not None and cur.text else ""


@dataclass
class OnvifTarget:
    scheme: str
    host: str  # 사용자가 입력한 주소(IP 또는 호스트명)
    port: int
    device_path: str
    username: str
    password: str
    allowed_networks: list[str]
    tls_insecure: bool = False
    timeout: float = 8.0


@dataclass
class ProbeOutput:
    device: dict[str, str] = field(default_factory=dict)
    time_offset_seconds: float | None = None
    services: dict[str, str] = field(default_factory=dict)
    media2: bool = False
    capabilities: dict[str, Any] = field(default_factory=dict)
    profiles: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class OnvifClient:
    def __init__(self, target: OnvifTarget):
        self.t = target
        if target.scheme not in ("http", "https"):
            raise OnvifError("bad_scheme", "ONVIF 서비스는 http/https 만 사용할 수 있습니다.")
        path = target.device_path or "/onvif/device_service"
        if not path.startswith("/"):
            path = "/" + path
        base = f"{target.scheme}://{target.host}:{target.port}{path}"
        checked = check_url(base, target.allowed_networks, schemes={"http", "https"})
        self.device_ip = checked.ip
        self.device_url = checked.url if target.scheme == "http" else base
        self.dt_diff = dt.timedelta(0)
        self.use_http_digest = False
        self.warnings: list[str] = []
        self.http = httpx.Client(
            timeout=target.timeout,
            follow_redirects=False,
            verify=not target.tls_insecure,
            trust_env=False,  # 프록시 환경변수 무시(현장망 직접 연결)
        )

    def close(self) -> None:
        self.http.close()

    # ---------------- 주소 검사 ----------------
    def safe_service_url(self, xaddr: str) -> str:
        """장치가 알려준 서비스 주소 검증. 허용망 밖이면 등록 주소로 바꾼다(NAT 대응)."""
        xaddr = strip_credentials(xaddr.strip())
        parts = urlsplit(xaddr)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise OnvifError("bad_xaddr", f"잘못된 서비스 주소: {xaddr[:100]}")
        try:
            checked = check_url(xaddr, self.t.allowed_networks, schemes={"http", "https"})
            return checked.url if parts.scheme == "http" else xaddr
        except TargetDenied:
            port = self.t.port
            rewritten = urlunsplit((self.t.scheme, f"{self.device_ip}:{port}", parts.path or "/", parts.query, ""))
            msg = f"장치가 허용망 밖 서비스 주소({parts.hostname})를 알려 등록 주소로 바꿔 사용합니다."
            if msg not in self.warnings:
                self.warnings.append(msg)
            return check_url(rewritten, self.t.allowed_networks, schemes={"http", "https"}).url

    def safe_media_uri(self, uri: str, schemes: set[str]) -> str:
        """스트림/스냅샷 URI 검증. 허용망 밖 호스트는 등록 IP로 바꾼다(포트·경로 유지). 반환값은 인증정보 없는 URL."""
        uri = strip_credentials(uri.strip())
        parts = urlsplit(uri)
        if parts.scheme.lower() not in schemes or not parts.hostname:
            raise OnvifError("bad_uri", f"지원하지 않는 주소: {uri[:120]}")
        try:
            check_url(uri, self.t.allowed_networks, schemes=schemes)
            return uri
        except TargetDenied:
            netloc = self.device_ip + (f":{parts.port}" if parts.port else "")
            rewritten = urlunsplit((parts.scheme, netloc, parts.path, parts.query, ""))
            check_url(rewritten, self.t.allowed_networks, schemes=schemes)
            msg = f"장치가 허용망 밖 주소({parts.hostname})를 알려 등록 IP로 바꿨습니다."
            if msg not in self.warnings:
                self.warnings.append(msg)
            return rewritten

    # ---------------- SOAP ----------------
    def _security_header(self) -> str:
        if not self.t.username:
            return ""
        nonce = os.urandom(16)
        created = (dt.datetime.now(dt.timezone.utc) + self.dt_diff).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + self.t.password.encode()).digest()).decode()
        u = _xml_escape(self.t.username)
        return (
            f'<wsse:Security s:mustUnderstand="1" xmlns:wsse="{WSSE}" xmlns:wsu="{WSU}">'
            f"<wsse:UsernameToken><wsse:Username>{u}</wsse:Username>"
            f'<wsse:Password Type="{PWD_DIGEST}">{digest}</wsse:Password>'
            f'<wsse:Nonce EncodingType="{B64}">{base64.b64encode(nonce).decode()}</wsse:Nonce>'
            f"<wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security>"
        )

    def call(self, url: str, body: str, action: str, auth: bool = True, wsa_to: str | None = None):
        header = self._security_header() if auth else ""
        if wsa_to is not None:
            # WS-Addressing(이벤트 구독 주소로 보내는 PullMessages 등에 필요)
            header += (f'<wsa:Action s:mustUnderstand="1" xmlns:wsa="{WSA}">{_xml_escape(action)}</wsa:Action>'
                       f'<wsa:To s:mustUnderstand="1" xmlns:wsa="{WSA}">{_xml_escape(wsa_to)}</wsa:To>')
        env = (
            f'<?xml version="1.0" encoding="UTF-8"?>'
            f'<s:Envelope xmlns:s="{NS["s"]}" xmlns:tds="{NS["tds"]}" xmlns:trt="{NS["trt"]}" '
            f'xmlns:tr2="{NS["tr2"]}" xmlns:tt="{NS["tt"]}">'
            f'{"<s:Header>" + header + "</s:Header>" if header else ""}<s:Body>{body}</s:Body></s:Envelope>'
        )
        headers = {"Content-Type": f'application/soap+xml; charset=utf-8; action="{action}"'}
        resp = self._post(url, env.encode("utf-8"), headers)
        if resp.status_code == 401 and auth and self.t.username and not self.use_http_digest:
            self.use_http_digest = True
            resp = self._post(url, env.encode("utf-8"), headers)
        content = resp.content[:MAX_RESPONSE]
        root = None
        try:
            root = etree.fromstring(content, parser=_PARSER) if content else None
        except etree.XMLSyntaxError:
            root = None
        if resp.status_code == 401:
            raise OnvifError("auth_failed", "ONVIF 인증 실패 — 계정/비밀번호 또는 카메라 시계(시간 오차)를 확인하세요.")
        fault = _local(root, "Fault") if root is not None else None
        if fault is not None:
            reason = _text(fault, "Text") or "SOAP Fault"
            sub = " ".join(x.text or "" for x in fault.xpath(".//*[local-name()='Value']"))
            if "NotAuthorized" in sub or "FailedAuthentication" in sub or "Sender not Authorized" in reason:
                raise OnvifError("auth_failed", f"ONVIF 인증 실패: {reason}")
            if "ActionNotSupported" in sub or "NoSuchService" in sub:
                raise OnvifError("not_supported", f"장치가 지원하지 않는 요청: {action.rsplit('/', 1)[-1]}")
            raise OnvifError("soap_fault", f"장치 오류: {reason} {sub}".strip())
        if resp.status_code >= 400:
            raise OnvifError("http_error", f"HTTP {resp.status_code} 오류")
        if root is None:
            raise OnvifError("bad_response", "ONVIF 응답을 해석할 수 없습니다.")
        return root

    def _post(self, url: str, data: bytes, headers: dict[str, str]) -> httpx.Response:
        auth = httpx.DigestAuth(self.t.username, self.t.password) if self.use_http_digest else None
        current = url
        for _ in range(3):
            try:
                resp = self.http.post(current, content=data, headers=headers, auth=auth)
            except httpx.ConnectError as exc:
                msg = str(exc).lower()
                if "refused" in msg:
                    raise OnvifError("connection_refused", "ONVIF 포트 연결 거부 — 포트와 ONVIF 사용 설정을 확인하세요.") from exc
                raise OnvifError("unreachable", f"ONVIF 장치에 연결할 수 없습니다: {exc}") from exc
            except httpx.TimeoutException as exc:
                raise OnvifError("timeout", "ONVIF 응답 시간 초과") from exc
            except httpx.HTTPError as exc:
                raise OnvifError("http_error", f"ONVIF 통신 오류: {exc}") from exc
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                nxt = urljoin(current, resp.headers["location"])
                try:
                    current = self.safe_service_url(nxt)
                except (TargetDenied, OnvifError) as exc:
                    raise OnvifError("redirect_blocked", "허용망 밖으로의 리다이렉트를 차단했습니다.") from exc
                continue
            return resp
        raise OnvifError("redirect_loop", "리다이렉트가 너무 많습니다.")

    # ---------------- Device ----------------
    def get_system_time(self) -> dt.datetime | None:
        root = self.call(self.device_url, "<tds:GetSystemDateAndTime/>",
                         f"{NS['tds']}/GetSystemDateAndTime", auth=False)
        utc = _local(root, "UTCDateTime")
        if utc is None:
            return None
        try:
            return dt.datetime(
                int(_text(utc, "Year")), int(_text(utc, "Month")), int(_text(utc, "Day")),
                int(_text(utc, "Hour")), int(_text(utc, "Minute")), int(_text(utc, "Second")),
                tzinfo=dt.timezone.utc,
            )
        except ValueError:
            return None

    def sync_time(self) -> float | None:
        try:
            cam = self.get_system_time()
        except OnvifError:
            return None
        if cam is None:
            return None
        self.dt_diff = cam - dt.datetime.now(dt.timezone.utc)
        return self.dt_diff.total_seconds()

    def get_device_information(self) -> dict[str, str]:
        root = self.call(self.device_url, "<tds:GetDeviceInformation/>", f"{NS['tds']}/GetDeviceInformation")
        return {k: _text(root, k) for k in ("Manufacturer", "Model", "FirmwareVersion", "SerialNumber", "HardwareId")}

    def get_services(self) -> dict[str, str]:
        root = self.call(
            self.device_url,
            "<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>",
            f"{NS['tds']}/GetServices",
        )
        out: dict[str, str] = {}
        for svc in root.xpath(".//*[local-name()='Service']"):
            ns = _child_text(svc, "Namespace")
            xaddr = _child_text(svc, "XAddr")
            if ns and xaddr:
                out[ns] = xaddr
        return out

    def get_capabilities_xaddrs(self) -> dict[str, str]:
        root = self.call(
            self.device_url,
            "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>",
            f"{NS['tds']}/GetCapabilities",
        )
        caps = _local(root, "Capabilities")
        out: dict[str, str] = {}
        mapping = {"Media": NS["trt"], "PTZ": NS_PTZ, "Events": NS_EVENTS, "Imaging": NS_IMAGING,
                   "Analytics": NS_ANALYTICS, "Device": NS["tds"]}
        if caps is not None:
            for c in caps:
                if not isinstance(c.tag, str):
                    continue
                name = etree.QName(c).localname
                if name in mapping:
                    x = _child_text(c, "XAddr")
                    if x:
                        out[mapping[name]] = x
        return out

    # ---------------- Media2 ----------------
    def media2_profiles(self, url: str) -> list[dict[str, Any]]:
        root = self.call(url, "<tr2:GetProfiles><tr2:Type>All</tr2:Type></tr2:GetProfiles>", f"{NS['tr2']}/GetProfiles")
        out = []
        for p in root.xpath(".//*[local-name()='Profiles']"):
            token = p.get("token") or ""
            enc = _local(p, "VideoEncoder")
            item = {"token": token, "name": _child_text(p, "Name"), "media": "media2",
                    "encoding": "", "width": None, "height": None, "fps": None, "bitrate_kbps": None,
                    "ptz": _local(p, "PTZ") is not None, "audio": _local(p, "AudioEncoder") is not None}
            if enc is not None:
                item["encoding"] = _text(enc, "Encoding").upper()
                item["width"] = _int(_text(enc, "Width"))
                item["height"] = _int(_text(enc, "Height"))
                item["fps"] = _float(_text(enc, "FrameRateLimit"))
                item["bitrate_kbps"] = _int(_text(enc, "BitrateLimit"))
            out.append(item)
        return out

    def media2_stream_uri(self, url: str, token: str) -> str:
        body = (f"<tr2:GetStreamUri><tr2:Protocol>RTSP</tr2:Protocol>"
                f"<tr2:ProfileToken>{_xml_escape(token)}</tr2:ProfileToken></tr2:GetStreamUri>")
        root = self.call(url, body, f"{NS['tr2']}/GetStreamUri")
        return _text(root, "Uri")

    def media2_snapshot_uri(self, url: str, token: str) -> str:
        body = f"<tr2:GetSnapshotUri><tr2:ProfileToken>{_xml_escape(token)}</tr2:ProfileToken></tr2:GetSnapshotUri>"
        root = self.call(url, body, f"{NS['tr2']}/GetSnapshotUri")
        return _text(root, "Uri")

    # ---------------- Media (ver10) ----------------
    def media_profiles(self, url: str) -> list[dict[str, Any]]:
        root = self.call(url, "<trt:GetProfiles/>", f"{NS['trt']}/GetProfiles")
        out = []
        for p in root.xpath(".//*[local-name()='Profiles']"):
            enc = _local(p, "VideoEncoderConfiguration")
            item = {"token": p.get("token") or "", "name": _child_text(p, "Name"), "media": "media1",
                    "encoding": "", "width": None, "height": None, "fps": None, "bitrate_kbps": None,
                    "ptz": _local(p, "PTZConfiguration") is not None,
                    "audio": _local(p, "AudioEncoderConfiguration") is not None}
            if enc is not None:
                item["encoding"] = _child_text(enc, "Encoding").upper()
                item["width"] = _int(_text(enc, "Width"))
                item["height"] = _int(_text(enc, "Height"))
                item["fps"] = _float(_text(enc, "FrameRateLimit"))
                item["bitrate_kbps"] = _int(_text(enc, "BitrateLimit"))
            out.append(item)
        return out

    def media_stream_uri(self, url: str, token: str) -> str:
        body = ("<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream>"
                "<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup>"
                f"<trt:ProfileToken>{_xml_escape(token)}</trt:ProfileToken></trt:GetStreamUri>")
        root = self.call(url, body, f"{NS['trt']}/GetStreamUri")
        return _text(root, "Uri")

    def media_snapshot_uri(self, url: str, token: str) -> str:
        body = f"<trt:GetSnapshotUri><trt:ProfileToken>{_xml_escape(token)}</trt:ProfileToken></trt:GetSnapshotUri>"
        root = self.call(url, body, f"{NS['trt']}/GetSnapshotUri")
        return _text(root, "Uri")

    # ---------------- 종합 조회 ----------------
    def probe(self) -> ProbeOutput:
        out = ProbeOutput()
        offset = self.sync_time()
        out.time_offset_seconds = round(offset, 1) if offset is not None else None
        if offset is None:
            out.warnings.append("카메라 시각을 조회하지 못했습니다(시간 오차 보정 없이 진행).")
        elif abs(offset) > 5:
            out.warnings.append(
                f"카메라 시계가 서버와 {offset:+.0f}초 차이 납니다. WS-Security 인증 실패 원인이 될 수 있어 보정해 요청했습니다. "
                "카메라에 NTP 설정을 권장합니다(녹화 시각은 서버 시계를 사용)."
            )
        out.device = self.get_device_information()
        try:
            services = self.get_services()
        except OnvifError as exc:
            if exc.code == "auth_failed":
                raise
            services = self.get_capabilities_xaddrs()
            out.warnings.append("GetServices 미지원 — GetCapabilities로 서비스 주소를 조회했습니다.")
        out.services = services
        caps = {
            "media2": NS["tr2"] in services,
            "media1": NS["trt"] in services,
            "ptz": NS_PTZ in services,
            "events": NS_EVENTS in services,
            "imaging": NS_IMAGING in services,
            "analytics": NS_ANALYTICS in services,
            "recording_profile_g": NS_RECORDING in services and NS_SEARCH in services and NS_REPLAY in services,
        }
        out.capabilities = caps
        profiles: list[dict[str, Any]] = []
        if caps["media2"]:
            try:
                m2 = self.safe_service_url(services[NS["tr2"]])
                profiles = self.media2_profiles(m2)
                for p in profiles:
                    p["stream_uri"], p["snapshot_uri"], p["uri_error"] = self._uris(m2, p["token"], media2=True)
                out.media2 = True
            except OnvifError as exc:
                if exc.code == "auth_failed":
                    raise
                out.warnings.append(f"Media2 조회 실패({exc.message}) — Media(ver10)로 다시 시도합니다.")
                profiles = []
        if not profiles and caps["media1"]:
            m1 = self.safe_service_url(services[NS["trt"]])
            profiles = self.media_profiles(m1)
            for p in profiles:
                p["stream_uri"], p["snapshot_uri"], p["uri_error"] = self._uris(m1, p["token"], media2=False)
        if not profiles:
            out.warnings.append("영상 프로파일이 없습니다. RTSP 수동 등록을 사용하세요.")
        out.profiles = profiles
        out.warnings.extend(w for w in self.warnings if w not in out.warnings)
        return out

    def _uris(self, url: str, token: str, media2: bool) -> tuple[str, str, str]:
        stream, snap, err = "", "", ""
        try:
            raw = self.media2_stream_uri(url, token) if media2 else self.media_stream_uri(url, token)
            stream = self.safe_media_uri(raw, {"rtsp", "rtsps"}) if raw else ""
        except (OnvifError, TargetDenied) as exc:
            if isinstance(exc, OnvifError) and exc.code == "auth_failed":
                raise
            err = getattr(exc, "message", str(exc))
        try:
            raw = self.media2_snapshot_uri(url, token) if media2 else self.media_snapshot_uri(url, token)
            snap = self.safe_media_uri(raw, {"http", "https"}) if raw else ""
        except (OnvifError, TargetDenied):
            snap = ""
        return stream, snap, err


def _xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))


def _int(s: str) -> int | None:
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _float(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def fetch_snapshot(url: str, username: str, password: str, allowed_networks: list[str],
                   tls_insecure: bool = False, timeout: float = 8.0) -> tuple[bytes | None, str, str]:
    """HTTP(S) 스냅샷 가져오기(Digest/Basic). (jpeg, error_code, message)"""
    try:
        checked = check_url(url, allowed_networks, schemes={"http", "https"})
    except TargetDenied as exc:
        return None, exc.code, exc.message
    current = checked.url if checked.scheme == "http" else url
    with httpx.Client(timeout=timeout, follow_redirects=False, verify=not tls_insecure, trust_env=False) as c:
        auth = None
        for _ in range(4):
            try:
                r = c.get(current, auth=auth)
            except httpx.TimeoutException:
                return None, "timeout", "스냅샷 응답 시간 초과"
            except httpx.HTTPError as exc:
                return None, "unreachable", f"스냅샷 연결 실패: {exc}"
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                try:
                    nxt = check_url(urljoin(current, r.headers["location"]), allowed_networks, schemes={"http", "https"})
                except TargetDenied:
                    return None, "redirect_blocked", "허용망 밖으로의 리다이렉트를 차단했습니다."
                current = nxt.url
                continue
            if r.status_code == 401 and auth is None and username:
                scheme = r.headers.get("www-authenticate", "").split(" ", 1)[0].lower()
                auth = httpx.DigestAuth(username, password) if scheme == "digest" else httpx.BasicAuth(username, password)
                continue
            if r.status_code == 401:
                return None, "auth_failed", "스냅샷 인증 실패"
            if r.status_code >= 400:
                return None, "http_error", f"스냅샷 HTTP {r.status_code}"
            ctype = r.headers.get("content-type", "")
            if "image" not in ctype or len(r.content) > 10 * 1024 * 1024:
                return None, "bad_snapshot", f"이미지가 아닌 응답({ctype[:40]})"
            return r.content, "", ""
    return None, "redirect_loop", "리다이렉트가 너무 많습니다."
