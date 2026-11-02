const express = require('express');
const QRCode = require('qrcode');
const multer = require('multer');
const { db, audit } = require('../db');
const { requireAuth, assertSite, HttpError } = require('../auth');
const { h, assetSite } = require('../lib/svc');
const excel = require('../lib/excel');
const { renderPdf } = require('../lib/pdf');
const { cardHtml, REPORTS, qrLabels } = require('../lib/reports');
const config = require('../config');
const { CATEGORIES } = require('../lib/defs');

const r = express.Router();
r.use(requireAuth);
// QR 주소 기준: PUBLIC_BASE_URL 미설정 시 접속 주소 사용
r.use((req, _res, next) => { if (!config.publicBaseUrl) config.runtimeBase = `${req.protocol}://${req.get('host')}`; next(); });
const xlsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const TEMPLATE_CATS = ['power_cable', 'fiber_cable', 'lan_cable', 'cctv', 'equipment', 'fiber_splice', 'measurement'];
const TEMPLATE_LABEL = { equipment: '장비', fiber_splice: '광코어접속', measurement: '측정기록' };
const { commitExtra, COLS: EXTRA_COLS } = require('../lib/excel-extra');
const { judge } = require('../lib/judge');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendFile(res, buf, name, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(Buffer.from(buf));
}

r.get('/sites/:sid/excel/template/:cat', h(async (req, res) => {
  assertSite(req, Number(req.params.sid), 'view');
  if (!TEMPLATE_CATS.includes(req.params.cat)) throw new HttpError(400, '양식 종류가 올바르지 않습니다.');
  const label = TEMPLATE_LABEL[req.params.cat] || CATEGORIES[req.params.cat].label;
  sendFile(res, await excel.template(req.params.cat), `${label}_등록양식.xlsx`, XLSX);
}));

r.post('/sites/:sid/excel/preview', xlsUpload.single('file'), h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'create');
  const cat = req.body.category;
  if (!TEMPLATE_CATS.includes(cat)) throw new HttpError(400, '양식 종류가 올바르지 않습니다.');
  if (!req.file || !/\.xlsx$/i.test(Buffer.from(req.file.originalname, 'latin1').toString('utf8'))) throw new HttpError(400, '.xlsx 파일을 올리세요.');
  let rows;
  try { rows = await excel.parse(req.file.buffer, cat); } catch (e) { throw new HttpError(400, e.message.includes('머리글') ? e.message : '엑셀 파일을 읽을 수 없습니다: ' + e.message); }
  if (!rows.length) throw new HttpError(400, '데이터 행이 없습니다.');
  if (rows.length > 3000) throw new HttpError(400, '한 번에 3000행까지 올릴 수 있습니다.');
  const validated = excel.validate(sid, cat, rows);
  const info = db.prepare('INSERT INTO import_jobs(site_id, category, rows, created_by) VALUES (?,?,?,?)').run(sid, cat, JSON.stringify(rows), req.user.id);
  res.json({
    job_id: info.lastInsertRowid, total: rows.length,
    error_count: validated.filter(v => v.errors.length).length, dup_count: validated.filter(v => v.exists).length,
    rows: validated.map(v => ({ row: v.row._row, mgmt_no: v.row.mgmt_no || (v.row.c1 ? `${v.row.c1} #${v.row.k1}${v.row.e1} ↔ ${v.row.c2} #${v.row.k2}${v.row.e2}` : ''), name: v.row.name || v.row.test || v.row.closure || '', errors: v.errors, exists: v.exists })),
  });
}));

r.post('/import/:id/commit', h(async (req, res) => {
  const job = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(req.params.id);
  if (!job) throw new HttpError(404, '업로드 작업을 찾을 수 없습니다.');
  assertSite(req, job.site_id, 'create');
  if (job.committed) throw new HttpError(400, '이미 저장한 업로드입니다. 다시 올려주세요.');
  const mode = req.body.mode === 'all_or_nothing' ? 'all_or_nothing' : 'valid_only';
  const dup = ['skip', 'update', 'error'].includes(req.body.dup) ? req.body.dup : 'skip';
  if (dup === 'update') assertSite(req, job.site_id, 'edit');
  // 저장 직전 다시 검증 (미리보기 이후 데이터 변경 반영)
  const validated = excel.validate(job.site_id, job.category, JSON.parse(job.rows));
  let result;
  try {
    result = EXTRA_COLS[job.category]
      ? commitExtra(job.site_id, job.category, validated, mode, req.user.id, (assetId, b) => insertMeasurementRow(job.site_id, assetId, b, req.user.id))
      : excel.commit(job.site_id, job.category, validated, mode, dup, req.user.id);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  if (result.saved) db.prepare('UPDATE import_jobs SET committed=1 WHERE id=?').run(job.id);
  audit(req, 'import', 'excel', job.id, { category: job.category, mode, dup, result }, job.site_id);
  res.json(result);
}));

r.get('/sites/:sid/excel/export', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const site = db.prepare('SELECT name FROM sites WHERE id=?').get(sid);
  if (req.query.type === 'measurements') return sendFile(res, await excel.exportMeasurements(sid), `${site.name}_측정기록.xlsx`, XLSX);
  const cat = req.query.category && CATEGORIES[req.query.category] ? req.query.category : null;
  sendFile(res, await excel.exportAssets(sid, cat), `${site.name}_${cat ? CATEGORIES[cat].label : '설비'}목록.xlsx`, XLSX);
}));

// 엑셀 측정기록 1행 저장 (화면 등록과 같은 판정 규칙)
function insertMeasurementRow(siteId, assetId, b, userId) {
  const a = db.prepare('SELECT category FROM assets WHERE id=?').get(assetId);
  const m = { test_type: b.test_type, measured_at: b.measured_at, value: b.value === '' || b.value == null ? null : Number(b.value), unit: b.unit || null,
    test_voltage: b.test_voltage ? Number(b.test_voltage) : null, wavelength: b.wavelength ? Number(b.wavelength) : null, direction: b.direction || null };
  const j = judge(siteId, a.category, m);
  db.prepare(`INSERT INTO measurements(site_id, asset_id, core_id, test_type, measured_at, section, combination, test_voltage, wavelength, direction, value, unit, overall, instrument, measurer, criteria_id, criteria_snapshot, auto_result, auto_reason, raw_note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(siteId, assetId, b.core_id || null, m.test_type, m.measured_at, b.section || null, b.combination || null, m.test_voltage, m.wavelength, m.direction,
    m.value, m.unit, b.overall || null, b.instrument || null, b.measurer || null, j.criteria?.id || null, j.criteria ? JSON.stringify(j.criteria) : null, j.result, j.reason, b.raw_note || null, userId);
}

// ---------- PDF ----------
r.get('/pdf/card/:id', h(async (req, res) => {
  const sid = assetSite(req.params.id);
  assertSite(req, sid, 'view');
  const { html, title } = await cardHtml(Number(req.params.id));
  const pdf = await renderPdf(html, { title });
  audit(req, 'print', 'asset', Number(req.params.id), { doc: 'card' }, sid);
  if (req.query.html) return res.type('html').send(html);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(title + '.pdf')}`);
  res.send(pdf);
}));

r.get('/sites/:sid/pdf/:report', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  let doc;
  if (req.params.report === 'qr_labels') doc = await qrLabels(sid, req.query.ids ? String(req.query.ids).split(',').map(Number) : null);
  else {
    const rep = REPORTS[req.params.report];
    if (!rep) throw new HttpError(404, '출력 문서 종류가 없습니다.');
    if (req.query.asset_id && assetSite(req.query.asset_id) !== sid) throw new HttpError(403, '다른 현장의 설비입니다.');
    doc = rep.fn(sid, req.query);
  }
  const pdf = await renderPdf(doc.html, { landscape: !!doc.landscape, title: doc.title });
  audit(req, 'print', 'report', null, { report: req.params.report }, sid);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.title + '.pdf')}`);
  res.send(pdf);
}));

// ---------- QR ----------
r.get('/assets/:id/qr.png', h(async (req, res) => {
  const sid = assetSite(req.params.id);
  assertSite(req, sid, 'view');
  const a = db.prepare('SELECT qr_token FROM assets WHERE id=?').get(req.params.id);
  const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  res.type('png').send(await QRCode.toBuffer(`${base}/q/${a.qr_token}`, { width: 400, margin: 1 }));
}));

module.exports = r;
