// SELFTEST=1: 방위사업청 통합 점검
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
export async function selfTest(base) {
  const now = new Date(Date.now() + 9 * 3600 * 1000); const from = new Date(now.getTime() - 6 * 86400000);
  const q = (extra) => new URLSearchParams({ inqryBgnDt: `${ymd(from)}0000`, inqryEndDt: `${ymd(now)}2359`, numOfRows: '200', pageNo: '1', ...extra });
  for (const [path, extra] of [['bids/Cnstwk', { inqryDiv: '1' }], ['bids/Thng', { inqryDiv: '1', bidNtceNm: '' }], ['award/All', { inqryDiv: '2' }]]) {
    const t = Date.now();
    const d = await fetch(`${base}/api/${path}?${q(extra)}`).then((r) => r.json()).catch((e) => ({ error: e.message }));
    const mine = (d.items || []).filter((r) => r._org === 'd2b');
    console.log(`[SELFTEST] ${path} → ${d.error || `total=${d.totalCount} orgs=${JSON.stringify(d.orgCounts)}`} ${Date.now() - t}ms`);
    mine.slice(0, 3).forEach((r) => console.log(`[SELFTEST]   d2b ${r._kind} ${r.bidNtceNm} | ${r.dminsttNm} | ${r.presmptPrce} | ${r.bidNtceDt || ''} ${r.opengDt || ''} ${r.awardStatus || ''}`));
  }
}
