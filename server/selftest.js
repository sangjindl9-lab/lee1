// SELFTEST=1: 방위사업청 시설 입찰결과 참가업체·상세 형식 (최소 호출)
const one = (s) => s.replace(/\s+/g, ' ');
export async function selfTest() {
  const KEY = process.env.DATA_GO_KR_KEY;
  const R = 'https://apis.data.go.kr/1690000/BidResultInfoService';
  const tries = [
    [`${R}/getFcltyCmpetBidResultMnufList`, { pblancNo: 'LFC0144', pblancOdr: '1' }],
    [`${R}/getFcltyCmpetBidResultDetail`, { pblancNo: 'LFC0144', pblancOdr: '1' }],
    [`${R}/getFcltyCmpetBidResultMnufList`, { pblancNo: 'LFC0144', pblancOdr: '1', cntrwkNo: '2026-16421', pblancYear: '2026' }],
  ];
  for (const [u, p] of tries) {
    try {
      const qs = new URLSearchParams({ ...p, numOfRows: '5', pageNo: '1' });
      const r = await fetch(`${u}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      console.log(`[D2BDBG2] ${u.split('/').pop()} ${JSON.stringify(p)} → ${r.status} ${one(t).slice(0, 3000)}`);
    } catch (e) { console.log(`[D2BDBG2] ${u} EXC ${e.message}`); }
  }
}
