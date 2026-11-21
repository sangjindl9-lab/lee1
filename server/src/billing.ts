import type { FastifyInstance } from 'fastify';
import type { Db } from './db.js';
import { httpError, requireUser } from './auth.js';

/**
 * 기능 권한(entitlement) 시스템 — 결제와 분리. 지금은 무료로 시작하고, 구독을 켜면 plan 이 바뀐다.
 * 무료로 만든 노트는 구독이 끝나도 절대 삭제하지 않는다(한도는 "새 업로드·AI 요청"에만 적용).
 */
export const PLANS: Record<string, { storageBytes: number; aiDailyLimit: number; versionDays: number; collab: boolean; premiumTemplates: boolean }> = {
  free: { storageBytes: 2 * 1024 ** 3, aiDailyLimit: 20, versionDays: 30, collab: false, premiumTemplates: false },
  pro: { storageBytes: 100 * 1024 ** 3, aiDailyLimit: 300, versionDays: 365, collab: true, premiumTemplates: true },
};

export async function entitlements(db: Db, userId: string) {
  const s = (await db.query(`SELECT plan FROM subscriptions WHERE user_id=$1 AND state IN ('active','grace') AND (current_period_end IS NULL OR current_period_end > now() - interval '3 days')
    ORDER BY current_period_end DESC NULLS FIRST LIMIT 1`, [userId])).rows[0];
  const plan = s?.plan && PLANS[s.plan] ? s.plan : 'free';
  return { plan, ...PLANS[plan] };
}

export function billingRoutes(app: FastifyInstance, db: Db) {
  app.get('/v1/billing/entitlements', async (req) => entitlements(db, (await requireUser(req)).userId));

  /**
   * 스토어 구매 등록. 실제 영수증 검증은 Google Play Developer API / App Store Server API 자격 증명이 있어야 한다.
   * BILLING_VERIFY=off 인 개발 환경에서만 검증 없이 기록(운영에서는 503).
   */
  app.post('/v1/billing/purchase', async (req) => {
    const u = await requireUser(req);
    const b = req.body as any;
    if (process.env.BILLING_VERIFY !== 'off') throw httpError(503, 'store_verification_not_configured');
    const plan = PLANS[b?.plan] ? b.plan : 'pro';
    const sub = (await db.query(`INSERT INTO subscriptions(user_id, plan, store, state, current_period_end, entitlements) VALUES($1,$2,$3,'active', now() + interval '1 month', $4) RETURNING id`,
      [u.userId, plan, b.store === 'app_store' ? 'app_store' : 'google_play', JSON.stringify(PLANS[plan])])).rows[0].id;
    await db.query(`INSERT INTO purchases(user_id, subscription_id, store, product_id, purchase_token, state, raw) VALUES($1,$2,$3,$4,$5,'unverified_dev',$6)`,
      [u.userId, sub, b.store ?? 'google_play', String(b.productId ?? 'notepro_pro_monthly'), String(b.purchaseToken ?? sub), JSON.stringify(b)]);
    await db.query('UPDATE users SET storage_quota_bytes=$2 WHERE id=$1', [u.userId, PLANS[plan].storageBytes]);
    return entitlements(db, u.userId);
  });

  /** 구매 내역 복원 */
  app.get('/v1/billing/purchases', async (req) => {
    const u = await requireUser(req);
    return { purchases: (await db.query('SELECT store, product_id, state, created_at FROM purchases WHERE user_id=$1 ORDER BY created_at DESC', [u.userId])).rows };
  });
}
