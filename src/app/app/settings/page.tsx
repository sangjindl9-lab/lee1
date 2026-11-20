import AppShell from "@/components/AppShell";
import SettingsPanel from "@/components/SettingsPanel";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";
import { getEntitlement, listInquiries } from "@/lib/billing";
import { listTags } from "@/lib/library";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  const familyId = await assertFamily(user);
  const [entitlement, inquiries, members, tags] = await Promise.all([
    getEntitlement(user!.id),
    listInquiries(user!.id),
    prisma.user.findMany({ where: { familyId }, select: { id: true, name: true, relation: true, role: true }, orderBy: { role: "asc" } }),
    listTags(familyId),
  ]);

  return (
    <AppShell active="/app/settings">
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-slate-900">설정</h1>
        <p className="text-xs text-slate-500">광고 제거 적용 상태·구매 복원·문의는 이 화면에서만 확인할 수 있습니다.</p>
      </div>
      <SettingsPanel initialEntitlement={entitlement} initialInquiries={inquiries} members={members} tags={tags} />
    </AppShell>
  );
}
