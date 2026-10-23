// SELFTEST=1: 방위사업청 결과 상세/참가업체 파라미터 조합 시험
const one = (s) => s.replace(/\s+/g, ' ');
export async function selfTest() {
  const KEY = process.env.DATA_GO_KR_KEY;
  const R = 'https://apis.data.go.kr/1690000/BidResultInfoService';
  const B = 'https://apis.data.go.kr/1690000/BidPblancInfoService';
  const base = { pblancNo: 'LFC0144', pblancOdr: '1' };
  const tries = [
    [`${R}/getFcltyCmpetBidResultMnufList`, { ...base, orntCode: 'LFC' }],
    [`${R}/getFcltyCmpetBidResultMnufList`, { ...base, orntCode: 'LFC', pblancYear: '2026' }],
    [`${R}/getFcltyCmpetBidResultMnufList`, { ...base, orntCode: 'LFC', bidNo: 'LFC0144', bidOdr: '1', cntrwkNo: '2026-16421' }],
    [`${R}/getFcltyCmpetBidResultDetail`, { ...base, orntCode: 'LFC', pblancYear: '2026', cntrwkNo: '2026-16421' }],
    [`${B}/getFcltyCmpetBidPblancDetail`, { ...base, orntCode: 'LFC', pblancYear: '2026', cntrwkNo: '2026-16421' }],
  ];
  for (const [u, p] of tries) {
    try {
      const qs = new URLSearchParams({ ...p, numOfRows: '5', pageNo: '1' });
      const r = await fetch(`${u}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      console.log(`[D2BDBG3] ${u.split('/').pop()} ${JSON.stringify(p)} → ${r.status} ${one(t).slice(0, 3000)}`);
    } catch (e) { console.log(`[D2BDBG3] ${u} EXC ${e.message}`); }
  }
}
