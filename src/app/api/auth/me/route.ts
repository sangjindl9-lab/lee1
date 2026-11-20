import { getSessionUser } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return fail("UNAUTHORIZED", "로그인이 필요합니다.", 401);
    return ok({ user });
  } catch (error) {
    return handleRouteError(error);
  }
}
