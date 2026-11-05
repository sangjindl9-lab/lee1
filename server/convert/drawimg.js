// 선 데이터(DXF·DWG) → PNG 그림. 미리보기와 AI 도면 해석 입력으로 쓴다 (외부 프로그램 없이 zlib 로 PNG 인코딩).
import zlib from 'node:zlib';

/**
 * @param polys [[x,y],...][]  도면 좌표(y 위쪽 양수)
 * @param opt.maxSide 긴 변 픽셀 (기본 1568 — Claude 비전 권장 크기)
 * @returns {png:Buffer, width, height, toPx:(x,y)=>[px,py]}
 */
export function renderPolys(polys, { maxSide = 1568, pad = 24, bbox } = {}) {
  let [[x0, y0], [x1, y1]] = bbox || extent(polys);
  if (!(x1 > x0)) x1 = x0 + 1; if (!(y1 > y0)) y1 = y0 + 1;
  const s = (maxSide - pad * 2) / Math.max(x1 - x0, y1 - y0);
  const W = Math.ceil((x1 - x0) * s) + pad * 2, H = Math.ceil((y1 - y0) * s) + pad * 2;
  const img = new Uint8Array(W * H).fill(255);
  const toPx = (x, y) => [pad + (x - x0) * s, H - pad - (y - y0) * s];
  const dot = (x, y) => { const X = x | 0, Y = y | 0; if (X >= 0 && Y >= 0 && X < W && Y < H) img[Y * W + X] = 0; };
  for (const p of polys) for (let i = 0; i < p.length - 1; i++) {
    const [ax, ay] = toPx(...p[i]), [bx, by] = toPx(...p[i + 1]);
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let k = 0; k <= n; k++) { const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n; dot(x, y); dot(x + 0.6, y + 0.6); }
  }
  return { png: encodePng(img, W, H), width: W, height: H, toPx, scale: s };
}

export function extent(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [[x0, y0], [x1, y1]];
}

/** 8비트 회색조 PNG */
export function encodePng(gray, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; Buffer.from(gray.buffer, gray.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
let T;
function crc32(b) {
  if (!T) { T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
