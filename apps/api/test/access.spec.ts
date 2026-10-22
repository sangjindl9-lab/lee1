/** [필수11] 회사·현장 간 데이터 격리, 기능 권한, 권한 상승 방지 */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import { Agent, agentFor, assign, setupWorld, World } from './helpers';

let w: World;
let pA1: string, pA2: string, pB1: string;

beforeAll(async () => {
  w = await setupWorld();
  const a = await agentFor(w, 'a.admin', w.A.id);
  pA1 = (await a.post('/projects', { name: 'A 현장1 전기', tradeType: 'ELECTRIC', supplyAmount: '100000000', status: 'IN_PROGRESS' })).body.id;
  pA2 = (await a.post('/projects', { name: 'A 현장2 통신', tradeType: 'TELECOM', supplyAmount: '50000000' })).body.id;
  const b = await agentFor(w, 'b.admin', w.B.id);
  pB1 = (await b.post('/projects', { name: 'B 비공개 현장', tradeType: 'TELECOM', supplyAmount: '900000000' })).body.id;
  await assign(w.ids['a.site'].membershipId, pA1);
});
afterAll(async () => {
  await w.app.close();
});

describe('회사 간 격리', () => {
  it('A 회사 사용자는 B 회사 현장을 ID로도 볼 수 없다 (존재 여부도 숨김: 404)', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    expect((await a.get(`/projects/${pB1}`)).status).toBe(404);
    const list = await a.get('/projects');
    expect(list.body.rows.map((r: any) => r.id)).not.toContain(pB1);
  });

  it('소속되지 않은 회사 헤더로 요청하면 404', async () => {
    const a = await agentFor(w, 'a.ceo', w.A.id);
    const res = await a.get('/projects', { company: w.B.id });
    expect(res.status).toBe(404);
  });

  it('B 회사 현장을 A 회사 컨텍스트로 수정·삭제할 수 없다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    expect((await a.put(`/projects/${pB1}`, { name: '탈취', tradeType: 'TELECOM', supplyAmount: '1', version: 1 })).status).toBe(404);
    expect((await a.del(`/projects/${pB1}?version=1`)).status).toBe(404);
  });

  it('대시보드 집계에 다른 회사 금액이 섞이지 않는다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const d = (await a.get('/dashboard')).body;
    expect(d.contract.all.supply).toBe('150000000.00');
  });

  it('다른 회사 첨부파일을 내려받을 수 없다', async () => {
    const b = await agentFor(w, 'b.admin', w.B.id);
    const up = await b.req('post', '/files').field('projectId', pB1).field('category', 'contract').attach('file', Buffer.from('%PDF-1.4\n%test\n'), 'b.pdf');
    expect(up.status).toBe(201);
    const a = await agentFor(w, 'a.admin', w.A.id);
    expect((await a.get(`/files/${up.body.id}/download`)).status).toBe(404);
  });
});

describe('현장 범위 (배정 현장만)', () => {
  it('현장소장은 배정된 현장만 목록·상세·선택기·대시보드에서 본다', async () => {
    const s = await agentFor(w, 'a.site', w.A.id);
    const list = await s.get('/projects');
    expect(list.body.rows.map((r: any) => r.id)).toEqual([pA1]);
    expect((await s.get(`/projects/${pA2}`)).status).toBe(404);
    expect((await s.get('/projects/options')).body.map((r: any) => r.id)).toEqual([pA1]);
    expect((await s.get('/dashboard')).body.contract.all.supply).toBe('100000000.00');
  });

  it('배정이 하나도 없는 현장소장은 아무 현장도 보지 못한다', async () => {
    const s = await agentFor(w, 'a.site2', w.A.id);
    expect((await s.get('/projects')).body.total).toBe(0);
  });

  it('현장소장은 현장 등록 권한이 없다 (403)', async () => {
    const s = await agentFor(w, 'a.site', w.A.id);
    expect((await s.post('/projects', { name: '무단 등록', tradeType: 'ELECTRIC', supplyAmount: '1' })).status).toBe(403);
  });
});

describe('기능 권한', () => {
  it('외부 세무담당자는 현장 메뉴 자체에 접근할 수 없다', async () => {
    const t = await agentFor(w, 'a.tax', w.A.id);
    expect((await t.get('/projects')).status).toBe(403);
    expect((await t.get('/users')).status).toBe(403);
  });
  it('대표이사는 조회는 되지만 수정은 안 된다', async () => {
    const c = await agentFor(w, 'a.ceo', w.A.id);
    const got = await c.get(`/projects/${pA1}`);
    expect(got.status).toBe(200);
    expect((await c.put(`/projects/${pA1}`, { name: 'x', tradeType: 'ELECTRIC', supplyAmount: '1', version: got.body.version })).status).toBe(403);
  });
  it('구매담당자는 거래처를 등록할 수 있지만 사용자 관리는 못 한다', async () => {
    const b = await agentFor(w, 'a.buyer', w.A.id);
    expect((await b.post('/vendors', { name: '권한테스트 상사' })).status).toBe(201);
    expect((await b.get('/users')).status).toBe(403);
  });
});

describe('권한 상승 방지', () => {
  it('사용자 관리 권한만 있는 역할은 본인보다 넓은 역할(최고관리자)을 줄 수 없다', async () => {
    const admin = await agentFor(w, 'a.admin', w.A.id);
    const roles = (await admin.get('/roles')).body;
    const hr = (await admin.post('/roles', { name: '인사담당', scope: 'COMPANY', permissions: ['user:read', 'user:create', 'user:update', 'role:read', 'dashboard:read'] })).body;
    const staffRole = roles.find((r: any) => r.key === 'STAFF');
    const adminRole = roles.find((r: any) => r.key === 'ADMIN');
    const created = await admin.post('/users', { loginId: 'a.hr', name: '인사', roleIds: [hr.id], tempPassword: 'Hr!pass20261' });
    expect(created.status).toBe(201);
    // 첫 로그인 → 비밀번호 변경
    const ag = new Agent(w.app);
    await ag.login('a.hr', 'Hr!pass20261');
    ag.companyId = w.A.id;
    await ag.post('/auth/password', { currentPassword: 'Hr!pass20261', newPassword: 'Hr!changed2026' });
    const esc = await ag.post('/users', { loginId: 'a.evil', name: '권한상승', roleIds: [adminRole.id], tempPassword: 'Evil!pass2026' });
    expect(esc.status).toBe(403);
    expect(esc.body.code).toBe('ROLE_ESCALATION');
    // 본인 권한 이내 역할(일반직원)은 가능... 단 일반직원 역할의 project:read 는 인사담당에 없으므로 역시 거부
    const esc2 = await ag.post('/users', { loginId: 'a.evil2', name: 'x', roleIds: [staffRole.id], tempPassword: 'Evil!pass2026' });
    expect(esc2.status).toBe(403);
    // 역할 권한을 스스로 늘리는 것도 불가 (role:update 없음)
    expect((await ag.put(`/roles/${hr.id}`, { name: '인사담당', scope: 'COMPANY', permissions: ['user:read', 'journal:approve'], version: 1 })).status).toBe(403);
  });

  it('최고관리자가 마지막 1명일 때 스스로 관리자 역할을 뺄 수 없다', async () => {
    const admin = await agentFor(w, 'a.admin', w.A.id);
    const roles = (await admin.get('/roles')).body;
    const staff = roles.find((r: any) => r.key === 'STAFF');
    const res = await admin.put(`/users/${w.ids['a.admin'].membershipId}`, { name: 'a.admin', roleIds: [staff.id], projectIds: [], isActive: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_ADMIN');
  });

  it('최고관리자 역할에서 권한 관리 권한을 뺄 수 없다 (관리 불능 방지)', async () => {
    const admin = await agentFor(w, 'a.admin', w.A.id);
    const r = (await admin.get('/roles')).body.find((x: any) => x.key === 'ADMIN');
    const res = await admin.put(`/roles/${r.id}`, { name: r.name, scope: 'COMPANY', permissions: r.permissions.filter((p: string) => p !== 'role:update'), version: r.version });
    expect(res.status).toBe(400);
  });
});
