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

export async function selfTest() {
  await dump('opengList', 'https://ebid.kr.or.kr/krn/krnBidOpengList.do');
  await dump('awardList', 'https://ebid.kr.or.kr/krn/krnAwardList.do');
}
