'use strict';
/**
 * 발급 사이트 자체 백업 — 고객·라이선스·계약·청구·요청 대장 등 모든 표를 JSON 으로 묶어(gzip)
 * 외부 S3 저장소(BACKUP_S3_*)에 매일 한 번 올린다. 60일 지난 것은 지운다.
 *   license-portal/portal-YYYYMMDD-HHMM.json.gz
 * 되살리기: 파일을 받아 각 표의 rows 를 같은 이름의 표에 다시 넣는다 (scripts/restore-portal.js).
 */
const zlib = require('zlib');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const conf = () => (process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_ACCESS_KEY_ID && process.env.BACKUP_S3_SECRET_ACCESS_KEY
  ? { bucket: process.env.BACKUP_S3_BUCKET, endpoint: process.env.BACKUP_S3_ENDPOINT, region: process.env.BACKUP_S3_REGION || 'auto', accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY }
  : null);
const KEEP_DAYS = 60;
const PREFIX = 'license-portal/';

async function dump(pool) {
  const tables = (await pool.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)).rows.map((r) => r.table_name);
  const out = { createdAt: new Date().toISOString(), tables: {} };
  for (const t of tables) out.tables[t] = (await pool.query(`select * from "${t}"`)).rows;
  return out;
}

async function runBackup(pool) {
  const c = conf();
  if (!c) return { ok: false, message: '외부 백업 저장소(BACKUP_S3_*)가 설정되지 않았습니다' };
  const s3 = new S3Client({ endpoint: c.endpoint, region: c.region, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  const data = await dump(pool);
  const body = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
  const stamp = new Date(Date.now() + 9 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const key = `${PREFIX}portal-${stamp.slice(0, 8)}-${stamp.slice(8)}.json.gz`;
  await s3.send(new PutObjectCommand({ Bucket: c.bucket, Key: key, Body: body, ContentType: 'application/gzip' }));
  // 오래된 것 정리
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const old = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.LastModified && o.LastModified.getTime() < cutoff) old.push({ Key: o.Key });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  if (old.length) await s3.send(new DeleteObjectsCommand({ Bucket: c.bucket, Delete: { Objects: old } }));
  const rows = Object.values(data.tables).reduce((a, t) => a + t.length, 0);
  return { ok: true, key, bytes: body.length, rows, tables: Object.keys(data.tables).length, message: `발급 사이트 백업 완료 — 표 ${Object.keys(data.tables).length}개, ${rows}행, ${(body.length / 1024).toFixed(0)}KB (${c.bucket}/${key})` };
}

/** 매일 한국시간 4시 + 마지막 성공이 하루 넘었으면 시작 직후에도 한 번 */
function schedule(pool, onResult) {
  if (!conf()) return;
  let last = 0;
  const tick = async (force) => {
    const kst = new Date(Date.now() + 9 * 3600000);
    if (!force && (kst.getUTCHours() !== 4 || Date.now() - last < 20 * 3600000)) return;
    let r;
    try { r = await runBackup(pool); } catch (e) { r = { ok: false, message: `발급 사이트 백업 실패: ${e.message}` }; }
    if (r.ok) last = Date.now();
    console.log(`[백업] ${r.message}`);
    await onResult({ ...r, at: new Date().toISOString() }).catch(() => undefined);
  };
  setTimeout(() => void tick(true), 60_000).unref();
  setInterval(() => void tick(false), 10 * 60_000).unref();
}

module.exports = { runBackup, schedule, dump, configured: () => !!conf() };
