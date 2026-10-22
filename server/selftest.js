// SELFTEST=1 일 때 서버 시작 직후 업체 연락처 일괄 조회를 점검해 로그에 남김
export async function selfTest(base) {
  const t = Date.now();
  try {
    const r = await fetch(`${base}/api/companies?b=1388155769,2268151323,4168129536,2258113758,4940300598`);
    const d = await r.json();
    for (const [b, c] of Object.entries(d.companies || {})) {
      console.log(`[SELFTEST] ${b} → ${c.source || '-'} ${c.name || ''} | ${c.ceo || ''} | ${c.adrs || ''} | ${c.tel || ''}`);
    }
    console.log(`[SELFTEST] batch done ${Date.now() - t}ms usrState=${d.usrState}`);
  } catch (e) {
    console.log(`[SELFTEST] EXC ${e.message}`);
  }
}
