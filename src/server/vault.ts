// 비공개 납품물 보관소. 파일은 파일별 키(AES-256-GCM)로 암호화해 저장하고, 키는 마스터 키로 감싸 DB에 둔다.
// 저장소는 어댑터 구조다. 현재 구현은 로컬 디스크이며, S3 호환 저장소는 같은 인터페이스로 추가한다(미구현).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { config } from './config.ts';
import { randomId, wrapKey, unwrapKey, AppError } from './util.ts';

interface Storage { writeStream(key: string): fs.WriteStream; readStream(key: string): Readable; size(key: string): number | null; remove(key: string): void }
function localStorage(): Storage {
  const dir = path.join(config.dataDir, 'vault');
  const p = (k: string) => path.join(dir, path.basename(k));
  return {
    writeStream: (k) => { fs.mkdirSync(dir, { recursive: true }); return fs.createWriteStream(p(k), { mode: 0o600 }); },
    readStream: (k) => fs.createReadStream(p(k)),
    size: (k) => { try { return fs.statSync(p(k)).size; } catch { return null; } },
    remove: (k) => { try { fs.unlinkSync(p(k)); } catch { /* 이미 없음 */ } },
  };
}
export function storage(): Storage {
  if (config.storage === 'local') return localStorage();
  throw new AppError(`저장소 "${config.storage}" 는 아직 연동되지 않았습니다`);
}

export async function store(tmpPath: string) {
  const key = crypto.randomBytes(32); const iv = crypto.randomBytes(12);
  const storageKey = randomId(20);
  const hash = crypto.createHash('sha256'); let size = 0;
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const src = fs.createReadStream(tmpPath);
  src.on('data', (c: Buffer) => { hash.update(c); size += c.length; });
  await pipeline(src, cipher, storage().writeStream(storageKey));
  return { storageKey, size, sha256: hash.digest('hex'), keyWrapped: `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${wrapKey(key)}` };
}
/** 저장소에 실제로 있고 크기가 기록과 같은가 */
export const present = (f: { storage_key: string; size_bytes: number }) => storage().size(f.storage_key) === Number(f.size_bytes);
export function readStream(f: { storage_key: string; key_wrapped: string }): Readable {
  const [iv, tag, wrapped] = f.key_wrapped.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', unwrapKey(wrapped), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return storage().readStream(f.storage_key).pipe(d);
}
export const remove = (storageKey: string) => storage().remove(storageKey);

// ── 검사 ── 상태: pending 대기 / scanning 검사 중 / passed 통과 / flagged 문제 발견 / unscannable 검사 불가
const MAX_ENTRIES = 20000, MAX_TOTAL = 4 * 1024 ** 3, MAX_RATIO = 200, MAX_TEXT = 1024 * 1024, MAX_SCAN_TOTAL = 80 * 1024 * 1024;
const TEXT_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|json|ya?ml|toml|ini|conf|cfg|properties|env|txt|md|py|rb|php|java|kt|cs|go|rs|sh|bat|ps1|sql|xml|html?|css|vue|svelte|gradle|plist|tf)$/i;
const SENSITIVE_NAME = /^(\.env(\.(local|prod|production|development|staging))?|id_rsa|id_ed25519|id_ecdsa|credentials\.json|serviceAccountKey\.json|.*\.(p12|pfx|jks|keystore))$/i;
const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, '개인키'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS 액세스 키'],
  [/\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}/, '결제 실서비스 비밀키'],
  [/\blive_[sg]k_[0-9a-zA-Z]{16,}/, '결제 실서비스 비밀키'],
  [/\bsk-[A-Za-z0-9_-]{32,}/, 'AI 서비스 API 키'],
  [/\bghp_[A-Za-z0-9]{36}\b/, 'GitHub 토큰'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API 키'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, 'Slack 토큰'],
  [/\b\d{6}-[1-4]\d{6}\b/, '주민등록번호 형식'],
];
export function findSecrets(text: string) {
  const hits = PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
  if ((text.match(/\b01[016789]-?\d{3,4}-?\d{4}\b/g) || []).length >= 30) hits.push('전화번호 다량(개인정보 DB 의심)');
  return hits;
}

type ScanOut = { archive: string; secret: string; detail: string[] };
function scanZip(file: string): Promise<ScanOut> {
  const out: ScanOut = { archive: 'passed', secret: 'passed', detail: [] };
  return new Promise((resolve) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return resolve({ archive: 'flagged', secret: 'unscannable', detail: [`압축 파일을 열 수 없음: ${err?.message}`] });
      let total = 0, scanned = 0, done = false;
      const finish = () => { if (!done) { done = true; try { zip.close(); } catch { /* */ } resolve(out); } };
      const bad = (msg: string) => { out.archive = 'flagged'; if (out.secret === 'passed') out.secret = 'unscannable'; out.detail.push(msg); finish(); };
      if (zip.entryCount > MAX_ENTRIES) return bad(`항목 수 과다(${zip.entryCount}개)`);
      zip.on('error', (e) => bad(`압축 구조 문제(경로 탈출·크기 위조 등): ${e.message}`));
      zip.on('end', finish);
      zip.on('entry', (entry) => {
        const name: string = entry.fileName;
        total += entry.uncompressedSize;
        if (total > MAX_TOTAL) return bad('압축 해제 크기 한도 초과(압축 폭탄 의심)');
        if (entry.uncompressedSize > 50 * 1024 * 1024 && entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_RATIO) return bad(`비정상 압축률(압축 폭탄 의심): ${name}`);
        if (name.endsWith('/')) return zip.readEntry();
        const base = name.split('/').pop() || '';
        if (SENSITIVE_NAME.test(base)) { out.secret = 'flagged'; out.detail.push(`민감 파일 포함: ${name}`); }
        if (/\.(zip|tar|gz|tgz|7z|rar)$/i.test(base)) out.detail.push(`중첩 압축 파일은 내부를 검사하지 않음: ${name}`);
        if (TEXT_EXT.test(base) && entry.uncompressedSize <= MAX_TEXT && scanned < MAX_SCAN_TOTAL) {
          zip.openReadStream(entry, (e2, rs) => {
            if (e2 || !rs) return bad(`항목을 읽을 수 없음: ${name}`);
            const chunks: Buffer[] = [];
            rs.on('data', (c: Buffer) => chunks.push(c));
            rs.on('error', (e3) => bad(`항목 읽기 오류: ${name} (${e3.message})`));
            rs.on('end', () => {
              const buf = Buffer.concat(chunks); scanned += buf.length;
              const hits = findSecrets(buf.toString('utf8'));
              if (hits.length) { out.secret = 'flagged'; out.detail.push(`${name}: ${hits.join(', ')}`); }
              zip.readEntry();
            });
          });
        } else zip.readEntry();
      });
      zip.readEntry();
    });
  });
}
function scanMalware(file: string): Promise<{ status: string; detail: string }> {
  return new Promise((resolve) => {
    execFile('clamscan', ['--no-summary', file], { timeout: 120000 }, (err: any, stdout) => {
      if (err && err.code === 'ENOENT') return resolve({ status: 'unscannable', detail: '악성 파일 검사 엔진(ClamAV) 미연동' });
      if (!err) return resolve({ status: 'passed', detail: '' });
      if (err.code === 1) return resolve({ status: 'flagged', detail: `악성 파일 탐지: ${String(stdout).trim().slice(0, 200)}` });
      resolve({ status: 'unscannable', detail: '악성 파일 검사 실행 실패' });
    });
  });
}
export async function scan(tmpPath: string, filename: string) {
  let r: ScanOut;
  if (/\.zip$/i.test(filename)) r = await scanZip(tmpPath);
  else if (/\.(tar|gz|tgz|7z|rar)$/i.test(filename)) r = { archive: 'unscannable', secret: 'unscannable', detail: ['zip 이외의 압축 형식은 내부 검사를 지원하지 않음'] };
  else if (TEXT_EXT.test(filename) && fs.statSync(tmpPath).size <= MAX_TEXT) {
    const hits = findSecrets(fs.readFileSync(tmpPath, 'utf8'));
    r = { archive: 'passed', secret: hits.length ? 'flagged' : 'passed', detail: hits.map((h) => `${filename}: ${h}`) };
  } else r = { archive: 'passed', secret: 'unscannable', detail: ['바이너리·대용량 파일은 비밀키·개인정보 패턴 검사 대상이 아님'] };
  if (SENSITIVE_NAME.test(filename)) { r.secret = 'flagged'; r.detail.push(`민감 파일명: ${filename}`); }
  const m = await scanMalware(tmpPath);
  if (m.detail) r.detail.push(m.detail);
  return { archive: r.archive, secret: r.secret, malware: m.status, detail: r.detail.slice(0, 50) };
}
