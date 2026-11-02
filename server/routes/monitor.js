const express = require('express');
const crypto = require('crypto');
const { db, audit } = require('../db');
const { requireAuth, assertSite, HttpError } = require('../auth');
const { h, clean, assetSite } = require('../lib/svc');
const mon = require('../lib/monitor');

const ingest = express.Router();
const r = express.Router();

// ---------- 외부 시스템 상태 수신 (토큰 인증, 로그인 불필요) ----------
// POST /api/ingest/status  Authorization: Bearer <토큰>
// { "items": [ { "asset": "CCTV-01", "status": "정상|이상|응답 없음|ok|down|alarm", "message": "..." } ] }
ingest.post('/ingest/status', h(async (req, res) => {
  const auth = String(req.get('authorization') || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw new HttpError(401, '토큰이 필요합니다.');
  const t = db.prepare('SELECT * FROM api_tokens WHERE token_hash=? AND revoked=0').get(crypto.createHash('sha256').update(token).digest('hex'));
  if (!t) throw new HttpError(401, '유효하지 않은 토큰입니다.');
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
  if (items.length > 1000) throw new HttpError(400, '한 번에 1000건까지 보낼 수 있습니다.');
  const results = [];
  for (const it of items) {
    const a = it.asset_id
      ? db.prepare('SELECT id, site_id FROM assets WHERE id=? AND retired=0').get(it.asset_id)
      : db.prepare('SELECT id, site_id FROM assets WHERE site_id=? AND mgmt_no=? AND retired=0').get(t.site_id, String(it.asset || ''));
    if (!a || a.site_id !== t.site_id) { results.push({ asset: it.asset ?? it.asset_id, ok: false, error: '이 토큰의 현장에 없는 설비' }); continue; }
    const st = mon.normalizeStatus(it.status);
    if (!st) { results.push({ asset: it.asset ?? it.asset_id, ok: false, error: '상태 값을 알 수 없음' }); continue; }
    let m = db.prepare('SELECT * FROM monitors WHERE asset_id=?').get(a.id);
    if (!m) {
      db.prepare(`INSERT INTO monitors(site_id, asset_id, method, interval_sec) VALUES (?,?,'push',60)`).run(t.site_id, a.id);
      m = db.prepare('SELECT * FROM monitors WHERE asset_id=?').get(a.id);
    }
    if (m.method !== 'push' && m.enabled) { results.push({ asset: it.asset ?? it.asset_id, ok: false, error: '이 설비는 서버 점검(TCP/HTTP) 방식으로 설정됨' }); continue; }
    mon.setStatus(m, st, { message: clean(it.message) ? String(it.message).slice(0, 300) : null, source: 'push', ok: st === '정상' });
    results.push({ asset: it.asset ?? it.asset_id, ok: true, status: st });
  }
  db.prepare(`UPDATE api_tokens SET last_used_at=datetime('now','localtime') WHERE id=?`).run(t.id);
  res.json({ received: items.length, results });
}));

r.use(requireAuth);

const canConfigure = (req) => { if (!['admin', 'site_manager'].includes(req.user.role)) throw new HttpError(403, '상태 감시 설정은 관리자·현장관리자만 할 수 있습니다.'); };

r.get('/sites/:sid/monitors', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'view');
  const rows = db.prepare(`SELECT m.*, a.mgmt_no, a.name, a.category, a.status AS asset_status FROM monitors m JOIN assets a ON a.id=m.asset_id
    WHERE m.site_id=? AND a.retired=0 ORDER BY CASE m.status WHEN '응답 없음' THEN 0 WHEN '이상' THEN 1 WHEN '확인 전' THEN 2 ELSE 3 END, a.mgmt_no`).all(sid);
  const events = db.prepare(`SELECT e.*, a.mgmt_no FROM monitor_events e JOIN monitors m ON m.id=e.monitor_id JOIN assets a ON a.id=m.asset_id
    WHERE m.site_id=? ORDER BY e.id DESC LIMIT 100`).all(sid);
  res.json({ monitors: rows, events, server_time: mon.now() });
}));

r.get('/assets/:id/monitor', h(async (req, res) => {
  const sid = assetSite(req.params.id);
  assertSite(req, sid, 'view');
  const m = db.prepare('SELECT * FROM monitors WHERE asset_id=?').get(req.params.id) || null;
  const events = m ? db.prepare('SELECT * FROM monitor_events WHERE monitor_id=? ORDER BY id DESC LIMIT 50').all(m.id) : [];
  res.json({ monitor: m, events });
}));

r.put('/assets/:id/monitor', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'edit'); canConfigure(req);
  const b = req.body;
  if (!['tcp', 'http', 'push'].includes(b.method)) throw new HttpError(400, '점검 방식이 올바르지 않습니다.');
  const host = clean(b.host);
  if (b.method !== 'push') {
    if (!host || !/^[A-Za-z0-9.\-:]+$/.test(host)) throw new HttpError(400, '점검 대상 주소(IP 또는 호스트명)를 입력하세요.');
    const port = Number(b.port || (b.method === 'http' ? 80 : 0));
    if (!(port >= 1 && port <= 65535)) throw new HttpError(400, '포트는 1~65535 사이여야 합니다.');
  }
  const interval = Math.max(15, Math.min(3600, Number(b.interval_sec || 60)));
  const vals = [b.method, host, b.port ? Number(b.port) : null, clean(b.path), interval, Math.max(500, Math.min(15000, Number(b.timeout_ms || 3000))), Math.max(1, Math.min(10, Number(b.fail_threshold || 2))), Math.max(60, Number(b.push_stale_sec || 300)), b.enabled === false ? 0 : 1];
  const ex = db.prepare('SELECT id FROM monitors WHERE asset_id=?').get(id);
  if (ex) db.prepare(`UPDATE monitors SET method=?, host=?, port=?, path=?, interval_sec=?, timeout_ms=?, fail_threshold=?, push_stale_sec=?, enabled=?, status=CASE WHEN ?=0 THEN '중지' WHEN status='중지' THEN '확인 전' ELSE status END, last_checked_at=NULL WHERE id=?`).run(...vals, vals[8], ex.id);
  else db.prepare(`INSERT INTO monitors(method, host, port, path, interval_sec, timeout_ms, fail_threshold, push_stale_sec, enabled, site_id, asset_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...vals, sid, id, req.user.id);
  audit(req, ex ? 'update' : 'create', 'monitor', id, b, sid);
  res.json({ ok: true });
}));

r.delete('/assets/:id/monitor', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'edit'); canConfigure(req);
  db.prepare(`UPDATE monitors SET enabled=0, status='중지' WHERE asset_id=?`).run(id);
  audit(req, 'disable', 'monitor', id, null, sid);
  res.json({ ok: true });
}));

r.post('/assets/:id/monitor/check', h(async (req, res) => {
  const id = Number(req.params.id);
  const sid = assetSite(id);
  assertSite(req, sid, 'view');
  const m = db.prepare('SELECT * FROM monitors WHERE asset_id=?').get(id);
  if (!m) throw new HttpError(404, '감시 설정이 없습니다.');
  if (m.method === 'push') throw new HttpError(400, '외부 수신(push) 방식은 즉시 점검할 수 없습니다.');
  const r2 = await mon.checkOne(m);
  res.json(r2);
}));

// ---------- 수신 토큰 ----------
r.get('/sites/:sid/tokens', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'edit'); canConfigure(req);
  res.json(db.prepare('SELECT t.id, t.name, t.prefix, t.revoked, t.last_used_at, t.created_at, u.name AS created_by_name FROM api_tokens t LEFT JOIN users u ON u.id=t.created_by WHERE t.site_id=? ORDER BY t.id DESC').all(sid));
}));
r.post('/sites/:sid/tokens', h(async (req, res) => {
  const sid = Number(req.params.sid);
  assertSite(req, sid, 'edit'); canConfigure(req);
  if (!clean(req.body.name)) throw new HttpError(400, '토큰 이름을 입력하세요.');
  const token = 'cht_' + crypto.randomBytes(24).toString('hex');
  const info = db.prepare('INSERT INTO api_tokens(site_id, name, token_hash, prefix, created_by) VALUES (?,?,?,?,?)').run(sid, clean(req.body.name), crypto.createHash('sha256').update(token).digest('hex'), token.slice(0, 12), req.user.id);
  audit(req, 'create', 'api_token', info.lastInsertRowid, { name: req.body.name }, sid);
  res.json({ id: info.lastInsertRowid, token, note: '이 토큰은 지금 한 번만 표시됩니다.' });
}));
r.delete('/tokens/:id', h(async (req, res) => {
  const t = db.prepare('SELECT * FROM api_tokens WHERE id=?').get(req.params.id);
  if (!t) throw new HttpError(404, '토큰이 없습니다.');
  assertSite(req, t.site_id, 'edit'); canConfigure(req);
  db.prepare('UPDATE api_tokens SET revoked=1 WHERE id=?').run(t.id);
  audit(req, 'revoke', 'api_token', t.id, null, t.site_id);
  res.json({ ok: true });
}));

module.exports = r;
module.exports.ingest = ingest;
