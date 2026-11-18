import { redeemDownload } from "@/server/services/downloads";
import { isDomainError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** 만료되는 서명 다운로드 URL — 토큰 소유·만료·횟수·상태를 모두 확인한 뒤에만 파일을 준다. */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  try {
    const { fileName, buffer } = await redeemDownload(token, { ip, userAgent });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const status = isDomainError(e) ? e.status : 500;
    const message = isDomainError(e) ? e.message : "다운로드 처리 중 오류가 발생했습니다.";
    return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
