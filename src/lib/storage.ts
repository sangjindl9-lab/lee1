/**
 * 파일 저장소.
 * - 운영: S3 호환 오브젝트 스토리지(Railway 버킷 / Cloudflare R2). S3_* 환경변수가 있으면 사용한다.
 * - 개발·테스트: 로컬 디스크(STORAGE_ROOT).
 * 사진·동영상 바이트는 가능한 한 서버를 거치지 않는다: 보기·내려받기는 서명된 주소로 저장소에서 직접,
 * 업로드도 서명된 PUT 주소로 직접 올린다(실패 시 서버 경유 업로드로 대체).
 */
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? "./storage");

const S3_BUCKET = process.env.S3_BUCKET ?? "";
export const useS3 = Boolean(process.env.S3_ENDPOINT && S3_BUCKET && process.env.S3_ACCESS_KEY_ID);

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "auto",
      forcePathStyle: process.env.S3_URL_STYLE !== "virtual",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return client;
}

export const STORAGE_DIRS = {
  originals: path.join(STORAGE_ROOT, "originals"),
  previews: path.join(STORAGE_ROOT, "previews"),
  thumbs: path.join(STORAGE_ROOT, "thumbs"),
};

export async function ensureStorage(): Promise<void> {
  if (useS3) return;
  await Promise.all(Object.values(STORAGE_DIRS).map((dir) => fs.mkdir(dir, { recursive: true })));
}

/** 로컬 모드 전용 절대 경로 */
export function resolveStored(relPath: string): string {
  return path.join(STORAGE_ROOT, relPath);
}

export async function writeStored(relPath: string, data: Buffer, contentType?: string): Promise<void> {
  if (useS3) {
    await s3().send(
      new PutObjectCommand({ Bucket: S3_BUCKET, Key: relPath, Body: data, ContentType: contentType ?? guessType(relPath) }),
    );
    return;
  }
  const abs = resolveStored(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

export async function readStored(relPath: string): Promise<Buffer | null> {
  if (useS3) {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: relPath }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }
  return fs.readFile(resolveStored(relPath)).catch(() => null);
}

/** ZIP 등 큰 파일을 메모리에 다 올리지 않고 흘려보낼 때 */
export async function streamStored(relPath: string): Promise<Readable | null> {
  if (useS3) {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: relPath }));
      return res.Body as Readable;
    } catch {
      return null;
    }
  }
  if (!(await storedExists(relPath))) return null;
  return createReadStream(resolveStored(relPath));
}

export async function storedSize(relPath: string): Promise<number | null> {
  if (useS3) {
    try {
      const res = await s3().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: relPath }));
      return res.ContentLength ?? null;
    } catch {
      return null;
    }
  }
  try {
    const st = await fs.stat(resolveStored(relPath));
    return st.size;
  } catch {
    return null;
  }
}

export async function removeStored(relPaths: Array<string | null | undefined>): Promise<void> {
  const keys = relPaths.filter((p): p is string => Boolean(p));
  if (!keys.length) return;
  if (useS3) {
    for (let i = 0; i < keys.length; i += 900) {
      await s3()
        .send(
          new DeleteObjectsCommand({
            Bucket: S3_BUCKET,
            Delete: { Objects: keys.slice(i, i + 900).map((Key) => ({ Key })), Quiet: true },
          }),
        )
        .catch((e) => console.error("[storage] delete failed", e));
    }
    return;
  }
  await Promise.all(keys.map((p) => fs.rm(resolveStored(p), { force: true }).catch(() => undefined)));
}

export async function storedExists(relPath: string | null | undefined): Promise<boolean> {
  if (!relPath) return false;
  return (await storedSize(relPath)) !== null;
}

/**
 * 보기·내려받기용 서명 주소. 같은 1시간 안에서는 같은 주소가 나오도록 서명 시각을 정시로 맞춰
 * 브라우저·앱 캐시가 재사용되게 한다. (로컬 모드는 null → 서버가 직접 보낸다)
 */
export async function signedGetUrl(
  relPath: string,
  opts: { downloadName?: string; contentType?: string } = {},
): Promise<string | null> {
  if (!useS3) return null;
  const hour = 3600 * 1000;
  const signingDate = new Date(Math.floor(Date.now() / hour) * hour);
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: relPath,
      ResponseContentType: opts.contentType,
      ResponseCacheControl: "private, max-age=3000",
      ResponseContentDisposition: opts.downloadName
        ? `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`
        : undefined,
    }),
    { expiresIn: 2 * 3600, signingDate },
  );
}

/** 직접 업로드용 서명 PUT 주소 (10분). 크기와 형식을 서명에 넣어 다른 파일을 올리지 못하게 한다. */
export async function signedPutUrl(relPath: string, contentType: string, contentLength: number): Promise<string | null> {
  if (!useS3) return null;
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: relPath, ContentType: contentType, ContentLength: contentLength }),
    { expiresIn: 600, signableHeaders: new Set(["content-type", "content-length"]) },
  );
}

let corsDone = false;
/** 앱(WebView)·웹에서 저장소로 직접 PUT/GET 할 수 있게 버킷 CORS 를 한 번 설정한다. 실패해도 서버 경유로 동작한다. */
export async function ensureBucketCors(origins: string[]): Promise<boolean> {
  if (!useS3 || corsDone) return corsDone;
  try {
    await s3().send(
      new PutBucketCorsCommand({
        Bucket: S3_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins,
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    corsDone = true;
  } catch (e) {
    console.warn("[storage] bucket CORS 설정 실패 — 직접 업로드 대신 서버 경유로 동작", e);
  }
  return corsDone;
}

export function extensionFor(fileName: string, mimeType: string): string {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName && fromName.length <= 6) return fromName;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "video/mp4") return ".mp4";
  if (mimeType === "video/quicktime") return ".mov";
  return "";
}

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
};

export function guessType(relPath: string): string {
  return TYPES[path.extname(relPath).toLowerCase()] ?? "application/octet-stream";
}
