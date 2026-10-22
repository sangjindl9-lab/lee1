import './env';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDb } from '../src/db/db';
import { runMigrations } from '../src/db/migrate';
import { companies, licenseState, memberships, membershipRoles, projectAssignments, roles, users } from '../src/db/schema';
import { createPrivateKey, sign } from 'crypto';
import fs from 'fs';
import path from 'path';
import { seedDefaultRoles } from '../src/admin/companies';
import { seedBase } from '../src/db/seed';
import { hashPassword } from '../src/auth/password';

export const PW = 'Test!pass2026';

/** 판매자 키로 서명한 테스트 라이선스 (실제 발급기와 같은 형식) */
export function signLicense(payload: object) {
  const key = createPrivateKey(fs.readFileSync(path.resolve(process.cwd(), '../../tools/license/keys/vendor-private.pem')));
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`;
}

export async function resetDb() {
  const { pool, db } = createDb(process.env.DATABASE_URL!);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await pool.end();
  await runMigrations(process.env.DATABASE_URL!);
}

export const testDb = () => createDb(process.env.DATABASE_URL!);

/** 쿠키·CSRF·회사 헤더를 유지하는 사용자 세션 */
export class Agent {
  cookies: string[] = [];
  csrf = '';
  companyId: string | null = null;
  constructor(private app: INestApplication) {}

  private absorb(res: request.Response) {
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    for (const c of set) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      this.cookies = this.cookies.filter((x) => !x.startsWith(name + '='));
      if (value) this.cookies.push(pair);
      if (name === 'erp_csrf') this.csrf = decodeURIComponent(value);
    }
    return res;
  }

  async login(loginId: string, password = PW) {
    const res = await request(this.app.getHttpServer()).post('/api/v1/auth/login').send({ loginId, password });
    return this.absorb(res);
  }

  req(method: 'get' | 'post' | 'put' | 'delete', path: string, opts: { csrf?: boolean; company?: string | null } = {}) {
    let r = request(this.app.getHttpServer())[method]('/api/v1' + path).set('Cookie', this.cookies.join('; '));
    if (opts.csrf !== false && method !== 'get') r = r.set('x-csrf-token', this.csrf);
    const cid = opts.company === undefined ? this.companyId : opts.company;
    if (cid) r = r.set('x-company-id', cid);
    return r;
  }
  get = (p: string, o?: { company?: string | null }) => this.req('get', p, o).then((r) => this.absorb(r));
  post = (p: string, body?: object, o?: { csrf?: boolean; company?: string | null }) => this.req('post', p, o).send(body ?? {}).then((r) => this.absorb(r));
  put = (p: string, body?: object, o?: { company?: string | null }) => this.req('put', p, o).send(body ?? {}).then((r) => this.absorb(r));
  del = (p: string, o?: { company?: string | null }) => this.req('delete', p, o).then((r) => this.absorb(r));
}

export interface World {
  app: INestApplication;
  A: { id: string };
  B: { id: string };
  ids: Record<string, { userId: string; membershipId: string }>;
}

/** 회사 A(에스에스전력)·B(한누리통신)와 역할별 사용자 준비 */
export async function setupWorld(): Promise<World> {
  await resetDb();
  const { pool, db } = testDb();
  const ids: World['ids'] = {};
  const hash = await hashPassword(PW);
  const [A, B] = await db.transaction(async (tx) => {
    await seedBase(tx);
    await tx.insert(licenseState).values({ id: 1, licenseText: signLicense({ licenseId: 'test', licensee: '테스트', bizRegNo: '1018117536', maxUsers: 100, issuedAt: '2026-10-01', expiresAt: '2099-12-31', modules: ['all'] }) });
    const [a] = await tx.insert(companies).values({ code: 'SS', name: '에스에스전력', bizRegNo: '1018117536' }).returning();
    const [b] = await tx.insert(companies).values({ code: 'HN', name: '한누리통신', bizRegNo: '2148839612' }).returning();
    await seedDefaultRoles(tx, a.id);
    await seedDefaultRoles(tx, b.id);
    const mk = async (loginId: string, companyId: string, roleKey: string, extra: Partial<typeof users.$inferInsert> = {}) => {
      const [u] = await tx.insert(users).values({ loginId, name: loginId, passwordHash: hash, ...extra }).returning();
      const [m] = await tx.insert(memberships).values({ companyId, userId: u.id }).returning();
      const [r] = await tx.select().from(roles).where(eq(roles.companyId, companyId)).then((rs) => rs.filter((x) => x.key === roleKey));
      await tx.insert(membershipRoles).values({ membershipId: m.id, roleId: r.id });
      ids[loginId] = { userId: u.id, membershipId: m.id };
    };
    await mk('a.admin', a.id, 'ADMIN');
    await mk('a.ceo', a.id, 'CEO');
    await mk('a.acct', a.id, 'ACCOUNTING_MANAGER');
    await mk('a.buyer', a.id, 'PURCHASER');
    await mk('a.site', a.id, 'SITE_MANAGER');
    await mk('a.site2', a.id, 'SITE_MANAGER');
    await mk('a.tax', a.id, 'TAX_ACCOUNTANT');
    await mk('a.staff', a.id, 'STAFF');
    await mk('a.newbie', a.id, 'STAFF', { mustChangePassword: true });
    await mk('b.admin', b.id, 'ADMIN');
    return [a, b];
  });
  await pool.end();
  const app = await createApp();
  await app.init();
  return { app, A, B, ids };
}

export async function agentFor(w: World, loginId: string, companyId: string) {
  const ag = new Agent(w.app);
  const res = await ag.login(loginId);
  if (res.status !== 200) throw new Error(`login ${loginId} failed: ${res.status} ${JSON.stringify(res.body)}`);
  ag.companyId = companyId;
  return ag;
}

export async function assign(membershipId: string, projectId: string) {
  const { pool, db } = testDb();
  await db.insert(projectAssignments).values({ membershipId, projectId });
  await pool.end();
}
