import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { ESCROW_NOTICE, POLICY_VERSIONS, WITHDRAWAL_CONSENT_TEXT } from "@/lib/brand";
import { requireActor } from "@/lib/session";
import { getProvider, type PgMethod } from "@/server/payments/provider";
import { METHOD_AUTO_CONFIRM_DAYS } from "@/server/services/checkout";
import { Badge, Notice } from "@/components/ui";
import { startPaymentAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(`/checkout/${id}`);

  const order = await prisma.order.findUnique({
    where: { id },
    include: { product: true, seller: true, files: true, payments: true, escrow: true },
  });
  if (!order) notFound();
  if (order.buyerId !== actor.id) notFound();
  if (order.paymentStatus === "PAID") redirect(`/orders/${order.id}`);

  const snapshot = order.snapshot as {
    product: { title: string; licenseType: string; inspectionDays: number; sourceIncluded: boolean };
    files: Array<{ fileName: string; version: number; sizeBytes: number; sha256: string }>;
    fee: { commissionRateBp: number; paymentFeeBearer: string };
  };

  const provider = getProvider();
  const methods: PgMethod[] = provider.paymentMethods();

  return (
    <div className="container-dv py-10">
      <div className="mb-5">
        <Badge tone="amber">테스트 결제 환경</Badge>
        <h1 className="mt-2 text-[1.5rem] font-black text-[var(--color-navy)]">주문 확인 및 결제</h1>
        <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">
          주문 번호 {order.orderNo} · 결제가 확인되면 납품물 접근 권한이 발급됩니다.
        </p>
      </div>

      {sp.error && (
        <div className="mb-5">
          <Notice tone="danger">{sp.error}</Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">주문 상품</h2>
            <div className="mt-3 text-[1.0625rem] font-bold">{snapshot.product.title}</div>
            <div className="mt-1 text-[0.8125rem] text-[#5a6a80]">
              판매자 {order.seller.displayName} ·{" "}
              {snapshot.product.licenseType === "PERIOD" ? "기간제 사용권" : "영구 사용권"} · 검수{" "}
              {snapshot.product.inspectionDays}일
            </div>

            <div className="mt-4">
              <div className="text-[0.75rem] font-semibold text-[#8c98aa]">주문 시점에 고정된 납품물</div>
              <ul className="mt-2 space-y-1.5">
                {order.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--color-tint)] px-3 py-2 text-[0.8125rem]">
                    <span className="font-medium">{f.fileName}</span>
                    <span className="text-[#8c98aa]">v{f.version}</span>
                    <span className="text-[#8c98aa]">{(f.sizeBytes / 1024).toFixed(1)}KB</span>
                    <span className="font-mono text-[0.625rem] text-[#8c98aa]">sha256 {f.sha256.slice(0, 12)}…</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.6875rem] text-[#8c98aa]">
                판매자가 이후 파일을 업데이트해도 이 주문의 납품물은 위 버전으로 고정됩니다.
              </p>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">금액</h2>
            <dl className="mt-3 space-y-2 text-[0.875rem]">
              <div className="flex justify-between">
                <dt className="text-[#5a6a80]">상품 금액</dt>
                <dd>{formatKrw(order.grossAmount - (order.paymentFeeAmount || 0))}</dd>
              </div>
              {order.paymentFeeAmount > 0 && snapshot.fee.paymentFeeBearer === "BUYER" && (
                <div className="flex justify-between">
                  <dt className="text-[#5a6a80]">결제 비용(구매자 부담)</dt>
                  <dd>{formatKrw(order.paymentFeeAmount)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-[var(--color-line)] pt-2 text-[1rem] font-bold">
                <dt>결제 금액</dt>
                <dd className="text-[1.125rem] font-black text-[var(--color-navy)]">{formatKrw(order.grossAmount)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[0.6875rem] text-[#8c98aa]">
              플랫폼 수수료 {snapshot.fee.commissionRateBp / 100}%는 판매자 정산에서 차감되며 구매자 결제 금액에
              영향을 주지 않습니다.
            </p>
          </div>

          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">결제수단 선택</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {methods.map((m, i) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-line)] p-3 text-[0.8125rem] hover:border-[var(--color-navy)]"
                >
                  <input type="radio" name="method" value={m.id} form="payForm" defaultChecked={i === 0} className="mt-1" />
                  <span>
                    <span className="font-semibold">{m.label}</span>
                    <span className="mt-0.5 block text-[0.6875rem] text-[#8c98aa]">
                      자동확정 {METHOD_AUTO_CONFIRM_DAYS[m.id] ?? "-"}일 ·{" "}
                      {m.refundSupport === "PARTIAL" ? "부분 환불 지원" : m.refundSupport === "FULL_ONLY" ? "전액 환불만 지원" : "환불 미지원"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 rounded-md bg-[#fffaf0] p-3 text-[0.6875rem] leading-relaxed text-[#7a5510]">
              결제수단의 자동확정 예정일이 플랫폼 검수 기간보다 짧으면 결제가 차단됩니다. 검수 기간을 확보할 수
              없는 상품은 결제를 진행하지 않습니다.
            </p>
          </div>

          <form id="payForm" action={startPaymentAction} className="card p-5">
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="ip" value="0.0.0.0" />
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">
              청약철회 제한 사전 동의 <span className="text-[#c0392b]">*</span>
            </h2>
            <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-[var(--color-tint)] p-3 text-[0.75rem] leading-relaxed text-[#3c4a60]">
              {WITHDRAWAL_CONSENT_TEXT}
            </div>
            <label className="mt-3 flex items-start gap-2 text-[0.8125rem] font-semibold text-[var(--color-navy)]">
              <input type="checkbox" name="consent" value="agree" required className="mt-1" />
              위 내용을 확인했으며 이에 동의합니다. (동의 시각·IP·문구 버전 {POLICY_VERSIONS.withdrawalConsent}이
              기록됩니다)
            </label>

            <div className="mt-4 rounded-lg border border-[#f3e0b8] bg-[#fffaf0] p-3 text-[0.6875rem] leading-relaxed text-[#7a5510]">
              <strong>결제 전 확인</strong> — {ESCROW_NOTICE.short}
            </div>

            <button className="btn btn-primary mt-4 w-full" type="submit">
              {formatKrw(order.grossAmount)} 테스트 결제 진행
            </button>
            <p className="mt-2 text-center text-[0.6875rem] text-[#8c98aa]">
              실제 카드 승인·송금은 발생하지 않는 샌드박스 결제입니다.
            </p>
          </form>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="card p-5">
            <h2 className="text-[0.875rem] font-bold text-[var(--color-navy)]">이 거래의 보호 상태</h2>
            <ul className="mt-3 space-y-2 text-[0.75rem] leading-relaxed text-[#5a6a80]">
              <li>
                <strong className="text-[var(--color-navy)]">결제</strong> · 아직 결제 전(PENDING)
              </li>
              <li>
                <strong className="text-[var(--color-navy)]">대금 보호</strong> · 결제 후 테스트 PG 모의 보류
                (실제 보호 아님)
              </li>
              <li>
                <strong className="text-[var(--color-navy)]">납품물</strong> · 비공개 보관 {order.files.length}건
              </li>
              <li>
                <strong className="text-[var(--color-navy)]">검수</strong> · 결제 후 시작 가능({order.inspectionDays}일)
              </li>
              <li>
                <strong className="text-[var(--color-navy)]">정산</strong> · 검수 승인·분쟁 없음 확인 후 요청
              </li>
            </ul>
          </div>
          <div className="card p-5 text-[0.75rem] leading-relaxed text-[#5a6a80]">
            <div className="font-bold text-[var(--color-navy)]">문제가 생기면</div>
            <p className="mt-2">
              납품물을 받은 뒤 {order.inspectionDays}일 안에 검수 결과를 제출할 수 있습니다. 기능 불일치·누락
              파일은 검수 화면에서 문제 제기로 분쟁 전환되며, 분쟁 중에는 정산이 보류됩니다.
            </p>
            <Link href="/trust" className="mt-3 inline-block font-semibold text-[var(--color-accent)]">
              분쟁 처리 절차 보기 →
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
