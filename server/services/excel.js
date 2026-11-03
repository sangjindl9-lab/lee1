'use strict';
const ExcelJS = require('exceljs');
const CAT = require('../../shared/catalog');
const TB = require('../../shared/tables');

const thin = { style: 'thin', color: { argb: 'FF999999' } };
function sheetFromTable(wb, t, name) {
  const ws = wb.addWorksheet((name || t.title).slice(0, 31));
  ws.addRow([t.title]).font = { bold: true, size: 13 };
  const h = ws.addRow(t.head); h.font = { bold: true }; h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }; c.border = { top: thin, bottom: thin, left: thin, right: thin }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  t.rows.forEach(r => { const row = ws.addRow(r.map(v => v == null ? '' : v)); row.eachCell(c => { c.border = { top: thin, bottom: thin, left: thin, right: thin }; c.alignment = { vertical: 'top', wrapText: true }; }); });
  t.head.forEach((hh, i) => { const maxLen = Math.max(hh.length * 2, ...t.rows.slice(0, 200).map(r => String(r[i] == null ? '' : r[i]).length)); ws.getColumn(i + 1).width = Math.min(60, Math.max(8, maxLen * 1.1)); });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  return ws;
}

async function exportProject(model) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'CCTV 공사 설계 프로그램';
  const p = model.project;
  const info = wb.addWorksheet('프로젝트 정보');
  [['공사명', p.name], ['현장주소', p.address], ['발주처', p.client], ['설계사', p.designer], ['시공사', p.contractor], ['작성자', p.author], ['작성일', p.written_at], ['도면번호', p.drawing_no], ['개정번호', p.revision], ['시스템 방식', p.system_type], ['출력일시', new Date().toLocaleString('ko-KR')], ['비고', '수량 "확인 필요"는 축척 미설정 등으로 확정되지 않은 값입니다. 단가는 사용자가 입력한 값만 표시합니다.']].forEach(r => info.addRow(r));
  info.getColumn(1).width = 16; info.getColumn(2).width = 60; info.getColumn(1).font = { bold: true };
  const tb = TB.build(model);
  TB.ORDER.forEach(k => sheetFromTable(wb, tb[k]));
  // 단가(선택)
  const prices = (p.settings && p.settings.prices) || {};
  if (Object.keys(prices).length) {
    const C = require('../../shared/calc'); const q = C.quantities(model).filter(r => r.mat != null || r.lab != null || r.exp != null);
    sheetFromTable(wb, { title: '내역(사용자 입력 단가)', head: ['품명', '규격', '단위', '수량', '재료비 단가', '노무비 단가', '경비 단가', '합계 금액'], rows: q.map(r => [r.name, r.spec, r.unit, r.qty, r.mat, r.lab, r.exp, r.amount]) });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ----- 품목 엑셀 -----
const PCOLS = ['ID(수정시)', '분류(device/cable/conduit/accessory)', '종류', '품명', '규격', '단위', '제조사', '모델', '임피던스(Ω)', '외경(mm)', '내경(mm)', '도체(㎟)', '심선수', '코어수', '모드', '최대길이(m)', '최대길이 근거', '감쇠(주파수MHz:dB/100m;...)', '권장거리(신호:m:근거;...)', '역할(부속)', '적용외경 최소', '적용외경 최대', 'PoC 적용', '비고'];
async function productTemplate(list) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('품목');
  ws.addRow(PCOLS).font = { bold: true };
  list.forEach(p => { const x = p.props || {}; ws.addRow([p.id, p.category, p.kind, p.name, p.spec, p.unit, p.maker, p.model, x.impedance, x.od_mm, x.inner_d_mm, x.conductor_mm2 || x.power_mm2, x.cores || x.power_cores, x.cores, x.mode, x.max_length_m, x.max_length_basis, (x.attenuation || []).map(a => a.freq_mhz + ':' + a.db_per_100m).join(';'), (x.recommended || []).map(a => a.signal + ':' + a.max_m + ':' + (a.source || '')).join(';'), x.role, x.od_min_mm, x.od_max_mm, x.poc_ok ? 'Y' : '', x.note]); });
  PCOLS.forEach((c, i) => ws.getColumn(i + 1).width = Math.max(10, c.length * 1.6));
  ws.addRow([]); ws.addRow(['※ 권장거리·감쇠값은 제조사 사양서 근거를 함께 입력하세요. 근거 없는 값은 검토에서 사용하지 마세요.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function importProducts(buf, user, db, uid) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); const ws = wb.worksheets[0];
  const head = ws.getRow(1).values.slice(1).map(String); if (head[3] !== '품명') throw Object.assign(new Error('품목 등록 양식이 아닙니다. 양식을 내려받아 사용하세요.'), { status: 400 });
  let created = 0, updated = 0; const errors = [];
  ws.eachRow((row, i) => {
    if (i === 1) return; const v = row.values.slice(1).map(x => x && x.result != null ? x.result : (x && x.text ? x.text : x));
    if (!v[3]) return; const cat = String(v[1] || '').trim();
    if (!['device', 'cable', 'conduit', 'accessory'].includes(cat)) { if (v[3] && !String(v[0] || '').startsWith('※')) errors.push(`${i}행: 분류 값 오류(${cat})`); return; }
    const n = x => x === '' || x == null || isNaN(+x) ? undefined : +x;
    const props = { impedance: n(v[8]), od_mm: n(v[9]), inner_d_mm: n(v[10]), conductor_mm2: n(v[11]), cores: n(v[13]) ?? (cat === 'cable' && String(v[2]) === 'fiber' ? n(v[12]) : undefined), mode: v[14] || undefined, max_length_m: n(v[15]), max_length_basis: v[16] || undefined, role: v[19] || undefined, od_min_mm: n(v[20]), od_max_mm: n(v[21]), poc_ok: String(v[22] || '').toUpperCase() === 'Y' || undefined, note: v[23] || undefined };
    if (String(v[2]) === 'composite') { props.power_mm2 = n(v[11]); props.power_cores = n(v[12]); }
    if (v[17]) props.attenuation = String(v[17]).split(';').map(s => s.split(':')).filter(a => a.length >= 2).map(a => ({ freq_mhz: +a[0], db_per_100m: +a[1] }));
    if (v[18]) props.recommended = String(v[18]).split(';').map(s => s.split(':')).filter(a => a.length >= 2).map(a => ({ signal: a[0].trim(), max_m: +a[1], source: (a[2] || '').trim() }));
    Object.keys(props).forEach(k => props[k] === undefined && delete props[k]);
    const id = v[0] && db.prepare('SELECT 1 FROM products WHERE id=?').get(String(v[0])) ? String(v[0]) : null;
    if (id) { db.prepare("UPDATE products SET category=?,kind=?,name=?,spec=?,unit=?,maker=?,model=?,data=?,updated_at=datetime('now') WHERE id=?").run(cat, v[2] || null, v[3], v[4] || null, v[5] || null, v[6] || null, v[7] || null, JSON.stringify(props), id); updated++; }
    else { db.prepare('INSERT INTO products(id,company_id,category,kind,name,spec,unit,maker,model,data) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid(), user.company_id, cat, v[2] || null, v[3], v[4] || null, v[5] || null, v[6] || null, v[7] || null, JSON.stringify(props)); created++; }
  });
  return { created, updated, errors };
}

// ----- 장비 일괄 등록 -----
const DCOLS = ['내부ID(수정시, 비우면 신규)', '장비번호', '유형코드', '명칭', '도면명', 'X', 'Y', '시스템(IP/동축/기타)', '형식', '제조사', '모델', 'IP', 'VLAN', '영상신호', '설치높이(m)', '촬영방향(°)', '수평화각(°)', '감시거리(m)', '소비전력(W)', 'PoE(Y/N)', 'PoE 요구전력(W)', '비트레이트(Mbps)', '채널수/포트수', '구분(신설/기존/철거)', '비고'];
async function deviceTemplate(model) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('장비');
  ws.addRow(DCOLS).font = { bold: true };
  const sn = id => (model.sheets.find(s => s.id === id) || {}).name || '';
  model.devices.forEach(d => { const p = d.props || {}; ws.addRow([d.id, d.tag, d.type, d.name, sn(d.sheet_id), Math.round(d.x), Math.round(d.y), p.system, p.form, p.maker, p.model, p.ip, p.vlan, p.signal, p.height, p.direction, p.hfov, p.range, p.power_w, p.poe ? 'Y' : (p.system === 'IP' ? 'N' : ''), p.poe_w, p.bitrate_mbps, p.channels || p.ports, d.status, p.note]); });
  DCOLS.forEach((c, i) => ws.getColumn(i + 1).width = Math.max(9, c.length * 1.4));
  const codes = wb.addWorksheet('유형코드'); codes.addRow(['유형코드', '명칭']).font = { bold: true }; Object.entries(CAT.DEVICE_TYPES).forEach(([k, v]) => codes.addRow([k, v.name]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function importDevices(buf, model) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); const ws = wb.worksheets[0];
  if (String(ws.getRow(1).getCell(2).value) !== '장비번호') throw Object.assign(new Error('장비 일괄등록 양식이 아닙니다.'), { status: 400 });
  const ops = [], errors = []; const byId = new Map(model.devices.map(d => [d.id, d])); const byTag = new Map(model.devices.map(d => [d.tag, d]));
  const tags = new Set(); let auto = 0;
  ws.eachRow((row, i) => {
    if (i === 1) return; const v = []; for (let c = 1; c <= DCOLS.length; c++) { const x = row.getCell(c).value; v.push(x && typeof x === 'object' ? (x.result ?? x.text ?? '') : (x ?? '')); }
    if (!v[1] && !v[2]) return;
    const type = String(v[2] || '').trim(); if (!CAT.DEVICE_TYPES[type]) { errors.push(`${i}행: 유형코드 오류 (${type})`); return; }
    const tag = String(v[1] || '').trim(); if (!tag) { errors.push(`${i}행: 장비번호 없음`); return; }
    if (tags.has(tag)) { errors.push(`${i}행: 파일 내 장비번호 중복 ${tag}`); return; } tags.add(tag);
    const sheet = model.sheets.find(s => s.name === String(v[4]).trim()) || null;
    const exist = (v[0] && byId.get(String(v[0]))) || null;
    if (!exist && byTag.has(tag)) { errors.push(`${i}행: 이미 존재하는 장비번호 ${tag} (수정하려면 내부ID 입력)`); return; }
    if (!sheet && !exist) { errors.push(`${i}행: 도면명 "${v[4]}"을 찾을 수 없음`); return; }
    const n = x => x === '' || x == null || isNaN(+x) ? undefined : +x;
    const base = exist ? JSON.parse(JSON.stringify(exist)) : { type, props: {}, status: '신설', layer: CAT.DEVICE_TYPES[type].layer };
    const sh = sheet || model.sheets.find(s => s.id === base.sheet_id);
    base.type = type; base.tag = tag; base.name = String(v[3] || base.name || ''); base.sheet_id = sh.id;
    if (n(v[5]) != null && n(v[6]) != null) { base.x = n(v[5]); base.y = n(v[6]); }
    else if (!exist) { base.x = 60 + (auto % 10) * 80; base.y = 60 + Math.floor(auto / 10) * 80; auto++; base.import_unplaced = true; }
    const p = base.props;
    const set = (k, val) => { if (val !== undefined && val !== '') p[k] = val; };
    set('system', v[7] || undefined); set('form', v[8] || undefined); set('maker', v[9] || undefined); set('model', v[10] || undefined); set('ip', v[11] ? String(v[11]) : undefined); set('vlan', v[12] ? String(v[12]) : undefined); set('signal', v[13] || undefined);
    set('height', n(v[14])); set('direction', n(v[15])); set('hfov', n(v[16])); set('range', n(v[17])); set('power_w', n(v[18]));
    if (v[19]) p.poe = String(v[19]).toUpperCase() === 'Y'; set('poe_w', n(v[20])); set('bitrate_mbps', n(v[21]));
    if (n(v[22]) != null) { if (['nvr', 'dvr', 'hvr', 'encoder'].includes(type)) p.channels = n(v[22]); else p.ports = n(v[22]); }
    if (v[23]) base.status = String(v[23]); set('note', v[24] || undefined);
    ops.push({ data: base, mode: exist ? '수정' : '신규' });
  });
  return { ops, errors, created: ops.filter(o => o.mode === '신규').length, updated: ops.filter(o => o.mode === '수정').length };
}

module.exports = { exportProject, productTemplate, importProducts, deviceTemplate, importDevices };
