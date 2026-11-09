import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

/** 키를 사전순 정렬, 공백 없이 직렬화 (펌웨어와 동일 규칙) */
export function canonicalJson(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

export function commandCanonical(c: { cmd_id: string; ts: number; exp: number; type: string; params: any }): string {
  return `${c.cmd_id}\n${c.ts}\n${c.exp}\n${c.type}\n${canonicalJson(c.params ?? {})}`;
}

export function hmacHex(secretHex: string, msg: string): string {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(msg, 'utf8').digest('hex');
}

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function loadOrCreateKey(file: string, envHex: string): Buffer {
  if (envHex) {
    const b = Buffer.from(envHex, 'hex');
    if (b.length !== 32) throw new Error('키는 32바이트 hex여야 합니다');
    return b;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

@Injectable()
export class CryptoService {
  private readonly master = loadOrCreateKey(path.join(config.dataDir, 'master.key'), config.masterKeyHex);
  readonly jwtKey = config.jwtSecret
    ? Buffer.from(config.jwtSecret, 'utf8')
    : loadOrCreateKey(path.join(config.dataDir, 'jwt.key'), '');

  /** AES-256-GCM. 결과: v1:iv:tag:ciphertext (base64) */
  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.master, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(enc: string): string {
    const [v, iv, tag, ct] = enc.split(':');
    if (v !== 'v1') throw new Error('지원하지 않는 암호문 형식');
    const d = crypto.createDecipheriv('aes-256-gcm', this.master, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  }

  randomHex(bytes: number) { return crypto.randomBytes(bytes).toString('hex'); }
}
