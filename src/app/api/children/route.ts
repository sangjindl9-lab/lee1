import { requireSessionUser } from "@/lib/auth";
import prisma from "@/lib/db";
import { ok, handleRouteError } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireSessionUser();
    if (!user.familyId) return ok({ children: [], albums: [], members: [] });
    const children = await prisma.child.findMany({
      where: { familyId: user.familyId },
      orderBy: { sortOrder: "asc" },
      include: {
        albums: { orderBy: { createdAt: "asc" } },
        _count: { select: { media: true } },
      },
    });
    const members = await prisma.user.findMany({
      where: { familyId: user.familyId },
      select: { id: true, name: true, relation: true, role: true, email: true },
      orderBy: { role: "asc" },
    });
    const albumCounts = await prisma.mediaAsset.groupBy({
      by: ["albumId"],
      where: { familyId: user.familyId, deletedAt: null },
      _count: { _all: true },
    });
    const countMap = new Map(albumCounts.map((a) => [a.albumId, a._count._all]));
    return ok({
      children: children.map((c) => ({
        id: c.id,
        name: c.name,
        nickname: c.nickname,
        birthDate: c.birthDate.toISOString(),
        avatarColor: c.avatarColor,
        mediaCount: c._count.media,
        albums: c.albums.map((a) => ({
          id: a.id,
          name: a.name,
          visibility: a.visibility,
          mediaCount: countMap.get(a.id) ?? 0,
        })),
      })),
      members: members.map((m) => ({ ...m })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
