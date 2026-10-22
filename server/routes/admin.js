import express from 'express';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { requireRole, endAllSessions } from '../auth.js';
import { wrap, parse, notFound, bad, audit, todayKST } from '../util.js';

export const adminRouter = express.Router();
adminRouter.use('/api/admin', requireRole('admin'));
const clean = s => String(s).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
const idp = req => parse(z.coerce.number().int().positive(), req.params.id);

adminRouter.get('/api/admin/stats', wrap(async (req, res) => {
  const t = todayKST();
  const s = await one(`SELECT
    (SELECT count(*)::int FROM users WHERE status<>'withdrawn') users,
    (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') users_7d,
    (SELECT count(*)::int FROM users WHERE role='host' AND status='active') hosts,
    (SELECT count(*)::int FROM listings WHERE status='approved') live,
    (SELECT count(*)::int FROM listings WHERE status='pending') pending,
    (SELECT count(*)::int FROM bookings WHERE status='requested') requests,
    (SELECT count(*)::int FROM bookings WHERE created_at > now() - interval '30 days') bookings_30d,
    (SELECT COALESCE(sum(total),0)::bigint FROM bookings WHERE status IN ('confirmed','completed') AND date_trunc('month',check_in)=date_trunc('month',$1::date)) gmv_month,
    (SELECT COALESCE(sum(service_fee+host_fee),0)::bigint FROM bookings WHERE status IN ('confirmed','completed') AND date_trunc('month',check_in)=date_trunc('month',$1::date)) revenue_month`, [t]);
  const daily = await many(`SELECT to_char(d,'MM-DD') d, (SELECT count(*)::int FROM bookings b WHERE b.created_at::date=d) n
    FROM generate_series($1::date - 13, $1::date, '1 day') d ORDER BY d`, [t]);
  res.json({ ...s, daily });
}));

/* 숙소 심사 */
adminRouter.get('/api/admin/listings', wrap(async (req, res) => {
  const { status, q: s } = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'suspended', 'draft', 'all']).default('pending'), q: z.string().max(40).optional() }), req.query);
  const p = [];
  let w = status === 'all' ? 'true' : (p.push(status), 'l.status=$1');
  if (s) { p.push('%' + s.replace(/[%_\\]/g, '\\$&') + '%'); w += ` AND (l.title ILIKE $${p.length} OR u.name ILIKE $${p.length})`; }
  const rows = await many(`SELECT l.id, l.title, l.region, l.area, l.address, l.price, l.status, l.reject_reason, l.updated_at, l.created_at, l.category,
      u.id host_id, u.name host_name, u.email host_email, u.phone host_phone,
      (SELECT id FROM listing_photos p WHERE p.listing_id=l.id ORDER BY sort, id LIMIT 1) cover,
      (SELECT count(*)::int FROM listing_photos p WHERE p.listing_id=l.id) photo_count
    FROM listings l JOIN users u ON u.id=l.host_id WHERE ${w} ORDER BY l.updated_at DESC LIMIT 200`, p);
  res.json({ items: rows });
}));

adminRouter.post('/api/admin/listings/:id/:action', wrap(async (req, res) => {
  const id = idp(req);
  const action = parse(z.enum(['approve', 'reject', 'suspend']), req.params.action);
  const { reason } = parse(z.object({ reason: z.string().transform(clean).pipe(z.string().max(500)).optional() }), req.body || {});
  if (action !== 'approve' && !reason) throw bad('사유를 입력해 주세요. 호스트에게 그대로 보여요.');
  const l = await one('SELECT id, status FROM listings WHERE id=$1', [id]);
  if (!l) throw notFound();
  if (action === 'approve') {
    const n = await one('SELECT count(*)::int n FROM listing_photos WHERE listing_id=$1', [id]);
    if (n.n < 3) throw bad('사진이 3장 미만인 숙소는 승인할 수 없어요.');
  }
  const status = { approve: 'approved', reject: 'rejected', suspend: 'suspended' }[action];
  await q('UPDATE listings SET status=$2, reject_reason=$3, updated_at=now() WHERE id=$1', [id, status, action === 'approve' ? null : reason]);
  await audit(req, 'admin_listing_' + action, id, { from: l.status, reason });
  res.json({ ok: true });
}));

/* 회원 */
adminRouter.get('/api/admin/users', wrap(async (req, res) => {
  const { q: s, role } = parse(z.object({ q: z.string().max(60).optional(), role: z.enum(['guest', 'host', 'admin', 'all']).default('all') }), req.query);
  const p = [], w = [`status<>'withdrawn'`];
  if (role !== 'all') { p.push(role); w.push(`role=$${p.length}`); }
  if (s) { p.push('%' + s.replace(/[%_\\]/g, '\\$&') + '%'); w.push(`(name ILIKE $${p.length} OR email ILIKE $${p.length} OR phone ILIKE $${p.length})`); }
  const rows = await many(`SELECT id, name, email, phone, provider, role, status, created_at, last_login_at,
      (SELECT count(*)::int FROM bookings b WHERE b.guest_id=users.id) bookings,
      (SELECT count(*)::int FROM listings l WHERE l.host_id=users.id) listings
    FROM users WHERE ${w.join(' AND ')} ORDER BY created_at DESC LIMIT 300`, p);
  res.json({ items: rows });
}));

adminRouter.put('/api/admin/users/:id', wrap(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const b = parse(z.object({ role: z.enum(['guest', 'host', 'admin']).optional(), status: z.enum(['active', 'suspended']).optional(),
    reason: z.string().transform(clean).pipe(z.string().max(300)).optional() }), req.body);
  if (id === req.user.id) throw bad('내 계정의 권한이나 상태는 바꿀 수 없어요.');
  const u = await one(`SELECT id, role, status FROM users WHERE id=$1 AND status<>'withdrawn'`, [id]);
  if (!u) throw notFound();
  await q('UPDATE users SET role=COALESCE($2,role), status=COALESCE($3,status) WHERE id=$1', [id, b.role || null, b.status || null]);
  if (b.status === 'suspended') {
    await endAllSessions(id);
    await q(`UPDATE listings SET status='suspended', reject_reason='계정 이용 정지' WHERE host_id=$1 AND status IN ('approved','pending')`, [id]);
  }
  await audit(req, 'admin_user_update', id, { from: { role: u.role, status: u.status }, to: b });
  res.json({ ok: true });
}));

/* 예약 */
adminRouter.get('/api/admin/bookings', wrap(async (req, res) => {
  const { status, q: s } = parse(z.object({ status: z.enum(['requested', 'confirmed', 'completed', 'cancelled', 'declined', 'expired', 'all']).default('all'), q: z.string().max(40).optional() }), req.query);
  const p = [], w = ['true'];
  if (status !== 'all') { p.push(status); w.push(`b.status=$${p.length}`); }
  if (s) { p.push('%' + s.replace(/[%_\\]/g, '\\$&') + '%'); w.push(`(b.code ILIKE $${p.length} OR l.title ILIKE $${p.length} OR g.name ILIKE $${p.length})`); }
  const rows = await many(`SELECT b.id, b.code, b.check_in, b.check_out, b.guests, b.total, b.service_fee, b.host_fee, b.host_payout, b.status, b.payment_status, b.created_at,
      l.id listing_id, l.title, g.name guest_name, h.name host_name
    FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users g ON g.id=b.guest_id JOIN users h ON h.id=l.host_id
    WHERE ${w.join(' AND ')} ORDER BY b.id DESC LIMIT 300`, p);
  res.json({ items: rows });
}));

adminRouter.post('/api/admin/bookings/:id/cancel', wrap(async (req, res) => {
  const id = idp(req);
  const { reason } = parse(z.object({ reason: z.string().transform(clean).pipe(z.string().min(2, '취소 사유를 입력해 주세요.').max(300)) }), req.body || {});
  const r = await q(`UPDATE bookings SET status='cancelled', cancelled_by='admin', cancelled_at=now(), decline_reason=$2 WHERE id=$1 AND status IN ('requested','confirmed') RETURNING id`, [id, reason]);
  if (!r.rowCount) throw bad('취소할 수 있는 상태가 아니에요.');
  await audit(req, 'admin_booking_cancel', id, { reason });
  res.json({ ok: true });
}));

/* 후기 숨김 */
adminRouter.post('/api/admin/reviews/:id/hide', wrap(async (req, res) => {
  const id = idp(req);
  const { hidden } = parse(z.object({ hidden: z.boolean() }), req.body);
  await q('UPDATE reviews SET hidden=$2 WHERE id=$1', [id, hidden]);
  await audit(req, 'admin_review_hide', id, { hidden });
  res.json({ ok: true });
}));

adminRouter.get('/api/admin/audit', wrap(async (req, res) => {
  const rows = await many(`SELECT a.id, a.action, a.target, a.meta, a.ip, a.created_at, u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
    ORDER BY a.id DESC LIMIT 300`);
  res.json({ items: rows });
}));
