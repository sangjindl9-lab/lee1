// SELFTEST=1: 철도공단 개찰 상세의 순위표 페이지 구조 확인
const UA = 'Mozilla/5.0 (compatible; narabid-info/1.0)';
const one = (s) => s.replace(/\s+/g, ' ');
export async function selfTest() {
  const key = { ggNyeondo: '2026', ggGubun: '01', ggIrBeonho: '000183', ggChasu: '00', gyErBeonho: '', mode: 'A' };
  // 목록에서 정선선 건의 gyErBeonho 찾기
  const lst = await fetch('https://ebid.kr.or.kr/krn/krnBidOpengList.do', { headers: { 'User-Agent': UA } }).then((r) => r.text());
  const m = lst.match(/openBidOpengPopUp\('2026','01','000183','00','(\d+)'/);
  if (m) key.gyErBeonho = m[1];
  const html = await fetch('https://ebid.kr.or.kr/bid/rpt/bidOpengResult.do', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://ebid.kr.or.kr/krn/krnBidOpengList.do' }, body: new URLSearchParams(key) }).then((r) => r.text());
  console.log(`[KRDBG2] key=${JSON.stringify(key)} len=${html.length} trs=${(html.match(/<tr/gi) || []).length}`);
  for (const k of ['pageIndex', 'paging', 'linkPage', '더보기', 'ajax', '.do', 'iframe']) {
    let i = html.indexOf(k); let n = 0;
    while (i >= 0 && n < 3) { console.log(`[KRDBG2] @${k} ${one(html.slice(Math.max(0, i - 200), i + 300))}`); i = html.indexOf(k, i + 1); n++; }
  }
  const tail = html.slice(html.indexOf('저가순위'));
  console.log(`[KRDBG2] afterHeader ${one(tail.slice(0, 2500))}`);
}
