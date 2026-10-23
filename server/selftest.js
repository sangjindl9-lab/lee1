// SELFTEST=1: 업체검색 가능 여부 확인 (사용자정보서비스)
const one = (s) => s.replace(/\s+/g, ' ');
export async function selfTest() {
  const KEY = process.env.DATA_GO_KR_KEY;
  const base = 'https://apis.data.go.kr/1230000/ao/UsrInfoService02';
  const tries = [
    ['getPrcrmntCorpBasicInfo02', { inqryDiv: '1', inqryBgnDt: '200001010000', inqryEndDt: '202610232359', corpNm: '에스에스전력' }],
    ['getPrcrmntCorpBasicInfo02', { inqryDiv: '2', inqryBgnDt: '202601010000', inqryEndDt: '202610232359', corpNm: '에스에스전력' }],
    ['getPrcrmntCorpBasicInfo02', { inqryDiv: '1', inqryBgnDt: '202610010000', inqryEndDt: '202610232359', corpNm: '전력' }],
    ['getPrcrmntCorpBasicInfo02', { inqryDiv: '2', inqryBgnDt: '202501010000', inqryEndDt: '202610232359', corpNm: '서화통신' }],
    ['getPrcrmntCorpIndstrytyInfo02', { inqryDiv: '1', bizno: '4168129536' }],
  ];
  for (const [op, p] of tries) {
    try {
      const qs = new URLSearchParams({ ...p, type: 'json', numOfRows: '5', pageNo: '1' });
      const r = await fetch(`${base}/${op}?serviceKey=${encodeURIComponent(KEY)}&${qs}`, { signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      console.log(`[CORPDBG] ${op} ${JSON.stringify(p)} → ${r.status} ${one(t).slice(0, 1500)}`);
    } catch (e) { console.log(`[CORPDBG] ${op} EXC ${e.message}`); }
  }
}
