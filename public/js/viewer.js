// 도면 뷰어: PDF·이미지 표시, 페이지 기준 정규화 좌표(0~1)로 표시 객체 저장
import { h, clear, state, GET, POST, PUT, DEL, toast, modal, confirmBox, formFields, catLabel, perm } from './ui.js';
import { renderCard } from './card.js';

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return pdfjs;
}

const COLORS = { power: '#b3261e', comm: '#1d4f91', cctv: '#6a3d9a', equipment: '#2d3339' };
function colorOf(cat) {
  const c = state.meta.CATEGORIES[cat] || {};
  if (cat === 'cctv') return COLORS.cctv;
  if (c.medium) return COLORS[c.medium];
  if (cat === 'panel' || cat === 'load') return COLORS.power;
  return COLORS.equipment;
}

export async function viewerPage(main, revId, query) {
  const sid = state.site.id;
  const drawings = await GET(`/api/sites/${sid}/drawings`);
  if (!drawings.length) {
    clear(main, h('div', { class: 'box' }, '등록된 도면이 없습니다. ', h('a', { href: `#/s/${sid}/drawings` }, '도면 관리'), '에서 먼저 도면을 올리세요.'));
    return;
  }
  if (!revId) revId = drawings[0].revisions[0]?.id;
  const S = {
    rev: null, page: 1, zoom: 1, rot: 0, doc: null, img: null, base: { w: 1, h: 1 },
    marks: [], selMark: null, tool: 'select', draft: null, assets: [], linkAsset: null,
    filters: { cats: new Set(['power', 'comm', 'cctv', 'equipment']), recheckOnly: false }, renderTask: null,
  };

  // ---------- 화면 골격 ----------
  const revSel = h('select', { style: { width: '100%' } });
  for (const d of drawings) {
    const og = h('optgroup', { label: `${d.drawing_no} ${d.title}` });
    d.revisions.forEach((r, i) => og.appendChild(h('option', { value: r.id, selected: String(r.id) === String(revId) }, `${d.drawing_no} Rev.${r.rev_no}${i === 0 ? ' (최신)' : ''}${r.recheck_count ? ` · 재확인 ${r.recheck_count}` : ''}`)));
    revSel.appendChild(og);
  }
  revSel.addEventListener('change', () => { location.hash = `#/s/${sid}/viewer/${revSel.value}`; });
  const pageInfo = h('span', { class: 'small' });
  const searchIn = h('input', { type: 'search', placeholder: '관리번호 검색 후 Enter', style: { width: '100%' } });
  const list = h('div', { class: 'v-list' });
  const linkInfo = h('div', { class: 'small muted' });
  const filterBox = h('div', { class: 'check-list' },
    ...[['power', '전력', COLORS.power], ['comm', '통신(광·LAN)', COLORS.comm], ['cctv', 'CCTV', COLORS.cctv], ['equipment', '기타 장비', COLORS.equipment]].map(([k, l, c]) =>
      h('label', null, h('input', { type: 'checkbox', checked: true, onchange: (e) => { e.target.checked ? S.filters.cats.add(k) : S.filters.cats.delete(k); drawOverlay(); } }), h('span', { class: 'dot', style: { background: c, width: '9px', height: '9px', display: 'inline-block' } }), l)),
    h('label', null, h('input', { type: 'checkbox', onchange: (e) => { S.filters.recheckOnly = e.target.checked; drawOverlay(); } }), '위치 재확인 필요만'),
    h('select', { onchange: (e) => { S.filters.status = e.target.value; drawOverlay(); } }, h('option', { value: '' }, '상태 전체'), ...state.meta.STATUSES.map(s => h('option', { value: s }, s))));

  const left = h('div', { class: 'v-left' },
    h('div', { class: 'field' }, h('span', { class: 'small muted' }, '도면·개정본'), revSel),
    h('div', { class: 'btns' }, h('button', { class: 'sm', onclick: () => goPage(S.page - 1) }, '이전'), pageInfo, h('button', { class: 'sm', onclick: () => goPage(S.page + 1) }, '다음')),
    searchIn, h('div', { class: 'small muted' }, '표시 필터'), filterBox,
    h('div', { class: 'small muted' }, '설비 목록 (클릭: 도면 위치로 이동)'), list, linkInfo);

  const toolBtns = {};
  const tool = (k, label, title) => (toolBtns[k] = h('button', { class: 'sm', title, onclick: () => setTool(k) }, label));
  const canEdit = perm('can_create');
  const tools = h('div', { class: 'v-tools' },
    tool('select', '선택·이동', '표시 선택, 드래그로 이동, 빈 곳 드래그로 화면 이동'),
    canEdit ? [tool('point', '점', '장비 위치 점 표시'), tool('rect', '영역', '드래그로 영역 표시'), tool('polyline', '경로', '클릭으로 꺾은선, 더블클릭 또는 Enter로 완료'), tool('calib', '축척 보정', '도면의 실제 길이를 아는 두 점 클릭')] : null,
    h('span', { class: 'sep' }),
    h('button', { class: 'sm', onclick: () => setZoom(S.zoom * 1.25) }, '확대'), h('button', { class: 'sm', onclick: () => setZoom(S.zoom / 1.25) }, '축소'),
    h('button', { class: 'sm', onclick: () => fit() }, '맞춤'), h('button', { class: 'sm', onclick: () => { S.rot = (S.rot + 90) % 360; render(); } }, '회전'),
    h('span', { class: 'sep' }),
    h('a', { class: 'btn sm', href: `#/s/${sid}/drawings` }, '도면 관리'));
  const canvas = h('canvas');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const stage = h('div', { class: 'v-stage' }, canvas, svg);
  const stageWrap = h('div', { class: 'v-stage-wrap' }, stage);
  const status = h('div', { class: 'v-status' });
  const center = h('div', { class: 'v-center' }, tools, stageWrap, status);
  const markBar = h('div');
  const cardBox = h('div', null, h('div', { class: 'muted small' }, '도면의 표시나 왼쪽 목록에서 설비를 선택하면 이력 카드가 표시됩니다.'));
  const right = h('div', { class: 'v-right' }, markBar, cardBox);
  const mtabs = h('div', { class: 'mobile-tabs' }, ...[['list', '목록'], ['draw', '도면'], ['card', '이력 카드']].map(([k, l]) => h('button', { 'data-k': k, onclick: () => setMTab(k) }, l)));
  const root = h('div', { class: 'viewer', 'data-mtab': 'draw' }, left, center, right);
  clear(main, mtabs, root);
  function setMTab(k) { root.dataset.mtab = k; mtabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); if (k === 'draw') render(); }
  setMTab('draw');

  // ---------- 데이터 ----------
  async function loadRev() {
    S.rev = await GET(`/api/revisions/${revId}`);
    S.marks = S.rev.marks;
    S.assets = await GET(`/api/sites/${sid}/assets`);
    renderList();
    if (S.rev.display_type === 'none' || !S.rev.display_file_id) {
      clear(stageWrap, h('div', { class: 'box', style: { margin: '20px' } },
        h('p', null, '이 개정본에는 화면 표시용 PDF·이미지가 없습니다. DWG/DXF는 이 시스템에서 직접 표시하지 않습니다.'),
        S.rev.source_file_id ? h('p', null, '원본: ', h('a', { href: `/api/files/${S.rev.source_file_id}` }, S.rev.source_name), ' (다운로드)') : null,
        h('p', { class: 'small muted' }, 'CAD에서 PDF로 출력한 변환본을 같은 개정번호로 다시 등록하면 표시·연결 기능을 사용할 수 있습니다.')));
      return;
    }
    if (S.rev.display_type === 'pdf') {
      const lib = await loadPdfjs();
      S.doc = await lib.getDocument({ url: `/api/files/${S.rev.display_file_id}?inline=1`, withCredentials: true }).promise;
      if (!S.rev.pages?.length) {
        const pages = [];
        for (let i = 1; i <= S.doc.numPages; i++) { const pg = await S.doc.getPage(i); const vp = pg.getViewport({ scale: 1, rotation: pg.rotate }); pages.push({ w: vp.width, h: vp.height, rotate: pg.rotate }); }
        S.rev.pages = pages;
        PUT(`/api/revisions/${revId}`, { pages }).catch(() => {});
      }
    } else {
      S.img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('이미지를 불러올 수 없습니다.')); im.src = `/api/files/${S.rev.display_file_id}?inline=1`; });
      if (!S.rev.pages?.length) { S.rev.pages = [{ w: S.img.naturalWidth, h: S.img.naturalHeight, rotate: 0 }]; PUT(`/api/revisions/${revId}`, { pages: S.rev.pages }).catch(() => {}); }
    }
    const want = query.get('mark');
    const m = want ? S.marks.find(x => String(x.id) === want) : null;
    S.page = m ? m.page : 1;
    S.base = S.rev.pages[S.page - 1];
    fitZoom();
    await render();
    if (m) { selectMark(m, true); }
    else if (query.get('asset')) locateAsset(Number(query.get('asset')));
    updateStatus();
  }

  const pageCount = () => S.rev?.pages?.length || 1;

  // ---------- 좌표 변환 (정규화 ↔ 화면) ----------
  function stageSize() { const { w, h: hh } = S.base; return (S.rot % 180 === 0) ? [w * S.zoom, hh * S.zoom] : [hh * S.zoom, w * S.zoom]; }
  function toScreen(nx, ny) {
    const W = S.base.w, H = S.base.h; const bx = nx * W, by = ny * H;
    let x, y;
    if (S.rot === 0) { x = bx; y = by; } else if (S.rot === 90) { x = H - by; y = bx; } else if (S.rot === 180) { x = W - bx; y = H - by; } else { x = by; y = W - bx; }
    return [x * S.zoom, y * S.zoom];
  }
  function toNorm(sx, sy) {
    const W = S.base.w, H = S.base.h; const rx = sx / S.zoom, ry = sy / S.zoom;
    let bx, by;
    if (S.rot === 0) { bx = rx; by = ry; } else if (S.rot === 90) { bx = ry; by = H - rx; } else if (S.rot === 180) { bx = W - rx; by = H - ry; } else { bx = W - ry; by = rx; }
    return [bx / W, by / H];
  }
  function evtPos(e) { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // ---------- 렌더링 ----------
  async function render() {
    if (!S.rev || (!S.doc && !S.img)) return;
    S.base = S.rev.pages[S.page - 1] || S.base;
    const [sw, sh] = stageSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 너무 큰 캔버스 방지
    const maxPx = 8000; const scale = Math.min(dpr, maxPx / Math.max(sw, sh));
    canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
    canvas.style.width = sw + 'px'; canvas.style.height = sh + 'px';
    svg.setAttribute('width', sw); svg.setAttribute('height', sh); svg.setAttribute('viewBox', `0 0 ${sw} ${sh}`);
    stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
    const ctx = canvas.getContext('2d');
    if (S.doc) {
      const pg = await S.doc.getPage(S.page);
      if (S.renderTask) { try { S.renderTask.cancel(); } catch {} }
      const vp = pg.getViewport({ scale: S.zoom * scale, rotation: (pg.rotate + S.rot) % 360 });
      S.renderTask = pg.render({ canvasContext: ctx, viewport: vp });
      try { await S.renderTask.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e); }
    } else {
      ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(S.rot * Math.PI / 180);
      const iw = S.base.w * S.zoom * scale, ih = S.base.h * S.zoom * scale;
      ctx.drawImage(S.img, -iw / 2, -ih / 2, iw, ih); ctx.restore();
    }
    pageInfo.textContent = `${S.page} / ${pageCount()} 쪽`;
    drawOverlay();
    updateStatus();
  }

  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

  function visible(m) {
    const c = state.meta.CATEGORIES[m.category] || {};
    const key = m.category === 'cctv' ? 'cctv' : c.medium || (['panel', 'load'].includes(m.category) ? 'power' : 'equipment');
    if (!S.filters.cats.has(key)) return false;
    if (S.filters.recheckOnly && !m.needs_recheck) return false;
    if (S.filters.status && m.status !== S.filters.status) return false;
    return true;
  }

  function markGeomScreen(m) {
    const g = m.geom;
    if (m.shape === 'point') return { pt: toScreen(g.x, g.y) };
    if (m.shape === 'rect') return { poly: [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]].map(p => toScreen(p[0], p[1])) };
    return { line: g.pts.map(p => toScreen(p[0], p[1])) };
  }

  function drawOverlay() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!S.rev) return;
    const pageMarks = S.marks.filter(m => m.page === S.page && visible(m));
    // 축척 기준선
    const sc = S.rev.scales?.[S.page];
    if (sc) {
      const [a, b] = [toScreen(...sc.p1), toScreen(...sc.p2)];
      svg.appendChild(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#2c6e3a', 'stroke-width': 2, 'stroke-dasharray': '6 3' }));
      const t = sv('text', { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 - 6, fill: '#2c6e3a', 'font-size': 12, 'text-anchor': 'middle' }); t.textContent = `축척 기준 ${sc.len_m} m`; svg.appendChild(t);
    }
    for (const m of pageMarks) {
      const col = colorOf(m.category);
      const sel = S.selMark?.id === m.id;
      const dash = m.needs_recheck ? '5 4' : null;
      const g = markGeomScreen(m);
      const grp = sv('g', {});
      const label = (x, y) => { const t = sv('text', { x: x + 8, y: y - 6, 'font-size': 11, fill: col, 'font-weight': sel ? 700 : 400, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = m.mgmt_no + (m.needs_recheck ? ' (재확인)' : ''); return t; };
      if (g.pt) {
        if (sel) grp.appendChild(sv('circle', { cx: g.pt[0], cy: g.pt[1], r: 12, fill: 'none', stroke: '#e08a00', 'stroke-width': 3 }));
        const c = sv('circle', { cx: g.pt[0], cy: g.pt[1], r: 6, fill: col, stroke: '#fff', 'stroke-width': 1.5 }); if (dash) { c.setAttribute('fill', '#fff'); c.setAttribute('stroke', col); c.setAttribute('stroke-dasharray', '3 2'); c.setAttribute('stroke-width', 2); }
        grp.appendChild(c); grp.appendChild(label(...g.pt));
      } else {
        const pts = (g.poly || g.line).map(p => p.join(',')).join(' ');
        const tag = g.poly ? 'polygon' : 'polyline';
        if (sel) grp.appendChild(sv(tag, { points: pts, fill: 'none', stroke: '#e08a00', 'stroke-width': 8, 'stroke-opacity': 0.45, 'stroke-linejoin': 'round' }));
        grp.appendChild(sv(tag, { points: pts, fill: g.poly ? col + '18' : 'none', stroke: col, 'stroke-width': sel ? 3 : 2, 'stroke-linejoin': 'round', ...(dash ? { 'stroke-dasharray': dash } : {}) }));
        const lp = (g.poly || g.line)[0]; grp.appendChild(label(...lp));
        if (sel && canEditMark()) for (const p of (g.poly || g.line)) grp.appendChild(sv('rect', { x: p[0] - 4, y: p[1] - 4, width: 8, height: 8, fill: '#fff', stroke: '#e08a00', 'stroke-width': 1.5 }));
      }
      svg.appendChild(grp);
    }
    // 그리는 중인 객체
    if (S.draft) {
      const d = S.draft;
      if (d.type === 'polyline' || d.type === 'calib') {
        const pts = [...d.pts, d.hover].filter(Boolean).map(p => toScreen(...p).join(',')).join(' ');
        svg.appendChild(sv('polyline', { points: pts, fill: 'none', stroke: d.type === 'calib' ? '#2c6e3a' : '#e08a00', 'stroke-width': 2, 'stroke-dasharray': '4 3' }));
        for (const p of d.pts) { const s = toScreen(...p); svg.appendChild(sv('circle', { cx: s[0], cy: s[1], r: 3.5, fill: '#e08a00' })); }
      }
      if (d.type === 'rect' && d.p2) {
        const a = toScreen(...d.p1), b = toScreen(...d.p2);
        svg.appendChild(sv('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), fill: 'none', stroke: '#e08a00', 'stroke-width': 2, 'stroke-dasharray': '4 3' }));
      }
    }
  }

  // ---------- 선택 판정 ----------
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy;
    let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  function hitTest(sp) {
    const out = [];
    for (const m of S.marks) {
      if (m.page !== S.page || !visible(m)) continue;
      const g = markGeomScreen(m);
      let d = Infinity;
      if (g.pt) d = Math.hypot(sp[0] - g.pt[0], sp[1] - g.pt[1]) - 4;
      else {
        const pts = g.poly ? [...g.poly, g.poly[0]] : g.line;
        for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(sp, pts[i], pts[i + 1]));
        if (g.poly) { const xs = g.poly.map(p => p[0]), ys = g.poly.map(p => p[1]); if (sp[0] >= Math.min(...xs) && sp[0] <= Math.max(...xs) && sp[1] >= Math.min(...ys) && sp[1] <= Math.max(...ys)) d = Math.min(d, 3); }
      }
      if (d <= 7) out.push({ m, d });
    }
    return out.sort((a, b) => a.d - b.d).map(x => x.m);
  }

  let candBox = null;
  function showCandidates(list, sp) {
    hideCandidates();
    candBox = h('div', { class: 'cand', style: { left: sp[0] + 10 + 'px', top: sp[1] + 10 + 'px' } },
      h('div', { class: 'h' }, `겹친 표시 ${list.length}개 — 선택하세요`),
      ...list.map(m => h('div', { onclick: () => { hideCandidates(); selectMark(m); } }, `${m.mgmt_no} · ${catLabel(m.category)}${m.name ? ' · ' + m.name : ''}`)));
    stage.appendChild(candBox);
  }
  function hideCandidates() { candBox?.remove(); candBox = null; }

  // ---------- 선택 / 카드 ----------
  const canEditMark = () => perm('can_edit');
  function selectMark(m, scroll) {
    S.selMark = m;
    drawOverlay();
    renderMarkBar();
    openCard(m.asset_id);
    highlightList(m.asset_id);
    if (scroll) centerOn(m);
  }
  function centerOn(m) {
    const g = markGeomScreen(m); const pts = g.pt ? [g.pt] : (g.poly || g.line);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    stageWrap.scrollTo({ left: cx + 20 - stageWrap.clientWidth / 2, top: cy + 20 - stageWrap.clientHeight / 2, behavior: 'smooth' });
  }
  function openCard(assetId) {
    renderCard(cardBox, assetId, { compact: true, onLocate: (mk) => { if (mk.revision_id === S.rev.id) { const mm = S.marks.find(x => x.id === mk.id); if (mm) { goPage(mm.page).then(() => selectMark(mm, true)); setMTab('draw'); } } else location.hash = `#/s/${sid}/viewer/${mk.revision_id}?mark=${mk.id}`; }, onChanged: () => loadRev() });
  }

  function polylineLengthM(m) {
    const sc = S.rev.scales?.[m.page];
    if (!sc || m.shape !== 'polyline') return null;
    const pg = S.rev.pages[m.page - 1];
    const L = (a, b) => Math.hypot((b[0] - a[0]) * pg.w, (b[1] - a[1]) * pg.h);
    const ref = L(sc.p1, sc.p2); if (!ref) return null;
    let s = 0; for (let i = 0; i < m.geom.pts.length - 1; i++) s += L(m.geom.pts[i], m.geom.pts[i + 1]);
    return s * sc.len_m / ref;
  }

  function renderMarkBar() {
    const m = S.selMark;
    if (!m) { clear(markBar); return; }
    const len = polylineLengthM(m);
    const asset = S.assets.find(a => a.id === m.asset_id);
    clear(markBar, h('div', { class: 'box', style: { padding: '8px 10px' } },
      h('div', { class: 'small' }, h('b', null, `도면 표시 #${m.id}`), ` · ${S.rev.drawing_no} Rev.${S.rev.rev_no} · ${m.page}쪽 · ${({ point: '점', rect: '영역', polyline: '경로' })[m.shape]}`),
      m.needs_recheck ? h('div', { class: 'small', style: { marginTop: '4px' } }, h('span', { class: 'tag warn' }, '위치 재확인 필요'), ' 이전 개정본에서 복사된 표시입니다. 위치를 확인한 뒤 확정하세요.') : null,
      m.shape === 'polyline' ? h('div', { class: 'small', style: { marginTop: '4px' } }, len !== null
        ? [`도면상 추정길이 약 ${len.toFixed(1)} m`, h('span', { class: 'muted' }, ` (축척 기준선으로 계산, 현장 실측 포설길이와 다를 수 있음${asset?.details?.actual_length ? ` · 실제 포설길이 ${asset.details.actual_length} m` : ''})`)]
        : h('span', { class: 'muted' }, '이 페이지는 축척이 설정되지 않아 길이를 표시하지 않습니다.')) : null,
      canEditMark() ? h('div', { class: 'btns', style: { marginTop: '6px' } },
        m.needs_recheck ? h('button', { class: 'sm primary', onclick: async () => { await saveMark(m, { confirm: true }); toast('위치를 확정했습니다.'); } }, '위치 확인 완료') : null,
        h('button', { class: 'sm', onclick: () => relinkMark(m) }, '연결 설비 변경'),
        perm('can_delete') ? h('button', { class: 'sm danger', onclick: () => deleteMark(m) }, '표시 삭제') : null) : null));
  }

  async function saveMark(m, extra = {}) {
    try {
      const r = await PUT(`/api/marks/${m.id}`, { geom: extra.confirm ? undefined : m.geom, version: m.version, ...extra });
      m.version = r.version;
      if (extra.confirm || !extra.asset_id) m.needs_recheck = extra.confirm ? 0 : 0;
      if (extra.asset_id) { const a = S.assets.find(x => x.id === Number(extra.asset_id)); Object.assign(m, { asset_id: a.id, mgmt_no: a.mgmt_no, category: a.category, name: a.name, status: a.status }); }
      drawOverlay(); renderMarkBar();
    } catch (e) { toast(e.message, true); await reloadMarks(); }
  }
  async function reloadMarks() { const r = await GET(`/api/revisions/${revId}`); S.marks = r.marks; S.rev.scales = r.scales; if (S.selMark) S.selMark = S.marks.find(x => x.id === S.selMark.id) || null; drawOverlay(); renderMarkBar(); renderList(); }
  async function deleteMark(m) {
    if (!await confirmBox(`${m.mgmt_no} 의 도면 표시를 삭제할까요? 설비 데이터와 이력은 삭제되지 않습니다.`, '삭제')) return;
    try { await DEL(`/api/marks/${m.id}`); S.selMark = null; await reloadMarks(); } catch (e) { toast(e.message, true); }
  }
  async function relinkMark(m) {
    const id = await pickAsset('연결할 설비 선택', m.asset_id);
    if (id) saveMark(m, { asset_id: id });
  }

  async function pickAsset(title, current) {
    const q = h('input', { type: 'search', placeholder: '관리번호·명칭' });
    const sel = h('select', { size: 10, style: { height: 'auto', width: '100%' } });
    const fill = () => clear(sel, ...S.assets.filter(a => !q.value || (a.mgmt_no + ' ' + (a.name || '')).toLowerCase().includes(q.value.toLowerCase())).map(a => h('option', { value: a.id, selected: a.id === current }, `${a.mgmt_no} · ${catLabel(a.category)} ${a.name || ''}${a.mark_count ? '' : ' (도면 미연결)'}`)));
    q.addEventListener('input', fill); fill();
    return modal(title, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, q, sel), { size: 'narrow', buttons: [{ label: '선택', primary: true, action: () => { if (!sel.value) throw new Error('설비를 선택하세요.'); return Number(sel.value); } }] });
  }

  // ---------- 목록 ----------
  function renderList() {
    const onPage = new Set(S.marks.map(m => m.asset_id));
    const q = searchIn.value.trim().toLowerCase();
    const rows = S.assets.filter(a => !q || (a.mgmt_no + ' ' + (a.name || '')).toLowerCase().includes(q));
    clear(list, ...rows.map(a => h('div', { 'data-id': a.id, class: S.linkAsset === a.id ? 'sel' : '', onclick: () => { S.linkAsset = a.id; highlightList(a.id); locateAsset(a.id); } },
      h('span', { class: 'dot', style: { background: onPage.has(a.id) ? colorOf(a.category) : '#ccc' } }), h('span', { style: { flex: 1 } }, a.mgmt_no, ' ', h('span', { class: 'muted' }, a.name || catLabel(a.category))))));
    linkInfo.textContent = canEdit ? '목록에서 설비를 선택한 뒤 도구로 그리면 그 설비에 연결됩니다. 회색 점: 이 개정본에 표시 없음' : '';
  }
  function highlightList(aid) { list.querySelectorAll('div[data-id]').forEach(d => d.classList.toggle('sel', Number(d.dataset.id) === aid)); }
  searchIn.addEventListener('input', renderList);
  searchIn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = searchIn.value.trim().toLowerCase();
    const a = S.assets.find(x => x.mgmt_no.toLowerCase() === q) || S.assets.find(x => x.mgmt_no.toLowerCase().includes(q));
    if (!a) return toast('일치하는 관리번호가 없습니다.', true);
    S.linkAsset = a.id; locateAsset(a.id);
  });

  async function locateAsset(aid) {
    const ms = S.marks.filter(m => m.asset_id === aid);
    if (ms.length) {
      const m = ms.find(x => x.page === S.page) || ms[0];
      if (m.page !== S.page) await goPage(m.page);
      selectMark(m, true);
      setMTab('draw');
      // 강조 깜빡임
      let n = 0; const iv = setInterval(() => { S.selMark = (n % 2) ? m : null; drawOverlay(); if (++n > 5) { clearInterval(iv); S.selMark = m; drawOverlay(); } }, 180);
    } else {
      S.selMark = null; drawOverlay(); renderMarkBar();
      openCard(aid);
      toast('이 개정본에는 표시가 없습니다. 이력 카드의 도면 탭에서 다른 도면을 확인하거나 도구로 위치를 지정하세요.');
    }
  }

  // ---------- 페이지·확대 ----------
  async function goPage(n) { if (n < 1 || n > pageCount()) return; S.page = n; hideCandidates(); S.draft = null; await render(); }
  function fitZoom() { const avail = Math.max(300, stageWrap.clientWidth - 40); const w = S.rot % 180 === 0 ? S.base.w : S.base.h; S.zoom = Math.max(0.1, Math.min(6, avail / w)); }
  function fit() { fitZoom(); render(); }
  let zt;
  function setZoom(z, anchor) {
    const old = S.zoom; z = Math.max(0.1, Math.min(8, z));
    const ax = anchor ? anchor[0] : stageWrap.scrollLeft + stageWrap.clientWidth / 2 - 20;
    const ay = anchor ? anchor[1] : stageWrap.scrollTop + stageWrap.clientHeight / 2 - 20;
    S.zoom = z;
    clearTimeout(zt);
    zt = setTimeout(async () => {
      await render();
      const k = z / old;
      stageWrap.scrollLeft = ax * k - (anchor ? anchor[2] : stageWrap.clientWidth / 2 - 20);
      stageWrap.scrollTop = ay * k - (anchor ? anchor[3] : stageWrap.clientHeight / 2 - 20);
    }, 60);
  }
  stageWrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const wr = stageWrap.getBoundingClientRect();
    setZoom(S.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), [sx, sy, e.clientX - wr.left - 20, e.clientY - wr.top - 20]);
  }, { passive: false });

  function setTool(k) {
    S.tool = k; S.draft = null; hideCandidates();
    Object.entries(toolBtns).forEach(([kk, b]) => b.classList.toggle('on', kk === k));
    svg.style.cursor = k === 'select' ? 'default' : 'crosshair';
    status.dataset.hint = { select: '클릭: 선택 · 선택한 표시 드래그: 이동 · 꼭짓점 드래그: 수정 · 빈 곳 드래그: 화면 이동 · Ctrl+휠: 확대', point: '클릭한 위치에 점 표시', rect: '드래그해서 영역 표시', polyline: '클릭으로 점 추가 · 더블클릭/Enter 완료 · Esc 취소', calib: '실제 길이를 아는 두 점을 차례로 클릭' }[k];
    drawOverlay(); updateStatus();
  }
  function updateStatus() {
    const sc = S.rev?.scales?.[S.page];
    clear(status, h('span', null, `확대 ${Math.round(S.zoom * 100)}%`), h('span', null, `회전 ${S.rot}°`),
      h('span', null, sc ? `축척 설정됨 (${sc.len_m} m 기준선)` : '축척 미설정'),
      h('span', null, `이 쪽 표시 ${S.marks.filter(m => m.page === S.page).length}개`),
      S.rev ? h('span', null, `${S.rev.drawing_no} Rev.${S.rev.rev_no} · ${S.rev.review_status}${S.rev.latest_id !== S.rev.id ? ' · 이전 개정본' : ''}`) : null,
      h('span', { style: { color: '#333' } }, status.dataset.hint || ''));
  }

  // ---------- 마우스 조작 ----------
  let drag = null;
  svg.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    hideCandidates();
    const sp = evtPos(e); const np = toNorm(...sp);
    if (S.tool === 'select') {
      const m = S.selMark;
      if (m && canEditMark() && m.page === S.page) {
        const g = markGeomScreen(m);
        const verts = g.pt ? [g.pt] : (g.poly || g.line);
        const vi = verts.findIndex(p => Math.hypot(p[0] - sp[0], p[1] - sp[1]) < 8);
        if (vi >= 0 && !g.pt) { drag = { kind: 'vertex', m, vi, start: np, orig: JSON.parse(JSON.stringify(m.geom)) }; return; }
        if (hitTest(sp).some(x => x.id === m.id)) { drag = { kind: 'move', m, start: np, orig: JSON.parse(JSON.stringify(m.geom)), moved: false }; return; }
      }
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, sl: stageWrap.scrollLeft, st: stageWrap.scrollTop, moved: false, sp };
      return;
    }
    if (S.tool === 'rect') { S.draft = { type: 'rect', p1: np, p2: null }; drag = { kind: 'rect' }; }
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  function onMove(e) {
    if (!svg.isConnected) { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); return; }
    const sp = evtPos(e); const np = toNorm(...sp);
    if (S.draft && (S.draft.type === 'polyline' || S.draft.type === 'calib') && S.draft.pts.length) { S.draft.hover = np; drawOverlay(); }
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      stageWrap.scrollLeft = drag.sl - dx; stageWrap.scrollTop = drag.st - dy;
    } else if (drag.kind === 'move') {
      const dx = np[0] - drag.start[0], dy = np[1] - drag.start[1];
      if (Math.abs(dx) + Math.abs(dy) > 0.001) drag.moved = true;
      const o = drag.orig; const m = drag.m;
      if (m.shape === 'point') m.geom = { x: o.x + dx, y: o.y + dy };
      else if (m.shape === 'rect') m.geom = { ...o, x: o.x + dx, y: o.y + dy };
      else m.geom = { pts: o.pts.map(p => [p[0] + dx, p[1] + dy]) };
      drawOverlay();
    } else if (drag.kind === 'vertex') {
      const m = drag.m; drag.moved = true;
      if (m.shape === 'polyline') { m.geom.pts[drag.vi] = np; }
      else if (m.shape === 'rect') {
        const o = drag.orig; const corners = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]];
        const opp = corners[(drag.vi + 2) % 4];
        m.geom = { x: Math.min(opp[0], np[0]), y: Math.min(opp[1], np[1]), w: Math.abs(opp[0] - np[0]), h: Math.abs(opp[1] - np[1]) };
      }
      drawOverlay();
    } else if (drag.kind === 'rect') { S.draft.p2 = np; drawOverlay(); }
  }
  async function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === 'pan' && !d.moved) {
      let hits = hitTest(d.sp);
      // 장비 점을 정확히 누른 경우 점을 우선 (케이블 끝이 같은 위치에 겹치는 경우가 많음)
      const pts = hits.filter(m => m.shape === 'point');
      if (pts.length === 1 && hits.length > 1) hits = pts;
      if (hits.length > 1) showCandidates(hits, d.sp);
      else if (hits.length === 1) selectMark(hits[0]);
      else { S.selMark = null; drawOverlay(); renderMarkBar(); }
    }
    if ((d.kind === 'move' || d.kind === 'vertex') && d.moved) await saveMark(d.m);
    if (d.kind === 'rect' && S.draft?.p2) {
      const { p1, p2 } = S.draft; S.draft = null;
      const g = { x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), w: Math.abs(p1[0] - p2[0]), h: Math.abs(p1[1] - p2[1]) };
      if (g.w > 0.003 && g.h > 0.003) await createMark('rect', g); else drawOverlay();
    }
  }
  svg.addEventListener('click', async (e) => {
    const np = toNorm(...evtPos(e));
    if (S.tool === 'point') await createMark('point', { x: np[0], y: np[1] });
    if (S.tool === 'polyline') { if (!S.draft) S.draft = { type: 'polyline', pts: [] }; S.draft.pts.push(np); drawOverlay(); }
    if (S.tool === 'calib') {
      if (!S.draft) S.draft = { type: 'calib', pts: [] };
      S.draft.pts.push(np);
      if (S.draft.pts.length === 2) {
        const [p1, p2] = S.draft.pts; S.draft = null; drawOverlay();
        const f = formFields([{ key: 'len', label: '두 점 사이 실제 길이 (m)', type: 'number', required: true }]);
        const v = await modal('축척 보정', h('div', null, f.el, h('p', { class: 'small muted' }, '이 페이지에만 적용됩니다. 도면상 길이 계산에만 쓰이며 실제 포설길이와 구분됩니다.')), { size: 'narrow', buttons: [{ label: '저장', primary: true, action: () => { const x = Number(f.values().len); if (!(x > 0)) throw new Error('0보다 큰 길이를 입력하세요.'); return x; } }] });
        if (v) {
          const scales = { ...(S.rev.scales || {}), [S.page]: { p1, p2, len_m: v } };
          try { await PUT(`/api/revisions/${revId}`, { scales }); S.rev.scales = scales; toast('축척을 저장했습니다.'); drawOverlay(); renderMarkBar(); updateStatus(); } catch (er) { toast(er.message, true); }
        }
      }
      drawOverlay();
    }
  });
  svg.addEventListener('dblclick', async () => { if (S.tool === 'polyline') await finishPolyline(); });
  const onKey = async (e) => {
    if (!svg.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (document.querySelector('.modal-bg')) return;
    if (e.key === 'Escape') { S.draft = null; hideCandidates(); drawOverlay(); }
    if (e.key === 'Enter' && S.tool === 'polyline') await finishPolyline();
    if ((e.key === 'Delete') && S.selMark && perm('can_delete') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) deleteMark(S.selMark);
  };
  document.addEventListener('keydown', onKey);

  async function finishPolyline() {
    if (!S.draft || S.draft.type !== 'polyline') return;
    // 더블클릭으로 들어간 중복 점 제거
    const pts = S.draft.pts.filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 0.001);
    S.draft = null;
    if (pts.length < 2) { drawOverlay(); return toast('경로는 두 점 이상이어야 합니다.', true); }
    await createMark('polyline', { pts });
  }

  async function createMark(shape, geom) {
    let aid = S.linkAsset;
    if (!aid) aid = await pickAsset('이 표시에 연결할 설비');
    if (!aid) { drawOverlay(); return; }
    const a = S.assets.find(x => x.id === aid);
    const isCable = state.meta.CATEGORIES[a.category]?.group === 'cable';
    if (shape === 'polyline' && !isCable && !await confirmBox(`${a.mgmt_no} 은(는) 케이블이 아닙니다. 경로로 표시할까요?`)) { drawOverlay(); return; }
    try {
      const r = await POST(`/api/revisions/${revId}/marks`, { asset_id: aid, shape, geom, page: S.page });
      await reloadMarks();
      const m = S.marks.find(x => x.id === r.id);
      if (m) selectMark(m);
      toast(`${a.mgmt_no} 표시를 저장했습니다.`);
    } catch (e) { toast(e.message, true); drawOverlay(); }
  }

  window.addEventListener('resize', () => { if (svg.isConnected) drawOverlay(); }, { once: true });
  setTool('select');
  try { await loadRev(); } catch (e) { clear(stageWrap, h('div', { class: 'err', style: { margin: '20px' } }, '도면을 불러오지 못했습니다: ' + e.message)); }
}
