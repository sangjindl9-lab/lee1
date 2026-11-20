import type { UploadItem, UploadSession } from "@prisma/client";
import prisma from "./db";
import { MAX_UPLOAD_BYTES, UPLOAD_STATUS, UPLOAD_STATUS_LABEL } from "./constants";
import { createMedia } from "./media";

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
