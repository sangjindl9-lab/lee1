import crypto from "node:crypto";

const APP_SECRET = process.env.APP_SECRET || "dev-secret-only";
const VAULT_KEY_SOURCE = process.env.VAULT_MASTER_KEY || "dev-vault-key-only";

/** AES-256-GCM에 쓸 32바이트 키를 설정값에서 유도한다. */
function vaultKey(): Buffer {
  return crypto.createHash("sha256").update(VAULT_KEY_SOURCE).digest();
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hmac(data: string, secret = APP_SECRET): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function signPayload(payload: string, secret = APP_SECRET): string {
  return `${Buffer.from(payload).toString("base64url")}.${hmac(payload, secret)}`;
}

export function verifySignedPayload(token: string, secret = APP_SECRET): string | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const encoded = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!timingSafeEqual(sig, hmac(payload, secret))) return null;
  return payload;
}

/** 파일 내용을 저장 전에 암호화한다 (AES-256-GCM, IV + authTag 선행 저장). */
export function encryptBuffer(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from("DVLT1"), iv, cipher.getAuthTag(), enc]);
}

export function decryptBuffer(payload: Buffer): Buffer {
  const magic = payload.subarray(0, 5).toString();
  if (magic !== "DVLT1") throw new Error("지원하지 않는 파일 형식입니다.");
  const iv = payload.subarray(5, 17);
  const tag = payload.subarray(17, 33);
  const enc = payload.subarray(33);
  const decipher = crypto.createDecipheriv("aes-256-gcm", vaultKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

/** 계좌번호 등 민감 문자열 암호화. */
export function encryptSecret(plain: string): string {
  return encryptBuffer(Buffer.from(plain, "utf8")).toString("base64");
}

export function decryptSecret(cipherText: string): string {
  return decryptBuffer(Buffer.from(cipherText, "base64")).toString("utf8");
}

export function maskAccount(accountNo: string): string {
  const digits = accountNo.replace(/[^0-9]/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, 3)}-${"*".repeat(Math.max(2, digits.length - 7))}-${digits.slice(-4)}`;
}

// ── 비밀번호 (scrypt)
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return timingSafeEqual(derived.toString("hex"), expected.toString("hex"));
}
