/** 5단계: 통장 거래 대사 · 자금일보 · API 키 · 웹훅 · 보고서 출력(필수 #14) · 백업 */
process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
import { afterAll, beforeAll, describe, expect, it } from './shim';
import http from 'http';
import { createHmac } from 'crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { Agent, agentFor, setupWorld, testDb, World } from './helpers';
import { WebhooksService } from '../src/platform/webhooks';

let w: World;
let admin: Agent, acct: Agent, staff: Agent, other: Agent;
let bankId: string;
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const acc: Record<string, string> = {};

async function bankXlsx(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('거래내역');
  ws.addRow(['국민은행 거래내역조회']);
  ws.addRow([]);
  ws.addRow(['거래일시', '적요', '보낸분/받는분', '출금액(원)', '입금액(원)', '잔액(원)', '거래점']);
  for (const r of rows) ws.addRow(r);
  ws.addRow(['합계', '', '', '', '', '', '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const http0 = () => request(w.app.getHttpServer());

beforeAll(async () => {
  w = await setupWorld();
  admin = await agentFor(w, 'a.admin', w.A.id);
  acct = await agentFor(w, 'a.acct', w.A.id);
  staff = await agentFor(w, 'a.staff', w.A.id);
  other = await agentFor(w, 'b.admin', w.B.id);
  bankId = (await acct.post('/bank-accounts', { kind: 'BANK', name: '운영계좌', bankName: '국민은행', accountNo: '123-456-789', openingBalance: '10000000', openingDate: today })).body.id;
  for (const a of (await acct.get('/accounts')).body) acc[a.code] = a.id;
});
afterAll(async () => {
  await w.app.close();
});

describe('통장 거래내역 업로드 — 중복 제외', () => {
  let buf: Buffer;
  it('미리보기 → 저장 → 같은 파일 다시 올려도 중복 0건', async () => {
    buf = await bankXlsx([
      [`${today} 09:10:00`, '이체', '서울교육청', '', '5,000,000', '15,000,000', '본점'],
      [`${today} 10:00:00`, '수수료', '', '500', '', '14,999,500', '본점'],
      [`${today} 10:00:00`, '수수료', '', '500', '', '14,999,000', '본점'],
      [`${today} 11:30:00`, '이자', '', '', '1,234', '15,000,234', '본점'],
    ]);
    const dry = await acct.req('post', `/bank-transactions/import?bankAccountId=${bankId}&dryRun=true`).attach('file', buf, '거래내역.xlsx');
    expect(dry.status).toBe(200);
    expect(dry.body.summary.total).toBe(4);
    expect(dry.body.summary.fresh).toBe(4);
    expect(dry.body.summary.in).toBe('5001234.00');
    expect(dry.body.summary.out).toBe('1000.00');
    const first = await acct.req('post', `/bank-transactions/import?bankAccountId=${bankId}&dryRun=false`).attach('file', buf, '거래내역.xlsx');
    expect(first.body.inserted).toBe(4);
    const again = await acct.req('post', `/bank-transactions/import?bankAccountId=${bankId}&dryRun=false`).attach('file', buf, '거래내역.xlsx');
    expect(again.body.inserted).toBe(0);
    expect(again.body.duplicates).toBe(4);
    const list = (await acct.get(`/bank-transactions?bankAccountId=${bankId}`)).body;
    expect(list.total).toBe(4);
    expect(list.unmatched).toBe(4);
  });

  it('CSV(EUC-KR 아님, UTF-8 BOM)도 같은 방식으로 읽는다 — 카드 이용내역', async () => {
    const card = (await acct.post('/bank-accounts', { kind: 'CARD', name: '법인카드', bankName: '신한카드', accountNo: '9410-1234-5678-0001', openingBalance: '0', openingDate: today })).body.id;
    const csv = '﻿이용일자,이용가맹점,이용금액,승인번호,구분\n' + `${today},철물점,"33,000",12345678,정상\n${today},주유소,"55,000",22223333,취소\n`;
    const r = await acct.req('post', `/bank-transactions/import?bankAccountId=${card}&dryRun=false`).attach('file', Buffer.from(csv), '카드.csv');
    expect(r.body.inserted).toBe(1);
    const t = (await acct.get(`/bank-transactions?bankAccountId=${card}`)).body.rows[0];
    expect(t.direction).toBe('OUT');
    expect(t.amount).toBe('33000.00');
  });

  it('다른 회사는 이 계좌로 올리거나 볼 수 없다', async () => {
    const r = await other.req('post', `/bank-transactions/import?bankAccountId=${bankId}&dryRun=true`).attach('file', buf, 'x.xlsx');
    expect(r.status).toBe(404);
    expect((await other.get('/bank-transactions')).body.total).toBe(0);
  });

  it('권한 없는 직원은 거래내역을 볼 수 없다', async () => {
    expect((await staff.get('/bank-transactions')).status).toBe(403);
  });
});

describe('대사 — 전표 만들기 · 제외 · 해제', () => {
  it('수수료 출금 → 지급수수료 전표, 통장 계정 대변', async () => {
    const list = (await acct.get(`/bank-transactions?bankAccountId=${bankId}&direction=OUT`)).body.rows;
    const fee = list[0];
    const fees = Object.keys(acc).find((c) => c === '831') ?? Object.keys(acc).find((c) => c.startsWith('8'))!;
    const r = await acct.post(`/bank-transactions/${fee.id}/journal`, { accountId: acc[fees], memo: '이체 수수료' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('MATCHED');
    const { db, pool } = testDb();
    const lines = (await db.execute(sql`select l.debit::text d, l.credit::text c, l.bank_account_id from journal_line l join journal_entry e on e.id = l.entry_id where e.source_type = 'BANK' and e.source_id = ${fee.id} order by l.debit desc`)).rows as { d: string; c: string; bank_account_id: string | null }[];
    await pool.end();
    expect(lines[0].d).toBe('500.00');
    expect(lines[1].c).toBe('500.00');
    expect(lines[1].bank_account_id).toBe(bankId);
    // 같은 거래를 두 번 처리할 수 없다
    expect((await acct.post(`/bank-transactions/${fee.id}/ignore`, { reason: '중복' })).status).toBe(409);
    // 해제하면 역분개되고 다시 미처리
    const un = await acct.post(`/bank-transactions/${fee.id}/unmatch`, { reason: '계정 잘못' });
    expect(un.status).toBe(200);
    const { db: db2, pool: p2 } = testDb();
    const net = (await db2.execute(sql`select coalesce(sum(l.debit - l.credit),0)::text s from journal_line l join journal_entry e on e.id = l.entry_id where e.source_id = ${fee.id} and l.bank_account_id is not null and e.status <> 'VOID'`)).rows[0] as { s: string };
    await p2.end();
    expect(Number(net.s)).toBe(0);
    expect((await acct.get(`/bank-transactions?status=UNMATCHED&direction=OUT`)).body.rows.some((x: { id: string }) => x.id === fee.id)).toBe(true);
  });

  it('입금을 수금 기록과 금액이 다르면 연결하지 않는다', async () => {
    const t = (await acct.get(`/bank-transactions?bankAccountId=${bankId}&direction=IN`)).body.rows.find((x: { amount: string }) => x.amount === '1234.00');
    const ig = await acct.post(`/bank-transactions/${t.id}/ignore`, { reason: '예금 이자 — 결산 때 일괄' });
    expect(ig.status).toBe(200);
    const s = (await acct.get('/bank-transactions/accounts')).body.find((x: { id: string }) => x.id === bankId);
    expect(s.statement_balance).toBe('15000234.00');
    expect(s.unmatched).toBe(3);
  });
});

describe('자금일보 · 자금수지', () => {
  it('자금일보 — 계좌별 전일 잔액·입출금·당일 잔액', async () => {
    const r = await acct.get(`/cash/daily?date=${today}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.accounts)).toBe(true);
    const forecast = await acct.get('/cash/forecast?months=3');
    expect(forecast.status).toBe(200);
    expect(forecast.body.rows.length).toBe(3);
  });
});

describe('필수 #14: 보고서 PDF·엑셀 출력', () => {
  it('보고서 목록은 권한에 맞게 보인다', async () => {
    const list = (await acct.get('/reports')).body as { key: string }[];
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect((await staff.get('/reports')).status).toBe(403);
  });
  for (const key of ['trial-balance', 'cash-daily', 'receivables', 'vendor-balances', 'project-pl']) {
    it(`${key} — JSON·PDF(A4/A3)·XLSX`, async () => {
      const j = await acct.get(`/reports/${key}`);
      expect(j.status).toBe(200);
      expect(Array.isArray(j.body.columns)).toBe(true);
      const pdf = await acct.req('get', `/reports/${key}?format=pdf&size=A3&orientation=landscape`).buffer(true).parse((res, cb) => {
        const c: Buffer[] = [];
        res.on('data', (d: Buffer) => c.push(d));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });
      expect(pdf.status).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const x = await acct.req('get', `/reports/${key}?format=xlsx`).buffer(true).parse((res, cb) => {
        const c: Buffer[] = [];
        res.on('data', (d: Buffer) => c.push(d));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });
      expect(x.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(x.body as never);
      expect(wb.worksheets.length).toBeGreaterThan(0);
    });
  }
  it('없는 보고서는 400', async () => {
    expect((await acct.get('/reports/nope')).status).toBe(400);
  });
});

describe('API 키 — 범위 제한 · Idempotency-Key', () => {
  let key: string, keyId: string;
  it('내 권한을 넘는 범위·관리 기능은 줄 수 없다', async () => {
    const scopes = (await admin.get('/api-keys/scopes')).body as { value: string }[];
    expect(scopes.some((s) => s.value.startsWith('user:'))).toBe(false);
    expect((await admin.post('/api-keys', { name: '나쁜 키', scopes: ['user:read'] })).body.code).toBe('SCOPE_DENIED');
    expect((await staff.post('/api-keys', { name: 'x', scopes: ['vendor:read'] })).status).toBe(403);
  });

  it('발급 — 원문은 한 번만, 목록에는 앞부분만', async () => {
    const r = await admin.post('/api-keys', { name: '그룹웨어 연동', scopes: ['vendor:read', 'vendor:create', 'project:read'], expiresInDays: 30 });
    expect(r.status).toBe(201);
    key = r.body.key;
    keyId = r.body.id;
    expect(key.startsWith('ssk_')).toBe(true);
    const list = (await admin.get('/api-keys')).body;
    expect(JSON.stringify(list)).not.toContain(key);
    expect(list[0].keyPrefix).toBe(key.slice(0, 12));
  });

  it('키로 조회 가능, 범위 밖은 403, 관리 기능은 403, 잘못된 키 401', async () => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${key}`);
    expect((await auth(http0().get('/api/v1/vendors'))).status).toBe(200);
    expect((await auth(http0().get('/api/v1/journal-entries'))).status).toBe(403);
    expect((await auth(http0().get('/api/v1/users'))).status).toBe(403);
    expect((await http0().get('/api/v1/vendors').set('Authorization', 'Bearer ssk_' + 'x'.repeat(48))).status).toBe(401);
  });

  it('POST 는 Idempotency-Key 필수 — 같은 키 재전송은 한 번만 처리, 다른 내용이면 422', async () => {
    const post = (body: object, idem?: string) => {
      let r = http0().post('/api/v1/vendors').set('Authorization', `Bearer ${key}`);
      if (idem) r = r.set('Idempotency-Key', idem);
      return r.send(body);
    };
    expect((await post({ name: '키로 만든 거래처', bizRegNo: '107-81-63213' })).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const a = await post({ name: '키로 만든 거래처', bizRegNo: '107-81-63213' }, 'req-0001-abc');
    expect(a.status).toBe(201);
    const b = await post({ name: '키로 만든 거래처', bizRegNo: '107-81-63213' }, 'req-0001-abc');
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect((await post({ name: '다른 거래처' }, 'req-0001-abc')).status).toBe(422);
    const vs = (await admin.get('/vendors?q=키로 만든')).body;
    expect((vs.rows ?? vs).filter((v: { name: string }) => v.name === '키로 만든 거래처').length).toBe(1);
  });

  it('폐기한 키는 바로 막힌다', async () => {
    expect((await admin.req('delete', `/api-keys/${keyId}`).send({ reason: '테스트 종료' })).status).toBe(200);
    expect((await http0().get('/api/v1/vendors').set('Authorization', `Bearer ${key}`)).status).toBe(401);
  });
});

describe('웹훅 — 발송함 · 서명 · 롤백 시 미발송', () => {
  let server: http.Server;
  const got: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  let url = '';
  let secret = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        got.push({ headers: req.headers, body: b });
        res.writeHead(b.includes('FAIL_ME') ? 500 : 200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('등록 → 연결 테스트(ping) 성공, 비밀키는 등록 때만', async () => {
    const r = await admin.post('/webhooks', { name: '그룹웨어', url, events: ['vendor.*'] });
    expect(r.status).toBe(201);
    secret = r.body.secret;
    expect(secret.startsWith('whsec_')).toBe(true);
    const t = await admin.post(`/webhooks/${r.body.id}/test`);
    expect(t.body.ok).toBe(true);
    expect(JSON.stringify((await admin.get('/webhooks')).body)).not.toContain(secret);
  });

  it('거래처 등록 → 이벤트 발송, HMAC 서명 검증 가능', async () => {
    got.length = 0;
    await admin.post('/vendors', { name: '웹훅거래처', bizRegNo: '220-81-62517' });
    const sent = await w.app.get(WebhooksService).process();
    expect(sent).toBe(1);
    const h = got[0];
    expect(h.headers['x-sserp-event']).toBe('vendor.create');
    const expected = createHmac('sha256', secret).update(`${h.headers['x-sserp-timestamp']}.${h.body}`).digest('hex');
    expect(h.headers['x-sserp-signature']).toBe(`sha256=${expected}`);
    expect(JSON.parse(h.body).summary).toContain('웹훅거래처');
  });

  it('실패한 요청(중복 사업자번호 → 롤백)은 발송되지 않는다', async () => {
    got.length = 0;
    const dup = await admin.post('/vendors', { name: '웹훅거래처2', bizRegNo: '220-81-62517' });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    expect(await w.app.get(WebhooksService).process()).toBe(0);
    expect(got.length).toBe(0);
  });

  it('받는 쪽 오류는 재시도 대기(PENDING)로 남는다', async () => {
    await admin.post('/vendors', { name: 'FAIL_ME 상사', bizRegNo: '120-81-47521' });
    await w.app.get(WebhooksService).process();
    const d = (await admin.get('/webhooks/deliveries')).body.find((x: { payload: { summary: string } }) => x.payload.summary?.includes('FAIL_ME'));
    expect(d.status).toBe('PENDING');
    expect(d.attempts).toBe(1);
    expect(d.lastStatusCode).toBe(500);
  });

  it('내부망 주소 차단 (허용 설정이 없을 때)', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'false';
    const r = await admin.post('/webhooks', { name: '내부', url: 'http://127.0.0.1:9/x', events: ['*'] });
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    expect(r.body.code).toBe('PRIVATE_URL');
  });
});

describe('백업 — 시스템관리자만, pg_restore 목록으로 검증', () => {
  it('회사 관리자는 백업을 다룰 수 없다', async () => {
    expect((await admin.get('/backups')).body.code).toBe('SYSTEM_ADMIN_ONLY');
  });
  it('시스템관리자 백업 → DONE, 검증됨', async () => {
    const { db, pool } = testDb();
    await db.execute(sql`update app_user set is_system_admin = true where login_id = 'a.admin'`);
    await pool.end();
    const sys = await agentFor(w, 'a.admin', w.A.id);
    const r = await sys.post('/backups');
    expect(r.status).toBe(202);
    let row: { status: string; verified: boolean; dbSize: number } | undefined;
    for (let i = 0; i < 60; i++) {
      row = (await sys.get('/backups')).body.rows.find((x: { id: string }) => x.id === r.body.id);
      if (row && row.status !== 'RUNNING') break;
      await new Promise((res) => setTimeout(res, 500));
    }
    expect(row!.status).toBe('DONE');
    expect(row!.verified).toBe(true);
    expect(row!.dbSize).toBeGreaterThan(1000);
  });
});
