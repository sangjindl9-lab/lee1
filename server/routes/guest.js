import express from 'express';
import { z } from 'zod';
import { q, one, many, tx } from '../db.js';
import { requireAuth, endAllSessions, clearSessionCookie } from '../auth.js';
import { wrap, parse, notFound, forbidden, bad, HttpError, bookingCode, audit, todayKST } from '../util.js';
import { quote } from '../pricing.js';
import { CARD_COLS } from './public.js';
import { config } from '../config.js';

export const guestRouter = express.Router();
guestRouter.use('/api/me', requireAuth);
guestRouter.use(['/api/wishlist', '/api/bookings'], requireAuth);

const phoneRe = /^01[016789]-?\d{3,4}-?\d{4}$/;
const clean = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

/* ---------- 내 정보 ---------- */
guestRouter.put('/api/me', wrap(async (req, res) => {
  const b = parse(z.object({
    name: z.string().transform(clean).pipe(z.string().min(1, '이름을 입력해 주세요.').max(30, '이름은 30자 이하로 입력해 주세요.')),
    phone: z.string().regex(phoneRe, '휴대폰 번호 형식을 확인해 주세요.').optional().or(z.literal('')),
    bio: z.string().transform(clean).pipe(z.string().max(500)).optional(),
  }), req.body);
  await q('UPDATE users SET name=$2, phone=COALESCE(NULLIF($3,\'\'),phone), bio=COALESCE($4,bio) WHERE id=$1',
    [req.user.id, b.name, b.phone ?? '', b.bio ?? null]);
  res.json({ ok: true });
}));

guestRouter.post('/api/me/become-host', wrap(async (req, res) => {
  const b = parse(z.object({ phone: z.string().regex(phoneRe, '휴대폰 번호 형식을 확인해 주세요.'), agree: z.literal(true, { errorMap: () => ({ message: '호스트 이용약관에 동의해 주세요.' }) }) }), req.body);
  await q(`UPDATE users SET phone=$2, host_agreed_at=now(), role=CASE WHEN role='guest' THEN 'host' ELSE role END WHERE id=$1`, [req.user.id, b.phone]);
  await audit(req, 'become_host', req.user.id);
  res.json({ ok: true });
}));

// 회원 탈퇴: 진행 중인 예약이 있으면 막고, 개인정보는 즉시 지우되 거래 기록은 법정 보관을 위해 익명으로 남김
guestRouter.delete('/api/me', wrap(async (req, res) => {
  const uid = req.user.id;
  const active = await one(`SELECT count(*)::int n FROM bookings b JOIN listings l ON l.id=b.listing_id
    WHERE (b.guest_id=$1 OR l.host_id=$1) AND b.status IN ('requested','confirmed') AND b.check_out >= $2::date`, [uid, todayKST()]);
  if (active.n) throw bad('진행 중이거나 예정된 예약이 있어 탈퇴할 수 없어요. 예약을 마치거나 취소한 뒤 다시 시도해 주세요.');
  await tx(async c => {
    await c.query(`UPDATE users SET name='탈퇴한 회원', email=NULL, phone=NULL, avatar_url=NULL, bio='', status='withdrawn',
      provider_id='withdrawn:'||id::text WHERE id=$1`, [uid]);
    await c.query(`UPDATE listings SET status='suspended' WHERE host_id=$1`, [uid]);
    await c.query(`DELETE FROM wishlists WHERE user_id=$1`, [uid]);
  });
  await audit(req, 'withdraw', uid);
  await endAllSessions(uid);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

/* ---------- 위시리스트 ---------- */
guestRouter.get('/api/wishlist', wrap(async (req, res) => {
  const rows = await many(`SELECT ${CARD_COLS}, true liked FROM wishlists w JOIN listings l ON l.id=w.listing_id
    WHERE w.user_id=$1 AND l.status='approved' ORDER BY w.created_at DESC LIMIT 200`, [req.user.id]);
  res.json({ items: rows });
}));
guestRouter.post('/api/wishlist/:id', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const l = await one(`SELECT id FROM listings WHERE id=$1 AND status='approved'`, [id]);
  if (!l) throw notFound();
  await q('INSERT INTO wishlists(user_id, listing_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, id]);
  res.json({ ok: true });
}));
guestRouter.delete('/api/wishlist/:id', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  await q('DELETE FROM wishlists WHERE user_id=$1 AND listing_id=$2', [req.user.id, id]);
  res.json({ ok: true });
}));

/* ---------- 예약 ---------- */
const BOOK_VIEW = `b.id, b.code, b.listing_id, b.check_in, b.check_out, b.guests, b.nightly, b.nights, b.cleaning_fee, b.service_fee, b.total,
  b.status, b.payment_status, b.message, b.decline_reason, b.cancelled_by, b.created_at, b.decided_at,
  l.title, l.region, l.area, l.checkin_time, l.checkout_time,
  (SELECT id FROM listing_photos p WHERE p.listing_id=l.id ORDER BY sort, id LIMIT 1) cover,
  h.name host_name, h.avatar_url host_avatar,
  EXISTS(SELECT 1 FROM reviews r WHERE r.booking_id=b.id) reviewed`;

guestRouter.post('/api/bookings', wrap(async (req, res) => {
  const b = parse(z.object({
    listingId: z.number().int().positive(), checkIn: z.string(), checkOut: z.string(),
    guests: z.number().int().min(1).max(30), message: z.string().transform(clean).pipe(z.string().max(1000)).optional(),
  }), req.body);
  if (!req.user.phone) throw bad('예약하려면 내 정보에서 휴대폰 번호를 먼저 등록해 주세요.', 'PHONE_REQUIRED');
  const l = await one(`SELECT * FROM listings WHERE id=$1 AND status='approved'`, [b.listingId]);
  if (!l) throw notFound('예약할 수 없는 숙소예요.');
  if (l.host_id === req.user.id) throw bad('내 숙소는 예약할 수 없어요.');
  const qt = quote(l, b.checkIn, b.checkOut, b.guests);
  const status = l.instant_book ? 'confirmed' : 'requested';
  try {
    const row = await tx(async c => {
      await c.query('SELECT id FROM listings WHERE id=$1 FOR UPDATE', [l.id]);
      const blk = await c.query('SELECT 1 FROM blocked_dates WHERE listing_id=$1 AND day>=$2::date AND day<$3::date LIMIT 1', [l.id, b.checkIn, b.checkOut]);
      if (blk.rowCount) throw new HttpError(409, '선택한 날짜에 이미 예약이 있어요. 다른 날짜를 골라 주세요.', 'UNAVAILABLE');
      const r = await c.query(`INSERT INTO bookings(code,listing_id,guest_id,check_in,check_out,guests,nightly,nights,cleaning_fee,service_fee,total,host_fee,host_payout,status,message,decided_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CASE WHEN $14='confirmed' THEN now() END) RETURNING id, code, status`,
        [bookingCode(), l.id, req.user.id, b.checkIn, b.checkOut, b.guests, qt.nightly, qt.nights, qt.cleaningFee, qt.serviceFee, qt.total,
          qt.hostFee, qt.hostPayout, status, b.message || '']);
      if (b.message) await c.query('INSERT INTO messages(booking_id, sender_id, body) VALUES ($1,$2,$3)', [r.rows[0].id, req.user.id, b.message]);
      return r.rows[0];
    });
    await audit(req, 'booking_create', row.id, { listing: l.id, total: qt.total, status });
    res.status(201).json(row);
  } catch (e) {
    if (e.code === '23P01') throw new HttpError(409, '방금 다른 게스트가 같은 날짜를 예약했어요. 다른 날짜를 골라 주세요.', 'UNAVAILABLE');
    throw e;
  }
}));

guestRouter.get('/api/bookings', wrap(async (req, res) => {
  const rows = await many(`SELECT ${BOOK_VIEW} FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users h ON h.id=l.host_id
    WHERE b.guest_id=$1 ORDER BY b.check_in DESC LIMIT 200`, [req.user.id]);
  res.json({ items: rows });
}));

async function loadBookingFor(req, id) {
  const b = await one(`SELECT b.*, l.host_id, l.title, l.address FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE b.id=$1`, [id]);
  if (!b) throw notFound('예약을 찾을 수 없어요.');
  const isGuest = b.guest_id === req.user.id, isHost = b.host_id === req.user.id, isAdmin = req.user.role === 'admin';
  if (!isGuest && !isHost && !isAdmin) throw notFound('예약을 찾을 수 없어요.');
  return { b, isGuest, isHost, isAdmin };
}

guestRouter.get('/api/bookings/:id', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { b, isHost, isAdmin } = await loadBookingFor(req, id);
  const v = await one(`SELECT ${BOOK_VIEW}, g.name guest_name, g.avatar_url guest_avatar,
      CASE WHEN b.status='confirmed' OR b.status='completed' THEN g.phone END guest_phone,
      CASE WHEN b.status='confirmed' OR b.status='completed' THEN h.phone END host_phone,
      CASE WHEN b.status IN ('confirmed','completed') THEN l.address END address,
      b.host_fee, b.host_payout
    FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users h ON h.id=l.host_id JOIN users g ON g.id=b.guest_id WHERE b.id=$1`, [id]);
  if (!isHost && !isAdmin) { delete v.host_fee; delete v.host_payout; delete v.guest_phone; }
  if (isHost && !isAdmin) delete v.host_phone;
  res.json({ ...v, role: isHost ? 'host' : isAdmin && !(b.guest_id === req.user.id) ? 'admin' : 'guest' });
}));

guestRouter.post('/api/bookings/:id/cancel', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { reason } = parse(z.object({ reason: z.string().transform(clean).pipe(z.string().max(300)).optional() }), req.body || {});
  const { b, isGuest, isHost } = await loadBookingFor(req, id);
  if (!isGuest && !isHost) throw forbidden();
  if (!['requested', 'confirmed'].includes(b.status)) throw bad('이미 처리된 예약이에요.');
  if (b.check_in <= todayKST()) throw bad('체크인 당일 이후에는 화면에서 취소할 수 없어요. 고객센터로 문의해 주세요.');
  const r = await q(`UPDATE bookings SET status='cancelled', cancelled_by=$2, cancelled_at=now(), decline_reason=$3
    WHERE id=$1 AND status IN ('requested','confirmed') RETURNING id`, [id, isGuest ? 'guest' : 'host', reason || null]);
  if (!r.rowCount) throw bad('이미 처리된 예약이에요.');
  await audit(req, 'booking_cancel', id, { by: isGuest ? 'guest' : 'host' });
  res.json({ ok: true });
}));

/* ---------- 메시지 (예약 당사자끼리만) ---------- */
guestRouter.get('/api/bookings/:id/messages', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  await loadBookingFor(req, id);
  const rows = await many(`SELECT m.id, m.body, m.created_at, m.sender_id, u.name, u.avatar_url avatar FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.booking_id=$1 ORDER BY m.id LIMIT 500`, [id]);
  res.json({ items: rows.map(r => ({ ...r, mine: r.sender_id === req.user.id })) });
}));
guestRouter.post('/api/bookings/:id/messages', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { body } = parse(z.object({ body: z.string().transform(clean).pipe(z.string().min(1, '메시지를 입력해 주세요.').max(1000)) }), req.body);
  const { isGuest, isHost } = await loadBookingFor(req, id);
  if (!isGuest && !isHost) throw forbidden('관리자는 대화에 참여할 수 없어요.');
  const r = await one('INSERT INTO messages(booking_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, created_at', [id, req.user.id, body]);
  res.status(201).json(r);
}));

/* ---------- 후기 (숙박을 마친 게스트만, 예약당 1회) ---------- */
guestRouter.post('/api/bookings/:id/review', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const s = z.number().int().min(1).max(5);
  const r = parse(z.object({ rating: s, cleanliness: s, accuracy: s, location: s,
    body: z.string().transform(clean).pipe(z.string().min(10, '후기는 10자 이상 적어 주세요.').max(2000)) }), req.body);
  const { b, isGuest } = await loadBookingFor(req, id);
  if (!isGuest) throw forbidden();
  if (!(b.status === 'completed' || (b.status === 'confirmed' && b.check_out <= todayKST()))) throw bad('숙박을 마친 뒤에 후기를 남길 수 있어요.');
  try {
    await q(`INSERT INTO reviews(booking_id, listing_id, guest_id, rating, cleanliness, accuracy, location, body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, b.listing_id, req.user.id, r.rating, r.cleanliness, r.accuracy, r.location, r.body]);
  } catch (e) { if (e.code === '23505') throw bad('이미 후기를 남겼어요.'); throw e; }
  res.status(201).json({ ok: true });
}));

export { loadBookingFor };
