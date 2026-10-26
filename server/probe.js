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
  const vm = await import('node:vm');
  const pages = {};
  for (const p of ['/goods/inList.do?code=A03&gubun=1', '/js/common.js']) { pages[p] = (await get(p)).html; await new Promise((r) => setTimeout(r, 500)); }
  const all = pages['/js/common.js'] + pages['/goods/inList.do?code=A03&gubun=1'];
  const i0 = all.search(/function\s+fn_add_param\s*\(/);
  let fa = null;
  if (i0 >= 0) { let d = 0, j = all.indexOf('{', i0); for (let k = j; k < all.length; k++) { if (all[k] === '{') d++; else if (all[k] === '}' && --d === 0) { fa = [all.slice(i0, k + 1)]; break; } } }
  console.log(`[PROBE] fn_add_param: ${fa ? fa[0].replace(/\s+/g, ' ').slice(0, 800) : '없음'}`);
  const inl = pages['/goods/inList.do?code=A03&gubun=1'];
  for (const m of inl.matchAll(/ZFUNCNM['"]?\s*[:=]\s*['"](\w+)['"]/g)) {
    const pre = inl.slice(Math.max(0, m.index - 2500), m.index);
    console.log(`[PROBE] inList → ${m[1]} :: ${pre.slice(pre.lastIndexOf('new Array()')).replace(/\s+/g, ' ').slice(0, 1500)}`);
  }
  if (!fa) return;
  const ctx = {}; vm.createContext(ctx); vm.runInContext(fa[0], ctx); console.log(`[PROBE] sample ptab: ${JSON.stringify(ctx.fn_add_param([], 'I_X', '1', false))}`);
  const call = async (fn, params) => {
    let ptab = [];
    for (const [k, v] of params) ptab = ctx.fn_add_param(ptab, k, v, false);
    const r = await fetch(B + '/comnRfc.do', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: B + '/goods/inList.do', ...(cookie ? { Cookie: cookie } : {}) },
      body: new URLSearchParams({ p: JSON.stringify(ptab), fn: JSON.stringify({ ZFUNCNM: fn }) }), signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    console.log(`[PROBE] call ${fn} → ${r.status} len=${t.length} ${t.slice(0, 1800)}`);
  };
  const ymd = (ms) => new Date(Date.now() + 9 * 3600e3 - ms).toISOString().slice(0, 10).replaceAll('-', '');
  await call('ZMME_EBID_INFO_0009F', [['I_ZZBIDTYPECODE', '1'], ['I_ZZCTRMETHOD', ''], ['I_BSART', ''], ['I_ZZBIDINV', ''], ['I_DESCRIPTION', ''], ['I_ERDAT_FR', ymd(14 * 864e5)], ['I_ERDAT_TO', ymd(0)], ['I_SDAT_FR', ''], ['I_SDAT_TO', ''], ['I_LIFNR', '']]);
  await call('ZMME_EBID_INFO_0014', [['I_POART', '2'], ['I_EBELN', ''], ['I_ZZCTRDESC', ''], ['I_GUBUN', 'A'], ['I_ZZCONTRWAY', ''], ['I_ZZBIDINV', ''], ['I_DAT_FR', ymd(30 * 864e5)], ['I_DAT_TO', ymd(0)]]);
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
