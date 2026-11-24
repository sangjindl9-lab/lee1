import { NextRequest, NextResponse } from "next/server";
import { handleRtdn, verifyPushAuth } from "@/lib/rtdn";

/**
 * Google Play 실시간 개발자 알림(RTDN) — Pub/Sub 인증 푸시 구독의 엔드포인트.
 * 처리 규칙은 src/lib/rtdn.ts 참고 (중복 방지·순서·일시/영구 오류 구분).
 */
export async function POST(req: NextRequest) {
  const ok = await verifyPushAuth({ authorization: req.headers.get("authorization"), url: new URL(req.url) });
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const r = await handleRtdn(body);
  return NextResponse.json(r.body, { status: r.status });
}
