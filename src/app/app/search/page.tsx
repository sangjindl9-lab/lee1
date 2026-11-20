import AppShell from "@/components/AppShell";
import SearchPanel from "@/components/SearchPanel";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";
import { listAlbumMedia, listTags } from "@/lib/library";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const user = await getSessionUser();
  const familyId = await assertFamily(user);
  const [children, tags, items] = await Promise.all([
    prisma.child.findMany({ where: { familyId }, orderBy: { sortOrder: "asc" } }),
    listTags(familyId),
    listAlbumMedia({ familyId, viewerRole: user?.role, limit: 12 }),
  ]);

  return (
    <AppShell active="/app/search">
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-slate-900">사진 찾기</h1>
        <p className="text-xs text-slate-500">
          아이 이름, 생후 개월 수(촬영일 기준 자동 계산), 연도·월, 사진·동영상, 즐겨찾기, 해시태그를 조합해 찾을 수 있습니다.
        </p>
      </div>
      <SearchPanel
        initialItems={items}
        tags={tags}
        children={children.map((c) => ({ id: c.id, name: c.name, nickname: c.nickname }))}
      />
    </AppShell>
  );
}
