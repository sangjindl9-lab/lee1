import AppShell from "@/components/AppShell";
import CarePanel from "@/components/CarePanel";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function CarePage() {
  const user = await getSessionUser();
  const familyId = await assertFamily(user);
  const children = await prisma.child.findMany({ where: { familyId }, orderBy: { sortOrder: "asc" } });

  return (
    <AppShell active="/app/care">
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-slate-900">육아 기록</h1>
        <p className="text-xs text-slate-500">
          수면·수유를 기록합니다. 잘못 입력하면 어느 칸을 고쳐야 하는지 그 칸 옆에 표시되고, 입력값은 그대로 남습니다.
        </p>
      </div>
      <CarePanel children={children.map((c) => ({ id: c.id, name: c.name, nickname: c.nickname }))} />
    </AppShell>
  );
}
