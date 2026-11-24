/**
 * Google Play 실시간 개발자 알림(RTDN) 처리.
 *
 * - 인증: Pub/Sub 인증 푸시의 Google 서명 토큰(OIDC)을 확인한다. (대체: ?token= 비밀값)
 * - 패키지명이 이 앱이 아니면 무시한다.
 * - 메시지 ID 로 중복을 막는다. 같은 메시지가 동시에 와도 하나만 처리한다.
 * - 같은 구매 토큰은 verifyAndApply 안의 DB 잠금으로 한 번에 하나씩 처리한다.
 * - 순서가 뒤바뀐 옛 알림은 발생 시각을 비교해 건너뛴다(STALE). 어차피 처리 때마다 Google 최신 상태를 다시 받는다.
 * - 일시 오류(Google 장애·DB 오류)는 5xx 를 돌려 Pub/Sub 이 다시 보내게 하고,
 *   영구 오류(모르는 토큰·주인 불명)는 FAILED_PERMANENT 로 기록하고 200 을 돌려 무한 재시도를 막는다.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { Prisma } from "@prisma/client";
import prisma from "./db";
import { BillingError, isRetryable, markRevoked, PACKAGE, verifyAndApply } from "./play-billing";

/** 처리 중으로 표시된 메시지를 '멈춤'으로 보고 다시 처리해도 되는 시간 */
export const PROCESSING_STALE_MS = 2 * 60 * 1000;

export type RtdnResponse = { status: number; body: Record<string, unknown> };

type Notification = {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: { purchaseToken?: string; notificationType?: number; subscriptionId?: string };
  voidedPurchaseNotification?: { purchaseToken?: string; orderId?: string; productType?: number; refundType?: number };
  oneTimeProductNotification?: unknown;
  testNotification?: unknown;
};

// ───────────────────────── 인증 ─────────────────────────

export type IdTokenVerifier = (idToken: string, audience: string) => Promise<{ email?: string; email_verified?: boolean } | undefined>;

const oidc = new OAuth2Client();
const googleVerifier: IdTokenVerifier = async (idToken, audience) => {
  const ticket = await oidc.verifyIdToken({ idToken, audience });
  return ticket.getPayload();
};

/**
 * 요청이 우리 Pub/Sub 푸시 구독에서 온 것인지 확인한다.
 * PLAY_RTDN_SA_EMAIL 이 설정돼 있으면 Google 서명 토큰이 반드시 있어야 하고, 발급 대상·서비스 계정 이메일이 맞아야 한다.
 */
export async function verifyPushAuth(
  input: { authorization: string | null; url: URL },
  verifier: IdTokenVerifier = googleVerifier,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const email = env.PLAY_RTDN_SA_EMAIL;
  const bearer = input.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (email) {
    if (!bearer) return false;
    try {
      const audience = env.PLAY_RTDN_AUDIENCE ?? `${input.url.origin}${input.url.pathname}`;
      const payload = await verifier(bearer, audience);
      return payload?.email === email && payload.email_verified === true;
    } catch {
      return false;
    }
  }
  const expected = env.PLAY_RTDN_TOKEN ?? "";
  const given = input.url.searchParams.get("token") ?? "";
  return !!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// ───────────────────────── 처리 ─────────────────────────

function parse(body: unknown): { messageId: string; note: Notification | null } {
  const msg = (body as { message?: { data?: string; messageId?: string; message_id?: string } } | null)?.message;
  const data = msg?.data ?? "";
  const messageId = msg?.messageId ?? msg?.message_id ?? `sha256:${createHash("sha256").update(data).digest("hex")}`;
  if (!data) return { messageId, note: null };
  try {
    return { messageId, note: JSON.parse(Buffer.from(data, "base64").toString("utf8")) as Notification };
  } catch {
    return { messageId, note: null };
  }
}

function classify(note: Notification) {
  if (note.testNotification) return { kind: "TEST", token: null, type: null };
  if (note.subscriptionNotification) {
    return { kind: "SUBSCRIPTION", token: note.subscriptionNotification.purchaseToken ?? null, type: note.subscriptionNotification.notificationType ?? null };
  }
  if (note.voidedPurchaseNotification) return { kind: "VOIDED", token: note.voidedPurchaseNotification.purchaseToken ?? null, type: null };
  return { kind: "OTHER", token: null, type: null };
}

/** 메시지 처리 권한을 얻는다. 이미 끝났거나 다른 요청이 처리 중이면 그에 맞는 응답을 돌려준다. */
async function claim(messageId: string, info: { kind: string; token: string | null; type: number | null; eventTime: bigint | null }) {
  try {
    await prisma.rtdnEvent.create({
      data: {
        messageId,
        kind: info.kind,
        purchaseToken: info.token,
        notificationType: info.type,
        eventTime: info.eventTime,
        status: "PROCESSING",
        attempts: 1,
      },
    });
    return { claimed: true as const };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  const prev = await prisma.rtdnEvent.findUnique({ where: { messageId } });
  if (!prev) return { claimed: false as const, response: { status: 503, body: { ok: false, retry: "claim-race" } } };
  if (["DONE", "STALE", "IGNORED", "FAILED_PERMANENT"].includes(prev.status)) {
    return { claimed: false as const, response: { status: 200, body: { ok: true, duplicate: prev.status } } };
  }
  if (prev.status === "PROCESSING" && Date.now() - prev.updatedAt.getTime() < PROCESSING_STALE_MS) {
    // 다른 요청이 지금 처리 중: 잠시 뒤 다시 보내 달라고 한다 (그쪽이 실패하면 그때 이어서 처리)
    return { claimed: false as const, response: { status: 503, body: { ok: false, retry: "in-progress" } } };
  }
  // 이전 시도가 실패(RETRY)했거나 멈춘 처리: 상태를 조건부로 바꿔 한 요청만 이어받는다
  const took = await prisma.rtdnEvent.updateMany({
    where: { id: prev.id, status: prev.status, updatedAt: prev.updatedAt },
    data: { status: "PROCESSING", attempts: { increment: 1 }, error: null },
  });
  if (!took.count) return { claimed: false as const, response: { status: 503, body: { ok: false, retry: "claim-race" } } };
  return { claimed: true as const };
}

async function finish(messageId: string, status: string, error?: string) {
  await prisma.rtdnEvent.update({ where: { messageId }, data: { status, error: error?.slice(0, 500) ?? null } });
}

/** Pub/Sub 푸시 본문을 처리하고 돌려줄 HTTP 상태를 정한다. (인증은 호출한 쪽에서 먼저 확인) */
export async function handleRtdn(body: unknown): Promise<RtdnResponse> {
  const { messageId, note } = parse(body);
  if (!note) return { status: 200, body: { ok: true, ignored: "no-data" } };

  if (note.packageName && note.packageName !== PACKAGE) {
    console.warn("[rtdn] 다른 패키지의 알림 무시", note.packageName);
    return { status: 200, body: { ok: true, ignored: "package-mismatch" } };
  }
  const info = classify(note);
  const eventTime = note.eventTimeMillis && /^\d+$/.test(note.eventTimeMillis) ? BigInt(note.eventTimeMillis) : null;

  let claimed;
  try {
    claimed = await claim(messageId, { ...info, eventTime });
  } catch (e) {
    console.error("[rtdn] 기록 실패 (다시 받기)", e);
    return { status: 500, body: { ok: false, retry: "db" } };
  }
  if (!claimed.claimed) return claimed.response;

  try {
    if (info.kind === "TEST") {
      await finish(messageId, "DONE");
      return { status: 200, body: { ok: true, test: true } };
    }
    if (info.kind === "OTHER" || !info.token) {
      await finish(messageId, "IGNORED", "구독 알림이 아님");
      return { status: 200, body: { ok: true, ignored: "not-subscription" } };
    }
    if (info.kind === "VOIDED") {
      const r = await markRevoked(info.token);
      await finish(messageId, r ? "DONE" : "IGNORED", r ? undefined : "모르는 구매 토큰");
      return { status: 200, body: { ok: true, revoked: Boolean(r) } };
    }
    const r = await verifyAndApply({ purchaseToken: info.token, source: "rtdn", eventTime });
    await finish(messageId, r.stale ? "STALE" : "DONE");
    return { status: 200, body: { ok: true, stale: r.stale, plan: r.plan.plan } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isRetryable(e)) {
      await finish(messageId, "RETRY", message).catch(() => undefined);
      console.error("[rtdn] 일시 오류 (다시 받기)", message);
      return { status: 500, body: { ok: false, retry: e instanceof BillingError ? e.code : "error" } };
    }
    await finish(messageId, "FAILED_PERMANENT", message).catch(() => undefined);
    console.warn("[rtdn] 영구 오류 기록", e instanceof BillingError ? e.code : "", message);
    return { status: 200, body: { ok: true, failed: e instanceof BillingError ? e.code : "error" } };
  }
}
