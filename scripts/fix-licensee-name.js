'use strict';
/**
 * 고객 이름을 바로잡고, 같은 조건(사용자 수·만료일·옵션·저장 용량)으로 '변경' 라이선스를 다시 발급한다.
 * 이름이 이미 맞으면 아무것도 하지 않는다 (Railway 에 서비스로 걸려 있으면 push 할 때마다 실행되므로).
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
  const FIX_MEMO = '회사명 정정 재발급';
  // 같은 조건으로 다시 발급 — 판매 옵션·맞춤 모듈·저장 용량도 그대로 가져간다 (빼먹으면 고객 ERP에서 공무지원 메뉴가 사라진다)
  const issue = async (src, memo) => {
    // 날짜 칸은 서버 시간대의 자정으로 읽히므로 그 시간대 그대로 적는다 (UTC 로 바꾸면 하루 당겨질 수 있다)
    const d = new Date(src.expires_at);
    const expiresAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const modules = Array.isArray(src.modules) ? src.modules : [];
    const storageMB = src.storage_mb ?? 1024;
    const payload = { licenseId: crypto.randomUUID(), licensee: name, bizRegNo: biz, maxUsers: src.max_users, storageMB, issuedAt: new Date().toISOString(), expiresAt, modules: ['all', ...modules], edition: src.edition || 'standard', deployment: c.deployment };
    const text = L.sign(payload, privateKey);
    if (!L.verify(text, publicKey)) throw new Error('서명 확인 실패');
    await q(
      `insert into license(customer_id, license_id, kind, max_users, starts_on, expires_at, edition, amount, memo, license_text, issued_at, storage_mb, modules) values ($1,$2,'CHANGE',$3,$4,$5,$6,0,$7,$8,$9,$10,$11)`,
      [c.id, payload.licenseId, src.max_users, L.kstToday(), expiresAt, payload.edition, memo, text, payload.issuedAt, storageMB, JSON.stringify(modules)],
    );
    await q('insert into audit_log(action, summary) values ($1,$2)', ['LICENSE_ISSUE', `변경 발급(${memo}) ${name} ${src.max_users}명 ~${expiresAt}${modules.length ? ` 옵션 ${modules.join(',')}` : ''}`]);
    console.log(`완료 — 새 라이선스 ${payload.licenseId.slice(0, 8).toUpperCase()} 발급 (${memo}${modules.length ? `, 옵션 ${modules.join(',')}` : ''}). ERP 에서 '지금 확인'을 누르면 반영됩니다.`);
  };
  if (c.name !== name) {
    await q('update customer set name=$1, updated_at=now() where id=$2', [name, c.id]).catch(() => q('update customer set name=$1 where id=$2', [name, c.id]));
    await issue(last, FIX_MEMO);
  } else if (last.memo === FIX_MEMO) {
    // 이름은 이미 맞는데 예전 이 스크립트가 옵션 없이 다시 발급해 둔 상태 — 그 전에 사람이 발급한 라이선스의 옵션·용량으로 되돌린다
    const [good] = (await q(`select * from license where customer_id=$1 and kind <> 'SUSPEND' and memo is distinct from $2 order by issued_at desc limit 1`, [c.id, FIX_MEMO])).rows;
    if (good) await issue({ ...good, expires_at: last.expires_at, max_users: last.max_users }, '옵션 복구 재발급');
    else console.log('되돌릴 이전 라이선스가 없습니다 — 아무것도 하지 않습니다.');
  } else {
    console.log('이름이 이미 같습니다 — 아무것도 하지 않습니다.');
  }
  await pool.end();
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
