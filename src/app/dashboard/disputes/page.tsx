import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/session";
import { Badge, EmptyState, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "신고·분쟁" };

export default async function DisputesPage() {
  const actor = await requireActor("/dashboard/disputes");
  const sellerId = actor.sellerProfileId;

  const disputes = await prisma.dispute.findMany({
    where: {
      order: {
        OR: [
          { buyerId: actor.id },
          ...(sellerId ? [{ sellerId }] : []),
          ...(actor.companyId ? [{ buyerCompanyId: actor.companyId }] : []),
        ],
      },
    },
    include: { order: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <SectionHeading title="신고·분쟁" description="접수 → 지급 보류 확인 → 자료 제출 → 판단 → 처리 순서로 진행됩니다." />
      {disputes.length === 0 ? (
        <EmptyState title="접수된 분쟁이 없습니다" description="문제가 생기면 거래 작업실에서 접수할 수 있습니다." />
      ) : (
        <div className="space-y-3">
          {disputes.map((d) => (
            <div key={d.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">
                    {d.order.product?.title ?? d.order.orderNo} · {d.category}
                  </div>
                  <div className="text-[0.6875rem] text-[#8c98aa]">
                    {d.disputeNo} · {d.createdAt.toLocaleString("ko-KR")} · 외부 중지 요청 {d.providerHoldState}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={d.status === "DECIDED" ? "green" : "red"}>{d.status}</Badge>
                  <Link href={`/orders/${d.orderId}`} className="btn btn-outline btn-sm">
                    거래 보기
                  </Link>
                </div>
              </div>
              <p className="mt-2 text-[0.8125rem] text-[#3c4a60]">{d.body}</p>
              {d.resolution && (
                <div className="mt-2 rounded-md bg-[var(--color-tint)] p-2 text-[0.75rem] text-[#5a6a80]">
                  판단: {d.resolution} · {d.decisionReason} · {d.decidedAt?.toLocaleString("ko-KR")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
