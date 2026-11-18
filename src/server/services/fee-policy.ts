import { prisma } from "@/lib/db";
import type { PaymentFeeBearer, SellerType } from "@/lib/money";

export interface ResolvedPolicy {
  policyId: string | null;
  commissionRateBp: number;
  paymentFeeRateBp: number;
  paymentFeeBearer: PaymentFeeBearer;
  discountRateBp: number;
  note: string;
}

const DEFAULT_POLICY: ResolvedPolicy = {
  policyId: null,
  commissionRateBp: 1000, // 10%
  paymentFeeRateBp: 0,
  paymentFeeBearer: "SELLER",
  discountRateBp: 0,
  note: "기본 정책",
};

/**
 * 주문 시점의 수수료 정책을 확정한다.
 * 우선순위: 판매자별 > 카테고리별 > 기본. 할인 기간이 지난 정책은 제외한다.
 * 확정된 값은 주문 스냅샷에 저장되어, 이후 정책 변경이 기존 주문에 영향을 주지 않는다.
 */
export async function resolveFeePolicy(input: {
  sellerId: string;
  category: string;
  at?: Date;
}): Promise<ResolvedPolicy> {
  const at = input.at ?? new Date();
  const policies = await prisma.feePolicy.findMany({
    where: {
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      AND: [
        {
          OR: [
            { scope: "SELLER", sellerId: input.sellerId },
            { scope: "CATEGORY", category: input.category },
            { scope: "DEFAULT" },
          ],
        },
      ],
    },
    orderBy: [{ effectiveFrom: "desc" }],
  });

  const sellerPolicy = policies.find((p) => p.scope === "SELLER");
  const categoryPolicy = policies.find((p) => p.scope === "CATEGORY");
  const defaultPolicy = policies.find((p) => p.scope === "DEFAULT");
  const picked = sellerPolicy ?? categoryPolicy ?? defaultPolicy;

  if (!picked) return DEFAULT_POLICY;

  const discountActive =
    picked.discountRateBp > 0 && (!picked.discountUntil || picked.discountUntil > at);

  return {
    policyId: picked.id,
    commissionRateBp: picked.commissionRateBp,
    paymentFeeRateBp: picked.paymentFeeRateBp,
    paymentFeeBearer: picked.paymentFeeBearer as PaymentFeeBearer,
    discountRateBp: discountActive ? picked.discountRateBp : 0,
    note: picked.note ?? `${picked.scope} 정책`,
  };
}

export function sellerWithholdingRateBp(sellerType: SellerType): number {
  // 사업자: 세금계산서 발행(원천징수 없음) / 개인: 3.3% 원천징수
  return sellerType === "INDIVIDUAL" ? 330 : 0;
}
