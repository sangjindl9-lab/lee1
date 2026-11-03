'use strict';
/* PDF 출력 (pdfkit, 벡터 우선). 한글 글꼴은 fonts/NotoSansKR(OFL)을 내장합니다.
 * - 지정 축척 출력: 실제 크기 인쇄 시 축척 성립. 축척 미설정 도면은 지정 축척 출력 불가
 * - 용지 맞춤 출력: 축척 값을 표기하지 않고 '용지 맞춤(축척 없음)'으로 표기 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const CAT = require('../../shared/catalog');
const C = require('../../shared/calc');
const SYM = require('../../shared/symbols');
const SCH = require('../../shared/schematic');
const SVGtoPDF = require('svg-to-pdfkit');
const TB = require('../../shared/tables');

const FONT = path.join(__dirname, '..', '..', 'fonts', 'NotoSansKR-Regular.otf');
const FONTB = path.join(__dirname, '..', '..', 'fonts', 'NotoSansKR-Bold.otf');
const PAPER = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] };
const MM = 72 / 25.4;
const VIEWS = {
  layout: { title: 'CCTV 배치도', cables: ['utp', 'stp', 'fiber', 'coax', 'composite', 'power', 'ground'], conduits: false, fov: true, thinCables: true },
  network: { title: 'UTP·광케이블 경로도', cables: ['utp', 'stp', 'fiber'], conduits: false, fov: false },
  coax: { title: '동축케이블 경로도', cables: ['coax', 'composite'], conduits: false, fov: false },
  power: { title: '전원케이블 경로도', cables: ['power', 'composite', 'ground'], conduits: false, fov: false },
  video_power: { title: '영상·전원 통합 경로도', cables: ['coax', 'composite', 'power'], conduits: false, fov: false },
  raceway: { title: '배관·트레이 경로도', cables: [], conduits: true, fov: false },
  all: { title: '종합 설계도', cables: ['utp', 'stp', 'fiber', 'coax', 'composite', 'power', 'ground'], conduits: true, fov: true }
};

function bgMatrix(rot, W, H) { return { 0: [1, 0, 0, 1, 0, 0], 90: [0, 1, -1, 0, H, 0], 180: [-1, 0, 0, -1, W, H], 270: [0, -1, 1, 0, 0, W] }[rot || 0]; }
function sheetSize(s) { const W = s.bg.width, H = s.bg.height; return (s.rotation || 0) % 180 ? [H, W] : [W, H]; }
const gray = c => { const h = c.replace('#', ''); const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16); const v = Math.round(0.3 * r + 0.59 * g + 0.11 * b); return '#' + [v, v, v].map(x => x.toString(16).padStart(2, '0')).join(''); };

async function render(model, opts, ctx) {
  const st0 = (model.project && model.project.settings) || {};
  model = { ...model, devices: model.devices.map(d => SYM.attach(d, st0)) };
  if (opts.asbuilt) {
    // 준공도: 철거 객체 제외, 실제 설치 위치가 기록된 장비는 실제 위치로 표시
    const demo = new Set(model.devices.filter(d => d.status === '철거').map(d => d.id));
    model = { ...model, devices: model.devices.filter(d => !demo.has(d.id)).map(d => d.field && d.field.actual ? { ...d, x: d.field.actual[0], y: d.field.actual[1] } : d), cables: model.cables.filter(c => c.status !== '철거'), conduits: model.conduits.filter(c => c.status !== '철거') };
  }
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, info: { Title: model.project.name, Creator: 'CCTV 공사 설계 프로그램' } });
  doc.registerFont('kr', FONT); doc.registerFont('krb', FONTB); doc.font('kr');
  const chunks = []; doc.on('data', d => chunks.push(d));
  const done = new Promise(r => doc.on('end', r));
  const paper = PAPER[opts.paper || 'A3'] || PAPER.A3;
  const land = (opts.orient || 'landscape') === 'landscape';
  const [PW, PH] = land ? [paper[1], paper[0]] : paper;
  const notes = [];
  const kind = opts.kind || 'sheets';
  if (kind === 'sheets') {
    const ids = opts.sheets && opts.sheets.length ? opts.sheets : model.sheets.map(s => s.id);
    for (const sid of ids) { const s = model.sheets.find(x => x.id === sid); if (!s) continue; await drawSheetPage(doc, model, s, opts, ctx, PW, PH, notes); }
  } else if (kind === 'schematic') drawSchematicPage(doc, model, opts, ctx, PW, PH);
  else if (kind === 'tables') drawTables(doc, model, opts, ctx, PW, PH);
  else if (kind === 'legend') drawLegendPage(doc, model, opts, ctx, PW, PH);
  if (!doc._root.data.Pages.data.Kids.length) { doc.addPage({ size: [PW * MM, PH * MM] }); doc.fontSize(14).text('출력할 내용이 없습니다.', 40, 40); }
  doc.end(); await done;
  return Buffer.concat(chunks);
}

function titleBlock(doc, model, ctx, PW, PH, fields) {
  const p = model.project; const st = p.settings || {};
  const h = 30, m = 8; const y = PH - m - h; const W = PW - 2 * m;
  doc.save(); doc.lineWidth(0.5).strokeColor('#000');
  doc.rect(m * MM, m * MM, W * MM, (PH - 2 * m) * MM).stroke();
  const tb = st.titleblock_file_id && ctx.getFile(st.titleblock_file_id);
  const cells = [['회사', '', 42], ['공사명', p.name || '', 0], ['도면명', fields.title, 0], ['도면번호', fields.no || p.drawing_no || '', 34], ['축척', fields.scale, 44], ['작성일', p.written_at || new Date().toISOString().slice(0, 10), 26], ['개정', fields.rev || p.revision || '', 14], ['설계', st.sign_design || '', 16], ['검토', st.sign_review || '', 16], ['승인', st.sign_approve || '', 16]];
  if (tb && fs.existsSync(tb.abs)) {
    doc.image(tb.abs, m * MM, y * MM, { width: W * MM, height: h * MM });
    const pos = st.titleblock_fields || {};
    cells.forEach(([k, v]) => { const q = pos[k]; if (q && v) doc.font('kr').fontSize((q.size || 3) * MM).fillColor('#000').text(String(v), (m + q.x) * MM, (y + q.y) * MM, { lineBreak: false }); });
    doc.restore(); return { x: m, y: m, w: W, h: PH - 2 * m - h };
  }
  let fixed = cells.reduce((s, c) => s + c[2], 0); const nflex = cells.filter(c => !c[2]).length;
  // 좁은 용지(A4 세로 등): 고정 칸을 줄여 가변 칸 최소 폭 확보
  if (W - fixed < nflex * 30) { const f = (W - nflex * 30) / fixed; cells.forEach(c => { if (c[2]) c[2] = c[2] * f; }); fixed = cells.reduce((s, c) => s + c[2], 0); }
  const flex = Math.max(10, (W - fixed) / nflex);
  let x = m;
  doc.moveTo(m * MM, y * MM).lineTo((m + W) * MM, y * MM).stroke();
  cells.forEach(([k, v, w], i) => {
    const cw = w || flex;
    if (i) doc.moveTo(x * MM, y * MM).lineTo(x * MM, (y + h) * MM).stroke();
    doc.moveTo(x * MM, (y + 6) * MM).lineTo((x + cw) * MM, (y + 6) * MM).lineWidth(0.3).stroke().lineWidth(0.5);
    doc.font('kr').fontSize(2.6 * MM).fillColor('#333').text(k, x * MM, (y + 1.3) * MM, { width: cw * MM, align: 'center', lineBreak: false });
    if (k === '회사') {
      const logo = ctx.company && ctx.company.logo_file_id && ctx.getFile(ctx.company.logo_file_id);
      if (logo && fs.existsSync(logo.abs)) { try { doc.image(logo.abs, (x + 2) * MM, (y + 7.5) * MM, { fit: [(cw - 4) * MM, 12 * MM], align: 'center' }); } catch { } }
      doc.font('krb').fontSize(3.2 * MM).fillColor('#000').text(ctx.company ? ctx.company.name : '', x * MM, (y + 22) * MM, { width: cw * MM, align: 'center', lineBreak: false });
    } else {
      const fs2 = String(v).length > 30 ? 2.8 : 3.6;
      doc.font(k === '공사명' || k === '도면명' ? 'krb' : 'kr').fontSize(fs2 * MM).fillColor('#000').text(String(v), (x + 1.5) * MM, (y + 9) * MM, { width: (cw - 3) * MM, height: (h - 10) * MM, align: 'center' });
    }
    x += cw;
  });
  doc.restore();
  return { x: m, y: m, w: W, h: PH - 2 * m - h };
}

function setDash(doc, dashStr, K, scale) {
  if (!dashStr) { doc.undash(); return; }
  const a = dashStr.split(/\s+/).map(Number).map(v => v * (scale || 0.6) * MM / K);
  // pdfkit dash()는 2요소만 지원하므로 직접 지정
  doc.addContent(`[${a.map(v => v.toFixed(3)).join(' ')}] 0 d`);
}

async function drawSheetPage(doc, model, s, opts, ctx, PW, PH, notes) {
  doc.addPage({ size: [PW * MM, PH * MM], margin: 0 });
  const view = VIEWS[opts.view || 'layout'] || VIEWS.layout;
  const upm = C.upmOf(s);
  const [SW, SH] = sheetSize(s);
  const area = opts.area && opts.area.w ? opts.area : { x: 0, y: 0, w: SW, h: SH };
  let scaleLabel, k;
  const frame0 = { x: 8, y: 8, w: PW - 16, h: PH - 16 - 30 };
  const fr = { x: frame0.x + 2, y: frame0.y + 2, w: frame0.w - 4, h: frame0.h - 4 };
  if (opts.mode === 'scale') {
    if (!upm) { titleBlock(doc, model, ctx, PW, PH, { title: s.name + ' - ' + view.title, scale: '출력 불가' }); doc.font('krb').fontSize(6 * MM).fillColor('#c00').text('축척이 설정되지 않은 도면은 지정 축척으로 출력할 수 없습니다. 축척 보정 후 다시 출력하거나 용지 맞춤 출력을 선택하세요.', 20 * MM, 40 * MM, { width: (PW - 40) * MM }); return; }
    const N = +opts.scale || 100; k = 1000 / (upm * N); scaleLabel = `1:${N} (${opts.paper || 'A3'} 실제 크기 인쇄 시)`;
    if (area.w * k > fr.w + 0.5 || area.h * k > fr.h + 0.5) notes.push(`${s.name}: 출력 영역이 용지보다 커서 가장자리가 잘립니다.`);
  } else {
    k = Math.min(fr.w / area.w, fr.h / area.h); scaleLabel = '용지 맞춤(지정 축척 아님)';
  }
  const K = k * MM; // pt per du
  const mono = opts.color === false || opts.color === 'mono';
  const fontScale = +opts.fontScale || 1, lineScale = +opts.lineScale || 1;
  const layers = Object.fromEntries(((model.project.settings || {}).layers || CAT.LAYERS).map(l => [l.key, l]));
  const layerOn = key => { const L = layers[key]; if (!L) return true; if (opts.layers && key in opts.layers) return !!opts.layers[key]; return L.print !== false; };
  const tb = titleBlock(doc, model, ctx, PW, PH, { title: `${s.name} - ${opts.title || view.title}${opts.asbuilt ? ' (준공도)' : ''}`, scale: scaleLabel, no: s.sheet_no, rev: (s.revisions || []).slice(-1)[0] ? s.revisions.slice(-1)[0].rev_no : '' });
  const ox = (fr.x + fr.w / 2) * MM - (area.x + area.w / 2) * K;
  const oy = (fr.y + fr.h / 2) * MM - (area.y + area.h / 2) * K;
  doc.save();
  doc.rect(fr.x * MM, fr.y * MM, fr.w * MM, fr.h * MM).clip();
  doc.transform(K, 0, 0, K, ox, oy);
  // 배경
  if (layerOn('BG') && s.bg && s.bg.kind !== 'blank') {
    doc.save();
    const m = bgMatrix(s.rotation, s.bg.width, s.bg.height); doc.transform(...m);
    doc.opacity(s.opacity == null ? 1 : +s.opacity);
    if (s.bg.kind === 'image' || s.bg.kind === 'pdf') {
      const f = ctx.getFile(s.bg.file_id);
      if (s.bg.kind === 'pdf' && s.bg.vector && ctx.renderPdfSvg) {
        // 벡터 PDF 배경: SVG 변환본을 벡터로 그림(흑백 시 회색조)
        const svg = fs.readFileSync(await ctx.renderPdfSvg(f, s.bg.page), 'utf8');
        const toGray = c => { const [r, g, b] = c[0]; const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b); return [[v, v, v], c[1]]; };
        try { SVGtoPDF(doc, svg, 0, 0, { width: s.bg.width, height: s.bg.height, preserveAspectRatio: 'none', fontCallback: () => 'kr', colorCallback: mono ? toGray : undefined, warningCallback: () => { } }); } catch (e) { notes.push('벡터 배경 출력 실패: ' + e.message); }
      } else {
        let imgPath = s.bg.kind === 'image' ? f.abs : (await ctx.renderPdfPage(f, s.bg.page)).path;
        if (mono && ctx.grayImage) { try { imgPath = (await ctx.grayImage(f, s.bg.page || 1)) || imgPath; } catch (e) { notes.push('흑백 배경 변환 실패: ' + e.message); } }
        try { doc.image(imgPath, 0, 0, { width: s.bg.width, height: s.bg.height }); } catch (e) { notes.push('배경 이미지 출력 실패: ' + e.message); }
      }
    } else if (s.bg.kind === 'cad') {
      const f = ctx.getFile(s.bg.file_id); const dx = JSON.parse(fs.readFileSync(path.join(f.dir, 'dxf.json'), 'utf8'));
      const sp = dx[s.bg.space || 'model'];
      const cl = s.bg.cad_layers || {};
      const fade = opts.bgFade !== false;
      doc.lineWidth(0.13 * MM / K).undash();
      sp.entities.forEach(e => {
        const L = cl[e.L]; if (L && L.visible === false) return;
        let col = (L && L.color_override) || e.c || '#000'; if (col === '#ffffff') col = '#000000'; if (mono) col = '#000'; if (fade) col = mono ? '#777777' : mixGray(col);
        if (e.t === 'p') { doc.moveTo(e.p[0][0], e.p[0][1]); for (let i = 1; i < e.p.length; i++) doc.lineTo(e.p[i][0], e.p[i][1]); doc.strokeColor(col).stroke(); }
        else if (e.t === 'c') doc.circle(e.x, e.y, e.r).strokeColor(col).stroke();
        else if (e.t === 'tx' && e.h > 0) { doc.save(); doc.translate(e.x, e.y); if (e.rot) doc.rotate(-e.rot); doc.font('kr').fontSize(e.h * 1.3).fillColor(col); String(e.s).split('\n').forEach((ln, li) => doc.text(ln, 0, -e.h * 1.15 + li * e.h * 1.6 * (e.top ? 1 : 0) + (e.top ? e.h * 1.15 : 0), { lineBreak: false })); doc.restore(); }
      });
    }
    doc.restore();
  }
  const ix = C.index(model);
  const symSize = +(s.sym_size || Math.max(SW, SH) / 70), lab = +(s.label_size || symSize * 0.42) * fontScale;
  // 관로
  if (view.conduits && layerOn('RACEWAY')) model.conduits.filter(c => c.sheet_id === s.id).forEach(cd => {
    const L = layers.RACEWAY || {}; const pts = cd.points || []; if (pts.length < 2) return;
    doc.save(); doc.strokeColor(mono ? '#000' : L.color || '#777').lineWidth((L.lw || 0.7) * lineScale * MM / K); setDash(doc, L.dash, K);
    doc.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.stroke(); doc.restore();
    const r = C.conduitLength(cd, ix); const pr = ix.prod.get(cd.product_id);
    labelAt(doc, pts, `${cd.tag || ''} ${pr ? pr.name.replace(/\(.*\)/, '') + ' ' + (pr.spec || '') : ''} ${r.final_m != null ? r.final_m + 'm' : '(길이 미확정)'}`, lab * 0.9, mono ? '#000' : '#555');
  });
  // 화각
  if (view.fov && layerOn('FOV')) model.devices.filter(d => d.sheet_id === s.id && d.type === 'camera' && (d.props || {}).show_fov !== false).forEach(d => {
    const g = C.fovGeometry(d, upm); if (!g.ok) return;
    const col = mono ? '#888' : ((d.props || {}).fov_color || '#ffbf00'); const op = +((d.props || {}).fov_opacity || 0.18);
    doc.save(); doc.lineWidth(0.1 * MM / K).fillOpacity(mono ? 0.12 : op).strokeOpacity(0.6);
    if (g.fisheye) doc.circle(d.x, d.y, g.r_du).fillAndStroke(col, col);
    else {
      if (g.ptz) { doc.save(); setDash(doc, '3 2', K); doc.circle(d.x, d.y, g.r_du).strokeColor(col).stroke(); doc.restore(); }
      const poly = C.sectorPolygon(d.x, d.y, g.dir, g.hfov, g.r_du);
      doc.moveTo(poly[0][0], poly[0][1]); poly.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.closePath().fillAndStroke(col, col);
    }
    doc.restore();
  });
  // 케이블
  model.cables.filter(c => c.sheet_id === s.id && view.cables.includes(c.kind)).forEach(c => {
    const KD = CAT.CABLE_KINDS[c.kind]; const L = layers[KD.layer] || {}; if (!layerOn(KD.layer)) return;
    const pts = C.cablePoints(c, ix); if (pts.length < 2) return;
    const demo = c.status === '철거';
    doc.save(); doc.strokeColor(mono ? '#000' : demo ? '#888' : (L.color || '#000')).lineWidth((L.lw || 0.35) * lineScale * (view.thinCables ? 0.7 : 1) * MM / K); setDash(doc, demo ? '2 2' : KD.dash, K);
    doc.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.stroke(); doc.restore();
    if (c.kind === 'composite') { // 복합: 평행 보조선
      doc.save(); doc.strokeColor(mono ? '#000' : (layers.POWER || {}).color || '#e377c2').lineWidth(0.18 * MM / K); setDash(doc, '1 2', K);
      const off = 0.6 * MM / K; offsetLine(pts, off).forEach((p, i) => i ? doc.lineTo(p[0], p[1]) : doc.moveTo(p[0], p[1])); doc.stroke(); doc.restore();
    }
    if (!(c.from && c.from.dev) || !(c.to && c.to.dev)) { const e = !(c.to && c.to.dev) ? pts[pts.length - 1] : pts[0]; doc.save(); doc.lineWidth(0.25 * MM / K).strokeColor('#c00').circle(e[0], e[1], 1.2 * MM / K).stroke(); doc.restore(); }
    const len = C.cableLength(c, ix); const pr = ix.prod.get(c.product_id);
    labelAt(doc, pts, `${c.tag || ''} ${pr ? pr.spec || pr.name : '(규격 미지정)'} ${len.final_m != null ? len.final_m + 'm' : ''}${demo ? ' (철거)' : ''}`, lab * 0.85, mono ? '#000' : (L.color || '#000'));
  });
  // 케이블 교차(접속 아님) 점프 기호
  const shown = new Set(model.cables.filter(c => c.sheet_id === s.id && view.cables.includes(c.kind) && layerOn(CAT.CABLE_KINDS[c.kind].layer)).map(c => c.id));
  C.crossings(model, s.id, ix).filter(x => shown.has(x.cable) && shown.has(x.other)).forEach(x => {
    const cab = ix.cab.get(x.cable); const L = layers[CAT.CABLE_KINDS[cab.kind].layer] || {}; const r = 1.1 * MM / K;
    doc.save(); doc.circle(x.x, x.y, r).fill('#ffffff'); doc.strokeColor(mono ? '#000' : L.color || '#000').lineWidth((L.lw || 0.35) * MM / K).undash();
    const a = x.ang; doc.moveTo(x.x - r * Math.cos(a), x.y - r * Math.sin(a)); doc.bezierCurveTo(x.x - r * Math.cos(a) + 1.3 * r * Math.sin(a), x.y - r * Math.sin(a) - 1.3 * r * Math.cos(a), x.x + r * Math.cos(a) + 1.3 * r * Math.sin(a), x.y + r * Math.sin(a) - 1.3 * r * Math.cos(a), x.x + r * Math.cos(a), x.y + r * Math.sin(a)); doc.stroke(); doc.restore();
  });
  // 장비
  model.devices.filter(d => d.sheet_id === s.id).forEach(d => {
    const T = CAT.DEVICE_TYPES[d.type] || {}; if (!layerOn(d.layer || T.layer)) return;
    if (!view.conduits && T.raceNode && opts.view !== 'all') { /* 관로 노드는 경로도·종합도에만 크게 표시 */ }
    const sz = symSize * (+(d.props || {}).sym_scale || 1);
    const L = layers[d.layer || T.layer] || {}; const col = mono ? '#000' : (d.status === '철거' ? '#888' : L.color || '#000');
    drawSymbol(doc, d, sz, col, K, mono);
    doc.font('krb').fontSize(lab).fillColor(mono ? '#000' : '#111').text(d.tag || '', d.x + sz * 0.55, d.y - sz * 0.55 - lab * 0.3, { lineBreak: false });
    if (d.status === '철거') { doc.save(); doc.strokeColor('#000').lineWidth(0.25 * MM / K).moveTo(d.x - sz * 0.6, d.y - sz * 0.6).lineTo(d.x + sz * 0.6, d.y + sz * 0.6).moveTo(d.x - sz * 0.6, d.y + sz * 0.6).lineTo(d.x + sz * 0.6, d.y - sz * 0.6).stroke(); doc.restore(); }
  });
  // 주석
  if (layerOn('TEXT')) model.annotations.filter(a => a.sheet_id === s.id).forEach(a => drawAnnotation(doc, a, s, ix, lab, K, mono));
  doc.restore();
  // 범례 (도면 영역 우상단, 축척 비의존)
  if (opts.legend !== false) drawLegend(doc, model, s, view, fr, layers, mono);
  // 막대 축척
  if (upm) { const meters = niceLen(fr.w * 0.15 / (k * upm / 1000) / 1000); const lenMM = meters * upm * k; const bx = fr.x + 4, by = fr.y + fr.h - 6; doc.lineWidth(0.5).strokeColor('#000').undash(); doc.rect(bx * MM, by * MM, lenMM * MM, 1.5 * MM).stroke(); doc.rect(bx * MM, by * MM, lenMM / 2 * MM, 1.5 * MM).fill('#000'); doc.font('kr').fontSize(2.5 * MM).fillColor('#000').text(`0`, bx * MM - 2, (by - 3.5) * MM, { lineBreak: false }).text(`${meters}m`, (bx + lenMM) * MM - 6, (by - 3.5) * MM, { lineBreak: false }).text('막대 축척', (bx + lenMM + 3) * MM, (by - 0.5) * MM, { lineBreak: false }); }
  else { doc.font('krb').fontSize(3 * MM).fillColor('#c00').text('축척 미설정 도면 – 길이·수량 미확정', (fr.x + 3) * MM, (fr.y + fr.h - 6) * MM, { lineBreak: false }); }
  if (opts.asbuilt) { const ab = s.asbuilt || {}; const t = `준 공 도 · ${ab.status || '미작성'}${ab.by ? ' · ' + ab.by : ''}${ab.at ? ' ' + String(ab.at).slice(0, 10) : ''}`; doc.save(); doc.lineWidth(1.2).strokeColor('#b00000').rect((fr.x + 3) * MM, (fr.y + 8) * MM, 70 * MM, 10 * MM).stroke(); doc.font('krb').fontSize(4.2 * MM).fillColor('#b00000').text(t, (fr.x + 5) * MM, (fr.y + 10.2) * MM, { lineBreak: false }); doc.restore(); }
  if (opts.mode === 'scale') doc.font('kr').fontSize(2.3 * MM).fillColor('#444').text('※ 인쇄 시 "실제 크기(100%)"로 설정해야 지정 축척이 성립합니다.', (fr.x + 3) * MM, (fr.y + 2) * MM, { lineBreak: false });
  notes.filter(n => n.startsWith(s.name)).forEach((n, i) => doc.font('kr').fontSize(2.3 * MM).fillColor('#c00').text(n, (fr.x + 3) * MM, (fr.y + 6 + i * 3) * MM, { lineBreak: false }));
}
function niceLen(m) { const c = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]; return c.reduce((b, v) => Math.abs(v - m) < Math.abs(b - m) ? v : b, 1); }
function mixGray(hex) { const h = hex.replace('#', ''); const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16); const f = v => Math.round(v * 0.45 + 160 * 0.55); return '#' + [f(r), f(g), f(b)].map(x => Math.min(255, x).toString(16).padStart(2, '0')).join(''); }
function offsetLine(pts, d) { return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; return [p[0] - dy / l * d, p[1] + dx / l * d]; }); }
function labelAt(doc, pts, text, size, color) {
  // 가장 긴 구간 중앙에 경로 방향으로 라벨
  let bi = 1, bl = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (l > bl) { bl = l; bi = i; } }
  const a = pts[bi - 1], b = pts[bi]; let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  doc.save(); doc.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); doc.rotate(ang); doc.font('kr').fontSize(size).fillColor(color);
  const w = doc.widthOfString(text); doc.text(text, -w / 2, -size * 1.35, { lineBreak: false }); doc.restore();
}
function drawSymbol(doc, d, sz, col, K, mono) {
  const S = SYM.prims(d); const rot = S.rotate ? (+((d.props || {}).direction) || 0) : (+d.rot || 0);
  doc.save(); doc.translate(d.x, d.y); if (rot) doc.rotate(rot); doc.scale(sz);
  doc.lineWidth(0.3 * MM / K / sz).strokeColor(col).undash();
  S.prims.forEach(p => {
    const fill = p.fill === 'w' ? '#ffffff' : p.fill === 'k' ? col : null;
    if (p.t === 'rect') { doc.rect(p.x, p.y, p.w, p.h); fill ? doc.fillAndStroke(fill, col) : doc.stroke(); }
    else if (p.t === 'circle') { doc.circle(p.x, p.y, p.r); fill ? doc.fillAndStroke(fill, col) : doc.stroke(); }
    else if (p.t === 'poly') { doc.moveTo(p.p[0][0], p.p[0][1]); p.p.slice(1).forEach(q => doc.lineTo(q[0], q[1])); if (p.close) doc.closePath(); fill ? doc.fillAndStroke(fill, col) : doc.stroke(); }
    else if (p.t === 'text') { doc.save(); if (rot) doc.rotate(-rot, { origin: [p.x, p.y] }); doc.font('krb').fontSize(p.size).fillColor(col); const w = doc.widthOfString(p.s); doc.text(p.s, p.x - w / 2, p.y - p.size * 0.72, { lineBreak: false }); doc.restore(); }
  });
  doc.restore();
}
function drawAnnotation(doc, a, s, ix, lab, K, mono) {
  const col = mono ? '#000' : (a.color || '#000'); const sz = (+a.size || 1) * lab; const upm = C.upmOf(s);
  doc.save(); doc.lineWidth(0.18 * MM / K).strokeColor(col).undash();
  const P = a.points || [];
  if (a.type === 'text') doc.font('kr').fontSize(sz).fillColor(col).text(a.text || '', P[0][0], P[0][1] - sz, { lineBreak: false });
  else if (a.type === 'leader' && P.length >= 2) { doc.moveTo(P[0][0], P[0][1]); P.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.stroke(); arrow(doc, P[1], P[0], sz * 0.6, col); const e = P[P.length - 1]; doc.font('kr').fontSize(sz).fillColor(col).text(a.text || '', e[0] + sz * 0.3, e[1] - sz * 1.1, { lineBreak: false }); }
  else if ((a.type === 'dim' || a.type === 'measure') && P.length >= 2) {
    let len = 0; for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    doc.moveTo(P[0][0], P[0][1]); P.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.stroke();
    if (a.type === 'dim') { arrow(doc, P[1], P[0], sz * 0.6, col); arrow(doc, P[0], P[1], sz * 0.6, col); }
    const t = upm ? `${C.round2(len / upm)} m` : '(축척 미설정)';
    labelAt(doc, P, a.text ? a.text + ' ' + t : t, sz, col);
  } else if (a.type === 'area' && P.length >= 3) { doc.save(); setDash(doc, '4 2', K); doc.moveTo(P[0][0], P[0][1]); P.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.closePath().stroke(); doc.restore(); doc.font('kr').fontSize(sz).fillColor(col).text(a.text || '검토 영역', P[0][0], P[0][1] - sz * 1.3, { lineBreak: false }); }
  else if (a.type === 'polyline' && P.length >= 2) { doc.moveTo(P[0][0], P[0][1]); P.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.stroke(); }
  doc.restore();
}
function arrow(doc, from, to, s, col) { const a = Math.atan2(to[1] - from[1], to[0] - from[0]); doc.save(); doc.moveTo(to[0], to[1]).lineTo(to[0] - s * Math.cos(a - 0.4), to[1] - s * Math.sin(a - 0.4)).lineTo(to[0] - s * Math.cos(a + 0.4), to[1] - s * Math.sin(a + 0.4)).closePath().fill(col); doc.restore(); }

function legendItems(model, s, view) {
  const kinds = [...new Set(model.cables.filter(c => (!s || c.sheet_id === s.id) && (!view || view.cables.includes(c.kind))).map(c => c.kind))];
  const types = [...new Map(model.devices.filter(d => !s || d.sheet_id === s.id).map(d => [d.type + ((d.props || {}).form || '') + ((d.props || {}).system || '') + ((d.props || {}).symbol_id || ''), d])).values()];
  return { kinds, types };
}
function drawLegend(doc, model, s, view, fr, layers, mono) {
  const { kinds, types } = legendItems(model, s, view);
  const rows = kinds.length + types.length + (view.conduits && model.conduits.some(c => c.sheet_id === s.id) ? 1 : 0); if (!rows) return;
  const w = 58, rh = 4.6, h = 6 + rows * rh; const x = fr.x + fr.w - w - 2, y = fr.y + 2;
  doc.save(); doc.lineWidth(0.4).undash().rect(x * MM, y * MM, w * MM, h * MM).fillAndStroke('#ffffff', '#000');
  doc.font('krb').fontSize(3 * MM).fillColor('#000').text('범 례', (x + w / 2) * MM - doc.widthOfString('범 례') / 2, (y + 1) * MM, { lineBreak: false });
  let yy = y + 6;
  types.forEach(d => { const fake = { ...d, x: (x + 5) * MM, y: (yy + rh / 2) * MM, props: { ...d.props, direction: 0 } }; drawSymbol(doc, fake, 3.6 * MM, mono ? '#000' : ((layers[d.layer || CAT.DEVICE_TYPES[d.type].layer] || {}).color || '#000'), 1, mono); doc.font('kr').fontSize(2.5 * MM).fillColor('#000').text(`${d._symdef ? d._symdef.label : CAT.DEVICE_TYPES[d.type].name}${d.type === 'camera' ? ` (${d.props.system} ${d.props.form})` : ''}`, (x + 10) * MM, (yy + 1) * MM, { lineBreak: false }); yy += rh; });
  kinds.forEach(k => { const KD = CAT.CABLE_KINDS[k]; const L = layers[KD.layer] || {}; doc.save(); doc.strokeColor(mono ? '#000' : L.color || '#000').lineWidth((L.lw || 0.35) * MM); setDash(doc, KD.dash, 1); doc.moveTo((x + 2) * MM, (yy + rh / 2) * MM).lineTo((x + 9) * MM, (yy + rh / 2) * MM).stroke(); doc.restore(); doc.font('kr').fontSize(2.5 * MM).fillColor('#000').text(`${KD.name} (${KD.prefix}-)`, (x + 10) * MM, (yy + 1) * MM, { lineBreak: false }); yy += rh; });
  if (view.conduits && model.conduits.some(c => c.sheet_id === s.id)) { const L = layers.RACEWAY || {}; doc.save(); doc.strokeColor(mono ? '#000' : L.color || '#777').lineWidth((L.lw || 0.7) * MM); setDash(doc, L.dash, 1); doc.moveTo((x + 2) * MM, (yy + rh / 2) * MM).lineTo((x + 9) * MM, (yy + rh / 2) * MM).stroke(); doc.restore(); doc.font('kr').fontSize(2.5 * MM).fillColor('#000').text('배관·트레이', (x + 10) * MM, (yy + 1) * MM, { lineBreak: false }); }
  doc.restore();
}

function drawSchematicPage(doc, model, opts, ctx, PW, PH) {
  doc.addPage({ size: [PW * MM, PH * MM], margin: 0 });
  const fr = titleBlock(doc, model, ctx, PW, PH, { title: opts.title || 'CCTV 계통도', scale: '없음(계통도)' });
  const L = SCH.layout(model, { groupBy: opts.groupBy });
  const mono = opts.color === false || opts.color === 'mono';
  const k = Math.min((fr.w - 8) / L.width, (fr.h - 8) / L.height) * MM;
  doc.save(); doc.rect(fr.x * MM, fr.y * MM, fr.w * MM, fr.h * MM).clip(); doc.translate((fr.x + 4) * MM, (fr.y + 4) * MM); doc.scale(k);
  L.groups.forEach(g => { doc.save(); doc.lineWidth(0.6).strokeColor('#999'); setDash(doc, '4 3', 1, 1); doc.rect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0).stroke(); doc.restore(); doc.font('kr').fontSize(9).fillColor('#666').text(g.label, g.x0 + 3, g.y0 + 2, { lineBreak: false }); });
  const nm = new Map(L.nodes.map(n => [n.id, n]));
  const layers = Object.fromEntries(((model.project.settings || {}).layers || CAT.LAYERS).map(l => [l.key, l]));
  const pairCount = {};
  L.edges.forEach(e => {
    const R = e.route; const KD = CAT.CABLE_KINDS[e.kind]; const col = mono ? '#000' : (e.part === 'power' ? (layers.POWER || {}).color : (layers[KD.layer] || {}).color) || '#000';
    doc.save(); doc.strokeColor(col).lineWidth(e.part === 'power' ? 0.9 : 1.3); setDash(doc, e.part === 'power' ? '10 3 2 3' : KD.dash, 1, 1);
    doc.moveTo(R[0][0], R[0][1]); R.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.stroke(); doc.restore();
    doc.font('kr').fontSize(6.5).fillColor(mono ? '#000' : col).text(e.label, R[0][0] + 3, R[0][1] - 8, { lineBreak: false });
    const [x1, y1] = R[0], [x2, y2] = R[R.length - 1];
    doc.font('kr').fontSize(6).fillColor('#333'); if (e.a.port) doc.text(e.a.port, x1 - 2 - doc.widthOfString(e.a.port), y1 - 4, { lineBreak: false }); if (e.b.port) doc.text(e.b.port, x2 + 2, y2 - 4, { lineBreak: false });
  });
  L.nodes.forEach(n => {
    const lb = SCH.nodeLabel(n.dev); const T = CAT.DEVICE_TYPES[n.dev.type];
    doc.save(); doc.lineWidth(1).undash().rect(n.x, n.y, n.w, n.h).fillAndStroke('#ffffff', mono ? '#000' : (layers[T.layer] || {}).color || '#000'); doc.restore();
    // 변환 좌표계에서는 width 옵션을 쓰지 않음(pdfkit 자동 줄바꿈이 쪽 넘김을 일으킴) → 글자 수로 자르기
    const fit = (t, size) => { t = String(t || ''); const mx = Math.floor((n.w - 8) / (size * 0.62)); return t.length > mx ? t.slice(0, mx - 1) + '…' : t; };
    doc.font('krb').fontSize(10).fillColor('#000').text(fit(lb.title, 10), n.x + 4, n.y + 4, { lineBreak: false });
    doc.font('kr').fontSize(7).fillColor('#333').text(fit(lb.sub, 7), n.x + 4, n.y + 20, { lineBreak: false });
    const third = lb.model || (n.dev.status !== '신설' ? n.dev.status : ''); if (third) doc.text(fit(third, 7), n.x + 4, n.y + 32, { lineBreak: false });
  });
  doc.restore();
  doc.font('kr').fontSize(2.4 * MM).fillColor('#444').text('※ 계통도는 배치도의 장비·케이블 연결 데이터로 생성되며, 장비 간 호환성을 보증하지 않습니다. 실제 장비 지원 사양을 확인하세요.', (fr.x + 3) * MM, (fr.y + fr.h - 5) * MM, { lineBreak: false });
}

function drawTables(doc, model, opts, ctx, PW, PH) {
  const tb = TB.build(model); const keys = opts.tables && opts.tables.length ? opts.tables : TB.ORDER;
  keys.forEach(k => {
    const t = tb[k]; if (!t) return;
    let fr; const newPage = () => { doc.addPage({ size: [PW * MM, PH * MM], margin: 0 }); fr = titleBlock(doc, model, ctx, PW, PH, { title: t.title, scale: '없음' }); return fr.y + 4; };
    let y = newPage();
    const fs1 = 6.8; doc.font('kr').fontSize(fs1);
    const W = (fr.w - 6) * MM;
    const lens = t.head.map((h, i) => Math.min(42, Math.max(String(h).length * 1.4, ...t.rows.slice(0, 300).map(r => String(r[i] == null ? '' : r[i]).length * 0.95)) + 2));
    const tot = lens.reduce((a, b) => a + b, 0); const ws = lens.map(l => l / tot * W);
    const x0 = (fr.x + 3) * MM;
    const clip = v => { const t = String(v == null ? '' : v); return t.length > 700 ? t.slice(0, 700) + '…' : t; };
    const drawRow = (cells0, bold, yy) => { const cells = cells0.map(clip);
      doc.font(bold ? 'krb' : 'kr').fontSize(fs1);
      const hs = cells.map((c, i) => doc.heightOfString(String(c == null ? '' : c), { width: ws[i] - 4 }));
      const h = Math.max(...hs, fs1) + 4;
      let x = x0; cells.forEach((c, i) => { doc.lineWidth(0.4).strokeColor('#888').rect(x, yy, ws[i], h); if (bold) doc.fillAndStroke('#e8eef5', '#888'); else doc.stroke(); doc.fillColor('#000').text(String(c == null ? '' : c), x + 2, yy + 2, { width: ws[i] - 4 }); x += ws[i]; });
      return h;
    };
    doc.font('krb').fontSize(11).fillColor('#000').text(t.title, x0, y * MM); y = y + 7;
    let yy = y * MM; yy += drawRow(t.head, true, yy);
    const bottom = (fr.y + fr.h - 3) * MM;
    if (!t.rows.length) doc.font('kr').fontSize(8).fillColor('#666').text('(해당 항목 없음)', x0, yy + 4);
    t.rows.forEach(r => {
      doc.font('kr').fontSize(fs1); const h = Math.max(...r.map((c, i) => doc.heightOfString(clip(c), { width: ws[i] - 4 })), fs1) + 4;
      if (yy + h > bottom) { yy = newPage() * MM; yy += drawRow(t.head, true, yy); }
      yy += drawRow(r, false, yy);
    });
  });
}
function drawLegendPage(doc, model, opts, ctx, PW, PH) {
  doc.addPage({ size: [PW * MM, PH * MM], margin: 0 });
  const fr = titleBlock(doc, model, ctx, PW, PH, { title: '범례표', scale: '없음' });
  const layers = Object.fromEntries(((model.project.settings || {}).layers || CAT.LAYERS).map(l => [l.key, l]));
  const { kinds, types } = legendItems(model, null, null);
  const top = fr.y + 8, bottom = fr.y + fr.h - 8, colW = Math.min(110, (fr.w - 16) / 2);
  let x = fr.x + 8, y = top;
  const room = h => { if (y + h > bottom) { x += colW; y = top; } };
  const T = (s, xx, yy, size, bold) => doc.font(bold ? 'krb' : 'kr').fontSize(size * MM).fillColor('#000').text(s, xx * MM, yy * MM, { lineBreak: false });
  room(9); T('장비 심볼', x, y, 4.5, true); y += 9;
  types.forEach(d => { room(9); drawSymbol(doc, { ...d, x: (x + 5) * MM, y: (y + 3) * MM, props: { ...d.props, direction: 0 } }, 6 * MM, (layers[d.layer || CAT.DEVICE_TYPES[d.type].layer] || {}).color || '#000', 1, false); T(`${d._symdef ? d._symdef.label : CAT.DEVICE_TYPES[d.type].name}${d.type === 'camera' ? ` – ${d.props.system} ${d.props.form}` : ''}`, x + 13, y + 1, 3); y += 9; });
  y += 4; room(9); T('케이블 (색상·선종류·라벨 접두어)', x, y, 4.5, true); y += 9;
  kinds.concat(Object.keys(CAT.CABLE_KINDS).filter(k => !kinds.includes(k))).forEach(k => { room(7); const KD = CAT.CABLE_KINDS[k]; const L = layers[KD.layer] || {}; doc.save(); doc.strokeColor(L.color || '#000').lineWidth((L.lw || 0.35) * 1.5 * MM); setDash(doc, KD.dash, 1, 1.2); doc.moveTo(x * MM, (y + 2.5) * MM).lineTo((x + 16) * MM, (y + 2.5) * MM).stroke(); doc.restore(); T(`${KD.name}  라벨: ${KD.prefix}-번호${kinds.includes(k) ? '' : ' (미사용)'}`, x + 20, y, 3); y += 7; });
}

module.exports = { render, VIEWS, PAPER };
