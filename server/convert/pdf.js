// PDF 도면 분석: 1쪽 벡터 선(Poppler pdftocairo → SVG)을 닫힌 윤곽으로 해석, 글자(pdftotext), 미리보기(pdftoppm).
// PDF 에는 실제 치수 단위가 없으므로(용지 좌표) 축척 1:N 을 사용자가 확정해야 3D 생성이 된다.
// 스캔(이미지) PDF 는 벡터가 없어 3D 생성 불가 — OCR·AI 형상 재구성은 3단계.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildProfiles } from './profiles.js';
import { analyzeRaster, readText } from './raster.js';

const run = promisify(execFile);
const PT2MM = 25.4 / 72;

export async function analyzePdf(file) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eum3d-pdf-'));
  try {
    let info;
    try { info = (await run('pdfinfo', [file], { timeout: 30000 })).stdout; }
    catch (e) { throw new Error('PDF 를 열지 못했습니다 (암호화·손상 여부 확인): ' + (e.stderr || e.message).toString().slice(0, 200)); }
    const pages = +(/Pages:\s+(\d+)/.exec(info)?.[1] || 1);
    const [pw, ph] = (/Page size:\s+([\d.]+) x ([\d.]+)/.exec(info) || [0, 595, 842]).slice(1).map(Number);
    await run('pdftocairo', ['-svg', '-nocenter', '-noshrink', '-origpagesizes', '-f', '1', '-l', '1', file, path.join(dir, 'p.svg')], { timeout: 120000, maxBuffer: 1 << 28 });
    const svg = await fs.readFile(path.join(dir, 'p.svg'), 'utf8');
    let text = (await run('pdftotext', ['-f', '1', '-l', '1', '-layout', file, '-'], { timeout: 60000, maxBuffer: 1 << 26 }).catch(() => ({ stdout: '' }))).stdout;
    await run('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '1', '-singlefile', file, path.join(dir, 'prev')], { timeout: 60000 }).catch(() => {});
    const preview = await fs.readFile(path.join(dir, 'prev.png')).catch(() => null);

    // 회전(/Rotate 90·270)된 페이지는 SVG 가 회전을 적용한 화면 기준으로 나오므로 용지 크기도 SVG 기준을 쓴다
    const vb = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
    const rot = +(/Page rot:\s+(\d+)/.exec(info)?.[1] || 0);
    const [W, H] = vb ? [Number(vb[1]), Number(vb[2])] : rot % 180 ? [ph, pw] : [pw, ph];
    const g = parseSvg(svg, H);
    const imgList = (await run('pdfimages', ['-list', '-f', '1', '-l', '1', file], { timeout: 30000 }).catch(() => ({ stdout: '' }))).stdout;
    g.images = Math.max(g.images, imgList.split('\n').slice(2).filter((l) => l.trim()).length);
    // 스캔(이미지) PDF: 픽셀에서 외형을 따내는 래스터 분석으로 전환
    if (g.strokes === 0 && g.images > 0) {
      const r = await analyzeRaster(file, 'pdf');
      r.analysis.pages = pages;
      if (pages > 1) r.analysis.warnings.push(`전체 ${pages}쪽 중 1쪽만 분석했습니다.`);
      return { analysis: r.analysis, preview: preview || r.preview };
    }
    const { profiles, openChains, truncated, views, groups } = buildProfiles(g.loops, g.open, PT2MM, { w: W, h: H }, 0.05);
    // AutoCAD SHX 글꼴처럼 글자가 선으로 그려진 PDF 는 글자 층이 비어 있다 → 그림으로 찍어 OCR
    let ocr = null;
    if (!/\d/.test(text) && g.strokes > 0) {
      await run('pdftoppm', ['-gray', '-r', '200', '-f', '1', '-l', '1', '-singlefile', file, path.join(dir, 'ocr')], { timeout: 120000 }).catch(() => {});
      const o = await readText(path.join(dir, 'ocr.pgm')).catch(() => ({ text: '', engine: null }));
      if (o.text) { text = o.text; ocr = o.engine; }
    }
    const texts = text.split(/\r?\n/).map((s) => s.trim().replace(/\s{2,}/g, ' ')).filter(Boolean).slice(0, 200);
    const m = /(?:SCALE|S|축척)\s*[:=]?\s*1\s*[:/]\s*(\d+(?:\.\d+)?)/i.exec(text) || /\b1\s*:\s*(\d+(?:\.\d+)?)\b/.exec(text);
    const numbers = [...new Set((text.match(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g) || []).map(Number).filter((n) => n >= 1 && n < 100000))].slice(0, 300);
    const vector = g.strokes > 0;
    const outer = profiles.filter((p) => p.role === 'outer');
    const sheet = outer.length > 20; // 여러 상세·투상도가 그려진 도면
    return {
      analysis: {
        format: 'PDF', is3D: false, pages, page: { width: +(W * PT2MM).toFixed(2), height: +(H * PT2MM).toFixed(2), rotation: rot },
        unit: '용지 mm (축척 미확정)', unitScaleToMm: null, scaleRequired: true,
        scaleHint: m ? Number(m[1]) : null,
        coordinateSystem: '1쪽 용지 좌표 (왼쪽 아래 원점)',
        sheet,
        pdfType: vector ? 'vector' : g.images ? 'scanned' : 'empty',
        layers: [], entityCounts: { 실선: g.strokes, 점선: g.dashed, 채움: g.filled, 이미지: g.images },
        profiles, views, groups, dimensions: [], texts, numbers, openChains,
        // 화살표로 찾은 치수선 길이(용지 mm) — 치수 숫자와 비교해 축척을 추정
        dimLines: g.dims.map((d) => +(d.len * PT2MM).toFixed(2)).filter((x) => x > 1).slice(0, 300),
        ...(ocr ? { ocr } : {}),
        convertible: vector && outer.length > 0,
        needsUserInput: ['scale', 'thickness'],
        hasPreview: !!preview,
        warnings: [
          ...(!vector ? [g.images ? '스캔(이미지) PDF 입니다. 벡터 선이 없어 3D 를 만들 수 없습니다. OCR·AI 형상 재구성은 3단계 기능입니다.' : 'PDF 에서 도면 선을 찾지 못했습니다.'] : []),
          ...(sheet ? [`닫힌 외곽이 ${outer.length}개인 상세도·조립도입니다. 돌출 3D 는 판재처럼 한 윤곽에 두께를 주는 형상에만 맞습니다. 돌출할 외곽을 직접 클릭해 고르세요(자동 선택 안 함). 조립 상세의 입체 형상은 STEP 등 3D 원본이 필요합니다.`] : []),
          ...(pages > 1 ? [`전체 ${pages}쪽 중 1쪽만 분석했습니다.`] : []),
          ...(g.dashed ? [`점선 ${g.dashed}개(중심선·숨은선)와 채움 도형 ${g.filled}개(화살표 등)는 윤곽에서 제외했습니다.`] : []),
          ...(truncated ? ['닫힌 윤곽이 너무 많아 큰 순서로 3000개만 표시합니다.'] : []),
          'PDF 는 용지 좌표이므로 축척(1:N)이 필요합니다. 도면 글자·치수 숫자로 자동 추정한 값을 확인하세요.',
          '2D 도면에는 두께(깊이) 정보가 없습니다. 투상도가 하나뿐이면 두께를 추정해 참고용 3D 를 만듭니다.',
        ],
      },
      preview,
    };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

/** Cairo SVG → 실선 경로를 닫힌 고리/열린 선분으로 (y 를 위쪽 양수로 뒤집음, 단위 pt) */
export function parseSvg(svg, pageH) {
  const loops = [], open = [], arrows = [];
  let strokes = 0, dashed = 0, filled = 0, images = 0;
  const stack = [[1, 0, 0, 1, 0, 0]];
  let skip = 0; // defs/symbol/clipPath 안쪽 깊이
  const SKIP = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker']);
  const re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g;
  let mt;
  while ((mt = re.exec(svg))) {
    const [, close, tag, attrs, self] = mt;
    if (close) { if (SKIP.has(tag)) skip--; else if (tag === 'g' && !skip) stack.pop(); continue; }
    if (SKIP.has(tag)) { if (!self) skip++; continue; }
    if (skip) continue;
    const A = (n) => new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(attrs)?.[1] ?? new RegExp(`(?:^|;|")\\s*${n}\\s*:\\s*([^;"]+)`).exec(attrs)?.[1];
    if (tag === 'g') { if (!self) stack.push(mul(stack[stack.length - 1], parseTransform(A('transform')))); continue; }
    if (tag === 'image') { images++; continue; }
    if (tag !== 'path') continue;
    const stroke = A('stroke'), fill = A('fill');
    const M = mul(stack[stack.length - 1], parseTransform(A('transform')));
    const toPage = ([x, y]) => { const X = M[0] * x + M[2] * y + M[4], Y = M[1] * x + M[3] * y + M[5]; return [X, pageH - Y]; };
    // 작게 채운 도형 = 치수선 화살표 (AutoCAD 출력 PDF 는 선 굵기·색이 모두 같아 화살표로 치수선을 구분한다)
    if (fill && fill !== 'none') {
      const subs = parsePath(A('d') || '');
      const pts = subs.flatMap((sp) => sp.pts.map(toPage));
      if (pts.length >= 3 && pts.length <= 8) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const bb = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
        if (Math.max(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1]) < 14) {
          // 화살 방향: 무게중심에서 가장 먼 꼭짓점(끝) ← 나머지의 중점
          const u = pts.filter((p, i) => pts.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05) === i); // 겹친 꼭짓점 제거
          const c = [u.reduce((t, p) => t + p[0], 0) / u.length, u.reduce((t, p) => t + p[1], 0) / u.length];
          const tip = u.reduce((m, p) => (Math.hypot(p[0] - c[0], p[1] - c[1]) > Math.hypot(m[0] - c[0], m[1] - c[1]) ? p : m), u[0]);
          const ax = [tip[0] - c[0], tip[1] - c[1]], al = Math.hypot(...ax) || 1;
          arrows.push({ bb, pts, tip, axis: [ax[0] / al, ax[1] / al] }); filled++; continue;
        }
      }
      if (!stroke || stroke === 'none') { filled++; continue; }
    }
    if (!stroke || stroke === 'none') continue;
    const da = A('stroke-dasharray');
    if (da && da !== 'none') { dashed++; continue; }
    strokes++;
    for (const sp of parsePath(A('d') || '')) {
      const pts = sp.pts.map(toPage);
      if (pts.length < 2) continue;
      const f = pts[0], l = pts[pts.length - 1];
      const closed = sp.closed || (pts.length > 2 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.05);
      if (closed) { if (!sp.closed) pts.pop(); if (pts.length >= 3) loops.push({ layer: 'PDF', source: 'PDF_PATH', pts }); }
      else for (let i = 0; i < pts.length - 1; i++) open.push({ layer: 'PDF', a: pts[i], b: pts[i + 1], pts: [pts[i], pts[i + 1]] });
    }
  }
  const dim = stripDimensions(open, arrows);
  return { loops, open: dim.open, dims: dim.dims, strokes, dashed, filled, images };
}

/**
 * 치수선·치수 보조선 제거: 화살표에 닿는 직선 = 치수선, 치수선 끝(화살표)을 지나며 수직인 직선 = 보조선.
 * 남겨 두면 외형선과 함께 닫힌 영역을 만들어 투상도 외형이 치수까지 부풀어 오른다.
 * @returns {open: 남은 선분, dims: [{a,b,len}] 치수선(용지 pt) — 축척 추정에 쓴다}
 */
export function stripDimensions(open, arrows) {
  if (!arrows.length) return { open, dims: [] };
  const near = (p, bb, e) => p[0] >= bb[0][0] - e && p[0] <= bb[1][0] + e && p[1] >= bb[0][1] - e && p[1] <= bb[1][1] + e;
  const len = (s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  const dir = (s) => { const l = len(s) || 1; return [(s.b[0] - s.a[0]) / l, (s.b[1] - s.a[1]) / l]; };
  const segDist = (p, s) => {
    const [dx, dy] = [s.b[0] - s.a[0], s.b[1] - s.a[1]], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l2));
    return Math.hypot(p[0] - s.a[0] - t * dx, p[1] - s.a[1] - t * dy);
  };
  const isDim = new Uint8Array(open.length);
  const dims = [];
  open.forEach((s, i) => {
    if (len(s) < 2) return;
    // 화살표에 닿고 화살 방향과 나란한 선만 치수선 (화살 끝을 지나는 보조선은 수직이라 제외)
    const d = dir(s);
    const par = (a) => !a.axis || Math.abs(d[0] * a.axis[1] - d[1] * a.axis[0]) < 0.12;
    if (arrows.some((a) => par(a) && (near(s.a, a.bb, 0.6) || near(s.b, a.bb, 0.6)))) { isDim[i] = 1; dims.push(s); }
  });
  // 치수선과 일직선으로 이어진 조각(글자 자리에서 끊긴 치수선)
  for (let pass = 0; pass < 2; pass++) open.forEach((s, i) => {
    if (isDim[i] || len(s) < 1) return;
    const d = dir(s);
    for (const m of dims) {
      const e = dir(m);
      if (Math.abs(d[0] * e[1] - d[1] * e[0]) > 0.01) continue;
      const off = Math.abs((s.a[0] - m.a[0]) * e[1] - (s.a[1] - m.a[1]) * e[0]); // 치수선 연장선까지 거리
      if (off < 0.3 && Math.min(segDist(s.a, m), segDist(s.b, m)) < 0.3) { isDim[i] = 1; dims.push(s); break; }
    }
  });
  // 보조선: 화살표 끝(또는 치수선 끝)을 지나고 치수선에 수직
  const tips = [...arrows.filter((a) => a.tip).map((a) => ({ p: a.tip, e: a.axis })), ...dims.flatMap((m) => [{ p: m.a, e: dir(m) }, { p: m.b, e: dir(m) }])];
  open.forEach((s, i) => {
    if (isDim[i]) return;
    const d = dir(s);
    for (const t of tips) if (Math.abs(d[0] * t.e[0] + d[1] * t.e[1]) < 0.06 && segDist(t.p, s) < 1.2) { isDim[i] = 2; break; }
  });
  // 치수 길이 = 양 끝 화살표 끝 사이 (치수선은 화살표 밑동에서 끝나는 경우가 많다)
  const tipAt = (p) => arrows.find((a) => a.tip && near(p, a.bb, 0.6))?.tip || p;
  return { open: open.filter((_, i) => !isDim[i]), dims: dims.map((s) => { const a = tipAt(s.a), b = tipAt(s.b); return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) }; }) };
}

function parseTransform(t) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    const n = fn === 'matrix' ? a : fn === 'translate' ? [1, 0, 0, 1, a[0], a[1] || 0] : fn === 'scale' ? [a[0], 0, 0, a[1] ?? a[0], 0, 0] : null;
    if (n) m = mul(m, n);
  }
  return m;
}
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

function parsePath(d) {
  const tok = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const subs = []; let cur = null; let x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
  const num = () => Number(tok[i++]);
  const start = () => { cur = { pts: [[x, y]], closed: false }; subs.push(cur); };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); sx = x; sy = y; start(); cmd = rel ? 'l' : 'L'; break;
      case 'L': x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); cur ? cur.pts.push([x, y]) : start(); break;
      case 'H': x = (rel ? x : 0) + num(); cur?.pts.push([x, y]); break;
      case 'V': y = (rel ? y : 0) + num(); cur?.pts.push([x, y]); break;
      case 'C': {
        const p = [num(), num(), num(), num(), num(), num()];
        const [x1, y1, x2, y2, x3, y3] = rel ? p.map((v, k) => v + (k % 2 ? y : x)) : p;
        for (let k = 1; k <= 12; k++) {
          const t = k / 12, u = 1 - t;
          cur?.pts.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
        }
        x = x3; y = y3; break;
      }
      case 'Q': {
        const p = [num(), num(), num(), num()];
        const [x1, y1, x2, y2] = rel ? p.map((v, k) => v + (k % 2 ? y : x)) : p;
        for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; cur?.pts.push([u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2]); }
        x = x2; y = y2; break;
      }
      case 'Z': if (cur) cur.closed = true; x = sx; y = sy; cur = null; break;
      default: i++; // 지원하지 않는 명령(S/T/A) 건너뜀
    }
  }
  return subs;
}
