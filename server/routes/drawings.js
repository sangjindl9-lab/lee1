const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, assertSite, HttpError } = require('../auth');
const { h, clean, assetSite } = require('../lib/svc');
const { upload, saveUploaded, kindOf, cleanupTmp } = require('../lib/files');

const r = express.Router();
r.use(requireAuth);

const drawingSite = id => db.prepare('SELECT site_id FROM drawings WHERE id=?').get(id)?.site_id;
const revSite = id => db.prepare('SELECT d.site_id FROM drawing_revisions r JOIN drawings d ON d.id=r.drawing_id WHERE r.id=?').get(id)?.site_id;
const markSite = id => db.prepare('SELECT d.site_id FROM drawing_marks m JOIN drawing_revisions r ON r.id=m.revision_id JOIN drawings d ON d.id=r.drawing_id WHERE m.id=?').get(id)?.site_id;

r.get('/sites/:sid/drawings', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const ds = db.prepare('SELECT * FROM drawings WHERE site_id=? AND archived=0 ORDER BY drawing_no').all(sid);
  const revs = db.prepare(`SELECT r.*, u.name AS created_by_name, (SELECT COUNT(*) FROM drawing_marks m WHERE m.revision_id=r.id) AS mark_count,
      (SELECT COUNT(*) FROM drawing_marks m WHERE m.revision_id=r.id AND m.needs_recheck=1) AS recheck_count,
      df.orig_name AS display_name, sf.orig_name AS source_name
      FROM drawing_revisions r LEFT JOIN users u ON u.id=r.created_by LEFT JOIN files df ON df.id=r.display_file_id LEFT JOIN files sf ON sf.id=r.source_file_id
      WHERE r.drawing_id=? ORDER BY r.id DESC`);
  res.json(ds.map(d => ({ ...d, revisions: revs.all(d.id) })));
}));

function registerRevision(req, drawingId, siteId, body, files) {
  const display = files?.display?.[0];
  const source = files?.source?.[0];
  if (!clean(body.rev_no)) throw new HttpError(400, '개정번호를 입력하세요.');
  if (!display && !source) throw new HttpError(400, '표시용 PDF·이미지 또는 DWG/DXF 원본 중 하나 이상을 올리세요.');
  if (display && !['pdf', 'image'].includes(kindOf(display.originalname))) throw new HttpError(400, '표시용 도면은 PDF 또는 이미지(JPG·PNG)만 가능합니다. DWG는 원본 칸에 올리세요.');
  if (source && kindOf(source.originalname) !== 'cad') throw new HttpError(400, '원본 칸에는 DWG/DXF 파일을 올리세요.');
  if (db.prepare('SELECT 1 FROM drawing_revisions WHERE drawing_id=? AND rev_no=?').get(drawingId, clean(body.rev_no))) throw new HttpError(409, '같은 개정번호가 이미 있습니다.');
  const info = db.prepare(`INSERT INTO drawing_revisions(drawing_id, rev_no, rev_date, reason, display_type, created_by) VALUES (?,?,?,?,?,?)`)
    .run(drawingId, clean(body.rev_no), clean(body.rev_date), clean(body.reason), display ? kindOf(display.originalname) : 'none', req.user.id);
  const rid = Number(info.lastInsertRowid);
  if (display) {
    const fid = saveUploaded(display, { siteId, ownerType: 'revision', ownerId: rid, category: 'drawing', userId: req.user.id });
    db.prepare('UPDATE drawing_revisions SET display_file_id=? WHERE id=?').run(fid, rid);
  }
  if (source) {
    const fid = saveUploaded(source, { siteId, ownerType: 'revision', ownerId: rid, category: 'dwg_original', userId: req.user.id });
    db.prepare('UPDATE drawing_revisions SET source_file_id=? WHERE id=?').run(fid, rid);
  }
  // 이전 개정본 표시 복사 → '위치 재확인 필요'
  let copied = 0;
  if (body.copy_from_revision_id) {
    const from = db.prepare('SELECT * FROM drawing_revisions WHERE id=? AND drawing_id=?').get(body.copy_from_revision_id, drawingId);
    if (!from) throw new HttpError(400, '복사할 이전 개정본이 이 도면에 없습니다.');
    const marks = db.prepare('SELECT * FROM drawing_marks WHERE revision_id=?').all(from.id);
    const ins = db.prepare(`INSERT INTO drawing_marks(revision_id, page, asset_id, shape, geom, needs_recheck, copied_from_mark_id, created_by, updated_by) VALUES (?,?,?,?,?,1,?,?,?)`);
    for (const m of marks) { ins.run(rid, m.page, m.asset_id, m.shape, m.geom, m.id, req.user.id, req.user.id); copied++; }
    db.prepare('UPDATE drawing_revisions SET copied_from_revision_id=? WHERE id=?').run(from.id, rid);
  }
  return { rid, copied };
}

const revUpload = upload.fields([{ name: 'display', maxCount: 1 }, { name: 'source', maxCount: 1 }]);
const allFiles = req => Object.values(req.files || {}).flat();

r.post('/sites/:sid/drawings', revUpload, h(async (req, res) => {
  try {
    const sid = Number(req.params.sid);
    assertSite(req, sid, 'create');
    const b = req.body;
    if (!clean(b.drawing_no) || !clean(b.title)) throw new HttpError(400, '도면번호와 도면명은 필수입니다.');
    if (db.prepare('SELECT 1 FROM drawings WHERE site_id=? AND drawing_no=?').get(sid, clean(b.drawing_no))) throw new HttpError(409, '같은 도면번호가 이미 있습니다. 개정본으로 등록하세요.');
    const out = db.transaction(() => {
      const info = db.prepare('INSERT INTO drawings(site_id, drawing_no, title, discipline, created_by) VALUES (?,?,?,?,?)').run(sid, clean(b.drawing_no), clean(b.title), clean(b.discipline), req.user.id);
      const rv = registerRevision(req, Number(info.lastInsertRowid), sid, b, req.files);
      audit(req, 'create', 'drawing', info.lastInsertRowid, { drawing_no: b.drawing_no, rev_no: b.rev_no }, sid);
      return { id: Number(info.lastInsertRowid), revision_id: rv.rid };
    })();
    res.json(out);
  } catch (e) { cleanupTmp(allFiles(req)); throw e; }
}));

r.put('/drawings/:id', h(async (req, res) => {
  const sid = drawingSite(req.params.id);
  assertSite(req, sid, 'edit');
  const d = db.prepare('SELECT * FROM drawings WHERE id=?').get(req.params.id);
  const m = { ...d, ...req.body };
  db.prepare('UPDATE drawings SET drawing_no=?, title=?, discipline=? WHERE id=?').run(clean(m.drawing_no), clean(m.title), clean(m.discipline), d.id);
  audit(req, 'update', 'drawing', d.id, req.body, sid);
  res.json({ ok: true });
}));

r.post('/drawings/:id/revisions', revUpload, h(async (req, res) => {
  try {
    const sid = drawingSite(req.params.id);
    assertSite(req, sid, 'create');
    const out = db.transaction(() => {
      const rv = registerRevision(req, Number(req.params.id), sid, req.body, req.files);
      audit(req, 'create', 'revision', rv.rid, { drawing_id: req.params.id, rev_no: req.body.rev_no, copied: rv.copied }, sid);
      return rv;
    })();
    res.json({ revision_id: out.rid, copied: out.copied });
  } catch (e) { cleanupTmp(allFiles(req)); throw e; }
}));

r.get('/revisions/:id', h(async (req, res) => {
  const sid = revSite(req.params.id);
  assertSite(req, sid, 'view');
  const rv = db.prepare(`SELECT r.*, d.drawing_no, d.title, d.site_id, df.orig_name AS display_name, sf.orig_name AS source_name,
      (SELECT MAX(id) FROM drawing_revisions x WHERE x.drawing_id=r.drawing_id) AS latest_id
      FROM drawing_revisions r JOIN drawings d ON d.id=r.drawing_id LEFT JOIN files df ON df.id=r.display_file_id LEFT JOIN files sf ON sf.id=r.source_file_id WHERE r.id=?`).get(req.params.id);
  const marks = db.prepare(`SELECT m.*, a.mgmt_no, a.name, a.category, a.status FROM drawing_marks m JOIN assets a ON a.id=m.asset_id WHERE m.revision_id=? ORDER BY m.id`).all(rv.id);
  res.json({ ...rv, pages: JSON.parse(rv.pages_json || '[]'), scales: JSON.parse(rv.scales_json || '{}'), marks: marks.map(m => ({ ...m, geom: JSON.parse(m.geom) })) });
}));

r.put('/revisions/:id', h(async (req, res) => {
  const sid = revSite(req.params.id);
  const rv = db.prepare('SELECT * FROM drawing_revisions WHERE id=?').get(req.params.id);
  const b = req.body;
  // 페이지 크기는 뷰어가 처음 열 때 기록 (조회 권한으로 가능, 값이 비어 있을 때만)
  if (b.pages && !rv.pages_json) {
    assertSite(req, sid, 'view');
    db.prepare('UPDATE drawing_revisions SET pages_json=? WHERE id=?').run(JSON.stringify(b.pages), rv.id);
  }
  if (b.scales !== undefined || b.review_status || b.reason !== undefined || b.rev_date !== undefined) {
    assertSite(req, sid, b.review_status ? 'review' : 'edit');
    if (b.scales !== undefined) db.prepare('UPDATE drawing_revisions SET scales_json=? WHERE id=?').run(JSON.stringify(b.scales), rv.id);
    if (b.review_status) db.prepare(`UPDATE drawing_revisions SET review_status=?, reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?`).run(b.review_status, req.user.id, rv.id);
    if (b.reason !== undefined) db.prepare('UPDATE drawing_revisions SET reason=? WHERE id=?').run(clean(b.reason), rv.id);
    if (b.rev_date !== undefined) db.prepare('UPDATE drawing_revisions SET rev_date=? WHERE id=?').run(clean(b.rev_date), rv.id);
    audit(req, 'update', 'revision', rv.id, b, sid);
  }
  res.json({ ok: true });
}));

// ---------- 도면 표시 객체 ----------
function validGeom(shape, g) {
  const ok = v => typeof v === 'number' && v >= -0.05 && v <= 1.05;
  if (shape === 'point') return ok(g.x) && ok(g.y);
  if (shape === 'rect') return ok(g.x) && ok(g.y) && ok(g.w) && ok(g.h);
  if (shape === 'polyline') return Array.isArray(g.pts) && g.pts.length >= 2 && g.pts.every(p => ok(p[0]) && ok(p[1]));
  return false;
}

r.post('/revisions/:id/marks', h(async (req, res) => {
  const sid = revSite(req.params.id);
  assertSite(req, sid, 'create');
  const { asset_id, shape, geom, page } = req.body;
  if (assetSite(asset_id) !== sid) throw new HttpError(400, '설비가 이 현장에 없습니다.');
  if (!validGeom(shape, geom)) throw new HttpError(400, '도면 좌표가 올바르지 않습니다.');
  const info = db.prepare('INSERT INTO drawing_marks(revision_id, page, asset_id, shape, geom, created_by, updated_by) VALUES (?,?,?,?,?,?,?)')
    .run(req.params.id, Number(page || 1), asset_id, shape, JSON.stringify(geom), req.user.id, req.user.id);
  audit(req, 'create', 'mark', info.lastInsertRowid, { revision_id: req.params.id, asset_id, shape, page }, sid);
  res.json({ id: info.lastInsertRowid });
}));

r.put('/marks/:id', h(async (req, res) => {
  const sid = markSite(req.params.id);
  assertSite(req, sid, 'edit');
  const m = db.prepare('SELECT * FROM drawing_marks WHERE id=?').get(req.params.id);
  if (req.body.version !== undefined && Number(req.body.version) !== m.version) throw new HttpError(409, '다른 사용자가 이 도면 표시를 먼저 수정했습니다. 새로고침 후 다시 시도하세요.');
  const geom = req.body.geom ?? JSON.parse(m.geom);
  if (!validGeom(m.shape, geom)) throw new HttpError(400, '도면 좌표가 올바르지 않습니다.');
  let assetId = m.asset_id;
  if (req.body.asset_id && Number(req.body.asset_id) !== m.asset_id) {
    if (assetSite(req.body.asset_id) !== sid) throw new HttpError(400, '설비가 이 현장에 없습니다.');
    assetId = Number(req.body.asset_id);
  }
  const recheck = req.body.confirm ? 0 : (req.body.geom ? 0 : m.needs_recheck);
  db.prepare(`UPDATE drawing_marks SET geom=?, asset_id=?, needs_recheck=?, version=version+1, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(JSON.stringify(geom), assetId, recheck, req.user.id, m.id);
  audit(req, 'update', 'mark', m.id, { before: { geom: JSON.parse(m.geom), asset_id: m.asset_id }, after: { geom, asset_id: assetId, confirm: !!req.body.confirm } }, sid);
  res.json({ ok: true, version: m.version + 1 });
}));

r.delete('/marks/:id', h(async (req, res) => {
  const sid = markSite(req.params.id);
  assertSite(req, sid, 'delete');
  const m = db.prepare('SELECT * FROM drawing_marks WHERE id=?').get(req.params.id);
  db.transaction(() => {
    db.prepare('UPDATE drawing_marks SET copied_from_mark_id=NULL WHERE copied_from_mark_id=?').run(m.id);
    db.prepare('DELETE FROM drawing_marks WHERE id=?').run(m.id);
    audit(req, 'delete', 'mark', m.id, m, sid);
  })();
  res.json({ ok: true });
}));

module.exports = r;
