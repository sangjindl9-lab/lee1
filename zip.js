// 의존성 없는 ZIP 쓰기(무압축 저장)·읽기(저장/deflate) — 백업·복원용
const zlib = require("zlib");

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
           date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

// entries를 차례로 받아 write(buf)로 흘려보냄 (큰 백업도 메모리에 다 올리지 않음)
function createZipWriter(write) {
  const central = []; let offset = 0; const { time, date } = dosTime(new Date());
  async function add(name, data) {
    const nameBuf = Buffer.from(name, "utf8"); const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    await write(h); await write(nameBuf); await write(data);
    central.push({ nameBuf, crc, size: data.length, offset });
    offset += 30 + nameBuf.length + data.length;
  }
  async function finish() {
    let size = 0;
    for (const e of central) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
      c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt32LE(e.offset, 42);
      await write(c); await write(e.nameBuf); size += 46 + e.nameBuf.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
    await write(end);
  }
  return { add, finish };
}

// ZIP 버퍼 → {이름: Buffer}
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP 파일이 아닙니다");
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP 목록이 손상되었습니다");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28),
      xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    const dataStart = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const raw = buf.slice(dataStart, dataStart + csize);
    if (!name.endsWith("/")) out[name] = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

module.exports = { createZipWriter, readZip };
