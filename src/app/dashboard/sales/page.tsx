import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/session";
import { OrderTable } from "@/components/order-table";
import { SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "판매 관리" };

export default async function SalesPage() {
  const actor = await requireActor("/dashboard/sales");
  const seller = actor.sellerProfileId
    ? await prisma.sellerProfile.findUnique({ where: { id: actor.sellerProfileId } })
    : null;

  const orders = seller
    ? await prisma.order.findMany({
        where: { sellerId: seller.id },
        include: { product: true, seller: true, buyer: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const questions = seller
    ? await prisma.productQuestion.findMany({
        where: { product: { sellerId: seller.id }, answer: null },
        include: { product: true },
        take: 5,
      })
    : [];

  return (
    <div>
      <SectionHeading
        title="판매 관리"
        description={seller ? `${seller.displayName} · ${seller.status === "ACTIVE" ? "판매 승인" : seller.status}` : "판매자 등록이 필요합니다"}
        action={
          seller ? (
            <Link href="/seller/products/new" className="btn btn-primary btn-sm">
              상품 등록
            </Link>
          ) : (
            <Link href="/dashboard/seller" className="btn btn-primary btn-sm">
              판매자 등록
            </Link>
          )
        }
      />

      {questions.length > 0 && (
        <div className="card mb-4 p-4">
          <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">답변 대기 문의 {questions.length}건</div>
          <ul className="mt-2 space-y-1 text-[0.8125rem] text-[#5a6a80]">
            {questions.map((q) => (
              <li key={q.id}>
                <Link href={`/products/${q.productId}`} className="font-semibold text-[var(--color-accent)]">
                  {q.product.title}
                </Link>{" "}
                — {q.body.slice(0, 40)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-4">
        <OrderTable
          orders={orders}
          perspective="SELLER"
          emptyTitle="판매 내역이 없습니다"
          emptyDescription="상품을 등록하고 심사를 통과하면 판매가 시작됩니다."
        />
      </div>
    </div>
  );
}
