import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { Badge, EmptyState, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "지식재산권 거래" };

export default async function IpPage() {
  const assets = await prisma.ipAsset.findMany({
    where: { status: { in: ["ACTIVE", "EXCLUSIVE_LOCKED"] } },
    include: { seller: true, _count: { select: { vault: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="container-dv py-10">
      <SectionHeading
        title="지식재산권 거래"
        description="저작재산권 양도, 독점·비독점 이용허락, 소프트웨어 사업 자산 양도를 상담·계약으로 진행합니다."
        action={
          <Link href="/support" className="btn btn-outline btn-sm">
            거래 상담
          </Link>
        }
      />

      {assets.length === 0 ? (
        <EmptyState title="등록된 지식재산권 자산이 없습니다" description="판매자는 판매자 센터에서 자산을 등록할 수 있습니다." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {assets.map((a) => (
            <Link key={a.id} href={`/ip/${a.id}`} className="card p-5 hover:border-[var(--color-navy)]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="navy">
                  {a.transferMode === "ASSIGNMENT"
                    ? "권리 양도"
                    : a.transferMode === "EXCLUSIVE_LICENSE"
                      ? "독점 이용허락"
                      : a.transferMode === "NON_EXCLUSIVE_LICENSE"
                        ? "비독점 이용허락"
                        : "상담"}
                </Badge>
                <Badge tone="gray">{a.rightsType}</Badge>
                {a.status === "EXCLUSIVE_LOCKED" && <Badge tone="red">독점 잠금</Badge>}
              </div>
              <h3 className="mt-2 text-[1rem] font-bold text-[var(--color-navy)]">{a.title}</h3>
              <p className="mt-1 line-clamp-2 text-[0.8125rem] text-[#5a6a80]">{a.publicIntro}</p>
              <div className="mt-3 flex items-center justify-between text-[0.75rem]">
                <span className="text-[#8c98aa]">
                  {a.seller.displayName} · 비공개 자료 {a._count.vault}건
                </span>
                <span className="font-bold text-[var(--color-navy)]">{formatKrw(a.priceKrw)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-xl bg-[var(--color-tint)] p-5 text-[0.8125rem] leading-relaxed text-[#3c4a60]">
        <strong className="text-[var(--color-navy)]">거래 절차</strong> — 상담 → 비밀유지 조건 합의 → 자료 열람 → 권리·기술
        확인 → 거래 조건 확정 → 계약·결제 → 자산 인도 → 권리 이전 절차 확인 → 완료·정산. 소스 파일 전달만으로 모든
        지식재산권이 이전되었다고 표시하지 않습니다. 계약서는 법률 검토 전 초안입니다.
      </div>
    </div>
  );
}
