import { requireSessionUser } from "@/lib/auth";
import { getLatestUploadSession } from "@/lib/upload";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const latest = await getLatestUploadSession(user.id);
    return ok({ latest });
  } catch (error) {
    return handleRouteError(error);
  }
}
