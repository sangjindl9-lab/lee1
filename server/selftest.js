// SELFTEST=1 일 때 서버 시작 직후 실제 API로 필터 동작을 점검해 로그에 남김
export async function selfTest(base) {
  const d1 = { inqryBgnDt: '202610160000', inqryEndDt: '202610212359' };
  const cases = [];
  for (const kind of ['Cnstwk', 'Thng']) {
    const op = `getScsbidListSttus${kind}PPSSrch`;
    cases.push(['scs', op, { inqryDiv: '2', prtcptLmtRgnCd: '51' }]);
    cases.push(['scs', op, { inqryDiv: '2', prtcptLmtRgnCd: '42' }]);
    cases.push(['scs', op, { inqryDiv: '2', prtcptLmtRgnNm: '강원' }]);
    cases.push(['scs', op, { inqryDiv: '2', prtcptLmtRgnCd: '51', indstrytyNm: '정보통신' }]);
    cases.push(['scs', op, { inqryDiv: '2', indstrytyNm: '정보통신' }]);
    cases.push(['scs', op, { inqryDiv: '2', bidNtceNm: 'CCTV' }]);
    cases.push(['bid', `getBidPblancListInfo${kind}PPSSrch`, { inqryDiv: '2', indstrytyNm: '정보통신' }]);
    cases.push(['bid', `getBidPblancListInfo${kind}PPSSrch`, { inqryDiv: '2', prtcptLmtRgnCd: '51', indstrytyNm: '정보통신' }]);
  }
  for (const [svc, op, p] of cases) {
    const qs = new URLSearchParams({ ...d1, ...p, numOfRows: '8', pageNo: '1' });
    try {
      const r = await fetch(`${base}/api/${svc}/${op}?${qs}`);
      const d = await r.json();
      const titles = (d.items || []).slice(0, 8).map((x) => `${x.bidNtceNo}:${x.bidNtceNm}`).join(' | ');
      console.log(`[SELFTEST] ${op} ${JSON.stringify(p)} → ${d.error ? `ERROR ${d.error}` : `total=${d.totalCount}`} ${d.debug ? JSON.stringify(d.debug) : ''} :: ${titles}`);
    } catch (e) {
      console.log(`[SELFTEST] ${op} ${JSON.stringify(p)} → EXC ${e.message}`);
    }
  }
}
