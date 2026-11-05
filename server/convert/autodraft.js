// 업로드 즉시 자동 3D 초안 — 2D 도면만 올려도 바로 쇼룸에서 볼 수 있게 한다.
//  · 정면·평면·측면이 짝지어지면 투상도 결합(Visual Hull)
//  · 아니면 판재처럼 주요 외곽을 돌출
//  · 도면에 없는 값(축척·두께)은 도면 글자 → 치수 숫자 비교 → 기본값 순으로 추정하고 근거를 남긴다
// 결과는 항상 '참고용 AI 3D 시각화'(검토 대기)이며, 사용자가 값을 고쳐 다시 만들 수 있다.
import { reconstructViews } from './reconstruct.js';
import { extrude2d } from './profiles.js';

const STD_SCALES = [1, 2, 2.5, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 250, 300, 400, 500, 1000, 0.5, 0.2, 0.1];
const STD_T = [0.5, 0.8, 1, 1.2, 1.6, 2, 2.3, 3, 3.2, 4, 4.5, 5, 6, 8, 9, 10, 12, 15, 16, 19, 20, 22, 25, 28, 30, 32, 36, 40, 45, 50, 60, 70, 80, 100, 120, 150, 200];

/** 도면에서 잰 길이(용지 mm) 목록: 투상도 가로·세로, 외곽 가로·세로, 구멍 지름 */
function measured(a) {
  const L = [];
  for (const v of a.views || []) { L.push(v.box[1][0] - v.box[0][0], v.box[1][1] - v.box[0][1]); for (const c of v.circles || []) L.push(c.d); }
  const outers = (a.profiles || []).filter((p) => p.role === 'outer').sort((x, y) => y.area - x.area).slice(0, 12);
  for (const p of outers) L.push(p.bbox[1][0] - p.bbox[0][0], p.bbox[1][1] - p.bbox[0][1]);
  for (const p of (a.profiles || []).filter((q) => q.role === 'hole' && q.diameter).slice(0, 40)) L.push(p.diameter);
  for (const d of a.dimLines || []) L.push(d); // 치수선 길이 × 축척 = 치수 숫자 (가장 확실한 근거)
  return L.filter((x) => x > 0.5);
}

/**
 * 축척 1:N 추정.
 * @returns {{scale:number, source:'drawing'|'ai'|'default'|'none', support?:number, why:string}}
 */
export function estimateScale(a) {
  if (!a.scaleRequired) return { scale: 1, source: 'none', why: '도면 단위가 실제 mm' };
  const L = measured(a);
  // 축척 표기 자체의 숫자(1, N)와 너무 작은 숫자(번호·개수일 가능성)는 비교에서 뺀다
  const nums = (a.numbers || []).filter((n) => n >= 3 && n < 100000 && n !== a.scaleHint);
  const hits = (N) => nums.filter((n) => L.some((l) => Math.abs(l * N - n) <= Math.max(0.6, n * 0.015))).length;
  if (a.scaleHint > 0 && (hits(a.scaleHint) > 0 || !nums.length)) return { scale: a.scaleHint, source: 'drawing', support: hits(a.scaleHint), why: `도면 글자 "1:${a.scaleHint}"` };
  let best = null;
  // 확대 축척(1:0.5 등)은 근거가 더 많을 때만
  for (const N of STD_SCALES) { const h = hits(N); if (h > 0 && (!best || h > best.h) && (N >= 1 || h >= 3)) best = { N, h }; }
  if (best && (best.h >= 2 || !a.scaleHint)) return { scale: best.N, source: 'ai', support: best.h, why: `치수 숫자 ${best.h}개가 1:${best.N} 에서 도면 길이와 일치` };
  if (a.scaleHint > 0) return { scale: a.scaleHint, source: 'drawing', support: 0, why: `도면 글자 "1:${a.scaleHint}" (치수 숫자로 확인 못 함)` };
  // 표준 축척이 아닌 경우(사진·임의 배율 이미지): 숫자/길이 비율이 2개 이상 겹치는 값
  const cand = [];
  for (const n of nums) for (const l of L) if (l > 2) cand.push(n / l);
  cand.sort((x, y) => x - y);
  let pick = null;
  for (let i = 0; i < cand.length; i++) {
    let j = i; while (j + 1 < cand.length && cand[j + 1] <= cand[i] * 1.02) j++;
    if (j - i + 1 >= 2 && (!pick || j - i > pick.n)) pick = { v: cand[(i + j) >> 1], n: j - i };
  }
  if (pick) {
    const snap = STD_SCALES.find((s) => Math.abs(s - pick.v) / s < 0.03);
    const v = snap || +pick.v.toPrecision(3);
    return { scale: v, source: 'ai', support: pick.n + 1, why: `치수 숫자와 도면 길이 비율 ${pick.n + 1}건 일치` };
  }
  return { scale: 1, source: 'default', why: '축척 표기·치수 숫자를 찾지 못해 1:1 로 가정' };
}

/** 두께: 도면 글자(t=6, T6, THK 6, 두께 6) → 없으면 외형 짧은 변의 약 5% 를 표준 판두께로 */
export function estimateThickness(a, outers, k) {
  const lines = [...(a.texts || []), ...(a.dimensions || []).map((d) => d.text || '')];
  const re = /(?:^|[^A-Za-z])(?:t|THK|THICK(?:NESS)?|두께)[ \t]*[=:.]?[ \t]*(\d+(?:\.\d+)?)[ \t]*(?:mm)?/i;
  const joined = lines.join(' ').replace(/\s+/g, ' ');
  const mj = /(?:^|[^A-Za-z])(?:t|THK|THICK(?:NESS)?|두께) ?[=:] ?(\d+(?:\.\d+)?)/i.exec(joined);
  if (mj && +mj[1] > 0 && +mj[1] < 1000) return { thickness: +mj[1], source: 'drawing', why: `도면 글자 "${mj[0].trim()}"` };
  for (let i = 0; i < lines.length; i++) {
    // OCR 이 "t=6" 을 "t" / "6" 두 줄로 나누는 경우도 있다
    const m = re.exec(lines[i]) || (/^(?:t|THK|두께)\s*=?$/i.test(lines[i]) && /^\d+(?:\.\d+)?$/.test(lines[i + 1] || '') ? [lines[i] + lines[i + 1], lines[i + 1]] : null);
    if (m && +m[1] > 0 && +m[1] < 1000) return { thickness: +m[1], source: 'drawing', why: `도면 글자 "${m[0].trim()}"` };
  }
  const short = Math.min(...outers.map((o) => Math.min(o.bbox[1][0] - o.bbox[0][0], o.bbox[1][1] - o.bbox[0][1]) * k));
  const raw = Math.max(0.5, short * 0.05);
  const t = STD_T.reduce((p, c) => (Math.abs(c - raw) < Math.abs(p - raw) ? c : p));
  return { thickness: t, source: 'ai', why: `두께 표기가 없어 외형 짧은 변(${short.toFixed(0)} mm)의 약 5% 로 추정` };
}

/**
 * @returns {Promise<{result, draft} | {skipped:string}>}
 */
/**
 * 자동 초안에 쓸 물체(투상도 그룹): 가장 완전한(뷰가 많은·큰) 그룹 + 그와 같은 투상 줄에 놓인 그룹.
 * 한 장에 함께 그린 구성도·결선도·부품 상세 같은 다른 그림은 줄이 맞지 않아 빠진다 (화면에서 추가 가능).
 */
export function mainGroups(groups, views) {
  const ok = groups.filter((g) => views[g.front] && (views[g.top] || views[g.side]));
  if (ok.length < 2) return ok;
  const n = (g) => (g.top ? 1 : 0) + (g.side ? 1 : 0);
  const area = (v) => (v.box[1][0] - v.box[0][0]) * (v.box[1][1] - v.box[0][1]);
  const main = [...ok].sort((x, y) => n(y) - n(x) || area(views[y.front]) - area(views[x.front]))[0];
  const F = views[main.front];
  const rowOverlap = (a, b) => { const i = Math.min(a.box[1][1], b.box[1][1]) - Math.max(a.box[0][1], b.box[0][1]); return i > 0 ? i / Math.min(a.box[1][1] - a.box[0][1], b.box[1][1] - b.box[0][1]) : 0; };
  // 같은 줄: 정면도끼리 세로 구간이 겹치고 바닥선이 거의 같음
  const tol = (F.box[1][1] - F.box[0][1]) * 0.08;
  return ok.filter((g) => g === main || (rowOverlap(views[g.front], F) > 0.5 && Math.abs(views[g.front].box[0][1] - F.box[0][1]) < tol));
}

export async function autoDraft(a, name) {
  const sc = estimateScale(a);
  const scaleSrc = sc.source === 'none' ? undefined : sc.source;
  const views = Object.fromEntries((a.views || []).map((v) => [v.id, v]));
  const usable = mainGroups(a.groups || [], views);
  if (usable.length) {
    try {
      let result = await reconstructViews(a, { scale: sc.scale, groups: usable, sources: { scale: scaleSrc } }, name);
      // 부품별 분할 결과가 외형을 다 채우지 못하면(내부 칸막이·노크아웃이 많은 외함 등) 외형 한 덩어리가 더 정확하다
      const whole = await reconstructViews(a, { scale: sc.scale, groups: usable, mode: 'outline', sources: { scale: scaleSrc } }, name).catch(() => null);
      if (whole) {
        const fits = result.stats.size.every((v, i) => Math.abs(v - whole.stats.size[i]) <= Math.max(whole.stats.size[i] * 0.06, 1));
        const vol = (r) => r.parts.reduce((t, p) => t + (p.volume || 0), 0);
        if (!fits || vol(result) < vol(whole) * 0.5) { result = whole; result.provenance = { ...result.provenance, note: result.provenance.note + ' 부품별로 나누면 외형이 채워지지 않아 외형 한 덩어리로 만들었습니다.' }; }
      }
      const skipped = (a.groups || []).length - usable.length;
      return { result, draft: { kind: 'views', scale: sc, groups: usable.length, ...(skipped > 0 ? { skippedGroups: skipped } : {}) } };
    } catch (e) { if (!(e.status === 400)) throw e; /* 교차 결과가 비면 돌출로 */ }
  }
  const outers = (a.profiles || []).filter((p) => p.role === 'outer' && !p.parent).sort((x, y) => y.area - x.area);
  if (!outers.length) return { skipped: '닫힌 외곽 윤곽이 없어 자동 3D 를 만들지 못했습니다' };
  // 표제란·부품표 사각형은 도곽에 붙어 있다 → 도곽에 닿지 않은 투상도 안의 외곽만
  const inView = (o) => {
    const c = [(o.bbox[0][0] + o.bbox[1][0]) / 2, (o.bbox[0][1] + o.bbox[1][1]) / 2];
    return (a.views || []).some((v) => !v.border && c[0] >= v.box[0][0] && c[0] <= v.box[1][0] && c[1] >= v.box[0][1] && c[1] <= v.box[1][1]);
  };
  let cand = a.views?.length ? outers.filter(inView) : outers;
  if (!cand.length) cand = outers.slice(0, 1);
  const pick = cand.filter((o) => o.area >= cand[0].area * 0.05);
  if (a.sheet || pick.length > 12) return { skipped: `외곽이 ${pick.length}개인 상세도·조립도라 자동으로 고르지 않았습니다. [3D 변환]에서 돌출할 외곽을 고르세요` };
  const th = estimateThickness(a, pick, sc.scale);
  const result = await extrude2d(a, { thickness: th.thickness, scale: sc.scale, profiles: pick.map((p) => p.id), sources: { scale: scaleSrc, thickness: th.source } }, name);
  // 두께를 도면에서 읽고 축척도 확인된 경우에도 자동 초안은 검토 대상으로 둔다
  result.provenance = { ...result.provenance, geometry: 'estimated', review: 'pending', reference: true,
    note: result.provenance.note || '참고용 AI 3D 시각화 — 자동으로 만든 초안입니다. 값(두께·축척)을 확인하고 승인하세요.' };
  return { result, draft: { kind: 'extrude', scale: sc, thickness: th, profiles: pick.map((p) => p.id) } };
}
