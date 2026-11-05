// 이미지 도면(JPG·PNG·TIFF)·스캔 PDF 분석 — 벡터 선이 없는 도면에서 투상도 외형을 찾아 3D 초안의 재료로 만든다.
//  1) 회색조 래스터로 읽기 (PDF: Poppler pdftoppm, 이미지: FFmpeg) → 오츠 이진화 → 먼지 제거
//  2) 도곽(테두리·표제란)과 긴 구분선 제거
//  3) 선 틈을 살짝 메운 뒤 바깥에서 채우기 → 열림 연산으로 치수선·지시선·글자 획 제거 → 남은 덩어리 = 투상도 외형
//  4) 외형 안쪽의 닫힌 빈 영역 = 구멍 후보 (원형이면 지름까지)
//  5) OCR(Tesseract, 있을 때만)로 축척·치수 숫자·두께 표기 읽기
// 모든 좌표는 '용지 mm'(PDF) 또는 '추정 용지 mm'(이미지, DPI 기준) — 실제 치수는 축척(1:N)을 곱해야 한다.
// 결과는 벡터 도면 분석과 같은 모양(profiles·views·groups)이라 투상도 결합·돌출 3D 를 그대로 쓴다.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { groupViews, traceOuter, rdp } from './views.js';
import { area as polyArea, bbox as polyBox } from './profiles-geom.js';

const run = promisify(execFile);
const PDF_DPI = 150;
const MAX_SIDE = 3200;

/**
 * @param file 파일 경로
 * @param kind 'pdf' | 'image'
 * @returns {analysis, preview}
 */
export async function analyzeRaster(file, kind) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eum3d-ras-'));
  try {
    let dpi = PDF_DPI, dpiAssumed = false, pgm;
    if (kind === 'pdf') {
      await run('pdftoppm', ['-gray', '-r', String(PDF_DPI), '-f', '1', '-l', '1', '-singlefile', file, path.join(dir, 'p')], { timeout: 120000 });
      pgm = await fs.readFile(path.join(dir, 'p.pgm'));
    } else {
      const head = await readHead(file);
      const d = imageDpi(head);
      if (d) dpi = d; else dpiAssumed = true;
      try {
        // 투명 배경 PNG 는 흰 바탕에 합성해서 읽는다 (투명한 검정 픽셀이 선으로 오인되는 것을 막음)
        await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-filter_complex', `[0:v]scale='min(${MAX_SIDE},iw)':-2:flags=area[v];color=white[bg];[bg][v]scale2ref[bg2][v2];[bg2][v2]overlay=shortest=1,format=gray`, '-frames:v', '1', '-c:v', 'pgm', path.join(dir, 'p.pgm')], { timeout: 120000 });
      } catch (e) { throw new Error('이미지를 열지 못했습니다 (손상·지원하지 않는 압축): ' + String(e.stderr || e.message).slice(0, 200)); }
      pgm = await fs.readFile(path.join(dir, 'p.pgm'));
      // 축소했으면 DPI 도 같은 비율로
      const orig = await probeSize(file);
      const img0 = parsePgm(pgm);
      if (orig && orig[0] > img0.w) dpi = (dpi * img0.w) / orig[0];
    }
    let img = parsePgm(pgm);
    if (Math.max(img.w, img.h) > MAX_SIDE) { const f = Math.ceil(Math.max(img.w, img.h) / MAX_SIDE); img = shrink(img, f); dpi /= f; }
    const mmPx = 25.4 / dpi;

    // 미리보기 (작은 PNG) — 화면에서 인식 결과를 원본 위에 겹쳐 보여 준다
    await run('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'p.pgm'), '-vf', 'scale=1400:-2:flags=area', path.join(dir, 'prev.png')], { timeout: 60000 }).catch(() => {});
    const preview = await fs.readFile(path.join(dir, 'prev.png')).catch(() => null);

    const geo = traceDrawing(img, mmPx);
    const ocr = await readText(path.join(dir, 'p.pgm'));
    const text = ocr.text;
    const m = /(?:SCALE|S|축척)\s*[:=]?\s*1\s*[:/]\s*(\d+(?:\.\d+)?)/i.exec(text) || /\b1\s*:\s*(\d+(?:\.\d+)?)\b/.exec(text);
    const numbers = [...new Set((text.match(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g) || []).map(Number).filter((n) => n >= 1 && n < 100000))].slice(0, 300);
    const texts = text.split(/\r?\n/).map((s) => s.trim().replace(/\s{2,}/g, ' ')).filter(Boolean).slice(0, 200);
    const W = +(img.w * mmPx).toFixed(2), H = +(img.h * mmPx).toFixed(2);
    const outer = geo.profiles.filter((p) => p.role === 'outer');
    return {
      analysis: {
        format: kind === 'pdf' ? 'PDF' : 'IMAGE', is3D: false, pages: 1,
        page: { width: W, height: H, rotation: 0 },
        raster: { width: img.w, height: img.h, dpi: +dpi.toFixed(1), dpiAssumed, stroke: geo.stroke, threshold: geo.threshold },
        unit: dpiAssumed ? '추정 용지 mm (DPI 정보 없음, 150dpi 가정 · 축척 미확정)' : '용지 mm (축척 미확정)',
        unitScaleToMm: null, scaleRequired: true,
        scaleHint: m ? Number(m[1]) : null,
        coordinateSystem: '용지 좌표 (왼쪽 아래 원점)',
        sheet: outer.length > 20,
        pdfType: 'scanned',
        layers: [], entityCounts: { 외형: outer.length, 구멍: geo.profiles.filter((p) => p.role === 'hole').length, 제거한_도곽: geo.removed.frames, 제거한_구분선: geo.removed.lines },
        profiles: geo.profiles, views: geo.views, groups: geo.groups, dimensions: [], texts, numbers, openChains: 0,
        ocr: ocr.engine, convertible: outer.length > 0,
        needsUserInput: ['scale', 'thickness'],
        hasPreview: !!preview,
        warnings: [
          `${kind === 'pdf' ? '스캔(이미지) PDF' : '이미지 도면'}입니다. 선을 픽셀에서 따낸 형상이라 벡터 도면보다 정밀도가 낮습니다 (픽셀 1칸 ≈ ${(mmPx).toFixed(2)} 용지 mm).`,
          ...(dpiAssumed ? ['이미지에 해상도(DPI) 정보가 없어 150dpi 로 가정했습니다. 축척은 도면 치수 숫자와 비교해 추정합니다.'] : []),
          ...(!ocr.engine ? ['문자 인식(OCR) 엔진이 없어 축척·두께 글자를 읽지 못했습니다.'] : []),
          ...(!outer.length ? ['도면에서 닫힌 외형을 찾지 못했습니다. 선이 흐리거나 끊긴 스캔본이면 더 선명하게 다시 스캔하세요.'] : []),
          '숨은선·단면 해석은 하지 않습니다. 결과는 참고용 AI 3D 시각화이며 정확한 형상은 3D 원본(STEP 등)을 추가로 올리세요.',
        ],
      },
      preview,
    };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

/** 이진 래스터 → 외형·구멍·투상도. 단위 변환 mmPx (픽셀 → 용지 mm) */
export function traceDrawing(img, mmPx) {
  const { w: nx, h: ny } = img;
  const N = nx * ny;
  const threshold = otsu(img.data);
  let dark = new Uint8Array(N);
  for (let i = 0; i < N; i++) dark[i] = img.data[i] < threshold ? 1 : 0;
  // 가장자리 1칸 비우기 (스캔 테두리 그림자)
  for (let x = 0; x < nx; x++) { dark[x] = 0; dark[(ny - 1) * nx + x] = 0; }
  for (let y = 0; y < ny; y++) { dark[y * nx] = 0; dark[y * nx + nx - 1] = 0; }
  // 먼지 제거: 아주 작은 점 덩어리 (선 두께 측정 전에 — 점 잡음이 두께를 1px 로 왜곡)
  const L0 = label(dark, nx, ny, true);
  for (const c of L0.comps) if (c.n < 6 && Math.max(c.x1 - c.x0, c.y1 - c.y0) < 4) for (const i of c.px) dark[i] = 0;
  const stroke = strokeWidth(dark, nx, ny);
  // 도곽·긴 구분선 제거
  let frames = 0, lines = 0;
  const L1 = label(dark, nx, ny, true);
  for (const c of L1.comps) {
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
    const isFrame = cw >= nx * 0.7 && ch >= ny * 0.7;
    const isLine = Math.max(cw, ch) >= Math.min(nx, ny) * 0.35 && Math.min(cw, ch) <= stroke * 3 + 2;
    if (isFrame || isLine) { for (const i of c.px) dark[i] = 0; isFrame ? frames++ : lines++; }
  }
  // 선 틈 메우기 → 바깥 채우기
  const gap = Math.max(1, Math.round(stroke * 0.75));
  const thick = dil(dark, nx, ny, gap);
  const outside = new Uint8Array(N);
  {
    const q = new Int32Array(N); let h = 0, t = 0;
    const push = (i) => { if (!thick[i] && !outside[i]) { outside[i] = 1; q[t++] = i; } };
    for (let x = 0; x < nx; x++) { push(x); push((ny - 1) * nx + x); }
    for (let y = 0; y < ny; y++) { push(y * nx); push(y * nx + nx - 1); }
    while (h < t) { const i = q[h++], x = i % nx; if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1); if (i >= nx) push(i - nx); if (i < N - nx) push(i + nx); }
  }
  let solid = new Uint8Array(N);
  for (let i = 0; i < N; i++) solid[i] = outside[i] ? 0 : 1;
  // 열림: 선 두께(틈 메운 뒤)보다 조금 큰 반경 → 치수선·글자 획 같은 가는 선 제거, 면이 있는 외형만 남김
  const r = Math.ceil((stroke + 2 * gap) / 2) + 1;
  solid = dil(ero(solid, nx, ny, r), nx, ny, r);
  // 외형 경계를 선 중심으로 맞춤 (채운 영역은 선 바깥쪽 반 두께 + 메운 틈만큼 큼)
  const shrinkPx = Math.max(0, Math.round(stroke / 2 + gap - 0.5));
  if (shrinkPx) solid = ero(solid, nx, ny, shrinkPx);

  const S = label(solid, nx, ny, false);
  const big = S.comps.reduce((m, c) => Math.max(m, c.n), 0);
  const minArea = Math.max(big * 0.03, (3 / mmPx) ** 2);
  const sil = S.comps.filter((c) => c.n >= minArea);

  // 구멍 후보: 굵힌 선도 바깥도 아닌 빈 칸 덩어리
  const empty = new Uint8Array(N);
  for (let i = 0; i < N; i++) empty[i] = !thick[i] && !outside[i] ? 1 : 0;
  const E = label(empty, nx, ny, false);
  // 바깥과 가까운 빈 영역은 '면'(외형 바로 안쪽)이다 — 구멍은 재료로 둘러싸인 영역
  const nearOut = dil(outside, nx, ny, Math.round(stroke + 2 * gap) + 2);

  const P = ([x, y]) => [+(x * mmPx).toFixed(3), +((ny - y) * mmPx).toFixed(3)];
  const profiles = [], views = [];
  sil.sort((a, b) => b.n - a.n);
  sil.forEach((c, k) => {
    const ring = traceComp(c, nx);
    if (!ring) return;
    const pts = rdp(ring.map(P), mmPx * 1.2);
    if (pts.length < 3) return;
    const id = `L${profiles.length + 1}`;
    const bb = polyBox(pts);
    profiles.push({ id, layer: 'SCAN', source: 'RASTER', role: 'outer', parent: null, area: +Math.abs(polyArea(pts)).toFixed(3), bbox: bb, points: pts });
    // 이 외형 안의 빈 영역
    const circles = [], holePolys = [];
    for (const e of E.comps) {
      if (e.n > c.n * 0.35 || e.n < (1.2 / mmPx) ** 2) continue;
      const ci = ((e.y0 + e.y1) >> 1) * nx + ((e.x0 + e.x1) >> 1);
      if (S.lab[ci] !== c.id && S.lab[e.px[0]] !== c.id) continue;
      if (e.px.some((i) => nearOut[i])) continue;
      const ew = e.x1 - e.x0 + 1, eh = e.y1 - e.y0 + 1;
      if (e.n / (ew * eh) < 0.55) continue; // 가늘고 구불구불한 틈(해칭 사이 등)은 구멍이 아님
      // 빈 영역은 선 안쪽 가장자리까지이므로 선 중심까지 반 두께만큼 키운다
      const grow = stroke / 2 + gap;
      const hring = traceComp(e, nx);
      if (!hring) continue;
      const cx = (e.x0 + e.x1 + 1) / 2, cy = (e.y0 + e.y1 + 1) / 2;
      const hp = rdp(hring.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return P([x + (dx / l) * grow, y + (dy / l) * grow]); }), mmPx);
      const round = Math.abs(ew - eh) <= Math.max(2, 0.08 * Math.max(ew, eh)) && Math.abs(e.n / (Math.PI * (ew / 2) * (eh / 2)) - 1) < 0.08;
      const hid = `L${profiles.length + 1}`;
      // 원형 구멍: 빈 영역 바로 바깥 고리의 검은 픽셀까지 거리 평균 = 선 중심 반지름 (흐림·선 굵기에 덜 민감)
      let d = ((ew + eh) / 2 + 2 * grow) * mmPx;
      if (round) {
        const re = (ew + eh) / 4, band = stroke * 2 + gap + 2;
        let sum = 0, cnt = 0;
        for (let y = Math.max(0, Math.floor(cy - re - band)); y <= Math.min(ny - 1, Math.ceil(cy + re + band)); y++)
          for (let x = Math.max(0, Math.floor(cx - re - band)); x <= Math.min(nx - 1, Math.ceil(cx + re + band)); x++) {
            if (!dark[y * nx + x]) continue;
            const rr = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            if (rr >= re - 1 && rr <= re + band) { sum += rr; cnt++; }
          }
        if (cnt > re * 3) d = (2 * sum / cnt) * mmPx;
      }
      if (round) { const [ccx, ccy] = P([cx, cy]); hp.length = 0; for (let q = 0; q < 48; q++) hp.push([+(ccx + (d / 2) * Math.cos((q / 48) * Math.PI * 2)).toFixed(3), +(ccy + (d / 2) * Math.sin((q / 48) * Math.PI * 2)).toFixed(3)]); }
      profiles.push({ id: hid, layer: 'SCAN', source: 'RASTER', role: 'hole', parent: id, area: +Math.abs(polyArea(hp)).toFixed(3), bbox: polyBox(hp), ...(round ? { diameter: +d.toFixed(3) } : {}), points: hp });
      if (round) circles.push({ c: P([cx, cy]), d: +d.toFixed(3) }); else holePolys.push(hp);
    }
    views.push({ id: `V${k + 1}`, box: bb, cbox: bb, silhouettes: [{ pts, exact: false }], circles, holePolys, border: false, raster: true });
  });
  views.forEach((v, i) => { v.id = `V${i + 1}`; });
  const diag = Math.hypot(nx, ny) * mmPx;
  const groups = groupViews(views, Math.max(diag * 0.006, mmPx * 4), []);
  return { profiles, views, groups, stroke, threshold, removed: { frames, lines } };
}

// ── 래스터 유틸 ────────────────────────────────────────────────
export function parsePgm(buf) {
  // P5 <w> <h> <max>\n<data>
  let i = 0; const tok = [];
  while (tok.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[i]))) i++;
    if (buf[i] === 0x23) { while (buf[i] !== 0x0a) i++; continue; }
    let s = ''; while (!/\s/.test(String.fromCharCode(buf[i]))) s += String.fromCharCode(buf[i++]);
    tok.push(s);
  }
  i++;
  if (tok[0] !== 'P5') throw new Error('PGM 형식 오류');
  const w = +tok[1], h = +tok[2], max = +tok[3];
  let data = buf.subarray(i, i + w * h * (max > 255 ? 2 : 1));
  if (max > 255) { const d = new Uint8Array(w * h); for (let k = 0; k < w * h; k++) d[k] = data[k * 2]; data = d; }
  return { w, h, data: new Uint8Array(data) };
}
function shrink({ w, h, data }, f) {
  const W = Math.floor(w / f), H = Math.floor(h / f), o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += data[(y * f + dy) * w + x * f + dx];
    o[y * W + x] = s / (f * f);
  }
  return { w: W, h: H, data: o };
}
export function otsu(data) {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const n = data.length; let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return Math.min(th + 1, 200);
}
/** 선 두께(px): 가로·세로 검은 연속 구간 길이의 중앙값 */
function strokeWidth(m, nx, ny) {
  const runs = new Uint32Array(32);
  for (let y = 0; y < ny; y += 2) { let r = 0; for (let x = 0; x < nx; x++) { if (m[y * nx + x]) r++; else { if (r) runs[Math.min(r, 31)]++; r = 0; } } }
  for (let x = 0; x < nx; x += 2) { let r = 0; for (let y = 0; y < ny; y++) { if (m[y * nx + x]) r++; else { if (r) runs[Math.min(r, 31)]++; r = 0; } } }
  let tot = 0; for (let k = 1; k < 31; k++) tot += runs[k];
  let acc = 0; for (let k = 1; k < 31; k++) { acc += runs[k]; if (acc >= tot / 2) return Math.max(1, k); }
  return 2;
}
/** 연결 성분 (픽셀 목록·경계 상자) */
function label(m, nx, ny, eight) {
  const N = nx * ny, lab = new Int32Array(N), comps = [];
  const q = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!m[s] || lab[s]) continue;
    const id = comps.length + 1; let h = 0, t = 0; q[t++] = s; lab[s] = id;
    let x0 = nx, y0 = ny, x1 = 0, y1 = 0;
    while (h < t) {
      const i = q[h++], x = i % nx, y = (i / nx) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!eight && dx && dy)) continue;
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
        const j = Y * nx + X; if (m[j] && !lab[j]) { lab[j] = id; q[t++] = j; }
      }
    }
    comps.push({ id, n: t, px: Array.from(q.subarray(0, t)), x0, y0, x1, y1 });
  }
  return { lab, comps };
}
/** 성분 하나를 잘라낸 작은 격자에서 외곽 추적 → 전체 격자 좌표 */
function traceComp(c, nx) {
  const pad = 1, w = c.x1 - c.x0 + 1 + pad * 2, h = c.y1 - c.y0 + 1 + pad * 2;
  const m = new Uint8Array(w * h);
  for (const i of c.px) { const x = i % nx, y = (i / nx) | 0; m[(y - c.y0 + pad) * w + (x - c.x0 + pad)] = 1; }
  const ring = traceOuter(m, w, h);
  return ring && ring.map(([x, y]) => [x + c.x0 - pad, y + c.y0 - pad]);
}
/** 정사각 구조 요소 팽창/침식 (가로·세로 분리, 반경 r) — 대각선 방향도 고르게 */
function dil(a, nx, ny, r) { return sep(a, nx, ny, r, true); }
function ero(a, nx, ny, r) { return sep(a, nx, ny, r, false); }
function sep(a, nx, ny, r, isDil) {
  if (r <= 0) return a;
  const t = new Uint8Array(a.length), o = new Uint8Array(a.length);
  for (let y = 0; y < ny; y++) {
    const row = y * nx; let cnt = 0;
    // 창 안의 '1' 개수를 밀어 가며 셈
    for (let x = -r; x < nx; x++) {
      const add = x + r, rem = x - r - 1;
      if (add < nx && a[row + add]) cnt++;
      if (rem >= 0 && a[row + rem]) cnt--;
      if (x >= 0) { const win = Math.min(nx - 1, x + r) - Math.max(0, x - r) + 1; t[row + x] = isDil ? (cnt > 0 ? 1 : 0) : (cnt === win ? 1 : 0); }
    }
  }
  for (let x = 0; x < nx; x++) {
    let cnt = 0;
    for (let y = -r; y < ny; y++) {
      const add = y + r, rem = y - r - 1;
      if (add < ny && t[add * nx + x]) cnt++;
      if (rem >= 0 && t[rem * nx + x]) cnt--;
      if (y >= 0) { const win = Math.min(ny - 1, y + r) - Math.max(0, y - r) + 1; o[y * nx + x] = isDil ? (cnt > 0 ? 1 : 0) : (cnt === win ? 1 : 0); }
    }
  }
  return o;
}

// ── 파일 정보 ──────────────────────────────────────────────────
async function readHead(file) {
  const h = await fs.open(file, 'r');
  try { const b = Buffer.alloc(65536); const { bytesRead } = await h.read(b, 0, b.length, 0); return b.subarray(0, bytesRead); } finally { await h.close(); }
}
/** JPEG(JFIF) · PNG(pHYs) · TIFF 의 해상도. 없거나 72dpi(기본값) 이하면 null */
export function imageDpi(b) {
  let d = null;
  if (b[0] === 0xff && b[1] === 0xd8) {
    const j = b.indexOf(Buffer.from('JFIF\0'));
    if (j > 0) { const unit = b[j + 7], x = b.readUInt16BE(j + 8); d = unit === 1 ? x : unit === 2 ? x * 2.54 : null; }
  } else if (b.subarray(1, 4).toString() === 'PNG') {
    const j = b.indexOf(Buffer.from('pHYs'));
    if (j > 0 && b[j + 12] === 1) d = b.readUInt32BE(j + 4) * 0.0254;
  } else if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) {
    try {
      const le = b[0] === 0x49, u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
      const ifd = u32(4), n = u16(ifd); let res = null, unit = 2;
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12, tag = u16(e);
        if (tag === 282) { const o = u32(e + 8); res = u32(o) / (u32(o + 4) || 1); }
        if (tag === 296) unit = u16(e + 8);
      }
      if (res) d = unit === 3 ? res * 2.54 : unit === 2 ? res : null;
    } catch { /* 해상도 없음 */ }
  }
  return d && d > 72 && d < 2400 ? d : null;
}
async function probeSize(file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { timeout: 30000 });
    const [w, h] = stdout.trim().split(',').map(Number); return w > 0 ? [w, h] : null;
  } catch { return null; }
}
/** OCR: Tesseract 가 있으면 영어(+한국어 데이터가 있으면 한국어)로 흩어진 글자 모드 인식 */
export async function readText(img) {
  const bin = process.env.TESSERACT_PATH || 'tesseract';
  for (const lang of ['kor+eng', 'eng']) {
    try {
      // 페이지 배치 분석(3)은 표제란 문장("SCALE 1:2")에, 흩어진 글자(11)는 치수 숫자에 강하다 — 둘 다 읽어 합친다
      const out = [];
      for (const psm of ['3', '11']) out.push((await run(bin, [img, '-', '--psm', psm, '-l', lang], { timeout: 90000, maxBuffer: 1 << 24 })).stdout);
      return { text: out.join('\n'), engine: `tesseract (${lang})` };
    } catch (e) { if (e.code === 'ENOENT') break; }
  }
  return { text: '', engine: null };
}
