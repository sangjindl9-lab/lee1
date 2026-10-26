// 서버 시작 2분 뒤 기관별 API를 한 번씩 호출해 [CHECK] 로그로 남김 (CHECK=0 이면 끔)
const kst = (ms = 0) => new Date(Date.now() + 9 * 3600 * 1000 - ms);
const d10 = (ms) => kst(ms).toISOString().slice(0, 10);
const g2b = (ms, end) => `${d10(ms).replaceAll('-', '')}${end ? '2359' : '0000'}`;
const DAY = 86400000;

export async function selfTest(base) {
  const w = `inqryDiv=1&inqryBgnDt=${g2b(7 * DAY)}&inqryEndDt=${g2b(0, 1)}&numOfRows=5&pageNo=1`;
  const checks = [
    ['나라장터 입찰공고', `/api/bid/getBidPblancListInfoCnstwkPPSSrch?${w}`],
    ['나라장터 개찰결과', `/api/scs/getOpengResultListInfoCnstwkPPSSrch?${w.replace('inqryDiv=1', 'inqryDiv=1')}`],
    ['나라장터 최종낙찰', `/api/scs/getScsbidListSttusCnstwkPPSSrch?${w}`],
    ['조달업체 정보(usr)', `/api/usr/getPrcrmntCorpBasicInfo02?bizno=2208660440&numOfRows=1&pageNo=1&inqryDiv=3`],
    ['한국수자원공사 공사', `/api/kwater/cntrwk?from=${d10(29 * DAY)}&to=${d10()}`],
    ['한국수자원공사 용역', `/api/kwater/servc?from=${d10(29 * DAY)}&to=${d10()}`],
    ['한국수자원공사 낙찰', `/api/kwater/rst?from=${d10(29 * DAY)}&to=${d10()}`],
    ['국가철도공단 개찰(크롤링)', `/api/krbid/openg?from=${d10(7 * DAY)}&to=${d10()}`],
    ['국가철도공단 낙찰(크롤링)', `/api/krbid/award?from=${d10(7 * DAY)}&to=${d10()}`],
    ['국가철도공단 파일', `/api/ext/kr?numOfRows=1`],
    ['한국철도공사 파일', `/api/ext/korail?numOfRows=1`],
    ['방위사업청 시설 낙찰파일', `/api/ext/d2bfac?numOfRows=1`],
    ['통합 입찰공고(방위사업청 포함)', `/api/bids/Cnstwk?${w.replace('numOfRows=5', 'numOfRows=1')}`],
    ['통합 낙찰정보', `/api/award/Cnstwk?inqryDiv=2&inqryBgnDt=${g2b(7 * DAY)}&inqryEndDt=${g2b(0, 1)}&numOfRows=1&pageNo=1`],
  ];
  for (const [name, path] of checks) {
    const t = Date.now();
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(120000) });
      const d = await r.json().catch(() => ({ error: `응답 형식 오류 (HTTP ${r.status})` }));
      const n = d.totalCount ?? d.items?.length;
      const extra = d.orgCounts ? ` 기관별=${JSON.stringify(d.orgCounts)}` : d.latest ? ` 최신=${d.latest}` : '';
      console.log(`[CHECK] ${d.error ? '실패' : n ? '정상' : '0건'} | ${name} | ${d.error || `${n}건${extra}`} | ${Date.now() - t}ms`);
    } catch (e) {
      console.log(`[CHECK] 실패 | ${name} | ${e.message} | ${Date.now() - t}ms`);
    }
  }
  console.log(`[CHECK] 한국전력(KEPCO) | ${process.env.KEPCO_API_KEY ? '키 있음' : 'KEPCO_API_KEY 없음 → 호출 안 함'}`);
}
