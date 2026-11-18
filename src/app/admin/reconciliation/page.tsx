import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireOperator } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { runReconciliationAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "대사" };

export default async function AdminReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  await requireOperator("SETTLEMENT");
  const runs = await prisma.reconciliationRun.findMany({
    include: { issues: true },
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[1.125rem] font-bold text-[var(--color-navy)]">대사(Reconciliation)</h1>
          <p className="mt-1 text-[0.75rem] text-[#8c98aa]">
            플랫폼 내부 상태와 결제 사업자(MockPG) 상태·원장 금액을 비교합니다. 불일치는 자동 수정하지 않고 목록으로
            남깁니다.
          </p>
        </div>
        <form action={runReconciliationAction}>
          <button className="btn btn-primary btn-sm" type="submit">
            지금 대사 실행
          </button>
        </form>
      </div>

      {(sp.error || sp.ok) && (
        <div className="mt-3">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-4 space-y-3">
        {runs.map((run) => (
          <div key={run.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">
                {run.startedAt.toLocaleString("ko-KR")} 대사
              </div>
              <Badge tone={run.mismatchCount === 0 ? "green" : "red"}>
                확인 {run.checked}건 · 불일치 {run.mismatchCount}건
              </Badge>
            </div>
            {run.issues.length > 0 && (
              <ul className="mt-2 space-y-1 text-[0.75rem] text-[#5a6a80]">
                {run.issues.map((i) => (
                  <li key={i.id}>
                    · {i.kind} · {i.field} · 내부 {i.internal} / 외부 {i.external}
                    {i.orderId && (
                      <Link href={`/orders/${i.orderId}`} className="ml-1 font-semibold text-[var(--color-accent)]">
                        주문 보기
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {runs.length === 0 && <p className="text-[0.8125rem] text-[#8c98aa]">아직 대사 기록이 없습니다.</p>}
      </div>
    </div>
  );
}
