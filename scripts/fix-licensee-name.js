'use strict';
/**
 * 고객 이름을 바로잡고, 같은 조건(사용자 수·만료일)으로 '변경' 라이선스를 다시 발급한다.
 * 이미 발급된 라이선스는 서명돼 있어 이름을 고칠 수 없으므로 새로 발급해야 ERP 에 새 이름이 보인다.
 *   사용: FIX_BIZNO=2208660440 FIX_NAME='㈜에스에스전력' node scripts/fix-licensee-name.js
 *   환경: DATABASE_URL, LICENSE_PRIVATE_KEY (발급 사이트와 같은 값)
 */
const crypto = require('crypto');
const { Pool } = require('pg');
const L = require('../lib/license');

(async () => {
  const biz = L.normBiz(process.env.FIX_BIZNO || '');
  const name = (process.env.FIX_NAME || '').trim();
  if (!biz || !name) throw new Error('FIX_BIZNO, FIX_NAME 이 필요합니다');
  const privateKey = L.loadPrivateKey(process.env.LICENSE_PRIVATE_KEY);
  const publicKey = L.publicKeyPem(privateKey);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = (sql, p) => pool.query(sql, p);
  const [c] = (await q('select * from customer where biz_reg_no=$1', [biz])).rows;
  if (!c) throw new Error(`사업자번호 ${biz} 고객이 없습니다`);
  const [last] = (await q(`select * from license where customer_id=$1 and kind <> 'SUSPEND' order by issued_at desc limit 1`, [c.id])).rows;
  if (!last) throw new Error('발급된 라이선스가 없습니다');
  console.log(`고객 "${c.name}" → "${name}", 마지막 라이선스 ${last.kind} ${last.max_users}명 ~${String(last.expires_at).slice(0, 10)}`);
  if (c.name !== name) await q('update customer set name=$1, updated_at=now() where id=$2', [name, c.id]).catch(() => q('update customer set name=$1 where id=$2', [name, c.id]));
  const expiresAt = new Date(last.expires_at).toISOString().slice(0, 10);
  const payload = { licenseId: crypto.randomUUID(), licensee: name, bizRegNo: biz, maxUsers: last.max_users, issuedAt: new Date().toISOString(), expiresAt, modules: ['all'], edition: last.edition || 'standard', deployment: c.deployment };
  const text = L.sign(payload, privateKey);
  if (!L.verify(text, publicKey)) throw new Error('서명 확인 실패');
  await q(
    `insert into license(customer_id, license_id, kind, max_users, starts_on, expires_at, edition, amount, memo, license_text, issued_at) values ($1,$2,'CHANGE',$3,$4,$5,$6,0,$7,$8,$9)`,
    [c.id, payload.licenseId, last.max_users, L.kstToday(), expiresAt, payload.edition, '회사명 정정 재발급', text, payload.issuedAt],
  );
  await q('insert into audit_log(action, summary) values ($1,$2)', ['LICENSE_ISSUE', `변경 발급(회사명 정정) ${name} ${last.max_users}명 ~${expiresAt}`]);
  console.log(`완료 — 새 라이선스 ${payload.licenseId.slice(0, 8).toUpperCase()} 발급. ERP 에서 '지금 확인'을 누르면 반영됩니다.`);
  await pool.end();
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
