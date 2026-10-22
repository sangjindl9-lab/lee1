// SELFTEST=1 일 때 서버 시작 직후 실제 API로 필터 동작을 점검해 로그에 남김
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

export async function selfTest(base) {
  const now = new Date();
  const from = new Date(now.getTime() - 6 * 86400000);
  const dates = { inqryBgnDt: `${ymd(from)}0000`, inqryEndDt: `${ymd(now)}2359` };
  const cases = [
    ['scs', 'getScsbidListSttusCnstwkPPSSrch', { inqryDiv: '2' }],
    ['scs', 'getScsbidListSttusCnstwkPPSSrch', { inqryDiv: '2', bidNtceNm: '전기' }],
    ['scs', 'getScsbidListSttusCnstwkPPSSrch', { inqryDiv: '2', indstrytyNm: '전기' }],
    ['scs', 'getScsbidListSttusCnstwkPPSSrch', { inqryDiv: '2', indstrytyNm: '전기공사업' }],
    ['scs', 'getScsbidListSttusCnstwkPPSSrch', { inqryDiv: '2', prtcptLmtRgnCd: '51' }],
    ['scs', 'getOpengResultListInfoCnstwkPPSSrch', { inqryDiv: '2' }],
    ['scs', 'getOpengResultListInfoCnstwkPPSSrch', { inqryDiv: '2', bidNtceNm: '전기' }],
    ['scs', 'getOpengResultListInfoCnstwkPPSSrch', { inqryDiv: '2', indstrytyNm: '전기공사업' }],
    ['bid', 'getBidPblancListInfoCnstwkPPSSrch', { inqryDiv: '1' }],
    ['bid', 'getBidPblancListInfoCnstwkPPSSrch', { inqryDiv: '1', bidNtceNm: '전기' }],
    ['bid', 'getBidPblancListInfoCnstwkPPSSrch', { inqryDiv: '1', indstrytyNm: '전기공사업' }],
  ];
  for (const [svc, op, p] of cases) {
    const qs = new URLSearchParams({ ...dates, ...p, numOfRows: '5', pageNo: '1' });
    try {
      const r = await fetch(`${base}/api/${svc}/${op}?${qs}`);
      const d = await r.json();
      const titles = (d.items || []).slice(0, 5).map((x) => x.bidNtceNm).join(' | ');
      console.log(`[SELFTEST] ${op} ${JSON.stringify(p)} → ${d.error ? `ERROR ${d.error}` : `total=${d.totalCount}`} :: ${titles}`);
    } catch (e) {
      console.log(`[SELFTEST] ${op} ${JSON.stringify(p)} → EXC ${e.message}`);
    }
  }
}
