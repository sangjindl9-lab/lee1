import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { BillingError, verifyAndApply } from "@/lib/play-billing";

const oidc = new OAuth2Client();

/**
 * 요청이 우리 Pub/Sub 푸시 구독에서 온 것인지 확인한다.
 * 1) Pub/Sub 인증 푸시: Authorization: Bearer <Google 서명 토큰>, 발급자·대상·서비스 계정 이메일 확인
 * 2) (대체) 주소의 ?token= 값이 PLAY_RTDN_TOKEN 과 같음
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const email = process.env.PLAY_RTDN_SA_EMAIL;
  if (bearer && email) {
    try {
      const audience = process.env.PLAY_RTDN_AUDIENCE ?? `${req.nextUrl.origin}${req.nextUrl.pathname}`;
      const ticket = await oidc.verifyIdToken({ idToken: bearer, audience });
      const payload = ticket.getPayload();
      if (payload?.email === email && payload.email_verified) return true;
    } catch (e) {
      console.warn("[rtdn] 서명 확인 실패", e instanceof Error ? e.message : e);
    }
  }
  const expected = process.env.PLAY_RTDN_TOKEN ?? "";
  const given = req.nextUrl.searchParams.get("token") ?? "";
  return !!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Google Play 실시간 개발자 알림(RTDN) — Pub/Sub 푸시 구독의 엔드포인트.
 * Pub/Sub 푸시 구독(인증 사용, 서비스 계정 PLAY_RTDN_SA_EMAIL)으로 등록한다. 갱신·해지·환불이 바로 반영된다.
 */
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { message?: { data?: string } } | null;
  const raw = body?.message?.data;
  if (!raw) return NextResponse.json({ ok: true, ignored: "no-data" });
  let note: { subscriptionNotification?: { purchaseToken?: string; notificationType?: number }; testNotification?: unknown };
  try {
    note = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ ok: true, ignored: "bad-json" });
  }
  if (note.testNotification) return NextResponse.json({ ok: true, test: true });
  const token = note.subscriptionNotification?.purchaseToken;
  if (!token) return NextResponse.json({ ok: true, ignored: "not-subscription" });
  try {
    await verifyAndApply({ purchaseToken: token });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BillingError) {
      console.warn("[rtdn] 반영하지 않음", e.code, e.message);
      return NextResponse.json({ ok: true, ignored: e.code });
    }
    console.error("[rtdn] 처리 실패", e);
    // 500 이면 Pub/Sub 이 다시 보내 준다
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
