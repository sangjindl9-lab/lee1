import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api";
import { verifyPassword } from "@/lib/password";
import { enqueue } from "@/lib/jobs";

/**
 * 회원 탈퇴. 비밀번호를 다시 확인한다.
 * 가족의 마지막 부모가 탈퇴하면 그 가족의 사진·기록 전체를 지우는 작업을 건다.
 * (유료 구독은 Google Play 에서 직접 해지해야 하므로 안내한다)
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSessionUser();
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (!user) return fail("NOT_FOUND", "계정을 찾을 수 없습니다.", 404);
    if (!verifyPassword(body.password ?? "", user.passwordHash)) return fail("BAD_PASSWORD", "비밀번호가 올바르지 않습니다.", 401);

    let familyDeleted = false;
    if (user.familyId) {
      const otherParents = await prisma.user.count({ where: { familyId: user.familyId, role: "PARENT", id: { not: user.id } } });
      if (otherParents === 0) {
        familyDeleted = true;
        const familyId = user.familyId;
        // 남은 가족 구성원은 가족에서 분리 (계정 자체는 각자 탈퇴)
        await prisma.user.updateMany({ where: { familyId }, data: { familyId: null } });
        await enqueue("DELETE_FAMILY", { familyId });
      }
    }
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.$transaction([
      prisma.like.deleteMany({ where: { userId: user.id } }),
      prisma.comment.deleteMany({ where: { userId: user.id } }),
      prisma.inquiry.deleteMany({ where: { userId: user.id } }),
      prisma.adImpression.deleteMany({ where: { userId: user.id } }),
      prisma.uploadSession.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({
        where: { id: user.id },
        data: { email: `deleted-${user.id}@deleted.local`, name: "탈퇴한 사용자", passwordHash: "deleted", familyId: null, relation: null },
      }),
    ]);
    const res = NextResponse.json({ ok: true, familyDeleted });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", expires: new Date(0) });
    return res;
  } catch (error) {
    return handleRouteError(error);
  }
}
