import express from 'express';
import crypto from 'node:crypto';
import { one, all, q, tx } from './db.js';
import { getSettings, saveSettings, DEFAULTS } from './settings.js';
import * as P from './points.js';
import * as B from './booking.js';
import * as pay from './pay/index.js';
import * as A from './auth.js';
import { HttpError, ah, bad, today, addDays, str, int, bool, isDate, csv, fmtPhone, rid } from './util.js';

export const adminRouter = express.Router();
const r = adminRouter;
const audit = (req, action, target, detail) => q(`INSERT INTO audit_log(admin_id, action, target, detail) VALUES($1,$2,$3,$4)`,
  [req.user.id, action, String(target ?? ''), detail ? JSON.stringify(detail) : null]).catch(() => {});

const TYPES = ['호텔/리조트', '모텔', '펜션/풀빌라', '게하/한옥', '캠핑/글램핑'];
const SIDO = ['서울', '경기', '인천', '강원', '부산', '경상', '제주', '전라', '충청'];
const arr = (v, max = 30) => Array.isArray(v) ? v.map(x => str(x, 40)).filter(Boolean).slice(0, max) : [];
const imgIds = v => Array.isArray(v) ? v.map(x => String(x)).filter(x => /^[A-Za-z0-9_-]{10,40}$/.test(x)).slice(0, 20) : [];

/* ---------- 대시보드 ---------- */
r.get('/dashboard', ah(async (req, res) => {
  const t = today(), mo = t.slice(0, 7);
  const [kpi, months, days, rank, waits, ins, occ, members, ads, payments] = await Promise.all([
    one(`SELECT
        COALESCE(SUM(amount_due) FILTER (WHERE status<>'cancel' AND to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM')=$1),0) AS month_sales,
        COUNT(*) FILTER (WHERE status<>'cancel' AND to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM')=$1) AS month_cnt,
        COALESCE(SUM(points_used) FILTER (WHERE status<>'cancel' AND to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM')=$1),0) AS month_points,
        COUNT(*) FILTER (WHERE status='wait') AS waits,
        COUNT(*) FILTER (WHERE status='pending') AS pendings,
        COUNT(*) FILTER (WHERE status='cancel' AND to_char(updated_at AT TIME ZONE 'Asia/Seoul','YYYY-MM')=$1) AS month_cancel
      FROM bookings`, [mo]),
    all(`SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM') AS k, SUM(amount_due) AS v, COUNT(*) AS n FROM bookings
         WHERE status<>'cancel' AND created_at > now() - interval '7 months' GROUP BY 1 ORDER BY 1`),
    all(`SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS k, COUNT(*) AS n FROM bookings
         WHERE created_at > now() - interval '15 days' GROUP BY 1`),
    all(`SELECT place_name AS name, COUNT(*) AS n, SUM(amount_due + points_used) AS v FROM bookings WHERE status<>'cancel' GROUP BY place_name ORDER BY v DESC LIMIT 5`),
    all(`SELECT * FROM bookings WHERE status='wait' ORDER BY created_at LIMIT 8`),
    all(`SELECT * FROM bookings WHERE status IN ('ok','wait') AND check_in IN ($1::date, $2::date) ORDER BY check_in, id`, [t, addDays(t, 1)]),
    one(`SELECT COALESCE(SUM(r.stock),0) AS stock, COALESCE(SUM(LEAST(rn.booked, r.stock)),0) AS used FROM rooms r JOIN places p ON p.id=r.place_id
         LEFT JOIN room_nights rn ON rn.room_id=r.id AND rn.night=$1 WHERE r.active AND p.active`, [t]),
    one(`SELECT COUNT(*) FILTER (WHERE status='active') AS total, COUNT(*) FILTER (WHERE status='active' AND created_at > now() - interval '30 days') AS new30 FROM users`),
    one(`SELECT COUNT(*) FILTER (WHERE active AND start_date <= $1 AND end_date >= $1) AS live,
                COALESCE(SUM(fee) FILTER (WHERE to_char(start_date,'YYYY-MM')=$2),0) AS fee_month,
                (SELECT COALESCE(SUM(imp),0) FROM ad_stats WHERE day > $1::date - 30) AS imp,
                (SELECT COALESCE(SUM(clk),0) FROM ad_stats WHERE day > $1::date - 30) AS clk FROM banners`, [t, mo]),
    one(`SELECT COUNT(*) FILTER (WHERE status='refund_pending') AS refund_pending FROM payments`)
  ]);
  res.json({ today: t, kpi, months, days, rank, waits, ins, occ, members, ads, payments, pay: pay.publicConfig() });
}));

/* ---------- 예약 ---------- */
function bookingWhere(qs) {
  const w = [], p = [];
  if (qs.status && qs.status !== 'all') { p.push(qs.status); w.push(`b.status=$${p.length}`); }
  if (qs.place) { p.push(int(qs.place)); w.push(`b.place_id=$${p.length}`); }
  if (isDate(qs.from)) { p.push(qs.from); w.push(`b.check_in >= $${p.length}`); }
  if (isDate(qs.to)) { p.push(qs.to); w.push(`b.check_in <= $${p.length}`); }
  if (qs.q) { p.push('%' + str(qs.q, 60) + '%'); w.push(`(b.code ILIKE $${p.length} OR b.guest_name ILIKE $${p.length} OR b.phone ILIKE $${p.length} OR b.place_name ILIKE $${p.length})`); }
  if (qs.user) { p.push(int(qs.user)); w.push(`b.user_id=$${p.length}`); }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', p };
}
r.get('/bookings', ah(async (req, res) => {
  const { where, p } = bookingWhere(req.query);
  const page = Math.max(1, int(req.query.page, 1)), size = 50;
  const [rows, agg, counts] = await Promise.all([
    all(`SELECT b.*, u.email AS user_email FROM bookings b LEFT JOIN users u ON u.id=b.user_id ${where} ORDER BY b.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, p),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_due) FILTER (WHERE status<>'cancel'),0) AS sum FROM bookings b ${where}`, p),
    all(`SELECT status, COUNT(*) AS n FROM bookings GROUP BY status`)
  ]);
  res.json({ rows, total: agg.n, sum: agg.sum, page, size, counts: Object.fromEntries(counts.map(c => [c.status, c.n])) });
}));
r.get('/bookings.csv', ah(async (req, res) => {
  const { where, p } = bookingWhere(req.query);
  const rows = await all(`SELECT b.* FROM bookings b ${where} ORDER BY b.id DESC LIMIT 20000`, p);
  const ST = { pending: '결제대기', wait: '입금대기', ok: '예약확정', done: '이용완료', cancel: '취소' };
  const PM = { card: '카드', bank: '무통장', site: '현장결제', points: '포인트' };
  const data = csv([['예약번호', '상태', '숙소', '객실', '체크인', '체크아웃', '박', '성인', '아동', '예약자', '연락처', '결제수단', '객실요금', '포인트', '결제금액', '환불금액', '예약일시', '요청사항', '관리메모'],
    ...rows.map(b => [b.code, ST[b.status], b.place_name, b.room_name, b.check_in, b.check_out, b.nights, b.adults, b.children, b.guest_name, b.phone, PM[b.pay_method],
      b.total, b.points_used, b.amount_due, b.refund_amount, new Date(b.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }), b.request, b.admin_memo])]);
  await audit(req, 'export_bookings', '', { n: rows.length });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bookings-${today()}.csv"` }).send(data);
}));
r.get('/bookings/:id', ah(async (req, res) => {
  const b = await one(`SELECT b.*, u.email AS user_email, u.name AS user_name FROM bookings b LEFT JOIN users u ON u.id=b.user_id WHERE b.id=$1`, [int(req.params.id)]);
  if (!b) throw new HttpError(404, '예약을 찾을 수 없습니다.');
  const [payments, preview] = await Promise.all([
    all(`SELECT id, order_id, provider, method, amount, status, payment_key, cancelled_amount, receipt_url, fail_reason, paid_at, cancelled_at, created_at FROM payments WHERE booking_id=$1 ORDER BY id`, [b.id]),
    b.status !== 'cancel' ? tx(c => B.cancelPreview(c, b)) : null
  ]);
  res.json({ ...b, payments, preview });
}));
r.post('/bookings/:id/status', ah(async (req, res) => {
  const b = await B.adminSetStatus(int(req.params.id), req.body.status);
  await audit(req, 'booking_status', b.code, { status: req.body.status });
  res.json(b);
}));
r.post('/bookings/:id/cancel', ah(async (req, res) => {
  const mode = ['policy', 'full', 'none'].includes(req.body.mode) ? req.body.mode : 'policy';
  const b = await B.cancelBooking(int(req.params.id), { by: 'admin', reason: str(req.body.reason, 200) || '관리자 취소', mode });
  await audit(req, 'booking_cancel', b.code, { mode, refund: b.refund_amount });
  res.json(b);
}));
r.patch('/bookings/:id', ah(async (req, res) => {
  const b = await one(`UPDATE bookings SET admin_memo=$2, updated_at=now() WHERE id=$1 RETURNING *`, [int(req.params.id), str(req.body.admin_memo, 1000)]);
  res.json(b);
}));

/* ---------- 결제 ---------- */
r.get('/payments', ah(async (req, res) => {
  const p = [], w = [];
  if (req.query.status && req.query.status !== 'all') { p.push(req.query.status); w.push(`p.status=$${p.length}`); }
  if (req.query.method && req.query.method !== 'all') { p.push(req.query.method); w.push(`p.method=$${p.length}`); }
  const rows = await all(`SELECT p.id, p.order_id, p.provider, p.method, p.amount, p.status, p.cancelled_amount, p.receipt_url, p.fail_reason, p.paid_at, p.cancelled_at, p.created_at,
      b.id AS booking_id, b.code, b.guest_name, b.place_name FROM payments p JOIN bookings b ON b.id=p.booking_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 300`, p);
  const sums = await one(`SELECT COALESCE(SUM(amount) FILTER (WHERE status IN ('paid','partial_cancelled','kept')),0) - COALESCE(SUM(cancelled_amount) FILTER (WHERE status='partial_cancelled'),0) AS net,
      COUNT(*) FILTER (WHERE status='refund_pending') AS refund_pending FROM payments`);
  res.json({ rows, sums, pay: pay.publicConfig() });
}));
r.post('/payments/:id/refunded', ah(async (req, res) => {
  const p = await one(`UPDATE payments SET status=CASE WHEN cancelled_amount >= amount THEN 'cancelled' ELSE 'partial_cancelled' END, cancelled_at=now()
                       WHERE id=$1 AND status='refund_pending' RETURNING *`, [int(req.params.id)]);
  if (!p) throw bad('환불 대기 중인 결제가 아닙니다.');
  await audit(req, 'refund_done', p.order_id, { amount: p.cancelled_amount });
  res.json(p);
}));

/* ---------- 요금·재고 ---------- */
r.get('/inventory', ah(async (req, res) => {
  const roomId = int(req.query.room), month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  const room = await one(`SELECT r.*, p.name AS place_name FROM rooms r JOIN places p ON p.id=r.place_id WHERE r.id=$1`, [roomId]);
  if (!room) throw new HttpError(404, '객실을 찾을 수 없습니다.');
  const rows = await all(`SELECT night, booked, closed, price FROM room_nights WHERE room_id=$1 AND to_char(night,'YYYY-MM')=$2`, [roomId, month]);
  res.json({ room, month, nights: rows });
}));
r.post('/inventory', ah(async (req, res) => {
  const roomId = int(req.body.room), dates = (req.body.dates || []).filter(isDate).slice(0, 400), act = req.body.action;
  if (!dates.length) throw bad('날짜를 선택해 주세요.');
  if (!(await one(`SELECT 1 FROM rooms WHERE id=$1`, [roomId]))) throw bad('객실을 찾을 수 없습니다.');
  await q(`INSERT INTO room_nights(room_id, night) SELECT $1, d::date FROM unnest($2::date[]) d ON CONFLICT DO NOTHING`, [roomId, dates]);
  if (act === 'close') await q(`UPDATE room_nights SET closed=true WHERE room_id=$1 AND night = ANY($2::date[])`, [roomId, dates]);
  else if (act === 'open') await q(`UPDATE room_nights SET closed=false WHERE room_id=$1 AND night = ANY($2::date[])`, [roomId, dates]);
  else if (act === 'price') { const pr = int(req.body.price, -1); if (pr < 0) throw bad('요금을 입력해 주세요.'); await q(`UPDATE room_nights SET price=$3 WHERE room_id=$1 AND night = ANY($2::date[])`, [roomId, dates, pr]); }
  else if (act === 'resetPrice') await q(`UPDATE room_nights SET price=NULL WHERE room_id=$1 AND night = ANY($2::date[])`, [roomId, dates]);
  else throw bad('알 수 없는 작업입니다.');
  await audit(req, 'inventory_' + act, roomId, { n: dates.length, price: req.body.price });
  res.json({ ok: true });
}));

/* ---------- 숙소·객실 ---------- */
r.get('/places', ah(async (req, res) => {
  const places = await all(`SELECT p.*, (SELECT COUNT(*) FROM bookings b WHERE b.place_id=p.id AND b.status<>'cancel') AS bookings FROM places p ORDER BY p.id DESC`);
  const rooms = await all(`SELECT * FROM rooms ORDER BY place_id, sort, price`);
  res.json({ places, rooms });
}));
function placeBody(b) {
  const v = { name: str(b.name, 60), type: TYPES.includes(b.type) ? b.type : TYPES[0], grade: str(b.grade, 20), sido: SIDO.includes(b.sido) ? b.sido : SIDO[0],
    area: str(b.area, 30), address: str(b.address, 200), phone: str(b.phone, 30), check_in: str(b.check_in, 5) || '15:00', check_out: str(b.check_out, 5) || '11:00',
    intro: str(b.intro, 3000), notice: str(b.notice, 2000), amenities: arr(b.amenities), tags: arr(b.tags), photos: imgIds(b.photos), featured: bool(b.featured), active: b.active === undefined ? true : bool(b.active) };
  if (!v.name) throw bad('숙소 이름을 입력해 주세요.');
  if (!v.area) throw bad('세부 지역을 입력해 주세요.');
  return v;
}
const PCOLS = ['name', 'type', 'grade', 'sido', 'area', 'address', 'phone', 'check_in', 'check_out', 'intro', 'notice', 'amenities', 'tags', 'photos', 'featured', 'active'];
r.post('/places', ah(async (req, res) => {
  const v = placeBody(req.body);
  const p = await one(`INSERT INTO places(${PCOLS.join(',')}) VALUES(${PCOLS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, PCOLS.map(k => v[k]));
  await audit(req, 'place_create', p.id, { name: p.name });
  res.json(p);
}));
r.put('/places/:id', ah(async (req, res) => {
  const v = placeBody(req.body);
  const p = await one(`UPDATE places SET ${PCOLS.map((k, i) => `${k}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1 RETURNING *`, [int(req.params.id), ...PCOLS.map(k => v[k])]);
  if (!p) throw new HttpError(404, '숙소를 찾을 수 없습니다.');
  await audit(req, 'place_update', p.id);
  res.json(p);
}));
r.patch('/places/:id', ah(async (req, res) => {
  const k = req.body.key; if (!['featured', 'active'].includes(k)) throw bad('바꿀 수 없는 항목입니다.');
  const p = await one(`UPDATE places SET ${k}=$2, updated_at=now() WHERE id=$1 RETURNING *`, [int(req.params.id), bool(req.body.value)]);
  res.json(p);
}));
r.delete('/places/:id', ah(async (req, res) => {
  const id = int(req.params.id);
  const live = await one(`SELECT COUNT(*) AS n FROM bookings WHERE place_id=$1 AND status IN ('pending','wait','ok')`, [id]);
  if (live.n) throw bad(`진행 중인 예약이 ${live.n}건 있어 삭제할 수 없습니다. 판매 중지로 바꿔주세요.`);
  await q(`DELETE FROM places WHERE id=$1`, [id]);
  await audit(req, 'place_delete', id);
  res.json({ ok: true });
}));
r.post('/samples/delete', ah(async (req, res) => {
  const rr = await all(`DELETE FROM places p WHERE sample AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.place_id=p.id AND b.status IN ('pending','wait','ok')) RETURNING id`);
  await q(`DELETE FROM banners WHERE sample`);
  await audit(req, 'samples_delete', '', { n: rr.length });
  res.json({ deleted: rr.length });
}));
function roomBody(b) {
  const v = { name: str(b.name, 60), base: Math.max(1, int(b.base, 2)), max: Math.max(1, int(b.max, 2)), stock: Math.max(1, Math.min(500, int(b.stock, 1))),
    price: Math.max(0, int(b.price)), weekend_price: Math.max(0, int(b.weekend_price)), list_price: Math.max(0, int(b.list_price)),
    descr: str(b.descr, 2000), photos: imgIds(b.photos), sort: int(b.sort), active: b.active === undefined ? true : bool(b.active) };
  if (!v.name) throw bad('객실 이름을 입력해 주세요.');
  if (v.max < v.base) throw bad('최대 인원은 기준 인원 이상이어야 합니다.');
  if (!v.price) throw bad('평일 요금을 입력해 주세요.');
  return v;
}
const RCOLS = ['name', 'base', 'max', 'stock', 'price', 'weekend_price', 'list_price', 'descr', 'photos', 'sort', 'active'];
r.post('/rooms', ah(async (req, res) => {
  const v = roomBody(req.body), pid = int(req.body.place_id);
  if (!(await one(`SELECT 1 FROM places WHERE id=$1`, [pid]))) throw bad('숙소를 찾을 수 없습니다.');
  const room = await one(`INSERT INTO rooms(place_id, ${RCOLS.join(',')}) VALUES($1, ${RCOLS.map((_, i) => '$' + (i + 2)).join(',')}) RETURNING *`, [pid, ...RCOLS.map(k => v[k])]);
  await audit(req, 'room_create', room.id, { name: room.name });
  res.json(room);
}));
r.put('/rooms/:id', ah(async (req, res) => {
  const v = roomBody(req.body);
  const room = await one(`UPDATE rooms SET ${RCOLS.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [int(req.params.id), ...RCOLS.map(k => v[k])]);
  if (!room) throw new HttpError(404, '객실을 찾을 수 없습니다.');
  await audit(req, 'room_update', room.id);
  res.json(room);
}));
r.delete('/rooms/:id', ah(async (req, res) => {
  const id = int(req.params.id);
  const live = await one(`SELECT COUNT(*) AS n FROM bookings WHERE room_id=$1 AND status IN ('pending','wait','ok')`, [id]);
  if (live.n) throw bad(`진행 중인 예약이 ${live.n}건 있어 삭제할 수 없습니다.`);
  await q(`DELETE FROM rooms WHERE id=$1`, [id]);
  await audit(req, 'room_delete', id);
  res.json({ ok: true });
}));

/* ---------- 이미지 ---------- */
r.post('/images', ah(async (req, res) => {
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw bad('JPG, PNG, WEBP, GIF 이미지만 올릴 수 있습니다.');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('이미지가 비어 있습니다.');
  const id = rid(15).replace(/[^A-Za-z0-9_-]/g, 'x');
  await q(`INSERT INTO images(id, mime, data, size) VALUES($1,$2,$3,$4)`, [id, mime, req.body, req.body.length]);
  res.json({ id, url: '/img/' + id });
}));

/* ---------- 회원·포인트 ---------- */
r.get('/members', ah(async (req, res) => {
  const p = [], w = [];
  if (req.query.q) { p.push('%' + str(req.query.q, 60) + '%'); w.push(`(u.email ILIKE $1 OR u.name ILIKE $1 OR u.phone ILIKE $1)`); }
  if (req.query.status && req.query.status !== 'all') { p.push(req.query.status); w.push(`u.status=$${p.length}`); }
  if (req.query.role === 'admin') w.push(`u.role='admin'`);
  const page = Math.max(1, int(req.query.page, 1)), size = 50;
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const rows = await all(`SELECT u.id, u.email, u.name, u.phone, u.role, u.status, u.profile_done, u.marketing, u.created_at, u.last_login_at,
      (SELECT string_agg(provider, ',') FROM user_identities i WHERE i.user_id=u.id) AS providers,
      (SELECT COALESCE(SUM(amount),0) FROM point_tx t WHERE t.user_id=u.id) AS points,
      (SELECT COUNT(*) FROM bookings b WHERE b.user_id=u.id AND b.status<>'cancel') AS bookings,
      (SELECT COALESCE(SUM(amount_due),0) FROM bookings b WHERE b.user_id=u.id AND b.status IN ('ok','done')) AS spent
    FROM users u ${where} ORDER BY u.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, p);
  const total = await one(`SELECT COUNT(*) AS n FROM users u ${where}`, p);
  res.json({ rows, total: total.n, page, size });
}));
r.get('/members.csv', ah(async (req, res) => {
  const rows = await all(`SELECT u.id, u.email, u.name, u.phone, u.status, u.marketing, u.created_at,
      (SELECT COALESCE(SUM(amount),0) FROM point_tx t WHERE t.user_id=u.id) AS points,
      (SELECT COUNT(*) FROM bookings b WHERE b.user_id=u.id AND b.status<>'cancel') AS bookings FROM users u WHERE u.status<>'withdrawn' ORDER BY u.id`);
  await audit(req, 'export_members', '', { n: rows.length });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="members-${today()}.csv"` })
    .send(csv([['회원번호', '이메일', '이름', '휴대폰', '상태', '마케팅동의', '가입일', '포인트', '예약수'],
      ...rows.map(u => [u.id, u.email, u.name, u.phone, u.status, u.marketing ? 'Y' : 'N', new Date(u.created_at).toLocaleDateString('ko-KR'), u.points, u.bookings])]));
}));
r.get('/members/:id', ah(async (req, res) => {
  const id = int(req.params.id);
  const u = await one(`SELECT id, email, name, phone, role, status, profile_done, marketing, memo, terms_at, created_at, last_login_at FROM users WHERE id=$1`, [id]);
  if (!u) throw new HttpError(404, '회원을 찾을 수 없습니다.');
  const [ids, bookings, pts, bal] = await Promise.all([
    all(`SELECT provider, email, created_at FROM user_identities WHERE user_id=$1`, [id]),
    all(`SELECT id, code, status, place_name, room_name, check_in, nights, amount_due, points_used, created_at FROM bookings WHERE user_id=$1 ORDER BY id DESC LIMIT 100`, [id]),
    all(`SELECT id, amount, kind, memo, expires_at, created_at FROM point_tx WHERE user_id=$1 ORDER BY id DESC LIMIT 200`, [id]),
    tx(c => P.balance(c, id))
  ]);
  res.json({ ...u, identities: ids, bookings, points: pts, balance: bal });
}));
r.patch('/members/:id', ah(async (req, res) => {
  const id = int(req.params.id), b = req.body, sets = [], p = [id];
  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) throw bad('권한 값이 올바르지 않습니다.');
    if (id === req.user.id && b.role !== 'admin') throw bad('자기 자신의 관리자 권한은 해제할 수 없습니다.');
    p.push(b.role); sets.push(`role=$${p.length}`);
  }
  if (b.status !== undefined) {
    if (!['active', 'blocked'].includes(b.status)) throw bad('상태 값이 올바르지 않습니다.');
    if (id === req.user.id) throw bad('자기 자신은 정지할 수 없습니다.');
    p.push(b.status); sets.push(`status=$${p.length}`, 'token_ver=token_ver+1');
  }
  if (b.memo !== undefined) { p.push(str(b.memo, 1000)); sets.push(`memo=$${p.length}`); }
  if (!sets.length) throw bad('바꿀 내용이 없습니다.');
  const u = await one(`UPDATE users SET ${sets.join(',')} WHERE id=$1 AND status<>'withdrawn' RETURNING id, role, status, memo`, p);
  if (!u) throw bad('회원을 찾을 수 없습니다.');
  await audit(req, 'member_update', id, b);
  res.json(u);
}));
r.post('/members/:id/points', ah(async (req, res) => {
  const id = int(req.params.id), amt = int(req.body.amount), memo = str(req.body.memo, 100);
  if (!amt) throw bad('포인트를 입력해 주세요.');
  if (!memo) throw bad('사유를 입력해 주세요.');
  const s = await getSettings();
  const bal = await tx(async c => {
    if (amt > 0) await P.add(c, id, amt, 'admin_add', { memo, adminId: req.user.id, expireDays: s.points.expireDays });
    else await P.take(c, id, -amt, 'admin_sub', { memo, adminId: req.user.id });
    return P.balance(c, id);
  });
  await audit(req, 'points_adjust', id, { amt, memo });
  res.json({ balance: bal });
}));
r.post('/members/:id/temp-password', ah(async (req, res) => {
  const id = int(req.params.id);
  const u = await one(`SELECT id, email FROM users WHERE id=$1 AND status='active'`, [id]);
  if (!u || !u.email) throw bad('이메일로 가입한 회원만 임시 비밀번호를 만들 수 있습니다.');
  const pw = 'so' + crypto.randomInt(100000, 999999) + rid(3).replace(/[^A-Za-z0-9]/g, 'k');
  await q(`UPDATE users SET password_hash=$2, token_ver=token_ver+1 WHERE id=$1`, [id, A.hashPassword(pw)]);
  await audit(req, 'temp_password', id);
  res.json({ password: pw });
}));
r.get('/points', ah(async (req, res) => {
  const p = [], w = [];
  if (req.query.kind && req.query.kind !== 'all') { p.push(req.query.kind); w.push(`t.kind=$${p.length}`); }
  const rows = await all(`SELECT t.id, t.user_id, t.amount, t.kind, t.memo, t.expires_at, t.created_at, u.name, u.email, a.name AS admin_name
    FROM point_tx t JOIN users u ON u.id=t.user_id LEFT JOIN users a ON a.id=t.admin_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 300`, p);
  const sum = await one(`SELECT COALESCE(SUM(amount) FILTER (WHERE amount>0),0) AS issued, COALESCE(-SUM(amount) FILTER (WHERE kind IN ('use')),0) - COALESCE(SUM(amount) FILTER (WHERE kind='use_cancel'),0) AS used,
     COALESCE(-SUM(amount) FILTER (WHERE kind='expire'),0) AS expired, COALESCE(SUM(amount),0) AS outstanding FROM point_tx`);
  res.json({ rows, sum });
}));

/* ---------- 후기 ---------- */
r.get('/reviews', ah(async (req, res) => {
  const f = req.query.filter;
  const w = f === 'need' ? `WHERE r.reply='' AND NOT r.hidden` : f === 'hidden' ? 'WHERE r.hidden' : f === 'low' ? 'WHERE r.rating <= 2' : '';
  const rows = await all(`SELECT r.*, p.name AS place_name, b.code FROM reviews r LEFT JOIN places p ON p.id=r.place_id LEFT JOIN bookings b ON b.id=r.booking_id ${w} ORDER BY r.id DESC LIMIT 300`);
  const c = await one(`SELECT COUNT(*) AS all, COUNT(*) FILTER (WHERE reply='' AND NOT hidden) AS need, COUNT(*) FILTER (WHERE hidden) AS hidden, COUNT(*) FILTER (WHERE rating<=2) AS low, COALESCE(AVG(rating),0)::float AS avg FROM reviews`);
  res.json({ rows, counts: c });
}));
r.patch('/reviews/:id', ah(async (req, res) => {
  const id = int(req.params.id), b = req.body, sets = [], p = [id];
  if (b.reply !== undefined) { p.push(str(b.reply, 1000)); sets.push(`reply=$${p.length}`, `reply_at=CASE WHEN $${p.length}='' THEN NULL ELSE now() END`); }
  if (b.hidden !== undefined) { p.push(bool(b.hidden)); sets.push(`hidden=$${p.length}`); }
  if (!sets.length) throw bad('바꿀 내용이 없습니다.');
  const rv = await one(`UPDATE reviews SET ${sets.join(',')} WHERE id=$1 RETURNING *`, p);
  await audit(req, 'review_update', id, { hidden: b.hidden, reply: b.reply !== undefined });
  res.json(rv);
}));
r.delete('/reviews/:id', ah(async (req, res) => {
  await q(`DELETE FROM reviews WHERE id=$1`, [int(req.params.id)]);
  await audit(req, 'review_delete', req.params.id);
  res.json({ ok: true });
}));

/* ---------- 광고 배너 ---------- */
const SLOTS = ['home', 'list', 'detail'];
r.get('/banners', ah(async (req, res) => {
  const days = [7, 30, 90, 365].includes(int(req.query.days)) ? int(req.query.days) : 30;
  const rows = await all(`SELECT b.*, COALESCE(s.imp,0) AS imp, COALESCE(s.clk,0) AS clk, COALESCE(t.imp,0) AS imp_all, COALESCE(t.clk,0) AS clk_all FROM banners b
    LEFT JOIN (SELECT banner_id, SUM(imp) AS imp, SUM(clk) AS clk FROM ad_stats WHERE day > $1::date - $2::int GROUP BY banner_id) s ON s.banner_id=b.id
    LEFT JOIN (SELECT banner_id, SUM(imp) AS imp, SUM(clk) AS clk FROM ad_stats GROUP BY banner_id) t ON t.banner_id=b.id ORDER BY b.id DESC`, [today(), days]);
  const daily = await all(`SELECT day, SUM(imp) AS imp, SUM(clk) AS clk FROM ad_stats WHERE day > $1::date - $2::int GROUP BY day ORDER BY day`, [today(), days]);
  res.json({ rows, daily, days, today: today() });
}));
r.get('/banners.csv', ah(async (req, res) => {
  const rows = await all(`SELECT b.title, b.advertiser, b.slot, b.start_date, b.end_date, b.fee, s.day, s.imp, s.clk FROM ad_stats s JOIN banners b ON b.id=s.banner_id ORDER BY b.id, s.day`);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ad-report-${today()}.csv"` })
    .send(csv([['배너', '광고주', '구좌', '시작', '종료', '계약금', '날짜', '노출', '클릭'], ...rows.map(x => [x.title, x.advertiser, x.slot, x.start_date, x.end_date, x.fee, x.day, x.imp, x.clk])]));
}));
function bannerBody(b) {
  const v = { title: str(b.title, 60), sub: str(b.sub, 80), advertiser: str(b.advertiser, 60), contact: str(b.contact, 80), slot: SLOTS.includes(b.slot) ? b.slot : 'home',
    image: imgIds([b.image])[0] || null, link: /^https?:\/\//i.test(b.link || '') ? str(b.link, 500) : '', bg: /^#[0-9a-f]{6}$/i.test(b.bg || '') ? b.bg : '#3b4bdf',
    start_date: isDate(b.start_date) ? b.start_date : today(), end_date: isDate(b.end_date) ? b.end_date : addDays(today(), 30),
    fee: Math.max(0, int(b.fee)), priority: Math.max(0, Math.min(99, int(b.priority))), active: b.active === undefined ? true : bool(b.active) };
  if (!v.title) throw bad('배너 제목을 입력해 주세요.');
  if (v.end_date < v.start_date) throw bad('종료일이 시작일보다 빠릅니다.');
  return v;
}
const BCOLS = ['title', 'sub', 'advertiser', 'contact', 'slot', 'image', 'link', 'bg', 'start_date', 'end_date', 'fee', 'priority', 'active'];
r.post('/banners', ah(async (req, res) => {
  const v = bannerBody(req.body);
  const b = await one(`INSERT INTO banners(${BCOLS.join(',')}) VALUES(${BCOLS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, BCOLS.map(k => v[k]));
  await audit(req, 'banner_create', b.id, { title: b.title, fee: b.fee });
  res.json(b);
}));
r.put('/banners/:id', ah(async (req, res) => {
  const v = bannerBody(req.body);
  const b = await one(`UPDATE banners SET ${BCOLS.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [int(req.params.id), ...BCOLS.map(k => v[k])]);
  if (!b) throw new HttpError(404, '배너를 찾을 수 없습니다.');
  await audit(req, 'banner_update', b.id);
  res.json(b);
}));
r.delete('/banners/:id', ah(async (req, res) => {
  await q(`DELETE FROM banners WHERE id=$1`, [int(req.params.id)]);
  await audit(req, 'banner_delete', req.params.id);
  res.json({ ok: true });
}));

/* ---------- 설정 ---------- */
r.get('/settings', ah(async (req, res) => {
  const s = await getSettings();
  res.json({ settings: s, pay: pay.publicConfig(), login: { google: A.oauth.google.enabled(), kakao: A.oauth.kakao.enabled() },
    env: { baseUrl: A.baseUrl(req), sessionSecret: !!process.env.SESSION_SECRET, adminEmails: !!process.env.ADMIN_EMAILS } });
}));
r.put('/settings', ah(async (req, res) => {
  const b = req.body, cur = await getSettings();
  const pts = b.points || {};
  const rules = Array.isArray(b.cancelRules) ? b.cancelRules.map(x => ({ days: Math.max(0, int(x.days)), rate: Math.max(0, Math.min(100, int(x.rate))) })).slice(0, 10) : cur.cancelRules;
  if (!rules.some(x => x.days === 0)) rules.push({ days: 0, rate: 0 });
  const v = {
    brand: str(b.brand, 20) || DEFAULTS.brand, color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : cur.color,
    phone: str(b.phone, 30), adContact: str(b.adContact, 80), email: str(b.email, 80),
    payMethods: (Array.isArray(b.payMethods) ? b.payMethods : []).filter(m => ['card', 'bank', 'site'].includes(m)),
    bank: str(b.bank, 120), bankDeadlineHours: Math.max(0, Math.min(168, int(b.bankDeadlineHours, 24))), payDeadline: str(b.payDeadline, 300),
    cardHoldMinutes: Math.max(5, Math.min(60, int(b.cardHoldMinutes, 15))),
    cancelRules: rules, cancelNote: str(b.cancelNote, 300),
    points: { signupBonus: Math.max(0, int(pts.signupBonus)), earnRate: Math.max(0, Math.min(30, Number(pts.earnRate) || 0)), reviewBonus: Math.max(0, int(pts.reviewBonus)),
      minUse: Math.max(0, int(pts.minUse)), maxUseRate: Math.max(0, Math.min(100, int(pts.maxUseRate))), unit: Math.max(1, int(pts.unit, 100)), expireDays: Math.max(30, int(pts.expireDays, 365)) },
    company: str(b.company, 60), ceo: str(b.ceo, 30), bizNo: str(b.bizNo, 30), saleNo: str(b.saleNo, 40), address: str(b.address, 150), privacyOfficer: str(b.privacyOfficer, 60),
    termsService: str(b.termsService, 20000) || DEFAULTS.termsService, termsPrivacy: str(b.termsPrivacy, 20000) || DEFAULTS.termsPrivacy
  };
  if (!v.payMethods.length) throw bad('결제 방법을 하나 이상 켜주세요.');
  await saveSettings(v);
  await audit(req, 'settings_update', '');
  res.json({ settings: await getSettings() });
}));

r.get('/audit', ah(async (req, res) => {
  res.json(await all(`SELECT l.*, u.name AS admin_name, u.email AS admin_email FROM audit_log l LEFT JOIN users u ON u.id=l.admin_id ORDER BY l.id DESC LIMIT 300`));
}));
