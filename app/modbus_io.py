"""Modbus TCP 통신.

같은 IP:포트(예: 통신변환장치 하나에 Unit ID 여러 개)를 쓰는 터널은 연결 하나를 공유한다.
읽기는 태그 맵에서 주소 구간을 묶어 한 번에 읽고(블록 읽기), 쓰기는 태그 단위로 한다.

제조사마다 다른 값은 opt 로 받는다 (설비 설정 › 통신·제조사 설정).
  word_order : 32비트 값의 워드 순서. "high" = 상위 워드 먼저(Siemens 등), "low" = 하위 워드 먼저(LS·미쓰비시 등)
  addr_offset: 모든 주소에 더할 값. 제조사 주소표가 1부터 시작하면 -1
  timeout    : 응답 대기 (초)
  block      : 한 번에 읽을 최대 레지스터 수 (일부 PLC는 64 이하만 허용)
  transport  : tcp (Modbus TCP) / rtu_tcp, ascii_tcp (통신변환장치 투명 모드) / rtu_serial, ascii_serial (직렬 포트)
  serial     : 직렬일 때 {"baud": 9600, "parity": "N", "stopbits": 1, "bytesize": 8}, host 자리에 포트 이름 (COM3, /dev/ttyUSB0)
"""
import asyncio
import logging

from pymodbus import Framer
from pymodbus.client import AsyncModbusSerialClient, AsyncModbusTcpClient

from .tagmap import FC

log = logging.getLogger("modbus")
MAX_BITS, MAX_GAP = 1000, 10
DEFAULT_OPT = {"word_order": "high", "addr_offset": 0, "timeout": 2.0, "block": 100, "transport": "tcp",
               "baud": 9600, "parity": "N", "stopbits": 1, "bytesize": 8}
FRAMERS = {"tcp": Framer.SOCKET, "rtu_tcp": Framer.RTU, "ascii_tcp": Framer.ASCII, "rtu_serial": Framer.RTU, "ascii_serial": Framer.ASCII}


class Link:
    def __init__(self, host, port, timeout=2.0, transport="tcp", serial=None):
        self.host, self.port, self.timeout, self.transport, self.serial = host, port, timeout, transport, serial or {}
        self.client = None          # 이벤트 루프 안에서 생성
        self.lock = None

    async def ensure(self):
        if self.client is None:
            fr = FRAMERS.get(self.transport, Framer.SOCKET)
            if self.transport.endswith("_serial"):
                sp = self.serial
                self.client = AsyncModbusSerialClient(self.host, framer=fr, baudrate=int(sp.get("baud", 9600)),
                                                      bytesize=int(sp.get("bytesize", 8)), parity=sp.get("parity", "N"),
                                                      stopbits=int(sp.get("stopbits", 1)), timeout=self.timeout, retries=1)
            else:
                self.client = AsyncModbusTcpClient(self.host, port=self.port, framer=fr, timeout=self.timeout, retries=1)
        if not self.client.connected:
            await self.client.connect()
        return self.client.connected

    def get_lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock

    def close(self):
        if self.client:
            self.client.close()


_links = {}


def link_for(host, port, timeout=2.0, transport="tcp", serial=None):
    sp = tuple(sorted((serial or {}).items())) if transport.endswith("_serial") else ()
    k = (host, int(port), float(timeout), transport, sp)
    if k not in _links:
        _links[k] = Link(host, int(port), float(timeout), transport, dict(sp))
    return _links[k]


def plan_blocks(tags, max_regs=100, offset=0):
    """fc별로 읽을 (시작, 개수) 구간 목록."""
    by = {}
    for t in tags:
        fc = FC[t["type"]]
        n = 2 if t["dtype"] == "uint32" else 1
        a = t["addr"] + offset
        by.setdefault(fc, []).append((a, a + n - 1))
    plan = {}
    for fc, rs in by.items():
        rs.sort()
        lim = MAX_BITS if fc in (1, 2) else max(1, int(max_regs))
        blocks, (s, e) = [], rs[0]
        for a, b in rs[1:]:
            if a - e <= MAX_GAP and b - s + 1 <= lim:
                e = max(e, b)
            else:
                blocks.append((s, e - s + 1))
                s, e = a, b
        blocks.append((s, e - s + 1))
        plan[fc] = blocks
    return plan


def join32(hi_first, w0, w1):
    return ((w0 << 16) | w1) if hi_first else ((w1 << 16) | w0)


async def read_fc(c, fc, s, n, unit):
    if fc == 1:
        rr = await c.read_coils(s, n, slave=unit)
    elif fc == 2:
        rr = await c.read_discrete_inputs(s, n, slave=unit)
    elif fc == 3:
        rr = await c.read_holding_registers(s, n, slave=unit)
    else:
        rr = await c.read_input_registers(s, n, slave=unit)
    if rr.isError():
        raise IOError("FC%d %d+%d 읽기 오류: %s" % (fc, s, n, rr))
    return rr.bits[:n] if fc in (1, 2) else rr.registers


class Device:
    """터널 하나의 RTU."""

    def __init__(self, host, port, unit, tags, opt=None):
        self.opt = dict(DEFAULT_OPT, **(opt or {}))
        o = self.opt
        self.link = link_for(host, port, o["timeout"], o["transport"],
                             {k: o[k] for k in ("baud", "parity", "stopbits", "bytesize")})
        self.unit = unit
        self.set_tags(tags)

    def set_tags(self, tags):
        self.tags = {t["tag"]: t for t in tags}
        self.plan = plan_blocks(tags, self.opt["block"], int(self.opt["addr_offset"]))

    async def read_all(self):
        """모든 태그 값을 읽어 {태그: 값}. 실패 시 예외."""
        raw, off = {}, int(self.opt["addr_offset"])
        hi = self.opt["word_order"] != "low"
        async with self.link.get_lock():
            if not await self.link.ensure():
                raise ConnectionError("연결 실패 %s:%d" % (self.link.host, self.link.port))
            c = self.link.client
            for fc, blocks in self.plan.items():
                for s, n in blocks:
                    for i, v in enumerate(await read_fc(c, fc, s, n, self.unit)):
                        raw[(fc, s + i)] = v
        out = {}
        for name, t in self.tags.items():
            fc, a = FC[t["type"]], t["addr"] + off
            if t["dtype"] == "bool":
                out[name] = bool(raw.get((fc, a), 0))
            elif t["dtype"] == "uint32":
                out[name] = join32(hi, raw.get((fc, a), 0), raw.get((fc, a + 1), 0)) * t["scale"]
            else:
                v = raw.get((fc, a), 0)
                out[name] = (v - 65536 if v > 32767 else v) * t["scale"]
        return out

    def close(self):
        pass                      # 연결은 같은 주소의 다른 터널과 공유하므로 닫지 않음

    async def write(self, tag, value):
        t = self.tags.get(tag)
        if not t:
            raise KeyError("관제점 맵에 '%s' 태그가 없습니다" % tag)
        a = t["addr"] + int(self.opt["addr_offset"])
        async with self.link.get_lock():
            if not await self.link.ensure():
                raise ConnectionError("연결 실패")
            c = self.link.client
            if t["type"] == "DO":
                rr = await c.write_coil(a, bool(value), slave=self.unit)
            elif t["type"] in ("AO", "PI"):
                raw = int(round(value / t["scale"]))
                rr = await c.write_register(a, raw & 0xFFFF, slave=self.unit)
            else:
                raise ValueError("%s(%s)는 쓰기할 수 없는 구분입니다" % (tag, t["type"]))
            if rr.isError():
                raise IOError("쓰기 오류 %s: %s" % (tag, rr))
