/** 인증·세션·CSRF·2단계 인증 — 실제 PostgreSQL */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import { generate } from 'otplib';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { Agent, agentFor, PW, setupWorld, testDb, World } from './helpers';
import { userSessions } from '../src/db/schema';
import { sha256 } from '../src/common/crypto';

let w: World;
beforeAll(async () => {
  w = await setupWorld();
});
afterAll(async () => {
  await w.app.close();
});

describe('로그인', () => {
  it('정상 로그인 시 HttpOnly·SameSite=Strict 세션 쿠키를 받고, DB에는 토큰 해시만 저장된다', async () => {
    const ag = new Agent(w.app);
    const res = await ag.login('a.admin');
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie']);
    const sid = cookies.find((c) => c.startsWith('erp_sid='))!;
    expect(sid).toMatch(/HttpOnly/);
    expect(sid).toMatch(/SameSite=Strict/);
    const token = sid.split(';')[0].split('=')[1];
    const { pool, db } = testDb();
    const rows = await db.select().from(userSessions).where(eq(userSessions.tokenHash, sha256(token)));
    expect(rows).toHaveLength(1);
    const raw = await db.select().from(userSessions).where(eq(userSessions.tokenHash, token));
    expect(raw).toHaveLength(0);
    await pool.end();
  });

  it('없는 아이디와 틀린 비밀번호는 같은 메시지 (계정 존재 여부 비노출)', async () => {
    const a = await new Agent(w.app).login('nobody', PW);
    const b = await new Agent(w.app).login('a.ceo', 'Wrong!pass2026');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('5회 연속 실패하면 잠기고, 맞는 비밀번호도 거부된다', async () => {
    for (let i = 0; i < 5; i++) await new Agent(w.app).login('a.staff', 'Wrong!pass2026');
    const res = await new Agent(w.app).login('a.staff');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('LOCKED');
  });

  it('관리자가 잠금을 풀면 다시 로그인된다', async () => {
    const admin = await agentFor(w, 'a.admin', w.A.id);
    expect((await admin.post(`/users/${w.ids['a.staff'].membershipId}/unlock`)).status).toBe(200);
    expect((await new Agent(w.app).login('a.staff')).status).toBe(200);
  });
});

describe('세션·CSRF', () => {
  it('로그인 없이 업무 API 접근 불가', async () => {
    const res = await request(w.app.getHttpServer()).get('/api/v1/projects').set('x-company-id', w.A.id);
    expect(res.status).toBe(401);
  });

  it('CSRF 토큰 없는 상태 변경 요청은 거부', async () => {
    const ag = await agentFor(w, 'a.admin', w.A.id);
    const res = await ag.post('/projects', { name: '테스트', tradeType: 'ELECTRIC', supplyAmount: '100' }, { csrf: false });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF');
  });

  it('로그아웃하면 같은 쿠키로 더 이상 접근할 수 없다', async () => {
    const ag = await agentFor(w, 'a.ceo', w.A.id);
    expect((await ag.get('/auth/me')).status).toBe(200);
    const saved = [...ag.cookies];
    await ag.post('/auth/logout');
    ag.cookies = saved;
    expect((await ag.get('/auth/me')).status).toBe(401);
  });

  it('비밀번호 변경 필요 계정은 업무 API를 쓸 수 없고, 변경 후 가능', async () => {
    const ag = await agentFor(w, 'a.newbie', w.A.id);
    const blocked = await ag.get('/dashboard');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const weak = await ag.post('/auth/password', { currentPassword: PW, newPassword: 'weak' });
    expect(weak.status).toBe(400);
    expect((await ag.post('/auth/password', { currentPassword: PW, newPassword: 'Newbie!pass2027' })).status).toBe(200);
    expect((await ag.get('/dashboard')).status).toBe(200);
  });
});

describe('2단계 인증 (TOTP)', () => {
  it('설정 → 활성화 → 로그인 시 OTP 요구 → 올바른 OTP로 완료', async () => {
    const ag = await agentFor(w, 'a.acct', w.A.id);
    const setup = await ag.post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    expect((await ag.post('/auth/mfa/enable', { code: '000000' })).status).toBe(400);
    expect((await ag.post('/auth/mfa/enable', { code: await generate({ secret }) })).status).toBe(200);

    const ag2 = new Agent(w.app);
    const r = await ag2.login('a.acct');
    expect(r.body.mfaRequired).toBe(true);
    ag2.companyId = w.A.id;
    const pending = await ag2.get('/dashboard');
    expect(pending.status).toBe(401);
    expect(pending.body.code).toBe('MFA_REQUIRED');
    expect((await ag2.post('/auth/mfa/verify', { code: '123456' })).status).toBe(401);
    expect((await ag2.post('/auth/mfa/verify', { code: await generate({ secret }) })).status).toBe(200);
    expect((await ag2.get('/dashboard')).status).toBe(200);
  });
});
