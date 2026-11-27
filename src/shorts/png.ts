/** 순수 Node PNG 생성기 — 외부 라이브러리 없이 그라데이션 배경·폴백 아이콘을 그립니다. */
import zlib from 'node:zlib';
import type { Mood } from './types.ts';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface Theme {
  top: [number, number, number];
  bottom: [number, number, number];
  accents: [number, number, number][];
  accentHex: string;
  textHex: string;
  mutedHex: string;
}

export const THEMES: Record<Mood, Theme> = {
  bright: {
    top: [13, 18, 46],
    bottom: [22, 40, 96],
    accents: [
      [34, 211, 238],
      [139, 92, 246],
      [59, 130, 246],
    ],
    accentHex: '&H00EED322',
    textHex: '&H00FFFFFF',
    mutedHex: '&H00D9DEEB',
  },
  focus: {
    top: [9, 15, 28],
    bottom: [16, 34, 48],
    accents: [
      [45, 212, 191],
      [56, 189, 248],
      [99, 102, 241],
    ],
    accentHex: '&H00BFD42D',
    textHex: '&H00FFFFFF',
    mutedHex: '&H00C9D4DE',
  },
  impact: {
    top: [26, 10, 20],
    bottom: [58, 12, 40],
    accents: [
      [251, 146, 60],
      [244, 63, 94],
      [168, 85, 247],
    ],
    accentHex: '&H003C92FB',
    textHex: '&H00FFFFFF',
    mutedHex: '&H00F0D6DE',
  },
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 씬 배경 — 세로 그라데이션 + 보케광 + 대각선 하이라이트 + 하단 스크림 + 미세 그레인.
 * 1080×1920 출력을 위해 540×960 으로 그린 뒤 ffmpeg에서 확대합니다.
 */
export function renderBackground(theme: Theme, sceneIndex: number, seed: number, dim = 0): Buffer {
  const width = 540;
  const height = 960;
  const rgba = new Uint8Array(width * height * 4);
  const accentA = theme.accents[sceneIndex % theme.accents.length];
  const accentB = theme.accents[(sceneIndex + 1) % theme.accents.length];
  const glowA = {
    x: 0.18 + 0.55 * ((sceneIndex * 0.37) % 1),
    y: 0.2 + 0.35 * ((sceneIndex * 0.61) % 1),
    r: 0.55,
  };
  const glowB = {
    x: 0.85 - 0.5 * ((sceneIndex * 0.29) % 1),
    y: 0.62 + 0.25 * ((sceneIndex * 0.47) % 1),
    r: 0.45,
  };
  for (let y = 0; y < height; y += 1) {
    const ty = y / (height - 1);
    const base = smooth(ty);
    const bottomMix = clamp01((ty - 0.5) / 0.5);
    for (let x = 0; x < width; x += 1) {
      const tx = x / (width - 1);
      let r = lerp(theme.top[0], theme.bottom[0], base);
      let g = lerp(theme.top[1], theme.bottom[1], base);
      let b = lerp(theme.top[2], theme.bottom[2], base);

      const da = Math.hypot(tx - glowA.x, ty - glowA.y) / glowA.r;
      if (da < 1) {
        const k = Math.pow(1 - da, 2.6) * 0.85;
        r += accentA[0] * k * 0.55;
        g += accentA[1] * k * 0.55;
        b += accentA[2] * k * 0.55;
      }
      const db = Math.hypot(tx - glowB.x, ty - glowB.y) / glowB.r;
      if (db < 1) {
        const k = Math.pow(1 - db, 2.8) * 0.7;
        r += accentB[0] * k * 0.42;
        g += accentB[1] * k * 0.42;
        b += accentB[2] * k * 0.42;
      }
      // 대각선 하이라이트 (테크 느낌)
      const diagonal = Math.abs((tx * 1.35 + ty * 0.45) % 0.32 - 0.16);
      if (diagonal < 0.006) {
        const k = (1 - diagonal / 0.006) * 0.022;
        r += 255 * k;
        g += 255 * k;
        b += 255 * k;
      }
      // 하단 스크림 — 텍스트 가독성
      const scrim = bottomMix * bottomMix * 0.62 + dim * 0.35;
      r *= 1 - scrim;
      g *= 1 - scrim;
      b *= 1 - scrim;
      // 비네트
      const vignette = Math.hypot(tx - 0.5, ty - 0.5) * 1.18;
      const vk = clamp01((vignette - 0.45) / 0.6) * 0.35;
      r *= 1 - vk;
      g *= 1 - vk;
      b *= 1 - vk;
      // 그레인
      const grain = (hash2(x, y, seed) - 0.5) * 5;

      const idx = (y * width + x) * 4;
      rgba[idx] = Math.max(0, Math.min(255, Math.round(r + grain)));
      rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(g + grain)));
      rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(b + grain)));
      rgba[idx + 3] = 255;
    }
  }
  return encodePng(width, height, rgba);
}

/** 스토어 아이콘을 못 받았을 때 쓰는 폴백 아이콘 카드 (그라데이션 + 기하 마크) */
export function renderFallbackIcon(theme: Theme, seed = 1): Buffer {
  const size = 512;
  const rgba = new Uint8Array(size * size * 4);
  const accent = theme.accents[seed % theme.accents.length];
  const accent2 = theme.accents[(seed + 2) % theme.accents.length];
  const radius = 112;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      // 둥근 사각형 마스크
      const cx = Math.max(radius - x, 0, x - (size - 1 - radius));
      const cy = Math.max(radius - y, 0, y - (size - 1 - radius));
      const dist = Math.hypot(cx, cy);
      const inside = dist <= radius;
      const alpha = inside ? 255 : Math.max(0, Math.min(255, Math.round((1 - (dist - radius) / 2) * 255)));
      const t = (x / size) * 0.55 + (y / size) * 0.45;
      let r = lerp(accent[0], accent2[0], t);
      let g = lerp(accent[1], accent2[1], t);
      let b = lerp(accent[2], accent2[2], t);
      // 가운데 흰 마크: 굵은 대각선 + 원
      const mx = x - size / 2;
      const my = y - size / 2;
      const ring = Math.abs(Math.hypot(mx, my) - 118);
      const bar = Math.abs(mx * 0.7 + my * 0.7) < 26 && Math.abs(mx) < 150 && Math.abs(my) < 150;
      if (ring < 15 || bar) {
        r = lerp(r, 255, 0.94);
        g = lerp(g, 255, 0.94);
        b = lerp(b, 255, 0.94);
      }
      rgba[idx] = Math.round(r);
      rgba[idx + 1] = Math.round(g);
      rgba[idx + 2] = Math.round(b);
      rgba[idx + 3] = alpha;
    }
  }
  return encodePng(size, size, rgba);
}
