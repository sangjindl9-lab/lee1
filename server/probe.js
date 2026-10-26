// 임시: 한국철도공사 전자조달(ebid.korail.com) 공개 화면 구조 확인 + 국토관리청·교육청 수집 확인 — [PROBE] 로그
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const B = 'https://ebid.korail.com';
const txt = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
let cookie = '';
async function get(path, opt = {}) {
  const r = await fetch(B + path, { ...opt, headers: { 'User-Agent': UA, Referer: `${B}/main.do`, ...(cookie ? { Cookie: cookie } : {}), ...(opt.headers || {}) }, signal: AbortSignal.timeout(20000) });
  const sc = r.headers.get('set-cookie'); if (sc && !cookie) cookie = sc.split(';')[0];
  return { status: r.status, url: r.url, html: await r.text() };
}
function dump(tag, { status, url, html }) {
  console.log(`[PROBE] ${tag} → ${status} ${url} len=${html.length} login=${/로그인이 필요|login\.do|세션이 만료/.test(html)}`);
  const forms = [...html.matchAll(/<form[^>]*>/gi)].map((m) => m[0]).slice(0, 4);
  console.log(`[PROBE]   forms: ${forms.join(' ')}`);
  const inputs = [...html.matchAll(/<(?:input|select)[^>]*name=["']([^"']+)["'][^>]*?(?:value=["']([^"']*)["'])?/gi)].map((m) => `${m[1]}=${m[2] || ''}`);
  console.log(`[PROBE]   inputs: ${[...new Set(inputs)].slice(0, 60).join(' & ')}`);
  const ths = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => txt(m[1])).filter(Boolean);
  console.log(`[PROBE]   th: ${ths.slice(0, 30).join(' | ')}`);
  const trs = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[0]).filter((t) => /<td/i.test(t));
  console.log(`[PROBE]   rows=${trs.length}`);
  trs.slice(0, 3).forEach((t) => console.log(`[PROBE]   tr: ${t.replace(/\s+/g, ' ').slice(0, 900)}`));
  const fns = [...new Set([...html.matchAll(/(?:onclick|href)="(?:javascript:)?\s*([a-zA-Z_]\w*)\(/gi)].map((m) => m[1]))];
  console.log(`[PROBE]   fns: ${fns.join(', ')}`);
  for (const f of fns.slice(0, 8)) {
    const m = html.match(new RegExp(`function\\s+${f}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]{0,700}`));
    if (m) console.log(`[PROBE]   def ${f}: ${m[0].replace(/\s+/g, ' ').slice(0, 700)}`);
  }
}
async function korail() {
  for (const p of ['/main.do', '/goods/inList.do?code=A03&gubun=1', '/goods/contList.do?code=A04&gubun=2', '/goods/openDetail.do?code=A04&gubun=']) {
    try {
      const { html } = await get(p);
      for (const m of html.matchAll(/ZFUNCNM"\s*:\s*"(\w+)"/g)) {
        const pre = html.slice(Math.max(0, m.index - 1500), m.index);
        const fnName = (pre.match(/function\s+(\w+)\s*\([^)]*\)\s*\{(?![\s\S]*function\s+\w+\s*\()/) || [])[1] || '?';
        const params = [...pre.slice(pre.lastIndexOf('new Array()')).matchAll(/fn_add_param\(ptab,\s*"(\w+)",\s*([^,]{0,80}),/g)].map((x) => `${x[1]}=${x[2].replace(/\s+/g, '')}`);
        console.log(`[PROBE] ${p} ${fnName} → ${m[1]} (${params.join(', ')})`);
      }
      const tbl = [...html.matchAll(/(?:ET_\w+)/g)].map((x) => x[0]);
      console.log(`[PROBE] ${p} tables: ${[...new Set(tbl)].join(', ')}`);
      const fa = html.match(/function\s+fn_add_param[\s\S]{0,500}/);
      if (fa) console.log(`[PROBE] fn_add_param: ${fa[0].replace(/\s+/g, ' ')}`);
    } catch (e) { console.log(`[PROBE] ${p} 실패 ${e.message}`); }
    await new Promise((r) => setTimeout(r, 800));
  }
}
async function g2bOrgs(base) {
  const kst = (ms) => new Date(Date.now() + 9 * 3600e3 - ms).toISOString().slice(0, 10).replaceAll('-', '');
  const w = `inqryBgnDt=${kst(30 * 864e5)}0000&inqryEndDt=${kst(0)}2359&numOfRows=3&pageNo=1`;
  for (const org of ['국토관리청', '교육청', '교육지원청']) {
    for (const [lab, path] of [
      ['입찰공고 공고기관', `/api/bid/getBidPblancListInfoCnstwkPPSSrch?inqryDiv=1&${w}&ntceInsttNm=${encodeURIComponent(org)}`],
      ['입찰공고 수요기관', `/api/bid/getBidPblancListInfoCnstwkPPSSrch?inqryDiv=1&${w}&dminsttNm=${encodeURIComponent(org)}`],
      ['개찰결과 수요기관', `/api/scs/getOpengResultListInfoCnstwkPPSSrch?inqryDiv=1&${w}&dminsttNm=${encodeURIComponent(org)}`],
      ['최종낙찰 수요기관', `/api/scs/getScsbidListSttusCnstwkPPSSrch?inqryDiv=1&${w}&dminsttNm=${encodeURIComponent(org)}`],
    ]) {
      try {
        const d = await fetch(base + path, { signal: AbortSignal.timeout(60000) }).then((r) => r.json());
        const ex = (d.items || []).slice(0, 2).map((x) => `${x.dminsttNm || x.ntceInsttNm}:${(x.bidNtceNm || '').slice(0, 25)}`).join(' / ');
        console.log(`[PROBE] G2B ${org} ${lab} 최근30일 공사 → ${d.error || `${d.totalCount}건`} ${ex}`);
      } catch (e) { console.log(`[PROBE] G2B ${org} ${lab} 실패 ${e.message}`); }
    }
  }
}
export async function probe(base) {
  await korail().catch((e) => console.log('[PROBE] korail fail', e.message));
}
