const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, assertSite, HttpError, membership } = require('../auth');
const { h, clean, createAsset, updateAsset, generatePorts, generateCores, createConnection, endConnection, assetSite } = require('../lib/svc');
const { assetCard, connectionsOf } = require('../lib/card');
const graph = require('../lib/graph');
const { CATEGORIES, PORT_STATUSES, CORE_STATUSES } = require('../lib/defs');

const r = express.Router();
r.use(requireAuth);

// ---------- 설비 목록·검색 ----------
r.get('/sites/:sid/assets', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const { q, category, status, group, include_retired } = req.query;
  const where = ['a.site_id=@sid'];
  if (!include_retired) where.push('a.retired=0');
  if (category) where.push('a.category IN (' + String(category).split(',').map((c, i) => `@c${i}`).join(',') + ')');
  if (group) where.push(`a.category IN (${Object.entries(CATEGORIES).filter(([, v]) => v.group === group).map(([k]) => `'${k}'`).join(',')})`);
  if (status) where.push('a.status=@status');
  const params = { sid, status };
  if (category) String(category).split(',').forEach((c, i) => { params[`c${i}`] = c; });
  if (q) {
    params.q = `%${String(q).trim()}%`;
    // 관리번호·명칭·시리얼·위치·상세(회로번호·규격·시작/종점·IP 등)·포트명·랙 검색
    where.push(`(a.mgmt_no LIKE @q OR a.name LIKE @q OR a.serial_no LIKE @q OR a.model LIKE @q OR a.building LIKE @q OR a.floor LIKE @q OR a.room LIKE @q
      OR a.zone LIKE @q OR a.location_desc LIKE @q OR d.data LIKE @q
      OR EXISTS (SELECT 1 FROM ports p WHERE p.asset_id=a.id AND (a.mgmt_no || ' ' || p.name) LIKE @q)
      OR EXISTS (SELECT 1 FROM cable_cores c WHERE c.cable_id=a.id AND (a.mgmt_no || ' #' || c.core_no) LIKE @q)
      OR EXISTS (SELECT 1 FROM assets pa WHERE pa.id=a.parent_id AND pa.mgmt_no LIKE @q))`);
  }
  const rows = db.prepare(`SELECT a.id, a.mgmt_no, a.name, a.category, a.status, a.building, a.floor, a.room, a.zone, a.location_desc,
      a.manufacturer, a.model, a.serial_no, a.install_date, a.parent_id, a.retired, a.version, a.updated_at, d.data AS details,
      (SELECT COUNT(*) FROM drawing_marks m WHERE m.asset_id=a.id) AS mark_count,
      (SELECT m.auto_result FROM measurements m WHERE m.asset_id=a.id AND m.superseded_by IS NULL ORDER BY m.measured_at DESC, m.id DESC LIMIT 1) AS last_result,
      (SELECT COUNT(*) FROM measurements m WHERE m.asset_id=a.id AND m.superseded_by IS NULL) AS meas_count
    FROM assets a LEFT JOIN asset_details d ON d.asset_id=a.id
    WHERE ${where.join(' AND ')} ORDER BY a.category, a.mgmt_no LIMIT 2000`).all(params);
  res.json(rows.map(r => ({ ...r, details: JSON.parse(r.details || '{}') })));
}));

r.post('/sites/:sid/assets', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'create');
  const id = db.transaction(() => {
    const id = createAsset(sid, req.body, req.user.id);
    db.prepare(`INSERT INTO work_logs(site_id, asset_id, work_type, work_at, content, worker, status, created_by) VALUES (?,?,?,?,?,?,?,?)`)
      .run(sid, id, '신규 설치', req.body.install_date || new Date().toISOString().slice(0, 10), '설비 등록', req.user.name, '작성', req.user.id);
    audit(req, 'create', 'asset', id, { mgmt_no: req.body.mgmt_no, category: req.body.category }, sid);
    return id;
  })();
  res.json({ id });
}));

r.get('/assets/:id', h(async (req, res) => {
  const sid = assetSite(req.params.id);
  assertSite(req, sid, 'view');
  const card = assetCard(Number(req.params.id));
  card.perm = membership(req.user, sid);
  res.json(card);
}));

r.put('/assets/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'edit');
  const changed = db.transaction(() => {
    const changed = updateAsset(id, req.body, req.user.id);
    if (Object.keys(changed).length) audit(req, 'update', 'asset', id, changed, sid);
    return changed;
  })();
  res.json({ ok: true, changed });
}));

// 삭제: 연결·이력이 있으면 차단, 없으면 보관 처리 (물리 삭제 없음)
r.delete('/assets/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'delete');
  const active = connectionsOf(id, true).length;
  if (active) throw new HttpError(409, `활성 연결 ${active}건이 있어 삭제할 수 없습니다. 연결을 해제하거나 상태를 '철거'로 변경하세요.`);
  const m = db.prepare('SELECT COUNT(*) n FROM measurements WHERE asset_id=?').get(id).n;
  const w = db.prepare(`SELECT COUNT(*) n FROM work_logs WHERE asset_id=? AND work_type<>'신규 설치'`).get(id).n;
  db.transaction(() => {
    db.prepare(`UPDATE assets SET retired=1, status='철거', version=version+1, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`).run(req.user.id, id);
    audit(req, 'archive', 'asset', id, { measurements: m, worklogs: w }, sid);
  })();
  res.json({ ok: true, archived: true, message: '보관 처리되었습니다. 과거 이력은 유지됩니다.' });
}));

// 교체: 기존 장비 보존, 새 장비 생성, 연결·도면 표시 이전
r.post('/assets/:id/replace', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'edit');
  const old = db.prepare('SELECT * FROM assets WHERE id=?').get(id);
  if (old.retired) throw new HttpError(400, '이미 교체·보관된 설비입니다.');
  const newId = db.transaction(() => {
    const details = JSON.parse(db.prepare('SELECT data FROM asset_details WHERE asset_id=?').get(id)?.data || '{}');
    // 기존 장비를 보관 처리 후 같은 관리번호로 새 장비 생성
    db.prepare(`UPDATE assets SET retired=1, status='철거', version=version+1, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`).run(req.user.id, id);
    const body = req.body || {};
    const nid = createAsset(sid, {
      ...old, id: undefined, status: body.status || '사용 중',
      manufacturer: body.manufacturer ?? old.manufacturer, model: body.model ?? old.model, serial_no: body.serial_no,
      install_date: body.install_date || new Date().toISOString().slice(0, 10), contractor: body.contractor ?? old.contractor,
      details: { ...details, ...(body.details || {}) },
    }, req.user.id);
    db.prepare('UPDATE assets SET replaces=? WHERE id=?').run(id, nid);
    db.prepare('UPDATE assets SET replaced_by=? WHERE id=?').run(nid, id);
    // 포트 복제 (기존 포트 구성 그대로)
    const oldPorts = db.prepare('SELECT * FROM ports WHERE asset_id=? ORDER BY port_no').all(id);
    const have = new Set(db.prepare('SELECT name FROM ports WHERE asset_id=?').all(nid).map(p => p.name));
    for (const p of oldPorts) if (!have.has(p.name)) db.prepare('INSERT INTO ports(asset_id,port_no,name,port_type,status,data) VALUES (?,?,?,?,?,?)').run(nid, p.port_no, p.name, p.port_type, '예비', p.data);
    // 활성 연결 이전: 기존 연결 종료 후 새 장비의 같은 포트로 재등록 (이력 보존)
    const conns = connectionsOf(id, true);
    for (const c of conns) {
      endConnection(c.id, `설비 교체 (${old.serial_no || '-'} → ${body.serial_no || '-'})`, req.user.id);
      const remap = ep => {
        if (ep.type === 'asset' && ep.id === id) return { type: 'asset', id: nid, end: '' };
        if (ep.type === 'cable' && ep.id === id) return { type: 'cable', id: nid, end: ep.end };
        if (ep.type === 'core') {
          const cr = db.prepare('SELECT * FROM cable_cores WHERE id=?').get(ep.id);
          if (cr.cable_id === id) { const nc = db.prepare('SELECT id FROM cable_cores WHERE cable_id=? AND core_no=?').get(nid, cr.core_no); if (nc) return { type: 'core', id: nc.id, end: ep.end }; }
        }
        if (ep.type === 'port') {
          const p = db.prepare('SELECT * FROM ports WHERE id=?').get(ep.id);
          if (p.asset_id === id) { const np = db.prepare('SELECT id FROM ports WHERE asset_id=? AND name=?').get(nid, p.name); return { type: 'port', id: np.id, end: ep.end }; }
        }
        return { type: ep.type, id: ep.id, end: ep.end };
      };
      const ncid = createConnection(sid, { kind: c.kind, a: remap(c.a), b: remap(c.b), closure_asset_id: c.closure_asset_id, tray: c.tray, sleeve: c.sleeve, location: c.location, work_date: body.install_date, worker: body.worker, note: `교체 이전 (기존 연결 #${c.id})` }, req.user.id);
      db.prepare('UPDATE connections SET replaced_by_connection_id=? WHERE id=?').run(ncid, c.id);
    }
    // 도면 표시는 새 장비로 이전
    db.prepare('UPDATE drawing_marks SET asset_id=? WHERE asset_id=?').run(nid, id);
    const content = `장비 교체: 기존 S/N ${old.serial_no || '-'} → 신규 S/N ${body.serial_no || '-'}. ${body.reason || ''}`;
    const ins = db.prepare(`INSERT INTO work_logs(site_id, asset_id, work_type, work_at, content, worker, company, before_value, after_value, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const at = body.install_date || new Date().toISOString().slice(0, 10);
    ins.run(sid, id, '교체', at, content, body.worker || req.user.name, body.contractor || null, JSON.stringify({ serial_no: old.serial_no, model: old.model }), JSON.stringify({ replaced_by_asset_id: nid, serial_no: body.serial_no }), '작성', req.user.id);
    ins.run(sid, nid, '교체', at, content, body.worker || req.user.name, body.contractor || null, JSON.stringify({ replaces_asset_id: id, serial_no: old.serial_no }), JSON.stringify({ serial_no: body.serial_no, model: body.model ?? old.model }), '작성', req.user.id);
    audit(req, 'replace', 'asset', id, { new_asset_id: nid, old_serial: old.serial_no, new_serial: body.serial_no }, sid);
    return nid;
  })();
  res.json({ id: newId });
}));

// 장비 비밀번호 등 민감정보: 관리자·현장관리자만 (카드·엑셀·PDF 출력에 포함하지 않음)
function assertSecretAccess(req, sid) {
  assertSite(req, sid, 'edit');
  if (!['admin', 'site_manager'].includes(req.user.role)) throw new HttpError(403, '민감정보는 관리자·현장관리자만 볼 수 있습니다.');
}
r.get('/assets/:id/secrets', h(async (req, res) => {
  const sid = assetSite(req.params.id);
  assertSecretAccess(req, sid);
  audit(req, 'view_secret', 'asset', Number(req.params.id), null, sid);
  res.json(JSON.parse(db.prepare('SELECT data FROM asset_secrets WHERE asset_id=?').get(req.params.id)?.data || '{}'));
}));
r.put('/assets/:id/secrets', h(async (req, res) => {
  const sid = assetSite(req.params.id);
  assertSecretAccess(req, sid);
  const data = { login_id: clean(req.body.login_id), password: clean(req.body.password), memo: clean(req.body.memo) };
  db.prepare(`INSERT INTO asset_secrets(asset_id,data,updated_by) VALUES (?,?,?) ON CONFLICT(asset_id) DO UPDATE SET data=excluded.data, updated_by=excluded.updated_by, updated_at=datetime('now','localtime')`)
    .run(req.params.id, JSON.stringify(data), req.user.id);
  audit(req, 'update_secret', 'asset', Number(req.params.id), { fields: Object.keys(data) }, sid);
  res.json({ ok: true });
}));

// ---------- 포트·코어 ----------
r.post('/assets/:id/ports', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'edit');
  const a = db.prepare('SELECT category FROM assets WHERE id=?').get(id);
  const n = Number(req.body.count || 0);
  if (n < 1 || n > 512) throw new HttpError(400, '포트 수는 1~512 사이로 입력하세요.');
  db.transaction(() => { generatePorts(id, a.category, n, clean(req.body.prefix)); audit(req, 'create', 'ports', id, req.body, sid); })();
  res.json({ ok: true });
}));

r.put('/ports/:id', h(async (req, res) => {
  const p = db.prepare('SELECT p.*, a.site_id FROM ports p JOIN assets a ON a.id=p.asset_id WHERE p.id=?').get(req.params.id);
  if (!p) throw new HttpError(404, '포트를 찾을 수 없습니다.');
  assertSite(req, p.site_id, 'edit');
  const status = req.body.status ?? p.status;
  if (!PORT_STATUSES.includes(status)) throw new HttpError(400, '포트 상태가 올바르지 않습니다.');
  const data = { ...JSON.parse(p.data || '{}'), ...(req.body.data || {}) };
  db.prepare('UPDATE ports SET status=?, name=?, data=? WHERE id=?').run(status, clean(req.body.name) || p.name, JSON.stringify(data), p.id);
  audit(req, 'update', 'port', p.id, { before: { status: p.status, data: JSON.parse(p.data) }, after: { status, data } }, p.site_id);
  res.json({ ok: true });
}));

r.post('/assets/:id/cores', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'edit');
  const n = Number(req.body.count || 0);
  if (n < 1 || n > 864) throw new HttpError(400, '코어 수는 1~864 사이로 입력하세요.');
  db.transaction(() => { generateCores(id, n); audit(req, 'create', 'cores', id, { count: n }, sid); })();
  res.json({ ok: true });
}));

r.put('/cores/:id', h(async (req, res) => {
  const c = db.prepare('SELECT c.*, a.site_id FROM cable_cores c JOIN assets a ON a.id=c.cable_id WHERE c.id=?').get(req.params.id);
  if (!c) throw new HttpError(404, '코어를 찾을 수 없습니다.');
  assertSite(req, c.site_id, 'edit');
  const m = { ...c, ...req.body };
  if (!CORE_STATUSES.includes(m.status)) throw new HttpError(400, '코어 상태가 올바르지 않습니다.');
  db.prepare('UPDATE cable_cores SET color=?, purpose=?, status=? WHERE id=?').run(clean(m.color), clean(m.purpose), m.status, c.id);
  audit(req, 'update', 'core', c.id, { before: { color: c.color, purpose: c.purpose, status: c.status }, after: req.body }, c.site_id);
  res.json({ ok: true });
}));

// ---------- 연결 ----------
r.get('/sites/:sid/connections', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const rows = db.prepare(`SELECT id FROM connections WHERE site_id=? ${req.query.all ? '' : 'AND active=1'} ${req.query.kind ? 'AND kind=?' : ''} ORDER BY id`)
    .all(...[sid, req.query.kind].filter(v => v !== undefined));
  const eps = db.prepare('SELECT * FROM connection_endpoints WHERE connection_id=? ORDER BY seq');
  const conn = db.prepare('SELECT c.*, a.mgmt_no AS closure FROM connections c LEFT JOIN assets a ON a.id=c.closure_asset_id WHERE c.id=?');
  res.json(rows.map(({ id }) => {
    const c = conn.get(id);
    const [a, b] = eps.all(id);
    return { ...c, a: { ...a, ...graph.describe(graph.key(a.ep_type, a.ep_id, a.ep_end)) }, b: { ...b, ...graph.describe(graph.key(b.ep_type, b.ep_id, b.ep_end)) } };
  }));
}));

r.post('/sites/:sid/connections', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'create');
  const id = db.transaction(() => {
    const id = createConnection(sid, req.body, req.user.id);
    audit(req, 'create', 'connection', id, req.body, sid);
    return id;
  })();
  res.json({ id });
}));

r.post('/connections/:id/end', h(async (req, res) => {
  const c = db.prepare('SELECT * FROM connections WHERE id=?').get(req.params.id);
  if (!c) throw new HttpError(404, '연결을 찾을 수 없습니다.');
  assertSite(req, c.site_id, 'edit');
  db.transaction(() => { endConnection(c.id, req.body.reason, req.user.id); audit(req, 'end', 'connection', c.id, { reason: req.body.reason }, c.site_id); })();
  res.json({ ok: true });
}));

// 패치코드 변경: 기존 연결 종료 + 새 연결 생성, 변경 전후 이력 남김 (고정 배선은 그대로)
r.post('/connections/:id/change', h(async (req, res) => {
  const c = db.prepare('SELECT * FROM connections WHERE id=?').get(req.params.id);
  if (!c) throw new HttpError(404, '연결을 찾을 수 없습니다.');
  assertSite(req, c.site_id, 'edit');
  if (!c.active) throw new HttpError(400, '이미 해제된 연결입니다.');
  const eps = db.prepare('SELECT ep_type AS type, ep_id AS id, ep_end AS end FROM connection_endpoints WHERE connection_id=? ORDER BY seq').all(c.id);
  const keep = Number(req.body.keep_seq || 1); // 유지할 쪽
  const kept = eps[keep - 1];
  const newId = db.transaction(() => {
    endConnection(c.id, req.body.reason || '연결 변경', req.user.id);
    const nid = createConnection(c.site_id, { kind: c.kind, a: kept, b: req.body.new_endpoint, work_date: req.body.work_date, worker: req.body.worker, note: `변경 전 연결 #${c.id}` }, req.user.id);
    db.prepare('UPDATE connections SET replaced_by_connection_id=? WHERE id=?').run(nid, c.id);
    // 관련 설비 작업 이력
    const { describe, key } = graph;
    const before = describe(key(eps[0].type, eps[0].id, eps[0].end)).text + ' ↔ ' + describe(key(eps[1].type, eps[1].id, eps[1].end)).text;
    const nb = req.body.new_endpoint;
    const after = describe(key(kept.type, kept.id, kept.end)).text + ' ↔ ' + describe(key(nb.type, Number(nb.id), nb.end || '')).text;
    const aid = describe(key(kept.type, kept.id, kept.end)).asset_id;
    if (aid) db.prepare(`INSERT INTO work_logs(site_id, asset_id, work_type, work_at, content, worker, before_value, after_value, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(c.site_id, aid, '접속', req.body.work_date || new Date().toISOString().slice(0, 10), `${c.kind === 'patch' ? '패치코드' : '연결'} 변경: ${req.body.reason || ''}`, req.body.worker || req.user.name, before, after, '작성', req.user.id);
    audit(req, 'change', 'connection', c.id, { new_connection: nid, before, after }, c.site_id);
    return nid;
  })();
  res.json({ id: newId });
}));

// ---------- 추적·영향 ----------
r.get('/trace', h(async (req, res) => {
  const { type, id, end } = req.query;
  let sid;
  if (type === 'core') sid = db.prepare('SELECT a.site_id FROM cable_cores c JOIN assets a ON a.id=c.cable_id WHERE c.id=?').get(id)?.site_id;
  else if (type === 'port') sid = db.prepare('SELECT a.site_id FROM ports p JOIN assets a ON a.id=p.asset_id WHERE p.id=?').get(id)?.site_id;
  else sid = assetSite(id);
  assertSite(req, sid, 'view');
  if (type === 'core' && !end) {
    // 코어: 양방향 추적
    return res.json({ A: graph.trace(graph.key('core', id, 'A')), B: graph.trace(graph.key('core', id, 'B')) });
  }
  res.json({ root: graph.trace(graph.key(type, id, end || '')) });
}));

r.get('/assets/:id/impact', h(async (req, res) => {
  const sid = assetSite(req.params.id);
  assertSite(req, sid, 'view');
  res.json(graph.impact(Number(req.params.id)));
}));

// 랙 화면: 랙과 하위 패치패널·스위치 포트 현황
r.get('/assets/:id/rack', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'view');
  const children = db.prepare('SELECT id FROM assets WHERE parent_id=? AND retired=0 ORDER BY mgmt_no').all(id);
  res.json(children.map(c => assetCard(c.id)).map(c => ({ asset: c.asset, ports: c.ports, category_label: c.category_label })));
}));

module.exports = r;
