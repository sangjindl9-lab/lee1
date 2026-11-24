import AppShell from "@/components/AppShell";
import SettingsPanel from "@/components/SettingsPanel";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";
import { listInquiries } from "@/lib/billing";
import { listTags } from "@/lib/library";
import { formatBytes } from "@/lib/plans";
import { getEffectiveUsage } from "@/lib/entitlement";
import { formatKstDateTime } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  const familyId = await assertFamily(user);
  const [usage, family, inquiries, members, tags] = await Promise.all([
    getEffectiveUsage(familyId),
    prisma.family.findUnique({ where: { id: familyId }, select: { inviteCode: true } }),
    listInquiries(user!.id),
    prisma.user.findMany({ where: { familyId }, select: { id: true, name: true, relation: true, role: true }, orderBy: { role: "asc" } }),
    listTags(familyId),
  ]);

  return (
    <AppShell active="/app/settings">
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-slate-900">설정</h1>
        <p className="text-xs text-slate-500">요금제·저장 공간, 가족 초대, 문의, 계정을 관리합니다.</p>
      </div>
      <SettingsPanel
        usage={{
          planId: usage.plan.id,
          planName: usage.plan.name,
          usedLabel: formatBytes(usage.usedBytes),
          quotaLabel: formatBytes(usage.quotaBytes),
          percent: usage.percent,
          expiresAt: usage.planExpiresAt ? formatKstDateTime(new Date(usage.planExpiresAt)) : null,
        }}
        inviteCode={user!.role === "PARENT" ? family?.inviteCode ?? null : null}
        initialInquiries={inquiries}
        members={members}
        tags={tags}
        isParent={user!.role === "PARENT"}
      />
    </AppShell>
  );
}
