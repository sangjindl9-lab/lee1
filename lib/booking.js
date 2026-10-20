import { tx, all } from './db.js';
import * as P from './points.js';
import * as pay from './pay/index.js';
import { getSettings } from './settings.js';
import { HttpError, bad, today, nightsList, isWeekendNight, isDate, daysBetween, bookingCode, rid, str, int, normPhone, fmtPhone } from './util.js';

export const nightPrice = (room, night, row) =>
  row && row.price != null ? row.price : (isWeekendNight(night) && room.weekend_price ? room.weekend_price : room.price);

/** 날짜별 재고 행을 만들고 잠근다 (동시에 들어온 예약은 여기서 줄을 선다) */
async function lockNights(c, roomId, nights) {
  await c.query(`INSERT INTO room_nights(room_id, night) SELECT $1, d::date FROM unnest($2::date[]) d ON CONFLICT DO NOTHING`, [roomId, nights]);
  const rows = (await c.query(`SELECT * FROM room_nights WHERE room_id=$1 AND night = ANY($2::date[]) ORDER BY night FOR UPDATE`, [roomId, nights])).rows;
  return Object.fromEntries(rows.map(r => [r.night, r]));
}

/** 취소 규정 적용 비율 */
export function policyRate(s, checkIn) {
  const d = daysBetween(today(), checkIn);
  const rules = [...(s.cancelRules || [])].sort((a, b) => b.days - a.days);
  for (const r of rules) if (d >= r.days) return { rate: r.rate, daysBefore: d };
  return { rate: 0, daysBefore: d };
}

/* ---------- 예약 생성 ---------- */
export async function createBooking(user, body) {
  const s = await getSettings();
  const roomId = int(body.roomId), checkIn = body.checkIn, checkOut = body.checkOut;
  if (!isDate(checkIn) || !isDate(checkOut)) throw bad('날짜가 올바르지 않습니다.');
  const n = daysBetween(checkIn, checkOut);
  if (checkIn < today()) throw bad('지난 날짜는 예약할 수 없습니다.');
  if (n < 1 || n > 14) throw bad('1박부터 14박까지 예약할 수 있습니다.');
  if (daysBetween(today(), checkIn) > 365) throw bad('1년 이내 날짜만 예약할 수 있습니다.');
  const adults = int(body.adults), children = int(body.children);
  if (adults < 1 || adults > 20 || children < 0 || children > 10) throw bad('인원이 올바르지 않습니다.');
  const guestName = str(body.guestName, 30), phone = fmtPhone(body.phone);
  if (!guestName) throw bad('예약자 이름을 입력하세요.');
  if (normPhone(phone).length < 10) throw bad('휴대폰 번호를 확인해 주세요.');
  const visit = ['도보', '차량'].includes(body.visit) ? body.visit : '도보';
  const request = str(body.request, 300);
  let method = String(body.payMethod || '');
  if (!s.payMethods.includes(method)) throw bad('선택할 수 없는 결제 방법입니다.');
  const prov = pay.current();
  if (method === 'card' && !prov.ready()) throw bad('카드 결제가 아직 준비되지 않았습니다.');
  const wantPoints = int(body.points);

  return tx(async c => {
    const room = (await c.query(
      `SELECT r.*, p.name AS place_name, p.active AS place_active FROM rooms r JOIN places p ON p.id=r.place_id WHERE r.id=$1`, [roomId])).rows[0];
    if (!room || !room.active || !room.place_active) throw bad('예약할 수 없는 객실입니다.');
    if (adults + children > room.max) throw bad(`이 객실은 최대 ${room.max}명까지 이용할 수 있습니다.`);
    const nights = nightsList(checkIn, checkOut);
    const rows = await lockNights(c, room.id, nights);
    const lines = [];
    for (const d of nights) {
      const r = rows[d];
      if (r.closed || r.booked >= room.stock) throw new HttpError(409, `${d.slice(5).replace('-', '/')} 객실이 마감되었습니다. 다른 날짜나 객실을 선택해 주세요.`, 'soldout');
      lines.push({ date: d, price: nightPrice(room, d, r) });
    }
    const total = lines.reduce((a, x) => a + x.price, 0);
    const have = wantPoints ? await P.balance(c, user.id) : 0;
    const points = P.validateUse(s.points, wantPoints, total, have);
    const due = total - points;
    if (due === 0) method = 'points';
    const status = method === 'card' ? 'pending' : method === 'bank' ? 'wait' : 'ok';
    const hold = method === 'card' ? new Date(Date.now() + int(s.cardHoldMinutes, 15) * 60e3) : null;

    await c.query(`UPDATE room_nights SET booked = booked + 1 WHERE room_id=$1 AND night = ANY($2::date[])`, [room.id, nights]);
    const b = (await c.query(
      `INSERT INTO bookings(code,user_id,place_id,room_id,place_name,room_name,check_in,check_out,nights,adults,children,guest_name,phone,visit,request,lines,total,points_used,amount_due,pay_method,status,hold_until)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [bookingCode(), user.id, room.place_id, room.id, room.place_name, room.name, checkIn, checkOut, n, adults, children,
       guestName, phone, visit, request, JSON.stringify(lines), total, points, due, method, status, hold])).rows[0];
    if (points) await P.take(c, user.id, points, 'use', { bookingId: b.id, memo: `${room.place_name} 예약` });
    let payment = null;
    if (method !== 'points') {
      const provider = method === 'card' ? prov.name : method;
      payment = (await c.query(
        `INSERT INTO payments(booking_id,user_id,order_id,provider,method,amount,status) VALUES($1,$2,$3,$4,$5,$6,'ready') RETURNING *`,
        [b.id, user.id, `${b.code}-${rid(4).replace(/[^A-Za-z0-9]/g, 'x')}`, provider, method, due])).rows[0];
    }
    return { booking: b, payment };
  });
}

/* ---------- 카드 결제 승인 ---------- */
export async function confirmPayment(user, { orderId, paymentKey, amount }) {
  return tx(async c => {
    const p = (await c.query(`SELECT * FROM payments WHERE order_id=$1 FOR UPDATE`, [String(orderId || '')])).rows[0];
    if (!p || (user && p.user_id !== user.id)) throw bad('결제 정보를 찾을 수 없습니다.');
    const b = (await c.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [p.booking_id])).rows[0];
    if (p.status === 'paid') return { ok: true, booking: b };
    if (p.status !== 'ready' || p.method !== 'card') throw bad('이미 처리된 결제입니다.');
    if (int(amount) !== p.amount) throw bad('결제 금액이 일치하지 않습니다.');
    const prov = pay.byName(p.provider);
    const r = await prov.confirm({ paymentKey: String(paymentKey || ''), orderId: p.order_id, amount: p.amount });
    if (!r.ok) {
      await c.query(`UPDATE payments SET status='failed', fail_reason=$2, raw=$3 WHERE id=$1`, [p.id, r.message || '', r.raw ? JSON.stringify(r.raw) : null]);
      if (b.status === 'pending') await cancelInTx(c, b, { by: 'system', reason: '결제 실패', mode: 'full' });
      return { ok: false, message: r.message || '결제에 실패했습니다.' };
    }
    if (b.status !== 'pending') {
      // 결제창에 머무는 사이 예약 유효시간이 지나 취소된 경우: 승인된 결제를 바로 되돌린다
      await prov.cancel({ paymentKey: r.paymentKey, amount: p.amount, reason: '예약 유효시간 초과' });
      await c.query(`UPDATE payments SET status='cancelled', payment_key=$2, cancelled_amount=amount, cancelled_at=now(), raw=$3 WHERE id=$1`, [p.id, r.paymentKey, JSON.stringify(r.raw || {})]);
      return { ok: false, message: '결제 시간이 지나 예약이 취소되었습니다. 결제는 자동으로 취소됩니다.' };
    }
    await c.query(`UPDATE payments SET status='paid', payment_key=$2, receipt_url=$3, raw=$4, paid_at=now() WHERE id=$1`,
      [p.id, r.paymentKey, r.receiptUrl || '', JSON.stringify(r.raw || {})]);
    const nb = (await c.query(`UPDATE bookings SET status='ok', hold_until=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [b.id])).rows[0];
    return { ok: true, booking: nb };
  });
}

export async function failPayment(user, orderId, message) {
  return tx(async c => {
    const p = (await c.query(`SELECT * FROM payments WHERE order_id=$1 FOR UPDATE`, [String(orderId || '')])).rows[0];
    if (!p || p.user_id !== user.id || p.status !== 'ready') return null;
    await c.query(`UPDATE payments SET status='failed', fail_reason=$2 WHERE id=$1`, [p.id, str(message, 200) || '결제 취소']);
    const b = (await c.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [p.booking_id])).rows[0];
    if (b && b.status === 'pending') await cancelInTx(c, b, { by: 'system', reason: '결제 취소·실패', mode: 'full' });
    return b;
  });
}

/* ---------- 취소·환불 ---------- */
/** 취소하면 얼마나 돌려받는지 미리 계산 */
export async function cancelPreview(c, b, mode = 'policy') {
  const s = await getSettings();
  const pays = (await c.query(`SELECT * FROM payments WHERE booking_id=$1`, [b.id])).rows;
  const paid = pays.find(p => p.status === 'paid');
  let rate, daysBefore = daysBetween(today(), b.check_in);
  if (b.status === 'pending' || b.status === 'wait') rate = 100;           // 아직 결제 전
  else if (mode === 'full') rate = 100;
  else if (mode === 'none') rate = 0;
  else rate = policyRate(s, b.check_in).rate;
  return { rate, daysBefore, paid: paid ? paid.amount : 0, refundCash: paid ? Math.round(paid.amount * rate / 100) : 0,
    refundPoints: Math.floor(b.points_used * rate / 100), payMethod: b.pay_method, manual: !!(paid && paid.provider === 'bank') };
}

export async function cancelInTx(c, b, { by, reason, mode = 'policy' }) {
  if (b.status === 'cancel') throw bad('이미 취소된 예약입니다.');
  const pv = await cancelPreview(c, b, mode);
  const pays = (await c.query(`SELECT * FROM payments WHERE booking_id=$1 FOR UPDATE`, [b.id])).rows;
  const paid = pays.find(p => p.status === 'paid');
  if (paid && pv.refundCash > 0) {
    if (paid.provider === 'bank') {
      await c.query(`UPDATE payments SET status='refund_pending', cancelled_amount=$2 WHERE id=$1`, [paid.id, pv.refundCash]);
    } else {
      const r = await pay.byName(paid.provider).cancel({ paymentKey: paid.payment_key, amount: pv.refundCash, reason: reason || '예약 취소' });
      if (!r.ok) throw new HttpError(502, '카드 결제 취소에 실패했습니다. 잠시 후 다시 시도하거나 고객센터로 문의하세요. (' + (r.message || '') + ')');
      await c.query(`UPDATE payments SET status=$2, cancelled_amount=$3, cancelled_at=now() WHERE id=$1`,
        [paid.id, pv.refundCash === paid.amount ? 'cancelled' : 'partial_cancelled', pv.refundCash]);
    }
  } else if (paid) {
    await c.query(`UPDATE payments SET status='kept', cancelled_at=now() WHERE id=$1`, [paid.id]); // 환불 없음(규정상)
  }
  await c.query(`UPDATE payments SET status='cancelled', cancelled_at=now() WHERE booking_id=$1 AND status='ready'`, [b.id]);
  if (b.user_id) {
    const s = await getSettings();
    if (pv.refundPoints > 0) await P.add(c, b.user_id, pv.refundPoints, 'use_cancel', { bookingId: b.id, memo: `${b.place_name} 예약 취소 반환`, expireDays: s.points.expireDays });
    if (b.points_earned > 0) await P.take(c, b.user_id, b.points_earned, 'earn_cancel', { bookingId: b.id, memo: '예약 취소로 적립 회수', strict: false });
  }
  await c.query(`UPDATE room_nights SET booked = GREATEST(booked - 1, 0) WHERE room_id=$1 AND night = ANY($2::date[])`,
    [b.room_id, nightsList(b.check_in, b.check_out)]);
  return (await c.query(
    `UPDATE bookings SET status='cancel', refund_amount=$2, refund_points=$3, cancel_reason=$4, cancelled_by=$5, hold_until=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
    [b.id, pv.refundCash, pv.refundPoints, str(reason, 200), by])).rows[0];
}

export async function cancelBooking(bookingId, opts) {
  return tx(async c => {
    const b = (await c.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0];
    if (!b) throw bad('예약을 찾을 수 없습니다.');
    if (opts.userId && b.user_id !== opts.userId) throw bad('예약을 찾을 수 없습니다.');
    if (opts.by === 'guest') {
      if (!['pending', 'wait', 'ok'].includes(b.status)) throw bad('취소할 수 없는 상태입니다.');
      if (b.check_in <= today()) throw bad('체크인 당일부터는 앱에서 취소할 수 없습니다. 숙소나 고객센터로 문의하세요.');
    }
    return cancelInTx(c, b, opts);
  });
}

/* ---------- 상태 변경 ---------- */
export async function markDone(c, b) {
  const s = await getSettings();
  let earned = 0;
  if (b.user_id && b.amount_due > 0 && s.points.earnRate > 0) {
    earned = Math.floor(b.amount_due * s.points.earnRate / 100 / 10) * 10;
    if (earned > 0) await P.add(c, b.user_id, earned, 'earn', { bookingId: b.id, memo: `${b.place_name} 이용 적립`, expireDays: s.points.expireDays });
  }
  return (await c.query(`UPDATE bookings SET status='done', points_earned=$2, updated_at=now() WHERE id=$1 RETURNING *`, [b.id, earned])).rows[0];
}

export async function adminSetStatus(bookingId, status) {
  return tx(async c => {
    const b = (await c.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId])).rows[0];
    if (!b) throw bad('예약을 찾을 수 없습니다.');
    if (status === 'ok') {
      if (b.status !== 'wait') throw bad('입금대기 예약만 확정할 수 있습니다.');
      await c.query(`UPDATE payments SET status='paid', paid_at=now() WHERE booking_id=$1 AND status='ready' AND method='bank'`, [b.id]);
      return (await c.query(`UPDATE bookings SET status='ok', updated_at=now() WHERE id=$1 RETURNING *`, [b.id])).rows[0];
    }
    if (status === 'done') {
      if (b.status !== 'ok') throw bad('예약확정 상태만 이용완료로 바꿀 수 있습니다.');
      if (b.pay_method === 'site') await c.query(`UPDATE payments SET status='paid', paid_at=now() WHERE booking_id=$1 AND status='ready'`, [b.id]);
      return markDone(c, b);
    }
    throw bad('바꿀 수 없는 상태입니다.');
  });
}

/* ---------- 주기 작업: 결제 시간 초과·미입금 자동취소, 이용완료 처리, 포인트 소멸 ---------- */
export async function sweep() {
  const s = await getSettings();
  const expired = await all(`SELECT id FROM bookings WHERE status='pending' AND hold_until < now()`);
  for (const r of expired) await cancelBooking(r.id, { by: 'system', reason: '결제 시간 초과', mode: 'full' }).catch(e => console.error('sweep pending', e.message));
  if (s.bankDeadlineHours > 0) {
    const unpaid = await all(`SELECT id FROM bookings WHERE status='wait' AND created_at < now() - ($1 || ' hours')::interval`, [String(s.bankDeadlineHours)]);
    for (const r of unpaid) await cancelBooking(r.id, { by: 'system', reason: '미입금 자동 취소', mode: 'full' }).catch(e => console.error('sweep bank', e.message));
  }
  const finished = await all(`SELECT id FROM bookings WHERE status='ok' AND check_out <= $1`, [today()]);
  for (const r of finished) await tx(async c => {
    const b = (await c.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [r.id])).rows[0];
    if (b && b.status === 'ok') {
      if (b.pay_method === 'site') await c.query(`UPDATE payments SET status='paid', paid_at=now() WHERE booking_id=$1 AND status='ready'`, [b.id]);
      await markDone(c, b);
    }
  }).catch(e => console.error('sweep done', e.message));
  await tx(c => P.expireDue(c, null)).catch(e => console.error('sweep expire', e.message));
}
