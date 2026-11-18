import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { Badge, EmptyState, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "상품 비교" };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);

  const products = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids } }, include: { seller: true, files: true } })
    : [];

  const rows: Array<[string, (p: (typeof products)[number]) => string]> = [
    ["유형", (p) => (p.type === "SOURCE" ? "소스코드" : "완성형 사용권")],
    ["분야", (p) => p.category],
    ["가격", (p) => formatKrw(p.priceKrw)],
    ["사용권", (p) => (p.licenseType === "PERIOD" ? `기간제 ${p.licenseMonths ?? 12}개월` : "영구")],
    ["지원 환경", (p) => p.platforms.join(", ") || "-"],
    ["소스 제공", (p) => (p.sourceIncluded ? "포함" : "미포함")],
    ["설치 지원", (p) => (p.installSupport ? "포함" : "미포함")],
    ["커스터마이징", (p) => (p.customization ? "가능" : "불가")],
    ["제3자 라이선스", (p) => p.thirdPartyDeps ?? "없음"],
    ["외부 유료 비용", (p) => p.externalCostNote ?? "없음"],
    ["검수 기간", (p) => `${p.inspectionDays}일`],
    ["납품물", (p) => `${p.files.length}건`],
    ["평점", (p) => (p.ratingCount > 0 ? `★ ${p.ratingAvg.toFixed(1)} (${p.ratingCount})` : "후기 없음")],
  ];

  return (
    <div className="container-dv py-10">
      <SectionHeading title="상품 비교" description="최대 4개 상품의 제공 범위·권리 조건·추가 비용을 나란히 비교합니다." />

      {products.length === 0 ? (
        <EmptyState
          title="비교할 상품이 없습니다"
          description="상품 상세 화면에서 '비교함에 담기'를 눌러 주세요."
          action={
            <Link href="/solutions" className="btn btn-primary btn-sm">
              상품 둘러보기
            </Link>
          }
        />
      ) : (
        <div className="card overflow-x-auto p-4">
          <table className="w-full min-w-[640px] text-left text-[0.8125rem]">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className="w-32 py-2 text-[0.6875rem] text-[#8c98aa]">항목</th>
                {products.map((p) => (
                  <th key={p.id} className="py-2">
                    <Link href={`/products/${p.id}`} className="font-bold text-[var(--color-navy)]">
                      {p.title}
                    </Link>
                    <div className="text-[0.6875rem] font-normal text-[#8c98aa]">{p.seller.displayName}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, get]) => (
                <tr key={label} className="border-b border-[var(--color-line)]">
                  <th className="py-2 text-[0.75rem] font-medium text-[#8c98aa]">{label}</th>
                  {products.map((p) => (
                    <td key={p.id} className="py-2">
                      {get(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-2">
            {products.map((p) => (
              <Badge key={p.id} tone="gray">
                {p.title}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
