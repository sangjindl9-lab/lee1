import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireActor } from "@/lib/session";
import { Badge, EmptyState, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "견적·의뢰 관리" };

export default async function RequestsDashboardPage() {
  const actor = await requireActor("/dashboard/requests");
  const [requests, quotes] = await Promise.all([
    prisma.devRequest.findMany({
      where: { buyerId: actor.id },
      include: { _count: { select: { quotes: true } }, contract: true },
      orderBy: { createdAt: "desc" },
    }),
    actor.sellerProfileId
      ? prisma.quote.findMany({
          where: { sellerId: actor.sellerProfileId },
          include: { request: true, contract: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <SectionHeading
        title="견적·의뢰 관리"
        description="의뢰 → 견적 비교 → 계약 → 단계별 결제·납품·검수 흐름으로 진행됩니다."
        action={
          <Link href="/requests/new" className="btn btn-primary btn-sm">
            의뢰 등록
          </Link>
        }
      />

      <div className="card mb-4 p-4">
        <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">내가 등록한 의뢰</div>
        {requests.length === 0 ? (
          <div className="mt-2">
            <EmptyState title="등록한 의뢰가 없습니다" />
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-line)] p-3 text-[0.8125rem]">
                <Link href={`/requests/${r.id}`} className="font-semibold text-[var(--color-navy)]">
                  {r.title}
                </Link>
                <div className="flex items-center gap-2">
                  <span className="text-[#5a6a80]">견적 {r._count.quotes}건</span>
                  <Badge tone="amber">{r.status}</Badge>
                  {r.contract && (
                    <Link href={`/dashboard/contracts/${r.contract.id}`} className="btn btn-outline btn-sm">
                      계약
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {quotes.length > 0 && (
        <div className="card p-4">
          <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">내가 제출한 견적</div>
          <ul className="mt-2 space-y-2">
            {quotes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-line)] p-3 text-[0.8125rem]">
                <span>{q.request.title}</span>
                <div className="flex items-center gap-2">
                  <span>{formatKrw(q.totalAmount)}</span>
                  <Badge tone={q.status === "SELECTED" ? "green" : "gray"}>{q.status}</Badge>
                  {q.contract && (
                    <Link href={`/dashboard/contracts/${q.contract.id}`} className="btn btn-outline btn-sm">
                      계약
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
