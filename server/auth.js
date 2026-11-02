const session = require('express-session');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// SQLite 세션 저장소: 서버 재시작 후에도 로그인 유지
class SqliteStore extends session.Store {
  get(sid, cb) {
    const r = db.prepare('SELECT data, expires FROM sessions WHERE sid=?').get(sid);
    if (!r || r.expires < Date.now()) return cb(null, null);
    cb(null, JSON.parse(r.data));
  }
  set(sid, sess, cb) {
    const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
    db.prepare('INSERT INTO sessions(sid,data,expires) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires')
      .run(sid, JSON.stringify(sess), exp);
    cb && cb(null);
  }
  destroy(sid, cb) { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb && cb(null); }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

const sessionMiddleware = session({
  store: new SqliteStore(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 1000 * 60 * 60 * 12 },
});

function loadUser(req, _res, next) {
  if (req.session?.userId) {
    const u = db.prepare('SELECT id, username, name, role, active FROM users WHERE id=?').get(req.session.userId);
    if (u && u.active) req.user = u;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  next();
}

function membership(user, siteId) {
  if (!user) return null;
  if (user.role === 'admin') return { can_view: 1, can_create: 1, can_edit: 1, can_delete: 1, can_review: 1 };
  const m = db.prepare('SELECT * FROM site_members WHERE user_id=? AND site_id=?').get(user.id, siteId);
  if (!m) return null;
  if (user.role === 'viewer') return { ...m, can_create: 0, can_edit: 0, can_delete: 0, can_review: 0 };
  return m;
}

const ACTION_COL = { view: 'can_view', create: 'can_create', edit: 'can_edit', delete: 'can_delete', review: 'can_review' };

function can(user, siteId, action = 'view') {
  const m = membership(user, siteId);
  return !!(m && m.can_view && m[ACTION_COL[action]]);
}

function assertSite(req, siteId, action = 'view') {
  if (!siteId) throw new HttpError(404, '대상을 찾을 수 없습니다.');
  if (!can(req.user, siteId, action)) {
    const label = { view: '조회', create: '등록', edit: '수정', delete: '삭제', review: '검토' }[action];
    throw new HttpError(403, `이 현장에 대한 ${label} 권한이 없습니다.`);
  }
}

function accessibleSiteIds(user) {
  if (user.role === 'admin') return db.prepare('SELECT id FROM sites').all().map(r => r.id);
  return db.prepare('SELECT site_id FROM site_members WHERE user_id=? AND can_view=1').all(user.id).map(r => r.site_id);
}

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
function checkPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

module.exports = { HttpError, sessionMiddleware, loadUser, requireAuth, requireAdmin, can, assertSite, membership, accessibleSiteIds, hashPassword, checkPassword };
