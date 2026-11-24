/**
 * 구독 종료 후 보관 정책.
 * - 구독이 끝나 무료(3GB)가 된 가족은 끝난 날부터 30일 동안 모든 사진·동영상을 그대로 보관한다.
 * - 그 사이 재구독하거나 3GB 이하로 줄이면 아무것도 지우지 않는다.
 * - 기한이 지나도 3GB 를 넘으면, 넘는 만큼만 지운다: 휴지통에 있던 것 먼저, 그다음 최근에 올린 것부터.
 *   오래된 사진(아기 때 사진 등)이 남는다. 앨범·육아기록·댓글 기록은 지우지 않는다.
 */
import prisma from "./db";
import { purgeMedia } from "./media";
import { PLANS, formatBytes } from "./plans";
import { refreshFamilyEntitlement } from "./play-billing";

const BATCH = 200;

export type RetentionNotice = { until: Date; overBytes: number; overLabel: string; daysLeft: number };

/** 화면 안내용: 보관 기한이 잡혀 있고 아직 무료 용량을 넘는 경우 */
export async function getRetentionNotice(familyId: string): Promise<RetentionNotice | null> {
  const fam = await prisma.family.findUnique({ where: { id: familyId }, select: { plan: true, usedBytes: true, retentionUntil: true } });
  if (!fam?.retentionUntil || fam.plan !== "FREE") return null;
  const over = Number(fam.usedBytes) - PLANS.FREE.quotaBytes;
  if (over <= 0) return null;
  const daysLeft = Math.max(0, Math.ceil((fam.retentionUntil.getTime() - Date.now()) / (24 * 3600 * 1000)));
  return { until: fam.retentionUntil, overBytes: over, overLabel: formatBytes(over), daysLeft };
}

/** 한 가족의 보관 기한 처리. 기한 전이거나 다시 유료가 되었으면 아무것도 지우지 않는다. */
export async function enforceRetention(familyId: string, now = new Date()): Promise<{ deleted: number; reason: string }> {
  const fam = await prisma.family.findUnique({ where: { id: familyId }, select: { retentionUntil: true } });
  if (!fam?.retentionUntil) return { deleted: 0, reason: "no-deadline" };
  if (fam.retentionUntil.getTime() > now.getTime()) return { deleted: 0, reason: "not-due" };

  // 지우기 직전에 Google 에 다시 확인: 재구독했으면 기한이 풀린다
  const plan = await refreshFamilyEntitlement(familyId);
  if (plan.plan !== "FREE" || plan.unverified) {
    // 유료로 돌아왔거나, Google 장애로 확인이 안 되면 지우지 않는다 (다음 실행 때 다시 본다)
    return { deleted: 0, reason: plan.unverified ? "unverified" : "resubscribed" };
  }

  const quota = PLANS.FREE.quotaBytes;
  const usedNow = async () => Number((await prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { usedBytes: true } })).usedBytes);
  let deleted = 0;
  let used = await usedNow();
  // 1) 휴지통(이미 지우기로 한 것) 2) 최근에 올린 것부터
  for (const phase of ["trash", "active"] as const) {
    while (used > quota) {
      const batch = await prisma.mediaAsset.findMany({
        where: { familyId, deletedAt: phase === "trash" ? { not: null } : null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: BATCH,
        select: { id: true, familyId: true, originalPath: true, previewPath: true, thumbPath: true, storedBytes: true },
      });
      if (!batch.length) break;
      for (const m of batch) {
        await purgeMedia(m);
        deleted += 1;
        used -= m.storedBytes;
        if (used <= quota) break;
      }
      used = await usedNow();
    }
  }
  await prisma.family.update({
    where: { id: familyId },
    data: { retentionUntil: null, retentionEnforcedAt: now, retentionDeletedCount: { increment: deleted } },
  });
  if (deleted) console.warn(`[retention] 가족 ${familyId}: 보관 기한이 지나 ${deleted}개 삭제 (남은 사용량 ${formatBytes(used)})`);
  return { deleted, reason: "enforced" };
}

/** 작업 서버가 6시간마다 부른다 */
export async function enforceDueRetention(now = new Date()) {
  const due = await prisma.family.findMany({ where: { retentionUntil: { lte: now } }, select: { id: true }, take: 50 });
  for (const f of due) {
    await enforceRetention(f.id, now).catch((e) => console.error("[retention] 실패", f.id, e instanceof Error ? e.message : e));
  }
  return due.length;
}
