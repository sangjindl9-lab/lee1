// SELFTEST=1: 국가철도공단 전자조달 화면 구조 파악(진단)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const one = (s) => s.replace(/\s+/g, ' ');

async function dump(label, url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, method: opts.method || 'GET', body: opts.body, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const html = await r.text();
    console.log(`[KRDBG] ${label} status=${r.status} len=${html.length} ctype=${r.headers.get('content-type')} cookie=${(r.headers.get('set-cookie') || '').slice(0, 120)}`);
    const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/gi)].map((m) => m[0]);
    forms.slice(0, 3).forEach((f, i) => {
      const head = (f.match(/<form[^>]*>/i) || [''])[0];
      const inputs = [...f.matchAll(/<(input|select)[^>]*name="([^"]+)"[^>]*?(?:value="([^"]*)")?/gi)].map((m) => `${m[2]}=${m[3] || ''}`);
      console.log(`[KRDBG] ${label} form${i} ${one(head)} :: ${inputs.slice(0, 40).join('&')}`);
    });
    const rows = [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => one(m[0]));
    console.log(`[KRDBG] ${label} rows=${rows.length}`);
    rows.slice(0, 4).forEach((t, i) => console.log(`[KRDBG] ${label} tr${i} ${t.slice(0, 1500)}`));
    const fns = [...new Set([...html.matchAll(/function\s+(fn\w*|go\w*|view\w*|detail\w*|search\w*|page\w*)\s*\([^)]*\)\s*\{[\s\S]{0,400}?\}/g)].map((m) => one(m[0]).slice(0, 500)))];
    fns.slice(0, 8).forEach((f) => console.log(`[KRDBG] ${label} fn ${f}`));
    const pg = html.match(/<div[^>]*(paging|pagination)[^>]*>[\s\S]{0,1200}?<\/div>/i);
    if (pg) console.log(`[KRDBG] ${label} paging ${one(pg[0]).slice(0, 1200)}`);
    return html;
  } catch (e) {
    console.log(`[KRDBG] ${label} EXC ${e.message}`);
    return '';
  }
}

function around(label, html, key, n = 1400) {
  let i = html.indexOf(key); let k = 0;
  while (i >= 0 && k < 3) { console.log(`[KRDBG] ${label} @${key} ${one(html.slice(Math.max(0, i - 50), i + n))}`); i = html.indexOf(key, i + 1); k++; }
}
export async function selfTest() {
  const a = await fetch('https://ebid.kr.or.kr/krn/krnAwardList.do', { headers: { 'User-Agent': UA } }).then((r) => r.text());
  around('awardList', a, 'function search()', 1600);
  const dates = [...a.matchAll(/id="(fromDate|endDate)"[^>]*value="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`);
  console.log(`[KRDBG] dateInputs ${dates.join(' ')} ${one((a.match(/<input[^>]*fromDate[^>]*>/) || [''])[0])}`);
  const post = (url, f) => fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://ebid.kr.or.kr/krn/krnAwardList.do' }, body: new URLSearchParams(f) }).then((r) => r.text());
  // 낙찰결과 샘플: 태백선 예미~백산 배전선로 실시설계 (2026-02-000520)
  const award = await post('https://ebid.kr.or.kr/bid/rpt/bidAwardResult.do', { ggNyeondo: '2026', ggGubun: '02', ggIrBeonho: '000520', ggChasu: '00', gyErBeonho: '2000012945', mode: 'A' });
  console.log(`[KRDBG] award len=${award.length}`);
  [...award.matchAll(/<tr[\s\S]*?<\/tr>/gi)].slice(0, 25).forEach((m, i) => console.log(`[KRDBG] award tr${i} ${one(m[0]).replace(/<[^>]+>/g, '|').replace(/\|+\s*\|*/g, '|').slice(0, 600)}`));
  // 개찰결과 샘플: 수서역사 소방설비 개량공사 (2026-01-000213)
  const op = await post('https://ebid.kr.or.kr/bid/rpt/bidOpengResult.do', { ggNyeondo: '2026', ggGubun: '01', ggIrBeonho: '000213', ggChasu: '00', gyErBeonho: '1000012806', mode: 'A' });
  console.log(`[KRDBG] openg len=${op.length}`);
  [...op.matchAll(/<tr[\s\S]*?<\/tr>/gi)].slice(0, 25).forEach((m, i) => console.log(`[KRDBG] openg tr${i} ${one(m[0]).replace(/<[^>]+>/g, '|').replace(/\|+\s*\|*/g, '|').slice(0, 600)}`));
  // 목록 기간검색 (POST)
  const lst = await post('https://ebid.kr.or.kr/krn/krnAwardList.do', { pageIndex: '2', fromDate: '2026-09-01', endDate: '2026-10-22', schGgGubun: '' });
  const rows = [...lst.matchAll(/openScsbidPopUp\(([^)]*)\)/g)].length;
  console.log(`[KRDBG] listPost page2 rows=${rows} total=${one((lst.match(/총[^<]{0,30}건/) || [''])[0])}`);
}
