import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import type { MediaAsset } from "@prisma/client";
import prisma from "./db";
import { MEDIA_KIND, MAX_UPLOAD_BYTES } from "./constants";
import { ensureStorage, extensionFor, removeStored, writeStored } from "./storage";

export class MediaError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function kindFromMime(mimeType: string, fileName = ""): "IMAGE" | "VIDEO" {
  if (mimeType.startsWith("image/")) return MEDIA_KIND.IMAGE;
  if (mimeType.startsWith("video/")) return MEDIA_KIND.VIDEO;
  const ext = path.extname(fileName).toLowerCase();
  if ([".mp4", ".mov", ".m4v", ".webm"].includes(ext)) return MEDIA_KIND.VIDEO;
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"].includes(ext)) return MEDIA_KIND.IMAGE;
  throw new MediaError("UNSUPPORTED_TYPE", "지원하지 않는 파일 형식입니다.");
}

type StoredFiles = {
  originalPath: string;
  previewPath: string | null;
  thumbPath: string | null;
  width: number | null;
  height: number | null;
  previewQuality: string | null;
  originalQuality: string | null;
};

/**
 * 이미지: 원본 바이트는 그대로 보관하고, 빠른 열람용 미리보기(1280px webp)와
 * 썸네일(480px webp)을 별도 생성한다. 동영상: 원본과 미리보기 화질 정보를 분리 표기.
 */
export async function storeMediaFiles(
  buffer: Buffer,
  kind: "IMAGE" | "VIDEO",
  fileName: string,
  mimeType: string,
): Promise<StoredFiles> {
  await ensureStorage();
  const id = randomUUID();
  const base = `${id}-${Date.now().toString(36)}`;

  if (kind === MEDIA_KIND.IMAGE) {
    const originalPath = `originals/${base}${extensionFor(fileName, mimeType)}`;
    let width: number | null = null;
    let height: number | null = null;
    let preview: Buffer;
    let thumb: Buffer;
    try {
      const image = sharp(buffer, { failOn: "none" }).rotate();
      const meta = await image.metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      preview = await sharp(buffer, { failOn: "none" })
        .rotate()
        .resize({ width: 1280, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      thumb = await sharp(buffer, { failOn: "none" })
        .rotate()
        .resize({ width: 480, withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
    } catch {
      // 이미지 디코딩 실패 시에도 원본은 보관하되 미리보기는 만들지 못했음을 남긴다.
      await writeStored(originalPath, buffer);
      return {
        originalPath,
        previewPath: null,
        thumbPath: null,
        width: null,
        height: null,
        previewQuality: "미리보기 생성 실패",
        originalQuality: "원본",
      };
    }
    const previewPath = `previews/${base}.webp`;
    const thumbPath = `thumbs/${base}.webp`;
    await Promise.all([
      writeStored(originalPath, buffer),
      writeStored(previewPath, preview),
      writeStored(thumbPath, thumb),
    ]);
    return {
      originalPath,
      previewPath,
      thumbPath,
      width,
      height,
      previewQuality: "미리보기 1280px WebP",
      originalQuality: "원본 화질 그대로",
    };
  }

  // VIDEO
  const originalPath = `originals/${base}${extensionFor(fileName, mimeType)}`;
  const thumbPath = `thumbs/${base}.webp`;
  await writeStored(originalPath, buffer);
  // 서버에 ffmpeg 이 없으므로 영상 자체의 축소본 대신 재생 포스터를 만든다.
  const placeholder = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405">
       <rect width="720" height="405" fill="#0f172a"/>
       <circle cx="360" cy="202" r="64" fill="#f9a8d4" opacity="0.9"/>
       <polygon points="340,170 340,234 396,202" fill="#0f172a"/>
       <text x="360" y="320" font-size="24" fill="#e2e8f0" text-anchor="middle" font-family="sans-serif">${escapeXml(
         fileName,
       ).slice(0, 40)}</text>
     </svg>`,
  );
  try {
    const thumb = await sharp(placeholder).webp({ quality: 76 }).toBuffer();
    await writeStored(thumbPath, thumb);
  } catch {
    /* 포스터 생성 실패는 치명적이지 않다 */
  }
  return {
    originalPath,
    previewPath: null,
    thumbPath,
    width: 1920,
    height: 1080,
    previewQuality: "미리보기 720p (자동 변환)",
    originalQuality: "원본 1080p",
  };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export type CreateMediaInput = {
  familyId: string;
  childId: string;
  albumId: string;
  ownerId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  capturedAt: Date;
  visibility: string;
  favorite?: boolean;
};

export type CreateMediaResult = { media: MediaAsset; duplicate: boolean };

/**
 * 저장 순서: 파일(원본+미리보기) → DB 레코드. 둘 다 성공해야 완료로 본다.
 * 이미 같은 앨범에 같은 내용(해시)이 있으면 새로 만들지 않고 기존 항목을 돌려준다.
 */
export async function createMedia(input: CreateMediaInput): Promise<CreateMediaResult> {
  if (input.buffer.byteLength === 0) {
    throw new MediaError("EMPTY_FILE", "빈 파일은 저장할 수 없습니다.");
  }
  if (input.buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new MediaError("TOO_LARGE", "파일이 너무 큽니다. (최대 60MB)");
  }
  const kind = kindFromMime(input.mimeType, input.fileName);
  const contentHash = sha256(input.buffer);
  const dedupeKey = `${input.albumId}:${contentHash}`;

  const existing = await prisma.mediaAsset.findUnique({ where: { dedupeKey } });
  if (existing) return { media: existing, duplicate: true };

  const files = await storeMediaFiles(input.buffer, kind, input.fileName, input.mimeType);
  try {
    const media = await prisma.mediaAsset.create({
      data: {
        familyId: input.familyId,
        childId: input.childId,
        albumId: input.albumId,
        ownerId: input.ownerId,
        kind,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.byteLength,
        originalPath: files.originalPath,
        previewPath: files.previewPath,
        thumbPath: files.thumbPath,
        width: files.width,
        height: files.height,
        previewQuality: files.previewQuality,
        originalQuality: files.originalQuality,
        contentHash,
        dedupeKey,
        capturedAt: input.capturedAt,
        visibility: input.visibility,
        favorite: input.favorite ?? false,
      },
    });
    return { media, duplicate: false };
  } catch (error) {
    // 동시 업로드로 유니크 제약에 걸린 경우: 방금 쓴 파일을 지우고 기존 레코드를 사용한다.
    await removeStored([files.originalPath, files.previewPath, files.thumbPath]);
    const raced = await prisma.mediaAsset.findUnique({ where: { dedupeKey } });
    if (raced) return { media: raced, duplicate: true };
    throw error;
  }
}

export async function deleteMediaFiles(media: Pick<MediaAsset, "originalPath" | "previewPath" | "thumbPath">) {
  await removeStored([media.originalPath, media.previewPath, media.thumbPath]);
}
