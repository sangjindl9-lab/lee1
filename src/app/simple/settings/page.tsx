import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getEntitlement } from "@/lib/billing";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function SimpleSettings() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const entitlement = await getEntitlement(user.id);

  return (
    <div className="space-y-4">
      <h1 className="px-1 text-2xl font-black text-slate-900">설정</h1>

      <section className="rounded-3xl bg-white p-5 ring-1 ring-rose-100">
        <h2 className="text-xl font-bold text-slate-800">광고</h2>
        <p className="mt-1 text-base text-slate-600">
          {entitlement.adFree ? `${entitlement.planName} 요금제를 쓰고 있어요. 원본 그대로 보관됩니다.` : "무료 요금제를 쓰고 있어요. 요금제는 부모님 계정에서 바꿀 수 있습니다."}
        </p>
        {entitlement.adFree && <p className="mt-2 rounded-2xl bg-emerald-50 px-3 py-2 text-base font-semibold text-emerald-700">적용 중 · {entitlement.planName}</p>}
      </section>

      <section className="rounded-3xl bg-white p-5 ring-1 ring-rose-100">
        <h2 className="text-xl font-bold text-slate-800">내 계정</h2>
        <p className="mt-1 text-base text-slate-600">
          {user.name} {user.relation ? `(${user.relation})` : ""} · {user.familyName}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/simple" className="big-btn bg-slate-100 px-6 text-lg text-slate-700">
            ← 사진 보러 가기
          </Link>
          <LogoutButton />
        </div>
      </section>

      <p className="px-2 text-center text-sm text-slate-400">
        결제·광고 제거 관리는 부모 계정의 &lsquo;설정&rsquo; 화면에서만 할 수 있습니다.
      </p>
    </div>
  );
}
