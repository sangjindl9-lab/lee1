import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { ESCROW_NOTICE, WITHDRAWAL_CONSENT_TEXT } from "@/lib/brand";
import { requireActor } from "@/lib/session";
import { loadOrderForActor } from "@/server/services/access";
import { DEFAULT_CHECKLIST } from "@/server/services/inspection";
import { Badge, Notice } from "@/components/ui";
import {
  deliverOrderAction,
  issueDownloadAction,
  openDisputeAction,
  requestPayoutAction,
  requestRefundAction,
  startInspectionAction,
  submitInspectionAction,
  writeReviewAction,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const LABELS: Record<string, Record<string, string>> = {
  paymentStatus: {
    PENDING: "결제 대기",
    AUTHORIZED: "결제 승인 대기",
    PAID: "결제 완료",
    PARTIALLY_REFUNDED: "부분 환불",
    REFUNDED: "환불 완료",
    FAILED: "결제 실패",
    CANCELLED: "결제 취소",
  },
  escrowStatus: {
    NOT_SUPPORTED: "미지원",
    NOT_REQUESTED: "요청 전",
    REQUESTED: "보류 요청",
    HELD: "모의 보류(테스트)",
    STOP_REQUESTED: "지급 중지 요청",
    STOPPED: "지급 중지",
    RELEASED: "보류 해제",
  },
  deliveryStatus: {
    NOT_DELIVERED: "납품 전",
    DELIVERED: "납품 완료",
    INCOMPLETE: "납품 미완료",
    WITHDRAWN: "납품 철회",
  },
  inspectionStatus: {
    NOT_STARTED: "시작 전",
    IN_PROGRESS: "검수 중",
    APPROVED: "검수 승인",
    REVISION_REQUESTED: "수정 요청",
    AUTO_CONFIRMED: "자동확정",
    BLOCKED: "검수 차단",
  },
  disputeStatus: {
    NONE: "없음",
    OPEN: "접수",
    EVIDENCE: "자료 제출",
    NEGOTIATION: "협의",
    DECIDED: "판단 완료",
    WITHDRAWN: "철회",
  },
  refundStatus: {
    NONE: "없음",
    REQUESTED: "요청 접수",
    APPROVED: "승인",
    PROCESSING: "처리 중",
    COMPLETED: "환불 완료",
    PARTIALLY_COMPLETED: "부분 환불 완료",
    RECOVERY_REQUIRED: "사후 환수 필요",
    REJECTED: "반려",
    FAILED: "실패",
    UNSUPPORTED: "수단 미지원",
  },
  payoutStatus: {
    NOT_ELIGIBLE: "정산 불가",
    ELIGIBLE: "정산 가능",
    REQUESTED: "지급 요청",
    PROCESSING: "지급 확인 중",
    PAID: "지급 완료",
    FAILED: "지급 실패",
    ON_HOLD: "지급 보류",
    CANCELLED: "취소",
  },
};

const TONE: Record<string, "gray" | "green" | "amber" | "red" | "blue" | "navy"> = {
  PAID: "green",
  DELIVERED: "green",
  APPROVED: "green",
  AUTO_CONFIRMED: "green",
  NOT_ELIGIBLE: "gray",
  NONE: "gray",
  PENDING: "amber",
  NOT_STARTED: "gray",
  NOT_DELIVERED: "gray",
  REQUESTED: "amber",
  IN_PROGRESS: "blue",
  PROCESSING: "amber",
  ON_HOLD: "amber",
  OPEN: "red",
  FAILED: "red",
  RECOVERY_REQUIRED: "red",
  UNSUPPORTED: "red",
  BLOCKED: "red",
  ELIGIBLE: "blue",
  HELD: "blue",
};

function StateBox({ label, statusKey, value }: { label: string; statusKey: string; value: string }) {
  const text = LABELS[statusKey]?.[value] ?? value;
  const tone = TONE[value] ?? "gray";
  return (
    <div className="rounded-lg border border-[var(--color-line)] p-3">
      <div className="text-[0.625rem] font-semibold uppercase tracking-wide text-[#8c98aa]">{label}</div>
      <div className="mt-1">
        <Badge tone={tone}>{text}</Badge>
      </div>
    </div>
  );
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(`/orders/${id}`);
  const order = await loadOrderForActor(actor, id, "VIEW").catch(() => null);
  if (!order) notFound();

  const isBuyerSide = order.buyerId === actor.id || (!!order.buyerCompanyId && actor.companyId === order.buyerCompanyId);
  const isSeller = order.seller.userId === actor.id;
  const canSeeSettlement = isSeller || (isBuyerSide && actor.companyRole === "ADMIN") || actor.roles.some((r) => r.startsWith("OPERATOR_") || r === "SUPER_ADMIN");

  const snapshot = order.snapshot as {
    product: { title: string; licenseType: string; inspectionDays: number; platforms: string[]; sourceIncluded: boolean; seller: { displayName: string } };
    files: Array<{ fileName: string; version: number; sha256: string; sizeBytes: number }>;
    fee: { commissionRateBp: number; paymentFeeBearer: string };
  };

  const alreadyReviewed = isBuyerSide
    ? await prisma.review.findUnique({ where: { orderId: order.id } })
    : null;

  return (
    <div className="container-dv py-9">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[0.75rem] text-[#8c98aa]">주문번호 {order.orderNo}</div>
          <h1 className="mt-1 text-[1.5rem] font-black text-[var(--color-navy)]">
            {snapshot.product.title}
          </h1>
          <div className="mt-1 text-[0.8125rem] text-[#5a6a80]">
            판매자 {order.seller.displayName} · 구매자 {order.buyer.name} · {new Date(order.createdAt).toLocaleString("ko-KR")}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/purchases" className="btn btn-outline btn-sm">
            내 거래 목록
          </Link>
          {isSeller && order.productId && (
            <Link href={`/seller/products/${order.productId}`} className="btn btn-outline btn-sm">
              상품 관리
            </Link>
          )}
        </div>
      </div>

      {(sp.error || sp.ok) && (
        <div className="mb-5">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="card mb-6 p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
          <StateBox label="결제" statusKey="paymentStatus" value={order.paymentStatus} />
          <StateBox label="대금 보호" statusKey="escrowStatus" value={order.escrowStatus} />
          <StateBox label="납품" statusKey="deliveryStatus" value={order.deliveryStatus} />
          <StateBox label="검수" statusKey="inspectionStatus" value={order.inspectionStatus} />
          <StateBox label="분쟁" statusKey="disputeStatus" value={order.disputeStatus} />
          <StateBox label="환불" statusKey="refundStatus" value={order.refundStatus} />
          <StateBox label="정산" statusKey="payoutStatus" value={order.payoutStatus} />
        </div>
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-[#8c98aa]">
          상태는 서로 독립적입니다. 결제 완료가 검수 완료를, 다운로드가 구매확정을 의미하지 않습니다. 대금 보호
          상태는 연결된 결제 사업자의 실제 상태를 표시하며, 테스트 환경에서는 모의 보류로 표시됩니다.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">납품물</h2>
            <p className="mt-1 text-[0.75rem] text-[#8c98aa]">
              결제 완료 후 발급되는 만료형 링크로만 받을 수 있습니다(10분, 최대 3회).
            </p>
            <ul className="mt-3 space-y-2">
              {order.files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-tint)] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[0.875rem] font-semibold">{f.fileName}</div>
                    <div className="text-[0.6875rem] text-[#8c98aa]">
                      v{f.version} · {(f.sizeBytes / 1024).toFixed(1)}KB · sha256 {f.sha256.slice(0, 12)}…
                    </div>
                  </div>
                  {order.paymentStatus === "PAID" && order.refundStatus !== "COMPLETED" ? (
                    <form action={issueDownloadAction}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="orderFileId" value={f.id} />
                      <button className="btn btn-primary btn-sm" type="submit">
                        다운로드
                      </button>
                    </form>
                  ) : (
                    <span className="text-[0.6875rem] text-[#8c98aa]">결제 확인 후 가능</span>
                  )}
                </li>
              ))}
              {order.files.length === 0 && (
                <li className="rounded-lg border border-dashed border-[var(--color-line)] p-4 text-[0.8125rem] text-[#8c98aa]">
                  이 주문에는 아직 납품물이 없습니다.
                </li>
              )}
            </ul>
          </section>

          {isSeller && (
            <section className="card p-5">
              <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">판매자 작업</h2>
              {order.paymentStatus === "PAID" && order.deliveryStatus !== "DELIVERED" && (
                <form action={deliverOrderAction} className="mt-3 space-y-2">
                  <input type="hidden" name="orderId" value={order.id} />
                  <input name="note" className="input" placeholder="납품 메모(선택)" />
                  <button className="btn btn-primary" type="submit">
                    납품 완료 처리
                  </button>
                  <p className="text-[0.6875rem] text-[#8c98aa]">
                    모든 납품물이 저장소에서 열리고 해시가 일치해야 납품이 완료됩니다.
                  </p>
                </form>
              )}
              {order.payoutStatus === "ELIGIBLE" && (
                <form action={requestPayoutAction} className="mt-3">
                  <input type="hidden" name="orderId" value={order.id} />
                  <button className="btn btn-accent" type="submit">
                    정산 지급 요청 ({formatKrw(order.sellerNetAmount)})
                  </button>
                </form>
              )}
              {order.payoutStatus === "PROCESSING" && (
                <p className="mt-3 rounded-md bg-[#fffaf0] p-3 text-[0.75rem] text-[#7a5510]">
                  지급 요청 응답이 확인되지 않았습니다. 중복 지급을 막기 위해 재요청하지 않고, 정산 담당자가 사업자
                  조회로 결과를 확정합니다.
                </p>
              )}
              {order.payoutStatus === "PAID" && (
                <p className="mt-3 text-[0.8125rem] text-[#17703f]">
                  지급 완료 · {formatKrw(order.payout?.amount ?? 0)} · {order.payout?.paidAt?.toLocaleString("ko-KR")}
                </p>
              )}
              <div className="mt-4 border-t border-[var(--color-line)] pt-3">
                <Link href="/dashboard/disputes" className="text-[0.75rem] font-semibold text-[var(--color-accent)]">
                  판매자 보호 절차 보기 →
                </Link>
              </div>
            </section>
          )}

          {isBuyerSide && order.deliveryStatus === "DELIVERED" && (
            <section className="card p-5">
              <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">검수</h2>
              {order.inspectionStatus !== "IN_PROGRESS" && order.inspectionStatus !== "APPROVED" && order.inspectionStatus !== "AUTO_CONFIRMED" && order.inspectionStatus !== "REVISION_REQUESTED" && (
                <form action={startInspectionAction} className="mt-3">
                  <input type="hidden" name="orderId" value={order.id} />
                  <button className="btn btn-outline" type="submit">
                    검수 시작 ({order.inspectionEndsAt?.toLocaleDateString("ko-KR")}까지)
                  </button>
                </form>
              )}
              {order.inspectionStatus === "IN_PROGRESS" && (
                <form action={submitInspectionAction} className="mt-3 space-y-3">
                  <input type="hidden" name="orderId" value={order.id} />
                  <ul className="space-y-2">
                    {DEFAULT_CHECKLIST.map((item) => (
                      <li key={item.key} className="flex items-start gap-2">
                        <input type="checkbox" name={`chk_${item.key}`} id={item.key} className="mt-1" />
                        <label htmlFor={item.key} className="text-[0.8125rem] text-[#3c4a60]">
                          {item.label}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <textarea name="note" className="input h-20" placeholder="검수 의견(선택)" />
                  <div className="flex flex-wrap gap-2">
                    <button name="decision" value="APPROVED" className="btn btn-primary" type="submit">
                      검수 승인
                    </button>
                    <button name="decision" value="REVISION_REQUESTED" className="btn btn-outline" type="submit">
                      수정 요청
                    </button>
                    <button name="decision" value="DISPUTED" className="btn btn-outline" type="submit">
                      문제 제기(분쟁 전환)
                    </button>
                  </div>
                  <p className="text-[0.6875rem] text-[#8c98aa]">
                    승인 시 정산이 가능해집니다. 다운로드만으로는 검수 완료로 처리되지 않습니다.
                  </p>
                </form>
              )}
              {(order.inspectionStatus === "APPROVED" || order.inspectionStatus === "AUTO_CONFIRMED") && (
                <p className="mt-3 text-[0.8125rem] text-[#17703f]">
                  검수 승인 완료 · {order.confirmedAt?.toLocaleString("ko-KR")}
                </p>
              )}
              {order.inspectionStatus === "REVISION_REQUESTED" && (
                <p className="mt-3 text-[0.8125rem] text-[#8a5a00]">수정 요청 상태입니다. 판매자 수정 후 재검수합니다.</p>
              )}

              {order.inspectionStatus === "APPROVED" && !alreadyReviewed && (
                <form action={writeReviewAction} className="mt-5 border-t border-[var(--color-line)] pt-4">
                  <input type="hidden" name="orderId" value={order.id} />
                  <div className="label">실제 구매자 후기</div>
                  <select name="rating" className="input mb-2">
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {"★".repeat(n)} ({n}점)
                      </option>
                    ))}
                  </select>
                  <textarea name="body" className="input h-20" placeholder="설치·기능·지원 경험" required />
                  <button className="btn btn-outline mt-2" type="submit">
                    후기 등록
                  </button>
                </form>
              )}
            </section>
          )}

          {(isBuyerSide || isSeller) && (
            <section className="card p-5">
              <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">문제 해결</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <form action={openDisputeAction} className="space-y-2">
                  <input type="hidden" name="orderId" value={order.id} />
                  <div className="label">분쟁·신고 접수</div>
                  <select name="category" className="input">
                    <option value="NO_DELIVERY">미납품·잠적</option>
                    <option value="FILE_MISMATCH">파일·기능 불일치</option>
                    <option value="MISSING_FILES">필수 파일 누락</option>
                    <option value="ENVIRONMENT">실행 환경 문제</option>
                    <option value="RIGHTS">권리 침해 의심</option>
                    <option value="OTHER">기타</option>
                  </select>
                  <textarea name="body" className="input h-20" placeholder="상황을 구체적으로 적어 주세요" required />
                  <button className="btn btn-outline" type="submit">
                    분쟁 접수
                  </button>
                  <p className="text-[0.6875rem] text-[#8c98aa]">
                    접수 시 정산이 보류되고 결제 사업자 지급 중지를 요청합니다. 접수만으로 지급이 멈췄다고 표시하지
                    않습니다.
                  </p>
                </form>
                {isBuyerSide && (
                  <form action={requestRefundAction} className="space-y-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <div className="label">환불 요청</div>
                    <input name="amount" className="input" inputMode="numeric" placeholder={`금액(미입력 시 전액 ${formatKrw(order.grossAmount)})`} />
                    <textarea name="reason" className="input h-20" placeholder="환불 사유" required />
                    <button className="btn btn-outline" type="submit">
                      환불 요청
                    </button>
                    <p className="text-[0.6875rem] text-[#8c98aa]">
                      요청 접수와 환불 완료는 다릅니다. 운영자가 결제 취소 성공을 확인한 뒤에만 완료로 표시됩니다.
                    </p>
                  </form>
                )}
              </div>
            </section>
          )}

          <section className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">거래 기록</h2>
            <ul className="mt-3 space-y-2 text-[0.75rem] text-[#5a6a80]">
              <li>· 주문 생성 {order.createdAt.toLocaleString("ko-KR")}</li>
              {order.consentWithdrawalAt && (
                <li>
                  · 청약철회 제한 동의 {order.consentWithdrawalAt.toLocaleString("ko-KR")} · IP {order.consentIp} · 문구
                  버전 {order.consentVersion}
                </li>
              )}
              {order.paidAt && <li>· 결제 완료 {order.paidAt.toLocaleString("ko-KR")}</li>}
              {order.deliveries.map((d) => (
                <li key={d.id}>
                  · 납품 시도 {d.attempt}회차 · {d.status === "DELIVERED" ? "완료" : d.status} ·{" "}
                  {d.deliveredAt.toLocaleString("ko-KR")}
                </li>
              ))}
              {order.inspections.map((i) => (
                <li key={i.id}>
                  · 검수 {i.result} · {i.decidedAt.toLocaleString("ko-KR")}
                  {i.note ? ` · ${i.note}` : ""}
                </li>
              ))}
              {order.disputes.map((d) => (
                <li key={d.id}>
                  · 분쟁 {d.disputeNo} · {d.status}
                  {d.resolution ? ` · 판단 ${d.resolution}` : ""}
                  {d.decisionReason ? ` · 근거: ${d.decisionReason}` : ""}
                </li>
              ))}
              {order.refunds.map((r) => (
                <li key={r.id}>
                  · 환불 {r.status} · {formatKrw(r.amount)} · {r.requestedAt.toLocaleString("ko-KR")}
                  {r.failureReason ? ` · ${r.failureReason}` : ""}
                </li>
              ))}
              {order.payout && (
                <li>
                  · 판매자 지급 {order.payout.status} · {formatKrw(order.payout.amount)} ·{" "}
                  {order.payout.requestedAt.toLocaleString("ko-KR")}
                </li>
              )}
            </ul>
            <div className="mt-4 rounded-md bg-[var(--color-tint)] p-3 text-[0.6875rem] leading-relaxed text-[#5a6a80]">
              {WITHdrawalSummary()}
            </div>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="card p-5">
            <h2 className="text-[0.875rem] font-bold text-[var(--color-navy)]">계약 조건 (주문 시점 고정)</h2>
            <dl className="mt-3 space-y-1.5 text-[0.75rem]">
              <Row k="사용권" v={snapshot.product.licenseType === "PERIOD" ? "기간제" : "영구"} />
              <Row k="지원 환경" v={snapshot.product.platforms.join(", ") || "-"} />
              <Row k="소스 제공" v={snapshot.product.sourceIncluded ? "포함" : "미포함"} />
              <Row k="검수 기간" v={`${order.inspectionDays}일`} />
              <Row k="납품 기한" v={order.deliveryDueAt ? order.deliveryDueAt.toLocaleDateString("ko-KR") : "-"} />
              <Row k="검수 기한" v={order.inspectionEndsAt ? order.inspectionEndsAt.toLocaleDateString("ko-KR") : "-"} />
              <Row k="수수료율" v={`${order.commissionRateBp / 100}%`} />
            </dl>
          </div>

          {canSeeSettlement && (
            <div className="card p-5">
              <h2 className="text-[0.875rem] font-bold text-[var(--color-navy)]">정산 내역</h2>
              <dl className="mt-3 space-y-1.5 text-[0.75rem]">
                <Row k="결제 금액" v={formatKrw(order.grossAmount)} />
                <Row k="플랫폼 수수료" v={`- ${formatKrw(order.commissionAmount)}`} />
                <Row k="결제 비용" v={`- ${formatKrw(order.paymentFeeAmount)}`} />
                <Row k="원천징수" v={`- ${formatKrw(order.withholdingTax)}`} />
                <Row k="환불액" v={`- ${formatKrw(order.refundedAmount)}`} />
                <Row k="지급액" v={formatKrw(order.sellerNetAmount)} strong />
              </dl>
              <p className="mt-3 text-[0.6875rem] leading-relaxed text-[#8c98aa]">
                수수료 정책은 주문 시점 값으로 고정되어 이후 정책 변경의 영향을 받지 않습니다. 사업자 판매자는
                세금계산서 발행, 개인 판매자는 3.3% 원천징수로 처리됩니다.
              </p>
            </div>
          )}

          <div className="card p-5 text-[0.6875rem] leading-relaxed text-[#5a6a80]">
            <div className="text-[0.8125rem] font-bold text-[var(--color-navy)]">안전거래 고지</div>
            <p className="mt-2">{ESCROW_NOTICE.short}</p>
            <p className="mt-2">{ESCROW_NOTICE.limitation}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[#8c98aa]">{k}</dt>
      <dd className={strong ? "font-bold text-[var(--color-navy)]" : ""}>{v}</dd>
    </div>
  );
}

function WITHdrawalSummary() {
  return (
    <>
      <strong className="text-[var(--color-navy)]">청약철회 안내</strong> — {WITHDRAWAL_CONSENT_TEXT.slice(0, 120)}…
    </>
  );
}
