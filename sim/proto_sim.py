"""시험용: 현지터널 가상 PLC를 여러 제조사 프로토콜로도 응답하게 한다.

  LS XGT 전용(FEnet)   TCP 2004
  미쓰비시 MC·SLMP 3E   TCP 5007
  오므론 FINS           TCP·UDP 9600
  지멘스 S7             TCP 1102  (실제 장비는 102)
  OPC UA               opc.tcp://…:4840   (ns=2;s=태그이름)
  Modbus RTU over TCP  TCP 5022

주소는 app/protocols.default_paddr 의 기본 PLC 주소를 쓴다. 실제 PLC와 연결할 때는 현장 일람표 주소를 쓴다.
32비트 값은 MC·FINS·XGT는 하위 워드 먼저, S7은 상위 먼저(빅엔디언).
"""
import asyncio
import ctypes
import logging
import struct

from app.protocols import (fins_parse, mc_parse, s7_parse, split32, join32, to_raw, with_paddr, xgt_parse, XGT_SIZE,
                           MC_CODES, FINS_AREA)

log = logging.getLogger("proto_sim")
logging.getLogger("snap7").setLevel(logging.WARNING)
logging.getLogger("asyncua").setLevel(logging.WARNING)
WO = {"mc": "low", "fins": "low", "xgt": "low", "s7": "high"}


class Image:
    """프로토콜별 메모리. get/put 은 원시 정수값."""
    proto = ""

    def __init__(self, plc):
        self.plc = plc
        self.tags = with_paddr(self.proto, list(plc.tags.values()), {})
        self.last = {}

    async def sync_in(self):
        """클라이언트가 쓴 값을 가상 PLC로."""
        for t in self.tags:
            if t["type"] not in ("DO", "AO", "PI"):
                continue
            raw = await self.get(t)
            if t["tag"] in self.last and raw != self.last[t["tag"]]:
                self.plc.set(t["tag"], bool(raw) if t["dtype"] == "bool" else raw * t["scale"])

    async def sync_out(self):
        for t in self.tags:
            raw = to_raw(t, self.plc.get(t["tag"]))
            await self.put(t, raw)
            self.last[t["tag"]] = raw


# ---------------- MC ----------------
class McImage(Image):
    proto = "mc"

    def __init__(self, plc):
        super().__init__(plc)
        self.bits, self.words = {}, {}

    async def get(self, t):
        dev, n, isbit = mc_parse(t["pa"])
        if isbit:
            return self.bits.get((dev, n), 0)
        if t["dtype"] == "uint32":
            return join32(WO["mc"], self.words.get((dev, n), 0), self.words.get((dev, n + 1), 0))
        return self.words.get((dev, n), 0)

    async def put(self, t, raw):
        dev, n, isbit = mc_parse(t["pa"])
        if isbit:
            self.bits[(dev, n)] = 1 if raw else 0
        elif t["dtype"] == "uint32":
            a, b = split32(WO["mc"], raw)
            self.words[(dev, n)], self.words[(dev, n + 1)] = a, b
        else:
            self.words[(dev, n)] = raw & 0xFFFF

    async def handle(self, r, w):
        code2dev = {v: k for k, v in MC_CODES.items()}
        try:
            while True:
                head = await r.readexactly(9)
                body = await r.readexactly(struct.unpack_from("<H", head, 7)[0])
                cmd, sub = struct.unpack_from("<HH", body, 2)
                n = int.from_bytes(body[6:9], "little")
                dev = code2dev.get(body[9], "D")
                cnt = struct.unpack_from("<H", body, 10)[0]
                data = body[12:]
                out = b""
                if cmd == 0x0401 and sub == 0x0001:
                    v = [self.bits.get((dev, n + i), 0) for i in range(cnt)] + [0]
                    out = bytes((v[i] << 4) | v[i + 1] for i in range(0, cnt, 2))
                elif cmd == 0x0401:
                    out = b"".join(struct.pack("<H", self.words.get((dev, n + i), 0)) for i in range(cnt))
                elif cmd == 0x1401 and sub == 0x0001:
                    for i in range(cnt):
                        b = data[i // 2]
                        self.bits[(dev, n + i)] = (b >> 4) & 1 if i % 2 == 0 else b & 1
                elif cmd == 0x1401:
                    for i in range(cnt):
                        self.words[(dev, n + i)] = struct.unpack_from("<H", data, i * 2)[0]
                resp = b"\xD0\x00" + head[2:7] + struct.pack("<HH", len(out) + 2, 0) + out
                w.write(resp)
                await w.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            w.close()


# ---------------- XGT ----------------
class XgtImage(Image):
    proto = "xgt"

    def __init__(self, plc):
        super().__init__(plc)
        self.mem = {}

    def m(self, dev):
        return self.mem.setdefault(dev, bytearray(32768))

    async def get(self, t):
        dev, size, n = xgt_parse(t["pa"])
        mm = self.m(dev)
        if size == "X":
            return (mm[n // 8] >> (n % 8)) & 1
        b0 = n * XGT_SIZE[size]
        if t["dtype"] == "uint32" and size == "W":
            return join32(WO["xgt"], struct.unpack_from("<H", mm, b0)[0], struct.unpack_from("<H", mm, b0 + 2)[0])
        return int.from_bytes(mm[b0:b0 + XGT_SIZE[size]], "little")

    async def put(self, t, raw):
        dev, size, n = xgt_parse(t["pa"])
        mm = self.m(dev)
        if size == "X":
            mm[n // 8] = (mm[n // 8] | (1 << (n % 8))) if raw else (mm[n // 8] & ~(1 << (n % 8)) & 0xFF)
            return
        b0 = n * XGT_SIZE[size]
        if t["dtype"] == "uint32" and size == "W":
            a, b = split32(WO["xgt"], raw)
            struct.pack_into("<HH", mm, b0, a, b)
        else:
            mm[b0:b0 + XGT_SIZE[size]] = (raw & ((1 << (8 * XGT_SIZE[size])) - 1)).to_bytes(XGT_SIZE[size], "little")

    async def handle(self, r, w):
        try:
            while True:
                head = await r.readexactly(20)
                body = await r.readexactly(struct.unpack_from("<H", head, 16)[0])
                cmd, dt, _, nblk = struct.unpack_from("<HHHH", body, 0)
                vl = struct.unpack_from("<H", body, 8)[0]
                var = body[10:10 + vl].decode()
                dev, size, n = xgt_parse(var)
                mm = self.m(dev)
                p = 10 + vl
                if cmd == 0x0054:
                    cnt = struct.unpack_from("<H", body, p)[0] if dt == 0x14 else XGT_SIZE[size] or 1
                    if dt == 0x14:
                        data = bytes(mm[n:n + cnt])
                    elif size == "X":
                        data = bytes([(mm[n // 8] >> (n % 8)) & 1])
                    else:
                        data = bytes(mm[n * XGT_SIZE[size]:n * XGT_SIZE[size] + XGT_SIZE[size]])
                    out = struct.pack("<HHHHH", 0x0055, dt, 0, 0, 1) + struct.pack("<H", len(data)) + data
                else:
                    ln = struct.unpack_from("<H", body, p)[0]
                    data = body[p + 2:p + 2 + ln]
                    if dt == 0x14 or size == "B":
                        mm[n:n + ln] = data
                    elif size == "X":
                        mm[n // 8] = (mm[n // 8] | (1 << (n % 8))) if data[0] else (mm[n // 8] & ~(1 << (n % 8)) & 0xFF)
                    else:
                        b0 = n * XGT_SIZE[size]
                        mm[b0:b0 + ln] = data
                    out = struct.pack("<HHHHH", 0x0059, dt, 0, 0, 1)
                h = b"LSIS-XGT\x00\x00" + b"\x00\x00" + bytes([0xA0, 0x11]) + head[14:16] + struct.pack("<H", len(out)) + b"\x00"
                w.write(h + bytes([sum(h) & 0xFF]) + out)
                await w.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            w.close()


# ---------------- FINS ----------------
class FinsImage(Image):
    proto = "fins"

    def __init__(self, plc):
        super().__init__(plc)
        self.words = {}

    async def get(self, t):
        area, wd, bit = fins_parse(t["pa"])
        if bit is not None:
            return (self.words.get((area, wd), 0) >> bit) & 1
        if t["dtype"] == "uint32":
            return join32(WO["fins"], self.words.get((area, wd), 0), self.words.get((area, wd + 1), 0))
        return self.words.get((area, wd), 0)

    async def put(self, t, raw):
        area, wd, bit = fins_parse(t["pa"])
        if bit is not None:
            v = self.words.get((area, wd), 0)
            self.words[(area, wd)] = (v | (1 << bit)) if raw else (v & ~(1 << bit) & 0xFFFF)
        elif t["dtype"] == "uint32":
            a, b = split32(WO["fins"], raw)
            self.words[(area, wd)], self.words[(area, wd + 1)] = a, b
        else:
            self.words[(area, wd)] = raw & 0xFFFF

    def process(self, fins):
        code = {}
        for a, (wc, bc) in FINS_AREA.items():
            code[wc], code[bc] = (a, False), (a, True)
        mrc, src = fins[10], fins[11]
        p = fins[12:]
        area, isbit = code.get(p[0], ("D", False))
        wd, bit, cnt = struct.unpack_from(">HBH", p, 1)
        data = b""
        if (mrc, src) == (1, 1):
            if isbit:
                data = bytes(((self.words.get((area, wd), 0) >> (bit + i)) & 1) for i in range(cnt))
            else:
                data = b"".join(struct.pack(">H", self.words.get((area, wd + i), 0)) for i in range(cnt))
        elif (mrc, src) == (1, 2):
            d = p[6:]
            if isbit:
                for i in range(cnt):
                    v = self.words.get((area, wd), 0)
                    b = bit + i
                    self.words[(area, wd)] = (v | (1 << b)) if d[i] else (v & ~(1 << b) & 0xFFFF)
            else:
                for i in range(cnt):
                    self.words[(area, wd + i)] = struct.unpack_from(">H", d, i * 2)[0]
        hdr = bytes([0xC0, 0x00, 0x02, fins[6], fins[7], fins[8], fins[3], fins[4], fins[5], fins[9]])
        return hdr + bytes([mrc, src, 0, 0]) + data

    async def handle(self, r, w):
        try:
            req = await r.readexactly(20)
            client = struct.unpack_from(">I", req, 16)[0] or 0xEF
            w.write(b"FINS" + struct.pack(">IIIII", 16, 1, 0, client, 0x01))
            await w.drain()
            while True:
                head = await r.readexactly(16)
                fins = await r.readexactly(struct.unpack_from(">I", head, 4)[0] - 8)
                out = self.process(fins)
                w.write(b"FINS" + struct.pack(">III", 8 + len(out), 2, 0) + out)
                await w.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            w.close()


class FinsUdp(asyncio.DatagramProtocol):
    def __init__(self, img):
        self.img = img

    def connection_made(self, tr):
        self.tr = tr

    def datagram_received(self, data, addr):
        try:
            self.tr.sendto(self.img.process(data), addr)
        except Exception as e:
            log.warning("FINS UDP: %s", e)


# ---------------- S7 (snap7 서버) ----------------
class S7Image(Image):
    proto = "s7"

    def __init__(self, plc):
        super().__init__(plc)
        self.db = {}
        for t in self.tags:
            area, db, *_ = s7_parse(t["pa"])
            if area == "DB" and db not in self.db:
                self.db[db] = (ctypes.c_uint8 * 1024)()

    def buf(self, t):
        area, db, size, b, bit = s7_parse(t["pa"])
        return self.db[db], size, b, bit

    async def get(self, t):
        mm, size, b, bit = self.buf(t)
        if size == "X":
            return (mm[b] >> bit) & 1
        n = {"B": 1, "W": 2, "D": 4}[size]
        return int.from_bytes(bytes(mm[b:b + n]), "big")

    async def put(self, t, raw):
        mm, size, b, bit = self.buf(t)
        if size == "X":
            mm[b] = (mm[b] | (1 << bit)) if raw else (mm[b] & ~(1 << bit) & 0xFF)
            return
        n = {"B": 1, "W": 2, "D": 4}[size]
        for i, x in enumerate((raw & ((1 << (8 * n)) - 1)).to_bytes(n, "big")):
            mm[b + i] = x


# ---------------- OPC UA ----------------
class UaImage(Image):
    proto = "opcua"

    def __init__(self, plc):
        super().__init__(plc)
        self.vars = {}

    async def start(self, host):
        from asyncua import Server, ua
        srv = Server()
        await srv.init()
        srv.set_endpoint("opc.tcp://%s:4840/" % host)
        srv.set_server_name("Tunnel SCADA 가상 PLC")
        srv.set_security_policy([ua.SecurityPolicyType.NoSecurity])
        idx = await srv.register_namespace("urn:tunnel-sim")
        obj = await srv.nodes.objects.add_object(idx, "Tunnel")
        for t in self.tags:
            vt = ua.VariantType.Boolean if t["dtype"] == "bool" else ua.VariantType.UInt32 if t["dtype"] == "uint32" else ua.VariantType.Int32
            init = False if t["dtype"] == "bool" else 0
            v = await obj.add_variable(ua.NodeId(t["tag"], idx), t["tag"], ua.Variant(init, vt))
            await v.set_writable()
            self.vars[t["tag"]] = (v, vt)
        await srv.start()
        self.srv = srv

    async def get(self, t):
        v = await self.vars[t["tag"]][0].read_value()
        return int(v) if not isinstance(v, bool) else int(v)

    async def put(self, t, raw):
        from asyncua import ua
        node, vt = self.vars[t["tag"]]
        if t["dtype"] != "bool" and vt == ua.VariantType.Int32 and raw > 32767:
            raw -= 65536
        await node.write_value(ua.Variant(bool(raw) if t["dtype"] == "bool" else int(raw), vt))


async def start_all(plc, ctx, host="127.0.0.1"):
    """가상 PLC(plc)를 여러 프로토콜로 연다. 반환: 동기화할 이미지 목록."""
    imgs, ok = [], []
    for cls, port in ((XgtImage, 2004), (McImage, 5007), (FinsImage, 9600)):
        img = cls(plc)
        try:
            await asyncio.start_server(img.handle, host, port)
            if cls is FinsImage:
                await asyncio.get_running_loop().create_datagram_endpoint(lambda: FinsUdp(img), local_addr=(host, 9600))
            imgs.append(img)
            ok.append("%s:%d" % (cls.proto.upper(), port))
        except OSError as e:
            log.warning("%s 시험 서버 실패: %s", cls.proto, e)
    try:
        import snap7
        img = S7Image(plc)
        srv = snap7.server.Server(log=False)
        for db, buf in img.db.items():
            srv.register_area(snap7.types.srvAreaDB, db, buf)
        srv.start(tcpport=1102)
        img.srv = srv
        imgs.append(img)
        ok.append("S7:1102")
    except Exception as e:
        log.warning("S7 시험 서버 실패: %s", e)
    try:
        img = UaImage(plc)
        await img.start(host)
        imgs.append(img)
        ok.append("OPC UA:4840")
    except Exception as e:
        log.warning("OPC UA 시험 서버 실패: %s", e)
    try:
        from pymodbus import Framer
        from pymodbus.server import StartAsyncTcpServer
        asyncio.create_task(StartAsyncTcpServer(context=ctx, address=(host, 5022), framer=Framer.RTU))
        ok.append("Modbus RTU over TCP:5022")
    except Exception as e:
        log.warning("RTU over TCP 시험 서버 실패: %s", e)
    for img in imgs:
        await img.sync_out()
    print("[SIM] 현지터널 프로토콜 시험 서버: " + ", ".join(ok))
    return imgs
