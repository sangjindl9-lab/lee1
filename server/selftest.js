// SELFTEST=1: 등록업체 전체 규모·한 번에 받을 수 있는 양 확인
export async function selfTest() {
  const KEY = process.env.DATA_GO_KR_KEY;
  const base = 'https://apis.data.go.kr/1230000/ao/UsrInfoService02/getPrcrmntCorpBasicInfo02';
  let sum = 0;
  for (const y of [2026, 2025, 2020, 2015, 2010, 2005, 2002]) {
    const t = Date.now();
    try {
      const qs = new URLSearchParams({ inqryDiv: '1', inqryBgnDt: `${y}01010000`, inqryEndDt: `${y}12312359`, type: 'json', numOfRows: '999', pageNo: '1' });
      const txt = await fetch(`${base}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(60000) }).then((r) => r.text());
      const total = Number((txt.match(/"totalCount"\s*:\s*(\d+)/) || [])[1] || 0);
      const got = (txt.match(/"bizno"/g) || []).length;
      sum += total;
      console.log(`[IDXDBG] ${y} total=${total} got=${got} bytes=${txt.length} ${Date.now() - t}ms ${total ? '' : txt.slice(0, 200)}`);
    } catch (e) { console.log(`[IDXDBG] ${y} EXC ${e.message} ${Date.now() - t}ms`); }
  }
  console.log(`[IDXDBG] 표본 7개 연도 합계 ${sum}`);
}
