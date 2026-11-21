import AppShell from "@/components/AppShell";
import PlansClient from "@/components/PlansClient";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";
import { isAndroidApp } from "@/lib/platform";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const user = await getSessionUser();
  await assertFamily(user);
  const inApp = await isAndroidApp();
  return (
    <AppShell active="/app/settings">
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-slate-900">요금제</h1>
        <p className="text-xs text-slate-500">요금제 하나로 가족 모두가 같은 저장 공간을 씁니다. 언제든 Google Play 에서 해지할 수 있어요.</p>
      </div>
      <PlansClient inApp={inApp} />
    </AppShell>
  );
}
