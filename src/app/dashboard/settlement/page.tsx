import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireActor } from "@/lib/session";
import { Badge, EmptyState, SectionHeading } from "@/components/ui";
import { resolvePayoutAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "정산" };

const STATUS: Record<string, { label: string; tone: "gray" | "green" | "amber" | "red" | "blue" }> = {
  REQUESTED: { label: "지급 요청", tone: "amber" },
  PROCESSING: { label: "확인 중", tone: "amber" },
  PAID: { label: "지급 완료", tone: "green" },
  FAILED: { label: "지급 실패", tone: "red" },
  ON_HOLD: { label: "보류", tone: "red" },
};

export default async function SettlementPage() {
  const actor = await requireActor("/dashboard/settlement");
  const seller = actor.sellerProfileId
    ? await prisma.sellerProfile.findUnique({ where: { id: actor.sellerProfileId } })
    : null;

  const payouts = seller
    ? await prisma.payout.findMany({
        where: { sellerId: seller.id },
        include: { order: { include: { product: true } } },
        orderBy: { requestedAt: "desc" },
      })
    : [];

  const eligible = seller
    ? await prisma.order.findMany({
        where: { sellerId: seller.id, payoutStatus: "ELIGIBLE" },
        include: { product: true },
      })
    : [];

  const totals = payouts.reduce(
    (acc, p) => {
      if (p.status === "PAID") acc.paid += p.amount;
      else if (p.status !== "FAILED") acc.pending += p.amount;
      return acc;
    },
    { paid: 0, pending: 0 },
  );

  return (
    <div>
      <SectionHeading title="정산" description="지급 요청과 지급 완료는 구분해서 표시됩니다." />

      {!seller ? (
        <EmptyState title="판매자 등록이 필요합니다" action={<Link href="/dashboard/seller" className="btn btn-primary btn-sm">판매자 등록</Link>} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <div className="text-[0.6875rem] text-[#8c98aa]">지급 완료 누계</div>
              <div className="text-[1.125rem] font-extrabold text-[var(--color-navy)]">{formatKrw(totals.paid)}</div>
            </div>
            <div className="card p-4">
              <div className="text-[0.6875rem] text-[#8c98aa]">진행 중</div>
              <div className="text-[1.125rem] font-extrabold text-[#8a5a00]">{formatKrw(totals.pending)}</div>
            </div>
            <div className="card p-4">
              <div className="text-[0.6875rem] text-[#8c98aa]">정산 유형</div>
              <div className="text-[1.125rem] font-extrabold text-[var(--color-navy)]">
                {seller.sellerType === "BUSINESS" ? "사업자(세금계산서)" : "개인(3.3% 원징)"}
              </div>
            </div>
          </div>

          {eligible.length > 0 && (
            <div className="card mb-4 p-4">
              <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">지급 요청 가능 {eligible.length}건</div>
              <ul className="mt-2 space-y-1 text-[0.8125rem]">
                {eligible.map((o) => (
                  <li key={o.id} className="flex items-center justify-between">
                    <Link href={`/orders/${o.id}`} className="text-[var(--color-accent)]">
                      {o.product?.title ?? o.orderNo}
                    </Link>
                    <span>{formatKrw(o.sellerNetAmount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card p-4">
            <div className="mb-2 text-[0.875rem] font-bold text-[var(--color-navy)]">지급 내역</div>
            {payouts.length === 0 ? (
              <p className="text-[0.8125rem] text-[#8c98aa]">지급 내역이 없습니다.</p>
            ) : (
              <table className="w-full text-left text-[0.8125rem]">
                <thead className="border-b border-[var(--color-line)] text-[0.6875rem] text-[#8c98aa]">
                  <tr>
                    <th className="py-2">주문</th>
                    <th className="py-2 text-right">금액</th>
                    <th className="py-2">상태</th>
                    <th className="py-2">요청일</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id} className="border-b border-[var(--color-line)]">
                      <td className="py-2">{p.order?.product?.title ?? p.orderId}</td>
                      <td className="py-2 text-right">{formatKrw(p.amount)}</td>
                      <td className="py-2">
                        <Badge tone={STATUS[p.status]?.tone ?? "gray"}>{STATUS[p.status]?.label ?? p.status}</Badge>
                      </td>
                      <td className="py-2 text-[#8c98aa]">{p.requestedAt.toLocaleDateString("ko-KR")}</td>
                      <td className="py-2 text-right">
                        {p.status === "PROCESSING" && (
                          <form action={resolvePayoutAction}>
                            <input type="hidden" name="payoutId" value={p.id} />
                            <input type="hidden" name="back" value="/dashboard/settlement" />
                            <button className="btn btn-outline btn-sm" type="submit">
                              결과 조회
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="mt-4 text-[0.6875rem] leading-relaxed text-[#8c98aa]">
            정산 전 확인 항목: 실제 결제 상태 · 납품·검수 상태 · 환불·분쟁 상태 · 판매자 확인 상태 · 실제 지급 가능
            잔액 · 중복 지급 여부. 응답이 불명확한 지급은 재요청하지 않고 사업자 조회로 확정합니다.
          </p>
        </>
      )}
    </div>
  );
}
