// AI 도면 해석 (Claude 비전) → 부품 목록 → 3D 조립.
//  AI 는 '무엇이 그려져 있는지'(제품 종류·부품·치수·위치)만 판단하고, 형상은 이 프로그램이 상자·외함·원기둥·구멍으로 만든다.
//  치수는 도면에 적힌 숫자를 쓰도록 지시하고, 적혀 있지 않은 값은 AI 추정으로 표시한다.
//  고객사가 '외부 AI 도면 해석'을 허용하고 서버에 ANTHROPIC_API_KEY 가 있을 때만 동작한다.
import manifoldInit from 'manifold-3d';
import { writeGlb, summarize } from './gltf-writer.js';
import { meshOf } from './reconstruct.js';

export const aiConfig = () => ({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
});
export const aiAvailable = () => !!aiConfig().apiKey;

const MATERIALS = ['steel', 'painted', 'stainless', 'aluminum', 'plastic', 'rubber', 'glass', 'copper', 'wood'];
const XYZ = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
export const TOOL = {
  name: 'build_showroom_model',
  description: '도면을 해석한 결과로 쇼룸용 3D 모델을 만든다. 모든 길이는 mm.',
  input_schema: {
    type: 'object', required: ['product', 'overall', 'parts'],
    properties: {
      product: { type: 'string', description: '제품 종류 (예: 매입형 분전함, 사출금형 조립체, 브라켓 판)' },
      overall: { ...XYZ, description: '전체 크기 [폭 X, 깊이 Y, 높이 Z] mm' },
      views: { type: 'string', description: '해석에 쓴 투상도 (예: 정면·저면·우측면, 3각법)' },
      ignored: { type: 'array', items: { type: 'string' }, description: '3D 로 만들지 않은 그림 (구성도·결선도·표제란·부품표 등)' },
      assumptions: { type: 'array', items: { type: 'string' }, description: '도면에 적혀 있지 않아 추정한 값과 이유' },
      parts: {
        type: 'array', minItems: 1, maxItems: 80,
        items: {
          type: 'object', required: ['name', 'shape', 'position'],
          properties: {
            name: { type: 'string', description: '부품 이름 (한국어)' },
            shape: { type: 'string', enum: ['box', 'shell', 'cylinder'], description: 'box=속이 찬 직육면체/판, shell=속이 빈 상자(외함·케이스, 한 면이 열림), cylinder=원기둥(핀·볼트·축·부시)' },
            position: { ...XYZ, description: 'box/shell: 가장 작은 X·Y·Z 모서리 좌표, cylinder: 시작 면의 중심 좌표' },
            size: { ...XYZ, description: 'box/shell: [폭 X, 깊이 Y, 높이 Z]' },
            cornerRadius: { type: 'number', description: 'box/shell: 정면에서 보이는 모서리 둥글기 반지름 (없으면 0)' },
            wall: { type: 'number', description: 'shell: 벽 두께 (판금이면 1.2~2)' },
            open: { type: 'string', enum: ['front', 'back', 'top', 'bottom', 'left', 'right', 'none'], description: 'shell: 열린 면' },
            diameter: { type: 'number', description: 'cylinder: 지름' },
            length: { type: 'number', description: 'cylinder: 길이' },
            axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'cylinder: 축 방향' },
            material: { type: 'string', enum: MATERIALS },
            color: { type: 'string', description: '#RRGGBB (선택)' },
            holes: {
              type: 'array', description: '이 부품을 관통하는 구멍 (노크아웃·볼트 구멍·창)',
              items: { type: 'object', required: ['axis', 'center'], properties: {
                shape: { type: 'string', enum: ['circle', 'rect'] },
                diameter: { type: 'number' }, width: { type: 'number' }, height: { type: 'number', description: 'rect: 축에 수직인 두 변 (axis=z 면 width=X, height=Y / axis=y 면 width=X, height=Z / axis=x 면 width=Y, height=Z)' },
                axis: { type: 'string', enum: ['x', 'y', 'z'] }, center: { ...XYZ, description: '구멍 중심 (축 방향 좌표는 무시, 부품을 관통)' },
              } },
            },
            explode: { type: 'string', enum: ['front', 'back', 'up', 'down', 'left', 'right', 'none'], description: '분해도에서 이 부품을 빼는 방향' },
            explodeStep: { type: 'integer', description: '분해 순서 (1 이 먼저)' },
            sourceDims: { type: 'array', items: { type: 'number' }, description: '이 부품에 쓴 도면 치수 숫자' },
          },
        },
      },
    },
  },
};

export const SYSTEM = `너는 산업용 도면(금형·분전반·기계·판금·건축 설비)을 읽고 고객 홍보용 3D 쇼룸 모델을 만드는 엔지니어다.
목표는 '보여주기'다. 정밀 설계가 아니라, 도면에 적힌 치수대로 보이는 형상을 만든다.
규칙:
- 좌표계: 원점 = 제품 전체의 왼쪽·앞·아래 모서리. X = 정면도에서 오른쪽(폭), Y = 뒤쪽(깊이), Z = 위(높이). 단위 mm.
- 치수는 도면에 적힌 숫자를 그대로 쓴다. 적혀 있지 않은 치수는 그림 비율로 추정하고 assumptions 에 적는다.
- 3각법(정면도 위=평면도, 아래=저면도, 오른쪽=우측면도)을 기본으로 보되, 그림 배치로 1각법이면 그에 맞게 해석한다.
- 외형도·조립도의 제품만 만든다. 구성도·결선도·회로도·표제란·부품표·상세 확대도는 ignored 에 적고 만들지 않는다.
- 부품을 나눠라: 외함과 커버, 문과 손잡이, 금형 판·핀처럼 실제로 분리되는 단위로. 각 부품의 explode 방향도 정한다.
- 속이 빈 외함·케이스·박스는 shell 로, 판·블록은 box 로, 핀·볼트·축은 cylinder 로.
- 노크아웃·볼트 구멍은 holes 로 넣는다. 너무 작은 것(지름 3mm 미만)이나 수백 개 반복은 대표적인 것만.
- 부품끼리 겹치지 않게, 맞닿는 면은 같은 좌표로 맞춘다.
반드시 build_showroom_model 도구 한 번으로 답한다.`;

/** 도면 그림 + 프로그램이 읽은 정보로 AI 해석 요청 */
export async function interpretDrawing({ image, mediaType = 'image/png', analysis, fileName }) {
  const cfg = aiConfig();
  if (!cfg.apiKey) throw Object.assign(new Error('AI 키(ANTHROPIC_API_KEY)가 서버에 설정되어 있지 않습니다'), { status: 400 });
  const ctx = contextText(analysis, fileName);
  const body = {
    model: cfg.model, max_tokens: 8000, system: SYSTEM,
    tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
      { type: 'text', text: ctx },
    ] }],
  };
  const t0 = Date.now();
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || res.statusText;
    throw Object.assign(new Error(`AI 해석 실패 (${res.status}): ${msg}`), { status: res.status === 401 ? 400 : 502 });
  }
  const tool = (j.content || []).find((c) => c.type === 'tool_use' && c.name === TOOL.name);
  if (!tool?.input?.parts?.length) throw Object.assign(new Error('AI 가 부품 목록을 돌려주지 않았습니다'), { status: 502 });
  return { spec: tool.input, usage: { ...j.usage, model: j.model || cfg.model, ms: Date.now() - t0 } };
}

function contextText(a, fileName) {
  const L = [`파일: ${fileName || ''}`, `형식: ${a?.format || ''}`];
  if (a?.unit) L.push(`도면 단위: ${a.unit}`);
  if (a?.image?.mmPerPx) L.push(`그림 1픽셀 = 실제 ${a.image.mmPerPx} mm (CAD 원본 좌표에서 그린 그림)`);
  if (a?.scaleRequired && a?.autoDraft?.scale?.scale) L.push(`용지 축척 추정: 1:${a.autoDraft.scale.scale} (${a.autoDraft.scale.why})`);
  const dm = a?.image?.dimMarks || [];
  if (dm.length) L.push('CAD 치수 객체 (값 mm, 그림 픽셀 위치 x,y):', ...dm.slice(0, 80).map((d) => `- ${d.kind} ${d.value} @ (${d.px[0]},${d.px[1]})`));
  else if (a?.dimensions?.length) L.push('CAD 치수 값: ' + a.dimensions.map((d) => d.value).join(', '));
  const tm = a?.image?.textMarks || [];
  if (tm.length) L.push('도면 글자 (픽셀 위치):', ...tm.slice(0, 60).map((t) => `- "${t.text}" @ (${t.px[0]},${t.px[1]})`));
  else if (a?.texts?.length) L.push('도면 글자(OCR, 오독 가능): ' + a.texts.slice(0, 60).join(' | '));
  if (a?.numbers?.length && !dm.length) L.push('도면에서 읽은 숫자(OCR): ' + a.numbers.slice(0, 80).join(', '));
  if (a?.views?.length) {
    const k = a.image?.mmPerPx ? 1 : a?.autoDraft?.scale?.scale || 1;
    L.push(`프로그램이 찾은 투상도 외곽 (실제 mm 크기${k !== 1 ? `, 축척 1:${k} 반영` : ''}): ` + a.views.slice(0, 12).map((v) => `${v.id}${v.role ? '(' + v.role + ')' : ''} ${((v.box[1][0] - v.box[0][0]) * k).toFixed(0)}×${((v.box[1][1] - v.box[0][1]) * k).toFixed(0)}`).join(', '));
  }
  L.push('', '이 도면의 제품을 쇼룸용 3D 로 만들어라. 치수는 도면에 적힌 숫자를 우선한다.');
  return L.join('\n');
}

// ── 부품 목록 → 3D ─────────────────────────────────────────────
let mfP;
const mf = async () => { if (!mfP) mfP = manifoldInit().then((w) => { w.setup(); return w; }); return mfP; };
const MAT = {
  steel: { color: [0.62, 0.64, 0.67], metallic: 0.75, roughness: 0.35 }, painted: { color: [0.86, 0.87, 0.85], metallic: 0.15, roughness: 0.55 },
  stainless: { color: [0.75, 0.76, 0.78], metallic: 0.9, roughness: 0.25 }, aluminum: { color: [0.8, 0.81, 0.83], metallic: 0.85, roughness: 0.3 },
  plastic: { color: [0.92, 0.92, 0.9], metallic: 0.0, roughness: 0.6 }, rubber: { color: [0.12, 0.12, 0.13], metallic: 0, roughness: 0.9 },
  glass: { color: [0.7, 0.85, 0.95], metallic: 0, roughness: 0.05, opacity: 0.35 }, copper: { color: [0.78, 0.45, 0.25], metallic: 0.9, roughness: 0.3 },
  wood: { color: [0.62, 0.45, 0.3], metallic: 0, roughness: 0.8 },
};
const DIR = { front: [0, -1, 0], back: [0, 1, 0], up: [0, 0, 1], down: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] };
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const hex = (s) => (/^#?[0-9a-f]{6}$/i.test(s || '') ? [0, 2, 4].map((i) => parseInt(s.replace('#', '').slice(i, i + 2), 16) / 255) : null);

function roundedRect(W, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  if (r < 0.2) return new W.CrossSection([[[0, 0], [w, 0], [w, h], [0, h]]]);
  const pts = [], n = 8;
  for (const [cx, cy, a0] of [[w - r, r, -Math.PI / 2], [w - r, h - r, 0], [r, h - r, Math.PI / 2], [r, r, Math.PI]])
    for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return new W.CrossSection([pts]);
}
/** 폭 w(X)·깊이 d(Y)·높이 h(Z) 상자, 정면(XZ) 모서리 둥글기 r → 원점 기준 */
function boxSolid(W, w, d, h, r = 0) {
  if (!(r > 0.2)) return W.Manifold.cube([w, d, h]);
  return roundedRect(W, w, h, r).extrude(d).rotate([90, 0, 0]).translate([0, d, 0]);
}
function cylSolid(W, len, dia, axis) {
  const c = W.Manifold.cylinder(len, dia / 2, dia / 2, 40);
  return axis === 'x' ? c.rotate([0, 90, 0]) : axis === 'y' ? c.rotate([-90, 0, 0]) : c;
}

/** 부품 하나 → Manifold (월드 좌표) */
export function partSolid(W, p, big) {
  const [x, y, z] = (p.position || [0, 0, 0]).map((v) => num(v));
  let s;
  if (p.shape === 'cylinder') {
    const len = num(p.length), dia = num(p.diameter);
    if (!(len > 0 && dia > 0)) return null;
    s = cylSolid(W, len, dia, p.axis || 'z').translate([x, y, z]);
  } else {
    const [w, d, h] = (p.size || []).map((v) => num(v));
    if (!(w > 0 && d > 0 && h > 0)) return null;
    const r = num(p.cornerRadius);
    s = boxSolid(W, w, d, h, r);
    if (p.shape === 'shell') {
      const t = Math.max(0.5, Math.min(num(p.wall, 1.6), Math.min(w, d, h) / 3));
      const open = p.open || 'front';
      // 안쪽 빈 공간: 사방으로 벽 두께만큼 줄이고, 열린 면 쪽은 바깥까지 뚫음
      let ix = t, iy = t, iz = t, iw = w - 2 * t, id = d - 2 * t, ih = h - 2 * t;
      const e = Math.max(w, d, h);
      if (open === 'front') { iy = -e; id = d - t + e; } else if (open === 'back') id = d - t + e;
      else if (open === 'bottom') { iz = -e; ih = h - t + e; } else if (open === 'top') ih = h - t + e;
      else if (open === 'left') { ix = -e; iw = w - t + e; } else if (open === 'right') iw = w - t + e;
      if (iw > 0 && id > 0 && ih > 0) s = s.subtract(boxSolid(W, iw, id, ih, Math.max(0, r - t)).translate([ix, iy, iz]));
    }
    s = s.translate([x, y, z]);
  }
  for (const hl of (p.holes || []).slice(0, 200)) {
    const ax = hl.axis || 'z', c = (hl.center || []).map((v) => num(v));
    if (c.length !== 3) continue;
    const L = big * 3;
    let cut;
    if (hl.shape === 'rect' && num(hl.width) > 0 && num(hl.height) > 0) {
      const a = num(hl.width), b = num(hl.height);
      cut = ax === 'z' ? W.Manifold.cube([a, b, L]).translate([c[0] - a / 2, c[1] - b / 2, -L / 2 + c[2]])
        : ax === 'y' ? W.Manifold.cube([a, L, b]).translate([c[0] - a / 2, -L / 2 + c[1], c[2] - b / 2])
          : W.Manifold.cube([L, a, b]).translate([-L / 2 + c[0], c[1] - a / 2, c[2] - b / 2]);
    } else {
      const dia = num(hl.diameter);
      if (!(dia > 0)) continue;
      const cyl = cylSolid(W, L, dia, ax);
      cut = ax === 'x' ? cyl.translate([c[0] - L / 2, c[1], c[2]]) : ax === 'y' ? cyl.translate([c[0], c[1] - L / 2, c[2]]) : cyl.translate([c[0], c[1], c[2] - L / 2]);
    }
    s = s.subtract(cut);
  }
  return s;
}

export async function buildFromSpec(spec, name) {
  const W = await mf();
  const ov = (spec.overall || []).map((v) => num(v));
  const big = Math.max(...ov, ...spec.parts.flatMap((p) => [...(p.size || []), num(p.length)]).map((v) => num(v)), 10);
  const children = [];
  const used = new Map();
  for (const p of spec.parts.slice(0, 80)) {
    let s;
    try { s = partSolid(W, p, big); } catch { s = null; }
    if (!s || !(s.volume() > 1e-3)) continue;
    const m = MAT[p.material] || MAT.painted;
    const mesh = meshOf(s, hex(p.color) || m.color);
    mesh.metallic = m.metallic; mesh.roughness = m.roughness; if (m.opacity) mesh.opacity = m.opacity;
    let nm = String(p.name || `부품${children.length + 1}`).slice(0, 60);
    const k = (used.get(nm) || 0) + 1; used.set(nm, k); if (k > 1) nm = `${nm} (${k})`;
    children.push({ name: nm, meshes: [mesh], children: [], extras: { estimated: true, ai: true, shape: p.shape, ...(p.explode ? { explode: p.explode, explodeStep: p.explodeStep || 1 } : {}), ...(p.sourceDims?.length ? { sourceDims: p.sourceDims } : {}) } });
  }
  if (!children.length) throw Object.assign(new Error('AI 해석 결과로 만들 수 있는 부품이 없습니다'), { status: 502 });
  const { glb, parts } = await writeGlb({ name, children }, { unit: 'mm' });
  return {
    glb, parts, method: 'ai-drawing',
    stats: { ...summarize(parts), upAxis: 'Z', unit: 'mm' },
    provenance: {
      geometry: 'estimated', review: 'pending', reference: true,
      note: `참고용 AI 3D 시각화 — AI 가 도면을 해석해 '${spec.product || '제품'}' 으로 만든 형상입니다. 치수는 도면에 적힌 숫자를 우선했고, 적혀 있지 않은 값은 추정했습니다. 검토 후 승인하세요.`,
      items: [
        { what: '제품 종류·부품 구분·배치', source: 'ai', label: 'AI가 추정한 형상' },
        { what: '도면에 적힌 치수 숫자', source: 'drawing', label: '원본 도면에서 확인된 형상' },
        ...(spec.assumptions || []).slice(0, 12).map((a) => ({ what: String(a).slice(0, 200), source: 'ai', label: 'AI가 추정한 형상' })),
        { what: '곡면·세부 형상(단순화)', source: 'unbuildable', label: '생성할 수 없는 형상' },
      ],
      ai: { product: spec.product, overall: spec.overall, views: spec.views, ignored: spec.ignored, assumptions: spec.assumptions },
    },
  };
}

/** AI 가 정한 분해 방향 → 장면 분해 설정 */
export function explodeFromSpec(parts, size) {
  const out = {};
  const S = Math.max(...size, 1);
  for (const p of parts) {
    const e = p.extras?.explode;
    if (!e || e === 'none' || !DIR[e]) { out[p.id] = { dir: [0, 0, 1], dist: 0, step: 0 }; continue; }
    out[p.id] = { dir: DIR[e], dist: Math.round(S * 0.45), step: Math.max(1, Math.min(6, p.extras.explodeStep || 1)) };
  }
  return out;
}
