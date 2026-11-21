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

const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa"];

/** 아이 추가 (부모만) — 아이마다 기본 가족 앨범을 함께 만든다 */
export async function POST(req: Request) {
  try {
    const user = await requireSessionUser();
    if (user.role !== "PARENT" || !user.familyId) {
      return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "부모 계정만 아이를 추가할 수 있습니다." } }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as { name?: string; birthDate?: string };
    const name = (body.name ?? "").trim().slice(0, 20);
    const birth = body.birthDate ? new Date(`${body.birthDate}T00:00:00+09:00`) : null;
    if (!name || !birth || Number.isNaN(birth.getTime())) {
      return Response.json({ ok: false, error: { code: "BAD_INPUT", message: "아이 이름과 생일을 입력해 주세요." } }, { status: 400 });
    }
    const count = await prisma.child.count({ where: { familyId: user.familyId } });
    if (count >= 10) {
      return Response.json({ ok: false, error: { code: "TOO_MANY", message: "아이는 10명까지 등록할 수 있습니다." } }, { status: 400 });
    }
    const child = await createChildWithAlbum(user.familyId, name, birth, count);
    return ok({ child: { id: child.id, name: child.name } });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function createChildWithAlbum(familyId: string, name: string, birthDate: Date, order: number) {
  const nicknames = ["첫째", "둘째", "셋째", "넷째", "다섯째"];
  const child = await prisma.child.create({
    data: {
      familyId,
      name,
      nickname: nicknames[order] ?? `${order + 1}번째`,
      birthDate,
      avatarColor: COLORS[order % COLORS.length],
      sortOrder: order,
    },
  });
  await prisma.album.create({ data: { familyId, childId: child.id, name: `${name} 앨범`, visibility: "FAMILY" } });
  return child;
}
