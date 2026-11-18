import { handleWebhook } from "@/server/payments/webhooks";
import { isDomainError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * 테스트 PG 웹훅 수신 엔드포인트.
 * 서명 검증 → 중복/역순 판정 → 상태 반영. 브라우저 화면과 무관하게 서버에서만 상태를 바꾼다.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-mockpg-signature");
  try {
    const result = await handleWebhook("mockpg", raw, signature);
    return Response.json(result, { status: 200 });
  } catch (e) {
    const status = isDomainError(e) ? e.status : 500;
    const message = isDomainError(e) ? e.message : "웹훅 처리 오류";
    return Response.json({ error: message }, { status });
  }
}
