'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, tx } = require('./db');
const auth = require('./auth');
const core = require('./engine/core');
const { games, ids, clientConfig } = require('./games');

const PORT = process.env.PORT || 3000;
const SECURE = process.env.NODE_ENV === 'production';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });

/* ---------- boot: admin account + game rows ---------- */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO admins(username,pass_hash) VALUES(?,?)').run(ADMIN_USER, auth.hash(pw));
  console.log(`[boot] admin account created: ${ADMIN_USER} / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : pw}`);
}
ids.forEach((id, i) => {
  const g = games[id];
  db.prepare('INSERT OR IGNORE INTO games(id,enabled,min_bet,max_bet,sort) VALUES(?,1,?,?,?)')
    .run(id, cents(g.bets[0]), cents(g.bets[g.bets.length - 1]), i);
});

function cents(v) { return Math.round(v * 100); }
const money = (c) => c / 100;
const rng = (() => { const buf = new Uint32Array(1024); let i = 1024; return () => { if (i >= 1024) { crypto.getRandomValues(buf); i = 0; } return buf[i++]; }; })();
const audit = (actor, action, detail) => db.prepare('INSERT INTO audit(actor,action,detail) VALUES(?,?,?)').run(actor, action, JSON.stringify(detail || {}));
const bad = (res, code, msg) => res.status(code).json({ error: msg });

/* ---------- simple login throttle ---------- */
const fails = new Map();
function throttled(key) { const f = fails.get(key); return f && f.n >= 8 && Date.now() - f.t < 10 * 60e3; }
function fail(key) { const f = fails.get(key) || { n: 0, t: Date.now() }; f.n++; f.t = Date.now(); fails.set(key, f); }

/* ---------- player auth ---------- */
function player(req, res, next) {
  const s = auth.readSession(auth.cookies(req).sid, 'player');
  if (!s) return bad(res, 401, '로그인이 필요합니다.');
  const p = db.prepare('SELECT id,username,balance,status FROM players WHERE id=?').get(s.subject);
  if (!p || p.status !== 'active') return bad(res, 403, '이용이 정지된 계정입니다.');
  req.player = p; next();
}
app.post('/api/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const key = 'p:' + req.ip;
  if (throttled(key)) return bad(res, 429, '로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요.');
  const p = db.prepare('SELECT * FROM players WHERE username=?').get(String(username).trim());
  if (!p || !auth.verify(String(password), p.pass_hash)) { fail(key); return bad(res, 401, '아이디 또는 비밀번호가 맞지 않습니다.'); }
  if (p.status !== 'active') return bad(res, 403, '이용이 정지된 계정입니다. 운영자에게 문의하세요.');
  fails.delete(key);
  db.prepare("UPDATE players SET last_login=datetime('now') WHERE id=?").run(p.id);
  auth.setCookie(res, 'sid', auth.createSession('player', p.id), auth.TTL.player, SECURE);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { auth.destroy(auth.cookies(req).sid || ''); auth.setCookie(res, 'sid', '', 0, SECURE); res.json({ ok: true }); });
app.get('/api/me', player, (req, res) => res.json({ username: req.player.username, balance: money(req.player.balance) }));

/* ---------- games ---------- */
function gameRow(id) { return db.prepare('SELECT * FROM games WHERE id=?').get(id); }
function allowedBets(g, row) { return g.bets.filter((b) => cents(b) >= row.min_bet && cents(b) <= row.max_bet); }
app.get('/api/games', player, (req, res) => {
  const rows = db.prepare('SELECT * FROM games WHERE enabled=1 ORDER BY sort').all();
  res.json(rows.filter((r) => games[r.id]).map((r) => ({ id: r.id, name: games[r.id].name, reels: games[r.id].reels, rows: games[r.id].rows, volatility: games[r.id].volatility, rtp: games[r.id].rtp })));
});
app.get('/api/games/:id', player, (req, res) => {
  const g = games[req.params.id], row = gameRow(req.params.id);
  if (!g || !row || !row.enabled) return bad(res, 404, '이용할 수 없는 게임입니다.');
  const cfg = clientConfig(g); cfg.bets = allowedBets(g, row);
  if (!cfg.bets.includes(cfg.defaultBet)) cfg.defaultBet = cfg.bets[0];
  res.json({ game: cfg, balance: money(req.player.balance) });
});

// Strip server-only fields from a round before sending it to the browser
function publicRound(r) {
  const spin = (s) => ({ grid: s.grid, lineWins: s.lineWins, scatter: s.scatter, win: s.win, expand: s.expand || null, retrigger: s.retrigger || 0 });
  return { base: spin(r.base), feature: r.feature ? { ...r.feature, spins: r.feature.spins.map(spin) } : null, total: r.total };
}

app.post('/api/games/:id/spin', player, (req, res) => {
  const g = games[req.params.id], row = gameRow(req.params.id);
  if (!g || !row || !row.enabled) return bad(res, 404, '이용할 수 없는 게임입니다.');
  const bet = Number(req.body && req.body.bet);
  if (!allowedBets(g, row).includes(bet)) return bad(res, 400, '허용되지 않은 베팅 금액입니다.');
  const betC = cents(bet);
  try {
    const out = tx(() => {
      const p = db.prepare('SELECT balance,status FROM players WHERE id=?').get(req.player.id);
      if (p.status !== 'active') throw Object.assign(new Error('정지된 계정입니다.'), { code: 403 });
      if (p.balance < betC) throw Object.assign(new Error('크레딧이 부족합니다.'), { code: 402 });
      const round = core.play(g, rng);
      const winC = Math.round(round.total * betC);
      const after = p.balance - betC + winC;
      db.prepare('UPDATE players SET balance=? WHERE id=?').run(after, req.player.id);
      const rid = db.prepare('INSERT INTO rounds(player_id,game_id,bet,win,balance_after,feature,result) VALUES(?,?,?,?,?,?,?)')
        .run(req.player.id, g.id, betC, winC, after, round.feature ? round.feature.type : null, JSON.stringify(round)).lastInsertRowid;
      db.prepare("INSERT INTO tx(player_id,type,amount,balance_after,round_id) VALUES(?,'bet',?,?,?)").run(req.player.id, -betC, p.balance - betC, rid);
      if (winC > 0) db.prepare("INSERT INTO tx(player_id,type,amount,balance_after,round_id) VALUES(?,'win',?,?,?)").run(req.player.id, winC, after, rid);
      return { roundId: Number(rid), round: publicRound(round), win: money(winC), balance: money(after) };
    });
    res.json(out);
  } catch (e) {
    if (e.code) return bad(res, e.code, e.message);
    console.error(e); bad(res, 500, '처리 중 오류가 발생했습니다. 이 회차는 무효 처리되었습니다.');
  }
});
app.get('/api/history', player, (req, res) => {
  res.json(db.prepare('SELECT id,game_id,bet,win,balance_after,feature,created_at FROM rounds WHERE player_id=? ORDER BY id DESC LIMIT 50').all(req.player.id)
    .map((r) => ({ ...r, bet: money(r.bet), win: money(r.win), balance_after: money(r.balance_after), game: games[r.game_id] ? games[r.game_id].name : r.game_id })));
});

/* ---------- admin ---------- */
const A = express.Router();
function admin(req, res, next) {
  const s = auth.readSession(auth.cookies(req).asid, 'admin');
  if (!s) return bad(res, 401, '관리자 로그인이 필요합니다.');
  req.admin = db.prepare('SELECT id,username FROM admins WHERE id=?').get(s.subject);
  if (!req.admin) return bad(res, 401, '관리자 로그인이 필요합니다.');
  next();
}
A.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const key = 'a:' + req.ip;
  if (throttled(key)) return bad(res, 429, '로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요.');
  const a = db.prepare('SELECT * FROM admins WHERE username=?').get(String(username));
  if (!a || !auth.verify(String(password), a.pass_hash)) { fail(key); return bad(res, 401, '아이디 또는 비밀번호가 맞지 않습니다.'); }
  fails.delete(key);
  auth.setCookie(res, 'asid', auth.createSession('admin', a.id), auth.TTL.admin, SECURE);
  audit(a.username, 'login', { ip: req.ip });
  res.json({ ok: true });
});
A.post('/logout', (req, res) => { auth.destroy(auth.cookies(req).asid || ''); auth.setCookie(res, 'asid', '', 0, SECURE); res.json({ ok: true }); });
A.use(admin);
A.get('/me', (req, res) => res.json({ username: req.admin.username }));

const RANGES = { today: "date('now')", '7d': "date('now','-6 day')", '30d': "date('now','-29 day')", all: "'0000-01-01'" };
A.get('/stats', (req, res) => {
  const since = RANGES[req.query.range] || RANGES.today;
  const t = db.prepare(`SELECT COUNT(*) rounds, COALESCE(SUM(bet),0) bet, COALESCE(SUM(win),0) win, COUNT(DISTINCT player_id) players,
    SUM(CASE WHEN feature IS NOT NULL THEN 1 ELSE 0 END) features FROM rounds WHERE created_at >= ${since}`).get();
  const byGame = db.prepare(`SELECT game_id, COUNT(*) rounds, SUM(bet) bet, SUM(win) win, MAX(win) maxwin,
    SUM(CASE WHEN feature IS NOT NULL THEN 1 ELSE 0 END) features FROM rounds WHERE created_at >= ${since} GROUP BY game_id`).all();
  const daily = db.prepare(`SELECT date(created_at) day, COUNT(*) rounds, SUM(bet) bet, SUM(win) win FROM rounds
    WHERE created_at >= date('now','-13 day') GROUP BY day ORDER BY day`).all();
  const totals = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(balance),0) bal, SUM(status='active') active FROM players").get();
  res.json({
    range: req.query.range || 'today',
    totals: { rounds: t.rounds, bet: money(t.bet), win: money(t.win), ggr: money(t.bet - t.win), rtp: t.bet ? t.win / t.bet : null, players: t.players, features: t.features },
    byGame: byGame.map((r) => ({ id: r.game_id, name: games[r.game_id] ? games[r.game_id].name : r.game_id, rounds: r.rounds, bet: money(r.bet), win: money(r.win), ggr: money(r.bet - r.win), rtp: r.bet ? r.win / r.bet : null, theoretical: games[r.game_id] ? games[r.game_id].rtp : null, maxWin: money(r.maxwin), features: r.features })),
    daily: daily.map((d) => ({ day: d.day, rounds: d.rounds, bet: money(d.bet), win: money(d.win), ggr: money(d.bet - d.win) })),
    playersTotal: totals.n, playersActive: totals.active || 0, liability: money(totals.bal),
  });
});

A.get('/players', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT p.id,p.username,p.balance,p.status,p.note,p.created_at,p.last_login,
      (SELECT COUNT(*) FROM rounds r WHERE r.player_id=p.id) rounds,
      (SELECT COALESCE(SUM(bet),0) FROM rounds r WHERE r.player_id=p.id) bet,
      (SELECT COALESCE(SUM(win),0) FROM rounds r WHERE r.player_id=p.id) win
    FROM players p WHERE p.username LIKE ? ORDER BY p.id DESC LIMIT 200`).all(q)
    .map((p) => ({ ...p, balance: money(p.balance), bet: money(p.bet), win: money(p.win) })));
});
A.post('/players', (req, res) => {
  const { username = '', password = '', balance = 0, note = '' } = req.body || {};
  const u = String(username).trim();
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(u)) return bad(res, 400, '아이디는 영문·숫자·_.- 3~24자로 입력하세요.');
  if (String(password).length < 6) return bad(res, 400, '비밀번호는 6자 이상이어야 합니다.');
  const bal = cents(Number(balance) || 0);
  if (bal < 0) return bad(res, 400, '초기 크레딧은 0 이상이어야 합니다.');
  if (db.prepare('SELECT 1 FROM players WHERE username=?').get(u)) return bad(res, 409, '이미 있는 아이디입니다.');
  const id = tx(() => {
    const id = db.prepare('INSERT INTO players(username,pass_hash,balance,note) VALUES(?,?,?,?)').run(u, auth.hash(String(password)), bal, String(note).slice(0, 200)).lastInsertRowid;
    if (bal) db.prepare("INSERT INTO tx(player_id,type,amount,balance_after,note,actor) VALUES(?,'adjust',?,?,?,?)").run(id, bal, bal, '초기 지급', req.admin.username);
    return id;
  });
  audit(req.admin.username, 'player.create', { id: Number(id), username: u, balance: money(bal) });
  res.json({ id: Number(id) });
});
A.patch('/players/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
  if (!p) return bad(res, 404, '플레이어를 찾을 수 없습니다.');
  const { status, note, password } = req.body || {};
  if (status && !['active', 'suspended'].includes(status)) return bad(res, 400, '상태 값이 올바르지 않습니다.');
  if (password !== undefined && String(password).length < 6) return bad(res, 400, '비밀번호는 6자 이상이어야 합니다.');
  if (status) db.prepare('UPDATE players SET status=? WHERE id=?').run(status, p.id);
  if (note !== undefined) db.prepare('UPDATE players SET note=? WHERE id=?').run(String(note).slice(0, 200), p.id);
  if (password) { db.prepare('UPDATE players SET pass_hash=? WHERE id=?').run(auth.hash(String(password)), p.id); db.prepare("DELETE FROM sessions WHERE kind='player' AND subject=?").run(p.id); }
  if (status === 'suspended') db.prepare("DELETE FROM sessions WHERE kind='player' AND subject=?").run(p.id);
  audit(req.admin.username, 'player.update', { id: p.id, username: p.username, status, note: note !== undefined, password: !!password });
  res.json({ ok: true });
});
A.post('/players/:id/adjust', (req, res) => {
  const amt = cents(Number(req.body && req.body.amount));
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!amt) return bad(res, 400, '조정 금액을 입력하세요.');
  if (!reason) return bad(res, 400, '조정 사유를 입력하세요.');
  try {
    const out = tx(() => {
      const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
      if (!p) throw Object.assign(new Error('플레이어를 찾을 수 없습니다.'), { code: 404 });
      const after = p.balance + amt;
      if (after < 0) throw Object.assign(new Error('차감 후 잔액이 0보다 작아집니다.'), { code: 400 });
      db.prepare('UPDATE players SET balance=? WHERE id=?').run(after, p.id);
      db.prepare("INSERT INTO tx(player_id,type,amount,balance_after,note,actor) VALUES(?,'adjust',?,?,?,?)").run(p.id, amt, after, reason.slice(0, 200), req.admin.username);
      audit(req.admin.username, 'player.adjust', { id: p.id, username: p.username, amount: money(amt), reason });
      return { balance: money(after) };
    });
    res.json(out);
  } catch (e) { if (e.code) return bad(res, e.code, e.message); throw e; }
});
A.get('/players/:id/tx', (req, res) => {
  res.json(db.prepare('SELECT * FROM tx WHERE player_id=? ORDER BY id DESC LIMIT 200').all(req.params.id)
    .map((t) => ({ ...t, amount: money(t.amount), balance_after: money(t.balance_after) })));
});

A.get('/rounds', (req, res) => {
  const where = [], args = [];
  if (req.query.player) { where.push('p.username LIKE ?'); args.push(`%${req.query.player}%`); }
  if (req.query.game) { where.push('r.game_id=?'); args.push(req.query.game); }
  if (req.query.feature === '1') where.push('r.feature IS NOT NULL');
  if (req.query.minWin) { where.push('r.win >= ?'); args.push(cents(+req.query.minWin)); }
  const before = Number(req.query.before) || 0;
  if (before) { where.push('r.id < ?'); args.push(before); }
  const rows = db.prepare(`SELECT r.id,r.player_id,p.username,r.game_id,r.bet,r.win,r.balance_after,r.feature,r.created_at
    FROM rounds r JOIN players p ON p.id=r.player_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 100`).all(...args);
  res.json(rows.map((r) => ({ ...r, bet: money(r.bet), win: money(r.win), balance_after: money(r.balance_after), game: games[r.game_id] ? games[r.game_id].name : r.game_id })));
});
A.get('/rounds/:id', (req, res) => {
  const r = db.prepare('SELECT r.*, p.username FROM rounds r JOIN players p ON p.id=r.player_id WHERE r.id=?').get(req.params.id);
  if (!r) return bad(res, 404, '회차를 찾을 수 없습니다.');
  const g = games[r.game_id];
  res.json({ ...r, bet: money(r.bet), win: money(r.win), balance_after: money(r.balance_after), result: JSON.parse(r.result),
    symbols: g ? g.symbols.map((s) => ({ id: s.id, name: s.name })) : [], lines: g ? g.lines : [], game: g ? g.name : r.game_id });
});

A.get('/games', (req, res) => {
  const rows = db.prepare('SELECT * FROM games ORDER BY sort').all();
  const life = db.prepare('SELECT game_id, COUNT(*) rounds, SUM(bet) bet, SUM(win) win FROM rounds GROUP BY game_id').all();
  res.json(rows.filter((r) => games[r.id]).map((r) => {
    const g = games[r.id], l = life.find((x) => x.game_id === r.id) || { rounds: 0, bet: 0, win: 0 };
    return { id: r.id, name: g.name, layout: `${g.reels}×${g.rows} · ${g.lines.length}라인`, volatility: g.volatility, theoretical: g.rtp,
      features: (g.features || []).map((f) => f.type), enabled: !!r.enabled, minBet: money(r.min_bet), maxBet: money(r.max_bet), bets: g.bets,
      rounds: l.rounds, actual: l.bet ? l.win / l.bet : null, ggr: money(l.bet - l.win) };
  }));
});
A.patch('/games/:id', (req, res) => {
  const row = gameRow(req.params.id), g = games[req.params.id];
  if (!row || !g) return bad(res, 404, '게임을 찾을 수 없습니다.');
  const { enabled, minBet, maxBet } = req.body || {};
  const min = minBet !== undefined ? cents(minBet) : row.min_bet, max = maxBet !== undefined ? cents(maxBet) : row.max_bet;
  if (min > max) return bad(res, 400, '최소 베팅이 최대 베팅보다 클 수 없습니다.');
  if (!g.bets.some((b) => cents(b) >= min && cents(b) <= max)) return bad(res, 400, '이 범위에 해당하는 베팅 단계가 없습니다.');
  db.prepare('UPDATE games SET enabled=?, min_bet=?, max_bet=? WHERE id=?').run(enabled === undefined ? row.enabled : enabled ? 1 : 0, min, max, row.id);
  audit(req.admin.username, 'game.update', { id: row.id, enabled, minBet, maxBet });
  res.json({ ok: true });
});
A.get('/audit', (req, res) => res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all()));
A.post('/password', (req, res) => {
  const { current = '', next: nw = '' } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE id=?').get(req.admin.id);
  if (!auth.verify(String(current), a.pass_hash)) return bad(res, 400, '현재 비밀번호가 맞지 않습니다.');
  if (String(nw).length < 10) return bad(res, 400, '새 비밀번호는 10자 이상이어야 합니다.');
  db.prepare('UPDATE admins SET pass_hash=? WHERE id=?').run(auth.hash(String(nw)), a.id);
  audit(a.username, 'admin.password', {});
  res.json({ ok: true });
});
app.use('/admin/api', A);

/* ---------- static ---------- */
const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub, { extensions: ['html'], maxAge: SECURE ? '1h' : 0 }));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));
app.use((err, req, res, next) => { console.error(err); bad(res, 500, '서버 오류가 발생했습니다.'); });

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600e3).unref();
app.listen(PORT, () => console.log(`[boot] slot platform on :${PORT}`));
