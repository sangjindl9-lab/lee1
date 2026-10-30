"""ONVIF 장치 자동 탐색 (WS-Discovery Probe, UDP 멀티캐스트 239.255.255.250:3702).

- 같은 L2 망(브로드캐스트 도메인)의 장치만 찾을 수 있다. 라우터·VPN 너머 장치는 수동 등록.
- Docker bridge 네트워크 안에서는 현장망으로 멀티캐스트가 나가지 않으므로, 운영 구성에서는
  host 네트워크로 실행하는 discovery 서비스(nvr.discovery_service)를 거친다.
- 응답은 신뢰하지 않는 입력으로 다루며 화면 표시용으로만 쓴다(등록 시 허용망 검사를 다시 거침).
"""
from __future__ import annotations

import ipaddress
import re
import socket
import time
import uuid
from typing import Any
from urllib.parse import unquote, urlsplit

from lxml import etree

MCAST = ("239.255.255.250", 3702)
_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, load_dtd=False)

PROBE = """<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<s:Header><a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
<a:MessageID>urn:uuid:{mid}</a:MessageID><a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>
<a:To s:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To></s:Header>
<s:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></s:Body></s:Envelope>"""


def local_interfaces() -> list[dict[str, str]]:
    """IPv4 인터페이스 주소 목록(루프백 제외)."""
    out: list[dict[str, str]] = []
    try:
        import fcntl
        import struct

        names = [n for _, n in socket.if_nameindex()]
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        for n in names:
            try:
                raw = fcntl.ioctl(s.fileno(), 0x8915, struct.pack("256s", n[:15].encode()))  # SIOCGIFADDR
                ip = socket.inet_ntoa(raw[20:24])
            except OSError:
                continue
            if not ip.startswith("127."):
                out.append({"name": n, "ip": ip})
        s.close()
    except Exception:  # noqa: BLE001
        pass
    return out


def _scope_value(scopes: list[str], key: str) -> str:
    for sc in scopes:
        m = re.search(rf"onvif://www\.onvif\.org/{key}/(.+)$", sc)
        if m:
            return unquote(m.group(1)).replace("_", " ")[:100]
    return ""


def probe(interface_ip: str | None = None, timeout: float = 3.0) -> list[dict[str, Any]]:
    if interface_ip:
        ipaddress.ip_address(interface_ip)  # 형식 검사
        if interface_ip not in {i["ip"] for i in local_interfaces()}:
            raise ValueError("이 서버에 없는 인터페이스 주소입니다.")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)  # 라우터를 넘지 않음
    if interface_ip:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(interface_ip))
        sock.bind((interface_ip, 0))
    sock.settimeout(0.3)
    msg = PROBE.format(mid=uuid.uuid4()).encode()
    for _ in range(2):  # UDP 유실 대비 2회
        sock.sendto(msg, MCAST)
    found: dict[str, dict[str, Any]] = {}
    end = time.time() + timeout
    while time.time() < end:
        try:
            data, addr = sock.recvfrom(65535)
        except TimeoutError:
            continue
        except OSError:
            break
        try:
            root = etree.fromstring(data[:65535], parser=_PARSER)
        except etree.XMLSyntaxError:
            continue
        for pm in root.xpath(".//*[local-name()='ProbeMatch']"):
            xaddrs = " ".join(x.text or "" for x in pm.xpath(".//*[local-name()='XAddrs']")).split()
            scopes = " ".join(x.text or "" for x in pm.xpath(".//*[local-name()='Scopes']")).split()
            epr = " ".join(x.text or "" for x in pm.xpath(".//*[local-name()='Address']")).strip()[:200]
            for xa in xaddrs[:4]:
                p = urlsplit(xa)
                if p.scheme not in ("http", "https") or not p.hostname:
                    continue
                try:
                    port = p.port or (443 if p.scheme == "https" else 80)
                except ValueError:
                    continue
                key = f"{p.hostname}:{port}"
                found.setdefault(key, {
                    "host": p.hostname, "port": port, "scheme": p.scheme, "device_path": p.path or "/onvif/device_service",
                    "xaddr": xa[:300], "endpoint": epr, "responder": addr[0],
                    "name": _scope_value(scopes, "name"), "hardware": _scope_value(scopes, "hardware"),
                    "profiles": sorted({s.rsplit("/", 1)[-1] for s in scopes if "/Profile/" in s})[:6],
                })
    sock.close()
    return list(found.values())
