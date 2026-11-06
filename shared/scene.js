// 서버(기본 장면 생성)·브라우저(뷰어)·렌더 워커가 함께 쓰는 분해/타임라인 계산.
// 동일 함수로 계산하므로 화면에서 본 애니메이션과 MP4 결과가 같다.

export const SCENE_VERSION = 1;

/**
 * 기본 분해 방향 제안 (MVP: 조립체 중심 → 부품 중심 방향을 주축으로 스냅).
 * 충돌·이동 가능 방향 검토는 하지 않는다(2단계 자동 분해 경로에서 구현 예정).
 */
export function suggestExplode(parts) {
  if (!parts.length) return {};
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.bbox.min[k]); max[k] = Math.max(max[k], p.bbox.max[k]); }
  const c = min.map((v, k) => (v + max[k]) / 2);
  const half = max.map((v, k) => Math.max((v - min[k]) / 2, 1e-6));
  const S = Math.max(...half) * 2;
  const vol = (p) => p.volume ?? (p.bbox.max[0] - p.bbox.min[0]) * (p.bbox.max[1] - p.bbox.min[1]) * (p.bbox.max[2] - p.bbox.min[2]);
  const vmax = Math.max(...parts.map(vol));
  const base = parts.reduce((a, b) => (vol(b) > vol(a) ? b : a));
  const out = {};
  const ranked = [];
  for (const p of parts) {
    if (p.id === base.id) { out[p.id] = { dir: [0, 0, 1], dist: 0, step: 0 }; continue; }
    const v = p.center.map((x, k) => x - c[k]);
    const n = v.map((x, k) => x / half[k]);
    let ax = 2, best = -1;
    for (let k = 0; k < 3; k++) if (Math.abs(n[k]) > best + 1e-9) { best = Math.abs(n[k]); ax = k; }
    if (best < 0.05) ax = 2;
    const small = vol(p) < vmax * 0.02;
    // 볼트·핀처럼 작고 긴 부품은 자신의 길이 방향(축 방향)으로 뽑는다
    const ext = p.bbox.max.map((v, k) => v - p.bbox.min[k]);
    const longest = ext.indexOf(Math.max(...ext));
    const sorted = [...ext].sort((a, b) => b - a);
    if (small && sorted[0] > sorted[1] * 1.8) ax = longest;
    const dir = [0, 0, 0]; dir[ax] = n[ax] < 0 && Math.abs(n[ax]) >= 0.05 ? -1 : 1;
    const dist = S * (small ? 0.55 : 0.35) + Math.abs(v[ax]) * 0.6;
    out[p.id] = { dir, dist: Math.round(dist * 10) / 10, step: 1 };
    ranked.push({ id: p.id, small, outer: Math.abs(n[ax]) });
  }
  // 단계: 체결부품(소형) 먼저 → 바깥쪽 부품 → 안쪽 부품 (최대 4단계)
  const smalls = ranked.filter((r) => r.small), bigs = ranked.filter((r) => !r.small).sort((a, b) => b.outer - a.outer);
  const first = smalls.length ? 1 : 0;
  smalls.forEach((r) => { out[r.id].step = 1; });
  const buckets = Math.min(3, Math.max(1, bigs.length));
  bigs.forEach((r, i) => { out[r.id].step = first + 1 + Math.floor((i * buckets) / bigs.length); });
  return out;
}

// 프로젝트 업종 → 기본 쇼룸 템플릿 (web/src/engine/stage.ts INDUSTRY_TEMPLATE 과 같게)
export const INDUSTRY_TEMPLATE = { mold: 'mold', machine: 'machine', electric: 'electronics', building: 'building', product: 'gallery' };

export function defaultScene(parts, name, industry) {
  const ex = suggestExplode(parts);
  return {
    v: SCENE_VERSION,
    title: name,
    viewMode: 'showroom',
    background: INDUSTRY_TEMPLATE[industry] || 'studio',
    parts: Object.fromEntries(parts.map((p) => [p.id, { explode: ex[p.id] }])),
    explode: { factor: 1, stepDuration: 1 },
    camera: null,
    animation: {
      clips: [
        { type: 'hold', duration: 1 },
        { type: 'explode', duration: 4 },
        { type: 'turntable', duration: 5, degrees: 180 },
        { type: 'assemble', duration: 4 },
        { type: 'hold', duration: 1 },
      ],
    },
    explodeNote: '기본 방향 제안: 충돌 미검토(수동 수정 가능)',
  };
}

export const stepCount = (scene) =>
  Math.max(0, ...Object.values(scene.parts || {}).map((p) => (!p.deleted && p.explode?.dist > 0 ? p.explode.step || 0 : 0)));

export const totalDuration = (scene) => (scene.animation?.clips || []).reduce((s, c) => s + Math.max(0, +c.duration || 0), 0);

/** 시각 t(초)에서 분해 진행값 e∈[0,steps] 와 카메라 방위각 오프셋(도)을 계산 */
export function evalTimeline(scene, t) {
  const S = stepCount(scene);
  let e = 0, az = 0, acc = 0;
  for (const clip of scene.animation?.clips || []) {
    const d = Math.max(0, +clip.duration || 0);
    const local = d > 0 ? Math.min(1, Math.max(0, (t - acc) / d)) : 1;
    if (t < acc) break;
    if (clip.type === 'explode') e = S * local;
    else if (clip.type === 'assemble') e = S * (1 - local);
    else if (clip.type === 'turntable') az += (clip.degrees ?? 360) * local;
    acc += d;
  }
  return { e, azimuth: az };
}

const smooth = (x) => x * x * (3 - 2 * x);

/** 부품 하나의 분해 이동량(모델 단위) */
export function partOffset(cfg, e, factor = 1) {
  const ex = cfg?.explode;
  if (!ex || !(ex.dist > 0) || !ex.step) return [0, 0, 0];
  const k = Math.min(1, Math.max(0, e - (ex.step - 1)));
  const s = smooth(k) * ex.dist * factor;
  const l = Math.hypot(...ex.dir) || 1;
  return ex.dir.map((d) => (d / l) * s);
}
