/**
 * 요금제 · 용량 · 손익 기준.
 * 가격은 "용량을 100% 채워도 남는" 수준으로 잡았다 (재설계안 문서 참고).
 * 실수령 = 판매가 ÷ 1.1(부가세) × 0.85(Play 정기결제 수수료 15%).
 */
import prisma from "./db";

export type PlanId = "FREE" | "FAMILY_50" | "FAMILY_200" | "FAMILY_1TB";

const GB = 1024 ** 3;

export type PlanDef = {
  id: PlanId;
  name: string;
  quotaBytes: number;
  /** 원본 보관 여부. false 면 사진은 고화질 압축본(긴 변 2048px)으로, 동영상은 720p 로 보관한다. */
  keepOriginals: boolean;
  /** 동영상 최대 길이(초). null = 제한 없음 */
  maxVideoSec: number | null;
  ads: boolean;
  zipDownload: boolean;
  /** Play 구독 상품 ID */
  productId: string | null;
  prices: Array<{ basePlanId: "monthly" | "yearly"; priceKRW: number; label: string }>;
  perks: string[];
};

export const PLANS: Record<PlanId, PlanDef> = {
  FREE: {
    id: "FREE",
    name: "무료",
    quotaBytes: 3 * GB,
    keepOriginals: false,
    maxVideoSec: 60,
    ads: true,
    zipDownload: false,
    productId: null,
    prices: [],
    perks: ["가족당 3GB", "사진 고화질 압축 보관", "동영상 1분·720p", "가족 초대·육아기록"],
  },
  FAMILY_50: {
    id: "FAMILY_50",
    name: "패밀리 50GB",
    quotaBytes: 50 * GB,
    keepOriginals: true,
    maxVideoSec: 300,
    ads: false,
    zipDownload: true,
    productId: "family_50",
    prices: [
      { basePlanId: "monthly", priceKRW: 2900, label: "월 2,900원" },
      { basePlanId: "yearly", priceKRW: 29000, label: "연 29,000원 (2달 무료)" },
    ],
    perks: ["가족당 50GB", "사진·동영상 원본 그대로", "동영상 5분", "광고 없음", "원본 ZIP 내려받기"],
  },
  FAMILY_200: {
    id: "FAMILY_200",
    name: "패밀리 200GB",
    quotaBytes: 200 * GB,
    keepOriginals: true,
    maxVideoSec: null,
    ads: false,
    zipDownload: true,
    productId: "family_200",
    prices: [
      { basePlanId: "monthly", priceKRW: 6900, label: "월 6,900원" },
      { basePlanId: "yearly", priceKRW: 75000, label: "연 75,000원" },
    ],
    perks: ["가족당 200GB", "원본 그대로", "동영상 길이 제한 없음", "광고 없음", "원본 ZIP 내려받기"],
  },
  FAMILY_1TB: {
    id: "FAMILY_1TB",
    name: "패밀리 1TB",
    quotaBytes: 1024 * GB,
    keepOriginals: true,
    maxVideoSec: null,
    ads: false,
    zipDownload: true,
    productId: "family_1tb",
    prices: [{ basePlanId: "monthly", priceKRW: 29900, label: "월 29,900원" }],
    perks: ["가족당 1TB", "원본 그대로", "동영상 길이 제한 없음", "광고 없음", "원본 ZIP 내려받기"],
  },
};

export const PAID_PLANS: PlanId[] = ["FAMILY_50", "FAMILY_200", "FAMILY_1TB"];

export function planByProduct(productId: string): PlanDef | null {
  return Object.values(PLANS).find((p) => p.productId === productId) ?? null;
}

export function planOf(id: string | null | undefined): PlanDef {
  return PLANS[(id as PlanId) ?? "FREE"] ?? PLANS.FREE;
}

/** 손익 계산용 상수 (관리자 화면). 환율은 보수적으로 1,450원/$ */
export const ECON = {
  krwPerUsd: Number(process.env.ECON_KRW_PER_USD ?? 1450),
  storageUsdPerGbMonth: Number(process.env.ECON_STORAGE_USD_PER_GB ?? 0.015),
  vat: 0.1,
  storeFee: 0.15,
  fixedUsdPerMonth: Number(process.env.ECON_FIXED_USD ?? 60),
};

export function netKRW(priceKRW: number): number {
  return Math.round((priceKRW / (1 + ECON.vat)) * (1 - ECON.storeFee));
}

export function monthlyNetKRW(plan: PlanDef, basePlanId: string | null): number {
  const price = plan.prices.find((p) => p.basePlanId === basePlanId) ?? plan.prices[0];
  if (!price) return 0;
  const net = netKRW(price.priceKRW);
  return price.basePlanId === "yearly" ? Math.round(net / 12) : net;
}

export function storageCostKRW(bytes: number | bigint): number {
  const gb = Number(bytes) / GB;
  return Math.round(gb * ECON.storageUsdPerGbMonth * ECON.krwPerUsd);
}

export type Usage = {
  plan: PlanDef;
  usedBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  percent: number;
  planExpiresAt: string | null;
};

export async function getUsage(familyId: string): Promise<Usage> {
  const family = await prisma.family.findUnique({ where: { id: familyId } });
  const plan = planOf(family?.plan);
  const used = Number(family?.usedBytes ?? 0);
  return {
    plan,
    usedBytes: used,
    quotaBytes: plan.quotaBytes,
    remainingBytes: Math.max(0, plan.quotaBytes - used),
    percent: Math.min(100, Math.round((used / plan.quotaBytes) * 1000) / 10),
    planExpiresAt: family?.planExpiresAt?.toISOString() ?? null,
  };
}

export class QuotaError extends Error {
  code = "QUOTA_EXCEEDED";
  status = 402;
  constructor(public usage: Usage, public needBytes: number) {
    super(
      `저장 공간이 부족합니다. (${formatBytes(usage.usedBytes)} / ${formatBytes(usage.quotaBytes)} 사용 중) 더 큰 요금제로 바꾸면 계속 올릴 수 있어요.`,
    );
  }
}

/** 올리기 전에 확인: 사용량 + 올릴 크기 ≤ 상한 */
export async function assertQuota(familyId: string, incomingBytes: number): Promise<Usage> {
  const usage = await getUsage(familyId);
  if (usage.usedBytes + incomingBytes > usage.quotaBytes) throw new QuotaError(usage, incomingBytes);
  return usage;
}

export async function addUsage(familyId: string, deltaBytes: number): Promise<void> {
  if (!deltaBytes) return;
  await prisma.family.update({ where: { id: familyId }, data: { usedBytes: { increment: BigInt(Math.round(deltaBytes)) } } });
  if (deltaBytes < 0) {
    // 음수로 내려가지 않게 보정
    await prisma.family.updateMany({ where: { id: familyId, usedBytes: { lt: 0 } }, data: { usedBytes: 0 } });
  }
}

export function formatBytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)}GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)}MB`;
  return `${Math.max(0, Math.round(n / 1024))}KB`;
}
