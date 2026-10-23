// SELFTEST=1: 업체명 검색 허용 기간 확인
const one = (s) => s.replace(/\s+/g, ' ');
export async function selfTest() {
  const KEY = process.env.DATA_GO_KR_KEY;
  const base = 'https://apis.data.go.kr/1230000/ao/UsrInfoService02/getPrcrmntCorpBasicInfo02';
  const tries = [
    ['3개월', '202607230000', '202610232359'], ['6개월', '202604230000', '202610232359'], ['1년', '202510240000', '202610232359'],
    ['2년', '202410240000', '202610232359'], ['5년', '202110240000', '202610232359'],
  ];
  for (const [label, b, e] of tries) {
    const t = Date.now();
    try {
      const qs = new URLSearchParams({ inqryDiv: '1', inqryBgnDt: b, inqryEndDt: e, corpNm: '전력', type: 'json', numOfRows: '3', pageNo: '1' });
      const r = await fetch(`${base}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(40000) });
      const txt = await r.text();
      const total = (txt.match(/"totalCount"\s*:\s*(\d+)/) || [])[1];
      const err = (txt.match(/"resultMsg"\s*:\s*"([^"]+)"/) || [])[1];
      console.log(`[CORPDBG2] ${label} → total=${total} msg=${err} ${Date.now() - t}ms`);
    } catch (x) { console.log(`[CORPDBG2] ${label} EXC ${x.message} ${Date.now() - t}ms`); }
  }
  // 서화통신 등록일 찾기: 연도별
  for (const y of ['2002', '2003', '2005', '2010']) {
    try {
      const qs = new URLSearchParams({ inqryDiv: '1', inqryBgnDt: `${y}01010000`, inqryEndDt: `${y}12312359`, corpNm: '서화통신', type: 'json', numOfRows: '3', pageNo: '1' });
      const txt = await fetch(`${base}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(40000) }).then((r) => r.text());
      console.log(`[CORPDBG2] 서화통신 ${y} → ${one(txt).slice(0, 300)}`);
    } catch (x) { console.log(`[CORPDBG2] 서화통신 ${y} EXC ${x.message}`); }
  }
}
