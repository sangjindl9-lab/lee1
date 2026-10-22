// 국가철도공단 전자조달(ebid.kr.or.kr) 공개 화면 읽기 — 개찰결과·낙찰결과
// 공식 API가 없어 로그인 없이 공개된 화면을 읽음. 사이트 부담을 줄이려고 순차 요청 + 캐시.
const BASE = 'https://ebid.kr.or.kr';
const UA = 'Mozilla/5.0 (compatible; narabid-info/1.0; +https://narabid-info.onrender.com)';
const LIST = { award: '/krn/krnAwardList.do', openg: '/krn/krnBidOpengList.do' };
const DETAIL = { award: '/bid/rpt/bidAwardResult.do', openg: '/bid/rpt/bidOpengResult.do' };
const FN = { award: 'openScsbidPopUp', openg: 'openBidOpengPopUp' };

const listCache = new Map();   // key → {t, rows}
const detailCache = new Map(); // key → {t, data}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const text = (h) => String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const cells = (tr) => [...tr.matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => ({ tag: m[1].toLowerCase(), v: text(m[2]) }));
const num = (s) => String(s || '').replace(/[^0-9.]/g, '');

async function post(path, form, referer) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE + (referer || path) },
    body: new URLSearchParams(form), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`철도공단 사이트 응답 ${r.status}`);
  return r.text();
}

function parseList(type, html) {
  const rows = [];
  const re = new RegExp(`<tr[^>]*onclick="${FN[type]}\\(([^)]*)\\)[^>]*>([\\s\\S]*?)<\\/tr>`, 'gi');
  for (const m of html.matchAll(re)) {
    const args = [...m[1].matchAll(/'([^']*)'/g)].map((a) => a[1]);
    const [ggNyeondo, ggGubun, ggIrBeonho, ggChasu, gyErBeonho, crSangtae, gyBangBeob2, hsTbYeobu, icCyYeobu] = args;
    const c = cells(m[2]).map((x) => x.v);
    rows.push({
      key: { ggNyeondo, ggGubun, ggIrBeonho, ggChasu, gyErBeonho },
      negotiation: (gyBangBeob2 || '').indexOf('07') > 1, crSangtae, hsTbYeobu, icCyYeobu,
      kindNm: c[1], bidNtceNo: `${c[2]}-${ggChasu}`, bidNtceNm: c[3], amount: num(c[4]), opengDt: c[5], status: c[6],
    });
  }
  return rows;
}

// 개찰일 기간의 목록 전체 (페이지당 10건, 최대 maxPages)
export async function krList(type, from, to, maxPages = 40) {
  const k = `${type}|${from}|${to}`;
  const hit = listCache.get(k);
  if (hit && Date.now() - hit.t < 20 * 60 * 1000) return hit;
  let rows = []; let truncated = false;
  for (let p = 1; p <= maxPages; p++) {
    const html = await post(LIST[type], { pageIndex: String(p), fromDate: from, endDate: to, schGgGubun: '', ggNyeondoS: '', ggIrBeonhoS: '', icGonggomyeongS: '' });
    const pageRows = parseList(type, html);
    rows = rows.concat(pageRows);
    if (pageRows.length < 10) break;
    if (p === maxPages) truncated = true;
    await sleep(250);
  }
  const out = { t: Date.now(), rows, truncated };
  listCache.set(k, out);
  if (listCache.size > 50) listCache.delete(listCache.keys().next().value);
  return out;
}

// 상세(팝업) 화면: 항목-값 표 + 결과 표
export async function krDetail(type, key) {
  const k = `${type}|${key.ggNyeondo}-${key.ggGubun}-${key.ggIrBeonho}-${key.ggChasu}`;
  const hit = detailCache.get(k);
  if (hit && Date.now() - hit.t < 6 * 3600 * 1000) return hit.data;
  const html = await post(DETAIL[type], { ...key, mode: 'A' }, LIST[type]);
  const info = {}; const tables = [];
  for (const tb of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const trs = [...tb[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => cells(m[0]));
    const header = trs.find((r) => r.length > 2 && r.every((c) => c.tag === 'th'));
    if (header) {
      const cols = header.map((c) => c.v);
      const body = trs.filter((r) => r !== header && r.some((c) => c.tag === 'td') && r.length >= cols.length - 1)
        .map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]?.v ?? ''])));
      tables.push({ cols, rows: body });
    }
    for (const r of trs) { // th-td 쌍
      for (let i = 0; i < r.length - 1; i++) if (r[i].tag === 'th' && r[i + 1].tag === 'td') info[r[i].v] = r[i + 1].v;
    }
  }
  const col = (row, ...names) => { for (const n of names) { const hit2 = Object.keys(row).find((x) => x.replace(/\s/g, '').startsWith(n)); if (hit2) return row[hit2]; } return ''; };
  let bidders = [];
  const bidTable = tables.find((t) => t.cols.some((c) => /업체명/.test(c)));
  if (bidTable) {
    bidders = bidTable.rows.map((r) => ({
      rank: col(r, '저가순위', '순위'), bizno: num(col(r, '사업자등록번호', '사업자번호')), name: col(r, '업체명'), ceo: col(r, '대표자'),
      amount: num(col(r, '입찰금액', '낙찰금액')), rate: num(col(r, '투찰률')), rateA: num(col(r, 'A값')), note: col(r, '비고'), dt: col(r, '투찰일시'),
      jv: col(r, '공동수급'),
    })).filter((b) => b.name || b.bizno);
  }
  const data = {
    bidNtceNo: info['입찰공고번호'], bidNtceNm: info['입찰공고명'], amount: num(info['설계금액']), presmptPrce: num(info['추정가격']),
    plnprc: num(info['예정가격']), method: info['계약방법'], selection: info['낙찰자선정방식'], standard: info['심사기준'],
    lowerRate: num(info['낙찰하한율(%)'] || info['낙찰하한율']), prearng: info['예가방식'], period: info['입찰서접수기간'],
    opengDt: info['개찰일시'], status: info['처리상태'], place: info['개찰장소'], notice: info['유의사항'] || '',
    bidders,
  };
  detailCache.set(k, { t: Date.now(), data });
  if (detailCache.size > 3000) detailCache.delete(detailCache.keys().next().value);
  return data;
}

const dkey = (type, k) => `${type}|${k.ggNyeondo}-${k.ggGubun}-${k.ggIrBeonho}-${k.ggChasu}`;
let warming = false;
async function warm(type, rows) { // 나머지 상세를 천천히 미리 받아둠
  if (warming) return; warming = true;
  try {
    for (const r of rows) {
      if (r.negotiation && type === 'openg') continue;
      if (detailCache.has(dkey(type, r.key))) continue;
      try { await krDetail(type, r.key); } catch { /* 무시 */ }
      await sleep(400);
    }
  } finally { warming = false; }
}

function merge(type, r, d, err) {
  const top = d?.bidders?.[0];
  return {
    ...r, detailError: err || '', detailLoaded: !!d,
    presmptPrce: d?.presmptPrce || '', plnprc: d?.plnprc || '', lowerRate: d?.lowerRate || '', method: d?.method || '', selection: d?.selection || '',
    winnerNm: top?.name || '', winnerBizno: top?.bizno || '', winnerCeo: top?.ceo || '', winnerAmt: top?.amount || '', winnerRate: top?.rate || '',
    bidderCount: d?.bidders?.length || 0,
  };
}

// 목록 + 상세(1순위/낙찰업체). 요청한 페이지 분량만 상세를 받고, 나머지는 백그라운드로 미리 받음
export async function krResults(type, from, to, { q = '', page = 1, size = 30 } = {}) {
  const list = await krList(type, from, to);
  const words = q.split(/\s+/).filter(Boolean);
  const rows = list.rows.filter((r) => words.every((w) => r.bidNtceNm.includes(w)));
  const slice = rows.slice((page - 1) * size, page * size);
  const out = [];
  for (const r of slice) {
    if (r.negotiation && type === 'openg') { out.push(merge(type, r, null, '협상에의한계약: 개찰결과 비공개')); continue; }
    const cached = detailCache.get(dkey(type, r.key));
    let d = cached?.data || null; let err = '';
    if (!d) {
      try { d = await krDetail(type, r.key); } catch (e) { err = e.message; }
      await sleep(150);
    }
    out.push(merge(type, r, d, err));
  }
  warm(type, rows);
  return { rows: out, total: rows.length, truncated: list.truncated };
}
