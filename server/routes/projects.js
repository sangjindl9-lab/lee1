import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tenant, audit } from '../db/index.js';
import { requireRole } from '../auth.js';
import { config } from '../config.js';
import * as storage from '../storage.js';
import { EXTS, sniff } from '../convert/index.js';
import { enqueue } from '../jobs/queue.js';

const r = Router();
const INDUSTRIES = ['mold', 'machine', 'electric', 'building', 'product'];
const write = requireRole('admin', 'member');
const nf = (res, what = '항목') => res.status(404).json({ error: `${what}을(를) 찾을 수 없습니다` });

r.get('/projects', async (req, res) => {
  res.json(await req.db(async (c) => (await c.query(`
    SELECT p.*, (SELECT count(*)::int FROM models m WHERE m.project_id=p.id) AS model_count,
           (SELECT count(*)::int FROM files f WHERE f.project_id=p.id) AS file_count
      FROM projects p ORDER BY p.updated_at DESC`)).rows));
});

r.post('/projects', write, async (req, res) => {
  const { name, industry = 'machine', description = '' } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '프로젝트명을 입력하세요' });
  if (!INDUSTRIES.includes(industry)) return res.status(400).json({ error: '산업 분야 값이 올바르지 않습니다' });
  const p = await req.db(async (c) => {
    const { rows: [p] } = await c.query(
      'INSERT INTO projects (company_id,name,industry,description,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.companyId, name.trim(), industry, description, req.user.id]);
    await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: 'project.create', target: p.id });
    return p;
  });
  res.status(201).json(p);
});

r.get('/projects/:id', async (req, res) => {
  const d = await req.db(async (c) => {
    const { rows: [p] } = await c.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
    if (!p) return null;
    const files = (await c.query('SELECT id,original_name,ext,size,version,status,error,created_at,(analysis IS NOT NULL) AS has_analysis FROM files WHERE project_id=$1 ORDER BY created_at DESC', [p.id])).rows;
    const models = (await c.query('SELECT id,name,method,source_file_id,source_file_version,stats,review_status,created_at FROM models WHERE project_id=$1 ORDER BY created_at DESC', [p.id])).rows;
    const jobs = (await c.query("SELECT id,type,status,progress,message,error,payload,result,attempts,created_at FROM jobs WHERE payload->>'projectId'=$1 ORDER BY created_at DESC LIMIT 30", [p.id])).rows;
    return { project: p, files, models, jobs };
  });
  d ? res.json(d) : nf(res, '프로젝트');
});

r.patch('/projects/:id', write, async (req, res) => {
  const { name, description, industry } = req.body || {};
  if (industry && !INDUSTRIES.includes(industry)) return res.status(400).json({ error: '산업 분야 값 오류' });
  const p = await req.db(async (c) => (await c.query(
    'UPDATE projects SET name=COALESCE($2,name), description=COALESCE($3,description), industry=COALESCE($4,industry), updated_at=now() WHERE id=$1 RETURNING *',
    [req.params.id, name?.trim() || null, description ?? null, industry || null])).rows[0]);
  p ? res.json(p) : nf(res, '프로젝트');
});

r.delete('/projects/:id', requireRole('admin'), async (req, res) => {
  const ok = await req.db(async (c) => {
    const { rowCount } = await c.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
    if (rowCount) await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: 'project.delete', target: req.params.id });
    return rowCount;
  });
  ok ? res.json({ ok: true }) : nf(res, '프로젝트');
});

// ── 분할 업로드 ────────────────────────────────────────────────
const extOf = (n) => (n.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const tmpPath = (id) => path.join(config.tmpDir, `upload-${id}`);

r.post('/projects/:id/uploads', write, async (req, res) => {
  const { name, size } = req.body || {};
  const ext = extOf(name || '');
  if (!EXTS.includes(ext)) return res.status(400).json({ error: `지원하지 않는 형식입니다. 지원: ${EXTS.join(', ').toUpperCase()}` });
  if (!(size > 0) || size > config.maxUploadBytes) return res.status(400).json({ error: `파일 크기 오류 (최대 ${config.maxUploadBytes / 1048576}MB)` });
  const s = await req.db(async (c) => {
    const { rows: [p] } = await c.query('SELECT id FROM projects WHERE id=$1', [req.params.id]);
    if (!p) return null;
    return (await c.query('INSERT INTO upload_sessions (company_id,project_id,original_name,size,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.companyId, p.id, path.basename(name).slice(0, 255), size, req.user.id])).rows[0];
  });
  if (!s) return nf(res, '프로젝트');
  await fsp.mkdir(config.tmpDir, { recursive: true });
  await fsp.writeFile(tmpPath(s.id), Buffer.alloc(0));
  res.status(201).json({ uploadId: s.id, chunkSize: config.chunkBytes });
});

r.put('/uploads/:id/chunks/:index', write, async (req, res) => {
  const idx = Number(req.params.index);
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: '빈 조각' });
  // 세션 행을 잠근 채로 이어 붙여 같은 조각이 동시에 들어와도 한 번만 기록
  const out = await req.db(async (c) => {
    const { rows: [s] } = await c.query('SELECT * FROM upload_sessions WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!s) return { code: 404, body: { error: '업로드를 찾을 수 없습니다' } };
    if (idx !== s.next_chunk) return { code: 409, body: { error: `조각 순서 오류 (기대 ${s.next_chunk})`, expected: s.next_chunk } };
    if (Number(s.received) + body.length > Number(s.size)) return { code: 400, body: { error: '선언한 크기를 초과했습니다' } };
    await fsp.appendFile(tmpPath(s.id), body);
    await c.query('UPDATE upload_sessions SET received=received+$2, next_chunk=next_chunk+1 WHERE id=$1', [s.id, body.length]);
    return { code: 200, body: { received: Number(s.received) + body.length } };
  });
  res.status(out.code).json(out.body);
});

r.post('/uploads/:id/complete', write, async (req, res) => {
  const s = await req.db(async (c) => (await c.query('SELECT * FROM upload_sessions WHERE id=$1', [req.params.id])).rows[0]);
  if (!s) return nf(res, '업로드');
  const tp = tmpPath(s.id);
  const st = await fsp.stat(tp).catch(() => null);
  if (!st || st.size !== Number(s.size)) return res.status(400).json({ error: `업로드가 완료되지 않았습니다 (${st?.size || 0}/${s.size})` });
  const ext = extOf(s.original_name);
  const fd = await fsp.open(tp); const head = Buffer.alloc(4096); await fd.read(head, 0, 4096, 0); await fd.close();
  const bad = sniff(ext, head.subarray(0, Math.min(4096, st.size)));
  if (bad) {
    await fsp.unlink(tp).catch(() => {});
    await req.db((c) => c.query('DELETE FROM upload_sessions WHERE id=$1', [s.id]));
    return res.status(400).json({ error: bad });
  }
  const sha = await storage.sha256File(tp);
  const out = await req.db(async (c) => {
    const { rows: [{ v }] } = await c.query('SELECT COALESCE(max(version),0)+1 AS v FROM files WHERE project_id=$1 AND original_name=$2', [s.project_id, s.original_name]);
    const { rows: [f] } = await c.query(
      `INSERT INTO files (company_id,project_id,original_name,ext,size,sha256,storage_key,version,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING *`,
      [s.company_id, s.project_id, s.original_name, ext, st.size, sha, v, req.user.id]);
    const key = storage.keyFor(s.company_id, 'originals', f.id, `v${v}.${ext}`);
    await storage.moveIn(s.company_id, key, tp);
    await c.query('UPDATE files SET storage_key=$2 WHERE id=$1', [f.id, key]);
    await c.query('DELETE FROM upload_sessions WHERE id=$1', [s.id]);
    await c.query('UPDATE projects SET updated_at=now() WHERE id=$1', [s.project_id]);
    const job = await enqueue(c, { companyId: s.company_id, type: 'convert', payload: { fileId: f.id, projectId: s.project_id }, userId: req.user.id });
    await audit(c, { companyId: s.company_id, userId: req.user.id, action: 'file.upload', target: f.id, meta: { name: s.original_name, size: st.size, sha256: sha, version: v } });
    return { file: { ...f, storage_key: undefined }, job };
  });
  res.status(201).json(out);
});

// ── 파일 ──────────────────────────────────────────────────────
r.get('/files/:id', async (req, res) => {
  const f = await req.db(async (c) => (await c.query('SELECT id,project_id,original_name,ext,size,sha256,version,status,analysis,error,created_at FROM files WHERE id=$1', [req.params.id])).rows[0]);
  f ? res.json(f) : nf(res, '파일');
});

// 재분석: 분석 엔진이 개선된 뒤 기존 파일을 다시 분석 (원본은 그대로)
r.post('/files/:id/reanalyze', write, async (req, res) => {
  const job = await req.db(async (c) => {
    const { rows: [f] } = await c.query("UPDATE files SET status='uploaded' WHERE id=$1 AND ext = ANY($2) RETURNING *", [req.params.id, ['dxf', 'dwg', 'pdf']]);
    if (!f) return null;
    return enqueue(c, { companyId: f.company_id, type: 'convert', payload: { fileId: f.id, projectId: f.project_id }, userId: req.user.id });
  });
  job ? res.status(201).json(job) : res.status(404).json({ error: '재분석할 2D 도면을 찾을 수 없습니다' });
});

// 원본 다운로드: 회사 내부 관리자·작성자만, 감사 로그 기록
r.get('/files/:id/original', write, async (req, res) => {
  const f = await req.db(async (c) => {
    const { rows: [f] } = await c.query('SELECT * FROM files WHERE id=$1', [req.params.id]);
    if (f) await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: 'file.download_original', target: f.id });
    return f;
  });
  if (!f) return nf(res, '파일');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  res.setHeader('Content-Type', 'application/octet-stream');
  storage.stream(f.company_id, f.storage_key).pipe(res);
});

// ── 작업 ──────────────────────────────────────────────────────
r.get('/jobs/:id', async (req, res) => {
  const j = await req.db(async (c) => (await c.query('SELECT * FROM jobs WHERE id=$1', [req.params.id])).rows[0]);
  j ? res.json(j) : nf(res, '작업');
});
r.post('/jobs/:id/retry', write, async (req, res) => {
  const j = await req.db(async (c) => (await c.query(
    "UPDATE jobs SET status='queued', error=NULL, message='수동 재시도', max_attempts=attempts+1, finished_at=NULL WHERE id=$1 AND status='failed' RETURNING *", [req.params.id])).rows[0]);
  j ? res.json(j) : res.status(409).json({ error: '실패한 작업만 재시도할 수 있습니다' });
});

export default r;
