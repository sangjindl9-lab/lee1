import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireOperator } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { processRefundAction, resolvePayoutAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "결제·환불·정산" };

export default async function AdminSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  await requireOperator("SETTLEMENT");

  const [refunds, payouts] = await Promise.all([
    prisma.refundRecord.findMany({
      include: { order: { include: { product: true, payments: true, seller: true } } },
      orderBy: { requestedAt: "desc" },
    }),
    prisma.payout.findMany({
      include: { order: { include: { product: true } }, seller: true },
      orderBy: { requestedAt: "desc" },
    }),
  ]);

  return (
    <div>
      <h1 className="text-[1.125rem] font-bold text-[var(--color-navy)]">결제·환불·정산</h1>
      <p className="mt-1 text-[0.75rem] text-[#8c98aa]">
        환불은 결제 취소 성공을 확인한 뒤에만 완료됩니다. 기정산 거래는 사후 환수 절차로 분리됩니다.
      </p>
      {(sp.error || sp.ok) && (
        <div className="mt-3">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <h2 className="mt-5 text-[0.9375rem] font-bold text-[var(--color-navy)]">환불 요청</h2>
      <div className="mt-2 space-y-2">
        {refunds.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-2">
                <Link href={`/orders/${r.orderId}`} className="text-[0.875rem] font-bold text-[var(--color-navy)]">
                  {r.order.product?.title ?? r.order.orderNo}
                </Link>
                <Badge tone={r.status === "COMPLETED" ? "green" : r.status === "RECOVERY_REQUIRED" ? "red" : "amber"}>
                  {r.status}
                </Badge>
              </div>
              <div className="text-[0.75rem] text-[#5a6a80]">
                {formatKrw(r.amount)} · {r.reason}
              </div>
              <div className="text-[0.6875rem] text-[#8c98aa]">
                결제수단 {r.order.payments[0]?.method ?? "-"} · 판매자 {r.order.seller.displayName}
                {r.failureReason ? ` · ${r.failureReason}` : ""}
              </div>
            </div>
            {(r.status === "REQUESTED" || r.status === "PROCESSING") && (
              <form action={processRefundAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="refundId" value={r.id} />
                <input name="note" className="input w-40" placeholder="메모" />
                <button name="decision" value="approve" className="btn btn-primary btn-sm" type="submit">
                  환불 처리
                </button>
                <button name="decision" value="reject" className="btn btn-outline btn-sm" type="submit">
                  반려
                </button>
              </form>
            )}
          </div>
        ))}
        {refunds.length === 0 && <p className="text-[0.8125rem] text-[#8c98aa]">환불 요청이 없습니다.</p>}
      </div>

      <h2 className="mt-6 text-[0.9375rem] font-bold text-[var(--color-navy)]">판매자 지급</h2>
      <div className="mt-2 space-y-2">
        {payouts.map((p) => (
          <div key={p.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-2">
                <Link href={`/orders/${p.orderId}`} className="text-[0.875rem] font-bold text-[var(--color-navy)]">
                  {p.order?.product?.title ?? p.orderId}
                </Link>
                <Badge tone={p.status === "PAID" ? "green" : p.status === "FAILED" ? "red" : "amber"}>{p.status}</Badge>
              </div>
              <div className="text-[0.75rem] text-[#5a6a80]">
                {p.seller.displayName} · {formatKrw(p.amount)} · 원천징수 {formatKrw(p.withholdingTax)}
              </div>
              <div className="text-[0.6875rem] text-[#8c98aa]">
                요청 {p.requestedAt.toLocaleString("ko-KR")} · 시도 {p.attempts}회 {p.lastError ? `· ${p.lastError}` : ""}
              </div>
            </div>
            {p.status === "PROCESSING" && (
              <form action={resolvePayoutAction}>
                <input type="hidden" name="payoutId" value={p.id} />
                <input type="hidden" name="back" value="/admin/settlements" />
                <button className="btn btn-outline btn-sm" type="submit">
                  사업자 조회로 확정
                </button>
              </form>
            )}
          </div>
        ))}
        {payouts.length === 0 && <p className="text-[0.8125rem] text-[#8c98aa]">지급 내역이 없습니다.</p>}
      </div>
    </div>
  );
}
