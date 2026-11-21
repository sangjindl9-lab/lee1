import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { readFileSync, statfsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';
import { httpError, requireUser, secret } from './auth.js';
import { PLANS } from './billing.js';

/**
 * 관리자 시스템. 역할: owner(전체), support(사용자 수·문의·오류·공지·버전), finance(구독·결제·AI 비용).
 * 어떤 관리자 API도 노트 내용(pages, pen_strokes, page_elements, 첨부 파일)을 반환하지 않는다 — 집계 수치만.
 */
type Role = 'owner' | 'support' | 'finance';
const CAN: Record<string, Role[]> = {
  stats: ['owner', 'support', 'finance'], users: ['owner', 'support'], subscriptions: ['owner', 'finance'], payments: ['owner', 'finance'],
  storage: ['owner'], sync: ['owner', 'support'], errors: ['owner', 'support'], ai: ['owner', 'finance'], support: ['owner', 'support'],
  notices: ['owner', 'support'], versions: ['owner', 'support'], health: ['owner', 'support', 'finance'], admins: ['owner'],
};

async function requireAdmin(req: FastifyRequest, area: string): Promise<{ id: string; role: Role }> {
  const h = req.headers.authorization ?? '';
  try {
    const { payload } = await jwtVerify(h.replace('Bearer ', ''), secret(), { audience: 'admin' });
    const role = payload.role as Role;
    if (!CAN[area]?.includes(role)) throw httpError(403, 'forbidden');
    return { id: String(payload.sub), role };
  } catch (e: any) { throw e?.statusCode ? e : httpError(401, 'admin_unauthorized'); }
}

export async function bootstrapAdmin(db: Db) {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL, pw = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !pw || pw.length < 12) return;
  await db.query(`INSERT INTO admin_users(email, password_hash, role) VALUES($1,$2,'owner') ON CONFLICT (email) DO NOTHING`, [email, await bcrypt.hash(pw, 12)]);
}

export function adminRoutes(app: FastifyInstance, db: Db) {
  const page = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin', 'index.html');
  app.get('/admin', async (_req, reply) => { reply.type('text/html; charset=utf-8'); return readFileSync(page, 'utf8'); });

  app.post('/admin/api/login', async (req) => {
    const b = req.body as any;
    const r = await db.query('SELECT id, password_hash, role FROM admin_users WHERE email=$1 AND deleted_at IS NULL', [String(b?.email ?? '')]);
    if (!r.rows.length || !(await bcrypt.compare(String(b?.password ?? ''), r.rows[0].password_hash))) throw httpError(401, 'invalid_credentials');
    await db.query('UPDATE admin_users SET last_login_at=now() WHERE id=$1', [r.rows[0].id]);
    await db.query(`INSERT INTO audit_logs(actor_type, actor_id, action, ip) VALUES('admin',$1,'admin_login',$2)`, [r.rows[0].id, req.ip]);
    const token = await new SignJWT({ role: r.rows[0].role }).setProtectedHeader({ alg: 'HS256' }).setSubject(r.rows[0].id).setAudience('admin').setExpirationTime('8h').sign(secret());
    return { token, role: r.rows[0].role };
  });

  app.get('/admin/api/stats', async (req) => {
    await requireAdmin(req, 'stats');
    const q = async (sql: string, args: any[] = []) => (await db.query(sql, args)).rows;
    const [tot] = await q(`SELECT count(*)::int total, count(*) FILTER (WHERE created_at > now() - interval '1 day')::int new1d,
      count(*) FILTER (WHERE created_at > now() - interval '7 days')::int new7d FROM users WHERE deleted_at IS NULL`);
    const [act] = await q(`SELECT count(DISTINCT user_id) FILTER (WHERE last_seen_at > now() - interval '1 day')::int dau,
      count(DISTINCT user_id) FILTER (WHERE last_seen_at > now() - interval '7 days')::int wau, count(DISTINCT user_id) FILTER (WHERE last_seen_at > now() - interval '30 days')::int mau FROM user_devices`);
    const signups = await q(`SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, count(*)::int n FROM users WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`);
    const countries = await q(`SELECT COALESCE(country,'??') country, count(*)::int n FROM users WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 30`);
    const platforms = await q(`SELECT platform, count(*)::int n FROM user_devices WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`);
    return { users: tot, active: act, signups, countries, platforms };
  });

  app.get('/admin/api/users', async (req) => {
    await requireAdmin(req, 'users');
    const search = String((req.query as any).q ?? '');
    return { users: (await db.query(`SELECT u.id, u.email, u.country, u.created_at, u.storage_used_bytes, u.deleted_at,
      (SELECT count(*)::int FROM notebooks n WHERE n.user_id=u.id) notebooks, (SELECT max(last_seen_at) FROM user_devices d WHERE d.user_id=u.id) last_seen
      FROM users u WHERE ($1='' OR u.email ILIKE '%'||$1||'%') ORDER BY u.created_at DESC LIMIT 100`, [search])).rows };
  });

  app.get('/admin/api/subscriptions', async (req) => {
    await requireAdmin(req, 'subscriptions');
    return {
      plans: PLANS,
      byPlan: (await db.query(`SELECT plan, state, count(*)::int n FROM subscriptions GROUP BY 1,2 ORDER BY 1,2`)).rows,
      recent: (await db.query(`SELECT s.id, u.email, s.plan, s.store, s.state, s.current_period_end, s.created_at FROM subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT 100`)).rows,
    };
  });

  /** 수동 권한 부여/회수(고객 지원·보상용) */
  app.post('/admin/api/subscriptions/grant', async (req) => {
    const a = await requireAdmin(req, 'subscriptions');
    const b = req.body as any;
    if (!PLANS[b?.plan]) throw httpError(400, 'bad_plan');
    const u = (await db.query('SELECT id FROM users WHERE email=$1', [String(b.email ?? '')])).rows[0];
    if (!u) throw httpError(404, 'user_not_found');
    await db.query(`INSERT INTO subscriptions(user_id, plan, store, state, current_period_end) VALUES($1,$2,'web','active', now() + make_interval(days => $3))`, [u.id, b.plan, Number(b.days ?? 30)]);
    await db.query(`INSERT INTO audit_logs(actor_type, actor_id, action, target_type, target_id, detail) VALUES('admin',$1,'grant_plan','user',$2,$3)`, [a.id, u.id, JSON.stringify(b)]);
    return { ok: true };
  });

  app.get('/admin/api/payments', async (req) => {
    await requireAdmin(req, 'payments');
    return { payments: (await db.query(`SELECT p.created_at, u.email, p.store, p.product_id, p.state, p.amount_micros, p.currency FROM purchases p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200`)).rows };
  });

  app.get('/admin/api/storage', async (req) => {
    await requireAdmin(req, 'storage');
    const [s] = (await db.query(`SELECT COALESCE(sum(size),0)::bigint files_bytes, count(*)::int files FROM stored_files`)).rows;
    const [st] = (await db.query(`SELECT count(*)::int strokes FROM pen_strokes`)).rows;
    const dir = process.env.STORAGE_DIR ?? './storage'; mkdirSync(dir, { recursive: true });
    let disk: any = null; try { const f = statfsSync(dir); disk = { freeBytes: f.bavail * f.bsize, totalBytes: f.blocks * f.bsize }; } catch { }
    return { ...s, ...st, disk, top: (await db.query(`SELECT email, storage_used_bytes FROM users ORDER BY storage_used_bytes DESC LIMIT 20`)).rows };
  });

  app.get('/admin/api/sync', async (req) => {
    await requireAdmin(req, 'sync');
    return {
      ops24h: (await db.query(`SELECT count(*)::int n FROM sync_operations WHERE created_at > now() - interval '1 day'`)).rows[0].n,
      conflicts: (await db.query(`SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, entity_type, count(*)::int n FROM sync_conflicts WHERE created_at > now() - interval '14 days' GROUP BY 1,2 ORDER BY 1 DESC`)).rows,
      clientSyncErrors: (await db.query(`SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, count(*)::int n FROM app_errors WHERE kind LIKE 'sync%' AND created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1 DESC`)).rows,
    };
  });

  app.get('/admin/api/errors', async (req) => {
    await requireAdmin(req, 'errors');
    return { errors: (await db.query(`SELECT fingerprint, kind, platform, app_version, max(message) message, count(*)::int n, max(created_at) last FROM app_errors
      WHERE created_at > now() - interval '30 days' GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 100`)).rows };
  });

  app.get('/admin/api/ai', async (req) => {
    await requireAdmin(req, 'ai');
    return {
      byFeature: (await db.query(`SELECT feature, provider, count(*)::int n, sum(input_tokens)::bigint input_tokens, sum(output_tokens)::bigint output_tokens,
        (sum(cost_micro_usd)/1e6)::numeric(12,4) cost_usd, count(*) FILTER (WHERE state='failed')::int failed FROM ai_requests WHERE created_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY n DESC`)).rows,
      byDay: (await db.query(`SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, tier, count(*)::int n, (sum(cost_micro_usd)/1e6)::numeric(12,4) cost_usd FROM ai_requests
        WHERE created_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY 1 DESC`)).rows,
    };
  });

  app.get('/admin/api/support', async (req) => {
    await requireAdmin(req, 'support');
    return { tickets: (await db.query(`SELECT id, email, subject, body, app_version, platform, state, answer, created_at FROM support_tickets ORDER BY (state='open') DESC, created_at DESC LIMIT 200`)).rows };
  });
  app.post('/admin/api/support/:id/answer', async (req) => {
    const a = await requireAdmin(req, 'support');
    await db.query(`UPDATE support_tickets SET answer=$2, state='answered', answered_by=$3, updated_at=now() WHERE id=$1`, [(req.params as any).id, String((req.body as any)?.answer ?? ''), a.id]);
    return { ok: true };
  });

  app.get('/admin/api/notices', async (req) => { await requireAdmin(req, 'notices'); return { notices: (await db.query('SELECT * FROM notices WHERE deleted_at IS NULL ORDER BY created_at DESC')).rows }; });
  app.post('/admin/api/notices', async (req) => {
    const a = await requireAdmin(req, 'notices'); const b = req.body as any;
    const r = await db.query(`INSERT INTO notices(locale, title, body, published, created_by) VALUES($1,$2,$3,$4,$5) RETURNING id`, [String(b.locale ?? 'ko'), String(b.title ?? ''), String(b.body ?? ''), !!b.published, a.id]);
    return r.rows[0];
  });

  app.get('/admin/api/versions', async (req) => { await requireAdmin(req, 'versions'); return { versions: (await db.query('SELECT * FROM app_versions ORDER BY platform')).rows }; });
  app.post('/admin/api/versions', async (req) => {
    await requireAdmin(req, 'versions'); const b = req.body as any;
    await db.query(`INSERT INTO app_versions(platform, latest, min_supported, notes) VALUES($1,$2,$3,$4) ON CONFLICT (platform) DO UPDATE SET latest=EXCLUDED.latest, min_supported=EXCLUDED.min_supported, notes=EXCLUDED.notes, updated_at=now()`,
      [String(b.platform), String(b.latest), String(b.minSupported), b.notes ?? null]);
    return { ok: true };
  });

  app.get('/admin/api/health', async (req) => {
    await requireAdmin(req, 'health');
    const t = Date.now(); await db.query('SELECT 1'); const dbMs = Date.now() - t;
    return { ok: true, dbMs, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), node: process.version,
      aiConfigured: !!(process.env.AI_PROVIDER || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY), mailConfigured: !!process.env.SMTP_URL };
  });

  // ---- 앱에서 쓰는 공개/사용자 API ----
  app.get('/v1/notices', async (req) => ({ notices: (await db.query(`SELECT id, title, body, created_at FROM notices WHERE published AND deleted_at IS NULL AND locale=$1 ORDER BY created_at DESC LIMIT 20`, [String((req.query as any).locale ?? 'ko')])).rows }));
  app.get('/v1/app-version', async (req) => ({ version: (await db.query('SELECT latest, min_supported, notes FROM app_versions WHERE platform=$1', [String((req.query as any).platform ?? 'android')])).rows[0] ?? null }));
  app.post('/v1/support', async (req) => {
    const b = req.body as any;
    let userId: string | null = null; try { userId = (await requireUser(req)).userId; } catch { }
    if (!b?.subject || !b?.body) throw httpError(400, 'bad_request');
    const r = await db.query(`INSERT INTO support_tickets(user_id, email, subject, body, app_version, platform) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [userId, String(b.email ?? '').slice(0, 200), String(b.subject).slice(0, 200), String(b.body).slice(0, 10000), String(b.appVersion ?? '').slice(0, 40), String(b.platform ?? '').slice(0, 20)]);
    return r.rows[0];
  });
  /** 앱 오류·충돌 보고(개인 노트 내용은 보내지 않음: 종류·메시지·스택만) */
  app.post('/v1/errors', async (req) => {
    const b = req.body as any;
    let userId: string | null = null; try { userId = (await requireUser(req)).userId; } catch { }
    const list = Array.isArray(b?.errors) ? b.errors.slice(0, 50) : [];
    for (const e of list) {
      const msg = String(e.message ?? '').slice(0, 1000); const stack = String(e.stack ?? '').slice(0, 8000);
      const fp = (await import('node:crypto')).createHash('sha1').update(String(e.kind) + stack.split('\n').slice(0, 4).join('|')).digest('hex');
      await db.query(`INSERT INTO app_errors(user_id, platform, app_version, kind, message, stack, fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [userId, String(b.platform ?? 'android').slice(0, 20), String(b.appVersion ?? '').slice(0, 40), String(e.kind ?? 'error').slice(0, 60), msg, stack, fp]);
    }
    return { ok: true, received: list.length };
  });
}
