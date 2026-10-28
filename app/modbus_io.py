"""Modbus TCP 통신.

같은 IP:포트(예: 통신변환장치 하나에 Unit ID 여러 개)를 쓰는 터널은 연결 하나를 공유한다.
읽기는 태그 맵에서 주소 구간을 묶어 한 번에 읽고(블록 읽기), 쓰기는 태그 단위로 한다.
"""
import asyncio
import logging

from pymodbus.client import AsyncModbusTcpClient

from .tagmap import FC

log = logging.getLogger("modbus")
MAX_BITS, MAX_REGS, MAX_GAP = 1000, 100, 10


class Link:
    def __init__(self, host, port):
        self.host, self.port = host, port
        self.client = None          # 이벤트 루프 안에서 생성
        self.lock = None

    async def ensure(self):
        if self.client is None:
            self.client = AsyncModbusTcpClient(self.host, port=self.port, timeout=2, retries=1)
        if not self.client.connected:
            await self.client.connect()
        return self.client.connected


    def get_lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock


_links = {}


def link_for(host, port):
    k = (host, port)
    if k not in _links:
        _links[k] = Link(host, port)
    return _links[k]


def plan_blocks(tags):
    """fc별로 읽을 (시작, 개수) 구간 목록."""
    by = {}
    for t in tags:
        fc = FC[t["type"]]
        n = 2 if t["dtype"] == "uint32" else 1
        by.setdefault(fc, []).append((t["addr"], t["addr"] + n - 1))
    plan = {}
    for fc, rs in by.items():
        rs.sort()
        lim = MAX_BITS if fc in (1, 2) else MAX_REGS
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


class Device:
    """터널 하나의 RTU."""

    def __init__(self, host, port, unit, tags):
        self.link, self.unit = link_for(host, port), unit
        self.set_tags(tags)

    def set_tags(self, tags):
        self.tags = {t["tag"]: t for t in tags}
        self.plan = plan_blocks(tags)

    async def read_all(self):
        """모든 태그 값을 읽어 {태그: 값}. 실패 시 예외."""
        raw = {}
        async with self.link.get_lock():
            if not await self.link.ensure():
                raise ConnectionError("연결 실패 %s:%d" % (self.link.host, self.link.port))
            c = self.link.client
            for fc, blocks in self.plan.items():
                for s, n in blocks:
                    if fc == 1:
                        rr = await c.read_coils(s, n, slave=self.unit)
                    elif fc == 2:
                        rr = await c.read_discrete_inputs(s, n, slave=self.unit)
                    elif fc == 3:
                        rr = await c.read_holding_registers(s, n, slave=self.unit)
                    else:
                        rr = await c.read_input_registers(s, n, slave=self.unit)
                    if rr.isError():
                        raise IOError("FC%d %d+%d 읽기 오류: %s" % (fc, s, n, rr))
                    vals = rr.bits[:n] if fc in (1, 2) else rr.registers
                    for i, v in enumerate(vals):
                        raw[(fc, s + i)] = v
        out = {}
        for name, t in self.tags.items():
            fc, a = FC[t["type"]], t["addr"]
            if t["dtype"] == "bool":
                out[name] = bool(raw.get((fc, a), 0))
            elif t["dtype"] == "uint32":
                out[name] = ((raw.get((fc, a), 0) << 16) | raw.get((fc, a + 1), 0)) * t["scale"]
            else:
                v = raw.get((fc, a), 0)
                out[name] = (v - 65536 if v > 32767 else v) * t["scale"]
        return out

    async def write(self, tag, value):
        t = self.tags.get(tag)
        if not t:
            raise KeyError("관제점 맵에 '%s' 태그가 없습니다" % tag)
        async with self.link.get_lock():
            if not await self.link.ensure():
                raise ConnectionError("연결 실패")
            c = self.link.client
            if t["type"] == "DO":
                rr = await c.write_coil(t["addr"], bool(value), slave=self.unit)
            elif t["type"] in ("AO", "PI"):
                raw = int(round(value / t["scale"]))
                rr = await c.write_register(t["addr"], raw & 0xFFFF, slave=self.unit)
            else:
                raise ValueError("%s(%s)는 쓰기할 수 없는 구분입니다" % (tag, t["type"]))
            if rr.isError():
                raise IOError("쓰기 오류 %s: %s" % (tag, rr))
