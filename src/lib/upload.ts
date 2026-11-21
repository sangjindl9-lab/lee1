import type { UploadItem, UploadSession } from "@prisma/client";
import prisma from "./db";
import { MAX_DIRECT_UPLOAD_BYTES, MAX_UPLOAD_BYTES, UPLOAD_STATUS, UPLOAD_STATUS_LABEL } from "./constants";
import { createMedia, kindFromMime, newObjectBase } from "./media";
import { addUsage, assertQuota, planOf, type PlanDef } from "./plans";
import { extensionFor, signedPutUrl, storedSize, useS3 } from "./storage";
import { enqueue } from "./jobs";

/** 저장될 크기 추정 (무료는 압축 보관이라 원본보다 작다) */
export function estimateStoredBytes(plan: PlanDef, mimeType: string, size: number): number {
  const isVideo = mimeType.startsWith("video/");
  if (!plan.keepOriginals) return isVideo ? Math.min(size, 40 * 1024 * 1024) : Math.min(size, 1.2 * 1024 * 1024);
  return Math.round(size * 1.1);
}

export type UploadFileInput = {
  clientFileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export class UploadError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function createUploadSession(input: {
  userId: string;
  familyId: string;
  childId: string;
  albumId: string;
  visibility: string;
  files: UploadFileInput[];
}): Promise<{ session: UploadSession; items: UploadItem[] }> {
  if (!input.files.length) throw new UploadError("NO_FILES", "업로드할 파일이 없습니다.");
  if (input.files.length > 300) throw new UploadError("TOO_MANY_FILES", "한 번에 300개까지 업로드할 수 있습니다.");

  const child = await prisma.child.findFirst({ where: { id: input.childId, familyId: input.familyId } });
  if (!child) throw new UploadError("CHILD_NOT_FOUND", "아이를 찾을 수 없습니다.", 404);
  const album = await prisma.album.findFirst({ where: { id: input.albumId, childId: child.id } });
  if (!album) throw new UploadError("ALBUM_NOT_FOUND", "앨범을 찾을 수 없습니다.", 404);

  const family = await prisma.family.findUnique({ where: { id: input.familyId } });
  const plan = planOf(family?.plan);
  const estimate = input.files.reduce((sum, f) => sum + estimateStoredBytes(plan, f.mimeType, f.sizeBytes), 0);
  await assertQuota(input.familyId, estimate);

  const seen = new Set<string>();
  for (const f of input.files) {
    if (seen.has(f.clientFileId)) throw new UploadError("DUPLICATE_CLIENT_ID", "같은 파일이 두 번 들어 있습니다.");
    seen.add(f.clientFileId);
  }

  const session = await prisma.uploadSession.create({
    data: {
      userId: input.userId,
      familyId: input.familyId,
      childId: child.id,
      albumId: album.id,
      visibility: input.visibility,
      totalFiles: input.files.length,
      items: {
        create: input.files.map((f) => ({
          clientFileId: f.clientFileId,
          fileName: f.fileName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
        })),
      },
    },
  });
  const items = await prisma.uploadItem.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } });
  await recalcSession(session.id);
  return { session, items };
}

/** 연결 끊김/앱 재실행 후 복원: 사용자의 최근 세션과 항목 상태를 그대로 돌려준다. */
export async function getLatestUploadSession(userId: string) {
  const session = await prisma.uploadSession.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!session) return null;
  const items = await prisma.uploadItem.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } });
  const child = await prisma.child.findUnique({ where: { id: session.childId } });
  const album = await prisma.album.findUnique({ where: { id: session.albumId } });
  return {
    session: {
      id: session.id,
      childId: session.childId,
      childName: child?.name ?? null,
      albumId: session.albumId,
      albumName: album?.name ?? null,
      visibility: session.visibility,
      status: session.status,
      totalFiles: session.totalFiles,
      summary: session.summaryJson ? JSON.parse(session.summaryJson) : null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    },
    items: items.map(serializeItem),
  };
}

export function serializeItem(item: UploadItem) {
  return {
    id: item.id,
    clientFileId: item.clientFileId,
    fileName: item.fileName,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    status: item.status,
    statusLabel: UPLOAD_STATUS_LABEL[item.status] ?? item.status,
    attempts: item.attempts,
    mediaId: item.mediaId,
    duplicate: item.duplicate,
    error: item.error,
  };
}

export type UploadItemResult = {
  status: string;
  statusLabel: string;
  mediaId: string | null;
  duplicate: boolean;
  error: string | null;
  attempts: number;
};

/**
 * 파일 1건 업로드. 실패하면 항목에 실패 상태와 사유를 남겨 앱을 다시 열어도 복원된다.
 * 이미 저장된 파일(같은 앨범의 같은 해시)은 새 레코드를 만들지 않고 기존 항목을 재사용한다.
 */
export async function uploadItem(input: {
  userId: string;
  sessionId: string;
  itemId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  capturedAt?: Date | null;
  simulateFailure?: boolean;
}): Promise<UploadItemResult> {
  const session = await prisma.uploadSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.userId !== input.userId) {
    throw new UploadError("SESSION_NOT_FOUND", "업로드 세션을 찾을 수 없습니다.", 404);
  }
  const item = await prisma.uploadItem.findFirst({ where: { id: input.itemId, sessionId: session.id } });
  if (!item) throw new UploadError("ITEM_NOT_FOUND", "업로드 항목을 찾을 수 없습니다.", 404);

  if (item.status === UPLOAD_STATUS.DONE && item.mediaId) {
    return {
      status: item.status,
      statusLabel: UPLOAD_STATUS_LABEL[item.status],
      mediaId: item.mediaId,
      duplicate: item.duplicate,
      error: null,
      attempts: item.attempts,
    };
  }

  if (input.simulateFailure) {
    const updated = await prisma.uploadItem.update({
      where: { id: item.id },
      data: { status: UPLOAD_STATUS.FAILED, attempts: { increment: 1 }, error: "전송 중 연결이 끊겼습니다. (시뮬레이션)" },
    });
    await recalcSession(session.id);
    return {
      status: updated.status,
      statusLabel: UPLOAD_STATUS_LABEL[updated.status],
      mediaId: null,
      duplicate: false,
      error: updated.error,
      attempts: updated.attempts,
    };
  }

  await prisma.uploadItem.update({
    where: { id: item.id },
    data: { status: UPLOAD_STATUS.UPLOADING, attempts: { increment: 1 }, error: null },
  });

  try {
    if (input.buffer.byteLength === 0) throw new Error("빈 파일입니다.");
    if (input.buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error("파일이 너무 큽니다. (최대 60MB)");
    {
      const fam = await prisma.family.findUnique({ where: { id: session.familyId } });
      await assertQuota(session.familyId, estimateStoredBytes(planOf(fam?.plan), input.mimeType || item.mimeType, input.buffer.byteLength));
    }
    const capturedAt = input.capturedAt ?? new Date();
    const { media, duplicate } = await createMedia({
      familyId: session.familyId,
      childId: session.childId,
      albumId: session.albumId,
      ownerId: input.userId,
      fileName: input.fileName || item.fileName,
      mimeType: input.mimeType || item.mimeType,
      buffer: input.buffer,
      capturedAt,
      visibility: session.visibility,
    });
    const updated = await prisma.uploadItem.update({
      where: { id: item.id },
      data: { status: UPLOAD_STATUS.DONE, mediaId: media.id, duplicate, error: null },
    });
    await recalcSession(session.id);
    return {
      status: updated.status,
      statusLabel: UPLOAD_STATUS_LABEL[updated.status],
      mediaId: media.id,
      duplicate,
      error: null,
      attempts: updated.attempts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "업로드에 실패했습니다.";
    const updated = await prisma.uploadItem.update({
      where: { id: item.id },
      data: { status: UPLOAD_STATUS.FAILED, error: message },
    });
    await recalcSession(session.id);
    return {
      status: updated.status,
      statusLabel: UPLOAD_STATUS_LABEL[updated.status],
      mediaId: null,
      duplicate: false,
      error: message,
      attempts: updated.attempts,
    };
  }
}

/** 실패한 항목만 다시 올리기 — 대상 item id 목록을 돌려준다. */
export async function listRetryableItems(sessionId: string, userId: string) {
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) throw new UploadError("SESSION_NOT_FOUND", "업로드 세션을 찾을 수 없습니다.", 404);
  const items = await prisma.uploadItem.findMany({
    where: { sessionId, status: UPLOAD_STATUS.FAILED },
    orderBy: { createdAt: "asc" },
  });
  return items.map(serializeItem);
}

export type UploadSummary = {
  total: number;
  done: number;
  failed: number;
  pending: number;
  duplicates: number;
  text: string;
};

export async function recalcSession(sessionId: string): Promise<UploadSummary> {
  const items = await prisma.uploadItem.findMany({ where: { sessionId } });
  const done = items.filter((i) => i.status === UPLOAD_STATUS.DONE).length;
  const failed = items.filter((i) => i.status === UPLOAD_STATUS.FAILED).length;
  const pending = items.length - done - failed;
  const duplicates = items.filter((i) => i.status === UPLOAD_STATUS.DONE && i.duplicate).length;
  const summary: UploadSummary = {
    total: items.length,
    done,
    failed,
    pending,
    duplicates,
    text:
      failed > 0
        ? `${items.length}개 중 ${done}개 완료, ${failed}개 재시도`
        : pending > 0
          ? `${items.length}개 중 ${done}개 완료, ${pending}개 대기`
          : `${items.length}개 모두 완료${duplicates > 0 ? ` (중복 ${duplicates}개는 기존 항목으로 연결)` : ""}`,
  };
  await prisma.uploadSession.update({
    where: { id: sessionId },
    data: {
      summaryJson: JSON.stringify(summary),
      status: pending === 0 ? "COMPLETED" : "OPEN",
    },
  });
  return summary;
}

/**
 * 직접 업로드 준비: 같은 내용이 이미 있으면 중복으로 바로 완료, 아니면 용량을 확인·예약하고
 * 저장소에 올릴 서명 주소를 준다. 저장소가 S3 가 아니면 서버 경유(proxy)로 올리라고 답한다.
 */
export async function prepareDirectUpload(input: {
  userId: string;
  sessionId: string;
  itemId: string;
  contentHash: string;
  sizeBytes: number;
  mimeType: string;
  fileName: string;
  capturedAt: Date | null;
}) {
  const session = await prisma.uploadSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.userId !== input.userId) throw new UploadError("SESSION_NOT_FOUND", "업로드 세션을 찾을 수 없습니다.", 404);
  const item = await prisma.uploadItem.findFirst({ where: { id: input.itemId, sessionId: session.id } });
  if (!item) throw new UploadError("ITEM_NOT_FOUND", "업로드 항목을 찾을 수 없습니다.", 404);
  if (!useS3) return { mode: "proxy" as const };
  if (!/^[a-f0-9]{64}$/.test(input.contentHash)) throw new UploadError("BAD_HASH", "파일 확인값이 올바르지 않습니다.");
  if (input.sizeBytes <= 0) throw new UploadError("EMPTY_FILE", "빈 파일입니다.");
  if (input.sizeBytes > MAX_DIRECT_UPLOAD_BYTES) throw new UploadError("TOO_LARGE", "파일이 너무 큽니다. (최대 500MB)");

  const dedupeKey = `${session.albumId}:${input.contentHash}`;
  const existing = await prisma.mediaAsset.findUnique({ where: { dedupeKey } });
  if (existing && existing.status !== "UPLOADING" && existing.status !== "FAILED") {
    await prisma.uploadItem.update({
      where: { id: item.id },
      data: { status: UPLOAD_STATUS.DONE, mediaId: existing.id, duplicate: true, error: null, attempts: { increment: 1 } },
    });
    await recalcSession(session.id);
    return { mode: "duplicate" as const, mediaId: existing.id };
  }

  const mimeType = input.mimeType || item.mimeType || "application/octet-stream";
  const fileName = input.fileName || item.fileName;
  const kind = kindFromMime(mimeType, fileName);
  const family = await prisma.family.findUnique({ where: { id: session.familyId } });
  const plan = planOf(family?.plan);
  // 처리 전에는 원본 크기 그대로 사용량을 잡아 둔다 (처리 후 실제 크기로 맞춘다)
  await assertQuota(session.familyId, estimateStoredBytes(plan, mimeType, input.sizeBytes));

  let media = existing;
  if (media) {
    // 중단된 이전 시도 재사용
    await addUsage(session.familyId, -media.storedBytes);
    media = await prisma.mediaAsset.update({ where: { id: media.id }, data: { status: "UPLOADING", storedBytes: input.sizeBytes, sizeBytes: input.sizeBytes } });
  } else {
    const originalPath = `${newObjectBase(session.familyId)}${extensionFor(fileName, mimeType)}`;
    media = await prisma.mediaAsset.create({
      data: {
        familyId: session.familyId,
        childId: session.childId,
        albumId: session.albumId,
        ownerId: input.userId,
        kind,
        fileName,
        mimeType,
        sizeBytes: input.sizeBytes,
        originalPath,
        contentHash: input.contentHash,
        dedupeKey,
        capturedAt: input.capturedAt ?? new Date(),
        visibility: session.visibility,
        status: "UPLOADING",
        storedBytes: input.sizeBytes,
        previewQuality: "처리 중",
      },
    });
  }
  await addUsage(session.familyId, input.sizeBytes);
  await prisma.uploadItem.update({
    where: { id: item.id },
    data: { status: UPLOAD_STATUS.UPLOADING, mediaId: media.id, attempts: { increment: 1 }, error: null },
  });
  const url = await signedPutUrl(media.originalPath, mimeType, input.sizeBytes);
  return { mode: "direct" as const, mediaId: media.id, url, headers: { "Content-Type": mimeType } };
}

/** 직접 업로드 완료 확인: 저장소에 같은 크기의 파일이 있는지 보고 처리 작업을 건다. */
export async function completeDirectUpload(input: { userId: string; sessionId: string; itemId: string }): Promise<UploadItemResult> {
  const session = await prisma.uploadSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.userId !== input.userId) throw new UploadError("SESSION_NOT_FOUND", "업로드 세션을 찾을 수 없습니다.", 404);
  const item = await prisma.uploadItem.findFirst({ where: { id: input.itemId, sessionId: session.id } });
  if (!item?.mediaId) throw new UploadError("ITEM_NOT_FOUND", "업로드 항목을 찾을 수 없습니다.", 404);
  const media = await prisma.mediaAsset.findUnique({ where: { id: item.mediaId } });
  if (!media) throw new UploadError("MEDIA_NOT_FOUND", "업로드 기록을 찾을 수 없습니다.", 404);

  if (media.status === "UPLOADING") {
    const size = await storedSize(media.originalPath);
    if (size === null || size !== media.sizeBytes) {
      const updated = await prisma.uploadItem.update({
        where: { id: item.id },
        data: { status: UPLOAD_STATUS.FAILED, error: "저장소에 파일이 다 올라가지 않았습니다. 다시 올려 주세요." },
      });
      await recalcSession(session.id);
      return { status: updated.status, statusLabel: UPLOAD_STATUS_LABEL[updated.status], mediaId: null, duplicate: false, error: updated.error, attempts: updated.attempts };
    }
    await prisma.mediaAsset.update({ where: { id: media.id }, data: { status: "PROCESSING" } });
    await enqueue("PROCESS_MEDIA", { mediaId: media.id });
  }
  const updated = await prisma.uploadItem.update({
    where: { id: item.id },
    data: { status: UPLOAD_STATUS.DONE, error: null },
  });
  await recalcSession(session.id);
  return { status: updated.status, statusLabel: UPLOAD_STATUS_LABEL[updated.status], mediaId: media.id, duplicate: false, error: null, attempts: updated.attempts };
}
