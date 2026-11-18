import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/session";
import { OrderTable } from "@/components/order-table";
import { SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "구매 관리" };

export default async function PurchasesPage() {
  const actor = await requireActor("/dashboard/purchases");
  const orders = await prisma.order.findMany({
    where: actor.companyId
      ? { OR: [{ buyerId: actor.id }, { buyerCompanyId: actor.companyId }] }
      : { buyerId: actor.id },
    include: { product: true, seller: true, buyer: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <SectionHeading
        title="구매 관리"
        description="결제·납품·검수·정산 상태를 각각 확인할 수 있습니다."
      />
      <div className="card p-4">
        <OrderTable orders={orders} perspective="BUYER" emptyTitle="구매한 거래가 없습니다" emptyDescription="솔루션·소스코드 마켓에서 상품을 찾아보세요." />
      </div>
    </div>
  );
}
