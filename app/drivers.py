"""제조사별 장치를 직접 붙이는 범용 드라이버.

1) TCP 문자열 명령: 제조사 통신 사양서의 프레임을 '명령 틀'로 적으면 그대로 만들어 보낸다.
   <STX> <ETX> <ACK> <NAK> <CR> <LF> <EOT> <ENQ> <SOH> <ESC>   제어문자
   \\x1F                                                       임의 1바이트 (16진)
   {no} {no:03d} {l1} {l2} {slot}                              값 (파이썬 서식)
   {CS}                                                        체크섬 자리
   체크섬: none / xor / sum8 / sum16 / lrc,  범위: STX 다음부터 / 처음부터,  표기: 1바이트 / 16진 문자 2자
2) Modbus TCP 직접: 장치 자체가 Modbus 서버일 때 레지스터·코일을 직접 쓴다.
"""
import asyncio
import re

from .modbus_io import link_for, read_fc

CTRL = {"SOH": 1, "STX": 2, "ETX": 3, "EOT": 4, "ENQ": 5, "ACK": 6, "NAK": 0x15, "CR": 13, "LF": 10, "ESC": 0x1B}
TOKEN = re.compile(r"<([A-Z]{2,3})>|\\x([0-9A-Fa-f]{2})|\{([^{}]*)\}")
ENCODINGS = {"ascii", "euc-kr", "cp949", "utf-8", "utf-16be"}


def _enc(e):
    return e if e in ENCODINGS else "euc-kr"


def checksum(data, method):
    if method == "xor":
        v = 0
        for b in data:
            v ^= b
        return v, 1
    if method == "sum8":
        return sum(data) & 0xFF, 1
    if method == "lrc":
        return (-sum(data)) & 0xFF, 1
    if method == "sum16":
        return sum(data) & 0xFFFF, 2
    return None, 0


def render(tpl, values, encoding="euc-kr", cs="none", cs_from="after_stx", cs_fmt="byte"):
    """명령 틀 → 보낼 바이트."""
    enc = _enc(encoding)
    out, cs_at, pos = bytearray(), None, 0
    for m in TOKEN.finditer(tpl or ""):
        out += tpl[pos:m.start()].encode(enc)
        pos = m.end()
        if m.group(1):
            if m.group(1) not in CTRL:
                raise ValueError("알 수 없는 제어문자 <%s>" % m.group(1))
            out.append(CTRL[m.group(1)])
        elif m.group(2):
            out.append(int(m.group(2), 16))
        else:
            inner = m.group(3)
            if inner == "CS":
                cs_at = len(out)
                continue
            try:
                out += ("{" + inner + "}").format(**values).encode(enc)
            except (KeyError, ValueError, IndexError) as e:
                raise ValueError("명령 틀의 {%s} 를 만들 수 없습니다 (%s)" % (inner, e))
    out += tpl[pos:].encode(enc) if tpl else b""
    if cs_at is not None and cs != "none":
        start = 0
        if cs_from == "after_stx" and 2 in out[:cs_at]:
            start = out.index(2) + 1
        v, n = checksum(bytes(out[start:cs_at]), cs)
        b = ("%0*X" % (n * 2, v)).encode() if cs_fmt == "hex2" else v.to_bytes(n, "big")
        out[cs_at:cs_at] = b
    return bytes(out)


def hexdump(b):
    return " ".join("%02X" % x for x in b)


def pattern(text, encoding="ascii"):
    """응답 비교용 문자열(제어문자 표기 허용) → 바이트."""
    return render(text, {}, encoding) if text else b""


async def tcp_exchange(host, port, data, timeout=2.0, want_reply=True):
    r, w = await asyncio.wait_for(asyncio.open_connection(host, int(port)), timeout)
    try:
        w.write(data)
        await w.drain()
        if not want_reply:
            return b""
        buf = b""
        try:
            while True:
                chunk = await asyncio.wait_for(r.read(1024), timeout if not buf else 0.3)
                if not chunk:
                    break
                buf += chunk
                if buf.endswith((b"\x03", b"\x06", b"\x15", b"\r", b"\n")) or len(buf) > 4096:
                    break
        except asyncio.TimeoutError:
            pass
        return buf
    finally:
        w.close()


# ---------- Modbus 직접 ----------
def mb_addr(v):
    """'40001' 같은 표기나 0부터 시작하는 번호 모두 받기."""
    s = str(v).strip()
    if s == "":
        return None
    n = int(float(s))
    if len(s) >= 5 and n // 10000 in (0, 1, 3, 4) and n % 10000 >= 1:
        return n % 10000 - 1
    return n


async def _mb(host, port, timeout, fn):
    link = link_for(host, port, timeout)
    async with link.get_lock():
        if not await link.ensure():
            raise ConnectionError("연결 실패 %s:%s" % (host, port))
        return await fn(link.client)


async def mb_read(host, port, unit, fc, addr, n=1, timeout=2.0):
    return await _mb(host, port, timeout, lambda c: read_fc(c, int(fc), addr, n, int(unit)))


async def mb_write_reg(host, port, unit, addr, value, timeout=2.0):
    async def f(c):
        rr = await c.write_register(addr, int(value) & 0xFFFF, slave=int(unit))
        if rr.isError():
            raise IOError("레지스터 %d 쓰기 오류: %s" % (addr, rr))
    await _mb(host, port, timeout, f)


async def mb_write_regs(host, port, unit, addr, values, timeout=2.0):
    async def f(c):
        rr = await c.write_registers(addr, [int(v) & 0xFFFF for v in values], slave=int(unit))
        if rr.isError():
            raise IOError("레지스터 %d~ 쓰기 오류: %s" % (addr, rr))
    await _mb(host, port, timeout, f)


async def mb_write_coil(host, port, unit, addr, on, timeout=2.0):
    async def f(c):
        rr = await c.write_coil(addr, bool(on), slave=int(unit))
        if rr.isError():
            raise IOError("코일 %d 쓰기 오류: %s" % (addr, rr))
    await _mb(host, port, timeout, f)


def text_regs(text, n_regs, encoding):
    b = text.encode(_enc(encoding))[: n_regs * 2].ljust(n_regs * 2, b"\x00" if encoding != "ascii" else b" ")
    return [(b[i] << 8) | b[i + 1] for i in range(0, len(b), 2)]
