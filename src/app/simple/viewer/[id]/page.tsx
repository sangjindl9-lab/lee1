import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ageLabelAt } from "@/lib/date";
import SimpleViewer from "@/components/SimpleViewer";

export const dynamic = "force-dynamic";

export default async function SimpleViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const familyId = user.familyId ?? "";

  const rows = await prisma.mediaAsset.findMany({
    where: { familyId, deletedAt: null, visibility: "FAMILY" },
    include: {
      child: { select: { name: true, nickname: true, birthDate: true } },
      likes: { where: { userId: user.id }, select: { id: true } },
      _count: { select: { likes: true, comments: true } },
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  const items = rows.map((m) => ({
    id: m.id,
    previewUrl: `/api/media/${m.id}/file?size=preview`,
    thumbUrl: `/api/media/${m.id}/file?size=thumb`,
    childName: m.child?.name ?? null,
    childNickname: m.child?.nickname ?? null,
    ageLabel: m.child ? ageLabelAt(m.child.birthDate, m.capturedAt) : "",
    capturedAtLabel: `${new Date(m.capturedAt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)}`,
    kind: m.kind,
    likeCount: m._count.likes,
    liked: m.likes.length > 0,
    originalUrl: `/api/media/${m.id}/download`,
  }));

  const startIndex = Math.max(0, items.findIndex((i) => i.id === id));
  return <SimpleViewer items={items} startIndex={startIndex} />;
}
