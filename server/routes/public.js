// 로그인 없이 접근하는 경로: 공유 쇼룸, 렌더 워커
import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { system, tenant } from '../db/index.js';
import * as storage from '../storage.js';
import { signShareToken, verifyShareToken, verifyRenderToken } from '../auth.js';

const r = Router();
const COOKIE = (id) => `eum3d_share_${id.slice(0, 8)}`;

/** 토큰으로 공유 링크 조회 → 상태 검사. 회사 범위는 링크의 company_id 로 한정 */
async function resolveShare(req) {
  const s = await system(async (c) => (await c.query('SELECT * FROM share_links WHERE token=$1', [req.params.token])).rows[0]);
  if (!s) return { code: 404, error: '존재하지 않는 링크입니다' };
  if (s.revoked_at) return { code: 410, error: '폐기된 링크입니다' };
  if (s.expires_at && new Date(s.expires_at) < new Date()) return { code: 410, error: '만료된 링크입니다' };
  if (s.password_hash) {
    const t = req.cookies?.[COOKIE(s.id)] || req.get('x-share-pass');
    let ok = false; try { ok = verifyShareToken(t).sid === s.id; } catch { /* 미인증 */ }
    if (!ok) return { code: 401, error: '비밀번호가 필요합니다', needsPassword: true, share: s };
  }
  return { share: s };
}

r.get('/public/shares/:token', async (req, res) => {
  const x = await resolveShare(req);
  if (x.error) return res.status(x.code).json({ error: x.error, needsPassword: !!x.needsPassword, title: x.share?.title });
  const s = x.share;
  const d = await tenant(s.company_id, async (c) => {
    const { rows: [m] } = await c.query('SELECT id,name,parts,stats,method,provenance FROM models WHERE id=$1', [s.model_id]);
    const { rows: [sc] } = await c.query('SELECT data FROM scenes WHERE model_id=$1 ORDER BY version DESC LIMIT 1', [s.model_id]);
    const { rows: [co] } = await c.query('SELECT name,brand FROM companies WHERE id=$1', [s.company_id]);
    await c.query('UPDATE share_links SET view_count=view_count+1 WHERE id=$1', [s.id]);
    await c.query('INSERT INTO share_visits (company_id,share_id,ip_hash,user_agent) VALUES ($1,$2,$3,$4)',
      [s.company_id, s.id, crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 16), String(req.get('user-agent') || '').slice(0, 300)]);
    return { model: m, scene: sc?.data, company: { name: co.name, brand: co.brand } };
  });
  // 원본 CAD 파일 경로·ID 는 노출하지 않는다
  res.json({ title: s.title, expiresAt: s.expires_at, ...d });
});

r.post('/public/shares/:token/unlock', async (req, res) => {
  const s = await system(async (c) => (await c.query('SELECT * FROM share_links WHERE token=$1', [req.params.token])).rows[0]);
  if (!s || s.revoked_at || (s.expires_at && new Date(s.expires_at) < new Date())) return res.status(404).json({ error: '사용할 수 없는 링크입니다' });
  if (!s.password_hash) return res.json({ ok: true });
  if (!(await bcrypt.compare(String(req.body?.password || ''), s.password_hash))) return res.status(401).json({ error: '비밀번호가 틀렸습니다' });
  const t = signShareToken(s.id);
  res.cookie(COOKIE(s.id), t, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600e3 });
  res.json({ ok: true, passToken: t });
});

r.get('/public/shares/:token/model.glb', async (req, res) => {
  const x = await resolveShare(req);
  if (x.error) return res.status(x.code).json({ error: x.error });
  const m = await tenant(x.share.company_id, async (c) => (await c.query('SELECT company_id,glb_key FROM models WHERE id=$1', [x.share.model_id])).rows[0]);
  res.type('model/gltf-binary');
  storage.stream(m.company_id, m.glb_key).pipe(res);
});

// ── 렌더 워커 전용 ────────────────────────────────────────────
function renderAuth(req, res) {
  try {
    const p = verifyRenderToken(String(req.query.t || ''));
    if (p.jid !== req.params.jobId) throw new Error();
    return p;
  } catch { res.status(401).json({ error: '렌더 토큰 오류' }); return null; }
}
r.get('/render/:jobId/bundle', async (req, res) => {
  const p = renderAuth(req, res); if (!p) return;
  const d = await tenant(p.cid, async (c) => {
    const { rows: [j] } = await c.query('SELECT payload FROM jobs WHERE id=$1', [p.jid]);
    const { rows: [m] } = await c.query('SELECT id,name,parts,stats FROM models WHERE id=$1', [p.mid]);
    const { rows: [sc] } = await c.query('SELECT data FROM scenes WHERE model_id=$1 AND version=$2', [p.mid, j.payload.sceneVersion]);
    const { rows: [co] } = await c.query('SELECT name FROM companies WHERE id=$1', [p.cid]);
    return { job: j.payload, model: m, scene: sc.data, company: co };
  });
  res.json(d);
});
r.get('/render/:jobId/model.glb', async (req, res) => {
  const p = renderAuth(req, res); if (!p) return;
  const m = await tenant(p.cid, async (c) => (await c.query('SELECT company_id,glb_key FROM models WHERE id=$1', [p.mid])).rows[0]);
  res.type('model/gltf-binary');
  storage.stream(m.company_id, m.glb_key).pipe(res);
});

export default r;
