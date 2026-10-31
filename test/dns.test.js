'use strict';
/* 고객 주소 자동 연결 — 가짜 Railway·Cloudflare 로 시험 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/dns');

function fakes(existing = []) {
  const made = [];
  const cf = async (method, path, body) => {
    if (path.startsWith('/zones?')) return [{ id: 'z1' }];
    if (method === 'GET') return existing.filter((n) => path.includes(encodeURIComponent(n)));
    made.push(body); return {};
  };
  const gql = async (_q, v) => ({ customDomainCreate: { id: 'd', domain: v.input.domain, status: {
    dnsRecords: [{ fqdn: v.input.domain, recordType: 'DNS_RECORD_TYPE_CNAME', requiredValue: 'abc.up.railway.app' }],
    verificationDnsHost: `_railway-verify.${v.input.domain.split('.')[0]}`, verificationToken: 'railway-verify=tok' } } });
  return { cf, gql, made };
}
const d = { projectId: 'p', environmentId: 'e', appServiceId: 's' };

test('회사코드 주소 + CNAME·TXT 등록', async () => {
  const f = fakes();
  const host = await D.attachCustomerDomain({ ...f, zone: 'ieumerp.kr', d, code: 'HN', bizRegNo: '1234567890' });
  assert.equal(host, 'hn.ieumerp.kr');
  assert.deepEqual(f.made.map((x) => [x.type, x.name, x.content, x.proxied]), [
    ['CNAME', 'hn.ieumerp.kr', 'abc.up.railway.app', false],
    ['TXT', '_railway-verify.hn.ieumerp.kr', 'railway-verify=tok', false],
  ]);
});

test('이미 쓰는 이름·예약어면 사업자번호 끝 4자리 붙임', async () => {
  const f = fakes(['hn.ieumerp.kr']);
  assert.equal(await D.attachCustomerDomain({ ...f, zone: 'ieumerp.kr', d, code: 'HN', bizRegNo: '1234567890' }), 'hn-7890.ieumerp.kr');
  assert.equal(await D.attachCustomerDomain({ ...fakes(), zone: 'ieumerp.kr', d, code: 'SS', bizRegNo: '2208660440' }), 'ss-0440.ieumerp.kr');
});
