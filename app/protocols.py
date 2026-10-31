"""PLC 통신 프로토콜 드라이버.

모든 드라이버는 같은 모양으로 쓴다.
    drv.set_tags(tags)            관제점 목록 (태그마다 PLC 주소 'pa')
    await drv.read_all()  -> {태그: 값}
    await drv.write(태그, 값)
    drv.close()

PLC 주소 표기 (관제점 일람표의 'PLC 주소' 칸)
  modbus   : 일람표의 Modbus 주소 사용 (10001·00001·30001·40001)
  xgt      : LS XGT 전용(FEnet)   %MX1000  %MW100  %DW200  %PX0  (장치문자 + X비트/B바이트/W워드/D더블워드 + 번호)
  mc       : 미쓰비시 MC·SLMP 3E  M1000  X1F  Y20  B0  D100  W1A  R0  ZR0   (X·Y·B·W는 16진 번호)
  fins     : 오므론 FINS          D100  W100.05  H10.01  A0.00  CIO100.00  (점 뒤 비트 00~15)
  s7       : 지멘스 S7            DB10.DBX0.3  DB10.DBW2  DB10.DBD4  I0.0  Q0.1  M10.0  IW64  MW20  MD8
  opcua    : OPC UA NodeId        ns=3;s="DB_Tunnel"."JF01_FWD"   ns=2;s=JF-01.FWD   ns=2;i=1001
  eip      : EtherNet/IP          Logix·Micro800 태그 이름 (JF01_FWD, Tunnel.JF[1].Run)  /  MicroLogix·SLC  B3:0/1 N7:10 L9:0
"""
import asyncio
import re
import struct

from .modbus_io import Device as ModbusDevice

PROTOCOLS = {
    "modbus": "Modbus TCP / RTU / ASCII",
    "xgt": "LS XGT 전용 (FEnet)",
    "mc": "미쓰비시 MC 프로토콜 · SLMP (3E 바이너리)",
    "s7": "지멘스 S7 통신 (PUT/GET)",
    "opcua": "OPC UA",
    "fins": "오므론 FINS (TCP / UDP)",
    "eip": "EtherNet/IP (Allen-Bradley)",
}


def to_val(t, raw):
    if t["dtype"] == "bool":
        return bool(raw)
    if raw is None:
        return 0
    if isinstance(raw, float) and t["dtype"] != "float":
        return raw * t["scale"]
    if t["dtype"] == "int16":
        raw = int(raw) & 0xFFFF
        raw = raw - 65536 if raw > 32767 else raw
    return raw * t["scale"]


def to_raw(t, value):
    if t["dtype"] == "bool":
        return 1 if value else 0
    return int(round(value / t["scale"]))


def join32(word_order, lo_addr_word, hi_addr_word):
    """주소가 낮은 워드, 높은 워드 → 32비트. word_order 'low' = 낮은 주소가 하위 워드."""
    if word_order == "low":
        return (hi_addr_word << 16) | lo_addr_word
    return (lo_addr_word << 16) | hi_addr_word


def split32(word_order, v):
    v &= 0xFFFFFFFF
    hi, lo = v >> 16, v & 0xFFFF
    return (lo, hi) if word_order == "low" else (hi, lo)


def spans(items, gap, limit):
    """[(시작, 끝)] → 묶음 [(시작, 개수)]"""
    items = sorted(items)
    if not items:
        return []
    out, (s, e) = [], items[0]
    for a, b in items[1:]:
        if a - e <= gap and b - s + 1 <= limit:
            e = max(e, b)
        else:
            out.append((s, e - s + 1))
            s, e = a, b
    out.append((s, e - s + 1))
    return out


class AddrError(ValueError):
    pass


# ======================================================================
# 공통: TCP 스트림 연결
# ======================================================================
class Stream:
    def __init__(self, host, port, timeout):
        self.host, self.port, self.timeout = host, int(port), float(timeout)
        self.r = self.w = None
        self.lock = None

    def get_lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock

    async def ensure(self):
        if self.w is None or self.w.is_closing():
            self.r, self.w = await asyncio.wait_for(asyncio.open_connection(self.host, self.port), self.timeout)
            return True
        return False

    async def send(self, data):
        self.w.write(data)
        await self.w.drain()

    async def recv(self, n):
        return await asyncio.wait_for(self.r.readexactly(n), self.timeout)

    def close(self):
        if self.w:
            self.w.close()
        self.r = self.w = None


class BaseDriver:
    proto = "base"

    def __init__(self, cfg, tags):
        self.cfg = cfg
        self.wo = cfg.get("word_order", "high")
        self.timeout = float(cfg.get("timeout") or 2)
        self.set_tags(tags)

    def set_tags(self, tags):
        if any("pa" not in t for t in tags):
            tags = with_paddr(self.proto, tags, self.cfg)
        self.tags = {t["tag"]: t for t in tags}
        self.parsed = {}
        bad = []
        for t in tags:
            try:
                self.parsed[t["tag"]] = self.parse(t["pa"], t)
            except AddrError as e:
                bad.append("%s(%s): %s" % (t["tag"], t["pa"], e))
        self.bad = bad
        self.plan()

    def plan(self):
        pass

    def parse(self, pa, t):
        raise NotImplementedError

    def close(self):
        pass

    def check_bad(self):
        if self.bad:
            raise AddrError("PLC 주소 오류 %d건: %s" % (len(self.bad), " / ".join(self.bad[:3])))


# ======================================================================
# 미쓰비시 MC 프로토콜 · SLMP 3E 바이너리
# ======================================================================
MC_CODES = {"X": 0x9C, "Y": 0x9D, "M": 0x90, "L": 0x92, "F": 0x93, "B": 0xA0, "SM": 0x91, "SB": 0xA1,
            "D": 0xA8, "W": 0xB4, "R": 0xAF, "ZR": 0xB0, "SD": 0xA9, "SW": 0xB5, "TN": 0xC2, "CN": 0xC5}
MC_BIT = {"X", "Y", "M", "L", "F", "B", "SM", "SB"}
MC_HEX = {"X", "Y", "B", "W", "SB", "SW"}
MC_RE = re.compile(r"^(SM|SB|SD|SW|ZR|TN|CN|X|Y|M|L|F|B|D|W|R)([0-9A-F]+)$")


def mc_parse(pa):
    m = MC_RE.match(str(pa).strip().upper())
    if not m:
        raise AddrError("미쓰비시 디바이스 표기가 아닙니다 (예: M100, X1F, D200)")
    dev, num = m.group(1), m.group(2)
    try:
        n = int(num, 16) if dev in MC_HEX else int(num, 10)
    except ValueError:
        raise AddrError("번호가 잘못되었습니다")
    return dev, n, dev in MC_BIT


class McDriver(BaseDriver):
    proto = "mc"

    def __init__(self, cfg, tags):
        self.st = Stream(cfg["host"], cfg.get("port") or 5007, cfg.get("timeout") or 2)
        self.net, self.pc = int(cfg.get("mc_net") or 0), int(cfg.get("mc_pc") if cfg.get("mc_pc") not in (None, "") else 0xFF)
        super().__init__(cfg, tags)

    def parse(self, pa, t):
        dev, n, isbit = mc_parse(pa)
        if t["dtype"] == "bool" and not isbit:
            raise AddrError("비트 신호에는 비트 디바이스(M·X·Y·B 등)를 쓰세요")
        if t["dtype"] != "bool" and isbit:
            raise AddrError("값 신호에는 워드 디바이스(D·W·R 등)를 쓰세요")
        return dev, n, isbit

    def plan(self):
        by = {}
        for name, (dev, n, isbit) in self.parsed.items():
            w = 2 if self.tags[name]["dtype"] == "uint32" else 1
            by.setdefault((dev, isbit), []).append((n, n + w - 1))
        self.blocks = [(dev, isbit, s, c) for (dev, isbit), r in by.items() for s, c in spans(r, 16, 3584 if isbit else 960)]

    async def _req(self, cmd, sub, dev, start, count, data=b""):
        body = struct.pack("<HH", cmd, sub) + struct.pack("<I", start)[:3] + bytes([MC_CODES[dev]]) + struct.pack("<H", count) + data
        timer = max(1, int(self.timeout * 4))
        frame = b"\x50\x00" + bytes([self.net, self.pc]) + struct.pack("<HBH", 0x03FF, 0, len(body) + 2) + struct.pack("<H", timer) + body
        await self.st.send(frame)
        head = await self.st.recv(9)
        if head[:2] != b"\xD0\x00":
            raise IOError("MC 응답 형식이 아닙니다: %s" % head.hex(" "))
        n = struct.unpack("<H", head[7:9])[0]
        rest = await self.st.recv(n)
        end = struct.unpack("<H", rest[:2])[0]
        if end:
            raise IOError("PLC 오류 코드 0x%04X (MC 종료 코드)" % end)
        return rest[2:]

    async def read_all(self):
        self.check_bad()
        raw = {}
        async with self.st.get_lock():
            try:
                await self.st.ensure()
                for dev, isbit, s, c in self.blocks:
                    if isbit:
                        d = await self._req(0x0401, 0x0001, dev, s, c)
                        for i in range(c):
                            b = d[i // 2]
                            raw[(dev, s + i)] = (b >> 4) & 1 if i % 2 == 0 else b & 1
                    else:
                        d = await self._req(0x0401, 0x0000, dev, s, c)
                        for i in range(c):
                            raw[(dev, s + i)] = struct.unpack_from("<H", d, i * 2)[0]
            except Exception:
                self.st.close()
                raise
        out = {}
        for name, (dev, n, isbit) in self.parsed.items():
            t = self.tags[name]
            v = join32(self.wo, raw.get((dev, n), 0), raw.get((dev, n + 1), 0)) if t["dtype"] == "uint32" else raw.get((dev, n), 0)
            out[name] = to_val(t, v)
        return out

    async def write(self, tag, value):
        t = self.tags[tag]
        dev, n, isbit = self.parse(t["pa"], t)
        raw = to_raw(t, value)
        async with self.st.get_lock():
            try:
                await self.st.ensure()
                if isbit:
                    await self._req(0x1401, 0x0001, dev, n, 1, bytes([0x10 if raw else 0x00]))
                elif t["dtype"] == "uint32":
                    a, b = split32(self.wo, raw)
                    await self._req(0x1401, 0x0000, dev, n, 2, struct.pack("<HH", a, b))
                else:
                    await self._req(0x1401, 0x0000, dev, n, 1, struct.pack("<H", raw & 0xFFFF))
            except Exception:
                self.st.close()
                raise

    def close(self):
        self.st.close()


# ======================================================================
# LS ELECTRIC XGT 전용 프로토콜 (FEnet, TCP 2004)
# ======================================================================
XGT_RE = re.compile(r"^%([A-Z]{1,2})([XBWDL])(\d+)$")
XGT_SIZE = {"X": 0, "B": 1, "W": 2, "D": 4, "L": 8}


def xgt_parse(pa):
    m = XGT_RE.match(str(pa).strip().upper())
    if not m:
        raise AddrError("XGT 변수 표기가 아닙니다 (예: %MX100, %MW10, %DW200)")
    dev, size, n = m.group(1), m.group(2), int(m.group(3))
    return dev, size, n


class XgtDriver(BaseDriver):
    proto = "xgt"

    def __init__(self, cfg, tags):
        self.st = Stream(cfg["host"], cfg.get("port") or 2004, cfg.get("timeout") or 2)
        self.invoke = 0
        super().__init__(cfg, tags)

    def parse(self, pa, t):
        dev, size, n = xgt_parse(pa)
        if t["dtype"] == "bool" and size != "X":
            raise AddrError("비트 신호는 %?X 표기를 쓰세요")
        if t["dtype"] != "bool" and size == "X":
            raise AddrError("값 신호는 %?W 또는 %?D 표기를 쓰세요")
        if size == "X":
            return dev, size, n, n // 8, 1
        nb = XGT_SIZE[size] if not (size == "W" and t["dtype"] == "uint32") else 4
        return dev, size, n, n * XGT_SIZE[size], nb

    def plan(self):
        by = {}
        for name, (dev, size, n, b0, nb) in self.parsed.items():
            by.setdefault(dev, []).append((b0, b0 + nb - 1))
        self.blocks = [(dev, s, c) for dev, r in by.items() for s, c in spans(r, 32, 1400)]

    def _header(self, body_len):
        self.invoke = (self.invoke + 1) & 0xFFFF
        h = b"LSIS-XGT\x00\x00" + struct.pack("<H", 0) + bytes([0x00, 0x33]) + struct.pack("<HH", self.invoke, body_len) + b"\x00"
        return h + bytes([sum(h) & 0xFF])

    async def _req(self, body):
        await self.st.send(self._header(len(body)) + body)
        head = await self.st.recv(20)
        if head[:8] != b"LSIS-XGT":
            raise IOError("XGT 응답 형식이 아닙니다")
        n = struct.unpack_from("<H", head, 16)[0]
        rest = await self.st.recv(n)
        err = struct.unpack_from("<H", rest, 6)[0]
        if err:
            code = struct.unpack_from("<H", rest, 8)[0] if len(rest) >= 10 else 0
            raise IOError("PLC 오류 (XGT 에러 코드 0x%04X)" % code)
        return rest

    @staticmethod
    def _var(name):
        b = name.encode("ascii")
        return struct.pack("<H", len(b)) + b

    async def read_all(self):
        self.check_bad()
        mem = {}
        async with self.st.get_lock():
            try:
                await self.st.ensure()
                for dev, s, c in self.blocks:
                    body = struct.pack("<HHHH", 0x0054, 0x0014, 0, 1) + self._var("%%%sB%d" % (dev, s)) + struct.pack("<H", c)
                    rest = await self._req(body)
                    cnt = struct.unpack_from("<H", rest, 10)[0]
                    mem[(dev, s)] = rest[12:12 + cnt]
            except Exception:
                self.st.close()
                raise

        def byte_at(dev, i):
            for (d, s), data in mem.items():
                if d == dev and s <= i < s + len(data):
                    return data[i - s]
            return 0

        out = {}
        for name, (dev, size, n, b0, nb) in self.parsed.items():
            t = self.tags[name]
            if size == "X":
                v = (byte_at(dev, b0) >> (n % 8)) & 1
            else:
                bs = bytes(byte_at(dev, b0 + i) for i in range(nb))
                if nb == 4 and size == "W":          # 32비트를 워드 두 개로
                    v = join32(self.wo, struct.unpack_from("<H", bs, 0)[0], struct.unpack_from("<H", bs, 2)[0])
                else:
                    v = int.from_bytes(bs, "little")
            out[name] = to_val(t, v)
        return out

    async def write(self, tag, value):
        t = self.tags[tag]
        dev, size, n, b0, nb = self.parse(t["pa"], t)
        raw = to_raw(t, value)
        if size == "X":
            dt, data = 0x0000, bytes([1 if raw else 0])
        elif nb == 4 and size == "W":
            a, b = split32(self.wo, raw)
            dt, data = 0x0014, struct.pack("<HH", a, b)
        elif size == "D":
            dt, data = 0x0003, struct.pack("<I", raw & 0xFFFFFFFF)
        else:
            dt, data = 0x0002, struct.pack("<H", raw & 0xFFFF)
        name = t["pa"].strip().upper() if dt != 0x0014 else "%%%sB%d" % (dev, b0)
        body = struct.pack("<HHHH", 0x0058, dt, 0, 1) + self._var(name) + struct.pack("<H", len(data)) + data
        async with self.st.get_lock():
            try:
                await self.st.ensure()
                await self._req(body)
            except Exception:
                self.st.close()
                raise

    def close(self):
        self.st.close()


# ======================================================================
# 오므론 FINS (TCP 9600 / UDP 9600)
# ======================================================================
FINS_AREA = {"CIO": (0xB0, 0x30), "W": (0xB1, 0x31), "H": (0xB2, 0x32), "A": (0xB3, 0x33), "D": (0x82, 0x02)}
FINS_RE = re.compile(r"^(CIO|DM|WR|HR|AR|C|D|W|H|A)?(\d+)(?:\.(\d{1,2}))?$")


def fins_parse(pa):
    m = FINS_RE.match(str(pa).strip().upper())
    if not m:
        raise AddrError("FINS 표기가 아닙니다 (예: D100, W100.05, CIO0.00)")
    area = {"DM": "D", "WR": "W", "HR": "H", "AR": "A", "C": "CIO", None: "CIO"}.get(m.group(1), m.group(1))
    bit = int(m.group(3)) if m.group(3) is not None else None
    if bit is not None and bit > 15:
        raise AddrError("비트 번호는 00~15")
    return area, int(m.group(2)), bit


class FinsDriver(BaseDriver):
    proto = "fins"

    def __init__(self, cfg, tags):
        self.udp = cfg.get("fins_mode") == "udp"
        self.host, self.port = cfg["host"], int(cfg.get("port") or 9600)
        self.st = Stream(self.host, self.port, cfg.get("timeout") or 2)
        self.da1 = int(cfg.get("fins_plc_node") or 0)
        self.sa1 = int(cfg.get("fins_pc_node") or 0)
        self.sid, self.tr, self.lock = 0, None, None
        super().__init__(cfg, tags)

    def parse(self, pa, t):
        area, w, bit = fins_parse(pa)
        if t["dtype"] == "bool" and bit is None:
            raise AddrError("비트 신호는 W100.05 처럼 비트 번호를 붙이세요")
        if t["dtype"] != "bool" and bit is not None:
            raise AddrError("값 신호에는 비트 번호를 붙이지 않습니다")
        return area, w, bit

    def plan(self):
        by = {}
        for name, (area, w, bit) in self.parsed.items():
            n = 2 if self.tags[name]["dtype"] == "uint32" else 1
            by.setdefault(area, []).append((w, w + n - 1))
        self.blocks = [(a, s, c) for a, r in by.items() for s, c in spans(r, 16, 990)]

    def get_lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock

    async def _connect(self):
        if self.udp:
            if self.tr is None:
                loop = asyncio.get_running_loop()
                q = asyncio.Queue()

                class P(asyncio.DatagramProtocol):
                    def datagram_received(self, data, addr):
                        q.put_nowait(data)
                self.tr, _ = await loop.create_datagram_endpoint(P, remote_addr=(self.host, self.port))
                self.q = q
                if not self.da1:
                    self.da1 = int(self.host.split(".")[-1]) if self.host.count(".") == 3 else 0
            return
        if await self.st.ensure():
            await self.st.send(b"FINS" + struct.pack(">IIII", 12, 0, 0, self.sa1))
            r = await self.st.recv(24)
            if r[:4] != b"FINS" or struct.unpack_from(">I", r, 12)[0]:
                self.st.close()
                raise IOError("FINS/TCP 노드 주소 교환 실패")
            self.sa1 = struct.unpack_from(">I", r, 16)[0] & 0xFF
            self.da1 = struct.unpack_from(">I", r, 20)[0] & 0xFF

    async def _req(self, mrc, src, params):
        self.sid = (self.sid + 1) & 0xFF
        fins = bytes([0x80, 0x00, 0x02, 0x00, self.da1, 0x00, 0x00, self.sa1, 0x00, self.sid, mrc, src]) + params
        if self.udp:
            while not self.q.empty():
                self.q.get_nowait()
            self.tr.sendto(fins)
            resp = await asyncio.wait_for(self.q.get(), self.timeout)
        else:
            await self.st.send(b"FINS" + struct.pack(">III", 8 + len(fins), 2, 0) + fins)
            head = await self.st.recv(16)
            if head[:4] != b"FINS":
                raise IOError("FINS 응답 형식이 아닙니다")
            n = struct.unpack_from(">I", head, 4)[0] - 8
            resp = await self.st.recv(n)
        end = struct.unpack_from(">H", resp, 12)[0]
        if end & 0x7F3F:                     # 0x0040·0x0080 = PLC 고장 플래그(명령은 정상 처리), 0x8000 = 중계 오류
            raise IOError("PLC 오류 (FINS 종료 코드 0x%04X)" % end)
        return resp[14:]

    async def read_all(self):
        self.check_bad()
        words = {}
        async with self.get_lock():
            try:
                await self._connect()
                for area, s, c in self.blocks:
                    d = await self._req(0x01, 0x01, bytes([FINS_AREA[area][0]]) + struct.pack(">HBH", s, 0, c))
                    for i in range(c):
                        words[(area, s + i)] = struct.unpack_from(">H", d, i * 2)[0]
            except Exception:
                self._reset()
                raise
        out = {}
        for name, (area, w, bit) in self.parsed.items():
            t = self.tags[name]
            if bit is not None:
                v = (words.get((area, w), 0) >> bit) & 1
            elif t["dtype"] == "uint32":
                v = join32(self.wo, words.get((area, w), 0), words.get((area, w + 1), 0))
            else:
                v = words.get((area, w), 0)
            out[name] = to_val(t, v)
        return out

    async def write(self, tag, value):
        t = self.tags[tag]
        area, w, bit = self.parse(t["pa"], t)
        raw = to_raw(t, value)
        if bit is not None:
            p = bytes([FINS_AREA[area][1]]) + struct.pack(">HBH", w, bit, 1) + bytes([1 if raw else 0])
        elif t["dtype"] == "uint32":
            a, b = split32(self.wo, raw)
            p = bytes([FINS_AREA[area][0]]) + struct.pack(">HBHHH", w, 0, 2, a, b)
        else:
            p = bytes([FINS_AREA[area][0]]) + struct.pack(">HBHH", w, 0, 1, raw & 0xFFFF)
        async with self.get_lock():
            try:
                await self._connect()
                await self._req(0x01, 0x02, p)
            except Exception:
                self._reset()
                raise

    def _reset(self):
        if not self.udp:
            self.st.close()

    def close(self):
        self.st.close()
        if self.tr:
            self.tr.close()
            self.tr = None


# ======================================================================
# 지멘스 S7 (snap7, PUT/GET)
# ======================================================================
S7_DB = re.compile(r"^DB(\d+)\.DB([XBWD])(\d+)(?:\.([0-7]))?$")
S7_IO = re.compile(r"^([IEQAM])([BWD]?)(\d+)(?:\.([0-7]))?$")


def s7_parse(pa):
    s = str(pa).strip().upper().replace(" ", "")
    m = S7_DB.match(s)
    if m:
        area, db, size, b, bit = "DB", int(m.group(1)), m.group(2), int(m.group(3)), m.group(4)
    else:
        m = S7_IO.match(s)
        if not m:
            raise AddrError("S7 표기가 아닙니다 (예: DB10.DBX0.3, DB10.DBW2, I0.0, MW20)")
        area = {"I": "PE", "E": "PE", "Q": "PA", "A": "PA", "M": "MK"}[m.group(1)]
        db, size, b, bit = 0, m.group(2) or "X", int(m.group(3)), m.group(4)
    if size == "X" and bit is None:
        raise AddrError("비트 표기는 바이트.비트 (예: DB10.DBX0.3, I0.0)")
    if size != "X" and bit is not None:
        raise AddrError("바이트·워드 표기에는 비트를 붙이지 않습니다")
    return area, db, size, b, int(bit) if bit is not None else None


class S7Driver(BaseDriver):
    proto = "s7"

    def __init__(self, cfg, tags):
        self.host, self.port = cfg["host"], int(cfg.get("port") or 102)
        self.rack, self.slot = int(cfg.get("s7_rack") or 0), int(cfg.get("s7_slot") if cfg.get("s7_slot") not in (None, "") else 1)
        self.cli, self.lock = None, None
        super().__init__(cfg, tags)

    def parse(self, pa, t):
        area, db, size, b, bit = s7_parse(pa)
        if (t["dtype"] == "bool") != (size == "X"):
            raise AddrError("비트 신호는 X(비트) 표기, 값 신호는 W·D 표기를 쓰세요")
        n = {"X": 1, "B": 1, "W": 2, "D": 4}[size]
        return area, db, size, b, bit, n

    def plan(self):
        by = {}
        for name, (area, db, size, b, bit, n) in self.parsed.items():
            by.setdefault((area, db), []).append((b, b + n - 1))
        self.blocks = [(area, db, s, c) for (area, db), r in by.items() for s, c in spans(r, 16, 400)]

    def get_lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock

    def _conn(self):
        import snap7
        if self.cli is None or not self.cli.get_connected():
            c = snap7.client.Client()
            c.connect(self.host, self.rack, self.slot, self.port)
            self.cli = c
        return self.cli

    @staticmethod
    def _area(a):
        from snap7.types import Areas
        return {"DB": Areas.DB, "PE": Areas.PE, "PA": Areas.PA, "MK": Areas.MK}[a]

    def _read_sync(self):
        c = self._conn()
        return {(area, db, s): bytes(c.read_area(self._area(area), db, s, n)) for area, db, s, n in self.blocks}

    async def read_all(self):
        self.check_bad()
        async with self.get_lock():
            try:
                mem = await asyncio.wait_for(asyncio.to_thread(self._read_sync), self.timeout + 3)
            except Exception as e:
                self._drop()
                raise IOError("S7 읽기 실패: %s" % (str(e) or type(e).__name__))

        def get(area, db, b, n):
            for (a, d, s), data in mem.items():
                if a == area and d == db and s <= b and b + n <= s + len(data):
                    return data[b - s:b - s + n]
            return bytes(n)

        out = {}
        for name, (area, db, size, b, bit, n) in self.parsed.items():
            t = self.tags[name]
            d = get(area, db, b, n)
            if size == "X":
                v = (d[0] >> bit) & 1
            elif size == "B":
                v = d[0]
            elif size == "W":
                v = struct.unpack(">h" if t["dtype"] == "int16" else ">H", d)[0]
            else:
                v = struct.unpack(">I" if t["dtype"] == "uint32" else ">i", d)[0]
            out[name] = to_val(t, v)
        return out

    def _write_sync(self, area, db, size, b, bit, raw):
        c = self._conn()
        ar = self._area(area)
        if size == "X":
            cur = bytearray(c.read_area(ar, db, b, 1))
            cur[0] = (cur[0] | (1 << bit)) if raw else (cur[0] & ~(1 << bit) & 0xFF)
            c.write_area(ar, db, b, cur)
        elif size == "B":
            c.write_area(ar, db, b, bytearray([raw & 0xFF]))
        elif size == "W":
            c.write_area(ar, db, b, bytearray(struct.pack(">H", raw & 0xFFFF)))
        else:
            c.write_area(ar, db, b, bytearray(struct.pack(">I", raw & 0xFFFFFFFF)))

    async def write(self, tag, value):
        t = self.tags[tag]
        area, db, size, b, bit, n = self.parse(t["pa"], t)
        async with self.get_lock():
            try:
                await asyncio.wait_for(asyncio.to_thread(self._write_sync, area, db, size, b, bit, to_raw(t, value)), self.timeout + 3)
            except Exception as e:
                self._drop()
                raise IOError("S7 쓰기 실패: %s" % (str(e) or type(e).__name__))

    def _drop(self):
        try:
            if self.cli:
                self.cli.disconnect()
        except Exception:
            pass
        self.cli = None

    def close(self):
        self._drop()


# ======================================================================
# OPC UA (asyncua)
# ======================================================================
class OpcUaDriver(BaseDriver):
    proto = "opcua"

    def __init__(self, cfg, tags):
        self.url = cfg.get("ua_url") or "opc.tcp://%s:%s" % (cfg["host"], cfg.get("port") or 4840)
        self.user, self.pw = cfg.get("ua_user") or "", cfg.get("ua_pw") or ""
        self.security = cfg.get("ua_security") or "none"
        self.base = cfg.get("_base", ".")
        self.cli, self.lock, self.vt = None, None, {}
        super().__init__(cfg, tags)

    def parse(self, pa, t):
        s = str(pa).strip()
        if not re.match(r"^(ns=\d+;)?[isgb]=.+$", s):
            raise AddrError("NodeId 표기가 아닙니다 (예: ns=2;s=Tunnel.JF01, ns=3;i=1001)")
        return s

    def get_lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock

    async def _conn(self):
        from asyncua import Client
        if self.cli is not None:
            return self.cli
        c = Client(self.url, timeout=self.timeout)
        if self.user:
            c.set_user(self.user)
            c.set_password(self.pw)
        if self.security != "none":
            import os
            from asyncua.crypto.cert_gen import setup_self_signed_certificate
            from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256
            from asyncua import ua
            from cryptography.x509.oid import ExtendedKeyUsageOID
            d = os.path.join(self.base, "data", "opcua")
            os.makedirs(d, exist_ok=True)
            cert, key = os.path.join(d, "client_cert.der"), os.path.join(d, "client_key.pem")
            uri = "urn:tunnel-scada:client"
            await setup_self_signed_certificate(key, cert, uri, "tunnel-scada", [ExtendedKeyUsageOID.CLIENT_AUTH], {"commonName": "tunnel-scada"})
            mode = ua.MessageSecurityMode.SignAndEncrypt if self.security == "Basic256Sha256_SignAndEncrypt" else ua.MessageSecurityMode.Sign
            c.application_uri = uri
            await c.set_security(SecurityPolicyBasic256Sha256, cert, key, mode=mode)
        await asyncio.wait_for(c.connect(), self.timeout + 3)
        self.cli, self.nodes = c, {}
        return c

    def _node(self, name):
        if name not in self.nodes:
            self.nodes[name] = self.cli.get_node(self.parsed[name])
        return self.nodes[name]

    async def read_all(self):
        self.check_bad()
        async with self.get_lock():
            try:
                c = await self._conn()
                names = list(self.parsed)
                vals = await asyncio.wait_for(c.read_values([self._node(n) for n in names]), self.timeout + 3)
            except Exception as e:
                await self._drop()
                raise IOError("OPC UA 읽기 실패: %s" % (str(e) or type(e).__name__))
        return {n: to_val(self.tags[n], v) for n, v in zip(names, vals)}

    async def write(self, tag, value):
        from asyncua import ua
        t = self.tags[tag]
        async with self.get_lock():
            try:
                await self._conn()
                node = self._node(tag)
                if tag not in self.vt:
                    self.vt[tag] = await node.read_data_type_as_variant_type()
                vt = self.vt[tag]
                if vt == ua.VariantType.Boolean:
                    v = bool(value)
                elif vt in (ua.VariantType.Float, ua.VariantType.Double):
                    v = float(value) / t["scale"] if t["dtype"] != "bool" else float(bool(value))
                else:
                    v = to_raw(t, value)
                await node.write_value(ua.DataValue(ua.Variant(v, vt)))
            except Exception as e:
                await self._drop()
                raise IOError("OPC UA 쓰기 실패: %s" % (str(e) or type(e).__name__))

    async def _drop(self):
        c, self.cli = self.cli, None
        if c:
            try:
                await asyncio.wait_for(c.disconnect(), 2)
            except Exception:
                pass

    def close(self):
        if self.cli:
            asyncio.ensure_future(self._drop())


# ======================================================================
# EtherNet/IP (pycomm3)
# ======================================================================
class EipDriver(BaseDriver):
    proto = "eip"

    def __init__(self, cfg, tags):
        self.mode = cfg.get("eip_mode") or "logix"
        slot = str(cfg.get("eip_slot") or "").strip()
        self.path = cfg["host"] + ("/" + slot if slot and self.mode == "logix" else "")
        self.drv, self.lock = None, None
        super().__init__(cfg, tags)

    def parse(self, pa, t):
        s = str(pa).strip()
        if self.mode == "slc":
            if not re.match(r"^[A-Z]\d*:\d+(/\d+)?$", s.upper()):
                raise AddrError("MicroLogix·SLC 표기가 아닙니다 (예: B3:0/1, N7:10)")
            return s.upper()
        if not re.match(r"^[A-Za-z_][\w.\[\]:]*$", s):
            raise AddrError("Logix 태그 이름이 아닙니다 (예: JF01_FWD, Tunnel.JF[1].Run)")
        return s

    def get_lock(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        return self.lock

    def _conn(self):
        from pycomm3 import LogixDriver, SLCDriver
        if self.drv is None or not self.drv.connected:
            d = (SLCDriver if self.mode == "slc" else LogixDriver)(self.path)
            d.socket_timeout = self.timeout
            d.open()
            self.drv = d
        return self.drv

    def _read_sync(self):
        d = self._conn()
        names = list(self.parsed)
        res = d.read(*[self.parsed[n] for n in names])
        res = res if isinstance(res, list) else [res]
        out = {}
        for n, r in zip(names, res):
            if r.error:
                raise IOError("%s(%s): %s" % (n, self.parsed[n], r.error))
            out[n] = r.value
        return out

    async def read_all(self):
        self.check_bad()
        async with self.get_lock():
            try:
                raw = await asyncio.wait_for(asyncio.to_thread(self._read_sync), self.timeout + 5)
            except Exception as e:
                self._drop()
                raise IOError("EtherNet/IP 읽기 실패: %s" % (str(e) or type(e).__name__))
        return {n: to_val(self.tags[n], v if not isinstance(v, bool) else int(v)) for n, v in raw.items()}

    def _write_sync(self, addr, v):
        r = self._conn().write((addr, v))
        if r.error:
            raise IOError(r.error)

    async def write(self, tag, value):
        t = self.tags[tag]
        v = bool(value) if t["dtype"] == "bool" else to_raw(t, value)
        async with self.get_lock():
            try:
                await asyncio.wait_for(asyncio.to_thread(self._write_sync, t["pa"], v), self.timeout + 5)
            except Exception as e:
                self._drop()
                raise IOError("EtherNet/IP 쓰기 실패: %s" % (str(e) or type(e).__name__))

    def _drop(self):
        try:
            if self.drv:
                self.drv.close()
        except Exception:
            pass
        self.drv = None

    def close(self):
        self._drop()


# ======================================================================
# 기본 PLC 주소 (현장 일람표에 PLC 주소가 없을 때 쓰는 제안값)
# ======================================================================
def default_paddr(proto, t, opt=None):
    a, ty = t["addr"], t["type"]
    opt = opt or {}
    if proto == "xgt":
        return {"DI": "%%MX%d" % (1000 + a), "DO": "%%MX%d" % (3000 + a)}.get(ty) or "%%MW%d" % ((1000 if ty == "AI" else 3000) + a)
    if proto == "mc":
        return {"DI": "M%d" % (1000 + a), "DO": "M%d" % (3000 + a)}.get(ty) or "D%d" % ((1000 if ty == "AI" else 3000) + a)
    if proto == "fins":
        return {"DI": "W%d.%02d" % (100 + a // 16, a % 16), "DO": "W%d.%02d" % (200 + a // 16, a % 16)}.get(ty) or \
            "D%d" % ((1000 if ty == "AI" else 3000) + a)
    if proto == "s7":
        if ty == "DI":
            return "DB100.DBX%d.%d" % (a // 8, a % 8)
        if ty == "DO":
            return "DB101.DBX%d.%d" % (a // 8, a % 8)
        if ty == "AI":
            return "DB102.DBW%d" % (2 * a)
        return "DB103.DB%s%d" % ("D" if t["dtype"] == "uint32" else "W", 2 * a)
    if proto == "opcua":
        return "ns=%s;s=%s" % (opt.get("ua_ns") or 2, t["tag"])
    if proto == "eip":
        if opt.get("eip_mode") == "slc":
            return {"DI": "B3:%d/%d" % (a // 16, a % 16), "DO": "B10:%d/%d" % (a // 16, a % 16), "AI": "N7:%d" % a}.get(ty) or \
                ("L12:%d" % a if t["dtype"] == "uint32" else "N11:%d" % a)
        return re.sub(r"[^A-Za-z0-9_]", "_", t["tag"])
    return ""


def with_paddr(proto, tags, opt=None):
    out = []
    for t in tags:
        t2 = dict(t)
        t2["pa"] = (t.get("paddr") or "").strip() or default_paddr(proto, t, opt)
        out.append(t2)
    return out


DRIVERS = {"xgt": XgtDriver, "mc": McDriver, "fins": FinsDriver, "s7": S7Driver, "opcua": OpcUaDriver, "eip": EipDriver}


def make_driver(p, tags, base="."):
    """PLC 설정 p 와 관제점으로 드라이버를 만든다."""
    proto = p.get("protocol") or "modbus"
    if proto == "modbus":
        opt = {k: p[k] for k in ("word_order", "addr_offset", "timeout", "block", "transport", "baud", "parity", "stopbits", "bytesize") if k in p}
        host = p.get("serial_port") if str(p.get("transport", "tcp")).endswith("_serial") else p["host"]
        d = ModbusDevice(host, int(p.get("port") or 502), int(p.get("unit") or 1), tags, opt)
        d.proto = "modbus"
        return d
    cfg = dict(p, _base=base)
    return DRIVERS[proto](cfg, with_paddr(proto, tags, p))
