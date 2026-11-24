/**
 * 가족의 '지금 유효한' 요금제와 저장 공간 권한.
 * family.plan 은 마지막 계산 결과일 뿐이라, 만료 시각이 지났으면 Google 에 다시 확인한 뒤에 쓴다.
 * 요금제 조회·업로드 시작·직접 업로드·업로드 완료가 모두 이 함수를 거친다.
 */
import prisma from "./db";
import { formatBytes, planOf, QuotaError, type PlanDef, type Usage } from "./plans";
import { refreshFamilyEntitlement } from "./play-billing";

export async function getEffectivePlan(familyId: string): Promise<{ plan: PlanDef; expiresAt: Date | null; unverified: boolean }> {
  const family = await prisma.family.findUnique({ where: { id: familyId }, select: { plan: true, planExpiresAt: true } });
  if (!family) return { plan: planOf("FREE"), expiresAt: null, unverified: false };
  if (family.plan !== "FREE" && (!family.planExpiresAt || family.planExpiresAt.getTime() <= Date.now())) {
    const r = await refreshFamilyEntitlement(familyId);
    return { plan: planOf(r.plan), expiresAt: r.expiresAt, unverified: r.unverified };
  }
  return { plan: planOf(family.plan), expiresAt: family.planExpiresAt, unverified: false };
}

export async function getEffectiveUsage(familyId: string): Promise<Usage & { unverified: boolean }> {
  const eff = await getEffectivePlan(familyId);
  const family = await prisma.family.findUnique({ where: { id: familyId }, select: { usedBytes: true } });
  const used = Number(family?.usedBytes ?? 0);
  const quota = eff.plan.quotaBytes;
  return {
    plan: eff.plan,
    usedBytes: used,
    quotaBytes: quota,
    remainingBytes: Math.max(0, quota - used),
    percent: Math.min(100, Math.round((used / quota) * 1000) / 10),
    planExpiresAt: eff.expiresAt?.toISOString() ?? null,
    unverified: eff.unverified,
  };
}

/** 미리 확인만 한다 (예약하지 않음): 업로드 세션을 만들 때 */
export async function assertQuota(familyId: string, incomingBytes: number): Promise<Usage> {
  const usage = await getEffectiveUsage(familyId);
  if (usage.usedBytes + incomingBytes > usage.quotaBytes) throw new QuotaError(usage, incomingBytes);
  return usage;
}

/**
 * 저장 공간을 원자적으로 예약한다: '사용량 + 크기 ≤ 상한'일 때만 한 번의 UPDATE 로 늘린다.
 * 여러 기기에서 동시에 올려도 상한을 넘겨 예약되지 않는다. 예약을 돌려줄 때는 addUsage(-크기).
 */
export async function reserveQuota(familyId: string, bytes: number): Promise<{ plan: PlanDef }> {
  const eff = await getEffectivePlan(familyId);
  const n = BigInt(Math.max(0, Math.round(bytes)));
  const quota = BigInt(eff.plan.quotaBytes);
  const rows = await prisma.$queryRaw<Array<{ usedBytes: bigint }>>`
    UPDATE "Family" SET "usedBytes" = "usedBytes" + ${n}
    WHERE "id" = ${familyId} AND "usedBytes" + ${n} <= ${quota}
    RETURNING "usedBytes"`;
  if (!rows.length) {
    const usage = await getEffectiveUsage(familyId);
    throw new QuotaError(usage, Number(n));
  }
  return { plan: eff.plan };
}

export function describeUsage(u: Usage) {
  return `${formatBytes(u.usedBytes)} / ${formatBytes(u.quotaBytes)}`;
}
