"""ONVIF 확장: PTZ(ver20), 이벤트 PullPoint(ver10 events), Profile G 검색·재생 URI(ver10 search/replay).

모든 요청은 OnvifClient.call 을 거치며, 장치가 알려준 서비스·구독 주소는 허용망 검사를 통과해야 한다.
요청 구조는 ONVIF 공식 WSDL(ptz ver20, events ver10, search ver10, replay ver10)을 따른다.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

from ..models import Camera
from ..security.crypto import decrypt_secret
from .client import NS_EVENTS, NS_PTZ, NS_REPLAY, NS_SEARCH, OnvifClient, OnvifError, OnvifTarget, _local, _text, _xml_escape

TPTZ = NS_PTZ
TEV = NS_EVENTS
WSNT = "http://docs.oasis-open.org/wsn/b-2"
TSE = NS_SEARCH
TRP = NS_REPLAY


def client_for(cam: Camera, timeout: float = 8.0) -> OnvifClient:
    if cam.connection_type != "onvif" or not cam.onvif_port:
        raise OnvifError("not_onvif", "ONVIF 로 등록된 카메라가 아닙니다.")
    return OnvifClient(OnvifTarget(
        scheme=cam.onvif_scheme, host=cam.host, port=cam.onvif_port, device_path=cam.onvif_device_path,
        username=cam.username, password=decrypt_secret(cam.password_enc),
        allowed_networks=[str(n) for n in cam.site.allowed_networks], tls_insecure=cam.tls_insecure, timeout=timeout))


class Session:
    """한 카메라에 대한 ONVIF 세션(시간 보정 + 서비스 주소 확보)."""

    def __init__(self, cam: Camera, timeout: float = 8.0):
        self.cam = cam
        self.c = client_for(cam, timeout)
        self.c.sync_time()
        try:
            self.services = self.c.get_services()
        except OnvifError as exc:
            if exc.code == "auth_failed":
                raise
            self.services = self.c.get_capabilities_xaddrs()

    def close(self) -> None:
        self.c.close()

    def __enter__(self) -> Session:
        return self

    def __exit__(self, *a) -> None:
        self.close()

    def url(self, ns: str, what: str) -> str:
        x = self.services.get(ns)
        if not x:
            raise OnvifError("not_supported", f"장치가 {what} 서비스를 제공하지 않습니다.")
        return self.c.safe_service_url(x)

    # ------------------------------------------------------------------ PTZ
    def _profile(self) -> str:
        tok = self.cam.main_profile_token or self.cam.sub_profile_token
        if not tok:
            raise OnvifError("no_profile", "PTZ 제어에 필요한 영상 프로파일 토큰이 없습니다. ONVIF 조회로 다시 등록하세요.")
        return _xml_escape(tok)

    def ptz_move(self, pan: float, tilt: float, zoom: float, timeout_s: float = 1.0) -> None:
        clamp = lambda v: max(-1.0, min(1.0, float(v)))  # noqa: E731
        body = (f'<tptz:ContinuousMove xmlns:tptz="{TPTZ}"><tptz:ProfileToken>{self._profile()}</tptz:ProfileToken>'
                f'<tptz:Velocity><tt:PanTilt x="{clamp(pan):.3f}" y="{clamp(tilt):.3f}"/><tt:Zoom x="{clamp(zoom):.3f}"/></tptz:Velocity>'
                f'<tptz:Timeout>PT{max(0.2, min(10.0, timeout_s)):.1f}S</tptz:Timeout></tptz:ContinuousMove>')
        self.c.call(self.url(TPTZ, "PTZ"), body, f"{TPTZ}/ContinuousMove")

    def ptz_stop(self) -> None:
        body = (f'<tptz:Stop xmlns:tptz="{TPTZ}"><tptz:ProfileToken>{self._profile()}</tptz:ProfileToken>'
                f'<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>')
        self.c.call(self.url(TPTZ, "PTZ"), body, f"{TPTZ}/Stop")

    def ptz_presets(self) -> list[dict[str, str]]:
        body = f'<tptz:GetPresets xmlns:tptz="{TPTZ}"><tptz:ProfileToken>{self._profile()}</tptz:ProfileToken></tptz:GetPresets>'
        root = self.c.call(self.url(TPTZ, "PTZ"), body, f"{TPTZ}/GetPresets")
        out = []
        for p in root.xpath(".//*[local-name()='Preset']"):
            out.append({"token": p.get("token") or "", "name": _text(p, "Name") or (p.get("token") or "")})
        return out

    def ptz_goto(self, preset: str) -> None:
        body = (f'<tptz:GotoPreset xmlns:tptz="{TPTZ}"><tptz:ProfileToken>{self._profile()}</tptz:ProfileToken>'
                f'<tptz:PresetToken>{_xml_escape(preset)}</tptz:PresetToken></tptz:GotoPreset>')
        self.c.call(self.url(TPTZ, "PTZ"), body, f"{TPTZ}/GotoPreset")

    def ptz_set_preset(self, name: str) -> str:
        body = (f'<tptz:SetPreset xmlns:tptz="{TPTZ}"><tptz:ProfileToken>{self._profile()}</tptz:ProfileToken>'
                f'<tptz:PresetName>{_xml_escape(name)}</tptz:PresetName></tptz:SetPreset>')
        root = self.c.call(self.url(TPTZ, "PTZ"), body, f"{TPTZ}/SetPreset")
        return _text(root, "PresetToken")

    def ptz_status(self) -> dict[str, Any]:
        body = f'<tptz:GetStatus xmlns:tptz="{TPTZ}"><tptz:ProfileToken>{self._profile()}</tptz:ProfileToken></tptz:GetStatus>'
        root = self.c.call(self.url(TPTZ, "PTZ"), body, f"{TPTZ}/GetStatus")
        pt = root.xpath(".//*[local-name()='Position']/*[local-name()='PanTilt']")
        zm = root.xpath(".//*[local-name()='Position']/*[local-name()='Zoom']")
        return {"pan": _f(pt[0].get("x")) if pt else None, "tilt": _f(pt[0].get("y")) if pt else None,
                "zoom": _f(zm[0].get("x")) if zm else None}

    # ------------------------------------------------------------ Events
    def create_pullpoint(self, seconds: int = 60) -> tuple[str, str]:
        """(구독 주소 원문, 연결용 검사된 주소)"""
        body = (f'<tev:CreatePullPointSubscription xmlns:tev="{TEV}">'
                f'<tev:InitialTerminationTime>PT{seconds}S</tev:InitialTerminationTime></tev:CreatePullPointSubscription>')
        url = self.url(TEV, "이벤트")
        root = self.c.call(url, body, f"{TEV}/EventPortType/CreatePullPointSubscriptionRequest")
        addr = _text(root, "Address")
        if not addr:
            raise OnvifError("bad_response", "이벤트 구독 주소를 받지 못했습니다.")
        return addr, self.c.safe_service_url(addr)

    def pull(self, sub_raw: str, sub_url: str, timeout_s: int = 5, limit: int = 50) -> list[dict[str, Any]]:
        body = (f'<tev:PullMessages xmlns:tev="{TEV}"><tev:Timeout>PT{timeout_s}S</tev:Timeout>'
                f'<tev:MessageLimit>{limit}</tev:MessageLimit></tev:PullMessages>')
        root = self.c.call(sub_url, body, f"{TEV}/PullPointSubscription/PullMessagesRequest", wsa_to=sub_raw)
        return [parse_notification(n) for n in root.xpath(".//*[local-name()='NotificationMessage']")]

    def renew(self, sub_raw: str, sub_url: str, seconds: int = 60) -> None:
        body = f'<wsnt:Renew xmlns:wsnt="{WSNT}"><wsnt:TerminationTime>PT{seconds}S</wsnt:TerminationTime></wsnt:Renew>'
        self.c.call(sub_url, body, f"{WSNT}/SubscriptionManager/RenewRequest", wsa_to=sub_raw)

    def unsubscribe(self, sub_raw: str, sub_url: str) -> None:
        self.c.call(sub_url, f'<wsnt:Unsubscribe xmlns:wsnt="{WSNT}"/>', f"{WSNT}/SubscriptionManager/UnsubscribeRequest",
                    wsa_to=sub_raw)

    # ---------------------------------------------------- Profile G 검색
    def recordings(self, max_results: int = 50) -> list[dict[str, Any]]:
        url = self.url(TSE, "녹화 검색(Profile G)")
        body = (f'<tse:FindRecordings xmlns:tse="{TSE}"><tse:Scope/><tse:MaxMatches>{max_results}</tse:MaxMatches>'
                f'<tse:KeepAliveTime>PT10S</tse:KeepAliveTime></tse:FindRecordings>')
        token = _text(self.c.call(url, body, f"{TSE}/FindRecordings"), "SearchToken")
        body = (f'<tse:GetRecordingSearchResults xmlns:tse="{TSE}"><tse:SearchToken>{_xml_escape(token)}</tse:SearchToken>'
                f'<tse:MinResults>1</tse:MinResults><tse:MaxResults>{max_results}</tse:MaxResults>'
                f'<tse:WaitTime>PT5S</tse:WaitTime></tse:GetRecordingSearchResults>')
        root = self.c.call(url, body, f"{TSE}/GetRecordingSearchResults")
        out = []
        for r in root.xpath(".//*[local-name()='RecordingInformation']"):
            out.append({
                "token": _text(r, "RecordingToken"),
                "source": _text(r, "Name"),
                "earliest": _text(r, "EarliestRecording"),
                "latest": _text(r, "LatestRecording"),
                "status": _text(r, "RecordingStatus"),
                "content": _text(r, "Content"),
            })
        return out

    def replay_uri(self, recording_token: str) -> str:
        url = self.url(TRP, "녹화 재생(Profile G)")
        body = (f'<trp:GetReplayUri xmlns:trp="{TRP}"><trp:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream>'
                f'<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trp:StreamSetup>'
                f'<trp:RecordingToken>{_xml_escape(recording_token)}</trp:RecordingToken></trp:GetReplayUri>')
        raw = _text(self.c.call(url, body, f"{TRP}/GetReplayUri"), "Uri")
        return self.c.safe_media_uri(raw, {"rtsp", "rtsps"}) if raw else ""


def _f(v: str | None) -> float | None:
    try:
        return round(float(v), 4) if v is not None else None
    except ValueError:
        return None


# ---------------------------------------------------------------- 이벤트 해석
TOPIC_RULES = [
    ("tamper", ("tamper", "imagetooblurry", "imagetoodark", "imagetoobright", "globalscenechange")),
    ("input", ("digitalinput", "logicalstate", "relay")),
    ("analytics", ("linedetector", "fielddetector", "objectdetection", "humandetect", "vehicledetect", "linecross",
                   "intrusion", "loitering")),
    ("motion", ("motion",)),
]
STATE_KEYS = ("ismotion", "state", "logicalstate", "istamper", "istoo", "value", "active", "objectsinside", "triggered")


def classify_topic(topic: str) -> str:
    t = topic.lower().replace("/", "")
    for kind, keys in TOPIC_RULES:
        if any(k in t for k in keys):
            return kind
    return "other"


@dataclass
class Notice:
    topic: str
    kind: str
    utc: dt.datetime | None
    operation: str
    source: dict[str, str] = field(default_factory=dict)
    data: dict[str, str] = field(default_factory=dict)

    @property
    def active(self) -> bool | None:
        for k, v in self.data.items():
            if k.lower() in STATE_KEYS or any(k.lower().startswith(s) for s in STATE_KEYS):
                return v.strip().lower() in ("true", "1", "on", "active")
        return None


def parse_notification(n) -> dict[str, Any]:
    topic_el = _local(n, "Topic")
    topic = (topic_el.text or "").strip() if topic_el is not None else ""
    msg = n.xpath(".//*[local-name()='Message']/*[local-name()='Message']")
    m = msg[0] if msg else n
    utc = None
    raw_t = m.get("UtcTime") if isinstance(m.tag, str) else None
    if raw_t:
        try:
            utc = dt.datetime.fromisoformat(raw_t.replace("Z", "+00:00"))
        except ValueError:
            utc = None

    def items(section: str) -> dict[str, str]:
        out = {}
        for it in m.xpath(f".//*[local-name()='{section}']//*[local-name()='SimpleItem']"):
            out[it.get("Name") or ""] = it.get("Value") or ""
        return out

    nt = Notice(topic=topic, kind=classify_topic(topic), utc=utc,
                operation=(m.get("PropertyOperation") or "") if isinstance(m.tag, str) else "",
                source=items("Source"), data=items("Data"))
    return {"topic": nt.topic, "kind": nt.kind, "utc": nt.utc, "operation": nt.operation, "source": nt.source,
            "data": nt.data, "active": nt.active}

