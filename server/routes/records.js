const express = require('express');
const fs = require('fs');
const { db, audit } = require('../db');
const { requireAuth, assertSite, HttpError, can } = require('../auth');
const { h, clean, assetSite } = require('../lib/svc');
const { judge } = require('../lib/judge');
const { upload, saveUploaded, absPath, cleanupTmp } = require('../lib/files');
const { TEST_TYPES, WORK_TYPES, FILE_CATEGORIES } = require('../lib/defs');

const r = express.Router();
r.use(requireAuth);

const num = v => (v === undefined || v === null || String(v).trim() === '' ? null : Number(v));

// ---------- 측정기록 (누적, 덮어쓰기 없음) ----------
function insertMeasurement(req, assetId, body, extra = {}) {
  const a = db.prepare('SELECT id, site_id, category FROM assets WHERE id=?').get(assetId);
  if (!a) throw new HttpError(404, '설비를 찾을 수 없습니다.');
  if (!TEST_TYPES[body.test_type]) throw new HttpError(400, '시험 종류가 올바르지 않습니다.');
  if (!clean(body.measured_at)) throw new HttpError(400, '측정일시는 필수입니다.');
  if (body.core_id) {
    const c = db.prepare('SELECT cable_id FROM cable_cores WHERE id=?').get(body.core_id);
    if (!c || c.cable_id !== a.id) throw new HttpError(400, '코어가 이 케이블에 속하지 않습니다.');
  }
  const value = num(body.value);
  if (value !== null && Number.isNaN(value)) throw new HttpError(400, '측정값은 숫자로 입력하세요.');
  const m = {
    test_type: body.test_type, measured_at: clean(body.measured_at), value, unit: clean(body.unit),
    test_voltage: num(body.test_voltage), wavelength: num(body.wavelength), direction: clean(body.direction),
  };
  const j = judge(a.site_id, a.category, m);
  const info = db.prepare(`INSERT INTO measurements(site_id, asset_id, core_id, test_type, measured_at, section, combination, test_voltage, wavelength, direction,
      value, unit, items, overall, instrument, measurer, criteria_id, criteria_snapshot, auto_result, auto_reason, raw_note, corrects_id, correction_reason, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    a.site_id, a.id, body.core_id || null, m.test_type, m.measured_at, clean(body.section), clean(body.combination), m.test_voltage, m.wavelength, m.direction,
    value, m.unit, body.items ? JSON.stringify(body.items) : null, clean(body.overall), clean(body.instrument), clean(body.measurer),
    j.criteria?.id || null, j.criteria ? JSON.stringify(j.criteria) : null, j.result, j.reason, clean(body.raw_note),
    extra.corrects_id || null, extra.correction_reason || null, req.user.id);
  return { id: Number(info.lastInsertRowid), judge: j, site_id: a.site_id };
}

r.post('/assets/:id/measurements', h(async (req, res) => {
  const sid = assetSite(req.params.id);
  assertSite(req, sid, 'create');
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [req.body];
  const out = db.transaction(() => rows.map(b => {
    const m = insertMeasurement(req, Number(req.params.id), { ...req.body, ...b, rows: undefined });
    audit(req, 'create', 'measurement', m.id, { ...b, auto_result: m.judge.result }, sid);
    return { id: m.id, auto_result: m.judge.result, auto_reason: m.judge.reason };
  }))();
  res.json({ ok: true, results: out });
}));

r.post('/measurements/:id/review', h(async (req, res) => {
  const m = db.prepare('SELECT * FROM measurements WHERE id=?').get(req.params.id);
  if (!m) throw new HttpError(404, '측정기록을 찾을 수 없습니다.');
  assertSite(req, m.site_id, 'review');
  const status = req.body.status;
  if (!['승인', '반려', '재시험 필요', '검토 대기'].includes(status)) throw new HttpError(400, '검토 상태가 올바르지 않습니다.');
  if (m.superseded_by) throw new HttpError(400, '정정된 이전 기록은 검토할 수 없습니다.');
  db.prepare(`UPDATE measurements SET review_status=?, reviewed_by=?, reviewed_at=datetime('now','localtime'), review_note=? WHERE id=?`).run(status, req.user.id, clean(req.body.note), m.id);
  audit(req, 'review', 'measurement', m.id, { before: m.review_status, after: status, note: req.body.note }, m.site_id);
  res.json({ ok: true });
}));

// 정정: 기존 기록은 보존하고 정정 기록을 새로 만든 뒤 연결
r.post('/measurements/:id/correct', h(async (req, res) => {
  const m = db.prepare('SELECT * FROM measurements WHERE id=?').get(req.params.id);
  if (!m) throw new HttpError(404, '측정기록을 찾을 수 없습니다.');
  assertSite(req, m.site_id, 'edit');
  if (m.superseded_by) throw new HttpError(400, '이미 정정된 기록입니다. 최신 기록을 정정하세요.');
  if (!clean(req.body.correction_reason)) throw new HttpError(400, '정정 사유를 입력하세요.');
  const base = { ...m, items: m.items ? JSON.parse(m.items) : null };
  const out = db.transaction(() => {
    const n = insertMeasurement(req, m.asset_id, { ...base, ...req.body }, { corrects_id: m.id, correction_reason: clean(req.body.correction_reason) });
    db.prepare('UPDATE measurements SET superseded_by=? WHERE id=?').run(n.id, m.id);
    // 성적서 파일은 새 기록에도 연결 (원본 파일 유지)
    for (const f of db.prepare(`SELECT * FROM files WHERE owner_type='measurement' AND owner_id=? AND archived=0`).all(m.id)) {
      db.prepare(`INSERT INTO files(site_id, owner_type, owner_id, category, orig_name, mime, size, stored_name, sha256, caption, created_by)
        SELECT site_id, owner_type, ?, category, orig_name, mime, size, stored_name || '#c' || ?, sha256, caption, created_by FROM files WHERE id=?`).run(n.id, n.id, f.id);
    }
    audit(req, 'correct', 'measurement', m.id, { new_id: n.id, reason: req.body.correction_reason, changes: req.body }, m.site_id);
    return n;
  })();
  res.json({ id: out.id, auto_result: out.judge.result });
}));

r.get('/sites/:sid/measurements', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const rows = db.prepare(`SELECT m.*, a.mgmt_no, a.category, a.name AS asset_name, c.core_no, u.name AS reviewer_name,
      (SELECT COUNT(*) FROM files f WHERE f.owner_type='measurement' AND f.owner_id=m.id AND f.archived=0) AS file_count
      FROM measurements m JOIN assets a ON a.id=m.asset_id LEFT JOIN cable_cores c ON c.id=m.core_id LEFT JOIN users u ON u.id=m.reviewed_by
      WHERE m.site_id=? ${req.query.all ? '' : 'AND m.superseded_by IS NULL'} ${req.query.test_type ? 'AND m.test_type=@tt' : ''}
      ORDER BY m.measured_at DESC, m.id DESC LIMIT 3000`.replace('@tt', '?')).all(...[sid, req.query.test_type].filter(Boolean));
  res.json(rows);
}));

// ---------- 시험 판정기준 (버전 관리) ----------
r.get('/sites/:sid/criteria', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  res.json(db.prepare('SELECT c.*, u.name AS created_by_name FROM test_criteria c LEFT JOIN users u ON u.id=c.created_by WHERE site_id=? ORDER BY code, version DESC').all(sid));
}));

function criteriaFromBody(b) {
  if (!TEST_TYPES[b.test_type]) throw new HttpError(400, '시험 종류가 올바르지 않습니다.');
  for (const k of ['name', 'unit', 'comparator', 'effective_date']) if (!clean(b[k])) throw new HttpError(400, `필수 항목이 비어 있습니다: ${k}`);
  if (b.value === '' || b.value === null || Number.isNaN(Number(b.value))) throw new HttpError(400, '기준값은 숫자로 입력하세요.');
  const cond = {};
  if (num(b.cond_test_voltage) !== null) cond.test_voltage = num(b.cond_test_voltage);
  if (num(b.cond_wavelength) !== null) cond.wavelength = num(b.cond_wavelength);
  return { ...b, conditions: JSON.stringify(cond), value: Number(b.value), target_category: b.target_category || '*' };
}

r.post('/sites/:sid/criteria', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'edit');
  if (!['admin', 'site_manager'].includes(req.user.role)) throw new HttpError(403, '시험기준은 관리자·현장관리자만 설정할 수 있습니다.');
  const c = criteriaFromBody(req.body);
  const code = 'C' + Date.now().toString(36);
  const info = db.prepare(`INSERT INTO test_criteria(site_id, code, version, test_type, target_category, name, unit, comparator, value, conditions, basis_doc, effective_date, created_by)
    VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?)`).run(sid, code, c.test_type, c.target_category, c.name, c.unit, c.comparator, c.value, c.conditions, clean(c.basis_doc), c.effective_date, req.user.id);
  audit(req, 'create', 'criteria', info.lastInsertRowid, c, sid);
  res.json({ id: info.lastInsertRowid });
}));

// 수정 = 새 버전 생성. 과거 측정은 당시 기준 사본을 유지하므로 판정이 바뀌지 않음
r.put('/criteria/:id', h(async (req, res) => {
  const old = db.prepare('SELECT * FROM test_criteria WHERE id=?').get(req.params.id);
  if (!old) throw new HttpError(404, '기준을 찾을 수 없습니다.');
  assertSite(req, old.site_id, 'edit');
  if (!['admin', 'site_manager'].includes(req.user.role)) throw new HttpError(403, '시험기준은 관리자·현장관리자만 설정할 수 있습니다.');
  const id = db.transaction(() => {
    db.prepare('UPDATE test_criteria SET active=0 WHERE code=? AND site_id=?').run(old.code, old.site_id);
    if (req.body.deactivate) { audit(req, 'deactivate', 'criteria', old.id, null, old.site_id); return old.id; }
    const c = criteriaFromBody({ ...old, ...req.body });
    const ver = db.prepare('SELECT MAX(version) v FROM test_criteria WHERE code=? AND site_id=?').get(old.code, old.site_id).v + 1;
    const info = db.prepare(`INSERT INTO test_criteria(site_id, code, version, test_type, target_category, name, unit, comparator, value, conditions, basis_doc, effective_date, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(old.site_id, old.code, ver, c.test_type, c.target_category, c.name, c.unit, c.comparator, c.value, c.conditions, clean(c.basis_doc), c.effective_date, req.user.id);
    audit(req, 'new_version', 'criteria', info.lastInsertRowid, { from: old.id, version: ver }, old.site_id);
    return info.lastInsertRowid;
  })();
  res.json({ id });
}));

// ---------- 작업·보수 이력 ----------
r.get('/sites/:sid/worklogs', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const params = [sid];
  let extra = '';
  if (req.query.work_type) { extra += ' AND w.work_type=?'; params.push(req.query.work_type); }
  if (req.query.from) { extra += ' AND w.work_at>=?'; params.push(req.query.from); }
  if (req.query.to) { extra += ' AND w.work_at<=?'; params.push(req.query.to + ' 23:59'); }
  const rows = db.prepare(`SELECT w.*, a.mgmt_no, a.category, a.name AS asset_name, u.name AS reviewer_name,
      (SELECT COUNT(*) FROM files f WHERE f.owner_type='worklog' AND f.owner_id=w.id AND f.archived=0) AS file_count
      FROM work_logs w JOIN assets a ON a.id=w.asset_id LEFT JOIN users u ON u.id=w.reviewed_by
      WHERE w.site_id=? ${req.query.all ? '' : 'AND w.superseded_by IS NULL'} ${extra} ORDER BY w.work_at DESC, w.id DESC LIMIT 3000`).all(...params);
  res.json(rows);
}));

r.post('/assets/:id/worklogs', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'create');
  const b = req.body;
  if (!WORK_TYPES.includes(b.work_type)) throw new HttpError(400, '작업 종류가 올바르지 않습니다.');
  if (!clean(b.work_at)) throw new HttpError(400, '작업일시는 필수입니다.');
  if (b.measurement_id) {
    const m = db.prepare('SELECT asset_id FROM measurements WHERE id=?').get(b.measurement_id);
    if (!m || m.asset_id !== id) throw new HttpError(400, '측정기록이 이 설비에 속하지 않습니다.');
  }
  const info = db.prepare(`INSERT INTO work_logs(site_id, asset_id, work_type, work_at, content, worker, company, before_value, after_value, measurement_id, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(sid, id, b.work_type, clean(b.work_at), clean(b.content), clean(b.worker), clean(b.company), clean(b.before_value), clean(b.after_value), b.measurement_id || null, b.submit ? '검토 요청' : '작성', req.user.id);
  audit(req, 'create', 'worklog', info.lastInsertRowid, b, sid);
  res.json({ id: info.lastInsertRowid });
}));

// 수정: 확정 전에는 직접 수정(버전 확인), 확정 후에는 정정 사유와 함께 정정 기록 생성
r.put('/worklogs/:id', h(async (req, res) => {
  const w = db.prepare('SELECT * FROM work_logs WHERE id=?').get(req.params.id);
  if (!w) throw new HttpError(404, '작업 이력을 찾을 수 없습니다.');
  assertSite(req, w.site_id, 'edit');
  if (w.superseded_by) throw new HttpError(400, '정정된 이전 기록입니다.');
  if (req.body.version !== undefined && Number(req.body.version) !== w.version) throw new HttpError(409, '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.');
  const m = { ...w, ...req.body };
  if (!WORK_TYPES.includes(m.work_type)) throw new HttpError(400, '작업 종류가 올바르지 않습니다.');
  if (w.status === '확정') {
    if (!clean(req.body.correction_reason)) throw new HttpError(400, '확정된 기록은 정정 사유를 입력해야 수정할 수 있습니다.');
    const nid = db.transaction(() => {
      const info = db.prepare(`INSERT INTO work_logs(site_id, asset_id, work_type, work_at, content, worker, company, before_value, after_value, measurement_id, status, corrects_id, correction_reason, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(w.site_id, w.asset_id, m.work_type, m.work_at, clean(m.content), clean(m.worker), clean(m.company), clean(m.before_value), clean(m.after_value), m.measurement_id, '검토 요청', w.id, clean(req.body.correction_reason), req.user.id);
      db.prepare('UPDATE work_logs SET superseded_by=? WHERE id=?').run(info.lastInsertRowid, w.id);
      db.prepare(`UPDATE files SET owner_id=? WHERE owner_type='worklog' AND owner_id=?`).run(info.lastInsertRowid, w.id);
      audit(req, 'correct', 'worklog', w.id, { new_id: info.lastInsertRowid, reason: req.body.correction_reason, before: w, after: m }, w.site_id);
      return info.lastInsertRowid;
    })();
    return res.json({ id: nid, corrected: true });
  }
  db.prepare(`UPDATE work_logs SET work_type=?, work_at=?, content=?, worker=?, company=?, before_value=?, after_value=?, status=?, version=version+1 WHERE id=?`)
    .run(m.work_type, m.work_at, clean(m.content), clean(m.worker), clean(m.company), clean(m.before_value), clean(m.after_value), req.body.submit ? '검토 요청' : w.status, w.id);
  audit(req, 'update', 'worklog', w.id, { before: w, after: req.body }, w.site_id);
  res.json({ id: w.id });
}));

r.post('/worklogs/:id/review', h(async (req, res) => {
  const w = db.prepare('SELECT * FROM work_logs WHERE id=?').get(req.params.id);
  if (!w) throw new HttpError(404, '작업 이력을 찾을 수 없습니다.');
  assertSite(req, w.site_id, 'review');
  if (!['확정', '반려'].includes(req.body.status)) throw new HttpError(400, '검토 상태가 올바르지 않습니다.');
  db.prepare(`UPDATE work_logs SET status=?, reviewed_by=?, reviewed_at=datetime('now','localtime'), version=version+1 WHERE id=?`).run(req.body.status, req.user.id, w.id);
  audit(req, 'review', 'worklog', w.id, { status: req.body.status }, w.site_id);
  res.json({ ok: true });
}));

// ---------- 첨부파일 ----------
function ownerSite(type, id) {
  const t = { asset: 'assets', measurement: 'measurements', worklog: 'work_logs' }[type];
  if (!t) throw new HttpError(400, '첨부 대상 종류가 올바르지 않습니다.');
  return db.prepare(`SELECT site_id FROM ${t} WHERE id=?`).get(id)?.site_id;
}

r.post('/files', upload.array('files', 20), h(async (req, res) => {
  try {
    const { owner_type, owner_id, category, caption } = req.body;
    const sid = ownerSite(owner_type, Number(owner_id));
    assertSite(req, sid, 'create');
    if (!FILE_CATEGORIES[category]) throw new HttpError(400, '첨부 분류가 올바르지 않습니다.');
    if (!req.files?.length) throw new HttpError(400, '파일이 없습니다.');
    if (category.startsWith('photo')) for (const f of req.files) if (!/\.(jpe?g|png|webp|gif)$/i.test(f.originalname)) throw new HttpError(400, `사진 분류에는 이미지 파일만 올릴 수 있습니다: ${f.originalname}`);
    const ids = req.files.map(f => saveUploaded(f, { siteId: sid, ownerType: owner_type, ownerId: Number(owner_id), category, caption, userId: req.user.id }));
    audit(req, 'upload', 'file', ids[0], { owner_type, owner_id, category, names: req.files.map(f => f.originalname) }, sid);
    res.json({ ids });
  } catch (e) { cleanupTmp(req.files); throw e; }
}));

r.get('/files/:id', h(async (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  if (!f) throw new HttpError(404, '파일을 찾을 수 없습니다.');
  assertSite(req, f.site_id, 'view');
  const p = absPath({ stored_name: f.stored_name.replace(/#c\d+$/, '') });
  if (!fs.existsSync(p)) throw new HttpError(404, '저장된 파일이 없습니다.');
  const inline = req.query.inline && (f.mime.startsWith('image/') || f.mime === 'application/pdf');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.orig_name)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(p).pipe(res);
}));

r.delete('/files/:id', h(async (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  if (!f) throw new HttpError(404, '파일을 찾을 수 없습니다.');
  assertSite(req, f.site_id, 'delete');
  db.prepare('UPDATE files SET archived=1 WHERE id=?').run(f.id);
  audit(req, 'archive', 'file', f.id, { name: f.orig_name }, f.site_id);
  res.json({ ok: true });
}));

module.exports = r;
module.exports.can = can;
