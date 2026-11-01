// ERP·그룹웨어 연동 API (/api/v1). 회사별 API 키 + 권한 범위 + 요청 횟수 제한 + Idempotency-Key.
// API 키는 만든 직원의 권한 안에서만 동작한다 (그 직원이 퇴사하면 키도 폐기된다).
const express = require('express');
const { all, get, run, J } = require('../db');
const C = require('../core');
const E = require('../engine');
const F = require('../files');
const wrap = require('../wrap');

const r = express.Router();
const buckets = new Map();
r.use((req, res, next) => {
  const m = /^Bearer\s+(isk_[\w-]+)$/.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: 'API 키가 필요합니다 (Authorization: Bearer isk_...)' });
  const k = get(`select * from api_keys where key_hash=?`, C.sha256(m[1]));
  if (!k || k.revoked_at) return res.status(401).json({ error: '폐기되었거나 없는 API 키입니다' });
  const u = get(`select * from users where id=? and status='active'`, k.created_by);
  if (!u) return res.status(401).json({ error: '키를 만든 직원 계정이 비활성 상태입니다' });
  // 분당 요청 수 제한 (키별)
  const now = Date.now(), b = buckets.get(k.id) || { start: now, n: 0 };
  if (now - b.start >= 60e3) { b.start = now; b.n = 0; }
  b.n++; buckets.set(k.id, b);
  res.set({ 'x-ratelimit-limit': String(k.rate_per_min), 'x-ratelimit-remaining': String(Math.max(k.rate_per_min - b.n, 0)) });
  if (b.n > k.rate_per_min) { res.set('retry-after', String(Math.ceil((b.start + 60e3 - now) / 1000))); return res.status(429).json({ error: '요청 횟수 제한을 넘었습니다' }); }
  run(`update api_keys set last_used_at=datetime('now') where id=?`, k.id);
  req.key = { ...k, scopes: J(k.scopes, []) }; req.user = u;
  next();
});
const scope = (s) => (req, res, next) => (req.key.scopes.includes(s) ? next() : res.status(403).json({ error: `이 키에는 ${s} 권한이 없습니다` }));

// 같은 Idempotency-Key 로 다시 보내면 처음 응답을 그대로 돌려준다 (본문이 다르면 409)
function idem(req, res, next) {
  const key = String(req.headers['idempotency-key'] || '').trim();
  if (!key || key.length > 100) return res.status(400).json({ error: 'Idempotency-Key 헤더가 필요합니다' });
  const route = `${req.method} ${req.baseUrl}${req.path}`;
  const h = C.sha256(JSON.stringify([route, req.body]));
  const ex = get(`select * from idempotency where company_id=? and idem_key=?`, req.user.company_id, key);
  if (ex) {
    if (ex.req_hash !== h) return res.status(409).json({ error: '같은 Idempotency-Key 로 다른 요청을 보냈습니다' });
    if (ex.status_code == null) return res.status(409).json({ error: '같은 요청을 처리하는 중입니다' });
    res.set('idempotent-replay', 'true'); return res.status(ex.status_code).type('application/json').send(ex.response);
  }
  run(`insert into idempotency(company_id,idem_key,route,req_hash) values(?,?,?,?)`, req.user.company_id, key, route, h);
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500) run(`delete from idempotency where company_id=? and idem_key=?`, req.user.company_id, key);
    else run(`update idempotency set status_code=?, response=? where company_id=? and idem_key=?`, res.statusCode, JSON.stringify(body), req.user.company_id, key);
    return json(body);
  };
  next();
}
const actor = (req) => ({ type: 'api', id: req.key.id, name: `API:${req.key.name}` });

function docOut(d) {
  return {
    id: d.id, title: d.title, status: d.status, status_label: E.STATUS[d.status], mode: d.mode, version: d.version, content_hash: d.content_hash,
    site: d.site, partner: d.partner, amount: d.amount, start_date: d.start_date, end_date: d.end_date, sign_deadline: d.sign_deadline,
    created_at: d.created_at, completed_at: d.completed_at,
    participants: all(`select role_key, role_label, name, status, signed_at from participants where document_id=? order by order_no,id`, d.id),
  };
}
function mine(req) { const d = E.getDoc(req.params.id); if (!E.canViewDoc(req.user, d)) throw C.notFound('문서를 찾을 수 없습니다'); return d; }

r.get('/templates', scope('templates:read'), (req, res) => {
  res.json(all(`select * from templates where company_id=? and archived=0`, req.user.company_id).filter((t) => E.canUseTemplate(req.user, t)).map((t) => {
    const tv = E.currentTV(t.id);
    return { id: t.id, name: t.name, doc_type: t.doc_type, version: tv.version, roles: tv.roles, fields: tv.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, owner: f.owner })) };
  }));
});
r.post('/documents', scope('documents:write'), idem, wrap(async (req, res) => {
  const b = req.body || {};
  const t = get(`select * from templates where id=? and company_id=?`, b.template_id, req.user.company_id);
  if (!t) throw C.notFound('템플릿을 찾을 수 없습니다');
  const tv = E.currentTV(t.id);
  const id = E.createDocument({ companyId: req.user.company_id, user: req.user, tvId: tv.id, title: b.title, mode: 'remote', vals: b.values || {}, participants: b.participants || [], meta: {}, ip: req.ip });
  C.audit({ companyId: req.user.company_id, documentId: id, actor: actor(req), action: 'API_DOC_CREATE', ip: req.ip });
  if (b.send === true) {
    if (!req.key.scopes.includes('documents:send')) throw C.forbid('이 키에는 documents:send 권한이 없습니다');
    E.sendDocument(req.user, id, { ip: req.ip });
  }
  res.status(201).json(docOut(E.getDoc(id)));
}));
r.post('/documents/:id/send', scope('documents:send'), idem, wrap(async (req, res) => {
  const d = mine(req); E.sendDocument(req.user, d.id, { ip: req.ip }); await E.afterSign(d.id); res.json(docOut(E.getDoc(d.id)));
}));
r.get('/documents/:id', scope('documents:read'), (req, res) => res.json(docOut(mine(req))));
r.post('/documents/:id/cancel', scope('documents:cancel'), idem, wrap(async (req, res) => {
  const d = mine(req); E.cancelDocument(req.user, d.id, req.body?.reason, { ip: req.ip }); res.json(docOut(E.getDoc(d.id)));
}));
r.get('/documents/:id/history', scope('documents:read'), (req, res) => {
  const d = mine(req);
  res.json({ id: d.id, content_hash: d.content_hash, history: all(`select action, actor_type, actor_name, at, hash from audit_logs where document_id=? order by id`, d.id) });
});
// 완료 PDF: 권한 확인 후 10분 동안만 쓰는 다운로드 주소를 준다
r.get('/documents/:id/pdf-url', scope('files:read'), (req, res) => {
  const d = mine(req);
  if (d.status !== 'completed' || !d.pdf_file_id) return res.status(409).json({ error: '완료 PDF가 아직 없습니다' });
  const s = F.signedUrl(d.pdf_file_id, d.company_id);
  C.audit({ companyId: d.company_id, documentId: d.id, actor: actor(req), action: 'API_PDF_URL', ip: req.ip });
  res.json({ url: E.BASE_URL() + s.url, expires_at: s.expiresAt, sha256: get(`select sha256 from files where id=?`, d.pdf_file_id).sha256 });
});

module.exports = r;
