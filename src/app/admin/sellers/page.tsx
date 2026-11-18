import { prisma } from "@/lib/db";
import { requireOperator } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { reviewSellerAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "판매자 심사" };

export default async function AdminSellersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  await requireOperator("REVIEW");
  const sellers = await prisma.sellerProfile.findMany({
    include: { user: true, _count: { select: { products: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-[1.125rem] font-bold text-[var(--color-navy)]">판매자 심사</h1>
      <p className="mt-1 text-[0.75rem] text-[#8c98aa]">사업자 여부·정산 계좌 등록·판매 권한을 확인합니다.</p>
      {(sp.error || sp.ok) && (
        <div className="mt-3">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-4 space-y-2">
        {sellers.map((s) => (
          <div key={s.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[0.9375rem] font-bold text-[var(--color-navy)]">{s.displayName}</span>
                <Badge tone={s.status === "ACTIVE" ? "green" : s.status === "PENDING" ? "amber" : "red"}>{s.status}</Badge>
              </div>
              <div className="text-[0.75rem] text-[#5a6a80]">
                {s.user.email} · {s.sellerType === "BUSINESS" ? `사업자 ${s.bizRegNo ?? ""}` : "개인"} · 정산계좌{" "}
                {s.accountMasked ?? "미등록"} · 상품 {s._count.products}건
              </div>
            </div>
            <form action={reviewSellerAction} className="flex items-center gap-2">
              <input type="hidden" name="sellerId" value={s.id} />
              <input name="note" className="input w-40" placeholder="메모" />
              <button name="decision" value="ACTIVE" className="btn btn-primary btn-sm" type="submit">
                승인
              </button>
              <button name="decision" value="SUSPENDED" className="btn btn-outline btn-sm" type="submit">
                중지
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
