import { HttpError } from './util.js';

/**
 * 포인트 원장 규칙
 * - 잔액 = point_tx.amount 합계
 * - 양수(적립) 행은 remaining(남은 양)과 expires_at(소멸일)을 가진다
 * - 사용·차감은 소멸일이 빠른 적립분부터 remaining 을 줄인다 (선입선출)
 * - 소멸일이 지난 remaining 은 'expire' 행으로 차감한다
 */

export async function expireDue(c, userId) {
  const rows = (await c.query(
    `SELECT id, user_id, remaining FROM point_tx WHERE remaining > 0 AND expires_at < now() ${userId ? 'AND user_id=$1' : ''} FOR UPDATE`,
    userId ? [userId] : [])).rows;
  for (const r of rows) {
    await c.query(`UPDATE point_tx SET remaining=0 WHERE id=$1`, [r.id]);
    await c.query(`INSERT INTO point_tx(user_id, amount, kind, memo, detail) VALUES($1,$2,'expire','유효기간 만료',$3)`,
      [r.user_id, -r.remaining, JSON.stringify([{ id: r.id, n: r.remaining }])]);
  }
  return rows.length;
}

export async function balance(c, userId) {
  await expireDue(c, userId);
  const r = await c.query(`SELECT COALESCE(SUM(amount),0) AS b FROM point_tx WHERE user_id=$1`, [userId]);
  return r.rows[0].b;
}

/** 적립 (적립·가입·관리자 지급·사용취소 복원) */
export async function add(c, userId, amount, kind, { bookingId = null, memo = '', adminId = null, expireDays = 365 } = {}) {
  amount = Math.floor(amount);
  if (amount <= 0) return null;
  const r = await c.query(
    `INSERT INTO point_tx(user_id, amount, kind, remaining, expires_at, booking_id, memo, admin_id)
     VALUES($1,$2,$3,$2, now() + ($4 || ' days')::interval, $5, $6, $7) RETURNING id`,
    [userId, amount, kind, String(expireDays), bookingId, memo, adminId]);
  return r.rows[0].id;
}

/** 차감 (사용·관리자 차감·적립 취소). strict=false 면 잔액만큼만 차감 */
export async function take(c, userId, amount, kind, { bookingId = null, memo = '', adminId = null, strict = true } = {}) {
  amount = Math.floor(amount);
  if (amount <= 0) return 0;
  await expireDue(c, userId);
  const src = (await c.query(
    `SELECT id, remaining FROM point_tx WHERE user_id=$1 AND remaining > 0 ORDER BY expires_at NULLS LAST, id FOR UPDATE`, [userId])).rows;
  const have = src.reduce((s, r) => s + r.remaining, 0);
  if (have < amount) {
    if (strict) throw new HttpError(400, `포인트가 부족합니다. (보유 ${have.toLocaleString()}P)`);
    amount = have;
  }
  if (amount <= 0) return 0;
  let left = amount; const detail = [];
  for (const r of src) {
    if (!left) break;
    const n = Math.min(left, r.remaining);
    await c.query(`UPDATE point_tx SET remaining = remaining - $2 WHERE id=$1`, [r.id, n]);
    detail.push({ id: r.id, n }); left -= n;
  }
  await c.query(`INSERT INTO point_tx(user_id, amount, kind, booking_id, memo, detail, admin_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [userId, -amount, kind, bookingId, memo, JSON.stringify(detail), adminId]);
  return amount;
}

/** 예약에 쓸 수 있는 포인트 한도 */
export function usableLimit(policy, total, have) {
  const cap = Math.floor(total * (policy.maxUseRate || 0) / 100);
  const unit = Math.max(1, policy.unit || 1);
  return Math.floor(Math.min(cap, have) / unit) * unit;
}
export function validateUse(policy, want, total, have) {
  if (!want) return 0;
  if (want < 0) throw new HttpError(400, '포인트 금액이 올바르지 않습니다.');
  if (want < (policy.minUse || 0)) throw new HttpError(400, `포인트는 ${policy.minUse.toLocaleString()}P부터 쓸 수 있습니다.`);
  if (want % Math.max(1, policy.unit || 1)) throw new HttpError(400, `포인트는 ${policy.unit}P 단위로 쓸 수 있습니다.`);
  const lim = usableLimit(policy, total, have);
  if (want > lim) throw new HttpError(400, `이 예약에는 최대 ${lim.toLocaleString()}P까지 쓸 수 있습니다.`);
  return want;
}
