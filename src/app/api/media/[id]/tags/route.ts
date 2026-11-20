import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { attachTags, detachTag } from "@/lib/library";
import { fail, handleRouteError, ok } from "@/lib/api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const body = (await req.json().catch(() => ({}))) as { tags?: string[] | string };
    const names = Array.isArray(body.tags) ? body.tags : typeof body.tags === "string" ? body.tags.split(/[,\s]+/) : [];
    const media = await attachTags(id, user.familyId, names);
    return ok({ media });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    if (!user.familyId) return fail("NO_FAMILY", "가족 그룹이 없습니다.");
    const name = req.nextUrl.searchParams.get("name") ?? "";
    const media = await detachTag(id, user.familyId, name);
    return ok({ media });
  } catch (error) {
    return handleRouteError(error);
  }
}
