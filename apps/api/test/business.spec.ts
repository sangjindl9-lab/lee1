/** 현장·거래처 업무 규칙, 감사로그, 파일, 엑셀, 라이선스 — 실제 PostgreSQL */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { createPrivateKey, generateKeyPairSync, sign } from 'crypto';
import fs from 'fs';
import path from 'path';
import { agentFor, setupWorld, testDb, World } from './helpers';

let w: World;
beforeAll(async () => {
  w = await setupWorld();
});
afterAll(async () => {
  await w.app.close();
});

describe('현장 등록 — 서버 측 금액 계산', () => {
  it('부가세·합계는 서버가 계산하고, 화면이 보낸 합계는 무시된다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const res = await a.post('/projects', { name: '부가세 계산 현장', tradeType: 'ELECTRIC', supplyAmount: '123,456,789', totalAmount: '1', executionBudget: '100000000' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ supplyAmount: '123456789.00', vatAmount: '12345678.00', totalAmount: '135802467.00', vatRate: '0.1000', plannedMargin: '23456789.00' });
    expect(res.body.code).toMatch(/^P\d{2}-\d{4}$/);
  });

  it('부가세를 직접 입력하면 ±10원 단수차이까지만 허용', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    expect((await a.post('/projects', { name: '단수차이 허용', tradeType: 'ELECTRIC', supplyAmount: '1000000', vatAmount: '99995' })).status).toBe(201);
    const bad = await a.post('/projects', { name: '단수차이 초과', tradeType: 'ELECTRIC', supplyAmount: '1000000', vatAmount: '90000' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VAT_MISMATCH');
  });

  it('입력값 검증: 날짜 순서, 공동도급 지분율, 음수 금액', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const r1 = await a.post('/projects', { name: '날짜오류', tradeType: 'ELECTRIC', supplyAmount: '1', startDate: '2026-05-01', plannedEndDate: '2026-04-01' });
    expect(r1.status).toBe(400);
    expect(r1.body.fields.map((f: any) => f.field)).toContain('plannedEndDate');
    expect((await a.post('/projects', { name: '공동도급', tradeType: 'ELECTRIC', supplyAmount: '1', contractRole: 'JOINT' })).status).toBe(400);
    expect((await a.post('/projects', { name: '음수', tradeType: 'ELECTRIC', supplyAmount: '-5' })).status).toBe(400);
  });

  it('DB 제약: 계약총액 ≠ 공급가액+부가세 인 행은 데이터베이스가 직접 거부', async () => {
    const { pool, db } = testDb();
    await expect(
      db.execute(sql`insert into project (company_id, code, name, trade_type, supply_amount, vat_amount, total_amount, vat_rate) values (${w.A.id}, 'X-1', 'x', 'ELECTRIC', 100, 10, 999, 0.1)`),
    ).rejects.toThrow();
    await pool.end();
  });

  it('[필수10] 20명이 동시에 등록해도 공사관리번호가 중복되지 않는다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => a.post('/projects', { name: `동시등록 ${i}`, tradeType: 'TELECOM', supplyAmount: '1000' })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const codes = results.map((r) => r.body.code);
    expect(new Set(codes).size).toBe(20);
  });

  it('[필수10] 두 사람이 같은 버전을 동시에 수정하면 한 명만 성공 (나중 사람은 409)', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const p = (await a.post('/projects', { name: '동시수정', tradeType: 'ELECTRIC', supplyAmount: '1000' })).body;
    const body = (name: string) => ({ name, tradeType: 'ELECTRIC', supplyAmount: '1000', version: p.version });
    const [r1, r2] = await Promise.all([a.put(`/projects/${p.id}`, body('수정A')), a.put(`/projects/${p.id}`, body('수정B'))]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.code).toBe('STALE_VERSION');
  });

  it('진행 중 현장은 삭제할 수 없고, 예정 현장은 소프트 삭제 후 목록에서 빠진다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const live = (await a.post('/projects', { name: '진행현장', tradeType: 'ELECTRIC', supplyAmount: '1', status: 'IN_PROGRESS' })).body;
    expect((await a.del(`/projects/${live.id}?version=${live.version}`)).status).toBe(409);
    const plan = (await a.post('/projects', { name: '예정현장 삭제', tradeType: 'ELECTRIC', supplyAmount: '1' })).body;
    expect((await a.del(`/projects/${plan.id}?version=${plan.version}`)).status).toBe(204);
    expect((await a.get(`/projects/${plan.id}`)).status).toBe(404);
    const { pool, db } = testDb();
    const row = await db.execute(sql`select deleted_at from project where id = ${plan.id}`);
    expect(row.rows[0].deleted_at).not.toBeNull(); // 데이터는 보존
    await pool.end();
  });
});

describe('거래처', () => {
  it('사업자등록번호 체크섬 오류 거부, 같은 회사 내 중복 거부', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    expect((await a.post('/vendors', { name: '잘못된번호', bizRegNo: '123-45-67890' })).status).toBe(400);
    expect((await a.post('/vendors', { name: '정상', bizRegNo: '116-81-19948' })).status).toBe(201);
    const dup = await a.post('/vendors', { name: '중복', bizRegNo: '1168119948' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_BIZNO');
    // 다른 회사는 같은 거래처를 따로 등록할 수 있다
    const b = await agentFor(w, 'b.admin', w.B.id);
    expect((await b.post('/vendors', { name: 'B쪽 등록', bizRegNo: '1168119948' })).status).toBe(201);
  });

  it('계좌번호는 DB에 암호화 저장, 응답에는 마스킹만, 원문 조회는 감사로그에 기록', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const v = (await a.post('/vendors', { name: '계좌업체', bankName: '국민은행', bankAccount: '123-456-789012' })).body;
    expect(v.bankAccountMask).toBe('123-******-012');
    expect(JSON.stringify(v)).not.toContain('456-789012');
    expect(v).not.toHaveProperty('bankAccountEnc');
    const { pool, db } = testDb();
    const raw = await db.execute(sql`select bank_account_enc from vendor where id = ${v.id}`);
    expect(String(raw.rows[0].bank_account_enc)).not.toContain('789012');
    const reveal = await a.post(`/vendors/${v.id}/reveal-account`);
    expect(reveal.body.bankAccount).toBe('123-456-789012');
    const log = await db.execute(sql`select action from audit_log where resource_id = ${v.id} and action = 'VIEW_SENSITIVE'`);
    expect(log.rows).toHaveLength(1);
    await pool.end();
    // 조회 권한만 있는 사람은 원문을 볼 수 없다
    const ceo = await agentFor(w, 'a.ceo', w.A.id);
    expect((await ceo.post(`/vendors/${v.id}/reveal-account`)).status).toBe(403);
  });
});

describe('감사로그 — 수정·삭제 불가, 변조 감지', () => {
  it('변경 이력에 변경 전·후 값이 남고 비밀번호 등은 기록되지 않는다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const p = (await a.post('/projects', { name: '이력확인', tradeType: 'ELECTRIC', supplyAmount: '1000' })).body;
    await a.put(`/projects/${p.id}`, { name: '이력확인-수정', tradeType: 'ELECTRIC', supplyAmount: '2000', version: p.version });
    const logs = (await a.get(`/audit-logs?resourceId=${p.id}`)).body.rows;
    const upd = logs.find((l: any) => l.action === 'UPDATE');
    expect(upd.before.name).toBe('이력확인');
    expect(upd.after.name).toBe('이력확인-수정');
    expect(upd.after.supplyAmount).toBe('2000.00');
    const { pool, db } = testDb();
    const all = await db.execute(sql`select before::text || after::text as t from audit_log where before is not null or after is not null`);
    expect(all.rows.some((r: any) => /\$argon2/.test(r.t))).toBe(false);
    await pool.end();
  });

  it('감사로그 UPDATE·DELETE·TRUNCATE 는 데이터베이스가 거부한다', async () => {
    const { pool, db } = testDb();
    await expect(db.execute(sql`update audit_log set summary = '조작' where id = (select min(id) from audit_log)`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/수정하거나 삭제할 수 없습니다/) } });
    await expect(db.execute(sql`delete from audit_log`)).rejects.toThrow();
    await expect(db.execute(sql`truncate audit_log`)).rejects.toThrow();
    await pool.end();
  });

  it('해시 체인 검증: 정상이면 통과, 트리거를 끄고 몰래 고치면 검사에서 드러난다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const ok = await a.post('/audit-logs/verify');
    expect(ok.body.ok).toBe(true);
    expect(ok.body.checked).toBeGreaterThan(10);
    const { pool, db } = testDb();
    await db.execute(sql`alter table audit_log disable trigger audit_log_no_update`);
    await db.execute(sql`update audit_log set summary = '몰래 수정' where id = (select min(id) + 3 from audit_log)`);
    await db.execute(sql`alter table audit_log enable trigger audit_log_no_update`);
    await pool.end();
    const bad = await a.post('/audit-logs/verify');
    expect(bad.body.ok).toBe(false);
    expect(bad.body.brokenAt).toBeGreaterThan(0);
  });
});

describe('파일 첨부 — 업로드 검증', () => {
  let projectId: string;
  beforeAll(async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    projectId = (await a.post('/projects', { name: '첨부 현장', tradeType: 'ELECTRIC', supplyAmount: '1' })).body.id;
  });
  it('PDF 업로드·내려받기, 내용 해시 보관', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const up = await a.req('post', '/files').field('projectId', projectId).field('category', 'contract').attach('file', pdf, '계약서.pdf');
    expect(up.status).toBe(201);
    expect(up.body.sha256).toHaveLength(64);
    expect(up.body).not.toHaveProperty('storageKey');
    const dl = await a.req('get', `/files/${up.body.id}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body, pdf)).toBe(0);
    expect(dl.headers['content-disposition']).toContain(encodeURIComponent('계약서.pdf'));
  });
  it('확장자를 PDF로 바꾼 실행파일은 서명 검사로 차단', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);
    const up = await a.req('post', '/files').field('projectId', projectId).attach('file', exe, 'invoice.pdf');
    expect(up.status).toBe(400);
    expect(up.body.code).toBe('FILE_SIGNATURE');
    const sh = await a.req('post', '/files').field('projectId', projectId).attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), 'run.sh');
    expect(sh.status).toBe(400);
    expect(sh.body.code).toBe('FILE_TYPE');
  });
  it('조회 권한만 있는 사용자는 첨부를 올릴 수 없다', async () => {
    const c = await agentFor(w, 'a.ceo', w.A.id);
    const up = await c.req('post', '/files').field('projectId', projectId).attach('file', Buffer.from('%PDF-1.4\n'), 'a.pdf');
    expect(up.status).toBe(403);
  });
});

describe('[필수14] 엑셀 출력 — 실제 숫자 셀과 합계 수식', () => {
  it('현장 목록 엑셀: 금액은 숫자 셀, 합계행은 SUM 수식', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const res = await a.req('get', '/projects/export.xlsx').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('현장목록')!;
    const header = ws.getRow(3).values as unknown[];
    const supplyCol = header.indexOf('공급가액');
    expect(supplyCol).toBeGreaterThan(0);
    expect(typeof ws.getRow(4).getCell(supplyCol).value).toBe('number');
    const last = ws.rowCount;
    expect(String((ws.getRow(last).getCell(supplyCol).value as any).formula)).toMatch(/^SUM\(/);
  });
});

describe('라이선스 — 서명 검증', () => {
  const key = createPrivateKey(fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/test-license-private.pem')));
  const make = (payload: object, k = key) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${sign(null, Buffer.from(body), k).toString('base64url')}`;
  };
  const base = { licenseId: 't1', licensee: '에스에스전력', bizRegNo: '1018117536', maxUsers: 30, issuedAt: '2026-10-01', modules: ['all'] };

  it('판매자 키로 서명한 라이선스만 등록된다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const fake = make({ ...base, expiresAt: '2099-12-31' }, generateKeyPairSync('ed25519').privateKey);
    expect((await a.post('/license', { license: fake })).status).toBe(400);
    const tampered = make({ ...base, expiresAt: '2027-12-31' }).replace(/^[^.]+/, Buffer.from(JSON.stringify({ ...base, maxUsers: 9999, expiresAt: '2099-12-31' })).toString('base64url'));
    expect((await a.post('/license', { license: tampered })).status).toBe(400);
    const good = await a.post('/license', { license: make({ ...base, expiresAt: '2027-12-31' }) });
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ mode: 'LICENSED', maxUsers: 30, licensee: '에스에스전력' });
  });

  it('만료된 라이선스는 조회만 허용한다 (자료는 잠그지 않음)', async () => {
    process.env.LICENSE_ENFORCE = 'true';
    const a = await agentFor(w, 'a.admin', w.A.id);
    await a.post('/license', { license: make({ ...base, expiresAt: '2020-01-01' }) });
    // 상태 캐시(1분)를 비우기 위해 상태를 강제로 다시 읽는다
    await a.get('/license');
    expect((await a.get('/projects')).status).toBe(200);
    const blocked = await a.post('/projects', { name: '만료 후 등록', tradeType: 'ELECTRIC', supplyAmount: '1' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('LICENSE_READONLY');
    // 갱신하면 즉시 풀린다
    await a.post('/license', { license: make({ ...base, expiresAt: '2030-01-01' }) });
    expect((await a.post('/projects', { name: '갱신 후 등록', tradeType: 'ELECTRIC', supplyAmount: '1' })).status).toBe(201);
    delete process.env.LICENSE_ENFORCE;
  });

  it('다른 회사(사업자번호) 라이선스는 등록되지 않는다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const other = await a.post('/license', { license: make({ ...base, licensee: '남의회사', bizRegNo: '1208147521', expiresAt: '2099-12-31' }) });
    expect(other.status).toBe(400);
    expect(String(other.body.message)).toMatch(/전용입니다/);
    // 이 서버에 있는 회사(B: 한누리통신) 사업자번호면 등록된다
    expect((await a.post('/license', { license: make({ ...base, bizRegNo: '2148839612', expiresAt: '2030-01-01' }) })).status).toBe(200);
  });

  it('만료 30일 이내면 갱신 안내 상태가 된다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    const soon = new Date(Date.now() + 10 * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
    const r = await a.post('/license', { license: make({ ...base, expiresAt: soon }) });
    expect(r.status).toBe(200);
    expect(r.body.renewSoon).toBe(true);
    expect(r.body.writable).toBe(true);
  });

  it('발급 서버에 설치 코드로 연결하면 새 라이선스를 받고, 중지(만료일 지난 재발급)도 반영된다', async () => {
    const http = await import('http');
    const { config } = await import('../src/config');
    let served = make({ ...base, licenseId: 'online-1', issuedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2031-12-31', maxUsers: 40 });
    let lastBody: any = null;
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        lastBody = JSON.parse(raw || '{}');
        res.setHeader('content-type', 'application/json');
        if (lastBody.code !== 'SS-TEST-CODE-1') {
          res.statusCode = 404;
          return res.end(JSON.stringify({ message: '설치 코드를 찾을 수 없습니다' }));
        }
        res.end(JSON.stringify({ license: served }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as any).port;
    const prev = config.LICENSE_SERVER_URL;
    (config as any).LICENSE_SERVER_URL = `http://127.0.0.1:${port}`;
    try {
      const a = await agentFor(w, 'a.admin', w.A.id);
      expect((await a.post('/license/connect', { code: 'WRONG-CODE-99' })).status).toBe(400);
      const ok = await a.post('/license/connect', { code: 'ss-test-code-1' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ mode: 'LICENSED', maxUsers: 40, expiresAt: '2031-12-31' });
      expect(lastBody.bizRegNos).toContain('1018117536');
      expect(typeof lastBody.activeUsers).toBe('number');
      // 공급사가 사용 중지 → 만료일이 지난 라이선스를 더 늦게 발급
      served = make({ ...base, licenseId: 'online-1', issuedAt: '2026-10-21T00:00:00.000Z', expiresAt: '2026-01-01', maxUsers: 40 });
      const s2 = await a.post('/license/sync', {});
      expect(s2.status).toBe(200);
      expect(s2.body.mode).toBe('EXPIRED');
      // 더 예전에 발급된 라이선스는 받지 않는다
      served = make({ ...base, licenseId: 'online-0', issuedAt: '2025-01-01T00:00:00.000Z', expiresAt: '2099-12-31', maxUsers: 999 });
      const s3 = await a.post('/license/sync', {});
      expect(s3.body.mode).toBe('EXPIRED');
    } finally {
      (config as any).LICENSE_SERVER_URL = prev;
      srv.close();
    }
  });

  it('라이선스 사용자 수를 넘으면 사용자를 추가할 수 없다', async () => {
    const a = await agentFor(w, 'a.admin', w.A.id);
    await a.post('/license', { license: make({ ...base, maxUsers: 3, expiresAt: '2030-01-01' }) });
    const roles = (await a.get('/roles')).body;
    const res = await a.post('/users', { loginId: 'a.over', name: '초과', roleIds: [roles.find((r: any) => r.key === 'STAFF').id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SEAT_LIMIT');
  });
});
