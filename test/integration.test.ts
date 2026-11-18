// 서비스 계층 통합 테스트: 내장 Postgres + 실제 파일 보관소 + 테스트 결제 시뮬레이터로 전체 흐름을 실행한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eum-test-'));
process.env.DATA_DIR = DATA;
const { initDb, db, one, all } = await import('../src/server/db.ts');
const auth = await import('../src/server/auth.ts');
const cat = await import('../src/server/catalog.ts');
const trade = await import('../src/server/trade.ts');
const custom = await import('../src/server/custom.ts');
const ip = await import('../src/server/ip.ts');
const company = await import('../src/server/company.ts');
const { simProvider, simCaps, faults } = await import('../src/server/providers/sim.ts');
const { summarize } = await import('../src/domain/ledger.ts');

function makeZip(entries: { name: string; data: string }[]) {
  const parts: Buffer[] = [], central: Buffer[] = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), data = Buffer.from(e.data), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, data); central.push(ch, name); off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
let n = 0;
const tmp = (data: Buffer | string) => { const p = path.join(DATA, `up-${++n}`); fs.writeFileSync(p, data); return p; };
const SRC = makeZip([{ name: 'src/app.js', data: 'console.log("견적 자동화")' }, { name: '.env.example', data: 'API_KEY=' }]);
const read = async (s: any) => { const c: Buffer[] = []; for await (const x of s) c.push(x); return Buffer.concat(c); };
const rejects = (p: Promise<any>, re: RegExp) => assert.rejects(p, (e: any) => { assert.match(e.message, re); return true; });

let admin: any, seller: any, buyer: any, other: any, productId: number;
const mkUser = (name: string) => auth.register({ email: `${name}@example.com`, password: 'password-1234', name });

async function mkSeller(name: string, businessType = 'individual') {
  const u = await mkUser(name);
  await cat.applySeller(u, { display_name: `${name} 상점`, business_type: businessType, biz_reg_no: businessType === 'individual' ? '' : '1234567890' });
  await cat.adminSeller(admin, u.id, 'approve');
  await cat.setPayoutAccount(u, { bank: '테스트은행', number: '110-123-456789', holder: name });
  await cat.adminSeller(admin, u.id, 'verify_payout');
  return u;
}
const productForm = (over: any = {}) => ({ kind: 'source', category: 'accounting', title: '견적 자동화 소스', price: '1000000', inspection_days: '7', deliverables: ['source', 'install_doc'],
  included: '소스 전체, 설치 문서', inspection_criteria: 'Node 22에서 npm start 로 실행', refund_policy: '검수 기준 불일치 시 분쟁 절차', can_modify: 'on', ...over });
async function mkProduct(owner: any, over: any = {}) {
  const id = await cat.saveProduct(owner, null, productForm(over));
  const v = await cat.createVersion(owner, { productId: id }, '1.0.0');
  await cat.addFile(owner, v, 'source', tmp(SRC), 'source.zip');
  await cat.addFile(owner, v, 'install_doc', tmp('# 설치\nnpm install && npm start'), 'INSTALL.md');
  await cat.submitProduct(owner, id);
  await cat.reviewProduct(admin, id, true, '확인');
  return id;
}
const ppid = async (orderId: number) => (await one(db, 'SELECT provider_payment_id FROM payments WHERE order_id=$1', [orderId])).provider_payment_id as string;
const hook = async (evt: any) => { const p = simProvider.sim.packet(evt); return trade.processWebhook(p.raw, p.signature); };
const pay = async (orderId: number) => hook(await simProvider.sim.approve(await ppid(orderId)));
const order = (id: number) => one(db, 'SELECT * FROM orders WHERE id=$1', [id]);
async function buy(method = 'card', pid = productId, who = buyer) {
  const r = await trade.checkout(who, { productId: pid, method, agree: 'on' });
  await pay(r.orderId);
  return r.orderId;
}
const status = async (id: number) => { const o = await order(id); return [o.payment_status, o.delivery_status, o.inspection_status, o.dispute_status, o.refund_status, o.payout_status].join('/'); };
const finishPayout = async (orderId: number) => { const po = await one(db, 'SELECT idempotency_key FROM payouts WHERE order_id=$1', [orderId]); await hook(await simProvider.sim.completePayout(po.idempotency_key)); };

before(async () => {
  await initDb({ memory: true });
  process.env.ADMIN_EMAIL = 'admin@example.com'; process.env.ADMIN_PASSWORD = 'admin-password-1';
  await auth.bootstrap();
  admin = await one(db, "SELECT id,email,name,operator_role,status FROM users WHERE operator_role='super'");
  seller = await mkSeller('seller'); buyer = await mkUser('buyer'); other = await mkUser('other');
  productId = await mkProduct(seller);
});
after(async () => { await db.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('정상 흐름: 등록 → 결제 → 전달 → 검수 → 정산, 원장과 대사가 맞는다', async () => {
  const r = await trade.checkout(buyer, { productId, method: 'card', agree: 'on' });
  assert.equal(await status(r.orderId), 'pending/not_ready/not_started/none/none/not_eligible');
  await pay(r.orderId);
  let o = await order(r.orderId);
  assert.equal(await status(r.orderId), 'paid/granted/in_progress/none/none/not_eligible');
  assert.equal(o.escrow_status, 'test_simulated'); // 테스트 결제는 실제 대금 보호로 표시하지 않는다
  const file = (await all(db, 'SELECT * FROM files WHERE version_id=$1 ORDER BY id', [o.version_id]))[0];
  const dl = await trade.openDownload(buyer, await trade.issueDownload(buyer, r.orderId, file.id));
  assert.ok((await read(dl.stream)).equals(SRC)); // 암호화 보관 후 복호화한 내용이 원본과 같다
  assert.equal(await status(r.orderId), 'paid/granted/in_progress/none/none/not_eligible'); // 다운로드는 구매확정이 아니다
  await trade.confirmOrder(buyer, r.orderId, { files: true });
  assert.equal((await trade.requestPayout(admin, r.orderId)).status, 'requested');
  assert.equal((await order(r.orderId)).payout_status, 'requested'); // 접수일 뿐 완료가 아니다
  await finishPayout(r.orderId);
  o = await order(r.orderId);
  assert.equal(o.payout_status, 'paid'); assert.equal(o.escrow_status, 'released');
  const sum = summarize((await all(db, 'SELECT * FROM ledger_entries WHERE order_id=$1', [r.orderId])) as any);
  assert.equal(sum.undistributed, 0); assert.equal(sum.paidOut, 828_720); assert.equal(sum.platformNetRevenue, 100_000);
  assert.deepEqual((await all(db, 'SELECT doc_type FROM tax_records ORDER BY doc_type')).map((x) => x.doc_type), ['fee_receipt', 'withholding_statement']);
  await trade.addReview(buyer, r.orderId, 5, '설치 문서대로 바로 실행됐습니다');
  await rejects(trade.addReview(other, r.orderId, 1, '구매하지 않은 사람의 후기입니다'), /후기를 쓸 수 있는 주문이 아닙니다/);
  assert.equal((await trade.reconcile(admin)).mismatched, 0);
});

test('① 결제하지 않은 사용자는 파일을 받을 수 없다', async () => {
  const r = await trade.checkout(buyer, { productId, method: 'card', agree: 'on' });
  const f = (await one(db, 'SELECT id FROM files ORDER BY id LIMIT 1')).id;
  await rejects(trade.issueDownload(buyer, r.orderId, f), /결제가 확인되지 않았습니다/);
  await trade.syncPayment(r.orderId); // 결제창에서 돌아오기만 한 경우: 사업자 조회 결과가 미결제면 그대로다
  assert.equal((await order(r.orderId)).payment_status, 'pending');
  await rejects(trade.checkout(buyer, { productId, method: 'card', agree: '' }), /동의해야/);
});

test('② 타인의 주문·파일·정산에 접근할 수 없다', async () => {
  const id = await buy();
  const f = (await one(db, 'SELECT id FROM files ORDER BY id LIMIT 1')).id;
  await rejects(trade.getOrder(other, id), /볼 권한이 없습니다/);
  await rejects(trade.issueDownload(other, id, f), /구매자 본인만/);
  await rejects(trade.issueDownload(seller, id, f), /구매자 본인만/);
  const token = await trade.issueDownload(buyer, id, f);
  await rejects(trade.openDownload(other, token), /만료되었거나 올바르지/); // 링크를 가로채도 다른 계정으로는 쓸 수 없다
  await rejects(trade.requestPayout(seller, id), /권한이 없습니다/);
  const other2 = await mkProduct(await mkSeller('seller2'));
  const foreign = (await one(db, 'SELECT f.id FROM files f JOIN file_versions v ON v.id=f.version_id WHERE v.product_id=$1 LIMIT 1', [other2])).id;
  await rejects(trade.issueDownload(buyer, id, foreign), /이 주문의 납품 파일이 아닙니다/);
});

test('③ 결제 완료 후 파일 전달 실패: 검수를 시작하지 않고, 복구 작업이 다시 연다', async () => {
  const r = await trade.checkout(buyer, { productId, method: 'card', agree: 'on' });
  const f = await one(db, "SELECT storage_key FROM files WHERE kind='source' ORDER BY id LIMIT 1");
  const p = path.join(DATA, 'vault', f.storage_key);
  fs.renameSync(p, p + '.gone'); // 저장소 장애
  await pay(r.orderId);
  let o = await order(r.orderId);
  assert.equal(await status(r.orderId), 'paid/failed/not_started/none/none/not_eligible'); assert.equal(o.inspection_due_at, null);
  await rejects(trade.confirmOrder(buyer, r.orderId), /납품물이 전달되지 않은/);
  fs.renameSync(p + '.gone', p);
  await trade.runJobs();
  o = await order(r.orderId);
  assert.equal(o.delivery_status, 'granted'); assert.equal(o.inspection_status, 'in_progress'); assert.ok(o.inspection_due_at);
});

test('④ 빈 파일·누락 파일·비밀키 포함 파일·경로 탈출 압축 파일은 판매할 수 없다', async () => {
  const id = await cat.saveProduct(seller, null, productForm({ title: '누락 테스트 상품' }));
  const v = await cat.createVersion(seller, { productId: id }, '0.1');
  await rejects(cat.addFile(seller, v, 'source', tmp(''), 'empty.zip'), /빈 파일/);
  await cat.addFile(seller, v, 'install_doc', tmp('설치'), 'INSTALL.md');
  await rejects(cat.submitProduct(seller, id), /소스코드 누락/); // 소스 제공 상품인데 소스가 없음
  const leak = await cat.addFile(seller, v, 'source', tmp(makeZip([{ name: 'app.js', data: 'x' }, { name: '.env', data: 'DB_PASSWORD=real' }, { name: 'key.txt', data: 'AKIAABCDEFGHIJKLMNOP' }])), 'leak.zip');
  assert.equal((await one(db, 'SELECT scan_secret FROM files WHERE id=$1', [leak])).scan_secret, 'flagged');
  await rejects(cat.submitProduct(seller, id), /비밀키·개인정보 의심/);
  await cat.removeFile(seller, leak);
  const trav = await cat.addFile(seller, v, 'source', tmp(makeZip([{ name: '../../etc/passwd', data: 'x' }])), 'trav.zip');
  const tf = await one(db, 'SELECT * FROM files WHERE id=$1', [trav]);
  assert.equal(tf.scan_archive, 'flagged'); assert.equal(tf.scan_malware, 'unscannable'); // 엔진이 없으면 통과가 아니라 검사 불가
  await rejects(cat.submitProduct(seller, id), /압축 파일 안전성 문제/);
});

test('⑤ 판매자가 파일을 몰래 바꿀 수 없다: 공개 버전은 잠기고, 새 버전은 기존 주문에 영향이 없다', async () => {
  const id = await buy();
  const o = await order(id);
  await rejects(cat.addFile(seller, o.version_id, 'source', tmp('바꿔치기'), 'evil.zip'), /바꿀 수 없습니다/);
  const fileId = (await one(db, "SELECT id FROM files WHERE version_id=$1 AND kind='source'", [o.version_id])).id;
  await rejects(cat.removeFile(seller, fileId), /삭제할 수 없습니다/);
  const v2 = await cat.createVersion(seller, { productId }, '2.0.0');
  await cat.addFile(seller, v2, 'source', tmp(makeZip([{ name: 'v2.js', data: '다른 내용' }])), 'source.zip');
  await cat.addFile(seller, v2, 'install_doc', tmp('v2'), 'INSTALL.md');
  await cat.submitProduct(seller, productId); await cat.reviewProduct(admin, productId, true, 'v2');
  assert.equal((await one(db, 'SELECT current_version_id FROM products WHERE id=$1', [productId])).current_version_id, v2);
  assert.equal((await order(id)).version_id, o.version_id);
  await rejects(trade.issueDownload(buyer, id, (await one(db, "SELECT id FROM files WHERE version_id=$1 AND kind='source'", [v2])).id), /이 주문의 납품 파일이 아닙니다/);
  assert.ok((await read((await trade.openDownload(buyer, await trade.issueDownload(buyer, id, fileId))).stream)).equals(SRC));
});

test('⑥ 판매자가 탈퇴해도 기존 구매자는 계속 받을 수 있고, 신규 판매만 멈춘다', async () => {
  const s = await mkSeller('leaver'); const pid = await mkProduct(s, { title: '탈퇴 판매자 상품' });
  const id = await buy('card', pid);
  await cat.withdrawSeller(s);
  const f = (await one(db, 'SELECT id FROM files WHERE version_id=$1 LIMIT 1', [(await order(id)).version_id])).id;
  assert.ok((await read((await trade.openDownload(buyer, await trade.issueDownload(buyer, id, f))).stream)).length > 0);
  await rejects(trade.checkout(buyer, { productId: pid, method: 'card', agree: 'on' }), /판매 중인 상품이 아닙니다/);
  await trade.confirmOrder(buyer, id); // 이미 끝난 거래의 대금은 탈퇴 판매자에게도 지급한다
  assert.equal((await trade.requestPayout(admin, id)).status, 'requested');
});

test('⑦ 미납품 상태에서는 검수·정산이 막힌다', async () => {
  const r = await trade.checkout(buyer, { productId, method: 'card', agree: 'on' });
  await rejects(trade.confirmOrder(buyer, r.orderId), /납품물이 전달되지 않은/);
  await rejects(trade.requestPayout(admin, r.orderId), /결제가 완료 상태가 아닙니다/);
  const id = await buy();
  await rejects(trade.requestPayout(admin, id), /검수가 끝나지 않았습니다/); // 납품만으로는 지급하지 않는다
  await rejects(trade.requestClose(seller, id, '확정이 늦어요'), /검수 기한이 지난 뒤/);
  await db.query("UPDATE orders SET inspection_due_at = now() - interval '1 hour' WHERE id=$1", [id]);
  await trade.requestClose(seller, id, '기한이 지났습니다');
  const cr = await one(db, 'SELECT id FROM close_requests WHERE order_id=$1', [id]);
  await rejects(trade.decideClose(admin, cr.id, true, ''), /근거/);
  await trade.decideClose(admin, cr.id, true, '기한 경과, 구매자 무응답, 다운로드 기록 확인');
  assert.equal(await status(id), 'paid/granted/closed_by_admin/none/none/eligible');
});

test('⑧ 분쟁 중에는 지급되지 않고, 외부 보류 결과가 따로 기록된다', async () => {
  const id = await buy(); await trade.confirmOrder(buyer, id);
  const did = await trade.openDispute(buyer, id, { reason: 'feature_mismatch', description: '설명에 있는 엑셀 내보내기 기능이 동작하지 않습니다.', wantsRefund: true });
  assert.equal(await status(id), 'paid/granted/confirmed/open/none/blocked');
  const d = await one(db, 'SELECT * FROM disputes WHERE id=$1', [did]);
  assert.equal(d.external_hold, 'confirmed'); assert.equal((await order(id)).escrow_status, 'dispute_hold');
  await rejects(trade.requestPayout(admin, id), /분쟁이 진행 중/);
  await rejects(simProvider.createPayout({ idempotencyKey: 'bypass', providerPaymentId: await ppid(id), amount: 1 }), /보류/); // 내부 규칙을 우회해도 사업자에서 막힌다
  await trade.addDisputeEntry(seller, did, 'evidence', '내보내기는 설치 문서 3장의 설정을 켜야 동작합니다.');
  await rejects(trade.addDisputeEntry(other, did, 'statement', '끼어들기'), /권한이 없습니다/);
  await rejects(trade.resolveDispute(admin, did, { decision: 'release', basis: '' }), /근거/);
  await trade.resolveDispute(admin, did, { decision: 'release', basis: '설치 문서의 설정 적용 후 기능 동작 확인' });
  assert.equal(await status(id), 'paid/granted/confirmed/resolved/none/eligible');
  assert.equal((await trade.requestPayout(admin, id)).status, 'requested');
  // 외부 보류를 지원하지 않는 사업자: 내부 보류만 적용되고 그렇게 기록된다
  simCaps.disputeHold = false;
  const id2 = await buy();
  const d2 = await one(db, 'SELECT * FROM disputes WHERE id=$1', [await trade.openDispute(buyer, id2, { reason: 'env_failure', description: '약속한 Windows 11 환경에서 실행되지 않습니다.' })]);
  simCaps.disputeHold = true;
  assert.equal(d2.external_hold, 'unsupported'); assert.equal((await order(id2)).escrow_status, 'test_simulated'); assert.equal((await order(id2)).payout_status, 'blocked');
});

test('⑨ 환불과 정산을 동시에 실행해도 같은 돈이 두 번 나가지 않는다', async () => {
  for (let i = 0; i < 4; i++) {
    const id = await buy(); await trade.confirmOrder(buyer, id);
    const [a, b] = i % 2 ? [() => trade.requestPayout(admin, id), () => trade.adminRefund(admin, id, 1_000_000, '경쟁 테스트')] : [() => trade.adminRefund(admin, id, 1_000_000, '경쟁 테스트'), () => trade.requestPayout(admin, id)];
    await Promise.allSettled([a(), b()]);
    const ext = await simProvider.getPayment(await ppid(id));
    const po = await simProvider.getPayoutByKey(`payout-${id}-1`);
    const o = await order(id);
    assert.ok(!(ext!.refunded > 0 && po), `환불과 지급이 모두 실행됨: ${await status(id)}`);
    assert.ok(ext!.refunded > 0 || po, '둘 중 하나는 실행되어야 함');
    if (po) { assert.equal(o.refunded_amount, 0); assert.ok(['none', 'post_settlement_review'].includes(o.refund_status)); }
    else { assert.equal(o.payout_status, 'void'); assert.equal(o.refunded_amount, 1_000_000); }
  }
  // 지급이 먼저 끝난 거래의 환불은 사후 검토로만 간다
  const id = await buy(); await trade.confirmOrder(buyer, id); await trade.requestPayout(admin, id); await finishPayout(id);
  assert.equal((await trade.adminRefund(admin, id, 1_000_000, '지급 후 환불 요청')).status, 'post_settlement_review');
  assert.equal(await status(id), 'paid/granted/confirmed/none/post_settlement_review/paid');
  await rejects(trade.requestPayout(admin, id), /이미 지급/);
});

test('⑩ 중복·지연·역순·위조 웹훅', async () => {
  const r = await trade.checkout(buyer, { productId, method: 'card', agree: 'on' });
  const evt = await simProvider.sim.approve(await ppid(r.orderId));
  const pkt = simProvider.sim.packet(evt);
  await rejects(trade.processWebhook(pkt.raw, 't=1,v1=00'), /서명 검증 실패/);
  await rejects(trade.processWebhook(pkt.raw.replace('payment.paid', 'payment.Paid'), pkt.signature), /서명 검증 실패/);
  const old = simProvider.sim.packet(evt, Date.now() - 3600_000);
  await rejects(trade.processWebhook(old.raw, old.signature), /시각 만료/);
  assert.equal((await order(r.orderId)).payment_status, 'pending');
  assert.equal((await trade.processWebhook(pkt.raw, pkt.signature)).duplicate, false);
  assert.equal((await trade.processWebhook(pkt.raw, pkt.signature)).duplicate, true);
  assert.equal((await all(db, "SELECT 1 FROM ledger_entries WHERE order_id=$1 AND kind='payment_in'", [r.orderId])).length, 1);
  assert.equal((await all(db, 'SELECT 1 FROM deliveries WHERE order_id=$1', [r.orderId])).length, 1);
  // 역순: 사업자에서 결제 후 곧바로 취소됨. 취소 통지가 먼저, 승인 통지가 나중에 도착
  const r2 = await trade.checkout(buyer, { productId, method: 'card', agree: 'on' });
  const paid = await simProvider.sim.approve(await ppid(r2.orderId));
  await simProvider.cancelPayment({ providerPaymentId: await ppid(r2.orderId), amount: 1_000_000, idempotencyKey: 'external-cancel' });
  const refunded = await one(db, "SELECT id, type, payload FROM simpg_events WHERE type='payment.refunded' ORDER BY seq DESC LIMIT 1");
  await hook({ id: refunded.id, type: refunded.type, data: refunded.payload });
  await hook(paid);
  const o = await order(r2.orderId);
  assert.equal(o.payment_status, 'cancelled'); assert.equal(o.delivery_status, 'not_ready'); // 납품이 열리지 않는다
  // 지연: 구매확정까지 끝난 뒤 같은 승인 통지가 새 이벤트로 다시 옴
  await trade.confirmOrder(buyer, r.orderId);
  await hook({ ...evt, id: 'evt_late_copy' });
  assert.equal(await status(r.orderId), 'paid/granted/confirmed/none/none/eligible');
});

test('⑪ 외부 지급 요청 타임아웃: 조회 후 재시도하며 이중 지급이 없다', async () => {
  const count = async (id: number) => (await all(db, 'SELECT 1 FROM simpg_payouts WHERE payment_id=$1', [await ppid(id)])).length;
  const a = await buy(); await trade.confirmOrder(buyer, a);
  faults.payoutTimeoutAfterAccept = 1; // 사업자는 접수했는데 응답이 유실됨
  assert.equal((await trade.requestPayout(admin, a)).status, 'unknown');
  await rejects(trade.requestPayout(admin, a), /이미 지급 요청/);
  await trade.syncPayout(a);
  assert.equal((await order(a)).payout_status, 'requested'); assert.equal(await count(a), 1);
  const b = await buy(); await trade.confirmOrder(buyer, b);
  faults.payoutTimeoutBeforeAccept = 1; // 사업자에 도달하지 못함
  assert.equal((await trade.requestPayout(admin, b)).status, 'unknown'); assert.equal(await count(b), 0);
  await trade.syncPayout(b); // 접수 기록이 없음을 확인한 뒤 같은 키로 재요청
  assert.equal((await order(b)).payout_status, 'requested'); assert.equal(await count(b), 1);
  await trade.syncPayout(b); assert.equal(await count(b), 1);
  await finishPayout(b);
  assert.equal((await order(b)).payout_status, 'paid');
  // 환불 취소 요청 타임아웃: 조회로 완료를 확인한다
  const c = await buy();
  faults.cancelTimeoutAfterDone = 1;
  assert.equal((await trade.adminRefund(admin, c, 1_000_000, '타임아웃 테스트')).status, 'completed');
  assert.equal((await simProvider.getPayment(await ppid(c)))!.refunded, 1_000_000);
});

test('⑫ 부분 환불을 지원하지 않는 결제수단', async () => {
  const id = await buy('vbank');
  const did = await trade.openDispute(buyer, id, { reason: 'file_missing', description: '의존성 목록 파일이 누락되어 일부 환불을 요청합니다.', wantsRefund: true });
  const out = await trade.resolveDispute(admin, did, { decision: 'refund_partial', basis: '문서 일부 누락 인정', amount: '200000' });
  const rf = await one(db, 'SELECT * FROM refunds WHERE id=$1', [out.refundId]);
  assert.equal(rf.status, 'unsupported'); assert.match(rf.failure, /대체 절차/);
  assert.equal((await order(id)).refunded_amount, 0); assert.equal((await simProvider.getPayment(await ppid(id)))!.refunded, 0);
  const id2 = await buy('card'); await trade.confirmOrder(buyer, id2);
  const did2 = await trade.openDispute(buyer, id2, { reason: 'file_missing', description: '의존성 목록 파일이 누락되어 일부 환불을 요청합니다.', wantsRefund: true });
  await trade.resolveDispute(admin, did2, { decision: 'refund_partial', basis: '문서 일부 누락 인정', amount: '200000' });
  assert.equal(await status(id2), 'partially_refunded/granted/confirmed/resolved/completed/eligible');
  await trade.requestPayout(admin, id2); await finishPayout(id2);
  const po = await one(db, 'SELECT * FROM payouts WHERE order_id=$1', [id2]);
  assert.equal(po.base_amount, 800_000); assert.equal(po.fee_supply, 80_000);
  assert.equal(summarize((await all(db, 'SELECT * FROM ledger_entries WHERE order_id=$1', [id2])) as any).undistributed, 0);
});

test('⑬ 검수 기한과 사업자 자동확정·보류 기간이 충돌하면 결제를 막는다', async () => {
  simCaps.autoConfirmDays = 5;
  await rejects(trade.checkout(buyer, { productId, method: 'card', agree: 'on' }), /자동 구매확정하므로 검수 기간\(7일\)과 충돌/);
  simCaps.autoConfirmDays = null; simCaps.maxHoldDays = 3;
  await rejects(trade.checkout(buyer, { productId, method: 'card', agree: 'on' }), /보류 가능 기간\(3일\) 안에 확보할 수 없습니다/);
  simCaps.maxHoldDays = 30;
  // 플랫폼 자동확정은 운영 정책으로 켰을 때만 동작한다
  const id = await buy();
  await db.query("UPDATE orders SET inspection_due_at = now() - interval '1 hour' WHERE id=$1", [id]);
  await trade.runJobs();
  assert.equal((await order(id)).inspection_status, 'in_progress');
  await db.query("INSERT INTO settings(key,value) VALUES ('auto_confirm','on')");
  await trade.runJobs();
  assert.equal(await status(id), 'paid/granted/auto_confirmed/none/none/eligible');
  await db.query("DELETE FROM settings WHERE key='auto_confirm'");
});

test('⑭ 환불 뒤에는 추가 다운로드를 막고, 이미 받은 파일의 한계를 알린다', async () => {
  const id = await buy();
  const f = (await one(db, 'SELECT id FROM files WHERE version_id=$1 LIMIT 1', [(await order(id)).version_id])).id;
  await trade.openDownload(buyer, await trade.issueDownload(buyer, id, f));
  const token = await trade.issueDownload(buyer, id, f); // 환불 전에 받아 둔 링크
  assert.equal((await trade.adminRefund(admin, id, 1_000_000, '판매자 동의에 따른 전액 환불')).status, 'completed');
  assert.equal(await status(id), 'cancelled/revoked/in_progress/none/completed/void');
  await rejects(trade.issueDownload(buyer, id, f), /결제가 확인되지 않았습니다|추가 다운로드가 차단/);
  await rejects(trade.openDownload(buyer, token), /차단|확인되지/);
  const note = await one(db, "SELECT body FROM notifications WHERE user_id=$1 AND body LIKE '%회수하거나 원격 삭제할 수 없으므로%' ORDER BY id DESC LIMIT 1", [seller.id]);
  assert.ok(note, '판매자에게 한계 안내');
  assert.equal((await all(db, 'SELECT 1 FROM download_logs WHERE order_id=$1', [id])).length, 1); // 환불 전 다운로드 기록은 증빙으로 남는다
});

test('수수료 정책 변경은 기존 주문에 영향을 주지 않는다', async () => {
  const id = await buy(); await trade.confirmOrder(buyer, id);
  await db.query("INSERT INTO fee_policies(scope, rate_bps, pg_fee_bearer) VALUES ('default', 3000, 'seller')");
  await trade.requestPayout(admin, id);
  assert.equal((await one(db, 'SELECT fee_supply FROM payouts WHERE order_id=$1', [id])).fee_supply, 100_000);
  assert.equal((await cat.feePreview(seller.id, 'accounting', 1_000_000)).settlement.feeSupply, 300_000);
  await db.query('UPDATE fee_policies SET active=false WHERE rate_bps=3000');
});

test('맞춤 개발: 견적 → 계약 동의 → 단계별 결제·납품·수정·검수 → 변경 계약', async () => {
  const dev = await mkSeller('dev', 'corporation');
  const reqId = await custom.createRequest(buyer, { work_type: 'new', title: '현장 작업일보 앱', requirements: '작업일보 작성, 사진 첨부, PDF 출력 기능이 필요합니다.', source_terms: '소스 전체 제공', rights_ownership: '의뢰자 귀속' });
  const qid = await custom.submitQuote(dev, reqId, { scope: '작업일보 앱 개발', out_of_scope: '서버 운영', inspection_criteria: '요구사항 기능 동작',
    stage_title: ['요구사항·화면 설계', '최종 소스·문서 인도'], stage_deliverables: ['화면 설계서', '소스, 설치 문서'], stage_amount: ['500000', '1500000'], stage_days: ['7', '21'] });
  await rejects(custom.acceptQuote(other, qid), /채택할 수 없는/);
  const cid = await custom.acceptQuote(buyer, qid);
  let c = await custom.getContract(buyer, cid);
  assert.equal(c.status, 'negotiating'); assert.equal(c.version.is_draft, true); // 법률 검토 전에는 초안
  const [m1, m2] = c.milestones;
  await rejects(custom.payMilestone(buyer, m1.id, 'card', 'on'), /양측이 계약 조건에 동의한 뒤/);
  await custom.agreeContract(buyer, cid); await custom.agreeContract(dev, cid);
  await rejects(custom.payMilestone(buyer, m2.id, 'card', 'on'), /앞 단계가 승인된 뒤/);
  const p1 = await custom.payMilestone(buyer, m1.id, 'card', 'on');
  const v0 = await cat.createVersion(dev, { milestoneId: m1.id }, '설계 1차');
  await cat.addFile(dev, v0, 'guide', tmp('화면 설계서'), 'design.md');
  await rejects(custom.submitMilestoneDelivery(dev, m1.id, v0), /결제가 확인된 뒤/); // 결제 확인 전에는 납품 불가
  await pay(p1.orderId);
  assert.equal((await one(db, 'SELECT status FROM milestones WHERE id=$1', [m1.id])).status, 'in_progress');
  const shot = await cat.createVersion(dev, { milestoneId: m1.id }, '캡처만');
  await cat.addFile(dev, shot, 'evidence', tmp('screenshot'), 'screen.png');
  await rejects(custom.submitMilestoneDelivery(dev, m1.id, shot), /화면 캡처·시연 영상만으로는/);
  await custom.submitMilestoneDelivery(dev, m1.id, v0);
  assert.equal(await status(p1.orderId), 'paid/granted/in_progress/none/none/not_eligible');
  await trade.requestRevision(buyer, p1.orderId, '출력 화면 설계가 요구사항과 다릅니다. 수정 바랍니다.');
  const v1 = await cat.createVersion(dev, { milestoneId: m1.id }, '설계 2차');
  await cat.addFile(dev, v1, 'guide', tmp('화면 설계서 수정본'), 'design-v2.md');
  await custom.submitMilestoneDelivery(dev, m1.id, v1);
  assert.equal((await order(p1.orderId)).inspection_status, 'in_progress');
  const f1 = (await one(db, 'SELECT id FROM files WHERE version_id=$1', [v1])).id;
  assert.equal((await read((await trade.openDownload(buyer, await trade.issueDownload(buyer, p1.orderId, f1))).stream)).toString(), '화면 설계서 수정본');
  await trade.confirmOrder(buyer, p1.orderId);
  assert.equal((await one(db, 'SELECT status FROM milestones WHERE id=$1', [m1.id])).status, 'accepted');
  // 최종 단계는 소스와 설치 문서가 있어야 한다
  const p2 = await custom.payMilestone(buyer, m2.id, 'card', 'on'); await pay(p2.orderId);
  const fin = await cat.createVersion(dev, { milestoneId: m2.id }, '최종');
  await cat.addFile(dev, fin, 'executable', tmp('binary'), 'app.apk');
  await rejects(custom.submitMilestoneDelivery(dev, m2.id, fin), /소스코드 누락/);
  await cat.addFile(dev, fin, 'source', tmp(SRC), 'source.zip'); await cat.addFile(dev, fin, 'install_doc', tmp('빌드 방법'), 'BUILD.md');
  await custom.submitMilestoneDelivery(dev, m2.id, fin);
  // 변경 계약: 양측 동의 시 새 버전과 추가 단계가 생기고, 기존 버전은 그대로 남는다
  const ch = await custom.proposeChange(buyer, cid, { existing_scope: 'PDF 출력', added_scope: '엑셀 출력 추가', in_original_scope: 'no', amount_delta: '300000', days_delta: '5' });
  c = await custom.getContract(buyer, cid); assert.equal(c.current_version_no, 1);
  await custom.decideChange(dev, ch, true);
  c = await custom.getContract(buyer, cid);
  assert.equal(c.current_version_no, 2); assert.equal(c.version.terms.total, 2_300_000); assert.equal(c.milestones.length, 3); assert.equal(c.milestones[2].amount, 300_000);
  await assert.rejects(db.query(`UPDATE contract_versions SET terms='{}' WHERE contract_id=$1 AND version_no=1`, [cid]), /CONTRACT_VERSION_IMMUTABLE/);
  await trade.confirmOrder(buyer, p2.orderId); await trade.requestPayout(admin, p2.orderId); await finishPayout(p2.orderId);
  const po = await one(db, 'SELECT * FROM payouts WHERE order_id=$1', [p2.orderId]);
  assert.equal(po.withholding_income_tax, 0); assert.equal(po.net_amount, 1_500_000 - 150_000 - 15_000 - 49_500); // 법인: 원천징수 없음
  assert.equal((await one(db, "SELECT doc_type FROM tax_records WHERE payout_id=$1", [po.id])).doc_type, 'tax_invoice');
});

test('지식재산권 거래: 비공개 자료실, 독점 잠금, 공식 이전 증빙, 인수 확인', async () => {
  const owner = await mkSeller('ipowner', 'corporation');
  const lid = await ip.saveListing(owner, null, { title: '예약 관리 앱 저작재산권', right_type: 'copyright_transfer', right_holder: '㈜예시', seller_authority: '창작자 겸 단독 권리자', scope: '저작재산권 전부 양도', included_assets: '소스, 도메인', asking_price: '30000000' });
  await ip.submitListing(owner, lid); await ip.reviewListing(admin, lid, true, '등록 항목 확인');
  const rv = await cat.createVersion(owner, { ipListingId: lid }, '자료실');
  const secret = await cat.addFile(owner, rv, 'evidence', tmp('저작권 등록증 사본'), 'cert.txt');
  const listing = await one(db, 'SELECT * FROM ip_listings WHERE id=$1', [lid]);
  assert.equal(await ip.canViewRoom(buyer, listing), false);
  await rejects(ip.openRoomFile(buyer, secret), /승인받은 사람만/);
  await rejects(ip.requestAccess(buyer, lid, ''), /비밀유지 조건에 동의/);
  await ip.requestAccess(buyer, lid, 'on');
  await rejects(ip.openRoomFile(buyer, secret), /승인받은 사람만/); // 동의만으로는 부족하고 판매자 승인이 필요
  const g = await one(db, 'SELECT id FROM ip_access_grants WHERE listing_id=$1 AND user_id=$2', [lid, buyer.id]);
  await rejects(ip.decideAccess(other, g.id, true), /권한이 없습니다/);
  await ip.decideAccess(owner, g.id, true);
  assert.equal((await read((await ip.openRoomFile(buyer, secret)).stream)).toString(), '저작권 등록증 사본');
  assert.equal((await all(db, 'SELECT 1 FROM ip_room_views WHERE listing_id=$1', [lid])).length, 1);
  await rejects(ip.openRoomFile(other, secret), /승인받은 사람만/);
  const deal = await ip.startDeal(buyer, lid); const deal2 = await ip.startDeal(other, lid);
  for (const d of [deal, deal2]) { await ip.proposeDealTerms(owner, d, { amount: '30000000', terms: '저작재산권 전부를 양도하며 소스 저장소와 도메인을 이전한다. 2차적저작물작성권 포함.' }); }
  await rejects(ip.payDeal(buyer, deal, 'card', 'on'), /양측이 계약 조건에 동의한 뒤/);
  const d1 = await ip.getDeal(buyer, deal); const d2 = await ip.getDeal(other, deal2);
  await custom.agreeContract(buyer, d1.contract_id); await custom.agreeContract(other, d2.contract_id);
  const p = await ip.payDeal(buyer, deal, 'card', 'on');
  assert.equal((await one(db, 'SELECT status FROM ip_listings WHERE id=$1', [lid])).status, 'locked');
  await rejects(ip.payDeal(other, deal2, 'card', 'on'), /다른 독점 거래가 진행 중/); // 중복 판매 차단
  assert.equal((await order(p.orderId)).snapshot.contractDraft, true);
  await pay(p.orderId);
  await ip.addTransferItem(owner, deal, { asset_type: 'source_snapshot', description: '소스 스냅샷 zip' });
  await ip.addTransferItem(owner, deal, { asset_type: 'domain', description: 'example.kr 도메인' });
  const items = await all(db, 'SELECT * FROM ip_transfer_items WHERE deal_id=$1 ORDER BY id', [deal]);
  await ip.markTransferItem(owner, items[0].id, '');
  await rejects(ip.markTransferItem(owner, items[1].id, ''), /공식 이전 절차를 마친 증빙/); // 비밀번호 전달만으로는 안 된다
  await rejects(ip.completeTransfer(owner, deal), /인도 표시를 하지 않은 자산/);
  await ip.markTransferItem(owner, items[1].id, '등록기관 소유자 변경 완료 통지 메일 2026-11-18');
  await ip.completeTransfer(owner, deal);
  await rejects(trade.confirmOrder(buyer, p.orderId), /인수 확인하지 않은 자산/);
  for (const it of items) await ip.confirmTransferItem(buyer, it.id);
  await trade.confirmOrder(buyer, p.orderId);
  assert.equal((await one(db, 'SELECT status FROM ip_listings WHERE id=$1', [lid])).status, 'sold');
  assert.equal((await ip.getDeal(buyer, deal)).stage, 'completed');
  await rejects(ip.startDeal(other, lid), /상담을 시작할 수 없는/);
});

test('기업 계정: 구매 승인과 검수 담당자', async () => {
  const boss = await mkUser('boss'); const staff = await mkUser('staff'); const qa = await mkUser('qa');
  const cid = await company.createCompany(boss, '예시전기', true);
  await rejects(company.setMember(staff, cid, 'qa@example.com', 'inspector'), /기업 관리자만/);
  await company.setMember(boss, cid, 'staff@example.com', 'buyer'); await company.setMember(boss, cid, 'qa@example.com', 'inspector');
  await rejects(trade.checkout(qa, { productId, method: 'card', agree: 'on', companyId: cid }), /구매 권한이 없습니다/);
  const r = await trade.checkout(staff, { productId, method: 'card', agree: 'on', companyId: cid });
  assert.equal(r.needsApproval, true); assert.equal(r.providerPaymentId, null);
  await rejects(trade.startPayment(r.orderId), /기업 구매 승인이 필요/);
  await rejects(trade.decidePurchase(staff, r.orderId, true, ''), /기업 관리자만/);
  await trade.decidePurchase(boss, r.orderId, true, '예산 확인');
  await trade.startPayment(r.orderId); await pay(r.orderId);
  await rejects(trade.confirmOrder(other, r.orderId), /구매자만 구매확정/);
  await trade.confirmOrder(qa, r.orderId, { files: true }); // 검수 담당자가 확정
  assert.equal((await order(r.orderId)).inspection_status, 'confirmed');
});

test('신고 처리: 문제 상품 판매 제한과 유사 피해 주문 확인, 최종 대사', async () => {
  await cat.createReport(other, { product_id: productId, reason: 'rights_infringement', body: '제 저장소의 코드와 동일한 것으로 보입니다.' });
  const rep = await one(db, 'SELECT id FROM reports ORDER BY id DESC LIMIT 1');
  const similar = await cat.handleReport(admin, rep.id, 'restrict', '권리 자료 확인 전까지 판매 제한');
  assert.ok(similar.length > 0);
  await rejects(trade.checkout(buyer, { productId, method: 'card', agree: 'on' }), /판매 중인 상품이 아닙니다/);
  // 외부에서만 취소된 결제(역순 웹훅 테스트)는 내부 환불 기록이 없으므로 대사에서 드러나지 않아야 한다: 내부도 cancelled 로 맞춰져 있다
  const rec = await trade.reconcile(admin);
  const rows = await all(db, 'SELECT kind, internal_value, external_value FROM recon_mismatches WHERE run_id=$1', [rec.run]);
  assert.deepEqual(rows, []);
  // 사업자 쪽 상태를 임의로 바꾸면 불일치로 잡힌다
  await db.query("UPDATE simpg_payments SET refunded=1 WHERE id=(SELECT id FROM simpg_payments WHERE status='paid' LIMIT 1)");
  assert.equal((await trade.reconcile(admin)).mismatched, 1);
});
