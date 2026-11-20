import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import AlbumGrid from "@/components/AlbumGrid";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";
import { ageLabelAt, kstDateKey } from "@/lib/date";
import { listAlbumMedia, listTags } from "@/lib/library";

export const dynamic = "force-dynamic";

export default async function AlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ childId: string }>;
  searchParams: Promise<{ focus?: string; albumId?: string }>;
}) {
  const { childId } = await params;
  const { focus, albumId } = await searchParams;
  const user = await getSessionUser();
  const familyId = await assertFamily(user);

  const child = await prisma.child.findFirst({
    where: { id: childId, familyId },
    include: { albums: { orderBy: { createdAt: "asc" } } },
  });
  if (!child) notFound();

  const [items, tags, allChildren] = await Promise.all([
    listAlbumMedia({ familyId, childId, albumId, viewerRole: user?.role }),
    listTags(familyId),
    prisma.child.findMany({ where: { familyId }, orderBy: { sortOrder: "asc" }, include: { albums: { orderBy: { createdAt: "asc" } } } }),
  ]);

  const counts = await prisma.mediaAsset.groupBy({
    by: ["kind"],
    where: { childId, deletedAt: null },
    _count: { _all: true },
  });
  const imageCount = counts.find((c) => c.kind === "IMAGE")?._count._all ?? 0;
  const videoCount = counts.find((c) => c.kind === "VIDEO")?._count._all ?? 0;

  return (
    <AppShell active="/app">
      <section className="mb-4 flex flex-wrap items-center gap-4 rounded-3xl bg-white p-5 shadow-sm">
        <div className="grid h-16 w-16 place-items-center rounded-2xl text-2xl font-black text-white" style={{ background: child.avatarColor }}>
          {child.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-black tracking-tight text-slate-900">
            {child.name} <span className="text-sm font-semibold text-slate-400">{child.nickname}</span>
          </h1>
          <p className="text-xs text-slate-500">
            {kstDateKey(child.birthDate)} 출생 · {ageLabelAt(child.birthDate, new Date())} · 사진 {imageCount}장 · 동영상 {videoCount}개
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {child.albums.map((album) => (
              <Link
                key={album.id}
                href={`/app/album/${child.id}${album.id === child.albums[0]?.id ? "" : `?albumId=${album.id}`}`}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  (albumId ?? child.albums[0]?.id) === album.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {album.name} {album.visibility === "PARENTS_ONLY" ? "🔒" : ""}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {allChildren
            .filter((c) => c.id !== child.id)
            .map((c) => (
              <Link key={c.id} href={`/app/album/${c.id}`} className="btn-ghost">
                {c.name} 앨범 →
              </Link>
            ))}
          <Link href={`/app/upload?childId=${child.id}`} className="btn-primary">
            ⬆️ 사진 올리기
          </Link>
        </div>
      </section>

      <AlbumGrid
        initialItems={items}
        childId={child.id}
        focusId={focus}
        tags={tags}
        canEdit={user?.role === "PARENT"}
        children={allChildren.map((c) => ({
          id: c.id,
          name: c.name,
          nickname: c.nickname,
          albums: c.albums.map((a) => ({ id: a.id, name: a.name })),
        }))}
      />
    </AppShell>
  );
}
