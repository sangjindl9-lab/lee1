import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireOperator } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { decideDisputeAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "분쟁 처리" };

export default async function AdminDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  await requireOperator("SUPPORT");
  const disputes = await prisma.dispute.findMany({
    include: { order: { include: { product: true, seller: true, buyer: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-[1.125rem] font-bold text-[var(--color-navy)]">분쟁·신고 처리</h1>
      <p className="mt-1 text-[0.75rem] text-[#8c98aa]">
        판단에는 근거·처리자·일시가 기록됩니다. AI는 최종 판단을 대신하지 않으며 참고 의견만 제공합니다.
      </p>
      {(sp.error || sp.ok) && (
        <div className="mt-3">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-4 space-y-3">
        {disputes.map((d) => (
          <div key={d.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[0.9375rem] font-bold text-[var(--color-navy)]">
                    {d.order.product?.title ?? d.order.orderNo}
                  </span>
                  <Badge tone={d.status === "DECIDED" ? "green" : "red"}>{d.status}</Badge>
                  <span className="text-[0.6875rem] text-[#8c98aa]">{d.disputeNo}</span>
                </div>
                <div className="mt-0.5 text-[0.75rem] text-[#5a6a80]">
                  {d.category} · 구매자 {d.order.buyer.name} · 판매자 {d.order.seller.displayName} · 외부 중지{" "}
                  {d.providerHoldState}
                </div>
                <p className="mt-1 text-[0.8125rem] text-[#3c4a60]">{d.body}</p>
                <Link href={`/orders/${d.orderId}`} className="mt-1 inline-block text-[0.6875rem] font-semibold text-[var(--color-accent)]">
                  거래 상세 보기 →
                </Link>
              </div>
              {d.status !== "DECIDED" && d.status !== "WITHDRAWN" ? (
                <form action={decideDisputeAction} className="w-full max-w-sm space-y-2">
                  <input type="hidden" name="disputeId" value={d.id} />
                  <select name="resolution" className="input">
                    <option value="RESUME">거래 재개</option>
                    <option value="REFUND">전액 환불</option>
                    <option value="PARTIAL_REFUND">부분 환불</option>
                    <option value="PAYOUT">판매자 지급 진행</option>
                  </select>
                  <input name="refundAmount" className="input" inputMode="numeric" placeholder="환불 금액(선택)" />
                  <textarea name="reason" required className="input h-20" placeholder="판단 근거 (10자 이상)" />
                  <button className="btn btn-primary btn-sm" type="submit">
                    판단 기록
                  </button>
                </form>
              ) : (
                <div className="max-w-sm rounded-lg bg-[var(--color-tint)] p-3 text-[0.75rem] text-[#5a6a80]">
                  판단: {d.resolution}
                  <br />
                  근거: {d.decisionReason}
                  <br />
                  처리자 {d.decidedById?.slice(0, 8)} · {d.decidedAt?.toLocaleString("ko-KR")}
                </div>
              )}
            </div>
          </div>
        ))}
        {disputes.length === 0 && <p className="text-[0.8125rem] text-[#8c98aa]">접수된 분쟁이 없습니다.</p>}
      </div>
    </div>
  );
}
