// SQL 마이그레이션을 실제 Postgres 엔진(PGlite)에 적용하고, DB가 스스로 지키는 규칙을 확인한다.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { generate } from '../scripts/gen-prisma.mjs';

let pg: PGlite;
const q = async (sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as Record<string, any>[];
const fails = async (sql: string, params: unknown[], pattern: RegExp) => { await assert.rejects(() => pg.query(sql, params), pattern); };
const H = (c: string) => c.repeat(64);

let buyer: number, seller: number, product: number, version: number, file: number, order: number;

async function newOrder(no: string) {
  return (await q(`INSERT INTO orders(order_no, order_type, buyer_id, seller_id, product_id, version_id, snapshot, terms_agreed_at, amount, pay_method,
      fee_policy, fee_bps, pg_fee_bps, pg_fee_bearer, seller_business_type, inspection_days)
    VALUES ($1,'product',$2,$3,$4,$5,'{"title":"견적 자동화 소스"}', now(), 1000000, 'card', '{"rateBps":1000}', 1000, 330, 'seller', 'individual', 7) RETURNING id`,
    [no, buyer, seller, product, version]))[0].id as number;
}

before(async () => {
  pg = new PGlite();
  await pg.exec(fs.readFileSync('prisma/migrations/0001_init/migration.sql', 'utf8'));
  buyer = (await q(`INSERT INTO users(email,password_hash,name) VALUES ('b@example.com','x','구매자') RETURNING id`))[0].id;
  seller = (await q(`INSERT INTO users(email,password_hash,name) VALUES ('s@example.com','x','판매자') RETURNING id`))[0].id;
  await q(`INSERT INTO sellers(user_id, display_name, status) VALUES ($1,'판매자 상점','approved')`, [seller]);
  product = (await q(`INSERT INTO products(seller_id, kind, category, title, has_source, deliverables) VALUES ($1,'source','accounting','견적 자동화 소스',true,'["source","install_doc"]') RETURNING id`, [seller]))[0].id;
  version = (await q(`INSERT INTO file_versions(product_id, label, created_by) VALUES ($1,'1.0.0',$2) RETURNING id`, [product, seller]))[0].id;
  file = (await q(`INSERT INTO files(version_id, kind, filename, size_bytes, sha256, storage_key, key_wrapped, uploaded_by) VALUES ($1,'source','src.zip',2048,$2,'k1','w',$3) RETURNING id`, [version, H('a'), seller]))[0].id;
  await q(`UPDATE file_versions SET status='published', published_at=now() WHERE id=$1`, [version]);
  order = await newOrder('EM-0001');
});

test('schema.prisma 는 SQL과 일치한다', async () => {
  assert.equal(fs.readFileSync('prisma/schema.prisma', 'utf8'), await generate());
});

test('빈 파일과 잘못된 해시는 등록할 수 없다', async () => {
  const v = (await q(`INSERT INTO file_versions(product_id, label, created_by) VALUES ($1,'draft',$2) RETURNING id`, [product, seller]))[0].id;
  await fails(`INSERT INTO files(version_id, kind, filename, size_bytes, sha256, storage_key, key_wrapped, uploaded_by) VALUES ($1,'source','empty.zip',0,$2,'k-empty','w',$3)`, [v, H('b'), seller], /check/i);
  await fails(`INSERT INTO files(version_id, kind, filename, size_bytes, sha256, storage_key, key_wrapped, uploaded_by) VALUES ($1,'source','x.zip',10,'nothash','k-bad','w',$2)`, [v, seller], /check/i);
});

test('공개된 파일 버전은 추가·교체·삭제할 수 없고, 검사 결과만 갱신된다', async () => {
  await fails(`UPDATE files SET sha256=$2, storage_key='swapped' WHERE id=$1`, [file, H('c')], /FILE_VERSION_LOCKED/);
  await fails(`DELETE FROM files WHERE id=$1`, [file], /FILE_VERSION_LOCKED/);
  await fails(`INSERT INTO files(version_id, kind, filename, size_bytes, sha256, storage_key, key_wrapped, uploaded_by) VALUES ($1,'guide','extra.pdf',10,$2,'k2','w',$3)`, [version, H('d'), seller], /FILE_VERSION_LOCKED/);
  await q(`UPDATE files SET scan_malware='unscannable', scan_secret='passed' WHERE id=$1`, [file]);
  assert.equal((await q(`SELECT sha256 FROM files WHERE id=$1`, [file]))[0].sha256, H('a'));
});

test('주문 시점 조건(납품 버전·설명·금액·수수료)은 바꿀 수 없다', async () => {
  const v2 = (await q(`INSERT INTO file_versions(product_id, label, created_by) VALUES ($1,'2.0.0',$2) RETURNING id`, [product, seller]))[0].id;
  await fails(`UPDATE orders SET version_id=$2 WHERE id=$1`, [order, v2], /ORDER_TERMS_IMMUTABLE/);
  await fails(`UPDATE orders SET snapshot='{"title":"다른 상품"}' WHERE id=$1`, [order], /ORDER_TERMS_IMMUTABLE/);
  await fails(`UPDATE orders SET amount=1 WHERE id=$1`, [order], /ORDER_TERMS_IMMUTABLE/);
  await fails(`UPDATE orders SET fee_bps=0 WHERE id=$1`, [order], /ORDER_TERMS_IMMUTABLE/);
  // 판매자가 상품 설명을 바꾸거나 새 버전을 내도 기존 주문은 그대로다
  await q(`UPDATE products SET title='이름 변경', current_version_id=$2 WHERE id=$1`, [product, v2]);
  const o = (await q(`SELECT version_id, snapshot FROM orders WHERE id=$1`, [order]))[0];
  assert.equal(o.version_id, version); assert.equal(o.snapshot.title, '견적 자동화 소스');
});

test('상태 조합 불변식: 결제 없이 납품 접근 불가, 납품 없이 검수 불가, 분쟁 중 지급 대상 불가', async () => {
  await fails(`UPDATE orders SET delivery_status='granted' WHERE id=$1`, [order], /check/i);
  await fails(`UPDATE orders SET inspection_status='in_progress' WHERE id=$1`, [order], /check/i);
  await fails(`UPDATE orders SET payout_status='eligible' WHERE id=$1`, [order], /check/i);
  await q(`UPDATE orders SET payment_status='paid', delivery_status='granted', inspection_status='confirmed', payout_status='eligible' WHERE id=$1`, [order]);
  await fails(`UPDATE orders SET dispute_status='open' WHERE id=$1`, [order], /check/i); // 지급 대상을 유지한 채 분쟁을 열 수 없다
  await q(`UPDATE orders SET dispute_status='open', payout_status='blocked' WHERE id=$1`, [order]);
  await fails(`UPDATE orders SET refunded_amount=1000001 WHERE id=$1`, [order], /check/i);
  await q(`UPDATE orders SET dispute_status='resolved', payout_status='eligible' WHERE id=$1`, [order]);
});

test('주문당 지급은 1건, 지급 금액 항목의 합은 정산 기준 금액과 같아야 한다', async () => {
  const ins = `INSERT INTO payouts(order_id, seller_id, idempotency_key, seller_business_type, base_amount, fee_supply, fee_vat, pg_fee, seller_pg_fee, withholding_income_tax, withholding_local_tax, net_amount, status)
    VALUES ($1,$2,$3,'individual',1000000,100000,10000,33000,33000,25710,2570,$4,'requested')`;
  await fails(ins, [order, seller, 'payout-x-1', 999999], /check/i);
  await q(ins, [order, seller, `payout-${order}-1`, 828720]);
  await fails(ins, [order, seller, `payout-${order}-2`, 828720], /unique|duplicate/i);
  await fails(`UPDATE payouts SET status='paid' WHERE order_id=$1`, [order], /check/i); // 사업자 확인 없이 완료 처리 불가
  await q(`UPDATE payouts SET status='paid', external_confirmed_at=now(), paid_at=now() WHERE order_id=$1`, [order]);
});

test('환불은 결제 취소 성공 확인 없이 완료 처리할 수 없고, 멱등성 키는 유일하다', async () => {
  const id = (await q(`INSERT INTO refunds(order_id, amount, idempotency_key) VALUES ($1, 1000, 'refund-1') RETURNING id`, [order]))[0].id;
  await fails(`UPDATE refunds SET status='completed' WHERE id=$1`, [id], /check/i);
  await q(`UPDATE refunds SET status='completed', external_confirmed_at=now(), completed_at=now() WHERE id=$1`, [id]);
  await fails(`INSERT INTO refunds(order_id, amount, idempotency_key) VALUES ($1, 1000, 'refund-1')`, [order], /unique|duplicate/i);
});

test('중복 웹훅은 한 번만 저장된다', async () => {
  const ins = `INSERT INTO webhook_events(provider, event_id, type, payload, signature_ok) VALUES ('simpg','evt_1','payment.paid','{}',true) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`;
  assert.equal((await q(ins)).length, 1);
  assert.equal((await q(ins)).length, 0);
});

test('원장·감사 로그·다운로드 기록은 고치거나 지울 수 없고, 원장 ref 는 중복될 수 없다', async () => {
  await q(`INSERT INTO ledger_entries(order_id, kind, amount, ref) VALUES ($1,'payment_in',1000000,$2)`, [order, `pay:${order}`]);
  await fails(`INSERT INTO ledger_entries(order_id, kind, amount, ref) VALUES ($1,'payment_in',1000000,$2)`, [order, `pay:${order}`], /unique|duplicate/i);
  await fails(`UPDATE ledger_entries SET amount=1`, [], /APPEND_ONLY/);
  await fails(`DELETE FROM ledger_entries`, [], /APPEND_ONLY/);
  await q(`INSERT INTO audit_logs(actor_id, action) VALUES ($1,'dispute.resolve')`, [seller]);
  await fails(`DELETE FROM audit_logs`, [], /APPEND_ONLY/);
  await q(`INSERT INTO download_logs(order_id, file_id, user_id) VALUES ($1,$2,$3)`, [order, file, buyer]);
  await fails(`UPDATE download_logs SET ip='x'`, [], /APPEND_ONLY/);
});

test('분쟁 결정에는 결정·근거·처리자·일시가 모두 있어야 한다', async () => {
  const id = (await q(`INSERT INTO disputes(order_id, opened_by, reason, description) VALUES ($1,$2,'feature_mismatch','설명과 다름') RETURNING id`, [order, buyer]))[0].id;
  await fails(`UPDATE disputes SET status='resolved', decision='release' WHERE id=$1`, [id], /check/i);
  await q(`UPDATE disputes SET status='resolved', decision='release', decision_basis='설치 문서대로 실행 확인', decided_by=$2, decided_at=now() WHERE id=$1`, [id, seller]);
});

test('상품 구매로는 권리가 이전되지 않고, 실제 구매 1건당 후기는 1건이다', async () => {
  await fails(`INSERT INTO licenses(product_id, name, ip_transfer) VALUES ($1,'양도 포함', true)`, [product], /check/i);
  await q(`INSERT INTO reviews(order_id, product_id, buyer_id, rating, body) VALUES ($1,$2,$3,5,'설치 문서가 정확했습니다')`, [order, product, buyer]);
  await fails(`INSERT INTO reviews(order_id, product_id, buyer_id, rating, body) VALUES ($1,$2,$3,5,'한 번 더')`, [order, product, buyer], /unique|duplicate/i);
});

test('동의가 끝난 계약 버전은 바꿀 수 없고, 계정 자산은 공식 이전 증빙 없이 인수 확인할 수 없다', async () => {
  const c = (await q(`INSERT INTO contracts(buyer_id, seller_id) VALUES ($1,$2) RETURNING id`, [buyer, seller]))[0].id;
  const cv = (await q(`INSERT INTO contract_versions(contract_id, version_no, terms, created_by) VALUES ($1,1,'{"scope":"견적 모듈"}',$2) RETURNING id`, [c, seller]))[0].id;
  await q(`UPDATE contract_versions SET terms='{"scope":"견적·발주 모듈"}' WHERE id=$1`, [cv]); // 동의 전에는 수정 가능
  await q(`UPDATE contract_versions SET buyer_agreed_at=now(), seller_agreed_at=now() WHERE id=$1`, [cv]);
  await fails(`UPDATE contract_versions SET terms='{"scope":"전부"}' WHERE id=$1`, [cv], /CONTRACT_VERSION_IMMUTABLE/);
  const l = (await q(`INSERT INTO ip_listings(seller_id, title, right_type) VALUES ($1,'예약 앱 저작재산권','copyright_transfer') RETURNING id`, [seller]))[0].id;
  const d = (await q(`INSERT INTO ip_deals(listing_id, buyer_id) VALUES ($1,$2) RETURNING id`, [l, buyer]))[0].id;
  const item = (await q(`INSERT INTO ip_transfer_items(deal_id, asset_type, official_transfer_required) VALUES ($1,'service_asset',true) RETURNING id`, [d]))[0].id;
  await fails(`UPDATE ip_transfer_items SET buyer_confirmed_at=now() WHERE id=$1`, [item], /check/i); // 비밀번호 전달만으로는 완료 불가
  await q(`UPDATE ip_transfer_items SET official_transfer_evidence='앱 마켓 앱 이전 완료 메일', buyer_confirmed_at=now() WHERE id=$1`, [item]);
});
