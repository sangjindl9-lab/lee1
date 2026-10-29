// 한국철도공사 전자조달(ebid.korail.com) 실시간 조회
// 공식 API가 없어, 로그인 없이 공개된 화면이 쓰는 조회 기능(/comnRfc.do)을 그대로 호출. 캐시로 사이트 부담 최소화
const B = 'https://ebid.korail.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const TTL = 10 * 60 * 1000;
const cache = new Map(); // key → {t, rows}
const inflight = new Map();
let cookie = ''; let cookieT = 0;

async function session() {
  if (cookie && Date.now() - cookieT < 20 * 60 * 1000) return cookie;
  const r = await fetch(`${B}/main.do`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  await r.text();
  const sc = r.headers.get('set-cookie');
  if (sc) { cookie = sc.split(';')[0]; cookieT = Date.now(); }
  return cookie;
}

// fn_add_param 과 같은 형식: [{name, value_string}]
export async function rfc(fn, params, referer = '/goods/inList.do') {
  const ptab = Object.entries(params).map(([name, v]) => ({ value_string: v, name }));
  const ck = await session();
  const r = await fetch(`${B}/comnRfc.do`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: B + referer, ...(ck ? { Cookie: ck } : {}) },
    body: new URLSearchParams({ p: JSON.stringify(ptab), fn: JSON.stringify({ ZFUNCNM: fn }) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`철도공사 사이트 응답 ${r.status}`);
  const outer = await r.json();
  const data = JSON.parse(outer.data);
  const out = {};
  for (const group of Object.values(data)) for (const x of group) out[x.name] = x.value;
  if (out.E_SUBRC === 'E') throw new Error(`철도공사 조회 오류: ${out.E_MSG || ''}`);
  return out;
}

const iso = (d) => (/^\d{8}$/.test(d || '') && d !== '00000000' ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '');
const hm = (t) => (t && t !== '00:00:00' ? ` ${t.slice(0, 5)}` : '');
const amt = (v) => { const n = String(v || '').replace(/[^0-9]/g, ''); return n ? String(Number(n)) : ''; };
const plain = (d) => d.replaceAll('-', '');
const kindOf = (way = '', title = '') => {
  if (/공사/.test(way)) return 'Cnstwk';
  if (/용역/.test(way)) return 'Servc';
  if (/물품|구매|제조/.test(way)) return 'Thng';
  if (/용역|감리|설계|진단|점검|위탁/.test(title)) return 'Servc'; // '…개량공사 책임감리용역'은 용역
  if (/공사/.test(title)) return 'Cnstwk';
  return 'Thng';
};
const tableOf = (out) => Object.entries(out).find(([k, v]) => /^ET_/.test(k) && Array.isArray(v))?.[1] || [];

// 기간을 31일 단위로 나눠 순차 조회 (캐시 10분)
async function ranged(tag, from, to, fetchChunk) {
  const key = `${tag}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.rows;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const rows = [];
    let s = new Date(from);
    const end = new Date(to);
    while (s <= end) {
      const e = new Date(Math.min(end, s.getTime() + 30 * 86400000));
      rows.push(...await fetchChunk(s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)));
      s = new Date(e.getTime() + 86400000);
    }
    cache.set(key, { t: Date.now(), rows });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return rows;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// 입찰공고 (공고일 기준)
let BIDTYPES = ['1', '2', '3', '4'];
const BIDTYPE_KIND = {};
async function noticeChunk(code, f, t) {
  try {
    const out = await rfc('ZMME_EBID_INFO_0009F', {
      I_ZZBIDTYPECODE: code, I_ZZCTRMETHOD: '', I_BSART: '', I_ZZBIDINV: '', I_DESCRIPTION: '',
      I_ERDAT_FR: plain(f), I_ERDAT_TO: plain(t), I_SDAT_FR: '', I_SDAT_TO: '', I_LIFNR: '',
    });
    return tableOf(out).map((x) => ({ ...x, _code: code }));
  } catch (e) { if (/데이터가 없/.test(e.message)) return []; throw e; }
}
export function korailNotices(from, to) {
  return ranged('notice', from, to, async (f, t) => {
    const all = [];
    for (const code of BIDTYPES) all.push(...await noticeChunk(code, f, t));
    const seen = new Set();
    return all.filter((x) => { const k = `${x.zzbidinv}/${x.zzstnum}`; return !seen.has(k) && seen.add(k); }).map((x) => {
      const no = String(x.zzbidinv || '');
      return {
        _org: 'korail', _orgNm: '철도공사', _kind: BIDTYPE_KIND[x._code] || kindOf(x.zzwayofbidding_t, x.description),
        bidNtceNo: no.replace(/-\d+$/, ''), bidNtceOrd: String(x.zzstnum || '00').padStart(3, '0'), bidNtceNm: x.description || '',
        ntceInsttNm: '한국철도공사', dminsttNm: `한국철도공사 ${x.eknam || ''}`.trim(), presmptPrce: '',
        cntrctCnclsMthdNm: [x.zzctrmethod_t, x.zzwayofbidding_t].filter(Boolean).join(' · '),
        ntceKindNm: x.zzbidinv_new ? '정정공고' : '등록공고',
        bidNtceDt: iso(x.zzbid_erdat) + hm(x.zzbid_ertim), bidBeginDt: iso(x.zzbid_sdat) + hm(x.zzbid_stim),
        bidClseDt: iso(x.zzbid_edat) + hm(x.zzbid_etim), opengDt: '',
        _status: x.zzbidinfo_new_t || '', _officer: '', bidNtceDtlUrl: `${B}/`, _korailNo: no,
      };
    });
  });
}

// 계약 결과 = 낙찰 (계약일 기준 조회, 공사·물품·용역 전부)
export async function korailContracts(from, to) {
  const rows = await contractsRaw(from, to);
  queueBizno(rows);
  return rows.map((r) => (r.bidwinnrBizno || !vendorBiz.get(r._korailVendor) ? r : { ...r, ...vendorBiz.get(r._korailVendor) }));
}
function contractsRaw(from, to) {
  return ranged('cont', from, to, async (f, t) => {
    const all = [];
    for (const poart of POARTS) {
      const out = await rfc('ZMME_EBID_INFO_0014', {
        I_POART: poart, I_EBELN: '', I_ZZCTRDESC: '', I_GUBUN: 'A', I_ZZCONTRWAY: '', I_ZZBIDINV: '',
        I_DAT_FR: plain(f), I_DAT_TO: plain(t),
      }, '/goods/contList.do').catch((e) => { if (/데이터가 없/.test(e.message)) return {}; throw e; });
      all.push(...tableOf(out).map((x) => ({ ...x, _poart: poart })));
    }
    const seen = new Set();
    return all.filter((x) => !seen.has(x.ebeln) && seen.add(x.ebeln)).map((x) => {
      const basic = amt(x.blwrt1); const pln = amt(x.blwrt2); const won = amt(x.blwrt3);
      return {
        _org: 'korail', _orgNm: '철도공사', _kind: POART_KIND[x._poart] || kindOf(x.zzwayofbidding_txt, x.zzctrdesc),
        bidNtceNo: x.zzbidinv || x.ebeln, bidNtceOrd: '000', bidNtceNm: x.zzctrdesc || '',
        ntceInsttNm: '한국철도공사', dminsttNm: `한국철도공사 ${x.eknam || ''}`.trim(), presmptPrce: basic,
        awardStatus: '계약완료', bidwinnrNm: x.name1 || '', bidwinnrBizno: '', bidwinnrCeoNm: x.j_1kfrepre || '', bidwinnrAdrs: x.ort01 || '',
        sucsfbidAmt: won, sucsfbidRate: won && Number(pln) ? (Number(won) / Number(pln) * 100).toFixed(3) : '', prtcptCnum: '',
        opengDt: iso(x.zzopenday) || iso(x.bedat), rlOpengDt: iso(x.zzopenday) || iso(x.bedat),
        cntrctCnclsMthdNm: [x.zzcontrway_txt, x.zzwayofbidding_txt].filter(Boolean).join(' · '),
        _plnprc: pln, _basic: basic, _cntrctDt: iso(x.bedat), _cntrctNo: x.ebeln, _korailVendor: x.lifnr,
        bidNtceDtlUrl: `${B}/`,
      };
    });
  });
}
// 계약 목록 구분값 (화면: 계약현황). 시작 시 점검 로그로 확인한 값만 사용
// 1 물품 · 2 공사 · 3 용역 · 4 외자 (6 매각은 제외) — 2026-10 확인
const POARTS = ['1', '2', '3', '4'];
const POART_KIND = { 1: 'Thng', 2: 'Cnstwk', 3: 'Servc', 4: 'Frgcpt' };

// 낙찰업체 사업자번호: 개찰결과 상세(공고별 참가업체 목록)에 있음 → 업체코드별로 기억해 두고 계약결과에 채움
const vendorBiz = new Map(); // 철도공사 업체코드 → {bidwinnrBizno, bidwinnrCeoNm}
const tried = new Set();
const queue = [];
let running = false;
function queueBizno(rows) {
  for (const r of rows) {
    if (!r._korailVendor || vendorBiz.has(r._korailVendor) || !/^\d{7}-\d{2}$/.test(r.bidNtceNo) || tried.has(r.bidNtceNo)) continue;
    tried.add(r.bidNtceNo); queue.push(r.bidNtceNo);
  }
  if (!running && queue.length) drain();
}
async function drain() {
  running = true;
  while (queue.length) {
    const no = queue.shift();
    try { await korailOpeng(no); } catch (e) { if (!/데이터가 없/.test(e.message)) console.log(`[korail] 개찰상세 ${no} 실패 ${e.message}`); }
    await new Promise((r) => setTimeout(r, 400)); // 사이트 부담 줄이기
  }
  running = false;
}
const opengCache = new Map(); // 공고번호 → {t, d}
// 개찰결과 상세: 참가업체 순위·사업자번호·대표자·투찰금액·투찰률
export async function korailOpeng(no) {
  const c0 = opengCache.get(no);
  if (c0 && (c0.final || Date.now() - c0.t < 30 * 60 * 1000)) return c0.d;
  const m = String(no).match(/^(\d{7})-?(\d{2})?$/);
  if (!m) return null;
  const out = await rfc('ZMME_EBID_INFO_0016', { I_ZZBIDINV: `${m[1]}-${m[2] || '00'}`, I_ZZSTNUM: m[2] || '00' }, '/goods/openDetail.do');
  const head = (out.ET_ZSMMEEBID0012 || [])[0] || {};
  const list = (out.ET_ZSMMEEBID0014 || []).map((x) => ({
    rank: x.num, name: String(x.name1 || '').replace(/&amp;amp;|&amp;/g, '&'), bizno: String(x.stcd2 || '').replace(/[^0-9]/g, ''), ceo: x.j_1kfrepre || '',
    amt: x.zzvalue ? String(Math.round(x.zzvalue)) : '', rate: x.zzvalue_rate || '', decision: x.zzdecision_t || '', vendor: x.lifnr,
  }));
  for (const c of list) if (c.vendor && c.bizno.length === 10) vendorBiz.set(c.vendor, { bidwinnrBizno: c.bizno, bidwinnrCeoNm: c.ceo });
  const d = { head: { status: head.openresult_t, opengDt: iso(head.zzopen_dat) + hm(head.zzopen_tim), officer: head.zzpernr_t, tel: head.zztelno, method: head.zzwayofbidding_t, prc: head.zzprcmethod_t }, list };
  opengCache.set(no, { t: Date.now(), d, final: list.length > 0 && /낙찰|계약|확정|상신/.test(head.openresult_t || '') });
  if (opengCache.size > 3000) opengCache.delete(opengCache.keys().next().value);
  return d;
}

// 개찰결과(1순위) — 마감이 지난 공고마다 개찰상세를 조회. 계약 전 단계까지 실시간으로 보임
export async function korailOpengRows(from, to) {
  const back = new Date(new Date(from).getTime() - 60 * 86400000).toISOString().slice(0, 10);
  const notices = await korailNotices(back, to);
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const targets = notices.filter((r) => r.bidClseDt && r.bidClseDt.slice(0, 10) >= from && r.bidClseDt.slice(0, 10) <= to && r.bidClseDt <= now);
  const out = [];
  let i = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (i < targets.length) {
      const r = targets[i++];
      const no = `${r.bidNtceNo}-${r.bidNtceOrd.slice(-2)}`;
      let d = null;
      try { d = await korailOpeng(no); } catch (e) { if (!/데이터가 없/.test(e.message)) console.log(`[korail] 개찰 ${no} 실패 ${e.message}`); }
      const top = d?.list?.find((c) => Number(c.rank) === 1) || d?.list?.[0];
      if (!top) continue;
      out.push({
        ...r, bidNtceNo: no, awardStatus: d.head.status || '개찰', bidwinnrNm: top.name, bidwinnrBizno: top.bizno, bidwinnrCeoNm: top.ceo,
        sucsfbidAmt: top.amt, sucsfbidRate: top.rate ? Number(top.rate).toFixed(3) : '', prtcptCnum: String(d.list.length),
        opengDt: d.head.opengDt || r.bidClseDt, rlOpengDt: d.head.opengDt || r.bidClseDt, _officer: d.head.officer || '',
      });
    }
  }));
  return out;
}

// 서버 시작 시 1회: 입찰공고 구분값 확인 + 최근 계약결과 업체 사업자번호 미리 채우기
export async function korailWarm() {
  const kst = (ms) => new Date(Date.now() + 9 * 3600e3 - ms).toISOString().slice(0, 10);
  const f = kst(30 * 864e5); const t = kst(0);
  const ok = [];
  for (const code of ['1', '2', '3', '4', '5', '6']) {
    try {
      const rows = await noticeChunk(code, f, t);
      const k = rows.map((x) => kindOf(x.zzwayofbidding_t, x.description));
      const by = k.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
      console.log(`[korail] 공고 구분 ${code} 최근30일 ${rows.length}건 ${JSON.stringify(by)} ${rows.slice(0, 2).map((x) => x.description).join(' / ')}`);
      if (rows.length) { ok.push(code); const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0]; if (top[1] / rows.length > 0.9) BIDTYPE_KIND[code] = top[0]; }
    } catch (e) { console.log(`[korail] 공고 구분 ${code} 실패 ${e.message}`); }
  }
  if (ok.length) BIDTYPES = ok;
  console.log(`[korail] 공고 구분 사용 ${BIDTYPES.join(',')} 종류 ${JSON.stringify(BIDTYPE_KIND)}`);
  try {
    const c = await korailContracts(kst(90 * 864e5), t);
    const by = c.reduce((m, r) => ((m[r._kind] = (m[r._kind] || 0) + 1), m), {});
    console.log(`[korail] 계약결과 최근90일 ${c.length}건 ${JSON.stringify(by)} — 사업자번호 채우기 ${queue.length}건 대기`);
  } catch (e) { console.log(`[korail] 계약결과 실패 ${e.message}`); }
}
