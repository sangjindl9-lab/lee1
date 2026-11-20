import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { addComment, listComments } from "@/lib/library";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionUser();
    const { id } = await params;
    return ok({ comments: await listComments(id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const body = (await req.json().catch(() => ({}))) as { body?: string };
    const comment = await addComment(id, user.id, user.familyId, body.body ?? "", user.role);
    return ok({ comment });
  } catch (error) {
    return handleRouteError(error);
  }
}
