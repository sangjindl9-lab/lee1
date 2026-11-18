import Link from "next/link";
import { formatKrw } from "@/lib/money";
import { Badge, EmptyState } from "@/components/ui";

const PAYMENT: Record<string, string> = {
  PENDING: "결제 대기",
  AUTHORIZED: "승인 대기",
  PAID: "결제 완료",
  PARTIALLY_REFUNDED: "부분 환불",
  REFUNDED: "환불 완료",
  FAILED: "결제 실패",
  CANCELLED: "결제 취소",
};
const DELIVERY: Record<string, string> = {
  NOT_DELIVERED: "납품 전",
  DELIVERED: "납품 완료",
  INCOMPLETE: "납품 미완료",
  WITHDRAWN: "철회",
};
const INSPECTION: Record<string, string> = {
  NOT_STARTED: "검수 전",
  IN_PROGRESS: "검수 중",
  APPROVED: "검수 승인",
  REVISION_REQUESTED: "수정 요청",
  AUTO_CONFIRMED: "자동확정",
  BLOCKED: "차단",
};
const PAYOUT: Record<string, string> = {
  NOT_ELIGIBLE: "정산 불가",
  ELIGIBLE: "정산 가능",
  REQUESTED: "지급 요청",
  PROCESSING: "확인 중",
  PAID: "지급 완료",
  FAILED: "지급 실패",
  ON_HOLD: "보류",
  CANCELLED: "취소",
};

export interface OrderRow {
  id: string;
  orderNo: string;
  grossAmount: number;
  sellerNetAmount: number;
  paymentStatus: string;
  deliveryStatus: string;
  inspectionStatus: string;
  disputeStatus: string;
  refundStatus: string;
  payoutStatus: string;
  createdAt: Date;
  product: { title: string } | null;
  seller: { displayName: string };
  buyer: { name: string };
}

export function OrderTable({
  orders,
  perspective,
  emptyTitle = "거래가 없습니다",
  emptyDescription,
}: {
  orders: OrderRow[];
  perspective: "BUYER" | "SELLER";
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (orders.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[0.8125rem]">
        <thead className="border-b border-[var(--color-line)] text-[0.6875rem] uppercase tracking-wide text-[#8c98aa]">
          <tr>
            <th className="py-2">상품·주문</th>
            <th className="py-2">{perspective === "BUYER" ? "판매자" : "구매자"}</th>
            <th className="py-2 text-right">금액</th>
            <th className="py-2">상태</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-[var(--color-line)] align-top">
              <td className="py-3">
                <div className="font-semibold text-[var(--color-navy)]">{o.product?.title ?? "맞춤 개발 단계"}</div>
                <div className="text-[0.6875rem] text-[#8c98aa]">
                  {o.orderNo} · {o.createdAt.toLocaleDateString("ko-KR")}
                </div>
              </td>
              <td className="py-3 text-[#5a6a80]">{perspective === "BUYER" ? o.seller.displayName : o.buyer.name}</td>
              <td className="py-3 text-right font-semibold">{formatKrw(o.grossAmount)}</td>
              <td className="py-3">
                <div className="flex flex-wrap gap-1">
                  <Badge tone={o.paymentStatus === "PAID" ? "green" : "amber"}>{PAYMENT[o.paymentStatus] ?? o.paymentStatus}</Badge>
                  <Badge tone={o.deliveryStatus === "DELIVERED" ? "green" : "gray"}>{DELIVERY[o.deliveryStatus] ?? o.deliveryStatus}</Badge>
                  <Badge tone={o.inspectionStatus === "APPROVED" ? "green" : "gray"}>{INSPECTION[o.inspectionStatus] ?? o.inspectionStatus}</Badge>
                  {o.disputeStatus !== "NONE" && <Badge tone="red">분쟁</Badge>}
                  {o.refundStatus !== "NONE" && <Badge tone="amber">환불 {o.refundStatus}</Badge>}
                  <Badge tone={o.payoutStatus === "PAID" ? "green" : "navy"}>{PAYOUT[o.payoutStatus] ?? o.payoutStatus}</Badge>
                </div>
              </td>
              <td className="py-3 text-right">
                <Link href={`/orders/${o.id}`} className="btn btn-outline btn-sm">
                  작업실
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
