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
      viewRoles: { type: 'object', description: '그림(V1, V2…)마다 역할. 값: front(정면)·rear(후면)·top(평면/상면)·bottom(저면)·left(좌측면)·right(우측면)·other(구성도 등 3D 아님). 예 {"V1":"front","V3":"right","V4":"top"}', additionalProperties: { type: 'string', enum: ['front', 'rear', 'top', 'bottom', 'left', 'right', 'other'] } },
      projection: { type: 'string', enum: ['third', 'first'], description: '투상법. 기본 third(3각법: 정면도 위=평면도, 오른쪽=우측면도)' },
      scaleRef: { type: 'object', required: ['dimension', 'region', 'along'], description: '배율 기준(권장): 도면에 적힌 치수 숫자 하나와, 그 치수가 가리키는 윤곽. 프로그램이 배율 = dimension ÷ 윤곽 크기 로 계산한다. 예 {"dimension":539,"region":"V2S1","along":"width"}', properties: {
        dimension: { type: 'number', description: '도면에 적힌 치수 숫자 (mm)' }, region: { type: 'string', description: '그 치수가 재는 윤곽 번호 (예 V2S1)' }, along: { type: 'string', enum: ['width', 'height', 'diameter'], description: '윤곽의 가로/세로/지름 중 어느 길이인지' } } },
      drawingScale: { type: 'number', description: 'scaleRef 를 줄 수 없을 때만: 그림 단위 → 실제 mm 배율 (CAD 실치수 1, "Scale 1:2" 는 2)' },
      ignored: { type: 'array', items: { type: 'string' }, description: '3D 로 만들지 않은 그림 (구성도·결선도·표제란·부품표 등)' },
      assumptions: { type: 'array', items: { type: 'string' }, description: '도면에 적혀 있지 않아 추정한 값과 이유' },
      parts: {
        type: 'array', minItems: 1, maxItems: 80,
        items: {
          type: 'object', required: ['name', 'shape'],
          properties: {
            name: { type: 'string', description: '부품 이름 (한국어)' },
            shape: { type: 'string', enum: ['intersect', 'extrude', 'box', 'shell', 'cylinder'], description: 'intersect=도면 윤곽 2~3개(정면·측면·평면)를 각 방향으로 밀어 교차 — 곡면·복잡한 외형을 도면 그대로 재현(권장). extrude=도면 윤곽 1개를 두께만큼 밀기(판·플랜지·브래킷). box=직육면체, shell=속 빈 상자(한 면 열림), cylinder=원기둥(핀·볼트·축)' },
            profiles: { type: 'array', minItems: 1, maxItems: 3, description: 'intersect/extrude: 쓸 윤곽 번호 (그림의 S/F/C 라벨, 예 "V1S1", "V3F2"). intersect 는 서로 다른 방향의 뷰(정면+측면, 정면+평면 등)에서 1개씩', items: { type: 'string' } },
            from: { type: 'number', description: 'extrude: 밀기 시작 좌표(윤곽 뷰의 법선 축: 정면/후면 윤곽이면 Y, 평면/저면이면 Z, 측면이면 X). 생략하면 전체 범위' },
            to: { type: 'number', description: 'extrude: 밀기 끝 좌표' },
            position: { ...XYZ, description: 'box/shell: 가장 작은 X·Y·Z 모서리 좌표, cylinder: 시작 면의 중심 좌표. intersect/extrude 는 생략(도면 좌표 사용)' },
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
- 가장 중요: 형상은 도면 윤곽을 그대로 써라. 두 번째 그림에 뷰 번호(V1…)와 윤곽 번호(S=외형, F=안쪽 영역, C=원)가 적혀 있고, 그 윤곽의 실제 좌표로 3D 를 만든다.
  · 본체·하우징·외함·몸통 등 가장 큰 부품은 반드시 intersect 로 만든다: 정면 외형(S) + 측면 외형(S) (+ 평면 외형). 둥근 외형·테이퍼·돔이 도면대로 나온다. box 로 대신하지 말 것.
  · 판·플랜지·브래킷·프레임 → extrude 에 그 뷰의 윤곽(안쪽 영역 F 포함) + from/to 로 두께 위치.
  · 윤곽 번호가 없는 부품(요크·브래킷·바이저·볼트·단자 등)은 box/shell/cylinder 로 치수·위치를 적어 추가한다. 큰 부품은 빠뜨리지 말 것.
- viewRoles 로 그림마다 역할을 정한다. 'Rear view', 'Bottom view' 글자가 있으면 그대로, 없으면 배치(3각법)로 판단. 구성도·결선도·상세도는 other.
- 배율은 scaleRef 로 준다: 도면 치수 하나(예 전체 폭 539)와 그 치수가 재는 윤곽(예 V2S1 의 width). CAD 실치수 도면이면 drawingScale 1.
- box/cylinder 치수는 도면에 적힌 숫자를 그대로 쓴다. 적혀 있지 않은 치수는 그림 비율로 추정하고 assumptions 에 적는다.
- 3각법(정면도 위=평면도, 아래=저면도, 오른쪽=우측면도)을 기본으로 보되, 그림 배치로 1각법이면 그에 맞게 해석한다.
- 외형도·조립도의 제품만 만든다. 구성도·결선도·회로도·표제란·부품표·상세 확대도는 ignored 에 적고 만들지 않는다.
- 부품을 나눠라: 외함과 커버, 문과 손잡이, 금형 판·핀처럼 실제로 분리되는 단위로. 각 부품의 explode 방향도 정한다.
- 속이 빈 외함·케이스·박스는 shell 로, 판·블록은 box 로, 핀·볼트·축은 cylinder 로.
- 노크아웃·볼트 구멍은 holes 로 넣는다. 너무 작은 것(지름 3mm 미만)이나 수백 개 반복은 대표적인 것만.
- 부품끼리 겹치지 않게, 맞닿는 면은 같은 좌표로 맞춘다.
반드시 build_showroom_model 도구 한 번으로 답한다.`;

/** 도면 그림 + 프로그램이 읽은 정보로 AI 해석 요청 */
export async function interpretDrawing({ image, images, mediaType = 'image/png', analysis, fileName, regionText }) {
  const cfg = aiConfig();
  if (!cfg.apiKey) throw Object.assign(new Error('AI 키(ANTHROPIC_API_KEY)가 서버에 설정되어 있지 않습니다'), { status: 400 });
  const ctx = contextText(analysis, fileName, regionText);
  const imgs = images || [image];
  const body = {
    model: cfg.model, max_tokens: 8000, system: SYSTEM,
    // 최신 모델은 도구 강제(tool_choice: tool)를 지원하지 않아 auto + 지시문으로 호출하게 한다
    tools: [TOOL], tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: [
      ...imgs.map((im, i) => [{ type: 'text', text: i === 0 ? '그림 1: 도면' : '그림 2: 같은 도면에 뷰 번호(V)·윤곽 번호(S 외형, F 안쪽 영역, C 원)를 표시' }, { type: 'image', source: { type: 'base64', media_type: mediaType, data: im.toString('base64') } }]).flat(),
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
  let tool = (j.content || []).find((c) => c.type === 'tool_use' && c.name === TOOL.name);
  if (!tool) { // 도구 대신 글로 JSON 을 준 경우
    const txt = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    const m = /\{[\s\S]*\}/.exec(txt); try { tool = m ? { input: JSON.parse(m[0]) } : null; } catch { tool = null; }
  }
  if (!tool?.input?.parts?.length) throw Object.assign(new Error('AI 가 부품 목록을 돌려주지 않았습니다'), { status: 502 });
  return { spec: tool.input, usage: { ...j.usage, model: j.model || cfg.model, ms: Date.now() - t0 } };
}

function contextText(a, fileName, regionText) {
  const L = [`파일: ${fileName || ''}`, `형식: ${a?.format || ''}`];
  if (a?.views?.some((v) => v.raster)) L.push('이 도면은 스캔·이미지라 외형(S)만 있다. 제품 전체 외형은 각 뷰의 S 를 intersect 한 부품으로 반드시 만들고, 요크·브래킷 같은 돌출부만 box/cylinder 로 덧붙여라.');
  if (a?.scaleRequired) L.push('주의: 이 도면은 용지(종이/이미지) 좌표라 아래 윤곽 크기는 실제 치수가 아니다. 반드시 scaleRef 로 (도면 치수 숫자, 그 치수가 재는 윤곽, width/height/diameter) 를 지정하라. box/cylinder 의 치수·위치는 실제 mm 로 적는다.');
  if (regionText) L.push('뷰·윤곽 목록 (그림 2 의 번호, 크기는 배율 적용 전 그림 단위):', regionText);
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

// ── 도면 윤곽 → 3D (뷰 역할 기반 좌표계) ───────────────────────
/**
 * 제품 좌표계: 정면도 폭·높이와 측면/평면 깊이로 전체 상자를 잡고, 각 뷰의 외곽 중심을 그 상자 중심에 맞춘다.
 * (투상선이 어긋난 도면, 축척이 다른 뷰도 중심 정렬로 맞는다)
 */
export function makeFrame(spec, ctx) {
  const views = Object.fromEntries((ctx?.analysis?.views || []).map((v) => [v.id, v]));
  const roles = { ...autoRoles(ctx?.analysis), ...(spec.viewRoles || {}) };
  let k = num(spec.drawingScale, ctx?.k || 1) || 1;
  const ref = spec.scaleRef, rg = ref && ctx?.regions?.find((r) => r.id === ref.region);
  if (rg && num(ref.dimension) > 0) {
    const w = rg.bbox[1][0] - rg.bbox[0][0], h = rg.bbox[1][1] - rg.bbox[0][1];
    const base = ref.along === 'height' ? h : ref.along === 'diameter' ? (rg.diameter || Math.max(w, h)) : w;
    if (base > 0) k = num(ref.dimension) / base;
  }
  const byRole = (r) => Object.entries(roles).filter(([id, role]) => role === r && views[id]).map(([id]) => views[id])[0];
  const front = byRole('front') || byRole('rear');
  if (!front) return null;
  const bw = (v) => (v.box[1][0] - v.box[0][0]) * k, bh = (v) => (v.box[1][1] - v.box[0][1]) * k;
  const W = bw(front), H = bh(front);
  const side = byRole('right') || byRole('left'), topv = byRole('top') || byRole('bottom');
  // 뷰가 90° 눕혀 그려진 경우(세로로 긴 측면도 등): 정면도 높이·폭과 비교해 판단
  const near = (a, b) => Math.abs(a - b) <= Math.max(a, b) * 0.15;
  const rot = {};
  for (const v of [side, topv].filter(Boolean)) {
    const r = roles[v.id];
    if (r === 'left' || r === 'right') rot[v.id] = !near(bh(v), H) && near(bw(v), H);
    else rot[v.id] = !near(bw(v), W) && near(bh(v), W);
  }
  const D = side ? (rot[side.id] ? bh(side) : bw(side)) : topv ? (rot[topv.id] ? bw(topv) : bh(topv)) : num(spec.overall?.[1], W);
  const first = spec.projection === 'first';
  const ctr = (v) => [(v.box[0][0] + v.box[1][0]) / 2, (v.box[0][1] + v.box[1][1]) / 2];
  /** 뷰 좌표 [u,v] → 3D 평면 좌표 + 법선축 */
  const mapOf = (vid) => {
    const v = views[vid], role = roles[vid]; if (!v || !role || role === 'other') return null;
    const [cu, cv] = ctr(v);
    const U = (u) => (u - cu) * k, V = (x) => (x - cv) * k;
    const mirrorSide = first ? role === 'right' : role === 'left';
    const mirrorTop = first ? role === 'top' : role === 'bottom';
    switch (role) {
      case 'front': return { axis: 'y', to3: ([u, v2]) => [U(u) + W / 2, V(v2) + H / 2] };            // (X,Z)
      case 'rear': return { axis: 'y', to3: ([u, v2]) => [-U(u) + W / 2, V(v2) + H / 2] };
      case 'top': case 'bottom': return rot[vid]
        ? { axis: 'z', to3: ([u, v2]) => [V(v2) + W / 2, (mirrorTop ? -U(u) : U(u)) + D / 2] }
        : { axis: 'z', to3: ([u, v2]) => [U(u) + W / 2, (mirrorTop ? -V(v2) : V(v2)) + D / 2] }; // (X,Y)  3각법 평면도: 아래쪽이 앞
      case 'left': case 'right': return rot[vid]
        ? { axis: 'x', to3: ([u, v2]) => [V(v2) + D / 2, -U(u) + H / 2] }                       // 눕힌 측면도: 세로 = 깊이, 왼쪽 = 위
        : { axis: 'x', to3: ([u, v2]) => [(mirrorSide ? -U(u) : U(u)) + D / 2, V(v2) + H / 2] }; // (Y,Z) 3각법 우측면도: 왼쪽이 앞
      default: return null;
    }
  };
  return { W, H, D, k, roles, rot, mapOf, scaleFrom: rg ? `치수 ${ref.dimension} ÷ ${ref.region} ${ref.along}` : spec.drawingScale ? 'AI 지정' : '기본' };
}
function autoRoles(a) {
  const out = {};
  for (const g of a?.groups || []) {
    out[g.front] = 'front';
    if (g.top) out[g.top] = g.topPos === 'below' ? 'bottom' : 'top';
    if (g.side) out[g.side] = g.sidePos === 'left' ? 'left' : 'right';
    break; // 주 그룹만
  }
  return out;
}
/** 평면 윤곽(2D) → 법선축 방향 [from,to] 구간의 기둥 */
function prism(W, pts, axis, from, to) {
  const L = to - from; if (!(L > 0) || pts.length < 3) return null;
  const cs = new W.CrossSection([pts], 'EvenOdd');
  if (axis === 'y') return cs.extrude(L).rotate([90, 0, 0]).translate([0, to, 0]);
  if (axis === 'z') return cs.extrude(L).translate([0, 0, from]);
  return cs.extrude(L).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, from, 0, 0, 1]);
}
function outlineSolid(W, p, frame, regions) {
  const ids = p.profiles || [];
  const full = { x: [-frame.D * 0.5, frame.W + frame.D * 0.5], y: [-frame.D * 0.5, frame.D * 1.5], z: [-frame.H * 0.5, frame.H * 1.5] };
  const solids = [];
  for (const id of ids) {
    const r = regions?.[id]; if (!r) continue;
    const m = frame.mapOf(r.view); if (!m) continue;
    const pts = r.pts.map(m.to3);
    const rng = p.shape === 'extrude' && Number.isFinite(+p.from) && Number.isFinite(+p.to) ? [Math.min(+p.from, +p.to), Math.max(+p.from, +p.to)] : full[m.axis];
    // 같은 뷰 안의 다른 윤곽으로 구멍을 내지는 않는다(AI 가 holes 로 지정)
    const s = prism(W, pts, m.axis, rng[0], rng[1]);
    if (s && s.volume() > 1e-6) solids.push(s);
  }
  if (!solids.length) return null;
  let s = solids[0];
  for (let i = 1; i < solids.length; i++) s = p.shape === 'extrude' ? W.Manifold.union(s, solids[i]) : s.intersect(solids[i]);
  return s;
}

/** 부품 하나 → Manifold (월드 좌표) */
export function partSolid(W, p, big, frame, regions) {
  const [x, y, z] = (p.position || [0, 0, 0]).map((v) => num(v));
  let s;
  if (p.shape === 'intersect' || p.shape === 'extrude') {
    if (!frame) return null;
    s = outlineSolid(W, p, frame, regions);
    if (!s) return null;
  } else if (p.shape === 'cylinder') {
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

export async function buildFromSpec(spec, name, ctx = null) {
  const W = await mf();
  const frame = ctx ? makeFrame(spec, ctx) : null;
  const regions = ctx?.regions ? Object.fromEntries(ctx.regions.map((r) => [r.id, r])) : null;
  const ov = (spec.overall || []).map((v) => num(v));
  const big = Math.max(...ov, ...(frame ? [frame.W, frame.H, frame.D] : []), ...spec.parts.flatMap((p) => [...(p.size || []), num(p.length)]).map((v) => num(v)), 10);
  const children = [];
  const used = new Map();
  const plist = [...spec.parts];
  // 스캔·이미지 도면(안쪽 영역 정보 없음)에서 AI 가 윤곽을 쓰지 않았으면, 정면·측면·평면 외형 교차(도면 그대로의 외형)를 맨 앞에 넣는다
  if (frame && regions && ctx?.analysis?.views?.some((v) => v.raster) && !plist.some((p) => p.shape === 'intersect' || p.shape === 'extrude')) {
    const sils = Object.entries(frame.roles).filter(([, r]) => r && r !== 'other').map(([id]) => `${id}S1`).filter((id) => regions[id]);
    if (sils.length >= 2) plist.unshift({ name: '외형 (도면 윤곽)', shape: 'intersect', profiles: sils, material: plist[0]?.material || 'painted', explode: 'none', _auto: true });
  }
  for (const p of plist.slice(0, 80)) {
    let s;
    try { s = partSolid(W, p, big, frame, regions); } catch { s = null; }
    if (!s || !(s.volume() > 1e-3)) continue;
    const m = MAT[p.material] || MAT.painted;
    const mesh = meshOf(s, hex(p.color) || m.color);
    mesh.metallic = m.metallic; mesh.roughness = m.roughness; if (m.opacity) mesh.opacity = m.opacity;
    let nm = String(p.name || `부품${children.length + 1}`).slice(0, 60);
    const k = (used.get(nm) || 0) + 1; used.set(nm, k); if (k > 1) nm = `${nm} (${k})`;
    children.push({ name: nm, meshes: [mesh], children: [], extras: { estimated: true, ai: true, shape: p.shape, ...(p.profiles ? { profiles: p.profiles } : {}), ...(p.explode ? { explode: p.explode, explodeStep: p.explodeStep || 1 } : {}), ...(p.sourceDims?.length ? { sourceDims: p.sourceDims } : {}) } });
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
      ai: { product: spec.product, overall: spec.overall, views: spec.views, viewRoles: spec.viewRoles, drawingScale: spec.drawingScale, ignored: spec.ignored, assumptions: spec.assumptions, outlineParts: spec.parts.filter((p) => p.shape === 'intersect' || p.shape === 'extrude').length },
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
