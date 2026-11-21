import AppShell from "@/components/AppShell";
import AdBanner from "@/components/AdBanner";
import { isAndroidApp } from "@/lib/platform";
import UploadManager from "@/components/UploadManager";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ childId?: string }> }) {
  const inApp = await isAndroidApp();
  const user = await getSessionUser();
  const familyId = await assertFamily(user);
  const { childId } = await searchParams;

  const children = await prisma.child.findMany({
    where: { familyId },
    orderBy: { sortOrder: "asc" },
    include: { albums: { orderBy: { createdAt: "asc" } } },
  });
  const members = await prisma.user.findMany({
    where: { familyId },
    select: { id: true, name: true, relation: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return (
    <AppShell active="/app/upload">
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-slate-900">사진·동영상 올리기</h1>
        <p className="text-xs text-slate-500">
          100장을 한 번에 올려도 파일마다 상태를 확인할 수 있고, 실패한 항목만 다시 올릴 수 있어요. 완료 표시는 서버에 원본·미리보기 파일과 앨범 정보가 모두 저장된 뒤에만 나타납니다.
        </p>
      </div>
      {!inApp && (<div className="mb-4">
        <AdBanner slot="today" />
      </div>)}
      <UploadManager
        defaultChildId={childId}
        members={members}
        children={children.map((c) => ({
          id: c.id,
          name: c.name,
          nickname: c.nickname,
          albums: c.albums.map((a) => ({ id: a.id, name: a.name, visibility: a.visibility })),
        }))}
      />
    </AppShell>
  );
}
