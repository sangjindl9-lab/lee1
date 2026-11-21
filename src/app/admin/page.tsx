import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { ECON, PLANS, formatBytes, monthlyNetKRW, planOf, storageCostKRW, type PlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/** 운영자용 손익 화면: 이번 달 기준 순매출(부가세·수수료 뺀 금액)과 저장·고정 비용 */
export default async function AdminPage() {
  const user = await getSessionUser();
  if (!(await isAdminUser(user))) notFound();

  const [families, users, subs, usedAgg, jobs, failedJobs] = await Promise.all([
    prisma.family.groupBy({ by: ["plan"], _count: { _all: true }, _sum: { usedBytes: true } }),
    prisma.user.count({ where: { NOT: { email: { endsWith: "@deleted.local" } } } }),
    prisma.subscription.findMany({
      where: { state: { in: ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"] }, expiresAt: { gt: new Date() } },
      select: { plan: true, basePlanId: true, state: true },
    }),
    prisma.family.aggregate({ _sum: { usedBytes: true } }),
    prisma.job.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.job.count({ where: { status: "FAILED" } }),
  ]);
  const top = await prisma.family.findMany({ orderBy: { usedBytes: "desc" }, take: 10, select: { id: true, name: true, plan: true, usedBytes: true } });

  const revenue = subs.reduce((sum, s) => sum + monthlyNetKRW(planOf(s.plan), s.basePlanId), 0);
  const totalBytes = Number(usedAgg._sum.usedBytes ?? 0);
  const storage = storageCostKRW(totalBytes);
  const fixed = ECON.fixedUsdPerMonth * ECON.krwPerUsd;
  const profit = revenue - storage - fixed;

  const byPlan = new Map(families.map((f) => [f.plan, f]));
  const subCount = (id: PlanId, base: string) => subs.filter((s) => s.plan === id && s.basePlanId === base).length;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 text-sm text-slate-700">
      <h1 className="text-xl font-black text-slate-900">운영 손익 (이번 달 환산)</h1>
      <p className="text-xs text-slate-400">
        순매출 = 가격 ÷ 1.1(부가세) × 0.85(Play 수수료 15%), 연간은 ÷12 · 저장 단가 ${ECON.storageUsdPerGbMonth}/GB·월 · 환율 {ECON.krwPerUsd}원 · 고정비 ${ECON.fixedUsdPerMonth}/월
      </p>

      <section className="mt-4 grid gap-3 sm:grid-cols-4">
        {[
          ["순매출", won(revenue)],
          ["저장 비용", won(storage)],
          ["고정 비용(서버·DB)", won(fixed)],
          ["영업이익", won(profit)],
        ].map(([k, v]) => (
          <div key={k} className="card p-4">
            <p className="text-[11px] text-slate-500">{k}</p>
            <p className={`text-lg font-black ${k === "영업이익" && profit < 0 ? "text-red-600" : "text-slate-900"}`}>{v}</p>
          </div>
        ))}
      </section>

      <section className="card mt-4 p-4">
        <h2 className="mb-2 font-bold">요금제별</h2>
        <table className="w-full text-xs">
          <thead className="text-left text-slate-400">
            <tr>
              <th className="py-1">요금제</th>
              <th>가족 수</th>
              <th>월간 구독</th>
              <th>연간 구독</th>
              <th>사용량</th>
              <th>저장 비용</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(PLANS) as PlanId[]).map((id) => {
              const row = byPlan.get(id);
              const bytes = Number(row?._sum.usedBytes ?? 0);
              return (
                <tr key={id} className="border-t border-slate-100">
                  <td className="py-1.5 font-semibold">{PLANS[id].name}</td>
                  <td>{row?._count._all ?? 0}</td>
                  <td>{id === "FREE" ? "-" : subCount(id, "monthly")}</td>
                  <td>{id === "FREE" ? "-" : subCount(id, "yearly")}</td>
                  <td>{formatBytes(bytes)}</td>
                  <td>{won(storageCostKRW(bytes))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-400">
          가입자 {users.toLocaleString()}명 · 전체 저장 {formatBytes(totalBytes)} · 처리 대기 작업 {jobs}건 · 실패 작업 {failedJobs}건
        </p>
      </section>

      <section className="card mt-4 p-4">
        <h2 className="mb-2 font-bold">사용량 상위 가족</h2>
        <ul className="space-y-1 text-xs">
          {top.map((f) => (
            <li key={f.id} className="flex justify-between">
              <span>
                {f.name} <span className="text-slate-400">{planOf(f.plan).name}</span>
              </span>
              <span>
                {formatBytes(Number(f.usedBytes))} / {formatBytes(planOf(f.plan).quotaBytes)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
