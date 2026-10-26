// 임시: 한국철도공사 전자조달(ebid.korail.com) 공개 화면 구조 확인용 — [PROBE] 로그
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const URLS = [
  'https://ebid.korail.com/',
  'http://ebid.korail.com/',
  'https://ebid.korail.com/index.jsp',
  'https://ebid.korail.com/main.do',
];
export async function probe() {
  for (const u of URLS) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const h = await r.text();
      const title = (h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim();
      console.log(`[PROBE] ${u} → ${r.status} ${r.url} len=${h.length} title=${title} cookie=${(r.headers.get('set-cookie') || '').slice(0, 80)}`);
      const links = [...new Set([...h.matchAll(/(?:href|src|action|location\.href\s*=|url\s*:)\s*=?\s*["']([^"'#]{3,200})["']/gi)].map((m) => m[1]))]
        .filter((x) => !/\.(css|png|gif|jpg|svg|ico|woff)/i.test(x));
      console.log(`[PROBE]   links(${links.length}): ${links.slice(0, 80).join(' | ')}`);
      const fns = [...new Set([...h.matchAll(/(?:onclick|href)="javascript:\s*([^"]{3,120})"|onclick="([^"]{3,120})"/gi)].map((m) => m[1] || m[2]))];
      console.log(`[PROBE]   js(${fns.length}): ${fns.slice(0, 60).join(' | ')}`);
      if (h.length < 3000) console.log(`[PROBE]   body: ${h.replace(/\s+/g, ' ').slice(0, 1500)}`);
    } catch (e) { console.log(`[PROBE] ${u} → 실패 ${e.message}`); }
  }
}
