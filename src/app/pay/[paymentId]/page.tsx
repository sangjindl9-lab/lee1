import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireActor } from "@/lib/session";
import { Notice } from "@/components/ui";
import { approveSandboxPaymentAction } from "@/app/actions";

export const dynamic = "force-dynamic";

/** 테스트 PG 결제창 — 실제 결제가 아님을 화면에 명시한다. */
export default async function MockPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { paymentId } = await params;
  const sp = await searchParams;
  const actor = await requireActor(`/pay/${paymentId}`);

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { include: { product: true } } },
  });
  if (!payment) notFound();
  if (payment.order.buyerId !== actor.id) notFound();
  if (payment.order.paymentStatus === "PAID") redirect(`/orders/${payment.orderId}`);

  const methodLabel =
    payment.method === "CARD"
      ? "신용·체크카드"
      : payment.method === "VBANK"
        ? "가상계좌"
        : payment.method === "BANK_TRANSFER"
          ? "계좌이체"
          : "간편결제";

  return (
    <div className="container-dv flex min-h-[70vh] items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="card overflow-hidden">
          <div className="bg-[var(--color-navy)] px-5 py-4 text-white">
            <div className="text-[0.6875rem] uppercase tracking-[0.2em] text-[#9db4d4]">Sandbox PG</div>
            <div className="mt-1 text-[1rem] font-bold">테스트 결제창</div>
          </div>
          <div className="p-5">
            {sp.error && (
              <div className="mb-4">
                <Notice tone="danger">{sp.error}</Notice>
              </div>
            )}
            <div className="text-[0.75rem] text-[#8c98aa]">주문번호 {payment.order.orderNo}</div>
            <div className="mt-1 text-[0.9375rem] font-bold text-[var(--color-navy)]">
              {payment.order.product?.title ?? payment.order.orderNo}
            </div>
            <dl className="mt-4 space-y-1.5 text-[0.8125rem]">
              <div className="flex justify-between">
                <dt className="text-[#5a6a80]">결제수단</dt>
                <dd>{methodLabel} (테스트)</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#5a6a80]">거래번호</dt>
                <dd className="font-mono text-[0.6875rem]">{payment.providerTxId}</dd>
              </div>
              <div className="flex justify-between border-t border-[var(--color-line)] pt-2 text-[1rem] font-black">
                <dt>결제 금액</dt>
                <dd className="text-[var(--color-navy)]">{formatKrw(payment.amount)}</dd>
              </div>
            </dl>

            <form action={approveSandboxPaymentAction} className="mt-5">
              <input type="hidden" name="paymentId" value={payment.id} />
              <input type="hidden" name="orderId" value={payment.orderId} />
              <button className="btn btn-accent w-full" type="submit">
                테스트 결제 승인
              </button>
            </form>
            <p className="mt-3 text-[0.6875rem] leading-relaxed text-[#8c98aa]">
              승인 버튼을 누르면 서명된 웹훅이 서버로 전달되고, 서버가 검증한 뒤에만 결제 완료로 처리됩니다.
              브라우저 화면만으로 결제 상태를 바꾸지 않습니다. 실제 카드 승인은 발생하지 않습니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
