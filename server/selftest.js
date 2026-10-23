// SELFTEST=1: 한국수자원공사 전자조달 API 응답 형식 확인
const one = (s) => s.replace(/\s+/g, ' ');
export async function selfTest() {
  const KEY = process.env.DATA_GO_KR_KEY;
  const base = 'https://apis.data.go.kr/B500001/ebid/tndr3';
  const tries = [
    ['cntrwkList', '_type=json&numOfRows=2&pageNo=1'],
    ['cntrwkList', 'type=json&numOfRows=2&pageNo=1'],
    ['cntrwkList', 'numOfRows=2&pageNo=1'],
    ['rstList', '_type=json&numOfRows=2&pageNo=1'],
    ['rstList', 'numOfRows=2&pageNo=1'],
  ];
  for (const [op, q] of tries) {
    try {
      const r = await fetch(`${base}/${op}?serviceKey=${encodeURIComponent(KEY)}&${q}`, { signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      console.log(`[KWDBG] ${op}?${q} → ${r.status} ${one(t).slice(0, 2500)}`);
    } catch (e) { console.log(`[KWDBG] ${op} EXC ${e.message}`); }
  }
}
