import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { MediaAsset } from "@prisma/client";
import prisma from "./db";
import { MEDIA_KIND, MAX_UPLOAD_BYTES } from "./constants";
import { extensionFor, readStored, removeStored, storedSize, writeStored } from "./storage";
import { addUsage, type PlanDef } from "./plans";
import { getEffectivePlan } from "./entitlement";

const run = promisify(execFile);

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

export function newObjectBase(familyId: string): string {
  return `f/${familyId}/${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

type Processed = {
  originalPath: string;
  previewPath: string | null;
  thumbPath: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  previewQuality: string | null;
  originalQuality: string | null;
  storedBytes: number;
  compressed: boolean;
  mimeType: string;
};

/**
 * 이미지 처리: 미리보기(1280px webp)·썸네일(480px webp).
 * 무료 요금제는 원본 대신 고화질 압축본(긴 변 2048px JPEG)으로 바꿔 저장한다.
 */
async function processImage(buffer: Buffer, base: string, originalPath: string, mimeType: string, plan: PlanDef): Promise<Processed> {
  let width: number | null = null;
  let height: number | null = null;
  let originalBytes = buffer.byteLength;
  let finalOriginal = originalPath;
  let finalMime = mimeType;
  let compressed = false;
  try {
    const meta = await sharp(buffer, { failOn: "none" }).rotate().metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
    const [preview, thumb] = await Promise.all([
      sharp(buffer, { failOn: "none" }).rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
      sharp(buffer, { failOn: "none" }).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(),
    ]);
    if (!plan.keepOriginals) {
      const small = await sharp(buffer, { failOn: "none" })
        .rotate()
        .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      if (small.byteLength < buffer.byteLength) {
        finalOriginal = `${base}-hq.jpg`;
        finalMime = "image/jpeg";
        await writeStored(finalOriginal, small, "image/jpeg");
        if (finalOriginal !== originalPath) await removeStored([originalPath]);
        originalBytes = small.byteLength;
        compressed = true;
      }
    }
    const previewPath = `${base}-p.webp`;
    const thumbPath = `${base}-t.webp`;
    await Promise.all([writeStored(previewPath, preview, "image/webp"), writeStored(thumbPath, thumb, "image/webp")]);
    return {
      originalPath: finalOriginal,
      previewPath,
      thumbPath,
      width,
      height,
      durationSec: null,
      previewQuality: "미리보기 1280px",
      originalQuality: compressed ? "고화질 압축본 (무료 요금제)" : "원본 화질 그대로",
      storedBytes: originalBytes + preview.byteLength + thumb.byteLength,
      compressed,
      mimeType: finalMime,
    };
  } catch {
    return {
      originalPath,
      previewPath: null,
      thumbPath: null,
      width: null,
      height: null,
      durationSec: null,
      previewQuality: "미리보기 생성 실패",
      originalQuality: "원본",
      storedBytes: originalBytes,
      compressed: false,
      mimeType,
    };
  }
}

let ffmpegChecked: boolean | null = null;
async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked;
  try {
    await run("ffmpeg", ["-version"]);
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

/**
 * 동영상 처리 (ffmpeg): 길이 확인, 포스터(썸네일), 720p 미리보기.
 * 무료 요금제는 원본 대신 720p 본만 보관한다. 길이 제한을 넘으면 실패로 처리한다.
 */
async function processVideo(buffer: Buffer, base: string, originalPath: string, mimeType: string, plan: PlanDef, fileName: string): Promise<Processed> {
  if (!(await hasFfmpeg())) return placeholderVideo(buffer, base, originalPath, mimeType, fileName);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fa-v-"));
  try {
    const input = path.join(dir, `in${path.extname(originalPath) || ".mp4"}`);
    await fs.writeFile(input, buffer);
    const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", input]);
    const info = JSON.parse(probe.stdout) as { format?: { duration?: string }; streams?: Array<{ width?: number; height?: number }> };
    const durationSec = Number(info.format?.duration ?? 0) || null;
    const vstream = info.streams?.find((s) => s.width && s.height);
    if (plan.maxVideoSec && durationSec && durationSec > plan.maxVideoSec + 1) {
      throw new MediaError(
        "VIDEO_TOO_LONG",
        `${plan.name} 요금제는 동영상을 ${Math.round(plan.maxVideoSec / 60)}분까지 올릴 수 있어요. 더 긴 영상은 상위 요금제에서 올릴 수 있습니다.`,
      );
    }
    const posterFile = path.join(dir, "poster.jpg");
    await run("ffmpeg", ["-y", "-ss", "1", "-i", input, "-frames:v", "1", "-vf", "scale=480:-2", posterFile]).catch(() =>
      run("ffmpeg", ["-y", "-i", input, "-frames:v", "1", "-vf", "scale=480:-2", posterFile]),
    );
    const poster = await fs.readFile(posterFile);
    const thumb = await sharp(poster).webp({ quality: 74 }).toBuffer();
    const thumbPath = `${base}-t.webp`;

    const previewFile = path.join(dir, "p720.mp4");
    await run(
      "ffmpeg",
      ["-y", "-i", input, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", previewFile],
      { maxBuffer: 1024 * 1024 * 16 },
    );
    const preview = await fs.readFile(previewFile);
    const previewPath = `${base}-p.mp4`;
    await Promise.all([writeStored(thumbPath, thumb, "image/webp"), writeStored(previewPath, preview, "video/mp4")]);

    if (!plan.keepOriginals) {
      // 무료: 720p 본을 원본 자리로 쓰고, 큰 원본은 지운다.
      await removeStored([originalPath]);
      return {
        originalPath: previewPath,
        previewPath,
        thumbPath,
        width: vstream?.width ?? null,
        height: vstream?.height ?? null,
        durationSec,
        previewQuality: "720p",
        originalQuality: "720p (무료 요금제)",
        storedBytes: preview.byteLength + thumb.byteLength,
        compressed: true,
        mimeType: "video/mp4",
      };
    }
    return {
      originalPath,
      previewPath,
      thumbPath,
      width: vstream?.width ?? null,
      height: vstream?.height ?? null,
      durationSec,
      previewQuality: "720p",
      originalQuality: vstream?.height ? `원본 ${vstream.height}p` : "원본",
      storedBytes: buffer.byteLength + preview.byteLength + thumb.byteLength,
      compressed: false,
      mimeType,
    };
  } catch (e) {
    if (e instanceof MediaError) throw e;
    // 읽을 수 없는 영상 형식: 원본은 그대로 두고 자리표시 썸네일만 만든다
    console.warn("[media] 동영상 변환 실패, 원본만 보관", fileName, e instanceof Error ? e.message : e);
    return placeholderVideo(buffer, base, originalPath, mimeType, fileName);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function placeholderVideo(buffer: Buffer, base: string, originalPath: string, mimeType: string, fileName: string): Promise<Processed> {
  const thumb = await sharp(Buffer.from(posterSvg(fileName))).webp({ quality: 76 }).toBuffer();
  const thumbPath = `${base}-t.webp`;
  await writeStored(thumbPath, thumb, "image/webp");
  return {
    originalPath,
    previewPath: null,
    thumbPath,
    width: null,
    height: null,
    durationSec: null,
    previewQuality: "미리보기 없음",
    originalQuality: "원본",
    storedBytes: buffer.byteLength + thumb.byteLength,
    compressed: false,
    mimeType,
  };
}

function posterSvg(fileName: string) {
  const name = fileName.replace(/[<>&"']/g, "").slice(0, 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405"><rect width="720" height="405" fill="#0f172a"/><circle cx="360" cy="202" r="64" fill="#f9a8d4" opacity="0.9"/><polygon points="340,170 340,234 396,202" fill="#0f172a"/><text x="360" y="320" font-size="24" fill="#e2e8f0" text-anchor="middle" font-family="sans-serif">${name}</text></svg>`;
}

async function processBuffer(buffer: Buffer, media: Pick<MediaAsset, "kind" | "originalPath" | "mimeType" | "fileName">, plan: PlanDef) {
  const base = media.originalPath.replace(/\.[^./]+$/, "");
  return media.kind === MEDIA_KIND.IMAGE
    ? processImage(buffer, base, media.originalPath, media.mimeType, plan)
    : processVideo(buffer, base, media.originalPath, media.mimeType, plan, media.fileName);
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
 * 서버 경유 업로드(대체 경로·시드). 저장 순서: 원본 → 처리(미리보기·압축) → DB 기록 → 사용량 반영.
 * 이미 같은 앨범에 같은 내용(해시)이 있으면 새로 만들지 않고 기존 항목을 돌려준다.
 */
export async function createMedia(input: CreateMediaInput): Promise<CreateMediaResult> {
  if (input.buffer.byteLength === 0) throw new MediaError("EMPTY_FILE", "빈 파일은 저장할 수 없습니다.");
  if (input.buffer.byteLength > MAX_UPLOAD_BYTES) throw new MediaError("TOO_LARGE", "파일이 너무 큽니다.");
  const kind = kindFromMime(input.mimeType, input.fileName);
  const contentHash = sha256(input.buffer);
  const dedupeKey = `${input.albumId}:${contentHash}`;

  const existing = await prisma.mediaAsset.findUnique({ where: { dedupeKey } });
  if (existing && (existing.status === "UPLOADING" || existing.status === "FAILED")) {
    // 직접 업로드가 중간에 실패해 서버 경유로 다시 올리는 경우: 잡아 둔 기록을 정리하고 새로 만든다.
    await purgeMedia(existing);
  } else if (existing) {
    return { media: existing, duplicate: true };
  }

  const { plan } = await getEffectivePlan(input.familyId);
  const base = newObjectBase(input.familyId);
  const originalPath = `${base}${extensionFor(input.fileName, input.mimeType)}`;
  await writeStored(originalPath, input.buffer, input.mimeType);
  const files = await processBuffer(input.buffer, { kind, originalPath, mimeType: input.mimeType, fileName: input.fileName }, plan).catch(
    async (e) => {
      await removeStored([originalPath]);
      throw e;
    },
  );
  try {
    const media = await prisma.mediaAsset.create({
      data: {
        familyId: input.familyId,
        childId: input.childId,
        albumId: input.albumId,
        ownerId: input.ownerId,
        kind,
        fileName: input.fileName,
        mimeType: files.mimeType,
        sizeBytes: input.buffer.byteLength,
        originalPath: files.originalPath,
        previewPath: files.previewPath,
        thumbPath: files.thumbPath,
        width: files.width,
        height: files.height,
        durationSec: files.durationSec,
        previewQuality: files.previewQuality,
        originalQuality: files.originalQuality,
        storedBytes: files.storedBytes,
        compressed: files.compressed,
        status: "READY",
        contentHash,
        dedupeKey,
        capturedAt: input.capturedAt,
        visibility: input.visibility,
        favorite: input.favorite ?? false,
      },
    });
    await addUsage(input.familyId, files.storedBytes);
    return { media, duplicate: false };
  } catch (error) {
    await removeStored([files.originalPath, files.previewPath, files.thumbPath]);
    const raced = await prisma.mediaAsset.findUnique({ where: { dedupeKey } });
    if (raced) return { media: raced, duplicate: true };
    throw error;
  }
}

/**
 * 직접 업로드 후 작업 서버가 호출: 저장소의 원본을 내려받아 미리보기·압축·변환을 만들고 사용량을 확정한다.
 * 업로드 허가 때 원본 크기만큼 사용량을 먼저 잡아 두었으므로, 여기서는 차이만 반영한다.
 */
export async function processUploadedMedia(mediaId: string, opts: { keepOriginals?: boolean } = {}): Promise<void> {
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  // 이미 처리됐거나 실패·삭제된 항목은 다시 처리하지 않는다 (완성된 원본을 재압축하지 않음)
  if (!media || media.status !== "PROCESSING") return;
  const buffer = await readStored(media.originalPath);
  if (!buffer) throw new MediaError("FILE_MISSING", "올린 파일을 저장소에서 찾지 못했습니다.");
  // 원본 보관 여부는 올린 시점의 요금제(작업에 실린 값)를 따른다. 예전 작업처럼 값이 없을 때만 지금 요금제를 쓴다.
  const current = (await getEffectivePlan(media.familyId)).plan;
  const plan = opts.keepOriginals === undefined ? current : { ...current, keepOriginals: opts.keepOriginals };
  try {
    const files = await processBuffer(buffer, media, plan);
    const done = await prisma.mediaAsset.updateMany({
      where: { id: media.id, status: "PROCESSING" },
      data: {
        status: "READY",
        mimeType: files.mimeType,
        originalPath: files.originalPath,
        previewPath: files.previewPath,
        thumbPath: files.thumbPath,
        width: files.width,
        height: files.height,
        durationSec: files.durationSec,
        previewQuality: files.previewQuality,
        originalQuality: files.originalQuality,
        storedBytes: files.storedBytes,
        compressed: files.compressed,
      },
    });
    // 실제로 저장된 원본·미리보기·썸네일 크기로 사용량을 맞춘다 (예약분과의 차이만)
    if (done.count) await addUsage(media.familyId, files.storedBytes - media.storedBytes);
  } catch (e) {
    if (e instanceof MediaError && e.code === "VIDEO_TOO_LONG") {
      // 길이 초과: 올린 파일을 지우고 잡아 둔 사용량을 돌려준다.
      await removeStored([media.originalPath]);
      await prisma.mediaAsset.update({ where: { id: media.id }, data: { status: "FAILED", storedBytes: 0, previewQuality: e.message } });
      await addUsage(media.familyId, -media.storedBytes);
      await prisma.uploadItem.updateMany({ where: { mediaId: media.id }, data: { status: "FAILED", error: e.message } });
      return;
    }
    throw e;
  }
}

/** 저장소에서 파일을 지우고 사용량에서 뺀다 (휴지통 영구 삭제·계정 삭제) */
export async function purgeMedia(media: Pick<MediaAsset, "id" | "familyId" | "originalPath" | "previewPath" | "thumbPath" | "storedBytes">) {
  await removeStored([media.originalPath, media.previewPath, media.thumbPath]);
  await prisma.mediaAsset.delete({ where: { id: media.id } }).catch(() => undefined);
  await addUsage(media.familyId, -media.storedBytes);
}

export async function deleteMediaFiles(media: Pick<MediaAsset, "originalPath" | "previewPath" | "thumbPath">) {
  await removeStored([media.originalPath, media.previewPath, media.thumbPath]);
}

export { storedSize };
