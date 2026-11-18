import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "전문가 찾기" };

export default async function ExpertsPage() {
  const sellers = await prisma.sellerProfile.findMany({
    where: { status: "ACTIVE" },
    include: {
      products: { where: { status: "ACTIVE" }, take: 3 },
      _count: { select: { products: true, orders: true, ipAssets: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="container-dv py-10">
      <SectionHeading
        title="전문가 찾기"
        description="판매자 상점에서 제공 상품·거래 이력·전문 분야를 확인할 수 있습니다."
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sellers.map((s) => (
          <Link key={s.id} href={`/stores/${s.id}`} className="card p-5 hover:border-[var(--color-navy)]">
            <div className="flex items-center justify-between">
              <div className="text-[1rem] font-bold text-[var(--color-navy)]">{s.displayName}</div>
              <Badge tone={s.sellerType === "BUSINESS" ? "navy" : "gray"}>
                {s.sellerType === "BUSINESS" ? "사업자" : "개인"}
              </Badge>
            </div>
            <p className="mt-1 text-[0.75rem] text-[#5a6a80]">{s.intro ?? "소프트웨어·개발 용역 전문 판매자"}</p>
            <div className="mt-3 space-y-1 text-[0.75rem] text-[#5a6a80]">
              {s.products.map((p) => (
                <div key={p.id} className="truncate">
                  · {p.title}
                </div>
              ))}
            </div>
            <div className="mt-3 text-[0.6875rem] text-[#8c98aa]">
              상품 {s._count.products} · 거래 {s._count.orders} · 지식재산권 {s._count.ipAssets}
            </div>
          </Link>
        ))}
        {sellers.length === 0 && (
          <p className="text-[0.8125rem] text-[#8c98aa]">아직 등록된 판매자가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
