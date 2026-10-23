// SELFTEST=1: 통합 입찰공고·낙찰정보 점검 (나라장터 + 타기관)
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
export async function selfTest(base) {
  const now = new Date(Date.now() + 9 * 3600 * 1000); const from = new Date(now.getTime() - 6 * 86400000);
  const q = (extra) => new URLSearchParams({ inqryBgnDt: `${ymd(from)}0000`, inqryEndDt: `${ymd(now)}2359`, numOfRows: '5', pageNo: '1', ...extra });
  const cases = [
    ['bids/Cnstwk', { inqryDiv: '1', indstrytyNm: '전기공사업' }],
    ['bids/Cnstwk', { inqryDiv: '1', prtcptLmtRgnCd: '51', indstrytyNm: '전기공사업' }],
    ['award/All', { inqryDiv: '2', indstrytyNm: '전기공사업' }],
    ['award/All', { inqryDiv: '2' }],
  ];
  for (const [path, extra] of cases) {
    const t = Date.now();
    try {
      const d = await fetch(`${base}/api/${path}?${q(extra)}`).then((r) => r.json());
      console.log(`[SELFTEST] ${path} ${JSON.stringify(extra)} → ${d.error || `total=${d.totalCount} orgs=${JSON.stringify(d.orgCounts)}`} ${Date.now() - t}ms :: ${(d.items || []).map((r) => `[${r._org}]${r.bidNtceNm?.slice(0, 25)}${r.bidwinnrNm ? `/${r.bidwinnrNm}` : ''}`).join(' | ')}`);
    } catch (e) { console.log(`[SELFTEST] ${path} EXC ${e.message}`); }
  }
}
