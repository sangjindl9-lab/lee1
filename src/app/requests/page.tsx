import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { getCurrentActor } from "@/lib/session";
import { Badge, EmptyState, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "맞춤 개발 의뢰" };

export default async function RequestsPage() {
  const actor = await getCurrentActor();
  const requests = await prisma.devRequest.findMany({
    where: actor
      ? { OR: [{ visibility: "PUBLIC" }, { buyerId: actor.id }] }
      : { visibility: "PUBLIC" },
    include: { _count: { select: { quotes: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="container-dv py-10">
      <SectionHeading
        title="맞춤 개발 의뢰"
        description="요구사항·예산·납기·권리 귀속을 정리해 견적을 받습니다. 단계별 금액과 검수 기준을 계약으로 고정합니다."
        action={
          <Link href="/requests/new" className="btn btn-primary btn-sm">
            의뢰 등록
          </Link>
        }
      />

      {requests.length === 0 ? (
        <EmptyState title="등록된 의뢰가 없습니다" description="첫 의뢰를 등록해 견적을 받아 보세요." />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Link key={r.id} href={`/requests/${r.id}`} className="card block p-4 hover:border-[var(--color-navy)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.9375rem] font-bold text-[var(--color-navy)]">{r.title}</span>
                    <Badge tone={r.visibility === "PRIVATE" ? "gray" : "blue"}>
                      {r.visibility === "PRIVATE" ? "비공개" : "공개"}
                    </Badge>
                    <Badge tone="amber">{r.status}</Badge>
                  </div>
                  <div className="mt-1 text-[0.75rem] text-[#5a6a80]">
                    예산 {r.budgetKrw ? formatKrw(r.budgetKrw) : "협의"} · 납기 {r.deadline ?? "협의"} · 견적{" "}
                    {r._count.quotes}건
                  </div>
                </div>
                <span className="text-[0.6875rem] text-[#8c98aa]">{r.createdAt.toLocaleDateString("ko-KR")}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
