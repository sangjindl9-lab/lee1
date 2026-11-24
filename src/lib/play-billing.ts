/**
 * Google Play 정기결제 서버 검증.
 *
 * 원칙
 * - 권한(요금제)은 언제나 Google Play Developer API 의 최신 상태를 근거로 정한다. 앱·알림이 보낸 값은 "다시 확인하라"는 신호일 뿐이다.
 * - 같은 구매 토큰은 DB 잠금(pg_advisory_xact_lock) 안에서 한 번에 하나씩만 처리한다 → 중복 요청·알림이 동시에 와도 결과가 같다(멱등).
 * - 구매 토큰의 주인(가족)은 서버가 결제 전에 발급한 구매 식별자(PurchaseIntent.id = obfuscatedAccountId)로만 정한다.
 *   주인을 확인할 수 없는 토큰은 어떤 가족에게도 자동으로 연결하지 않는다.
 * - Google 장애(일시 오류)와 실제 만료를 구분한다. 장애 때는 만료 후 최대 OUTAGE_GRACE_MS 동안 기존 권한을 유지한다.
 *
 * 필요한 환경변수: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (서비스 계정 키 JSON), PLAY_PACKAGE_NAME
 */
import { GoogleAuth } from "google-auth-library";
import type { Prisma, PrismaClient, Subscription } from "@prisma/client";
import prisma from "./db";
import { PLANS, planByProduct, type PlanId } from "./plans";

export const PACKAGE = process.env.PLAY_PACKAGE_NAME ?? "kr.eumsoft.familyalbum";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

/** Google 확인이 장애로 실패할 때, 만료 시각이 지나도 기존 권한을 유지하는 최대 시간 */
export const OUTAGE_GRACE_MS = 72 * 3600 * 1000;
/** 결제 시작 기록(가족 단위 결제 잠금)의 유효 시간 */
export const INTENT_TTL_MS = 30 * 60 * 1000;

export class BillingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    /** true 면 잠시 후 다시 시도하면 성공할 수 있는 일시적 오류 (Google 장애·네트워크·DB) */
    public retryable = false,
  ) {
    super(message);
  }
}

export function isRetryable(e: unknown): boolean {
  if (e instanceof BillingError) return e.retryable;
  return true; // 알 수 없는 오류(DB·네트워크)는 다시 시도해 볼 가치가 있다
}

// ───────────────────────── Google Play API (테스트에서 교체 가능) ─────────────────────────

export type SubscriptionV2 = {
  subscriptionState?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string; obfuscatedExternalProfileId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string };
  }>;
};

export interface PlayApi {
  getSubscription(purchaseToken: string): Promise<SubscriptionV2>;
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
}

let auth: GoogleAuth | null = null;
async function authedFetch(url: string, init: RequestInit = {}) {
  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
    throw new BillingError("STORE_NOT_CONFIGURED", "결제 검증 설정이 아직 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.", 503, true);
  }
  if (!auth) {
    auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
  }
  try {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
    });
  } catch (e) {
    throw new BillingError("PLAY_API_UNREACHABLE", `Google Play 에 연결하지 못했습니다. (${e instanceof Error ? e.message : e})`, 503, true);
  }
}

/** HTTP 상태를 일시/영구 오류로 나눈다 */
function playHttpError(status: number, what: string): BillingError {
  if (status === 400 || status === 404 || status === 410) {
    return new BillingError("TOKEN_INVALID", "결제 정보를 찾을 수 없습니다.", 404, false);
  }
  // 401/403(권한 설정)·429(한도)·5xx(장애)는 다시 시도하면 풀릴 수 있다
  return new BillingError("PLAY_API_ERROR", `Google Play ${what} 실패 (${status})`, 503, true);
}

const googlePlayApi: PlayApi = {
  async getSubscription(purchaseToken) {
    const res = await authedFetch(`${API}/${PACKAGE}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`);
    if (!res.ok) throw playHttpError(res.status, "구독 확인");
    return (await res.json()) as SubscriptionV2;
  },
  async acknowledge(productId, purchaseToken) {
    const res = await authedFetch(
      `${API}/${PACKAGE}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
      { method: "POST", body: "{}" },
    );
    if (res.ok) return;
    if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403) throw playHttpError(res.status, "결제 승인");
    // 400/409 등: '이미 승인됨'일 수도, 진짜 실패일 수도 있다 → 호출한 쪽이 최신 상태를 다시 확인한다
    throw new BillingError("ACK_REJECTED", `결제 승인 요청이 거절되었습니다 (${res.status})`, 502, true);
  },
};

let playApi: PlayApi = googlePlayApi;
let playApiOverridden = false;

/** 테스트 전용: Google API 대신 가짜(Mock)를 쓴다. null 이면 원래대로. */
export function __setPlayApiForTests(api: PlayApi | null) {
  playApi = api ?? googlePlayApi;
  playApiOverridden = api !== null;
}

export function playConfigured(): boolean {
  return playApiOverridden || Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
}

// ───────────────────────── 상태 해석 ─────────────────────────

/** 만료 시각 전까지 권한을 주는 상태 (해지했어도 결제한 기간은 쓴다) */
export const ENTITLED_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  "SUBSCRIPTION_STATE_CANCELED",
]);
/** 결제가 끝났고 승인(acknowledge)이 필요한 상태 */
const ACK_STATES = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"]);
/** 우리 쪽에서만 쓰는 상태: 다시 계산 대상에서 빠진다 */
const INACTIVE_LOCAL_STATES = ["REPLACED", "FAMILY_DELETED", "REVOKED"];

const RANK: Record<PlanId, number> = { FREE: 0, FAMILY_50: 1, FAMILY_200: 2, FAMILY_1TB: 3 };

function latestExpiry(data: SubscriptionV2): Date | null {
  let best: number | null = null;
  for (const li of data.lineItems ?? []) {
    const t = li.expiryTime ? Date.parse(li.expiryTime) : NaN;
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best);
}

/** 이 구독이 지금 권한을 주는가 (DB 기록만으로 판단, 네트워크 없음) */
export function grantsNow(s: Pick<Subscription, "state" | "expiresAt" | "lastCheckError">, now = Date.now()): { ok: boolean; unverified: boolean } {
  if (!ENTITLED_STATES.has(s.state) || !s.expiresAt) return { ok: false, unverified: false };
  const exp = s.expiresAt.getTime();
  if (exp > now) return { ok: true, unverified: false };
  // 만료 시각은 지났지만, 마지막 확인이 Google 장애로 실패했다면 잠시 유지한다 (장애 ≠ 만료)
  if (s.lastCheckError && exp + OUTAGE_GRACE_MS > now) return { ok: true, unverified: true };
  return { ok: false, unverified: false };
}

// ───────────────────────── 잠금 ─────────────────────────

type Db = PrismaClient | Prisma.TransactionClient;

/** 같은 키(구매 토큰·가족)에 대해 한 번에 하나만 실행한다. 트랜잭션이 끝나면 잠금이 풀린다. */
export async function withLock<T>(key: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      return fn(tx);
    },
    { maxWait: 60_000, timeout: 60_000 },
  );
}

// ───────────────────────── 구매 확인 ─────────────────────────

export type VerifySource = "app" | "restore" | "rtdn" | "recheck";

export type VerifyResult = {
  sub: Subscription;
  stale: boolean;
  plan: { plan: PlanId; expiresAt: Date | null; unverified: boolean };
};

/**
 * 구매 토큰을 Google 에 확인해 구독 기록을 저장하고 가족 요금제를 다시 계산한다. 몇 번을 불러도 결과가 같다.
 * - familyId 를 주면(앱에서 부른 경우) 그 가족의 구독이 맞는지 확인한다.
 * - eventTime 을 주면(실시간 알림) 이미 더 최신 정보를 반영했는지 보고 옛 알림은 건너뛴다.
 */
export async function verifyAndApply(input: {
  purchaseToken: string;
  userId?: string;
  familyId?: string;
  source?: VerifySource;
  eventTime?: bigint | null;
}): Promise<VerifyResult> {
  const token = input.purchaseToken;
  // 승인 실패는 트랜잭션을 되돌리지 않고(권한·기록은 남김) 잠금이 끝난 뒤 알린다 → 재확인 작업·재전송이 다시 승인한다
  const ack: { error?: unknown } = {};

  let result: VerifyResult;
  try {
    result = await withLock(`sub:${token}`, async (tx) => {
      const existing = await tx.subscription.findUnique({ where: { purchaseToken: token } });

      // 순서가 뒤바뀐 옛 알림: 그 뒤에 이미 Google 에서 최신 상태를 받아 두었다면 다시 볼 필요 없다
      if (input.eventTime != null && existing) {
        const checkedAt = BigInt(existing.lastCheckedAt.getTime());
        const seen = existing.lastEventTime ?? BigInt(0);
        if (input.eventTime <= seen && checkedAt >= input.eventTime && !existing.lastCheckError) {
          return { sub: existing, stale: true, plan: await recomputeFamilyPlan(existing.familyId, tx) };
        }
      }

      const data = await playApi.getSubscription(token);
      const line = data.lineItems?.[0];
      const productId = line?.productId ?? "";
      const plan = planByProduct(productId);
      if (!plan) throw new BillingError("UNKNOWN_PRODUCT", "알 수 없는 상품입니다.", 400);

      const owner = await resolveOwner(tx, data, existing, input);
      const state = existing?.revokedAt ? "REVOKED" : data.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED";
      const expiresAt = latestExpiry(data);
      const acknowledged = data.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
      const eventTime =
        input.eventTime != null && (existing?.lastEventTime == null || input.eventTime > existing.lastEventTime)
          ? input.eventTime
          : existing?.lastEventTime ?? null;
      const fields = {
        productId,
        basePlanId: line?.offerDetails?.basePlanId ?? null,
        plan: plan.id,
        state,
        autoRenewing: line?.autoRenewingPlan?.autoRenewEnabled ?? false,
        expiresAt,
        acknowledged,
        linkedToken: data.linkedPurchaseToken ?? null,
        lastCheckedAt: new Date(),
        lastCheckError: null,
        lastEventTime: eventTime,
        raw: JSON.stringify(data).slice(0, 8000),
      };
      const sub = existing
        ? await tx.subscription.update({ where: { id: existing.id }, data: fields })
        : await tx.subscription.create({
            data: { ...fields, familyId: owner.familyId, userId: owner.userId, purchaseToken: token, intentId: owner.intentId },
          });

      // 요금제 변경: 새 구독이 실제로 권한을 줄 때만 이전 구독을 REPLACED 로 바꾼다 (결제 대기·실패면 그대로 둔다)
      if (data.linkedPurchaseToken && grantsNow(sub).ok) {
        await tx.subscription.updateMany({
          where: { purchaseToken: data.linkedPurchaseToken, familyId: sub.familyId },
          data: { state: "REPLACED" },
        });
      }
      if (owner.intentId) {
        await tx.purchaseIntent.updateMany({
          where: { id: owner.intentId, status: { in: ["PENDING", "CANCELED", "EXPIRED"] } },
          data: { status: "COMPLETED", purchaseToken: token },
        });
      }
      const planNow = await recomputeFamilyPlan(sub.familyId, tx);
      // 권한을 준 다음 승인한다 (Google 권장 순서). 같은 토큰 잠금 안에서 하므로 동시에 두 번 승인하지 않는다.
      let finalSub = sub;
      if (ACK_STATES.has(state) && !acknowledged) {
        try {
          await acknowledgeVerified(productId, token);
          finalSub = await tx.subscription.update({ where: { id: sub.id }, data: { acknowledged: true } });
        } catch (e) {
          ack.error = e;
          finalSub = await tx.subscription.update({
            where: { id: sub.id },
            data: { lastCheckError: `ACK: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) },
          });
        }
      }
      return { sub: finalSub, stale: false, plan: planNow };
    });
  } catch (e) {
    // 일시 오류면 기록만 남긴다 (만료 판단 때 '장애'로 구분하기 위함)
    if (isRetryable(e)) {
      await prisma.subscription
        .updateMany({ where: { purchaseToken: token }, data: { lastCheckError: e instanceof Error ? e.message.slice(0, 300) : String(e) } })
        .catch(() => undefined);
    }
    throw e;
  }

  if (ack.error) throw ack.error;
  return result;
}

/**
 * 승인 요청. 400 등으로 거절되면 '이미 승인됨'인지 Google 에 다시 물어 실제 상태로 판단한다.
 * 승인 뒤 DB 기록이 실패해도 다음 확인 때 Google 의 승인 상태를 그대로 받아 오므로 자동으로 맞춰진다.
 */
async function acknowledgeVerified(productId: string, token: string) {
  try {
    await playApi.acknowledge(productId, token);
  } catch (e) {
    if (!(e instanceof BillingError) || e.code !== "ACK_REJECTED") throw e;
    const fresh = await playApi.getSubscription(token);
    if (fresh.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") throw e;
  }
}

/**
 * 구매 토큰의 주인(가족·결제자)을 정한다.
 * 1) 이미 기록된 토큰 → 기록된 가족
 * 2) obfuscatedAccountId 가 서버가 발급한 구매 식별자(PurchaseIntent) → 그 가족
 * 3) (이전 버전 앱) obfuscatedAccountId 가 가족 ID 그 자체 → 그 가족
 * 그 외에는 주인을 알 수 없으므로 연결하지 않는다.
 */
async function resolveOwner(
  tx: Prisma.TransactionClient,
  data: SubscriptionV2,
  existing: Subscription | null,
  input: { familyId?: string; userId?: string },
): Promise<{ familyId: string; userId: string; intentId: string | null }> {
  const acct = data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
  const profile = data.externalAccountIdentifiers?.obfuscatedExternalProfileId ?? null;
  let familyId: string | null = existing?.familyId ?? null;
  let userId: string | null = existing?.userId ?? null;
  let intentId: string | null = existing?.intentId ?? null;

  if (!familyId && acct) {
    const intent = await tx.purchaseIntent.findUnique({ where: { id: acct } });
    if (intent) {
      familyId = intent.familyId;
      userId = intent.userId;
      intentId = intent.id;
    } else {
      const legacy = await tx.family.findUnique({ where: { id: acct }, select: { id: true } });
      if (legacy) familyId = legacy.id;
    }
  }
  if (!familyId) {
    throw new BillingError("OWNERSHIP_UNKNOWN", "이 구독이 어느 가족의 결제인지 확인할 수 없어 연결하지 않았습니다.", 403);
  }
  if (input.familyId && input.familyId !== familyId) {
    throw new BillingError("FAMILY_MISMATCH", "다른 가족에서 결제한 구독입니다.", 403);
  }
  if (!userId) {
    const candidates = [profile, input.userId].filter(Boolean) as string[];
    for (const id of candidates) {
      const u = await tx.user.findFirst({ where: { id, familyId }, select: { id: true } });
      if (u) {
        userId = u.id;
        break;
      }
    }
  }
  if (!userId) {
    const parent = await tx.user.findFirst({ where: { familyId, role: "PARENT" }, select: { id: true } });
    userId = parent?.id ?? null;
  }
  if (!userId) throw new BillingError("NO_USER", "결제한 사용자를 확인할 수 없습니다.", 403);
  return { familyId, userId, intentId };
}

/** 환불·취소(voided) 알림: 그 토큰의 권한을 바로 거둔다. 사진은 지우지 않는다. */
export async function markRevoked(purchaseToken: string) {
  return withLock(`sub:${purchaseToken}`, async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { purchaseToken } });
    if (!sub) return null;
    await tx.subscription.update({ where: { id: sub.id }, data: { state: "REVOKED", revokedAt: new Date() } });
    return recomputeFamilyPlan(sub.familyId, tx);
  });
}

// ───────────────────────── 가족 요금제 계산 ─────────────────────────

/**
 * 가족의 유효한 구독으로 요금제를 정한다 (네트워크 없이 DB 기록만 사용).
 * - ACTIVE·유예·해지 모두 만료 시각을 검사한다.
 * - 가장 높은 요금제, 같은 요금제가 여럿이면 만료가 가장 늦은 것을 고른다.
 * - 요금제만 바꾸고 사진·앨범·기록은 절대 건드리지 않는다.
 */
export async function recomputeFamilyPlan(familyId: string, db: Db = prisma) {
  const subs = await db.subscription.findMany({ where: { familyId, state: { notIn: INACTIVE_LOCAL_STATES } } });
  const now = Date.now();
  let best: { plan: PlanId; expiresAt: Date | null; unverified: boolean } = { plan: "FREE", expiresAt: null, unverified: false };
  for (const s of subs) {
    const g = grantsNow(s, now);
    if (!g.ok) continue;
    const p = (s.plan in PLANS ? s.plan : "FREE") as PlanId;
    const better =
      RANK[p] > RANK[best.plan] ||
      (RANK[p] === RANK[best.plan] && (s.expiresAt?.getTime() ?? 0) > (best.expiresAt?.getTime() ?? 0));
    if (better) best = { plan: p, expiresAt: s.expiresAt, unverified: g.unverified };
  }
  const retentionUntil = await nextRetentionUntil(db, familyId, best.plan, now);
  await db.family.update({ where: { id: familyId }, data: { plan: best.plan, planExpiresAt: best.expiresAt, retentionUntil } });
  return best;
}

/** 구독이 끝난 뒤 넘는 분량을 보관하는 기간 */
export const RETENTION_MS = 30 * 24 * 3600 * 1000;
/** 끝난 것을 늦게 알아챈 경우에도 최소한 이만큼은 안내한 뒤에 지운다 */
export const RETENTION_MIN_NOTICE_MS = 7 * 24 * 3600 * 1000;

/**
 * 보관 기한 계산: 구독 이력이 있는 가족이 무료가 되었고 사용량이 무료 용량을 넘으면
 * '마지막 구독이 끝난 때 + 30일'(최소 오늘 + 7일)까지 보관한다. 유료로 돌아오거나 용량 안으로 줄면 기한을 없앤다.
 * 이미 정해진 기한은 바꾸지 않는다 (안내한 날짜가 흔들리지 않게).
 */
async function nextRetentionUntil(db: Db, familyId: string, plan: PlanId, now: number): Promise<Date | null> {
  const fam = await db.family.findUnique({ where: { id: familyId }, select: { usedBytes: true, retentionUntil: true } });
  if (!fam) return null;
  if (plan !== "FREE" || Number(fam.usedBytes) <= PLANS.FREE.quotaBytes) return null;
  if (fam.retentionUntil) return fam.retentionUntil;
  const last = await db.subscription.aggregate({ where: { familyId }, _max: { expiresAt: true }, _count: { _all: true } });
  if (!last._count._all) return null; // 처음부터 무료였던 가족은 해당 없음 (업로드가 상한에서 막힘)
  const ended = last._max.expiresAt?.getTime() ?? now;
  return new Date(Math.max(ended + RETENTION_MS, now + RETENTION_MIN_NOTICE_MS));
}

/**
 * 만료 경계: 기록상 만료 시각이 지난 구독을 Google 에 다시 물어 최신 상태로 맞춘 뒤 요금제를 계산한다.
 * Google 이 장애면 그 사실을 기록하고, 만료 후 OUTAGE_GRACE_MS 까지는 기존 권한을 유지한다.
 */
export async function refreshFamilyEntitlement(familyId: string) {
  const due = await prisma.subscription.findMany({
    where: { familyId, state: { in: [...ENTITLED_STATES] }, expiresAt: { lte: new Date() } },
  });
  for (const s of due) {
    if (!playConfigured()) {
      await prisma.subscription.update({ where: { id: s.id }, data: { lastCheckError: "STORE_NOT_CONFIGURED" } });
      continue;
    }
    await verifyAndApply({ purchaseToken: s.purchaseToken, source: "recheck" }).catch((e) => {
      if (!isRetryable(e)) console.warn("[billing] 경계 재확인: 영구 오류", s.id, e instanceof Error ? e.message : e);
    });
  }
  return recomputeFamilyPlan(familyId);
}

/** 만료가 가깝거나, 오래 확인 안 했거나, 승인이 안 된 구독을 다시 확인한다 (알림 누락 대비). */
export async function recheckDueSubscriptions() {
  if (!playConfigured()) return;
  const soon = new Date(Date.now() + 24 * 3600 * 1000);
  const stale = new Date(Date.now() - 24 * 3600 * 1000);
  const due = await prisma.subscription.findMany({
    where: {
      state: { notIn: [...INACTIVE_LOCAL_STATES, "SUBSCRIPTION_STATE_EXPIRED"] },
      OR: [{ expiresAt: { lt: soon } }, { lastCheckedAt: { lt: stale } }, { acknowledged: false }, { lastCheckError: { not: null } }],
    },
    take: 200,
  });
  for (const s of due) {
    await verifyAndApply({ purchaseToken: s.purchaseToken, source: "recheck" }).catch((e) =>
      console.error("[billing] 재확인 실패", s.id, e instanceof Error ? e.message : e),
    );
  }
  const families = await prisma.family.findMany({ where: { plan: { not: "FREE" }, planExpiresAt: { lt: new Date() } }, select: { id: true } });
  for (const f of families) await recomputeFamilyPlan(f.id);
}

// ───────────────────────── 결제 시작(가족 단위 잠금) ─────────────────────────

export type IntentAction = "PURCHASE" | "CHANGE" | "RESTORE";

/**
 * 결제 버튼을 누르면 먼저 부른다.
 * - 같은 가족에서 다른 사람이 결제 중이면 막는다 (가족 단위 결제 잠금).
 * - 이미 같은 상품을 쓰고 있으면 새 결제 대신 '복원'으로, 다른 요금제를 쓰고 있으면 '요금제 변경'으로 안내한다.
 * - 새 결제에는 서버가 만든 구매 식별자를 주고, 앱은 이것을 Google 결제의 obfuscatedAccountId 로 넘긴다.
 */
export async function createPurchaseIntent(input: {
  familyId: string;
  userId: string;
  role: string;
  productId: string;
  basePlanId: string;
}): Promise<{ action: IntentAction; intentId: string | null; profileId: string; oldToken: string | null; message?: string }> {
  if (input.role !== "PARENT") throw new BillingError("FORBIDDEN", "요금제는 부모 계정에서 바꿀 수 있어요.", 403);
  const plan = planByProduct(input.productId);
  if (!plan || !plan.prices.some((p) => p.basePlanId === input.basePlanId)) {
    throw new BillingError("UNKNOWN_PRODUCT", "알 수 없는 요금제입니다.", 400);
  }
  return withLock(`family-purchase:${input.familyId}`, async (tx) => {
    const now = new Date();
    await tx.purchaseIntent.updateMany({
      where: { familyId: input.familyId, status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });
    const pending = await tx.purchaseIntent.findFirst({ where: { familyId: input.familyId, status: "PENDING" } });
    if (pending && pending.userId !== input.userId) {
      throw new BillingError("PURCHASE_IN_PROGRESS", "다른 가족 구성원이 결제를 진행 중이에요. 잠시 후 다시 시도해 주세요.", 409);
    }

    const subs = await tx.subscription.findMany({ where: { familyId: input.familyId, state: { notIn: INACTIVE_LOCAL_STATES } } });
    const active = subs
      .filter((s) => grantsNow(s).ok)
      .sort((a, b) => (b.expiresAt?.getTime() ?? 0) - (a.expiresAt?.getTime() ?? 0))[0];

    if (active) {
      if (active.userId !== input.userId) {
        throw new BillingError("SUBSCRIBED_BY_OTHER", "다른 부모님이 구독 중이에요. 그분 계정에서 요금제를 바꿀 수 있어요.", 409);
      }
      if (active.productId === input.productId && active.basePlanId === input.basePlanId) {
        return {
          action: "RESTORE" as const,
          intentId: null,
          profileId: input.userId,
          oldToken: null,
          message: "이미 이용 중인 요금제예요. 구매 내역을 다시 확인할게요.",
        };
      }
    }

    // 같은 사람이 다시 누른 경우: 진행 중인 기록을 새 선택으로 바꿔 쓴다 (연속 클릭에도 결제 시작 기록은 하나)
    const data = {
      productId: input.productId,
      basePlanId: input.basePlanId,
      oldToken: active?.purchaseToken ?? null,
      expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
    };
    const intent = pending
      ? await tx.purchaseIntent.update({ where: { id: pending.id }, data })
      : await tx.purchaseIntent.create({ data: { ...data, familyId: input.familyId, userId: input.userId } });
    return {
      action: active ? ("CHANGE" as const) : ("PURCHASE" as const),
      intentId: intent.id,
      profileId: input.userId,
      oldToken: active?.purchaseToken ?? null,
    };
  });
}

/** 결제창을 닫았거나 실패하면 잠금을 푼다 */
export async function cancelPurchaseIntent(input: { intentId: string; userId: string }) {
  await prisma.purchaseIntent.updateMany({
    where: { id: input.intentId, userId: input.userId, status: "PENDING" },
    data: { status: "CANCELED" },
  });
}
