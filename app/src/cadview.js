// DWG·DXF 보기: libredwg(WASM)·dxf-json 으로 읽어 SVG 로 그린다. 레이어 켜고 끄기, 거리·면적 측정.
import { t } from './i18n.js';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import { SvgConverter } from '../node_modules/@mlightcad/libredwg-web/lib/svg/svgConverter.js';
import { DxfParser } from '@mlightcad/dxf-json';
import { el, menu, ask, toast, confirmBox } from './ui.js';
import { createMeasure, svgEl } from './measure.js';

const NOMINAL = 4000; // 도면 전체를 이 픽셀 폭 안에 놓고 무대에서 확대·축소한다.
const UNIT_MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
const UNIT_NAME = { 1: t('인치'), 2: t('피트'), 4: 'mm', 5: 'cm', 6: 'm' };
let libredwg = null;

// 한 요소(예: 깨진 TABLE)에서 오류가 나도 도면 전체가 안 열리는 일은 없게 한다.
const origEntity = SvgConverter.prototype.entityToBoundsAndElement;
SvgConverter.prototype.entityToBoundsAndElement = function (entity) {
  try { return origEntity.call(this, entity); } catch (e) { console.warn('요소 건너뜀', entity && entity.type, e.message); return null; }
};

function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('euc-kr').decode(bytes); }
}

/** 파일 → { svg, layers:[{name, color}], entityLayer: Map(handle→layer), units } */
async function parse(bytes, name) {
  const isDxf = /\.dxf$/i.test(name);
  let db;
  if (isDxf) {
    const parsed = new DxfParser().parseSync(decodeText(bytes));
    // dxf-json 과 libredwg 데이터 모양이 조금 다른 곳(MTEXT 글자 크기 등)을 맞춘다.
    const fix = (ents) => { for (const e of ents || []) {
      if (e.type === 'MTEXT') { e.textHeight ??= e.height; e.rectWidth ??= e.width; e.extentsWidth ??= e.width; }
      if (e.type === 'SOLID' && e.points && !e.corner1) [e.corner1, e.corner2, e.corner3, e.corner4] = e.points;
    } };
    fix(parsed.entities);
    for (const b of Object.values(parsed.blocks || {})) fix(b.entities);
    const blocks = Object.values(parsed.blocks || {})
      .filter((b) => !/^\*(Model|Paper)_Space/i.test(b.name))
      .map((b) => ({ name: b.name, entities: b.entities || [] }));
    db = {
      header: parsed.header || {},
      tables: {
        LAYER: { entries: (parsed.tables.LAYER && parsed.tables.LAYER.entries) || [] },
        BLOCK_RECORD: { entries: [...blocks, { name: '*Model_Space', entities: parsed.entities || [] }] },
      },
      entities: parsed.entities || [],
    };
  } else {
    if (!libredwg) libredwg = await LibreDwg.create('.');
    const ptr = libredwg.dwg_read_data(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), Dwg_File_Type.DWG);
    if (ptr == null) throw new Error(t('DWG 파일을 읽지 못했습니다.'));
    db = libredwg.convert(ptr);
    libredwg.dwg_free(ptr);
  }
  const svg = new SvgConverter().convert(db);
  const entityLayer = new Map();
  const walk = (ents) => { for (const e of ents || []) { if (e.handle != null) entityLayer.set(String(e.handle), e.layer || '0'); if (e.entities) walk(e.entities); } };
  for (const b of db.tables.BLOCK_RECORD.entries) walk(b.entities);
  const layers = db.tables.LAYER.entries.map((l) => ({ name: l.name, colorIndex: l.colorIndex }));
  const units = db.header && (db.header.INSUNITS ?? db.header.$INSUNITS);
  // 외부 참조(xref) 블록: 내용이 다른 DWG 파일에 있어 이 파일만으로는 그릴 수 없다. (블록 플래그 4 = xref)
  const xrefs = db.tables.BLOCK_RECORD.entries.filter((b) => (b.flags & 4) && !(b.entities || []).length).map((b) => b.name);
  return { svg, layers, entityLayer, units, xrefs };
}

/**
 * 실제로 그려진 요소들로 보기 영역을 정한다(변환기의 viewBox 는 빈 xref 삽입·원점 잔재 때문에 엉뚱하게 커질 때가 있음).
 * 요소 95% 가 모여 있는 묶음을 기준으로 잡아, 원점 근처의 잔재 한두 개 때문에 도면이 점처럼 작아지는 일을 막는다.
 * 돌려주는 값은 viewBox 좌표(도면 y 뒤집힘).
 */
function contentBox(svgRoot) {
  // 구조: svg > g(y 뒤집기) > g#*Model_Space > g(엔티티)...
  const main = svgRoot.querySelector(':scope > g > g') || svgRoot.querySelector(':scope > g');
  if (!main) return null;
  const boxes = [];
  for (const g of main.children) {
    let b;
    try { b = g.getBBox(); } catch { continue; }
    if (!isFinite(b.width) || !isFinite(b.height) || (b.width === 0 && b.height === 0)) continue;
    boxes.push({ x: b.x, y: -(b.y + b.height), w: b.width, h: b.height, cx: b.x + b.width / 2, cy: -(b.y + b.height / 2) });
  }
  if (!boxes.length) return null;
  const med = (a) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const mx = med(boxes.map((b) => b.cx)), my = med(boxes.map((b) => b.cy));
  boxes.sort((a, b) => Math.hypot(a.cx - mx, a.cy - my) - Math.hypot(b.cx - mx, b.cy - my));
  const keep = boxes.length < 10 ? boxes : boxes.slice(0, Math.ceil(boxes.length * 0.95));
  const x0 = Math.min(...keep.map((b) => b.x)), y0 = Math.min(...keep.map((b) => b.y));
  const x1 = Math.max(...keep.map((b) => b.x + b.w)), y1 = Math.max(...keep.map((b) => b.y + b.h));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * ctx: { stage, content, labelLayer, tools, setHint, name }
 */
export async function openCad(bytes, ctx) {
  const { stage, content, labelLayer, tools, setHint } = ctx;
  setHint(t('도면을 읽는 중…'));
  const { svg, layers, entityLayer, units, xrefs } = await parse(bytes, ctx.name);

  // SVG 넣기 — 검은 바탕에 맞게 검은 선은 밝게, 선 굵기는 화면 기준 1px 로.
  const holder = el('div', 'cad');
  holder.innerHTML = svg
    .replace(/stroke="#000000"/g, 'stroke="#e6e6e6"')
    .replace(/stroke="black"/g, 'stroke="#e6e6e6"')
    .replace(/fill="#000000"/g, 'fill="#e6e6e6"')
    .replace('stroke-width="0.1%"', 'stroke-width="1"');
  const svgRoot = holder.querySelector('svg');
  content.innerHTML = '';
  content.appendChild(holder); // getBBox 를 쓰려면 화면에 붙어 있어야 한다
  const vb = contentBox(svgRoot) || svgRoot.viewBox.baseVal;
  if (!vb.width || !vb.height) throw new Error(t('도면에 그릴 내용이 없습니다(모델 공간이 비어 있음).'));
  const pad = Math.max(vb.width, vb.height) * 0.02;
  const vbox = { x: vb.x - pad, y: vb.y - pad, w: vb.width + pad * 2, h: vb.height + pad * 2 };
  svgRoot.setAttribute('viewBox', `${vbox.x} ${vbox.y} ${vbox.w} ${vbox.h}`);
  svgRoot.removeAttribute('preserveAspectRatio');
  const pxW = NOMINAL, pxH = NOMINAL * vbox.h / vbox.w;
  svgRoot.setAttribute('width', pxW);
  svgRoot.setAttribute('height', pxH);
  // 측정 그림용 겹침 SVG(같은 viewBox, y 뒤집기 없음 → 도면 y 는 -y)
  const overlay = svgEl('svg', { class: 'cad-overlay', viewBox: `${vbox.x} ${vbox.y} ${vbox.w} ${vbox.h}`, width: pxW, height: pxH });
  const og = svgEl('g', {});
  overlay.appendChild(og);
  holder.appendChild(overlay);
  stage.setContentSize(pxW, pxH);
  stage.fit();
  if (xrefs.length) setTimeout(() => confirmBox(t('외부 참조(xref) 도면 {n}개가 이 파일에 포함되어 있지 않아 그 부분은 표시되지 않습니다: {names}\n\n원본 CAD에서 xref를 결합(bind)해 저장한 파일을 열면 전체가 보입니다.', { n: xrefs.length, names: xrefs.join(', ') }), t('닫기')), 400);
  const unitsPerPx = vbox.w / pxW; // 내용 좌표 1px = 도면 단위 몇 개

  // 레이어 ↔ 요소
  const byLayer = new Map();
  for (const g of svgRoot.querySelectorAll('g[id]')) {
    const layer = entityLayer.get(g.id);
    if (layer == null) continue;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(g);
  }
  const layerList = layers.length ? layers.map((l) => l.name) : [...byLayer.keys()];
  const hidden = new Set();

  // 단위
  let unitMm = UNIT_MM[units] || 1;
  let unitName = UNIT_NAME[units] || 'mm';

  // 끝점 잡기(스냅): 선·폴리선·원 중심을 모아 두고 가까운 점으로 당긴다.
  const snapPts = [];
  const useOf = new Map();
  for (const g of svgRoot.querySelectorAll('defs > g[id]')) useOf.set(g.id, g);
  function collect(root, m, depth) {
    for (const e of root.children) {
      if (snapPts.length > 400000) return;
      const tag = e.tagName.toLowerCase();
      if (tag === 'line') push(e.x1.baseVal.value, e.y1.baseVal.value, m), push(e.x2.baseVal.value, e.y2.baseVal.value, m);
      else if (tag === 'polyline' || tag === 'polygon') { const p = e.points; for (let i = 0; i < p.numberOfItems; i++) { const q = p.getItem(i); push(q.x, q.y, m); } }
      else if (tag === 'circle') push(e.cx.baseVal.value, e.cy.baseVal.value, m);
      else if (tag === 'use' && depth < 4) {
        const def = useOf.get((e.getAttribute('href') || e.getAttribute('xlink:href') || '').slice(1));
        if (def) collect(def, mul(m, matrixOf(e)), depth + 1);
      } else if (tag === 'g') collect(e, mul(m, matrixOf(e)), depth);
    }
  }
  function matrixOf(e) { const t = e.transform && e.transform.baseVal; return t && t.numberOfItems ? t.consolidate().matrix : null; }
  function mul(a, b) { if (!b) return a; if (!a) return b; return a.multiply(b); }
  function push(x, y, m) { if (m) { const p = new DOMPoint(x, y).matrixTransform(m); snapPts.push(p.x, p.y); } else snapPts.push(x, y); }
  try { collect(svgRoot.querySelector('svg > g'), null, 0); } catch (e) { console.warn('snap', e); }
  function snap(pt) { // pt: overlay 좌표(도면 x, -도면 y)
    const tol = 14 / stage.transform.s * unitsPerPx; // 화면 14px
    let best = null, bd = tol * tol;
    for (let i = 0; i < snapPts.length; i += 2) {
      const dx = snapPts[i] - pt.x, dy = -snapPts[i + 1] - pt.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { x: snapPts[i], y: -snapPts[i + 1] }; }
    }
    return best;
  }

  // 측정: 겹침 SVG 좌표 = 도면 단위
  const measure = createMeasure({
    stage, labelLayer,
    locate(pt) {
      const x = vbox.x + pt.x * unitsPerPx, y = vbox.y + pt.y * unitsPerPx;
      const s = snap({ x, y }) || { x, y };
      return { key: 'cad', x: s.x, y: s.y, origin: { x: 0, y: 0 }, g: og, toContent: (p) => ({ x: (p.x - vbox.x) / unitsPerPx, y: (p.y - vbox.y) / unitsPerPx }), markerR: () => 4 / stage.transform.s * unitsPerPx };
    },
    mmPerUnit: () => unitMm,
    onChange() { updateTools(); },
  });
  stage.setTapHandler((pt) => { if (!measure.mode) return false; measure.addPoint(pt); return true; });

  // 도구 막대
  const btn = (label, icon, on, cls) => { const b = el('button', 'tool' + (cls ? ' ' + cls : '')); b.innerHTML = `<span class="ic">${icon}</span>${label}`; b.onclick = on; return b; };
  function updateTools() {
    tools.innerHTML = '';
    const m = measure.mode;
    tools.appendChild(btn(t('보기'), '✋', () => { measure.setMode(null); updateTools(); }, !m ? 'on' : ''));
    tools.appendChild(btn(t('거리'), '📏', () => { measure.setMode('distance'); updateTools(); }, m === 'distance' ? 'on' : ''));
    tools.appendChild(btn(t('면적'), '⬠', () => { measure.setMode('area'); updateTools(); }, m === 'area' ? 'on' : ''));
    if (m) {
      tools.appendChild(btn(t('완료'), '✓', () => { measure.finish(); updateTools(); }));
      tools.appendChild(btn(t('되돌리기'), '↶', () => { if (!measure.undo()) toast(t('지울 측정이 없습니다')); }));
    } else {
      tools.appendChild(btn(t('레이어'), '☰', showLayers));
      tools.appendChild(btn(t('맞춤'), '⤢', () => stage.fit()));
      tools.appendChild(btn(t('단위'), unitName, pickUnit));
    }
    setHint(m === 'distance' ? t('점을 차례로 누르세요 · 끝점 근처는 자동으로 붙습니다 · 완료로 끝내기')
      : m === 'area' ? t('면적을 둘러싸는 꼭짓점을 차례로 누른 뒤 완료') : '');
  }
  async function showLayers() {
    const items = layerList.map((name) => ({ label: (hidden.has(name) ? '☐ ' : '☑ ') + name, name }));
    if (!items.length) return toast(t('레이어 정보가 없습니다'));
    const pick = await menu([{ label: t('모두 켜기'), icon: '◉', all: true }, '-', ...items], t('레이어'));
    if (!pick) return;
    if (pick.all) hidden.clear();
    else if (hidden.has(pick.name)) hidden.delete(pick.name); else hidden.add(pick.name);
    for (const [layer, els] of byLayer) for (const g of els) g.style.display = hidden.has(layer) ? 'none' : '';
    if (!pick.all) showLayers();
  }
  async function pickUnit() {
    const r = await ask(t('도면 1단위의 길이'), [{ name: 'u', type: 'select', value: String(unitMm), options: [
      { label: t('mm (일반 건축·전기 도면)'), value: '1' }, { label: 'cm', value: '10' }, { label: 'm', value: '1000' }, { label: t('인치'), value: '25.4' }, { label: t('피트'), value: '304.8' },
    ] }]);
    if (!r) return;
    unitMm = Number(r.u);
    unitName = { 1: 'mm', 10: 'cm', 1000: 'm', 25.4: t('인치'), 304.8: t('피트') }[unitMm];
    measure.relabel();
    updateTools();
  }
  updateTools();
  toast(t('도면 단위: {u} (단위 버튼으로 변경)', { u: unitName }));

  return {
    type: 'cad',
    dirty: () => false,
    async more() {
      const pick = await menu([
        { label: t('측정 모두 지우기'), icon: '🧹', id: 'clear' },
        { label: t('도면 정보'), icon: 'ℹ', id: 'info' },
      ]);
      if (!pick) return;
      if (pick.id === 'clear') measure.clear();
      if (pick.id === 'info') await ask(ctx.name, [
        { name: 'a', label: t('크기(도면 단위)'), value: `${vb.width.toFixed(1)} × ${vb.height.toFixed(1)} ${unitName}` },
        { name: 'b', label: t('레이어 수'), value: String(layerList.length) },
        { name: 'c', label: t('요소 수'), value: String(entityLayer.size) },
      ], t('닫기'));
    },
    destroy() { measure.clear(); content.innerHTML = ''; labelLayer.innerHTML = ''; stage.setTapHandler(null); stage.setDrawHandler(null); },
  };
}
