import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireOperator } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { reviewProductAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "상품 심사" };

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  await requireOperator("REVIEW");
  const products = await prisma.product.findMany({
    where: { status: { in: ["PENDING_REVIEW", "ACTIVE", "BLOCKED", "SUSPENDED"] } },
    include: { seller: true, files: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 40,
  });

  return (
    <div>
      <h1 className="text-[1.125rem] font-bold text-[var(--color-navy)]">상품·파일 심사</h1>
      <p className="mt-1 text-[0.75rem] text-[#8c98aa]">납품물이 없거나 검사에서 문제가 발견된 상품은 판매 승인할 수 없습니다.</p>
      {(sp.error || sp.ok) && (
        <div className="mt-3">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-4 space-y-3">
        {products.map((p) => (
          <div key={p.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Link href={`/products/${p.id}`} className="text-[0.9375rem] font-bold text-[var(--color-navy)]">
                    {p.title}
                  </Link>
                  <Badge tone={p.status === "ACTIVE" ? "green" : p.status === "PENDING_REVIEW" ? "amber" : "red"}>
                    {p.status}
                  </Badge>
                </div>
                <div className="mt-0.5 text-[0.75rem] text-[#5a6a80]">
                  {p.seller.displayName} · {p.category} · {formatKrw(p.priceKrw)} · 납품물 {p.files.length}건
                </div>
                <ul className="mt-1 space-y-0.5 text-[0.6875rem] text-[#8c98aa]">
                  {p.files.map((f) => (
                    <li key={f.id}>
                      {f.fileName} v{f.version} · {(f.sizeBytes / 1024).toFixed(1)}KB · {f.scanStatus}
                    </li>
                  ))}
                  {p.adminReviewNote && <li>심사 메모: {p.adminReviewNote}</li>}
                </ul>
              </div>
              <form action={reviewProductAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="productId" value={p.id} />
                <input name="note" className="input w-48" placeholder="심사 메모" />
                <button name="decision" value="ACTIVE" className="btn btn-primary btn-sm" type="submit">
                  판매 승인
                </button>
                <button name="decision" value="BLOCKED" className="btn btn-outline btn-sm" type="submit">
                  차단
                </button>
                <button name="decision" value="SUSPENDED" className="btn btn-outline btn-sm" type="submit">
                  판매 중지
                </button>
              </form>
            </div>
          </div>
        ))}
        {products.length === 0 && <p className="text-[0.8125rem] text-[#8c98aa]">심사할 상품이 없습니다.</p>}
      </div>
    </div>
  );
}
