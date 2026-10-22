// SELFTEST=1 일 때 서버 시작 직후 실제 API로 검색 동작을 점검해 로그에 남김
export async function selfTest(base) {
  const cases = [
    ['company', '1388155769', {}], ['company', '4168129536', {}], ['company', '2258113758', {}],
  ];
  for (const [svc, op, p] of cases) {
    const qs = new URLSearchParams({ ...p, numOfRows: '20', pageNo: '1' });
    const t = Date.now();
    try {
      const r = await fetch(`${base}/api/${svc}/${op}?${qs}`);
      const d = await r.json();
      const titles = d.found !== undefined ? JSON.stringify(d) : (d.items || []).slice(0, 6).map((x) => `${x._kind}:${x.bidNtceNm}:${x.awardStatus}:${x.bidwinnrNm}:${x.sucsfbidAmt}:${x.presmptPrce}`).join(' | ');
      console.log(`[SELFTEST] ${svc}/${op} ${JSON.stringify(p)} → ${d.error ? `ERROR ${d.error}` : `total=${d.totalCount}`} (${Date.now() - t}ms) :: ${titles}`);
    } catch (e) {
      console.log(`[SELFTEST] ${svc}/${op} → EXC ${e.message}`);
    }
  }
}
