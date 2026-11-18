import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/session";
import { OrderTable } from "@/components/order-table";
import { EmptyState, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "계약·검수" };

export default async function InspectionPage() {
  const actor = await requireActor("/dashboard/inspection");
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { buyerId: actor.id },
        ...(actor.companyId ? [{ buyerCompanyId: actor.companyId }] : []),
      ],
      deliveryStatus: "DELIVERED",
      inspectionStatus: { in: ["NOT_STARTED", "IN_PROGRESS", "REVISION_REQUESTED"] },
    },
    include: { product: true, seller: true, buyer: true },
    orderBy: { inspectionEndsAt: "asc" },
  });

  return (
    <div>
      <SectionHeading title="계약·검수" description="검수 기한이 가까운 순서로 표시됩니다. 기한이 지나고 문제 제기가 없으면 자동확정될 수 있습니다." />
      {orders.length === 0 ? (
        <EmptyState title="검수할 거래가 없습니다" description="납품이 완료되면 이곳에 표시됩니다." />
      ) : (
        <div className="card p-4">
          <OrderTable orders={orders} perspective="BUYER" />
          <div className="mt-3 space-y-1 text-[0.6875rem] text-[#8c98aa]">
            {orders.map((o) => (
              <div key={o.id}>
                {o.product?.title ?? o.orderNo} — 검수 기한{" "}
                {o.inspectionEndsAt ? o.inspectionEndsAt.toLocaleDateString("ko-KR") : "미정"}{" "}
                <Link href={`/orders/${o.id}`} className="font-semibold text-[var(--color-accent)]">
                  검수하기
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
