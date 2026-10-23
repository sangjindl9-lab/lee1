/** 도장: 회사 직인·대표자 도장·개인 도장 등록, 결재란 기록, 이미지 접근 제한, PDF */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import zlib from 'zlib';
import { Agent, agentFor, setupWorld, World } from './helpers';

let w: World;
let admin: Agent, ceo: Agent, buyer: Agent, staff: Agent, other: Agent;
let projectId: string, vendorId: string;

/** 붉은 원 하나가 그려진 PNG (RGBA) */
function png(size = 64, seed = 0) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const d = Math.hypot(x - size / 2, y - size / 2);
      const on = d < size / 2 - 2 && d > size / 2 - 6;
      raw[o] = 196; raw[o + 1] = 43 + seed; raw[o + 2] = 28; raw[o + 3] = on ? 255 : 0;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const buf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + buf.toString('base64');
}

const getPdf = (ag: Agent, path: string) =>
  ag.req('get', path).buffer(true).parse((r, cb) => {
    const c: Buffer[] = [];
    r.on('data', (x: Buffer) => c.push(x));
    r.on('end', () => cb(null, Buffer.concat(c)));
  });

beforeAll(async () => {
  w = await setupWorld();
  admin = await agentFor(w, 'a.admin', w.A.id);
  ceo = await agentFor(w, 'a.ceo', w.A.id);
  buyer = await agentFor(w, 'a.buyer', w.A.id);
  staff = await agentFor(w, 'a.staff', w.A.id);
  other = await agentFor(w, 'b.admin', w.B.id);
  projectId = (await admin.post('/projects', { name: '도장 테스트 현장', tradeType: 'ELECTRIC', supplyAmount: '100000000', status: 'IN_PROGRESS' })).body.id;
  vendorId = (await admin.post('/vendors', { name: '대한전기자재', bizRegNo: '124-81-00998' })).body.id;
});
afterAll(async () => {
  await w.app.close();
});

describe('회사 직인·대표자 도장', () => {
  it('관리자만 등록하고, PNG 가 아니면 거부한다', async () => {
    expect((await staff.put('/seals/company/company', { image: png() })).status).toBe(403);
    expect((await admin.put('/seals/company/company', { image: 'data:image/jpeg;base64,' + Buffer.from('xxxxxxxxxxxxxxxxxxxxxxxxxxxx').toString('base64') })).status).toBe(400);
    expect((await admin.put('/seals/company/company', { image: 'data:image/png;base64,' + Buffer.from('not a png at all, really not').toString('base64') })).status).toBe(400);
    const c = await admin.put('/seals/company/company', { image: png(80) });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ width: 80, height: 80 });
    expect((await admin.put('/seals/company/ceo', { image: png(64) })).status).toBe(200);
    const got = (await staff.get('/seals/company')).body;
    expect(got.company.id).toBe(c.body.id);
    expect(got.ceo).toBeTruthy();
  });

  it('바꾸면 새 이미지가 쓰이고, 지우면 비어 있다', async () => {
    const before = (await admin.get('/seals/company')).body.ceo.id;
    const after = (await admin.put('/seals/company/ceo', { image: png(64, 5) })).body.id;
    expect(after).not.toBe(before);
    expect((await admin.get('/seals/company')).body.ceo.id).toBe(after);
    expect((await admin.del('/seals/company/ceo')).status).toBe(204);
    expect((await admin.get('/seals/company')).body.ceo).toBe(null);
    expect((await admin.del('/seals/company/ceo')).status).toBe(404);
    await admin.put('/seals/company/ceo', { image: png(64) });
  });
});

describe('개인 도장과 결재란', () => {
  it('내 도장은 본인이, 다른 직원 도장은 사용자 관리 권한으로 등록', async () => {
    expect((await buyer.put('/seals/me', { image: png(60) })).status).toBe(200);
    expect((await staff.put(`/seals/members/${w.ids['a.ceo'].membershipId}`, { image: png(60) })).status).toBe(403);
    expect((await admin.put(`/seals/members/${w.ids['a.ceo'].membershipId}`, { image: png(60, 9) })).status).toBe(200);
    expect((await ceo.get('/seals/me')).body.stamp).toBeTruthy();
    // 다른 회사 직원에게는 등록할 수 없다
    expect((await admin.put(`/seals/members/${w.ids['b.admin'].membershipId}`, { image: png(60) })).status).toBe(404);
  });

  it('결재하면 그 순간의 도장이 결재 단계에 남고, 나중에 도장을 바꿔도 그대로다', async () => {
    const p = (await buyer.post('/purchase-orders', { projectId, vendorId, title: '도장 발주', orderDate: '2026-10-24', lines: [{ name: '전선', unit: 'm', qty: '10', unitPrice: '1000' }] })).body;
    const s = await buyer.post(`/purchase-orders/${p.id}/submit`, { version: p.version });
    const a = (await ceo.get(`/approvals/${s.body.approvalId}`)).body;
    const ceoStamp = (await ceo.get('/seals/me')).body.stamp.id;
    const buyerStamp = (await buyer.get('/seals/me')).body.stamp.id;
    expect(a.steps[0].actedStampId).toBe(buyerStamp);
    await ceo.post(`/approvals/${a.id}/act`, { action: 'approve', version: a.version });
    const done = (await buyer.get(`/purchase-orders/${p.id}`)).body;
    expect(done.approval.steps[1].actedStampId).toBe(ceoStamp);
    await ceo.put('/seals/me', { image: png(60, 20) });
    const again = (await buyer.get(`/purchase-orders/${p.id}`)).body;
    expect(again.approval.steps[1].actedStampId).toBe(ceoStamp);

    const pdf = await getPdf(buyer, `/purchase-orders/${p.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    // 직인·대표자 도장·결재 도장 2개가 이미지로 들어간다
    const imgs = (pdf.body.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;
    expect(imgs).toBeGreaterThanOrEqual(4);
  });

  it('결재 전 발주서 PDF에는 직인을 찍지 않는다', async () => {
    const p = (await buyer.post('/purchase-orders', { projectId, vendorId, title: '결재 전', orderDate: '2026-10-24', lines: [{ name: '전선', unit: 'm', qty: '1', unitPrice: '1000' }] })).body;
    const pdf = await getPdf(buyer, `/purchase-orders/${p.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect((pdf.body.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(0);
  });
});

describe('도장 이미지 접근', () => {
  it('같은 회사 사람은 볼 수 있고, 다른 회사 사람은 찾을 수 없다', async () => {
    const seal = (await admin.get('/seals/company')).body.company;
    const mine = await staff.get(`/seals/${seal.id}/image`);
    expect(mine.status).toBe(200);
    expect(mine.headers['content-type']).toBe('image/png');
    expect((await other.get(`/seals/${seal.id}/image`)).status).toBe(404);
    const stamp = (await buyer.get('/seals/me')).body.stamp;
    expect((await staff.get(`/seals/${stamp.id}/image`)).status).toBe(200);
    expect((await other.get(`/seals/${stamp.id}/image`)).status).toBe(404);
  });

  it('등록·변경·삭제는 감사로그에 남는다', async () => {
    const logs = (await admin.get('/audit-logs?resource=seal')).body;
    const rows = logs.rows ?? logs;
    expect(rows.some((r: any) => /회사 직인 등록/.test(r.summary))).toBe(true);
    expect(rows.some((r: any) => /대표자 도장 삭제/.test(r.summary))).toBe(true);
  });
});
