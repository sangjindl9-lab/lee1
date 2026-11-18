import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { encryptBuffer, decryptBuffer, sha256Hex } from "@/lib/crypto";
import { DomainError } from "@/lib/errors";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

const STORAGE_KEY_RE = /^[a-z0-9]{4}\/[a-z0-9]{2}\/[a-f0-9]{32}(\.[a-z0-9]{1,8})?$/i;

export function vaultDir(): string {
  const dir = process.env.VAULT_DIR || "./.vault";
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

/** 사용자가 올린 파일명에서 표시용 이름만 안전하게 정리한다. 저장 경로에는 쓰지 않는다. */
export function safeDisplayName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) throw new DomainError("VALIDATION", "파일명이 올바르지 않습니다.");
  if (cleaned.length > 180) throw new DomainError("VALIDATION", "파일명이 너무 깁니다.");
  return cleaned;
}

function extOf(name: string): string {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return ext.length > 1 && ext.length <= 9 ? ext : "";
}

/** 비공개 볼트에 파일을 암호화 저장하고, 저장 키·해시·크기를 돌려준다. */
export async function putFile(
  buffer: Buffer,
  originalName: string,
): Promise<{ storageKey: string; sha256: string; sizeBytes: number }> {
  if (!buffer || buffer.length === 0) {
    throw new DomainError("VALIDATION", "빈 파일은 납품물로 등록할 수 없습니다.");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION", "업로드 가능한 최대 용량(50MB)을 초과했습니다.");
  }
  const display = safeDisplayName(originalName);
  const now = new Date();
  const key = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    `${crypto.randomBytes(16).toString("hex")}${extOf(display)}`,
  ].join("/");

  const target = resolveStoragePath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, encryptBuffer(buffer), { mode: 0o600 });

  return { storageKey: key, sha256: sha256Hex(buffer), sizeBytes: buffer.length };
}

export async function getFile(storageKey: string): Promise<Buffer> {
  const target = resolveStoragePath(storageKey);
  let raw: Buffer;
  try {
    raw = await fs.readFile(target);
  } catch {
    throw new DomainError("NOT_FOUND", "보관된 납품물을 찾을 수 없습니다.", 404);
  }
  return decryptBuffer(raw);
}

export async function deleteFile(storageKey: string): Promise<void> {
  try {
    await fs.unlink(resolveStoragePath(storageKey));
  } catch {
    /* 이미 없으면 무시 */
  }
}

/** 저장 키는 서버가 만든 값만 허용하고, 경로 탈출을 이중으로 막는다. */
export function resolveStoragePath(storageKey: string): string {
  if (!STORAGE_KEY_RE.test(storageKey)) {
    throw new DomainError("VALIDATION", "잘못된 저장 키입니다.");
  }
  const base = vaultDir();
  const resolved = path.resolve(base, storageKey);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) {
    throw new DomainError("FORBIDDEN", "허용되지 않은 저장 경로입니다.", 403);
  }
  return resolved;
}

export const storageKeyIsValid = (key: string) => STORAGE_KEY_RE.test(key);
