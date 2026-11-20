import AppShell from "@/components/AppShell";
import TrashList from "@/components/TrashList";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";
import { listTrash } from "@/lib/library";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const user = await getSessionUser();
  const familyId = await assertFamily(user);
  const items = await listTrash(familyId, user?.role);

  return (
    <AppShell active="/app/trash">
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-slate-900">휴지통</h1>
        <p className="text-xs text-slate-500">
          삭제한 사진은 원래 아이·앨범·촬영일·공개 범위 정보를 그대로 간직한 채 보관됩니다. 복구하면 원래 자리로 돌아갑니다.
        </p>
      </div>
      <TrashList initialItems={items} />
    </AppShell>
  );
}
