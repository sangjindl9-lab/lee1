"""SSRF 방지: 카메라 연결 목적지 검사.

규칙
1) 호스트를 DNS 로 해석한 모든 주소가 현장 허용망(CIDR) 안에 있어야 한다.
2) 루프백, 링크로컬(169.254.0.0/16 — 클라우드 메타데이터 포함), 멀티캐스트, 미지정/예약 주소,
   NVR 내부 Docker 망(NVR_DENY_NETWORKS)은 허용망에 포함돼 있어도 항상 차단한다.
3) 호출자는 반환된 IP 로 연결해 DNS 재해석(리바인딩) 우회를 막는다.
"""
from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from ..config import get_settings

_ALWAYS_DENY = [
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "224.0.0.0/4",
        "240.0.0.0/4",
        "255.255.255.255/32",
        "100.100.100.200/32",  # 일부 클라우드 메타데이터
        "::/128",
        "::1/128",
        "fe80::/10",
        "ff00::/8",
        "fd00:ec2::254/128",
    )
]

ALLOWED_SCHEMES = {"rtsp", "rtsps", "http", "https"}


class TargetDenied(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _extra_deny() -> list[ipaddress._BaseNetwork]:
    out = []
    for part in (get_settings().deny_networks or "").split(","):
        part = part.strip()
        if part:
            out.append(ipaddress.ip_network(part, strict=False))
    return out


def parse_networks(values: list[str]) -> list[ipaddress._BaseNetwork]:
    nets = []
    for v in values:
        nets.append(ipaddress.ip_network(str(v).strip(), strict=False))
    return nets


def validate_network_list(values: list[str]) -> list[str]:
    """현장 허용망 입력 검증. 너무 넓은 범위·항상 차단 범위는 거부."""
    out = []
    for v in values:
        try:
            net = ipaddress.ip_network(str(v).strip(), strict=False)
        except ValueError as exc:
            raise TargetDenied("bad_network", f"잘못된 네트워크 표기: {v}") from exc
        if net.prefixlen < (8 if net.version == 4 else 32):
            raise TargetDenied("network_too_wide", f"허용망이 너무 넓습니다: {net}")
        for d in _ALWAYS_DENY:
            if net.version == d.version and net.overlaps(d):
                raise TargetDenied("network_reserved", f"예약/차단 대역은 허용할 수 없습니다: {net}")
        out.append(str(net))
    return out


def _resolve(host: str) -> list[ipaddress._BaseAddress]:
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass
    if len(host) > 253 or not host or any(c.isspace() for c in host):
        raise TargetDenied("bad_host", "잘못된 호스트 이름입니다.")
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise TargetDenied("dns_failed", f"호스트 이름을 해석할 수 없습니다: {host}") from exc
    addrs = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip not in addrs:
            addrs.append(ip)
    if not addrs:
        raise TargetDenied("dns_failed", f"호스트 이름을 해석할 수 없습니다: {host}")
    return addrs


@dataclass
class CheckedTarget:
    host: str  # 원래 입력
    ip: str  # 연결에 사용할 고정 IP


def check_host(host: str, allowed_networks: list[str]) -> CheckedTarget:
    if not allowed_networks:
        raise TargetDenied(
            "no_allowed_networks", "이 현장에 허용 네트워크가 설정되지 않았습니다. 현장 관리에서 카메라 대역을 등록하세요."
        )
    allow = parse_networks(allowed_networks)
    deny = _ALWAYS_DENY + _extra_deny()
    addrs = _resolve(host.strip("[]"))
    for ip in addrs:
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        for d in deny:
            if ip.version == d.version and ip in d:
                raise TargetDenied("address_blocked", f"차단된 주소입니다: {ip}")
        if not any(ip.version == n.version and ip in n for n in allow):
            raise TargetDenied("address_not_allowed", f"현장 허용 네트워크 밖의 주소입니다: {ip}")
    return CheckedTarget(host=host, ip=str(addrs[0]))


def _fmt_host(ip: str) -> str:
    return f"[{ip}]" if ":" in ip else ip


@dataclass
class CheckedUrl:
    url: str  # 고정 IP로 바꾼 URL(인증정보 없음)
    original_host: str
    ip: str
    scheme: str
    port: int | None


def check_url(url: str, allowed_networks: list[str], schemes: set[str] | None = None) -> CheckedUrl:
    """URL 검증 후 호스트를 검사된 IP로 치환한 URL 반환. URL 내 인증정보는 거부."""
    if any(ord(c) < 0x21 or ord(c) == 0x7F for c in url):
        raise TargetDenied("bad_url", "URL에 공백이나 제어문자를 넣을 수 없습니다.")
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    allowed = schemes or ALLOWED_SCHEMES
    if scheme not in allowed:
        raise TargetDenied("bad_scheme", f"허용되지 않는 프로토콜입니다: {scheme or '(없음)'}")
    if parts.username or parts.password:
        raise TargetDenied("credentials_in_url", "URL에 계정·비밀번호를 넣지 말고 인증 항목에 입력하세요.")
    if not parts.hostname:
        raise TargetDenied("bad_url", "URL에 호스트가 없습니다.")
    try:
        port = parts.port
    except ValueError as exc:
        raise TargetDenied("bad_url", "포트 번호가 잘못되었습니다.") from exc
    target = check_host(parts.hostname, allowed_networks)
    netloc = _fmt_host(target.ip) + (f":{port}" if port else "")
    pinned = urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))
    return CheckedUrl(url=pinned, original_host=parts.hostname, ip=target.ip, scheme=scheme, port=port)


def strip_credentials(url: str) -> str:
    """장치가 돌려준 URL에 인증정보가 들어 있으면 제거."""
    parts = urlsplit(url)
    if parts.username or parts.password:
        host = parts.hostname or ""
        netloc = _fmt_host(host) + (f":{parts.port}" if parts.port else "")
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    return url
