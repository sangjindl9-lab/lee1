// SELFTEST=1 일 때 서버 시작 직후 실제 API 응답을 점검해 로그에 남김
export async function selfTest(base) {
  const urls = [
    '/api/usr/getPrcrmntCorpBasicInfo02?inqryDiv=3&bizno=1388155769&numOfRows=5&pageNo=1',
    '/api/usr/getPrcrmntCorpBasicInfo02?inqryDiv=3&bizno=2268151323&numOfRows=5&pageNo=1',
    '/api/usr/getPrcrmntCorpBasicInfo02?inqryDiv=1&inqryBgnDt=202610010000&inqryEndDt=202610222359&numOfRows=2&pageNo=1',
  ];
  for (const u of urls) {
    try {
      const r = await fetch(base + u);
      const t = await r.text();
      console.log(`[SELFTEST] ${u} → ${r.status} ${t.slice(0, 900)}`);
    } catch (e) {
      console.log(`[SELFTEST] ${u} → EXC ${e.message}`);
    }
  }
}
