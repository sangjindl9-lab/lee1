/**
 * Google Play 정기결제 서버 검증.
 * - 앱이 구매 직후 purchaseToken 을 보내면 Google Play Developer API 로 상태를 확인하고, 확인(acknowledge) 후 가족 요금제를 올린다.
 * - 실시간 개발자 알림(RTDN, Pub/Sub push)과 6시간마다 재확인으로 갱신·해지·환불·결제 실패를 반영한다.
 * 필요한 환경변수: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (서비스 계정 키 JSON), PLAY_PACKAGE_NAME
 */
import { GoogleAuth } from "google-auth-library";
import prisma from "./db";
import { planByProduct, type PlanId } from "./plans";

const PACKAGE = process.env.PLAY_PACKAGE_NAME ?? "kr.eumsoft.familyalbum";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

export class BillingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function playConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
}

let auth: GoogleAuth | null = null;
async function authedFetch(url: string, init: RequestInit = {}) {
  if (!playConfigured()) {
    throw new BillingError("STORE_NOT_CONFIGURED", "결제 검증 설정이 아직 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
  if (!auth) {
    auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON as string),
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
  }
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
  });
  return res;
}

type SubscriptionV2 = {
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

async function fetchSubscription(purchaseToken: string): Promise<SubscriptionV2> {
  const res = await authedFetch(`${API}/${PACKAGE}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`);
  if (res.status === 404 || res.status === 410) throw new BillingError("TOKEN_INVALID", "결제 정보를 찾을 수 없습니다.", 404);
  if (!res.ok) throw new BillingError("PLAY_API_ERROR", `Google Play 확인 실패 (${res.status})`, 502);
  return (await res.json()) as SubscriptionV2;
}

async function acknowledge(productId: string, purchaseToken: string) {
  const res = await authedFetch(
    `${API}/${PACKAGE}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    { method: "POST", body: "{}" },
  );
  if (!res.ok && res.status !== 400) throw new BillingError("ACK_FAILED", `결제 확인 처리 실패 (${res.status})`, 502);
}

const ENTITLED = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"]);
// 해지했어도 기간이 남아 있으면 기간 끝까지 쓴다.
const ENTITLED_UNTIL_EXPIRY = new Set(["SUBSCRIPTION_STATE_CANCELED"]);

/** 구매 토큰을 확인해 구독 레코드를 저장하고 가족 요금제를 다시 계산한다. */
export async function verifyAndApply(input: { purchaseToken: string; userId?: string; familyId?: string }) {
  const data = await fetchSubscription(input.purchaseToken);
  const line = data.lineItems?.[0];
  const productId = line?.productId ?? "";
  const plan = planByProduct(productId);
  if (!plan) throw new BillingError("UNKNOWN_PRODUCT", "알 수 없는 상품입니다.");

  const existing = await prisma.subscription.findUnique({ where: { purchaseToken: input.purchaseToken } });
  // 앱이 결제 때 넘긴 가족 ID(obfuscatedAccountId)와 요청한 가족이 같아야 한다 → 남의 토큰 재사용 방지
  const accountFamily = data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
  const familyId = existing?.familyId ?? accountFamily ?? input.familyId;
  if (!familyId) throw new BillingError("NO_FAMILY", "결제한 가족을 확인할 수 없습니다.");
  if (input.familyId && ((accountFamily && input.familyId !== accountFamily) || (existing && existing.familyId !== input.familyId))) {
    throw new BillingError("FAMILY_MISMATCH", "다른 가족에서 결제한 구독입니다.", 403);
  }
  const userId = existing?.userId ?? data.externalAccountIdentifiers?.obfuscatedExternalProfileId ?? input.userId;
  if (!userId) throw new BillingError("NO_USER", "결제한 사용자를 확인할 수 없습니다.");

  const state = data.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED";
  const expiresAt = line?.expiryTime ? new Date(line.expiryTime) : null;

  const sub = await prisma.subscription.upsert({
    where: { purchaseToken: input.purchaseToken },
    create: {
      familyId,
      userId,
      productId,
      basePlanId: line?.offerDetails?.basePlanId ?? null,
      plan: plan.id,
      purchaseToken: input.purchaseToken,
      linkedToken: data.linkedPurchaseToken ?? null,
      state,
      autoRenewing: line?.autoRenewingPlan?.autoRenewEnabled ?? false,
      expiresAt,
      raw: JSON.stringify(data).slice(0, 8000),
    },
    update: {
      productId,
      basePlanId: line?.offerDetails?.basePlanId ?? null,
      plan: plan.id,
      state,
      autoRenewing: line?.autoRenewingPlan?.autoRenewEnabled ?? false,
      expiresAt,
      lastCheckedAt: new Date(),
      raw: JSON.stringify(data).slice(0, 8000),
    },
  });

  // 업그레이드·재구독으로 바뀐 이전 토큰은 무효 처리
  if (data.linkedPurchaseToken) {
    await prisma.subscription.updateMany({ where: { purchaseToken: data.linkedPurchaseToken }, data: { state: "REPLACED" } });
  }

  if (ENTITLED.has(state) && data.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
    await acknowledge(productId, input.purchaseToken);
    await prisma.subscription.update({ where: { id: sub.id }, data: { acknowledged: true } });
  }

  await recomputeFamilyPlan(familyId);
  return sub;
}

const RANK: Record<PlanId, number> = { FREE: 0, FAMILY_50: 1, FAMILY_200: 2, FAMILY_1TB: 3 };

/** 가족의 유효한 구독 중 가장 높은 요금제로 맞춘다. 없으면 무료. (원본 파일은 지우지 않는다) */
export async function recomputeFamilyPlan(familyId: string) {
  const subs = await prisma.subscription.findMany({ where: { familyId } });
  const now = Date.now();
  let best: { plan: PlanId; expiresAt: Date | null } = { plan: "FREE", expiresAt: null };
  for (const s of subs) {
    const valid =
      ENTITLED.has(s.state) || (ENTITLED_UNTIL_EXPIRY.has(s.state) && s.expiresAt && s.expiresAt.getTime() > now);
    if (!valid) continue;
    const p = s.plan as PlanId;
    if (RANK[p] > RANK[best.plan]) best = { plan: p, expiresAt: s.expiresAt };
  }
  await prisma.family.update({ where: { id: familyId }, data: { plan: best.plan, planExpiresAt: best.expiresAt } });
  return best;
}

/** 만료가 가까운 구독·오래 확인 안 한 구독을 다시 확인한다 (알림 누락 대비). */
export async function recheckDueSubscriptions() {
  if (!playConfigured()) return;
  const soon = new Date(Date.now() + 24 * 3600 * 1000);
  const stale = new Date(Date.now() - 24 * 3600 * 1000);
  const due = await prisma.subscription.findMany({
    where: {
      state: { notIn: ["REPLACED", "SUBSCRIPTION_STATE_EXPIRED", "FAMILY_DELETED"] },
      OR: [{ expiresAt: { lt: soon } }, { lastCheckedAt: { lt: stale } }],
    },
    take: 200,
  });
  for (const s of due) {
    await verifyAndApply({ purchaseToken: s.purchaseToken }).catch((e) => console.error("[billing] 재확인 실패", s.id, e));
  }
  // 만료 시각이 지난 해지 구독 반영
  const families = await prisma.family.findMany({ where: { plan: { not: "FREE" }, planExpiresAt: { lt: new Date() } }, select: { id: true } });
  for (const f of families) await recomputeFamilyPlan(f.id);
}
