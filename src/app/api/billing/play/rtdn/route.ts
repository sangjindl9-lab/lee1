import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { BillingError, verifyAndApply } from "@/lib/play-billing";

/**
 * Google Play 실시간 개발자 알림(RTDN) — Pub/Sub 푸시 구독의 엔드포인트.
 * 푸시 주소에 ?token=<PLAY_RTDN_TOKEN> 을 붙여 등록한다. 갱신·해지·환불이 바로 반영된다.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.PLAY_RTDN_TOKEN ?? "";
  const given = req.nextUrl.searchParams.get("token") ?? "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
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
