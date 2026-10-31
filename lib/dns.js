'use strict';
/**
 * 고객 서버에 `회사코드.ieumerp.kr` 주소를 붙인다.
 *   Railway 에 사용자 도메인을 만들고 → 요구하는 CNAME·TXT 를 Cloudflare DNS 에 넣는다.
 * CF_API_TOKEN(영역 DNS 편집 권한)이 있을 때만 쓴다.
 */
const CF = 'https://api.cloudflare.com/client/v4';
const RESERVED = new Set(['ss', 'admin', 'www', 'api', 'mail', 'test', 'samwoo']);

function cloudflare(token, endpoint = CF) {
  return async function cf(method, path, body) {
    const res = await fetch(endpoint + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) throw new Error(`Cloudflare: ${j.errors?.map((e) => e.message).join(' / ') || `HTTP ${res.status}`}`);
    return j.result;
  };
}

/** 이 이름이 이미 쓰이고 있으면 회사코드-사업자번호끝4자리 로 */
async function pickHost(cf, zoneId, zone, code, bizRegNo) {
  const taken = async (h) => (await cf('GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(`${h}.${zone}`)}`)).length > 0;
  const first = code.toLowerCase();
  if (!RESERVED.has(first) && !(await taken(first))) return first;
  return `${first}-${bizRegNo.slice(-4)}`;
}

/**
 * @returns 붙인 주소(예: hn.ieumerp.kr)
 */
async function attachCustomerDomain({ gql, cf, zone, d, code, bizRegNo }) {
  const zones = await cf('GET', `/zones?name=${encodeURIComponent(zone)}`);
  if (!zones.length) throw new Error(`Cloudflare 에 ${zone} 영역이 없습니다`);
  const zoneId = zones[0].id;
  const host = await pickHost(cf, zoneId, zone, code, bizRegNo);
  const fqdn = `${host}.${zone}`;
  const r = await gql(
    `mutation($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { id domain status { dnsRecords { fqdn recordType requiredValue } verificationDnsHost verificationToken } } }`,
    { input: { domain: fqdn, projectId: d.projectId, environmentId: d.environmentId, serviceId: d.appServiceId, targetPort: 8080 } },
  );
  const st = r.customDomainCreate.status ?? {};
  const recs = (st.dnsRecords ?? []).map((x) => ({ type: /TXT/.test(x.recordType) ? 'TXT' : 'CNAME', name: x.fqdn, content: x.requiredValue }));
  if (!recs.some((x) => x.type === 'TXT') && st.verificationToken) {
    const name = st.verificationDnsHost ? (st.verificationDnsHost.endsWith(zone) ? st.verificationDnsHost : `${st.verificationDnsHost}.${zone}`) : `_railway-verify.${fqdn}`;
    recs.push({ type: 'TXT', name, content: st.verificationToken.startsWith('railway-verify=') ? st.verificationToken : `railway-verify=${st.verificationToken}` });
  }
  if (!recs.some((x) => x.type === 'CNAME')) throw new Error('Railway 가 연결값(CNAME)을 주지 않았습니다');
  for (const x of recs) {
    if (!x.name || !x.content) continue;
    await cf('POST', `/zones/${zoneId}/dns_records`, { type: x.type, name: x.name, content: x.content, ttl: 1, proxied: false, comment: `이음ERP 고객 ${bizRegNo}` });
  }
  return fqdn;
}

module.exports = { cloudflare, attachCustomerDomain };
