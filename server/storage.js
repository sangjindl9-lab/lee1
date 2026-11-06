// 객체 저장소 (로컬 디스크/Railway 볼륨). 키는 항상 companies/<회사ID>/... 로 시작하며
// 모든 읽기·쓰기에서 회사 ID 접두사를 검사해 다른 회사 경로 접근을 차단한다.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const ROOT = config.storageDir;

export function keyFor(companyId, ...parts) {
  return ['companies', companyId, ...parts].join('/');
}

function resolve(companyId, key) {
  const prefix = `companies/${companyId}/`;
  if (!companyId || !key.startsWith(prefix) || key.includes('..')) {
    const e = new Error('저장소 접근 거부'); e.status = 403; throw e;
  }
  return path.join(ROOT, key);
}

export async function put(companyId, key, data) {
  const p = resolve(companyId, key);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, data);
  return key;
}

export async function moveIn(companyId, key, srcPath) {
  const p = resolve(companyId, key);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.rename(srcPath, p).catch(async () => { await fsp.copyFile(srcPath, p); await fsp.unlink(srcPath); });
  return key;
}

export const read = (companyId, key) => fsp.readFile(resolve(companyId, key));
export const stream = (companyId, key, opts) => fs.createReadStream(resolve(companyId, key), opts);
export const stat = (companyId, key) => fsp.stat(resolve(companyId, key));
export const pathOf = (companyId, key) => resolve(companyId, key);

export async function sha256File(p) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(p)) h.update(chunk);
  return h.digest('hex');
}

/** 객체 삭제 (없으면 무시). 회사 접두사 검사는 동일하게 적용 */
export async function remove(companyId, key) {
  if (!key) return;
  await fsp.rm(resolve(companyId, key), { force: true });
}
