import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate, one, all, q, tx } from './lib/db.js';
import { getSettings, cancelPolicyText, fillTerms } from './lib/settings.js';
import * as A from './lib/auth.js';
import * as P from './lib/points.js';
import * as B from './lib/booking.js';
import * as pay from './lib/pay/index.js';
import { adminRouter } from './lib/admin.js';
import { seedIfEmpty } from './lib/seed.js';
import { HttpError, ah, bad, today, addDays, str, int, bool, isEmail, fmtPhone, normPhone } from './lib/util.js';

const app = express();
const dir = path.dirname(fileURLToPath(import.meta.url));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});
app.use('/api/admin/images', express.raw({ type: ['image/*'], limit: '8mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(A.loadUser);

// CSRF 방지: 상태를 바꾸는 API 는 앱이 붙이는 헤더가 있어야 한다
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'stayon') return next(new HttpError(403, '잘못된 요청입니다.'));
  next();
});

const ip = req => req.ip || 'x';

/* ======================= 공개 데이터 ======================= */
async function meOf(user) {
  if (!user) return null;
  const pts = await tx(c => P.balance(c, user.id));
  const ids = await all(`SELECT provider FROM user_identities WHERE user_id=$1`, [user.id]);
  return { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role, profileDone: user.profile_done,
    marketing: user.marketing, points: pts, hasPassword: !!user.password_hash, providers: ids.map(r => r.provider), createdAt: user.created_at };
}

app.get('/api/bootstrap', ah(async (req, res) => {
  const s = await getSettings();
  const t = today();
  const [places, rooms, nights, banners] = await Promise.all([
    all(`SELECT p.id, p.name, p.type, p.grade, p.sido, p.area, p.address, p.phone, p.check_in, p.check_out, p.intro, p.notice,
                p.amenities, p.tags, p.photos, p.featured, p.sample, p.created_at,
                COALESCE(r.avg,0) AS rating, COALESCE(r.n,0) AS reviews
         FROM places p LEFT JOIN (SELECT place_id, AVG(rating)::float AS avg, COUNT(*) AS n FROM reviews WHERE NOT hidden GROUP BY place_id) r ON r.place_id=p.id
         WHERE p.active ORDER BY p.id`),
    all(`SELECT r.id, r.place_id, r.name, r.base, r.max, r.stock, r.price, r.weekend_price, r.list_price, r.descr, r.photos, r.sort
         FROM rooms r JOIN places p ON p.id=r.place_id WHERE r.active AND p.active ORDER BY r.sort, r.price`),
    all(`SELECT room_id, night, booked, closed, price FROM room_nights WHERE night >= $1 AND night < $2 AND (booked > 0 OR closed OR price IS NOT NULL)`, [t, addDays(t, 400)]),
    all(`SELECT id, title, sub, slot, image, link, bg, priority FROM banners WHERE active AND start_date <= $1 AND end_date >= $1 ORDER BY priority DESC, id DESC`, [t])
  ]);
  const pc = pay.publicConfig();
  const wish = req.user ? (await all(`SELECT place_id FROM wishes WHERE user_id=$1`, [req.user.id])).map(r => r.place_id) : [];
  res.json({
    today: t,
    settings: { brand: s.brand, color: s.color, phone: s.phone, adContact: s.adContact, email: s.email,
      payMethods: s.payMethods.filter(m => m !== 'card' || pc.ready), bank: s.bank, payDeadline: s.payDeadline, bankDeadlineHours: s.bankDeadlineHours,
      cancelPolicy: cancelPolicyText(s), points: s.points,
      company: s.company, ceo: s.ceo, bizNo: s.bizNo, saleNo: s.saleNo, address: s.address, privacyOfficer: s.privacyOfficer },
    pay: pc,
    login: { email: true, google: A.oauth.google.enabled(), kakao: A.oauth.kakao.enabled() },
    places, rooms, nights, banners, wish, me: await meOf(req.user)
  });
}));

app.get('/api/terms/:kind', ah(async (req, res) => {
  const s = await getSettings();
  const t = req.params.kind === 'privacy' ? s.termsPrivacy : s.termsService;
  res.json({ text: fillTerms(t, s) });
}));

app.get('/api/places/:id/reviews', ah(async (req, res) => {
  res.json(await all(`SELECT id, user_id = $2 AS mine, author, rating, text, room_name, reply, reply_at, created_at FROM reviews
                      WHERE place_id=$1 AND NOT hidden ORDER BY created_at DESC LIMIT 200`, [int(req.params.id), req.user ? req.user.id : -1]));
}));

app.get('/img/:id', ah(async (req, res) => {
  const r = await one(`SELECT mime, data FROM images WHERE id=$1`, [String(req.params.id)]);
  if (!r) return res.status(404).end();
  res.set({ 'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable' }).send(r.data);
}));

app.post('/api/ads/track', ah(async (req, res) => {
  const id = int(req.body.id), k = req.body.k === 'c' ? 'clk' : 'imp';
  if (req.user && req.user.role === 'admin') return res.json({ ok: true });
  if (!A.rateLimit('ad:' + ip(req), 300, 3600)) return res.json({ ok: true });
  await q(`INSERT INTO ad_stats(banner_id, day, ${k}) SELECT $1, $2, 1 WHERE EXISTS (SELECT 1 FROM banners WHERE id=$1)
           ON CONFLICT (banner_id, day) DO UPDATE SET ${k} = ad_stats.${k} + 1`, [id, today()]);
  res.json({ ok: true });
}));

/* ======================= 회원 ======================= */
function agreeCheck(b) {
  if (!bool(b.agreeTerms) || !bool(b.agreePrivacy) || !bool(b.agreeAge)) throw bad('필수 약관에 모두 동의해 주세요.');
}
async function signupBonus(c, uid) {
  const s = await getSettings();
  if (s.points.signupBonus > 0) await P.add(c, uid, s.points.signupBonus, 'signup', { memo: '회원가입 축하', expireDays: s.points.expireDays });
}

app.post('/api/auth/signup', ah(async (req, res) => {
  if (!A.rateLimit('signup:' + ip(req), int(process.env.SIGNUP_RATE_LIMIT, 10), 3600)) throw new HttpError(429, '잠시 후 다시 시도해 주세요.');
  const b = req.body, email = str(b.email, 120).toLowerCase(), name = str(b.name, 30), phone = fmtPhone(b.phone);
  if (!isEmail(email)) throw bad('이메일 형식을 확인해 주세요.');
  const pp = A.passwordProblem(b.password); if (pp) throw bad(pp);
  if (!name) throw bad('이름을 입력해 주세요.');
  if (normPhone(phone).length < 10) throw bad('휴대폰 번호를 확인해 주세요.');
  agreeCheck(b);
  if (await one(`SELECT 1 FROM users WHERE email=$1`, [email])) throw bad('이미 가입된 이메일입니다. 로그인해 주세요.');
  const user = await tx(async c => {
    const u = (await c.query(`INSERT INTO users(email,password_hash,name,phone,profile_done,marketing,terms_at) VALUES($1,$2,$3,$4,true,$5,now()) RETURNING *`,
      [email, A.hashPassword(b.password), name, phone, bool(b.marketing)])).rows[0];
    await signupBonus(c, u.id);
    return u;
  });
  await A.promoteIfAdmin(user);
  await A.login(res, req, user);
  res.json({ me: await meOf(user) });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  if (!A.rateLimit('login:' + ip(req), 20, 600)) throw new HttpError(429, '로그인 시도가 많습니다. 10분 뒤 다시 시도해 주세요.');
  const email = str(req.body.email, 120).toLowerCase();
  const u = await one(`SELECT * FROM users WHERE email=$1`, [email]);
  if (!u || !A.checkPassword(String(req.body.password || ''), u.password_hash)) throw bad('이메일 또는 비밀번호가 맞지 않습니다.');
  if (u.status === 'blocked') throw new HttpError(403, '이용이 제한된 계정입니다. 고객센터로 문의해 주세요.');
  if (u.status !== 'active') throw bad('이메일 또는 비밀번호가 맞지 않습니다.');
  await A.promoteIfAdmin(u);
  await A.login(res, req, u);
  res.json({ me: await meOf(u) });
}));

app.post('/api/auth/logout', (req, res) => { A.logout(res, req); res.json({ ok: true }); });

// 소셜 로그인 시작
app.get('/auth/:provider/start', (req, res) => {
  const pv = A.oauth[req.params.provider];
  if (!pv || !pv.enabled()) return res.redirect('/?login_error=' + encodeURIComponent('이 로그인 방식은 아직 준비 중입니다.'));
  const state = A.newState();
  const next = String(req.query.next || '/').startsWith('/') ? String(req.query.next || '/') : '/';
  A.setCookie(res, req, 'so_oauth', A.sign({ state, next, p: req.params.provider, exp: Math.floor(Date.now() / 1000) + 600 }), 600);
  res.redirect(pv.authUrl(`${A.baseUrl(req)}/auth/${req.params.provider}/callback`, state));
});

// 소셜 로그인 돌아옴
app.get('/auth/:provider/callback', ah(async (req, res) => {
  const provider = req.params.provider, pv = A.oauth[provider];
  const st = A.verify(A.parseCookies(req).so_oauth);
  A.setCookie(res, req, 'so_oauth', '', 0);
  const fail = m => res.redirect('/?login_error=' + encodeURIComponent(m));
  if (!pv || !st || st.p !== provider || st.state !== req.query.state) return fail('로그인 요청이 만료되었습니다. 다시 시도해 주세요.');
  if (req.query.error || !req.query.code) return fail('로그인을 취소했습니다.');
  let prof;
  try { prof = await pv.profile(String(req.query.code), `${A.baseUrl(req)}/auth/${provider}/callback`); }
  catch (e) { console.error('oauth', e.message); return fail('로그인 중 오류가 났습니다. 다시 시도해 주세요.'); }
  let user = await one(`SELECT u.* FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.provider=$1 AND i.provider_uid=$2`, [provider, prof.uid]);
  if (user && user.status === 'withdrawn') { await q(`DELETE FROM user_identities WHERE user_id=$1`, [user.id]); user = null; }
  if (!user) {
    const email = prof.email ? prof.email.toLowerCase() : null;
    const byEmail = email && prof.emailVerified ? await one(`SELECT * FROM users WHERE email=$1 AND status='active'`, [email]) : null;
    user = await tx(async c => {
      let u = byEmail;
      if (!u) u = (await c.query(`INSERT INTO users(email,name,profile_done) VALUES($1,$2,false) RETURNING *`,
        [email && !(await c.query(`SELECT 1 FROM users WHERE email=$1`, [email])).rows.length ? email : null, str(prof.name, 30)])).rows[0];
      await c.query(`INSERT INTO user_identities(provider, provider_uid, user_id, email) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [provider, prof.uid, u.id, email]);
      return u;
    });
  }
  if (user.status === 'blocked') return fail('이용이 제한된 계정입니다.');
  await A.promoteIfAdmin(user);
  await A.login(res, req, user);
  res.redirect(user.profile_done ? (st.next || '/') : '/?complete=1');
}));

// 소셜 가입 마무리: 휴대폰·약관
app.post('/api/me/complete', A.requireLogin, ah(async (req, res) => {
  const b = req.body, name = str(b.name, 30), phone = fmtPhone(b.phone);
  if (!name) throw bad('이름을 입력해 주세요.');
  if (normPhone(phone).length < 10) throw bad('휴대폰 번호를 확인해 주세요.');
  agreeCheck(b);
  const first = !req.user.profile_done;
  await tx(async c => {
    await c.query(`UPDATE users SET name=$2, phone=$3, marketing=$4, profile_done=true, terms_at=COALESCE(terms_at, now()) WHERE id=$1`, [req.user.id, name, phone, bool(b.marketing)]);
    if (first) await signupBonus(c, req.user.id);
  });
  res.json({ me: await meOf(await one(`SELECT * FROM users WHERE id=$1`, [req.user.id])) });
}));

app.get('/api/me', ah(async (req, res) => res.json({ me: await meOf(req.user) })));

app.patch('/api/me', A.requireUser, ah(async (req, res) => {
  const name = str(req.body.name, 30), phone = fmtPhone(req.body.phone);
  if (!name) throw bad('이름을 입력해 주세요.');
  if (normPhone(phone).length < 10) throw bad('휴대폰 번호를 확인해 주세요.');
  await q(`UPDATE users SET name=$2, phone=$3, marketing=$4 WHERE id=$1`, [req.user.id, name, phone, bool(req.body.marketing)]);
  res.json({ me: await meOf(await one(`SELECT * FROM users WHERE id=$1`, [req.user.id])) });
}));

app.post('/api/me/password', A.requireUser, ah(async (req, res) => {
  const u = req.user;
  if (u.password_hash && !A.checkPassword(String(req.body.current || ''), u.password_hash)) throw bad('현재 비밀번호가 맞지 않습니다.');
  if (!u.email) throw bad('이메일이 없는 계정은 비밀번호를 만들 수 없습니다.');
  const pp = A.passwordProblem(req.body.next); if (pp) throw bad(pp);
  const nu = (await q(`UPDATE users SET password_hash=$2, token_ver=token_ver+1 WHERE id=$1 RETURNING *`, [u.id, A.hashPassword(req.body.next)])).rows[0];
  await A.login(res, req, nu);
  res.json({ ok: true });
}));

app.post('/api/me/withdraw', A.requireLogin, ah(async (req, res) => {
  const u = req.user;
  const active = await one(`SELECT COUNT(*) AS n FROM bookings WHERE user_id=$1 AND status IN ('pending','wait','ok')`, [u.id]);
  if (active.n > 0) throw bad('진행 중인 예약이 있어 탈퇴할 수 없습니다. 예약을 취소하거나 이용 완료 후 탈퇴해 주세요.');
  if (u.password_hash && !A.checkPassword(String(req.body.password || ''), u.password_hash)) throw bad('비밀번호가 맞지 않습니다.');
  await tx(async c => {
    const bal = await P.balance(c, u.id);
    if (bal > 0) await P.take(c, u.id, bal, 'expire', { memo: '회원 탈퇴', strict: false });
    await c.query(`DELETE FROM user_identities WHERE user_id=$1`, [u.id]);
    await c.query(`DELETE FROM wishes WHERE user_id=$1`, [u.id]);
    await c.query(`UPDATE users SET status='withdrawn', email=NULL, password_hash=NULL, name='탈퇴회원', phone='', marketing=false, token_ver=token_ver+1 WHERE id=$1`, [u.id]);
  });
  A.logout(res, req);
  res.json({ ok: true });
}));

app.get('/api/me/points', A.requireUser, ah(async (req, res) => {
  const bal = await tx(c => P.balance(c, req.user.id));
  const soon = await one(`SELECT COALESCE(SUM(remaining),0) AS n FROM point_tx WHERE user_id=$1 AND remaining > 0 AND expires_at < now() + interval '30 days'`, [req.user.id]);
  const list = await all(`SELECT id, amount, kind, memo, expires_at, created_at FROM point_tx WHERE user_id=$1 ORDER BY id DESC LIMIT 200`, [req.user.id]);
  res.json({ balance: bal, expiringSoon: soon.n, list });
}));

app.post('/api/me/wish/:placeId', A.requireUser, ah(async (req, res) => {
  const pid = int(req.params.placeId);
  const had = await one(`DELETE FROM wishes WHERE user_id=$1 AND place_id=$2 RETURNING 1`, [req.user.id, pid]);
  if (!had) await q(`INSERT INTO wishes(user_id, place_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [req.user.id, pid]);
  res.json({ on: !had });
}));

/* ======================= 예약·결제 ======================= */
const bookingOut = async (b) => {
  const pays = await all(`SELECT order_id, provider, method, amount, status, cancelled_amount, receipt_url, paid_at FROM payments WHERE booking_id=$1 ORDER BY id`, [b.id]);
  const review = await one(`SELECT id, rating FROM reviews WHERE booking_id=$1`, [b.id]);
  return { ...b, payments: pays, review };
};

app.get('/api/me/bookings', A.requireUser, ah(async (req, res) => {
  res.json(await all(`SELECT b.*, EXISTS(SELECT 1 FROM reviews r WHERE r.booking_id=b.id) AS reviewed FROM bookings b WHERE user_id=$1 ORDER BY id DESC LIMIT 300`, [req.user.id]));
}));

app.get('/api/me/bookings/:code', A.requireUser, ah(async (req, res) => {
  const b = await one(`SELECT * FROM bookings WHERE code=$1 AND user_id=$2`, [req.params.code, req.user.id]);
  if (!b) throw new HttpError(404, '예약을 찾을 수 없습니다.');
  res.json(await bookingOut(b));
}));

app.get('/api/me/bookings/:code/cancel-preview', A.requireUser, ah(async (req, res) => {
  const b = await one(`SELECT * FROM bookings WHERE code=$1 AND user_id=$2`, [req.params.code, req.user.id]);
  if (!b) throw new HttpError(404, '예약을 찾을 수 없습니다.');
  res.json(await tx(c => B.cancelPreview(c, b)));
}));

app.post('/api/me/bookings/:code/cancel', A.requireUser, ah(async (req, res) => {
  const b = await one(`SELECT id FROM bookings WHERE code=$1 AND user_id=$2`, [req.params.code, req.user.id]);
  if (!b) throw new HttpError(404, '예약을 찾을 수 없습니다.');
  const nb = await B.cancelBooking(b.id, { userId: req.user.id, by: 'guest', reason: str(req.body.reason, 200) || '고객 취소', mode: 'policy' });
  res.json(await bookingOut(nb));
}));

app.post('/api/bookings', A.requireUser, ah(async (req, res) => {
  if (!A.rateLimit('book:' + req.user.id, 20, 600)) throw new HttpError(429, '잠시 후 다시 시도해 주세요.');
  const { booking, payment } = await B.createBooking(req.user, req.body);
  const pc = pay.publicConfig();
  res.json({ booking, payment: payment && payment.method === 'card' ? {
    orderId: payment.order_id, amount: payment.amount, orderName: `${booking.place_name} ${booking.room_name}`.slice(0, 100),
    provider: payment.provider, clientKey: pc.clientKey, customerKey: 'u' + String(req.user.id).padStart(6, '0') + crypto.createHash('sha256').update(String(req.user.id) + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 10),
    customerName: booking.guest_name, customerEmail: req.user.email || undefined, holdUntil: booking.hold_until } : null });
}));

app.post('/api/payments/confirm', A.requireUser, ah(async (req, res) => {
  const r = await B.confirmPayment(req.user, req.body);
  if (!r.ok) return res.status(402).json({ error: r.message });
  res.json({ booking: r.booking });
}));

app.post('/api/payments/fail', A.requireUser, ah(async (req, res) => {
  await B.failPayment(req.user, req.body.orderId, req.body.message);
  res.json({ ok: true });
}));

/* ======================= 후기 ======================= */
app.post('/api/reviews', A.requireUser, ah(async (req, res) => {
  const b = await one(`SELECT * FROM bookings WHERE code=$1 AND user_id=$2`, [str(req.body.code, 40), req.user.id]);
  if (!b) throw bad('예약을 찾을 수 없습니다.');
  if (b.status !== 'done') throw bad('이용을 마친 예약에만 후기를 쓸 수 있습니다.');
  const rating = int(req.body.rating), text = str(req.body.text, 1000);
  if (rating < 1 || rating > 5) throw bad('별점을 선택해 주세요.');
  if (text.length < 10) throw bad('후기를 10자 이상 써주세요.');
  const s = await getSettings();
  const author = req.user.name ? req.user.name.slice(0, 1) + '*'.repeat(Math.max(1, req.user.name.length - 1)) : '회원';
  await tx(async c => {
    const ex = (await c.query(`SELECT 1 FROM reviews WHERE booking_id=$1`, [b.id])).rows.length;
    if (ex) throw bad('이미 후기를 작성한 예약입니다.');
    await c.query(`INSERT INTO reviews(booking_id,user_id,place_id,room_name,author,rating,text) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [b.id, req.user.id, b.place_id, b.room_name, author, rating, text]);
    if (s.points.reviewBonus > 0) await P.add(c, req.user.id, s.points.reviewBonus, 'earn', { bookingId: b.id, memo: '후기 작성 적립', expireDays: s.points.expireDays });
  });
  res.json({ ok: true, bonus: s.points.reviewBonus });
}));

app.delete('/api/reviews/:id', A.requireUser, ah(async (req, res) => {
  const r = await one(`DELETE FROM reviews WHERE id=$1 AND user_id=$2 RETURNING id`, [int(req.params.id), req.user.id]);
  if (!r) throw bad('후기를 찾을 수 없습니다.');
  res.json({ ok: true });
}));

/* ======================= 관리자 ======================= */
app.use('/api/admin', A.requireAdmin, adminRouter);

/* ======================= 화면 ======================= */
app.use(express.static(path.join(dir, 'public'), { maxAge: '1h', index: false }));
app.get('/healthz', (req, res) => res.send('ok'));
app.get(/^\/(?!api\/|img\/|auth\/).*/, (req, res) => res.sendFile(path.join(dir, 'public', 'index.html')));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' : err.message, code: err.code });
});

const port = process.env.PORT || 3000;
await migrate();
await seedIfEmpty();
setInterval(() => B.sweep().catch(e => console.error('sweep', e)), 60_000).unref();
B.sweep().catch(e => console.error('sweep', e));
app.listen(port, () => console.log(`스테이온 서버 시작: http://localhost:${port} · 결제 ${pay.current().name}`));
