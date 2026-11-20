import fs from "node:fs/promises";
import path from "node:path";

export const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? "./storage");

export const STORAGE_DIRS = {
  originals: path.join(STORAGE_ROOT, "originals"),
  previews: path.join(STORAGE_ROOT, "previews"),
  thumbs: path.join(STORAGE_ROOT, "thumbs"),
};

export async function ensureStorage(): Promise<void> {
  await Promise.all(Object.values(STORAGE_DIRS).map((dir) => fs.mkdir(dir, { recursive: true })));
}

export function resolveStored(relPath: string): string {
  return path.join(STORAGE_ROOT, relPath);
}

export async function writeStored(relPath: string, data: Buffer): Promise<void> {
  const abs = resolveStored(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

export async function removeStored(relPaths: Array<string | null | undefined>): Promise<void> {
  await Promise.all(
    relPaths
      .filter((p): p is string => Boolean(p))
      .map((p) => fs.rm(resolveStored(p), { force: true }).catch(() => undefined)),
  );
}

export async function storedExists(relPath: string | null | undefined): Promise<boolean> {
  if (!relPath) return false;
  try {
    await fs.access(resolveStored(relPath));
    return true;
  } catch {
    return false;
  }
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
