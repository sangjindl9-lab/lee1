import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';
import { httpError, requireUser } from './auth.js';

/**
 * 파일(첨부·백업) 저장: SHA-256 내용 주소, 8 MiB 조각 업로드, 실패한 조각만 재전송.
 * 저장 위치: STORAGE_DIR(서버 디스크/볼륨). S3 호환 저장소는 같은 인터페이스로 교체 예정.
 */
const CHUNK = 8 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024 * 1024;
const root = () => { const d = process.env.STORAGE_DIR ?? './storage'; mkdirSync(d, { recursive: true }); return d; };
const SHA = /^[0-9a-f]{64}$/;

export function fileRoutes(app: FastifyInstance, db: Db) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: CHUNK + 1024 }, (_req, body, done) => done(null, body));

  /** 업로드 상태: 이미 있으면 skip, 아니면 받은 조각 목록 */
  app.get('/v1/files/:sha/status', async (req) => {
    const u = await requireUser(req);
    const sha = (req.params as any).sha;
    if (!SHA.test(sha)) throw httpError(400, 'bad_sha');
    const f = await db.query('SELECT size FROM stored_files WHERE user_id=$1 AND sha256=$2', [u.userId, sha]);
    if (f.rows.length) return { complete: true, size: Number(f.rows[0].size) };
    const c = await db.query('SELECT idx FROM file_chunks WHERE user_id=$1 AND sha256=$2 ORDER BY idx', [u.userId, sha]);
    return { complete: false, chunkSize: CHUNK, received: c.rows.map((r) => r.idx) };
  });

  app.put('/v1/files/:sha/chunks/:idx', async (req) => {
    const u = await requireUser(req);
    const { sha, idx } = req.params as any;
    const total = Number((req.query as any).total);
    const i = Number(idx);
    if (!SHA.test(sha) || !Number.isInteger(i) || i < 0 || !Number.isInteger(total) || total < 1 || i >= total || total * CHUNK > MAX_FILE + CHUNK) throw httpError(400, 'bad_chunk');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > CHUNK) throw httpError(400, 'bad_chunk_size');
    const dir = join(root(), 'tmp', u.userId, sha); mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${i}.part`);
    writeFileSync(tmp + '.w', body); renameSync(tmp + '.w', tmp);
    await db.query(`INSERT INTO file_chunks(user_id, sha256, idx, total, size) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (user_id, sha256, idx) DO UPDATE SET size=EXCLUDED.size, updated_at=now()`, [u.userId, sha, i, total, body.length]);
    return { ok: true };
  });

  /** 조각 합치기 + SHA-256 검증. 저장 용량 한도 확인. */
  app.post('/v1/files/:sha/complete', async (req) => {
    const u = await requireUser(req);
    const sha = (req.params as any).sha;
    if (!SHA.test(sha)) throw httpError(400, 'bad_sha');
    if ((await db.query('SELECT 1 FROM stored_files WHERE user_id=$1 AND sha256=$2', [u.userId, sha])).rows.length) return { ok: true, existed: true };
    const chunks = (await db.query('SELECT idx, total, size FROM file_chunks WHERE user_id=$1 AND sha256=$2 ORDER BY idx', [u.userId, sha])).rows;
    if (!chunks.length || chunks.length !== chunks[0].total || chunks.some((c, k) => c.idx !== k)) throw httpError(409, 'missing_chunks');
    const size = chunks.reduce((s, c) => s + c.size, 0);
    const q = (await db.query('SELECT storage_quota_bytes AS q, storage_used_bytes AS u FROM users WHERE id=$1', [u.userId])).rows[0];
    if (Number(q.u) + size > Number(q.q)) throw httpError(507, 'quota_exceeded');
    const dir = join(root(), 'tmp', u.userId, sha);
    const objDir = join(root(), 'objects', u.userId); mkdirSync(objDir, { recursive: true });
    const assembled = join(objDir, sha + '.assembling');
    writeFileSync(assembled, '');
    const h = createHash('sha256');
    for (const c of chunks) { const b = readFileSync(join(dir, `${c.idx}.part`)); h.update(b); appendFileSync(assembled, b); }
    if (h.digest('hex') !== sha) { rmSync(assembled); await db.query('DELETE FROM file_chunks WHERE user_id=$1 AND sha256=$2', [u.userId, sha]); rmSync(dir, { recursive: true, force: true }); throw httpError(422, 'checksum_mismatch'); }
    const key = `objects/${u.userId}/${sha}`;
    renameSync(assembled, join(root(), key));
    await db.query('INSERT INTO stored_files(user_id, sha256, size, object_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [u.userId, sha, size, key]);
    await db.query('UPDATE users SET storage_used_bytes=storage_used_bytes+$2 WHERE id=$1', [u.userId, size]);
    await db.query(`UPDATE attachments SET object_key=$3, upload_state='complete', updated_at=now() WHERE user_id=$1 AND sha256=$2`, [u.userId, sha, key]);
    await db.query('DELETE FROM file_chunks WHERE user_id=$1 AND sha256=$2', [u.userId, sha]);
    rmSync(dir, { recursive: true, force: true });
    return { ok: true, size };
  });

  app.get('/v1/files/:sha', async (req, reply) => {
    const u = await requireUser(req);
    const sha = (req.params as any).sha;
    if (!SHA.test(sha)) throw httpError(400, 'bad_sha');
    const f = (await db.query('SELECT object_key, size FROM stored_files WHERE user_id=$1 AND sha256=$2', [u.userId, sha])).rows[0];
    if (!f || !existsSync(join(root(), f.object_key))) throw httpError(404, 'not_found');
    reply.header('content-length', statSync(join(root(), f.object_key)).size).type('application/octet-stream');
    return reply.send(createReadStream(join(root(), f.object_key)));
  });

  // ---- 클라우드 백업(암호화된 .npbak 파일을 그대로 보관) ----
  app.post('/v1/backups', async (req) => {
    const u = await requireUser(req);
    const b = req.body as any;
    if (!SHA.test(String(b?.sha256))) throw httpError(400, 'bad_sha');
    const f = (await db.query('SELECT object_key, size FROM stored_files WHERE user_id=$1 AND sha256=$2', [u.userId, b.sha256])).rows[0];
    if (!f) throw httpError(409, 'upload_first');
    const r = await db.query(`INSERT INTO backup_jobs(user_id, device_id, kind, state, object_key, size, sha256, finished_at) VALUES($1,$2,$3,'done',$4,$5,$6, now()) RETURNING id, created_at`,
      [u.userId, u.deviceId, b.kind === 'auto' ? 'auto' : 'manual', f.object_key, f.size, b.sha256]);
    return r.rows[0];
  });

  app.get('/v1/backups', async (req) => {
    const u = await requireUser(req);
    return { backups: (await db.query(`SELECT b.id, b.kind, b.size, b.sha256, b.created_at, d.model, d.platform FROM backup_jobs b LEFT JOIN user_devices d ON d.id=b.device_id
      WHERE b.user_id=$1 AND b.state='done' AND b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 50`, [u.userId])).rows };
  });
}
