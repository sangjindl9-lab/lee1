/**
 * 작업 대기열 — Postgres 테이블 하나로 운영한다 (별도 큐 서비스 비용 없음).
 * 앱 서버 안에서 돌거나(WORKER_MODE=inline, 기본) 별도 작업 서버(WORKER_MODE=only)로 돈다.
 */
import prisma from "./db";
import { processUploadedMedia, purgeMedia } from "./media";
import { recheckDueSubscriptions } from "./play-billing";

export type JobType = "PROCESS_MEDIA" | "PURGE_TRASH" | "DELETE_FAMILY" | "RECHECK_SUBSCRIPTIONS";

export async function enqueue(type: JobType, payload: Record<string, unknown>, runAfter?: Date) {
  return prisma.job.create({ data: { type, payload: JSON.stringify(payload), runAfter: runAfter ?? new Date() } });
}

type Claimed = { id: string; type: string; payload: string; attempts: number };

async function claim(): Promise<Claimed | null> {
  const rows = await prisma.$queryRaw<Claimed[]>`
    UPDATE "Job" SET status = 'RUNNING', attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'QUEUED' AND "runAfter" <= now()
      ORDER BY "runAfter" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts`;
  return rows[0] ?? null;
}

const TRASH_DAYS = 30;

async function runJob(job: Claimed) {
  const payload = JSON.parse(job.payload) as Record<string, string>;
  switch (job.type) {
    case "PROCESS_MEDIA":
      await processUploadedMedia(payload.mediaId);
      break;
    case "PURGE_TRASH": {
      // 휴지통에 30일 넘게 있던 항목은 영구 삭제 → 저장 비용 회수
      const cutoff = new Date(Date.now() - TRASH_DAYS * 24 * 3600 * 1000);
      const old = await prisma.mediaAsset.findMany({ where: { deletedAt: { lt: cutoff } }, take: 500 });
      for (const m of old) await purgeMedia(m);
      // 업로드 허가만 받고 30분 넘게 끝나지 않은 항목 정리
      const stale = await prisma.mediaAsset.findMany({
        where: { status: "UPLOADING", createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
        take: 500,
      });
      for (const m of stale) await purgeMedia(m);
      await enqueue("PURGE_TRASH", {}, new Date(Date.now() + 6 * 3600 * 1000));
      break;
    }
    case "DELETE_FAMILY": {
      const media = await prisma.mediaAsset.findMany({ where: { familyId: payload.familyId }, take: 500 });
      for (const m of media) await purgeMedia(m);
      if (media.length === 500) await enqueue("DELETE_FAMILY", payload);
      else await deleteFamilyRecords(payload.familyId);
      break;
    }
    case "RECHECK_SUBSCRIPTIONS":
      await recheckDueSubscriptions();
      await enqueue("RECHECK_SUBSCRIPTIONS", {}, new Date(Date.now() + 6 * 3600 * 1000));
      break;
    default:
      throw new Error(`알 수 없는 작업: ${job.type}`);
  }
}

async function deleteFamilyRecords(familyId: string) {
  await prisma.$transaction([
    prisma.uploadSession.deleteMany({ where: { familyId } }),
    prisma.careRecord.deleteMany({ where: { familyId } }),
    prisma.mediaAsset.deleteMany({ where: { familyId } }),
    prisma.tag.deleteMany({ where: { familyId } }),
    prisma.album.deleteMany({ where: { familyId } }),
    prisma.child.deleteMany({ where: { familyId } }),
    prisma.purchase.deleteMany({ where: { familyId } }),
    prisma.subscription.updateMany({ where: { familyId }, data: { state: "FAMILY_DELETED" } }),
  ]);
}

export async function runOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  try {
    await runJob(job);
    await prisma.job.update({ where: { id: job.id }, data: { status: "DONE", error: null } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[jobs] ${job.type} 실패 (${job.attempts}회)`, e);
    const retry = job.attempts < 5;
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: retry ? "QUEUED" : "FAILED",
        error: message.slice(0, 1000),
        runAfter: new Date(Date.now() + Math.min(3600, 2 ** job.attempts * 15) * 1000),
      },
    });
    if (!retry && job.type === "PROCESS_MEDIA") {
      const { mediaId } = JSON.parse(job.payload) as { mediaId: string };
      await prisma.mediaAsset.updateMany({ where: { id: mediaId, status: "PROCESSING" }, data: { status: "FAILED", previewQuality: "처리 실패" } });
    }
  }
  return true;
}

let started = false;

/** 주기 작업이 하나씩은 걸려 있게 하고, 대기열을 계속 비운다. */
export function startWorker() {
  if (started || process.env.WORKER_MODE === "off") return;
  started = true;
  void (async () => {
    // 이전 프로세스가 죽으면서 남긴 RUNNING 작업을 다시 대기열로
    await prisma.job
      .updateMany({ where: { status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } }, data: { status: "QUEUED" } })
      .catch(() => undefined);
    for (const type of ["PURGE_TRASH", "RECHECK_SUBSCRIPTIONS"] as const) {
      const exists = await prisma.job.findFirst({ where: { type, status: { in: ["QUEUED", "RUNNING"] } } }).catch(() => null);
      if (!exists) await enqueue(type, {}).catch(() => undefined);
    }
    for (;;) {
      try {
        const worked = await runOnce();
        if (!worked) await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.error("[jobs] 루프 오류", e);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
  console.log("[jobs] 작업 처리 시작");
}
