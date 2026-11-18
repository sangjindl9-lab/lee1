import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireActor } from "@/lib/session";
import { Badge, EmptyState, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "거래별 작업실" };

export default async function WorkspacePage() {
  const actor = await requireActor("/dashboard/workspace");
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { buyerId: actor.id },
        ...(actor.sellerProfileId ? [{ sellerId: actor.sellerProfileId }] : []),
        ...(actor.companyId ? [{ buyerCompanyId: actor.companyId }] : []),
      ],
    },
    include: { product: true, seller: true },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });

  return (
    <div>
      <SectionHeading title="거래별 작업실" description="결제·납품·검수·분쟁·정산을 한 화면에서 확인합니다." />
      {orders.length === 0 ? (
        <EmptyState title="진행 중인 거래가 없습니다" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="card p-4 hover:border-[var(--color-navy)]">
              <div className="flex items-center justify-between">
                <span className="text-[0.6875rem] text-[#8c98aa]">{o.orderNo}</span>
                <span className="text-[0.6875rem] text-[#8c98aa]">{o.updatedAt.toLocaleDateString("ko-KR")}</span>
              </div>
              <div className="mt-1 text-[0.9375rem] font-bold text-[var(--color-navy)]">
                {o.product?.title ?? "맞춤 개발 단계"}
              </div>
              <div className="mt-1 text-[0.75rem] text-[#5a6a80]">
                {o.seller.displayName} · {formatKrw(o.grossAmount)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone={o.paymentStatus === "PAID" ? "green" : "amber"}>{o.paymentStatus}</Badge>
                <Badge tone="gray">{o.deliveryStatus}</Badge>
                <Badge tone="gray">{o.inspectionStatus}</Badge>
                {o.disputeStatus !== "NONE" && <Badge tone="red">분쟁</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
