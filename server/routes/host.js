import express from 'express';
import { z } from 'zod';
import { q, one, many, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { wrap, parse, notFound, bad, audit, todayKST, isDate, HttpError } from '../util.js';
import { upload, processPhoto } from '../photos.js';
import { REGIONS, CATEGORIES, AMENITIES, REGION_COORDS } from '../config.js';

export const hostRouter = express.Router();
hostRouter.use('/api/host', requireRole('host', 'admin'));

const clean = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const txt = (min, max, msg) => z.string().transform(clean).pipe(z.string().min(min, msg).max(max));
const int = (a, b) => z.coerce.number().int().min(a).max(b);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시간은 15:00 형식으로 입력해 주세요.');

const listingSchema = z.object({
  title: txt(4, 60, '숙소 이름은 4자 이상 입력해 주세요.'),
  description: txt(0, 4000),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: '숙소 유형을 골라 주세요.' }) }),
  region: z.enum(REGIONS, { errorMap: () => ({ message: '지역을 골라 주세요.' }) }),
  area: txt(2, 60, '공개 지역(시·군·구, 동)을 입력해 주세요.'),
  address: txt(0, 200),
  price: int(10000, 10000000),
  cleaningFee: int(0, 1000000),
  maxGuests: int(1, 30), bedrooms: int(0, 30), beds: int(0, 50), baths: int(0, 30),
  amenities: z.array(z.enum(AMENITIES)).max(AMENITIES.length),
  rules: txt(0, 2000),
  checkinTime: time, checkoutTime: time,
  minNights: int(1, 30),
  instantBook: z.boolean(),
});
const CONTENT_FIELDS = ['title', 'description', 'category', 'region', 'area', 'address'];

async function ownListing(req, id, lock) {
  const l = await one(`SELECT * FROM listings WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!l || (l.host_id !== req.user.id && req.user.role !== 'admin')) throw notFound('숙소를 찾을 수 없어요.');
  return l;
}
const idParam = req => parse(z.coerce.number().int().positive(), req.params.id);

/* ---------- 요약 ---------- */
hostRouter.get('/api/host/summary', wrap(async (req, res) => {
  const t = todayKST();
  const s = await one(`SELECT
      (SELECT count(*)::int FROM listings WHERE host_id=$1) listings,
      (SELECT count(*)::int FROM listings WHERE host_id=$1 AND status='approved') live,
      (SELECT count(*)::int FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE l.host_id=$1 AND b.status='requested') requests,
      (SELECT count(*)::int FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE l.host_id=$1 AND b.status='confirmed' AND b.check_in>=$2::date) upcoming,
      (SELECT COALESCE(sum(host_payout),0)::bigint FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE l.host_id=$1 AND b.status IN ('confirmed','completed')
        AND date_trunc('month', b.check_in)=date_trunc('month', $2::date)) month_payout,
      (SELECT COALESCE(sum(host_payout),0)::bigint FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE l.host_id=$1 AND b.status='completed') total_payout`,
    [req.user.id, t]);
  const months = await many(`SELECT to_char(date_trunc('month', b.check_in),'YYYY-MM') m, sum(host_payout)::bigint v
    FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE l.host_id=$1 AND b.status IN ('confirmed','completed')
      AND b.check_in >= date_trunc('month', $2::date) - interval '5 months' AND b.check_in < date_trunc('month', $2::date) + interval '1 month'
    GROUP BY 1 ORDER BY 1`, [req.user.id, t]);
  res.json({ ...s, months });
}));

/* ---------- 숙소 ---------- */
hostRouter.get('/api/host/listings', wrap(async (req, res) => {
  const rows = await many(`SELECT l.id, l.title, l.region, l.area, l.price, l.status, l.reject_reason, l.updated_at, l.category,
      (SELECT id FROM listing_photos p WHERE p.listing_id=l.id ORDER BY sort, id LIMIT 1) cover,
      (SELECT count(*)::int FROM listing_photos p WHERE p.listing_id=l.id) photo_count,
      (SELECT count(*)::int FROM bookings b WHERE b.listing_id=l.id AND b.status='requested') requests
    FROM listings l WHERE l.host_id=$1 ORDER BY l.id DESC`, [req.user.id]);
  res.json({ items: rows });
}));

hostRouter.get('/api/host/listings/:id', wrap(async (req, res) => {
  const l = await ownListing(req, idParam(req));
  const photos = await many('SELECT id FROM listing_photos WHERE listing_id=$1 ORDER BY sort, id', [l.id]);
  const blocked = await many(`SELECT to_char(day,'YYYY-MM-DD') d FROM blocked_dates WHERE listing_id=$1 AND day>=$2::date ORDER BY day`, [l.id, todayKST()]);
  const booked = await many(`SELECT b.id, b.code, b.check_in, b.check_out, b.status, u.name guest FROM bookings b JOIN users u ON u.id=b.guest_id
    WHERE b.listing_id=$1 AND b.status IN ('requested','confirmed') AND b.check_out>=$2::date ORDER BY b.check_in`, [l.id, todayKST()]);
  res.json({ ...l, photos: photos.map(p => p.id), blocked: blocked.map(b => b.d), booked });
}));

hostRouter.post('/api/host/listings', wrap(async (req, res) => {
  if (!req.user.host_agreed_at) throw bad('호스트 등록을 먼저 마쳐 주세요.');
  const n = await one(`SELECT count(*)::int n FROM listings WHERE host_id=$1`, [req.user.id]);
  if (n.n >= 50) throw bad('숙소는 계정당 최대 50개까지 등록할 수 있어요.');
  const d = parse(listingSchema, req.body);
  const [lat, lng] = REGION_COORDS[d.region] || [null, null];
  const r = await one(`INSERT INTO listings(host_id,title,description,category,region,area,address,lat,lng,price,cleaning_fee,max_guests,bedrooms,beds,baths,amenities,rules,checkin_time,checkout_time,min_nights,instant_book)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
    [req.user.id, d.title, d.description, d.category, d.region, d.area, d.address, lat, lng, d.price, d.cleaningFee, d.maxGuests, d.bedrooms,
      d.beds, d.baths, d.amenities, d.rules, d.checkinTime, d.checkoutTime, d.minNights, d.instantBook]);
  await audit(req, 'listing_create', r.id);
  res.status(201).json(r);
}));

hostRouter.put('/api/host/listings/:id', wrap(async (req, res) => {
  const d = parse(listingSchema, req.body);
  const out = await tx(async c => {
    const l = (await c.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [idParam(req)])).rows[0];
    if (!l || (l.host_id !== req.user.id && req.user.role !== 'admin')) throw notFound('숙소를 찾을 수 없어요.');
    if (l.status === 'suspended' && req.user.role !== 'admin') throw bad('운영 정책에 따라 중지된 숙소예요. 고객센터로 문의해 주세요.');
    // 공개 내용(이름·소개·위치)이 바뀌면 승인된 숙소도 다시 심사
    const changed = CONTENT_FIELDS.some(k => String(l[k]) !== String(d[k]));
    const status = l.status === 'approved' && changed ? 'pending' : l.status === 'rejected' ? 'draft' : l.status;
    const [lat, lng] = d.region !== l.region ? (REGION_COORDS[d.region] || [null, null]) : [l.lat, l.lng];
    await c.query(`UPDATE listings SET title=$2,description=$3,category=$4,region=$5,area=$6,address=$7,lat=$8,lng=$9,price=$10,cleaning_fee=$11,
      max_guests=$12,bedrooms=$13,beds=$14,baths=$15,amenities=$16,rules=$17,checkin_time=$18,checkout_time=$19,min_nights=$20,instant_book=$21,
      status=$22, updated_at=now() WHERE id=$1`,
      [l.id, d.title, d.description, d.category, d.region, d.area, d.address, lat, lng, d.price, d.cleaningFee, d.maxGuests, d.bedrooms, d.beds,
        d.baths, d.amenities, d.rules, d.checkinTime, d.checkoutTime, d.minNights, d.instantBook, status]);
    return { status, reReview: status === 'pending' && l.status === 'approved' };
  });
  await audit(req, 'listing_update', req.params.id, out);
  res.json(out);
}));

hostRouter.post('/api/host/listings/:id/submit', wrap(async (req, res) => {
  const l = await ownListing(req, idParam(req));
  if (!['draft', 'rejected'].includes(l.status)) throw bad('지금은 심사 요청을 할 수 없는 상태예요.');
  const p = await one('SELECT count(*)::int n FROM listing_photos WHERE listing_id=$1', [l.id]);
  if (p.n < 3) throw bad('사진을 3장 이상 올려야 심사를 요청할 수 있어요.');
  if (l.description.length < 30) throw bad('숙소 소개를 30자 이상 적어 주세요.');
  if (!l.address) throw bad('상세 주소를 입력해 주세요. 예약이 확정된 게스트에게만 보여요.');
  await q(`UPDATE listings SET status='pending', reject_reason=NULL, updated_at=now() WHERE id=$1`, [l.id]);
  await audit(req, 'listing_submit', l.id);
  res.json({ ok: true });
}));

hostRouter.post('/api/host/listings/:id/unpublish', wrap(async (req, res) => {
  const l = await ownListing(req, idParam(req));
  if (!['approved', 'pending'].includes(l.status)) throw bad('게시 중인 숙소가 아니에요.');
  await q(`UPDATE listings SET status='draft', updated_at=now() WHERE id=$1`, [l.id]);
  await audit(req, 'listing_unpublish', l.id);
  res.json({ ok: true });
}));

hostRouter.delete('/api/host/listings/:id', wrap(async (req, res) => {
  const l = await ownListing(req, idParam(req));
  const used = await one(`SELECT count(*)::int n FROM bookings WHERE listing_id=$1`, [l.id]);
  if (used.n) throw bad('예약 기록이 있는 숙소는 삭제할 수 없어요. 대신 게시를 중단해 주세요.');
  await q('DELETE FROM listings WHERE id=$1', [l.id]);
  await audit(req, 'listing_delete', l.id);
  res.json({ ok: true });
}));

/* ---------- 사진 ---------- */
hostRouter.post('/api/host/listings/:id/photos', (req, res, next) => upload.array('photos', 10)(req, res, err => {
  if (err) return next(err.status ? err : bad(err.code === 'LIMIT_FILE_SIZE' ? '사진 한 장은 12MB 이하여야 해요.' : err.code === 'LIMIT_FILE_COUNT' ? '한 번에 10장까지 올릴 수 있어요.' : '사진을 올리지 못했어요.'));
  next();
}), wrap(async (req, res) => {
  const l = await ownListing(req, idParam(req));
  const files = req.files || [];
  if (!files.length) throw bad('올릴 사진을 골라 주세요.');
  const cur = await one('SELECT count(*)::int n, COALESCE(max(sort),0) s FROM listing_photos WHERE listing_id=$1', [l.id]);
  if (cur.n + files.length > 30) throw bad('숙소당 사진은 최대 30장이에요.');
  const ids = [];
  let sort = cur.s;
  for (const f of files) {
    const p = await processPhoto(f.buffer);
    const r = await one('INSERT INTO listing_photos(listing_id, sort, data, thumb, width, height) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [l.id, ++sort, p.data, p.thumb, p.width, p.height]);
    ids.push(r.id);
  }
  if (l.status === 'approved') await q(`UPDATE listings SET status='pending', updated_at=now() WHERE id=$1`, [l.id]);
  await audit(req, 'photo_upload', l.id, { count: ids.length });
  res.status(201).json({ ids, reReview: l.status === 'approved' });
}));

hostRouter.put('/api/host/listings/:id/photos/order', wrap(async (req, res) => {
  const l = await ownListing(req, idParam(req));
  const { ids } = parse(z.object({ ids: z.array(z.coerce.number().int().positive()).max(30) }), req.body);
  await tx(async c => {
    for (let i = 0; i < ids.length; i++) await c.query('UPDATE listing_photos SET sort=$3 WHERE id=$1 AND listing_id=$2', [ids[i], l.id, i + 1]);
  });
  res.json({ ok: true });
}));

hostRouter.delete('/api/host/listings/:id/photos/:pid', wrap(async (req, res) => {
  const l = await ownListing(req, idParam(req));
  const pid = parse(z.coerce.number().int().positive(), req.params.pid);
  if (l.status === 'approved') {
    const n = await one('SELECT count(*)::int n FROM listing_photos WHERE listing_id=$1', [l.id]);
    if (n.n <= 3) throw bad('게시 중인 숙소는 사진이 3장 이상 있어야 해요.');
  }
  await q('DELETE FROM listing_photos WHERE id=$1 AND listing_id=$2', [pid, l.id]);
  res.json({ ok: true });
}));

/* ---------- 달력 차단 ---------- */
hostRouter.put('/api/host/listings/:id/blocks', wrap(async (req, res) => {
  const l = await ownListing(req, idParam(req));
  const d = parse(z.object({ add: z.array(z.string()).max(370).default([]), remove: z.array(z.string()).max(370).default([]) }), req.body);
  const t = todayKST(), lim = todayKST(400);
  for (const x of [...d.add, ...d.remove]) if (!isDate(x) || x < t || x > lim) throw bad('날짜를 다시 확인해 주세요.');
  await tx(async c => {
    if (d.remove.length) await c.query('DELETE FROM blocked_dates WHERE listing_id=$1 AND day = ANY($2::date[])', [l.id, d.remove]);
    if (d.add.length) await c.query('INSERT INTO blocked_dates(listing_id, day) SELECT $1, unnest($2::date[]) ON CONFLICT DO NOTHING', [l.id, d.add]);
  });
  res.json({ ok: true });
}));

/* ---------- 예약 관리 ---------- */
hostRouter.get('/api/host/bookings', wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['requested', 'upcoming', 'past', 'cancelled', 'all']).default('all') }), req.query);
  const t = todayKST();
  const cond = { requested: `b.status='requested'`, upcoming: `b.status='confirmed' AND b.check_out>='${t}'`,
    past: `(b.status='completed' OR (b.status='confirmed' AND b.check_out<'${t}'))`, cancelled: `b.status IN ('cancelled','declined','expired')`, all: 'true' }[status];
  const rows = await many(`SELECT b.id, b.code, b.check_in, b.check_out, b.guests, b.nights, b.total, b.host_payout, b.status, b.message, b.created_at,
      l.id listing_id, l.title, u.name guest_name, u.avatar_url guest_avatar,
      (SELECT id FROM listing_photos p WHERE p.listing_id=l.id ORDER BY sort, id LIMIT 1) cover
    FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users u ON u.id=b.guest_id
    WHERE l.host_id=$1 AND ${cond} ORDER BY b.check_in ${status === 'past' || status === 'cancelled' ? 'DESC' : 'ASC'} LIMIT 200`, [req.user.id]);
  res.json({ items: rows });
}));

async function decide(req, accept) {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { reason } = parse(z.object({ reason: z.string().transform(clean).pipe(z.string().max(300)).optional() }), req.body || {});
  const r = await q(`UPDATE bookings b SET status=$3, decided_at=now(), decline_reason=$4 FROM listings l
    WHERE b.id=$1 AND l.id=b.listing_id AND l.host_id=$2 AND b.status='requested' RETURNING b.id`,
    [id, req.user.id, accept ? 'confirmed' : 'declined', accept ? null : reason || null]);
  if (!r.rowCount) throw new HttpError(409, '이미 처리됐거나 만료된 요청이에요.');
  await audit(req, accept ? 'booking_accept' : 'booking_decline', id);
}
hostRouter.post('/api/host/bookings/:id/accept', wrap(async (req, res) => { await decide(req, true); res.json({ ok: true }); }));
hostRouter.post('/api/host/bookings/:id/decline', wrap(async (req, res) => { await decide(req, false); res.json({ ok: true }); }));

hostRouter.post('/api/host/reviews/:id/reply', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { body } = parse(z.object({ body: txt(1, 1000, '답글을 입력해 주세요.') }), req.body);
  const r = await q(`UPDATE reviews r SET host_reply=$3 FROM listings l WHERE r.id=$1 AND l.id=r.listing_id AND l.host_id=$2 RETURNING r.id`, [id, req.user.id, body]);
  if (!r.rowCount) throw notFound();
  res.json({ ok: true });
}));
