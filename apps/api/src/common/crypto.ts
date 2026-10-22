import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config';

const KEY = Buffer.from(config.APP_ENCRYPTION_KEY, 'hex');
const VERSION = 'v1';

/** AES-256-GCM 필드 암호화. 결과: v1.<iv>.<tag>.<ciphertext> (base64url) */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptField(token: string): string {
  const [ver, iv, tag, data] = token.split('.');
  if (ver !== VERSION || !iv || !tag || !data) throw new Error('암호문 형식 오류');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 계좌번호 마스킹: 앞 3자리, 뒤 3자리만 표시 */
export function maskAccount(acc: string): string {
  const digits = acc.replace(/[^0-9]/g, '');
  if (digits.length <= 6) return '*'.repeat(digits.length);
  return `${digits.slice(0, 3)}-${'*'.repeat(digits.length - 6)}-${digits.slice(-3)}`;
}
