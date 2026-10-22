// SELFTEST=1 일 때 서버 시작 직후 업체 연락처 조회를 점검해 로그에 남김
export async function selfTest(base) {
  // 유비트론(1순위), 평화건설(1순위), 서화통신(낙찰확정)
  for (const b of ['1388155769', '2268151323', '4168129536']) {
    try {
      const r = await fetch(`${base}/api/company/${b}`);
      const d = await r.json();
      console.log(`[SELFTEST] company/${b} → source=${d.source} usrState=${d.usrState || ''} ${d.name || ''} | ${d.ceo || ''} | ${d.adrs || ''} | ${d.tel || ''} ${d.usrError || d.error || ''}`);
    } catch (e) {
      console.log(`[SELFTEST] company/${b} → EXC ${e.message}`);
    }
  }
}
