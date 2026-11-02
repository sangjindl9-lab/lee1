// 엑셀 일괄 등록: 광코어 접속, 측정기록
const { db } = require('../db');
const { TEST_TYPES } = require('./defs');
const { createConnection } = require('./svc');

const TEST_BY_LABEL = Object.fromEntries(Object.entries(TEST_TYPES).map(([k, v]) => [v.label, k]));

const COLS = {
  fiber_splice: [
    ['c1', '케이블1 관리번호*'], ['k1', '코어1 번호*'], ['e1', '케이블1 끝단(A/B)*'],
    ['c2', '케이블2 관리번호*'], ['k2', '코어2 번호*'], ['e2', '케이블2 끝단(A/B)*'],
    ['closure', '접속함 관리번호*'], ['tray', '트레이'], ['sleeve', '슬리브'], ['work_date', '접속일'], ['worker', '작업자'], ['note', '작업 내용'],
  ],
  measurement: [
    ['mgmt_no', '관리번호*'], ['test', '시험 종류*'], ['measured_at', '측정일시*'], ['core_no', '코어 번호'],
    ['section', '측정 구간'], ['combination', '측정 조합'], ['test_voltage', '시험전압(V)'], ['wavelength', '파장(nm)'], ['direction', '방향'],
    ['value', '측정값'], ['unit', '단위'], ['overall', '종합결과(성적서 기재)'], ['instrument', '측정기기'], ['measurer', '측정자'],
  ],
};

const HELP = {
  fiber_splice: [
    ['끝단', 'A=케이블 시작 측, B=종점 측. 예) FO-01 의 B단 #1 코어 ↔ FO-02 의 A단 #1 코어'],
    ['검사', '케이블·코어·접속함이 등록되어 있어야 하며, 이미 접속된 코어 끝단이나 불량·사용 중지 코어는 오류 처리됩니다.'],
  ],
  measurement: [
    ['시험 종류', Object.values(TEST_TYPES).map(t => t.label).join(', ')],
    ['측정일시', 'YYYY-MM-DD HH:MM (예: 2026-11-02 10:30)'],
    ['판정', '저장 시 현장 시험기준으로 자동 판정합니다. 기준이 없으면 "판정기준 미설정"입니다.'],
    ['누적', '측정기록은 기존 기록을 덮어쓰지 않고 새로 추가됩니다.'],
  ],
};

const asset = (sid, m) => db.prepare('SELECT id, category FROM assets WHERE site_id=? AND mgmt_no=? AND retired=0').get(sid, m);
const core = (cid, no) => db.prepare('SELECT * FROM cable_cores WHERE cable_id=? AND core_no=?').get(cid, Number(no));
const coreUsed = (id, end) => db.prepare(`SELECT 1 FROM connection_endpoints WHERE ep_type='core' AND ep_id=? AND ep_end=? AND active=1`).get(id, end);
const isNum = v => v !== '' && !Number.isNaN(Number(v));

function validateExtra(sid, kind, rows) {
  if (kind === 'fiber_splice') {
    const seen = new Map();
    return rows.map(row => {
      const errors = [];
      for (const [k, l] of COLS.fiber_splice) if (l.endsWith('*') && !row[k]) errors.push(`${l.replace('*', '')} 누락`);
      const ends = [];
      for (const i of ['1', '2']) {
        const c = row['c' + i] ? asset(sid, row['c' + i]) : null;
        const e = String(row['e' + i] || '').toUpperCase();
        if (row['c' + i] && !c) errors.push(`케이블${i} 없음: ${row['c' + i]}`);
        else if (c && c.category !== 'fiber_cable') errors.push(`${row['c' + i]} 은(는) 광케이블이 아님`);
        if (row['e' + i] && !['A', 'B'].includes(e)) errors.push(`끝단${i}은 A 또는 B`);
        if (c && c.category === 'fiber_cable' && row['k' + i]) {
          const k = core(c.id, row['k' + i]);
          if (!k) errors.push(`코어 없음: ${row['c' + i]} #${row['k' + i]}`);
          else if (['불량', '사용 중지'].includes(k.status)) errors.push(`${row['c' + i]} #${k.core_no} 코어 상태 '${k.status}'`);
          else if (['A', 'B'].includes(e)) {
            if (coreUsed(k.id, e)) errors.push(`이미 접속됨: ${row['c' + i]} #${k.core_no} ${e}단`);
            const key = `${k.id}:${e}`;
            if (seen.has(key)) errors.push(`파일 내 중복 사용 (${seen.get(key)}행): ${row['c' + i]} #${k.core_no} ${e}단`);
            else seen.set(key, row._row);
            ends.push({ type: 'core', id: k.id, end: e });
          }
        }
      }
      let closure = null;
      if (row.closure) {
        const c = asset(sid, row.closure);
        if (!c) errors.push(`접속함 없음: ${row.closure}`); else if (c.category !== 'closure') errors.push(`${row.closure} 은(는) 접속함이 아님`); else closure = c.id;
      }
      if (row.work_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.work_date)) errors.push('접속일 형식 오류');
      return { row, errors, exists: false, plan: { a: ends[0], b: ends[1], closure } };
    });
  }
  // measurement
  return rows.map(row => {
    const errors = [];
    for (const [k, l] of COLS.measurement) if (l.endsWith('*') && !row[k]) errors.push(`${l.replace('*', '')} 누락`);
    const a = row.mgmt_no ? asset(sid, row.mgmt_no) : null;
    if (row.mgmt_no && !a) errors.push(`설비 없음: ${row.mgmt_no}`);
    const tt = TEST_BY_LABEL[row.test] || (TEST_TYPES[row.test] ? row.test : null);
    if (row.test && !tt) errors.push(`시험 종류 오류: ${row.test}`);
    else if (tt && a && !TEST_TYPES[tt].cats.includes(a.category) && !TEST_TYPES[tt].cats.includes('*')) errors.push(`${row.test} 은(는) 이 설비 종류에 맞지 않음`);
    if (row.measured_at && !/^\d{4}-\d{2}-\d{2}( \d{1,2}:\d{2})?$/.test(row.measured_at)) errors.push('측정일시 형식 오류');
    for (const [k, l] of [['test_voltage', '시험전압'], ['wavelength', '파장'], ['value', '측정값'], ['core_no', '코어 번호']]) if (row[k] && !isNum(row[k])) errors.push(`${l} 숫자 아님: ${row[k]}`);
    if (!row.value && !row.overall) errors.push('측정값 또는 종합결과 중 하나는 필요');
    if (row.value && !row.unit) errors.push('측정값이 있으면 단위 필요');
    let coreId = null;
    if (row.core_no && a) { const k = core(a.id, row.core_no); if (!k) errors.push(`코어 없음: #${row.core_no}`); else coreId = k.id; }
    return { row, errors, exists: false, plan: { asset_id: a?.id, test_type: tt, core_id: coreId } };
  });
}

function commitExtra(sid, kind, validated, mode, userId, insertMeasurement) {
  const errorRows = validated.filter(v => v.errors.length);
  if (mode === 'all_or_nothing' && errorRows.length) return { saved: 0, created: 0, updated: 0, skipped_dup: 0, skipped_error: errorRows.length, message: `오류 행 ${errorRows.length}건이 있어 아무것도 저장하지 않았습니다.` };
  let created = 0;
  db.transaction(() => {
    for (const v of validated) {
      if (v.errors.length) continue;
      try {
        if (kind === 'fiber_splice') {
          const r = v.row;
          createConnection(sid, { kind: 'splice', a: v.plan.a, b: v.plan.b, closure_asset_id: v.plan.closure, tray: r.tray, sleeve: r.sleeve, work_date: r.work_date, worker: r.worker, note: r.note || '엑셀 일괄 등록' }, userId);
        } else {
          const r = v.row;
          insertMeasurement(v.plan.asset_id, {
            test_type: v.plan.test_type, measured_at: r.measured_at, core_id: v.plan.core_id, section: r.section, combination: r.combination,
            test_voltage: r.test_voltage, wavelength: r.wavelength, direction: r.direction, value: r.value, unit: r.unit, overall: r.overall,
            instrument: r.instrument, measurer: r.measurer, raw_note: '엑셀 일괄 등록',
          });
        }
        created++;
      } catch (e) { e.message = `${v.row._row}행 저장 중 오류로 전체 취소: ${e.message}`; throw e; }
    }
  })();
  return { saved: created, created, updated: 0, skipped_dup: 0, skipped_error: errorRows.length };
}

module.exports = { COLS, HELP, validateExtra, commitExtra };
