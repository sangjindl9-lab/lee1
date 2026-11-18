import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Badge, EmptyState, ProductCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seller = await prisma.sellerProfile.findUnique({
    where: { id },
    include: {
      products: { where: { status: "ACTIVE" }, include: { seller: true }, orderBy: { createdAt: "desc" } },
      ipAssets: { where: { status: { in: ["ACTIVE", "EXCLUSIVE_LOCKED"] } } },
    },
  });
  if (!seller) notFound();

  return (
    <div className="container-dv py-10">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[1.375rem] font-black text-[var(--color-navy)]">{seller.displayName}</h1>
              <Badge tone={seller.sellerType === "BUSINESS" ? "navy" : "gray"}>
                {seller.sellerType === "BUSINESS" ? "사업자" : "개인"}
              </Badge>
              {seller.status === "ACTIVE" && <Badge tone="green">판매 승인</Badge>}
            </div>
            <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">{seller.intro ?? "소프트웨어·개발 용역 판매자"}</p>
          </div>
          <div className="text-right text-[0.75rem] text-[#8c98aa]">
            상품 {seller.products.length}건 · 지식재산권 {seller.ipAssets.length}건
          </div>
        </div>
      </div>

      <h2 className="section-title mt-8 mb-4">판매 상품</h2>
      {seller.products.length === 0 ? (
        <EmptyState title="판매 중인 상품이 없습니다" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {seller.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

      {seller.ipAssets.length > 0 && (
        <>
          <h2 className="section-title mt-8 mb-4">지식재산권 자산</h2>
          <ul className="space-y-2">
            {seller.ipAssets.map((a) => (
              <li key={a.id} className="card p-4 text-[0.875rem]">
                {a.title} · {a.rightsType}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
