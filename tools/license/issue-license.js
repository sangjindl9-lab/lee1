#!/usr/bin/env node
/**
 * SS-ERP 라이선스 발급기 (판매자 전용 — 고객 배포본에 포함 금지)
 *
 * 사용법:
 *   node issue-license.js --licensee "㈜에스에스전력" --bizno 1234567890 --users 20 --expires 2027-12-31 [--modules all]
 *
 * keys/vendor-private.pem 은 절대 외부에 유출하지 마세요. 유출되면 누구나 라이선스를 만들 수 있습니다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

const licensee = arg('licensee');
const bizRegNo = (arg('bizno') || '').replace(/[^0-9]/g, '');
const maxUsers = Number(arg('users', '10'));
const expiresAt = arg('expires');
const modules = (arg('modules', 'all') || 'all').split(',');

if (!licensee || bizRegNo.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt || '') || !(maxUsers > 0)) {
  console.error('필수값: --licensee 회사명 --bizno 사업자번호10자리 --users 사용자수 --expires YYYY-MM-DD');
  process.exit(1);
}

const keyPath = process.env.LICENSE_PRIVATE_KEY || path.join(__dirname, 'keys', 'vendor-private.pem');
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));

const payload = {
  licenseId: crypto.randomUUID(),
  licensee,
  bizRegNo,
  maxUsers,
  issuedAt: new Date().toISOString(),
  expiresAt,
  modules,
  edition: arg('edition', 'standard'),
};
const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.sign(null, Buffer.from(body), privateKey).toString('base64url');
const license = `${body}.${sig}`;

console.log(license);
if (arg('out')) {
  fs.writeFileSync(arg('out'), license + '\n');
  console.error(`저장: ${arg('out')}`);
}
