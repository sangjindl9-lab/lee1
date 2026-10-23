// SELFTEST=1: 방위사업청 입찰공고·결과 API 형식 확인 (호출 한도 하루 100회 → 최소 호출)
const one = (s) => s.replace(/\s+/g, ' ');
export async function selfTest() {
  const KEY = process.env.DATA_GO_KR_KEY;
  const B = 'https://apis.data.go.kr/1690000/BidPblancInfoService';
  const R = 'https://apis.data.go.kr/1690000/BidResultInfoService';
  const tries = [
    [`${B}/getFcltyCmpetBidPblancList`, { anmtDateBegin: '20261016', anmtDateEnd: '20261023' }],
    [`${R}/getFcltyCmpetBidResultList`, { opengDateBegin: '20261016', opengDateEnd: '20261023' }],
    [`${R}/getFcltyCmpetBidResultList`, { anmtDateBegin: '20261001', anmtDateEnd: '20261023' }],
    [`${R}/getFcltyCmpetBidResultList`, {}],
  ];
  for (const [u, p] of tries) {
    try {
      const qs = new URLSearchParams({ ...p, numOfRows: '3', pageNo: '1' });
      const r = await fetch(`${u}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      console.log(`[D2BDBG] ${u.split('/').pop()} ${JSON.stringify(p)} → ${r.status} ${one(t).slice(0, 2500)}`);
    } catch (e) { console.log(`[D2BDBG] ${u} EXC ${e.message}`); }
  }
}
