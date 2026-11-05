import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { audit } from '../db/index.js';
import { requireRole } from '../auth.js';
import { config } from '../config.js';
import * as storage from '../storage.js';
import { extrudeDxf } from '../convert/dxf.js';
import { createModel, previewKey } from '../jobs/convert-job.js';
import { DRAWING_EXTS } from '../convert/index.js';
import { enqueue } from '../jobs/queue.js';
import { QUALITY } from '../jobs/render.js';
import { totalDuration } from '../../shared/scene.js';

const r = Router();
const write = requireRole('admin', 'member');
const nf = (res, what) => res.status(404).json({ error: `${what}을(를) 찾을 수 없습니다` });
export const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

const sceneOf = async (c, modelId) =>
  (await c.query('SELECT version,data,created_at FROM scenes WHERE model_id=$1 ORDER BY version DESC LIMIT 1', [modelId])).rows[0];

r.get('/models/:id', async (req, res) => {
  const d = await req.db(async (c) => {
    const { rows: [m] } = await c.query(`SELECT m.*, f.original_name AS source_name, f.ext AS source_ext
      FROM models m JOIN files f ON f.id=m.source_file_id WHERE m.id=$1`, [req.params.id]);
    if (!m) return null;
    return { model: { ...m, glb_key: undefined }, scene: await sceneOf(c, m.id) };
  });
  d ? res.json(d) : nf(res, '모델');
});

r.get('/models/:id/glb', async (req, res) => {
  const m = await req.db(async (c) => (await c.query('SELECT company_id,glb_key FROM models WHERE id=$1', [req.params.id])).rows[0]);
  if (!m?.glb_key) return nf(res, '모델');
  res.type('model/gltf-binary');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  storage.stream(m.company_id, m.glb_key).pipe(res);
});

// 프로젝트 저장: 장면(분해·재질·카메라·애니메이션)을 새 버전으로 저장
r.put('/models/:id/scene', write, async (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object' || typeof data.parts !== 'object') return res.status(400).json({ error: '장면 데이터 형식 오류' });
  if (JSON.stringify(data).length > 2e6) return res.status(413).json({ error: '장면 데이터가 너무 큽니다' });
  const s = await req.db(async (c) => {
    const { rows: [m] } = await c.query('SELECT id,project_id FROM models WHERE id=$1', [req.params.id]);
    if (!m) return null;
    const { rows: [{ v }] } = await c.query('SELECT COALESCE(max(version),0)+1 AS v FROM scenes WHERE model_id=$1', [m.id]);
    const { rows: [s] } = await c.query('INSERT INTO scenes (company_id,model_id,version,data,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING version,created_at',
      [req.user.companyId, m.id, v, data, req.user.id]);
    await c.query('UPDATE projects SET updated_at=now() WHERE id=$1', [m.project_id]);
    return s;
  });
  s ? res.json(s) : nf(res, '모델');
});

r.get('/models/:id/scenes', async (req, res) => {
  res.json(await req.db(async (c) => (await c.query('SELECT version,created_at,created_by FROM scenes WHERE model_id=$1 ORDER BY version DESC', [req.params.id])).rows));
});

// 2D 도면(DXF·DWG·PDF) → 사용자 두께(·축척) 입력 → 돌출 3D 생성
r.post('/files/:id/extrude', write, async (req, res) => {
  const out = await req.db(async (c) => {
    const { rows: [f] } = await c.query('SELECT * FROM files WHERE id=$1', [req.params.id]);
    if (!f) return { code: 404, body: { error: '파일을 찾을 수 없습니다' } };
    if (!DRAWING_EXTS.includes(f.ext) || !f.analysis) return { code: 400, body: { error: '분석이 끝난 2D 도면(DXF·DWG·PDF)만 3D 생성할 수 있습니다' } };
    const name = (req.body?.name || f.original_name.replace(/\.[^.]+$/, '')).slice(0, 120);
    const result = await extrudeDxf(f.analysis, req.body || {}, name);
    const m = await createModel(c, { file: f, result, glb: Buffer.from(result.glb), name });
    await c.query("UPDATE files SET status='converted' WHERE id=$1", [f.id]);
    await audit(c, { companyId: f.company_id, userId: req.user.id, action: 'model.create', target: m.id, meta: { fileId: f.id, method: result.method, input: req.body } });
    return { code: 201, body: { modelId: m.id, stats: result.stats, provenance: result.provenance } };
  });
  res.status(out.code).json(out.body);
});

r.get('/files/:id/preview', async (req, res) => {
  const f = await req.db(async (c) => (await c.query('SELECT id,company_id FROM files WHERE id=$1', [req.params.id])).rows[0]);
  if (!f) return nf(res, '파일');
  const st = await storage.stat(f.company_id, previewKey(f)).catch(() => null);
  if (!st) return nf(res, '미리보기');
  res.type('png');
  storage.stream(f.company_id, previewKey(f)).pipe(res);
});

// ── 동영상 렌더 ────────────────────────────────────────────────
r.post('/models/:id/renders', write, async (req, res) => {
  const { quality = 'fhd', fps = 30 } = req.body || {};
  if (!QUALITY[quality]) return res.status(400).json({ error: '해상도 값 오류 (hd|fhd|qhd|4k)' });
  if (![24, 30, 60].includes(Number(fps))) return res.status(400).json({ error: 'fps 는 24·30·60 중 하나' });
  const out = await req.db(async (c) => {
    const { rows: [m] } = await c.query('SELECT id,project_id FROM models WHERE id=$1', [req.params.id]);
    if (!m) return null;
    const sc = await sceneOf(c, m.id);
    const dur = totalDuration(sc.data);
    if (!(dur > 0)) return { error: '애니메이션 클립이 없습니다' };
    if (dur > config.maxRenderSeconds) return { error: `영상 길이는 최대 ${config.maxRenderSeconds}초입니다 (현재 ${dur}초)` };
    const job = await enqueue(c, { companyId: req.user.companyId, type: 'render', userId: req.user.id,
      payload: { modelId: m.id, projectId: m.project_id, sceneVersion: sc.version, quality, fps: Number(fps), duration: dur } });
    await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: 'render.request', target: job.id, meta: { modelId: m.id, quality, fps } });
    return { job };
  });
  if (!out) return nf(res, '모델');
  out.error ? res.status(400).json(out) : res.status(201).json(out.job);
});

r.get('/models/:id/videos', async (req, res) => {
  res.json(await req.db(async (c) => (await c.query('SELECT id,width,height,fps,duration,size,format,created_at FROM videos WHERE model_id=$1 ORDER BY created_at DESC', [req.params.id])).rows));
});

async function sendVideo(req, res) {
  const v = await req.db(async (c) => (await c.query('SELECT * FROM videos WHERE id=$1', [req.params.id])).rows[0]);
  if (!v) return nf(res, '영상');
  const key = req.params.kind === 'thumb' ? v.thumb_key : v.storage_key;
  if (!key) return nf(res, '썸네일');
  const st = await storage.stat(v.company_id, key);
  const type = req.params.kind === 'thumb' ? 'image/jpeg' : 'video/mp4';
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="eum3d-${v.id.slice(0, 8)}.mp4"`);
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) { // 브라우저 동영상 재생용 범위 요청
    const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Content-Type': type });
    return storage.stream(v.company_id, key, { start, end }).pipe(res);
  }
  res.set({ 'Content-Length': st.size, 'Content-Type': type });
  storage.stream(v.company_id, key).pipe(res);
}
r.get('/videos/:id/file', (req, res) => { req.params.kind = 'file'; return sendVideo(req, res); });
r.get('/videos/:id/thumb', (req, res) => { req.params.kind = 'thumb'; return sendVideo(req, res); });

// ── 공유 링크 관리 ─────────────────────────────────────────────
const newToken = () => crypto.randomBytes(12).toString('base64url');
const shareOut = (req, s) => ({ ...s, password_hash: undefined, has_password: !!s.password_hash, url: `${baseUrl(req)}/s/${s.token}` });

r.post('/models/:id/shares', write, async (req, res) => {
  const { title = '', password, expiresAt } = req.body || {};
  if (password && String(password).length < 4) return res.status(400).json({ error: '비밀번호는 4자 이상' });
  const exp = expiresAt ? new Date(expiresAt) : null;
  if (exp && (isNaN(exp) || exp < new Date())) return res.status(400).json({ error: '만료일이 올바르지 않습니다' });
  const s = await req.db(async (c) => {
    const { rows: [m] } = await c.query('SELECT id,project_id,name FROM models WHERE id=$1', [req.params.id]);
    if (!m) return null;
    const { rows: [s] } = await c.query(
      `INSERT INTO share_links (company_id,project_id,model_id,token,title,password_hash,expires_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.companyId, m.project_id, m.id, newToken(), title || m.name, password ? await bcrypt.hash(String(password), 10) : null, exp, req.user.id]);
    await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: 'share.create', target: s.id, meta: { modelId: m.id, password: !!password, expiresAt: exp } });
    return s;
  });
  s ? res.status(201).json(shareOut(req, s)) : nf(res, '모델');
});

r.get('/projects/:id/shares', async (req, res) => {
  const rows = await req.db(async (c) => (await c.query('SELECT * FROM share_links WHERE project_id=$1 ORDER BY created_at DESC', [req.params.id])).rows);
  res.json(rows.map((s) => shareOut(req, s)));
});

r.patch('/shares/:id', write, async (req, res) => {
  const { revoke, password, expiresAt, title } = req.body || {};
  const s = await req.db(async (c) => {
    const sets = [], vals = [req.params.id];
    if (revoke) sets.push('revoked_at=now()');
    if (password !== undefined) { vals.push(password ? await bcrypt.hash(String(password), 10) : null); sets.push(`password_hash=$${vals.length}`); }
    if (expiresAt !== undefined) { vals.push(expiresAt ? new Date(expiresAt) : null); sets.push(`expires_at=$${vals.length}`); }
    if (title !== undefined) { vals.push(String(title)); sets.push(`title=$${vals.length}`); }
    if (!sets.length) return 'noop';
    const { rows: [s] } = await c.query(`UPDATE share_links SET ${sets.join(',')} WHERE id=$1 RETURNING *`, vals);
    if (s) await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: revoke ? 'share.revoke' : 'share.update', target: s.id });
    return s;
  });
  if (s === 'noop') return res.status(400).json({ error: '변경할 항목이 없습니다' });
  s ? res.json(shareOut(req, s)) : nf(res, '공유 링크');
});

// 재발급: 기존 토큰 폐기 + 같은 설정으로 새 토큰
r.post('/shares/:id/reissue', write, async (req, res) => {
  const s = await req.db(async (c) => {
    const { rows: [old] } = await c.query('UPDATE share_links SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 RETURNING *', [req.params.id]);
    if (!old) return null;
    const { rows: [s] } = await c.query(
      `INSERT INTO share_links (company_id,project_id,model_id,token,title,password_hash,expires_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [old.company_id, old.project_id, old.model_id, newToken(), old.title, old.password_hash, old.expires_at, req.user.id]);
    await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: 'share.reissue', target: s.id, meta: { from: old.id } });
    return s;
  });
  s ? res.status(201).json(shareOut(req, s)) : nf(res, '공유 링크');
});

async function sendQr(req, res, fmt) {
  const s = await req.db(async (c) => (await c.query('SELECT token FROM share_links WHERE id=$1', [req.params.id])).rows[0]);
  if (!s) return nf(res, '공유 링크');
  const url = `${baseUrl(req)}/s/${s.token}`;
  if (fmt === 'svg') return res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1 }));
  res.type('png').send(await QRCode.toBuffer(url, { width: 512, margin: 1 }));
}
r.get('/shares/:id/qr.png', (req, res) => sendQr(req, res, 'png'));
r.get('/shares/:id/qr.svg', (req, res) => sendQr(req, res, 'svg'));

r.get('/shares/:id/visits', async (req, res) => {
  res.json(await req.db(async (c) => (await c.query('SELECT at,user_agent FROM share_visits WHERE share_id=$1 ORDER BY at DESC LIMIT 200', [req.params.id])).rows));
});

export default r;
