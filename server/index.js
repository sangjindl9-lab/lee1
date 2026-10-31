'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, tx } = require('./db');
const auth = require('./auth');
const core = require('./engine/core');
const { games, ids, variant, variantList, clientConfig } = require('./games');

// Money is stored and shown in whole KRW (원).
const PORT = process.env.PORT || 3000;
const SECURE = process.env.NODE_ENV === 'production';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });

const won = (v) => Math.round(Number(v) || 0);
const rng = (() => { const buf = new Uint32Array(1024); let i = 1024; return () => { if (i >= 1024) { crypto.getRandomValues(buf); i = 0; } return buf[i++]; }; })();
const audit = (actor, action, detail) => db.prepare('INSERT INTO audit(actor,action,detail) VALUES(?,?,?)').run(actor, action, JSON.stringify(detail || {}));
const bad = (res, code, msg) => res.status(code).json({ error: msg });
const err = (code, msg) => Object.assign(new Error(msg), { code });

/* ---------- schema additions (safe to run on every boot) ---------- */
for (const sql of [
  'ALTER TABLE games ADD COLUMN settings TEXT',
  'ALTER TABLE players ADD COLUMN max_bet INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE players ADD COLUMN max_win INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE players ADD COLUMN daily_loss INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE rounds ADD COLUMN raw_win INTEGER',
  'ALTER TABLE rounds ADD COLUMN variant TEXT',
]) { try { db.exec(sql); } catch (e) { /* column exists */ } }

/* ---------- boot: admin account + game settings ---------- */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO admins(username,pass_hash) VALUES(?,?)').run(ADMIN_USER, auth.hash(pw));
  console.log(`[boot] admin account created: ${ADMIN_USER} / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : pw}`);
}
function defaults(id) {
  const g = games[id];
  return { bets: g.bets.slice(), defaultBet: g.defaultBet, maxWin: 0, maxWinX: 5000, variant: g.defaultVariant, featuresOn: true, maintenance: '' };
}
ids.forEach((id, i) => {
  db.prepare('INSERT OR IGNORE INTO games(id,enabled,sort,settings) VALUES(?,1,?,?)').run(id, i, JSON.stringify(defaults(id)));
  const row = db.prepare('SELECT settings FROM games WHERE id=?').get(id);
  if (!row.settings) db.prepare('UPDATE games SET settings=? WHERE id=?').run(JSON.stringify(defaults(id)), id);
});
function gameRow(id) {
  const r = db.prepare('SELECT * FROM games WHERE id=?').get(id);
  if (!r || !games[id]) return null;
  r.s = { ...defaults(id), ...JSON.parse(r.settings || '{}') };
  return r;
}

/* ---------- simple login throttle ---------- */
const fails = new Map();
function throttled(key) { const f = fails.get(key); return f && f.n >= 8 && Date.now() - f.t < 10 * 60e3; }
function fail(key) { const f = fails.get(key) || { n: 0, t: Date.now() }; f.n++; f.t = Date.now(); fails.set(key, f); }

/* ---------- player ---------- */
function player(req, res, next) {
  const s = auth.readSession(auth.cookies(req).sid, 'player');
  if (!s) return bad(res, 401, '로그인이 필요합니다.');
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(s.subject);
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
app.get('/api/me', player, (req, res) => res.json({ username: req.player.username, balance: req.player.balance }));

function playerBets(row, p) { return row.s.bets.filter((b) => !p.max_bet || b <= p.max_bet); }
app.get('/api/games', player, (req, res) => {
  const rows = db.prepare('SELECT id FROM games WHERE enabled=1 ORDER BY sort').all().map((r) => gameRow(r.id)).filter(Boolean);
  res.json(rows.map((r) => { const g = games[r.id]; return { id: r.id, name: g.name, reels: g.reels, rows: g.rows, volatility: g.volatility, rtp: variant(r.id, r.s.variant).rtp, maintenance: r.s.maintenance || '' }; }));
});
app.get('/api/games/:id', player, (req, res) => {
  const row = gameRow(req.params.id);
  if (!row || !row.enabled) return bad(res, 404, '이용할 수 없는 게임입니다.');
  if (row.s.maintenance) return bad(res, 503, `점검 중: ${row.s.maintenance}`);
  const cfg = clientConfig(row.id, row.s);
  cfg.bets = playerBets(row, req.player);
  if (!cfg.bets.length) return bad(res, 403, '이 계정은 이 게임에서 베팅할 수 있는 단계가 없습니다.');
  if (!cfg.bets.includes(cfg.defaultBet)) cfg.defaultBet = cfg.bets[0];
  if (req.player.max_win) cfg.maxWin = cfg.maxWin ? Math.min(cfg.maxWin, req.player.max_win) : req.player.max_win;
  res.json({ game: cfg, balance: req.player.balance });
});

function publicRound(r) {
  const spin = (s) => ({ grid: s.grid, lineWins: s.lineWins, scatter: s.scatter, win: s.win, expand: s.expand || null, retrigger: s.retrigger || 0 });
  return { base: spin(r.base), feature: r.feature ? { ...r.feature, spins: r.feature.spins.map(spin) } : null, total: r.total };
}
function lossToday(pid) {
  return db.prepare("SELECT COALESCE(SUM(bet-win),0) v FROM rounds WHERE player_id=? AND created_at >= date('now')").get(pid).v;
}

app.post('/api/games/:id/spin', player, (req, res) => {
  const row = gameRow(req.params.id);
  if (!row || !row.enabled) return bad(res, 404, '이용할 수 없는 게임입니다.');
  if (row.s.maintenance) return bad(res, 503, `점검 중: ${row.s.maintenance}`);
  const bet = won(req.body && req.body.bet);
  if (!playerBets(row, req.player).includes(bet)) return bad(res, 400, '허용되지 않은 베팅 금액입니다.');
  const g = variant(row.id, row.s.variant);
  try {
    const out = tx(() => {
      const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.player.id);
      if (p.status !== 'active') throw err(403, '정지된 계정입니다.');
      if (p.balance < bet) throw err(402, '잔액이 부족합니다.');
      if (p.daily_loss && lossToday(p.id) + bet > p.daily_loss) throw err(403, `오늘 손실 한도(${p.daily_loss.toLocaleString('ko-KR')}원)에 도달했습니다.`);
      const round = core.play(g, rng, { features: row.s.featuresOn });
      const raw = Math.floor(round.total * bet);
      const caps = [row.s.maxWin, row.s.maxWinX ? row.s.maxWinX * bet : 0, p.max_win].filter((c) => c > 0);
      const cap = caps.length ? Math.min(...caps) : Infinity;
      const win = Math.min(raw, cap);
      if (win < raw) round.capped = { raw, cap };
      const after = p.balance - bet + win;
      db.prepare('UPDATE players SET balance=? WHERE id=?').run(after, p.id);
      const rid = db.prepare('INSERT INTO rounds(player_id,game_id,bet,win,raw_win,balance_after,feature,variant,result) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(p.id, row.id, bet, win, raw, after, round.feature ? round.feature.type : null, row.s.variant, JSON.stringify(round)).lastInsertRowid;
      db.prepare("INSERT INTO tx(player_id,type,amount,balance_after,round_id) VALUES(?,'bet',?,?,?)").run(p.id, -bet, p.balance - bet, rid);
      if (win > 0) db.prepare("INSERT INTO tx(player_id,type,amount,balance_after,round_id) VALUES(?,'win',?,?,?)").run(p.id, win, after, rid);
      return { roundId: Number(rid), round: publicRound(round), win, rawWin: raw, capped: win < raw, balance: after };
    });
    res.json(out);
  } catch (e) {
    if (e.code) return bad(res, e.code, e.message);
    console.error(e); bad(res, 500, '처리 중 오류가 발생했습니다. 이 회차는 무효 처리되었습니다.');
  }
});
app.get('/api/history', player, (req, res) => {
  res.json(db.prepare('SELECT id,game_id,bet,win,balance_after,feature,created_at FROM rounds WHERE player_id=? ORDER BY id DESC LIMIT 50').all(req.player.id)
    .map((r) => ({ ...r, game: games[r.game_id] ? games[r.game_id].name : r.game_id })));
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
const gname = (id) => (games[id] ? games[id].name : id);
A.get('/stats', (req, res) => {
  const since = RANGES[req.query.range] || RANGES.today;
  const t = db.prepare(`SELECT COUNT(*) rounds, COALESCE(SUM(bet),0) bet, COALESCE(SUM(win),0) win, COUNT(DISTINCT player_id) players,
    SUM(CASE WHEN feature IS NOT NULL THEN 1 ELSE 0 END) features, SUM(CASE WHEN raw_win > win THEN 1 ELSE 0 END) capped,
    COALESCE(SUM(CASE WHEN raw_win > win THEN raw_win - win ELSE 0 END),0) capSaved FROM rounds WHERE created_at >= ${since}`).get();
  const byGame = db.prepare(`SELECT game_id, COUNT(*) rounds, SUM(bet) bet, SUM(win) win, MAX(win) maxwin,
    SUM(CASE WHEN feature IS NOT NULL THEN 1 ELSE 0 END) features, SUM(CASE WHEN raw_win > win THEN 1 ELSE 0 END) capped
    FROM rounds WHERE created_at >= ${since} GROUP BY game_id`).all();
  const daily = db.prepare(`SELECT date(created_at) day, COUNT(*) rounds, SUM(bet) bet, SUM(win) win FROM rounds
    WHERE created_at >= date('now','-13 day') GROUP BY day ORDER BY day`).all();
  const totals = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(balance),0) bal, SUM(status='active') active FROM players").get();
  res.json({
    totals: { rounds: t.rounds, bet: t.bet, win: t.win, ggr: t.bet - t.win, rtp: t.bet ? t.win / t.bet : null, players: t.players, features: t.features, capped: t.capped || 0, capSaved: t.capSaved },
    byGame: byGame.map((r) => { const row = gameRow(r.game_id); return { id: r.game_id, name: gname(r.game_id), rounds: r.rounds, bet: r.bet, win: r.win, ggr: r.bet - r.win, rtp: r.bet ? r.win / r.bet : null, theoretical: row ? variant(r.game_id, row.s.variant).rtp : null, maxWin: r.maxwin, features: r.features, capped: r.capped }; }),
    daily: daily.map((d) => ({ ...d, ggr: d.bet - d.win })),
    playersTotal: totals.n, playersActive: totals.active || 0, liability: totals.bal,
  });
});

A.get('/players', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT p.id,p.username,p.balance,p.status,p.note,p.created_at,p.last_login,p.max_bet,p.max_win,p.daily_loss,
      (SELECT COUNT(*) FROM rounds r WHERE r.player_id=p.id) rounds,
      (SELECT COALESCE(SUM(bet),0) FROM rounds r WHERE r.player_id=p.id) bet,
      (SELECT COALESCE(SUM(win),0) FROM rounds r WHERE r.player_id=p.id) win,
      (SELECT COALESCE(SUM(bet-win),0) FROM rounds r WHERE r.player_id=p.id AND r.created_at >= date('now')) loss_today
    FROM players p WHERE p.username LIKE ? ORDER BY p.id DESC LIMIT 200`).all(q));
});
A.post('/players', (req, res) => {
  const { username = '', password = '', balance = 0, note = '' } = req.body || {};
  const u = String(username).trim();
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(u)) return bad(res, 400, '아이디는 영문·숫자·_.- 3~24자로 입력하세요.');
  if (String(password).length < 6) return bad(res, 400, '비밀번호는 6자 이상이어야 합니다.');
  const bal = won(balance);
  if (bal < 0) return bad(res, 400, '초기 금액은 0원 이상이어야 합니다.');
  if (db.prepare('SELECT 1 FROM players WHERE username=?').get(u)) return bad(res, 409, '이미 있는 아이디입니다.');
  const id = tx(() => {
    const id = db.prepare('INSERT INTO players(username,pass_hash,balance,note) VALUES(?,?,?,?)').run(u, auth.hash(String(password)), bal, String(note).slice(0, 200)).lastInsertRowid;
    if (bal) db.prepare("INSERT INTO tx(player_id,type,amount,balance_after,note,actor) VALUES(?,'adjust',?,?,?,?)").run(id, bal, bal, '초기 지급', req.admin.username);
    return id;
  });
  audit(req.admin.username, 'player.create', { id: Number(id), username: u, balance: bal });
  res.json({ id: Number(id) });
});
A.patch('/players/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
  if (!p) return bad(res, 404, '플레이어를 찾을 수 없습니다.');
  const b = req.body || {};
  if (b.status && !['active', 'suspended'].includes(b.status)) return bad(res, 400, '상태 값이 올바르지 않습니다.');
  if (b.password !== undefined && String(b.password).length < 6) return bad(res, 400, '비밀번호는 6자 이상이어야 합니다.');
  for (const k of ['maxBet', 'maxWin', 'dailyLoss']) if (b[k] !== undefined && won(b[k]) < 0) return bad(res, 400, '한도는 0원 이상이어야 합니다. (0 = 제한 없음)');
  if (b.status) db.prepare('UPDATE players SET status=? WHERE id=?').run(b.status, p.id);
  if (b.note !== undefined) db.prepare('UPDATE players SET note=? WHERE id=?').run(String(b.note).slice(0, 200), p.id);
  if (b.maxBet !== undefined) db.prepare('UPDATE players SET max_bet=? WHERE id=?').run(won(b.maxBet), p.id);
  if (b.maxWin !== undefined) db.prepare('UPDATE players SET max_win=? WHERE id=?').run(won(b.maxWin), p.id);
  if (b.dailyLoss !== undefined) db.prepare('UPDATE players SET daily_loss=? WHERE id=?').run(won(b.dailyLoss), p.id);
  if (b.password) { db.prepare('UPDATE players SET pass_hash=? WHERE id=?').run(auth.hash(String(b.password)), p.id); db.prepare("DELETE FROM sessions WHERE kind='player' AND subject=?").run(p.id); }
  if (b.status === 'suspended') db.prepare("DELETE FROM sessions WHERE kind='player' AND subject=?").run(p.id);
  const { password, ...logged } = b;
  audit(req.admin.username, 'player.update', { id: p.id, username: p.username, ...logged, password: password ? '(변경)' : undefined });
  res.json({ ok: true });
});
A.post('/players/:id/adjust', (req, res) => {
  const amt = won(req.body && req.body.amount);
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!amt) return bad(res, 400, '조정 금액을 입력하세요.');
  if (!reason) return bad(res, 400, '조정 사유를 입력하세요.');
  try {
    res.json(tx(() => {
      const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
      if (!p) throw err(404, '플레이어를 찾을 수 없습니다.');
      const after = p.balance + amt;
      if (after < 0) throw err(400, '차감 후 잔액이 0원보다 작아집니다.');
      db.prepare('UPDATE players SET balance=? WHERE id=?').run(after, p.id);
      db.prepare("INSERT INTO tx(player_id,type,amount,balance_after,note,actor) VALUES(?,'adjust',?,?,?,?)").run(p.id, amt, after, reason.slice(0, 200), req.admin.username);
      audit(req.admin.username, 'player.adjust', { id: p.id, username: p.username, amount: amt, reason });
      return { balance: after };
    }));
  } catch (e) { if (e.code) return bad(res, e.code, e.message); throw e; }
});
A.get('/players/:id/tx', (req, res) => res.json(db.prepare('SELECT * FROM tx WHERE player_id=? ORDER BY id DESC LIMIT 200').all(req.params.id)));

A.get('/rounds', (req, res) => {
  const where = [], args = [];
  if (req.query.player) { where.push('p.username LIKE ?'); args.push(`%${req.query.player}%`); }
  if (req.query.game) { where.push('r.game_id=?'); args.push(req.query.game); }
  if (req.query.feature === '1') where.push('r.feature IS NOT NULL');
  if (req.query.capped === '1') where.push('r.raw_win > r.win');
  if (req.query.minWin) { where.push('r.win >= ?'); args.push(won(req.query.minWin)); }
  const before = Number(req.query.before) || 0;
  if (before) { where.push('r.id < ?'); args.push(before); }
  const rows = db.prepare(`SELECT r.id,r.player_id,p.username,r.game_id,r.bet,r.win,r.raw_win,r.balance_after,r.feature,r.variant,r.created_at
    FROM rounds r JOIN players p ON p.id=r.player_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 100`).all(...args);
  res.json(rows.map((r) => ({ ...r, game: gname(r.game_id) })));
});
A.get('/rounds/:id', (req, res) => {
  const r = db.prepare('SELECT r.*, p.username FROM rounds r JOIN players p ON p.id=r.player_id WHERE r.id=?').get(req.params.id);
  if (!r) return bad(res, 404, '회차를 찾을 수 없습니다.');
  const g = games[r.game_id];
  res.json({ ...r, result: JSON.parse(r.result), symbols: g ? g.symbols.map((s) => ({ id: s.id, name: s.name })) : [], lines: g ? g.lines : [], game: gname(r.game_id),
    variantLabel: g && r.variant && g.variants[r.variant] ? g.variants[r.variant].label : '' });
});

A.get('/games', (req, res) => {
  const life = db.prepare('SELECT game_id, COUNT(*) rounds, SUM(bet) bet, SUM(win) win FROM rounds GROUP BY game_id').all();
  res.json(db.prepare('SELECT id FROM games ORDER BY sort').all().map((x) => gameRow(x.id)).filter(Boolean).map((r) => {
    const g = games[r.id], l = life.find((x) => x.game_id === r.id) || { rounds: 0, bet: 0, win: 0 };
    return { id: r.id, name: g.name, layout: `${g.reels}×${g.rows} · ${g.lines.length}라인`, volatility: g.volatility,
      features: (g.features || []).map((f) => f.type), enabled: !!r.enabled, settings: r.s, variants: variantList(r.id), defaultBets: g.bets,
      theoretical: variant(r.id, r.s.variant).rtp, rounds: l.rounds, actual: l.bet ? l.win / l.bet : null, ggr: l.bet - l.win };
  }));
});
A.patch('/games/:id', (req, res) => {
  const row = gameRow(req.params.id);
  if (!row) return bad(res, 404, '게임을 찾을 수 없습니다.');
  const b = req.body || {}, s = { ...row.s }, g = games[row.id];
  if (b.bets !== undefined) {
    const bets = [...new Set((Array.isArray(b.bets) ? b.bets : String(b.bets).split(/[,\s]+/)).map(won).filter((x) => x > 0))].sort((x, y) => x - y);
    if (!bets.length) return bad(res, 400, '베팅 단계를 하나 이상 입력하세요.');
    if (bets.length > 20) return bad(res, 400, '베팅 단계는 20개까지 둘 수 있습니다.');
    if (bets.some((x) => x % g.lines.length)) return bad(res, 400, `베팅 금액은 라인 수(${g.lines.length})로 나누어떨어져야 합니다.`);
    s.bets = bets;
  }
  if (b.defaultBet !== undefined) s.defaultBet = won(b.defaultBet);
  if (!s.bets.includes(s.defaultBet)) s.defaultBet = s.bets[0];
  if (b.maxWin !== undefined) { if (won(b.maxWin) < 0) return bad(res, 400, '최대 당첨 금액은 0원 이상이어야 합니다.'); s.maxWin = won(b.maxWin); }
  if (b.maxWinX !== undefined) { if (won(b.maxWinX) < 0) return bad(res, 400, '최대 당첨 배수는 0 이상이어야 합니다.'); s.maxWinX = won(b.maxWinX); }
  if (b.variant !== undefined) { if (!g.variants[b.variant]) return bad(res, 400, '없는 RTP 버전입니다.'); s.variant = b.variant; }
  if (b.featuresOn !== undefined) s.featuresOn = !!b.featuresOn;
  if (b.maintenance !== undefined) s.maintenance = String(b.maintenance).slice(0, 120);
  const enabled = b.enabled === undefined ? row.enabled : b.enabled ? 1 : 0;
  db.prepare('UPDATE games SET enabled=?, settings=? WHERE id=?').run(enabled, JSON.stringify(s), row.id);
  audit(req.admin.username, 'game.update', { id: row.id, ...b });
  res.json({ ok: true, settings: s });
});
A.post('/games/:id/reset', (req, res) => {
  if (!gameRow(req.params.id)) return bad(res, 404, '게임을 찾을 수 없습니다.');
  db.prepare('UPDATE games SET settings=? WHERE id=?').run(JSON.stringify(defaults(req.params.id)), req.params.id);
  audit(req.admin.username, 'game.reset', { id: req.params.id });
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
// Always revalidate so a new deploy reaches browsers immediately (ETag keeps it cheap)
app.use(express.static(pub, { extensions: ['html'], maxAge: 0, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));
app.use((e, req, res, next) => { console.error(e); bad(res, 500, '서버 오류가 발생했습니다.'); });

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600e3).unref();
app.listen(PORT, () => console.log(`[boot] slot platform on :${PORT}`));
