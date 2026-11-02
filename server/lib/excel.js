// 엑셀 등록 양식·업로드 검증·일괄 저장·내보내기
const ExcelJS = require('exceljs');
const { db } = require('../db');
const { CATEGORIES, DETAIL_FIELDS, STATUSES, TEST_TYPES } = require('./defs');
const { createAsset, updateAsset, createConnection } = require('./svc');

const COMMON_COLS = [
  ['mgmt_no', '관리번호*'], ['name', '명칭'], ['status', '상태'], ['building', '건물'], ['floor', '층'], ['room', '실'], ['zone', '구역'],
  ['location_desc', '설치 위치 설명'], ['manufacturer', '제조사'], ['model', '모델'], ['serial_no', '시리얼번호'],
  ['install_date', '설치일'], ['contractor', '시공업체'], ['manager', '담당자'], ['notes', '비고'],
];

// 연결 대상 열 (존재 여부 검사 후 연결 생성)
const LINK_COLS = {
  power_cable: [['link_panel', '연결 분전반 관리번호'], ['link_circuit', '연결 회로명'], ['link_load', '연결 부하 관리번호']],
  lan_cable: [['link_pp', '연결 패치패널 관리번호'], ['link_pp_port', '패치패널 포트명'], ['link_end', '종점 설비 관리번호'], ['link_end_port', '종점 포트명']],
  fiber_cable: [],
  cctv: [],
};
const EQUIP_EXTRA = [['category', '설비 종류코드*'], ['port_count', '포트·회로 수']];

function columns(category) {
  const isEquip = category === 'equipment';
  const details = isEquip ? [] : (DETAIL_FIELDS[category] || []).map(([k, l]) => ['d.' + k, l]);
  return [...(isEquip ? EQUIP_EXTRA : []), ...COMMON_COLS, ...details, ...(LINK_COLS[category] || [])];
}

async function template(category) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('등록양식');
  const cols = columns(category);
  ws.columns = cols.map(([k, l]) => ({ header: l, key: k, width: Math.max(12, l.length * 2 + 2) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const help = wb.addWorksheet('작성안내');
  help.columns = [{ width: 28 }, { width: 80 }];
  help.addRow(['항목', '안내']).font = { bold: true };
  help.addRow(['관리번호', '현장 내 중복 불가. 필수.']);
  help.addRow(['상태', STATUSES.join(', ')]);
  help.addRow(['날짜', 'YYYY-MM-DD 형식 (예: 2026-11-02)']);
  if (category === 'equipment') help.addRow(['설비 종류코드', Object.entries(CATEGORIES).filter(([, v]) => v.group === 'equipment').map(([k, v]) => `${k}(${v.label})`).join(', ')]);
  if (category === 'power_cable') help.addRow(['연결 열', '분전반·회로·부하는 이미 등록된 관리번호/회로명이어야 합니다. 비워두면 연결 없이 등록합니다.']);
  if (category === 'lan_cable') help.addRow(['연결 열', '패치패널 포트 뒤(고정 배선)와 종점 설비를 연결합니다. 이미 사용 중인 포트는 오류 처리됩니다.']);
  if (category === 'fiber_cable') help.addRow(['코어 수', '코어 수를 입력하면 코어가 자동 생성됩니다.']);
  return wb.xlsx.writeBuffer();
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text) return String(v.text);
    if (v.result !== undefined) return String(v.result);
  }
  return String(v).trim();
}

async function parse(buffer, category) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('등록양식') || wb.worksheets[0];
  const cols = columns(category);
  const header = ws.getRow(1).values.map(cellText);
  const idx = {};
  for (const [k, l] of cols) { const i = header.indexOf(l); if (i > 0) idx[k] = i; }
  if (!idx.mgmt_no) throw new Error('양식의 머리글이 맞지 않습니다. 이 화면에서 받은 등록 양식을 사용하세요.');
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = { _row: n };
    let any = false;
    for (const [k] of cols) { const t = idx[k] ? cellText(row.getCell(idx[k]).value) : ''; obj[k] = t; if (t) any = true; }
    if (any) rows.push(obj);
  });
  return rows;
}

function toAssetData(category, row) {
  const details = {};
  for (const [k, v] of Object.entries(row)) if (k.startsWith('d.')) details[k.slice(2)] = v;
  const data = { category: category === 'equipment' ? row.category : category, details, port_count: row.port_count || undefined };
  for (const [k] of COMMON_COLS) data[k] = row[k];
  if (!data.status) data.status = '설계';
  return data;
}

const findAsset = (sid, mgmt) => db.prepare('SELECT id, category FROM assets WHERE site_id=? AND mgmt_no=? AND retired=0').get(sid, mgmt);
const findPort = (aid, name) => db.prepare('SELECT * FROM ports WHERE asset_id=? AND name=?').get(aid, name);
const portUsed = (pid, end) => db.prepare('SELECT 1 FROM connection_endpoints WHERE ep_type=? AND ep_id=? AND ep_end=? AND active=1').get('port', pid, end);

// 행 검증: 오류 사유 목록 반환
function validate(siteId, category, rows) {
  const seen = new Map();
  return rows.map(row => {
    const errors = [];
    const warn = [];
    if (!row.mgmt_no) errors.push('관리번호 누락');
    else if (seen.has(row.mgmt_no)) errors.push(`파일 내 관리번호 중복 (${seen.get(row.mgmt_no)}행)`);
    else seen.set(row.mgmt_no, row._row);
    if (row.status && !STATUSES.includes(row.status)) errors.push(`상태 값 오류: ${row.status}`);
    const cat = category === 'equipment' ? row.category : category;
    if (!CATEGORIES[cat]) errors.push(`설비 종류코드 오류: ${row.category || '(비어 있음)'}`);
    for (const [k, l, type] of DETAIL_FIELDS[cat] || []) {
      const v = row['d.' + k];
      if (v && type === 'number' && Number.isNaN(Number(v))) errors.push(`${l} 숫자 아님: ${v}`);
      if (v && type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${l} 날짜 형식 오류: ${v}`);
    }
    if (row.install_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.install_date)) errors.push(`설치일 날짜 형식 오류: ${row.install_date}`);
    if (row.port_count && (Number.isNaN(Number(row.port_count)) || Number(row.port_count) > 512)) errors.push('포트·회로 수 오류');
    const exists = row.mgmt_no ? findAsset(siteId, row.mgmt_no) : null;
    if (exists && exists.category !== cat) errors.push(`같은 관리번호가 다른 종류(${CATEGORIES[exists.category]?.label})로 이미 있음`);
    // 연결 대상 확인
    if (category === 'power_cable') {
      if (row.link_panel) {
        const p = findAsset(siteId, row.link_panel);
        if (!p) errors.push(`연결 분전반 없음: ${row.link_panel}`);
        else if (p.category !== 'panel') errors.push(`${row.link_panel} 은(는) 분전반이 아님`);
        else if (row.link_circuit) {
          const c = findPort(p.id, row.link_circuit);
          if (!c) errors.push(`회로 없음: ${row.link_panel} ${row.link_circuit}`);
          else if (portUsed(c.id, '') && !exists) errors.push(`회로 이미 사용 중: ${row.link_panel} ${row.link_circuit}`);
        }
      } else if (row.link_circuit) errors.push('회로명이 있으면 분전반 관리번호도 필요');
      if (row.link_load) {
        const l = findAsset(siteId, row.link_load);
        if (!l) errors.push(`연결 부하 없음: ${row.link_load}`);
      }
    }
    if (category === 'lan_cable') {
      if (row.link_pp) {
        const p = findAsset(siteId, row.link_pp);
        if (!p || p.category !== 'patch_panel') errors.push(`패치패널 없음: ${row.link_pp}`);
        else if (!row.link_pp_port) errors.push('패치패널 포트명 누락');
        else {
          const pt = findPort(p.id, row.link_pp_port);
          if (!pt) errors.push(`포트 없음: ${row.link_pp} ${row.link_pp_port}`);
          else if (portUsed(pt.id, 'rear') && !exists) errors.push(`포트 뒤쪽 이미 사용 중: ${row.link_pp} ${row.link_pp_port}`);
        }
      }
      if (row.link_end) {
        const e = findAsset(siteId, row.link_end);
        if (!e) errors.push(`종점 설비 없음: ${row.link_end}`);
        else if (row.link_end_port && !findPort(e.id, row.link_end_port)) errors.push(`종점 포트 없음: ${row.link_end} ${row.link_end_port}`);
      }
    }
    return { row, errors, warn, exists: !!exists };
  });
}

/**
 * 저장. 하나의 트랜잭션에서 처리하므로 예기치 않은 오류 시 전체 취소 (일부만 저장되지 않음)
 * mode: 'all_or_nothing' | 'valid_only' ; dup: 'skip' | 'update' | 'error'
 */
function commit(siteId, category, validated, mode, dup, userId) {
  const errorRows = validated.filter(v => v.errors.length);
  if (mode === 'all_or_nothing' && errorRows.length) return { saved: 0, skipped: validated.length, message: `오류 행 ${errorRows.length}건이 있어 아무것도 저장하지 않았습니다.` };
  if (dup === 'error') {
    const d = validated.filter(v => v.exists && !v.errors.length);
    if (d.length) return { saved: 0, skipped: validated.length, message: `이미 등록된 관리번호 ${d.length}건 (${d.slice(0, 5).map(v => v.row.mgmt_no).join(', ')}) — 중복 처리 방식이 '오류'이므로 저장하지 않았습니다.` };
  }
  const result = { created: 0, updated: 0, skipped_dup: 0, skipped_error: errorRows.length };
  db.transaction(() => {
    for (const v of validated) {
      if (v.errors.length) continue;
      try {
      const data = toAssetData(category, v.row);
      let id;
      if (v.exists) {
        if (dup === 'skip') { result.skipped_dup++; continue; }
        id = findAsset(siteId, v.row.mgmt_no).id;
        const upd = {};
        for (const [k] of COMMON_COLS) if (v.row[k]) upd[k] = v.row[k];
        upd.details = Object.fromEntries(Object.entries(data.details).filter(([, x]) => x !== ''));
        updateAsset(id, upd, userId);
        result.updated++;
      } else {
        id = createAsset(siteId, data, userId);
        db.prepare(`INSERT INTO work_logs(site_id, asset_id, work_type, work_at, content, status, created_by) VALUES (?,?,?,date('now','localtime'),?,?,?)`)
          .run(siteId, id, '신규 설치', '엑셀 일괄 등록', '작성', userId);
        result.created++;
      }
      // 연결 생성 (신규 행만)
      if (!v.exists && category === 'power_cable') {
        if (v.row.link_panel && v.row.link_circuit) {
          const p = findAsset(siteId, v.row.link_panel); const c = findPort(p.id, v.row.link_circuit);
          createConnection(siteId, { kind: 'power', a: { type: 'port', id: c.id }, b: { type: 'cable', id, end: 'A' } }, userId);
        }
        if (v.row.link_load) {
          const l = findAsset(siteId, v.row.link_load);
          createConnection(siteId, { kind: 'power', a: { type: 'cable', id, end: 'B' }, b: { type: 'asset', id: l.id } }, userId);
        }
      }
      if (!v.exists && category === 'lan_cable') {
        if (v.row.link_pp) {
          const p = findAsset(siteId, v.row.link_pp); const pt = findPort(p.id, v.row.link_pp_port);
          createConnection(siteId, { kind: 'fixed', a: { type: 'port', id: pt.id, end: 'rear' }, b: { type: 'cable', id, end: 'A' } }, userId);
        }
        if (v.row.link_end) {
          const e = findAsset(siteId, v.row.link_end);
          const ep = v.row.link_end_port ? findPort(e.id, v.row.link_end_port) : null;
          const pass = CATEGORIES[e.category]?.ports === 'passthrough';
          createConnection(siteId, { kind: 'fixed', a: { type: 'cable', id, end: 'B' }, b: ep ? { type: 'port', id: ep.id, end: pass ? 'rear' : '' } : { type: 'asset', id: e.id } }, userId);
        }
      }
      } catch (e) {
        // 한 행이라도 저장 중 오류가 나면 전체 취소 (부분 저장 방지)
        e.message = `${v.row._row}행 저장 중 오류로 전체 취소: ${e.message}`;
        throw e;
      }
    }
  })();
  return { ...result, saved: result.created + result.updated };
}

async function exportAssets(siteId, category) {
  const wb = new ExcelJS.Workbook();
  const cats = category ? [category] : Object.keys(CATEGORIES);
  for (const cat of cats) {
    const rows = db.prepare(`SELECT a.*, d.data FROM assets a LEFT JOIN asset_details d ON d.asset_id=a.id WHERE a.site_id=? AND a.category=? AND a.retired=0 ORDER BY a.mgmt_no`).all(siteId, cat);
    if (!rows.length && !category) continue;
    const ws = wb.addWorksheet(CATEGORIES[cat].label.replace(/[\\/?*[\]:]/g, '·'));
    const det = DETAIL_FIELDS[cat] || [];
    ws.columns = [...COMMON_COLS, ...det.map(([k, l]) => ['d.' + k, l]), ['updated_at', '최종 변경']].map(([k, l]) => ({ header: l.replace('*', ''), key: k, width: 14 }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const d = JSON.parse(r.data || '{}');
      const o = {}; for (const [k] of COMMON_COLS) o[k] = r[k]; for (const [k] of det) o['d.' + k] = d[k]; o.updated_at = r.updated_at;
      ws.addRow(o);
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  if (!wb.worksheets.length) wb.addWorksheet('데이터 없음');
  return wb.xlsx.writeBuffer();
}

async function exportMeasurements(siteId) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('측정기록');
  ws.columns = [['mgmt_no', '관리번호'], ['cat', '설비 종류'], ['test', '시험 종류'], ['measured_at', '측정일시'], ['section', '측정 구간'], ['combination', '측정 조합'], ['core_no', '코어'],
    ['test_voltage', '시험전압(V)'], ['wavelength', '파장(nm)'], ['direction', '방향'], ['value', '측정값'], ['unit', '단위'], ['overall', '측정기 종합결과'],
    ['instrument', '측정기기'], ['measurer', '측정자'], ['criteria', '적용 기준'], ['auto_result', '자동 판정'], ['review_status', '검토 결과'], ['reviewer', '검토자'], ['state', '기록 상태']]
    .map(([k, l]) => ({ header: l, key: k, width: 13 }));
  ws.getRow(1).font = { bold: true };
  const rows = db.prepare(`SELECT m.*, a.mgmt_no, a.category, c.core_no, u.name AS reviewer FROM measurements m JOIN assets a ON a.id=m.asset_id
     LEFT JOIN cable_cores c ON c.id=m.core_id LEFT JOIN users u ON u.id=m.reviewed_by WHERE m.site_id=? ORDER BY a.mgmt_no, m.measured_at`).all(siteId);
  for (const m of rows) {
    const cs = m.criteria_snapshot ? JSON.parse(m.criteria_snapshot) : null;
    ws.addRow({ ...m, cat: CATEGORIES[m.category]?.label, test: TEST_TYPES[m.test_type]?.label, criteria: cs ? `${cs.name} v${cs.version} (${cs.comparator} ${cs.value} ${cs.unit})` : '미설정', state: m.superseded_by ? `정정됨(→#${m.superseded_by})` : '유효' });
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return wb.xlsx.writeBuffer();
}

module.exports = { template, parse, validate, commit, exportAssets, exportMeasurements, columns };
