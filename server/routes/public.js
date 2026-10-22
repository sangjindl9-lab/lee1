import express from 'express';
import { z } from 'zod';
import { one, many } from '../db.js';
import { wrap, parse, notFound, isDate, todayKST, bad } from '../util.js';
import { config, enabledProviders, REGIONS, CATEGORIES, AMENITIES } from '../config.js';
import { quote } from '../pricing.js';

export const publicRouter = express.Router();

// 카드·검색용 공통 컬럼 (상세 주소는 절대 포함하지 않음)
export const CARD_COLS = `l.id, l.title, l.category, l.region, l.area, l.lat, l.lng, l.price, l.max_guests, l.bedrooms, l.beds, l.baths,
  l.instant_book, l.status, l.host_id,
  (SELECT id FROM listing_photos p WHERE p.listing_id=l.id ORDER BY sort, id LIMIT 1) cover,
  (SELECT array_agg(id ORDER BY sort, id) FROM (SELECT id, sort FROM listing_photos p WHERE p.listing_id=l.id ORDER BY sort, id LIMIT 5) x) photos,
  (SELECT round(avg(rating)::numeric,2) FROM reviews r WHERE r.listing_id=l.id AND NOT r.hidden) rating,
  (SELECT count(*)::int FROM reviews r WHERE r.listing_id=l.id AND NOT r.hidden) review_count`;

publicRouter.get('/api/config', (req, res) => {
  res.json({
    providers: enabledProviders(), demo: config.demoLogin, regions: REGIONS, categories: CATEGORIES, amenities: AMENITIES,
    serviceFeeRate: config.serviceFeeRate, hostFeeRate: config.hostFeeRate, business: config.business, today: todayKST(),
  });
});

publicRouter.get('/api/me', (req, res) => {
  const u = req.user;
  res.json({
    user: u ? { id: u.id, name: u.name, email: u.email, avatar: u.avatar_url, phone: u.phone, bio: u.bio, role: u.role,
      provider: u.provider, hostAgreed: !!u.host_agreed_at, createdAt: u.created_at } : null,
    csrf: req.session?.csrf || null,
  });
});

const searchSchema = z.object({
  region: z.string().max(20).optional(),
  category: z.string().max(20).optional(),
  guests: z.coerce.number().int().min(1).max(30).optional(),
  checkIn: z.string().optional(), checkOut: z.string().optional(),
  minPrice: z.coerce.number().int().min(0).optional(), maxPrice: z.coerce.number().int().min(0).optional(),
  q: z.string().max(40).optional(),
  sort: z.enum(['recommended', 'price_asc', 'price_desc', 'rating', 'new']).optional(),
  page: z.coerce.number().int().min(1).max(100).optional(),
});

publicRouter.get('/api/listings', wrap(async (req, res) => {
  const f = parse(searchSchema, req.query);
  const where = [`l.status='approved'`], p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', '$' + p.length)); };
  if (f.region && f.region !== '전체') add('l.region=?', f.region);
  if (f.category && f.category !== 'all' && CATEGORIES.includes(f.category)) add('l.category=?', f.category);
  if (f.guests) add('l.max_guests>=?', f.guests);
  if (f.minPrice) add('l.price>=?', f.minPrice);
  if (f.maxPrice) add('l.price<=?', f.maxPrice);
  if (f.q) {
    p.push('%' + f.q.replace(/[%_\\]/g, '\\$&') + '%');
    const i = '$' + p.length;
    where.push(`(l.title ILIKE ${i} OR l.area ILIKE ${i} OR l.region ILIKE ${i})`);
  }
  if (f.checkIn || f.checkOut) {
    if (!isDate(f.checkIn) || !isDate(f.checkOut) || f.checkOut <= f.checkIn) throw bad('날짜를 다시 선택해 주세요.');
    p.push(f.checkIn, f.checkOut);
    const a = '$' + (p.length - 1), b = '$' + p.length;
    where.push(`NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.listing_id=l.id AND bk.status IN ('requested','confirmed')
      AND daterange(bk.check_in,bk.check_out,'[)') && daterange(${a}::date,${b}::date,'[)'))`);
    where.push(`NOT EXISTS (SELECT 1 FROM blocked_dates bd WHERE bd.listing_id=l.id AND bd.day>=${a}::date AND bd.day<${b}::date)`);
    where.push(`l.min_nights <= (${b}::date - ${a}::date)`);
  }
  const order = { price_asc: 'price ASC, id DESC', price_desc: 'price DESC, id DESC', rating: 'rating DESC NULLS LAST, review_count DESC, id DESC', new: 'id DESC' }[f.sort]
    || 'review_count DESC, rating DESC NULLS LAST, id DESC';
  const limit = 24, offset = ((f.page || 1) - 1) * limit;
  const rows = await many(`SELECT * FROM (SELECT ${CARD_COLS} FROM listings l WHERE ${where.join(' AND ')}) t ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`, p);
  let liked = new Set();
  if (req.user && rows.length) {
    const w = await many('SELECT listing_id FROM wishlists WHERE user_id=$1 AND listing_id = ANY($2)', [req.user.id, rows.map(r => r.id)]);
    liked = new Set(w.map(x => String(x.listing_id)));
  }
  res.json({ items: rows.slice(0, limit).map(r => ({ ...r, liked: liked.has(String(r.id)) })), hasMore: rows.length > limit });
}));

publicRouter.get('/api/listings/:id', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const l = await one(`SELECT l.* FROM listings l WHERE l.id=$1`, [id]);
  if (!l) throw notFound('숙소를 찾을 수 없어요.');
  const isOwner = req.user && (req.user.id === l.host_id || req.user.role === 'admin');
  if (l.status !== 'approved' && !isOwner) throw notFound('숙소를 찾을 수 없어요.');
  const photos = await many('SELECT id FROM listing_photos WHERE listing_id=$1 ORDER BY sort, id', [id]);
  const host = await one(`SELECT u.id, u.name, u.avatar_url avatar, u.bio, u.created_at,
      (SELECT count(*)::int FROM listings x WHERE x.host_id=u.id AND x.status='approved') listings,
      (SELECT count(*)::int FROM reviews r JOIN listings x ON x.id=r.listing_id WHERE x.host_id=u.id AND NOT r.hidden) reviews,
      (SELECT round(avg(r.rating)::numeric,2) FROM reviews r JOIN listings x ON x.id=r.listing_id WHERE x.host_id=u.id AND NOT r.hidden) rating
    FROM users u WHERE u.id=$1`, [l.host_id]);
  const reviews = await many(`SELECT r.id, r.rating, r.cleanliness, r.accuracy, r.location, r.body, r.host_reply, r.created_at,
      u.name, u.avatar_url avatar FROM reviews r JOIN users u ON u.id=r.guest_id
    WHERE r.listing_id=$1 AND NOT r.hidden ORDER BY r.id DESC LIMIT 30`, [id]);
  const stats = await one(`SELECT count(*)::int n, round(avg(rating)::numeric,2) rating, round(avg(cleanliness)::numeric,1) cleanliness,
      round(avg(accuracy)::numeric,1) accuracy, round(avg(location)::numeric,1) location FROM reviews WHERE listing_id=$1 AND NOT hidden`, [id]);
  const liked = req.user ? !!(await one('SELECT 1 FROM wishlists WHERE user_id=$1 AND listing_id=$2', [req.user.id, id])) : false;
  const { address, reject_reason, ...pub } = l;
  res.json({
    ...pub, photos: photos.map(p => p.id), host, reviews, stats, liked,
    ...(isOwner ? { address, reject_reason } : {}),
  });
}));

// 예약 불가 날짜 (예약 vs 호스트 차단 구분 없이 날짜만 공개)
publicRouter.get('/api/listings/:id/availability', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const l = await one(`SELECT id, status, host_id, min_nights FROM listings WHERE id=$1`, [id]);
  if (!l || (l.status !== 'approved' && !(req.user && (req.user.id === l.host_id || req.user.role === 'admin')))) throw notFound();
  const from = todayKST(), to = todayKST(366);
  const rows = await many(`
    SELECT to_char(g,'YYYY-MM-DD') AS dd FROM bookings b, generate_series(b.check_in, b.check_out - 1, '1 day') g
      WHERE b.listing_id=$1 AND b.status IN ('requested','confirmed') AND b.check_out > $2::date AND b.check_in < $3::date
    UNION SELECT to_char(day,'YYYY-MM-DD') AS dd FROM blocked_dates WHERE listing_id=$1 AND day BETWEEN $2::date AND $3::date`, [id, from, to]);
  res.json({ unavailable: rows.map(r => r.dd).sort(), minNights: l.min_nights, today: from });
}));

publicRouter.get('/api/listings/:id/quote', wrap(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { checkIn, checkOut, guests } = parse(z.object({ checkIn: z.string(), checkOut: z.string(), guests: z.coerce.number().int() }), req.query);
  const l = await one(`SELECT * FROM listings WHERE id=$1 AND status='approved'`, [id]);
  if (!l) throw notFound();
  const qt = quote(l, checkIn, checkOut, guests);
  const { hostFee, hostPayout, ...guestView } = qt;
  res.json(guestView);
}));

// 사진: 승인된 숙소는 누구나, 그 외에는 호스트 본인·관리자만
publicRouter.get('/photos/:id', wrap(async (req, res) => {
  const m = /^(\d{1,12})(-t)?\.webp$/.exec(req.params.id);
  if (!m) throw notFound();
  const col = m[2] ? 'thumb' : 'data';
  const p = await one(`SELECT p.${col} img, l.status, l.host_id FROM listing_photos p JOIN listings l ON l.id=p.listing_id WHERE p.id=$1`, [m[1]]);
  if (!p) throw notFound();
  const pub = p.status === 'approved';
  if (!pub && !(req.user && (req.user.id === p.host_id || req.user.role === 'admin'))) throw notFound();
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': pub ? 'public, max-age=604800, immutable' : 'private, no-store',
    'Content-Security-Policy': "default-src 'none'", 'Cross-Origin-Resource-Policy': 'same-origin' });
  res.send(p.img);
}));
