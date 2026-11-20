import Link from "next/link";
import AppShell from "@/components/AppShell";
import PurchasePanel from "@/components/PurchasePanel";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";
import { getEntitlement, PLATFORMS, PRODUCTS, storeConfigured } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function PurchasePage() {
  const user = await getSessionUser();
  await assertFamily(user);
  const entitlement = await getEntitlement(user!.id);

  return (
    <AppShell active="/app/settings">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900">광고 제거</h1>
          <p className="text-xs text-slate-500">결제 전에 적용 범위를 확인하고, 결제 후에는 설정에서 상태를 확인·복원할 수 있습니다.</p>
        </div>
        <Link href="/app/settings" className="btn-ghost">
          ← 설정
        </Link>
      </div>
      <PurchasePanel
        products={Object.values(PRODUCTS)}
        platforms={PLATFORMS.map((p) => ({ id: p, configured: storeConfigured(p) }))}
        initialEntitlement={entitlement}
      />
    </AppShell>
  );
}
