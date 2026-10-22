// SELFTEST=1 일 때 서버 시작 직후 실제 API로 검색 동작을 점검해 로그에 남김
export async function selfTest(base) {
  const cases = [
    ['award', 'All', { inqryDiv: '2', inqryBgnDt: '202610160000', inqryEndDt: '202610212359', prtcptLmtRgnCd: '51', indstrytyNm: '정보통신' }],
    ['award', 'Cnstwk', { inqryDiv: '2', inqryBgnDt: '202610160000', inqryEndDt: '202610212359', prtcptLmtRgnCd: '51', indstrytyNm: '전기공사업' }],
    ['award', 'Cnstwk', { inqryDiv: '2', inqryBgnDt: '202610160000', inqryEndDt: '202610212359', prtcptLmtRgnCd: '51', indstrytyNm: '전기공사업,정보통신공사업' }],
    ['bid', 'getBidPblancListInfoCnstwkPPSSrch', { inqryDiv: '1', inqryBgnDt: '202610160000', inqryEndDt: '202610222359', prtcptLmtRgnCd: '51', indstrytyNm: '전기공사업,정보통신공사업' }],
  ];
  for (const [svc, op, p] of cases) {
    const qs = new URLSearchParams({ ...p, numOfRows: '20', pageNo: '1' });
    const t = Date.now();
    try {
      const r = await fetch(`${base}/api/${svc}/${op}?${qs}`);
      const d = await r.json();
      const titles = (d.items || []).slice(0, 6).map((x) => `${x._kind}:${x.bidNtceNm}:${x.awardStatus}:${x.bidwinnrNm}:${x.sucsfbidAmt}:${x.presmptPrce}`).join(' | ');
      console.log(`[SELFTEST] ${svc}/${op} ${JSON.stringify(p)} → ${d.error ? `ERROR ${d.error}` : `total=${d.totalCount}`} (${Date.now() - t}ms) :: ${titles}`);
    } catch (e) {
      console.log(`[SELFTEST] ${svc}/${op} → EXC ${e.message}`);
    }
  }
}
