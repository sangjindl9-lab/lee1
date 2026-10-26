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
  if (/공사/.test(title)) return 'Cnstwk';
  if (/용역|감리|설계|진단|점검|위탁/.test(title)) return 'Servc';
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
export function korailNotices(from, to) {
  return ranged('notice', from, to, async (f, t) => {
    const out = await rfc('ZMME_EBID_INFO_0009F', {
      I_ZZBIDTYPECODE: '1', I_ZZCTRMETHOD: '', I_BSART: '', I_ZZBIDINV: '', I_DESCRIPTION: '',
      I_ERDAT_FR: plain(f), I_ERDAT_TO: plain(t), I_SDAT_FR: '', I_SDAT_TO: '', I_LIFNR: '',
    });
    return tableOf(out).map((x) => {
      const no = String(x.zzbidinv || '');
      return {
        _org: 'korail', _orgNm: '철도공사', _kind: kindOf(x.zzwayofbidding_t, x.description),
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
export function korailContracts(from, to) {
  return ranged('cont', from, to, async (f, t) => {
    const all = [];
    for (const poart of POARTS) {
      const out = await rfc('ZMME_EBID_INFO_0014', {
        I_POART: poart, I_EBELN: '', I_ZZCTRDESC: '', I_GUBUN: 'A', I_ZZCONTRWAY: '', I_ZZBIDINV: '',
        I_DAT_FR: plain(f), I_DAT_TO: plain(t),
      }, '/goods/contList.do');
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
        sucsfbidAmt: won, sucsfbidRate: won && pln ? (Number(won) / Number(pln) * 100).toFixed(3) : '', prtcptCnum: '',
        opengDt: iso(x.zzopenday) || iso(x.bedat), rlOpengDt: iso(x.zzopenday) || iso(x.bedat),
        cntrctCnclsMthdNm: [x.zzcontrway_txt, x.zzwayofbidding_txt].filter(Boolean).join(' · '),
        _plnprc: pln, _basic: basic, _cntrctDt: iso(x.bedat), _cntrctNo: x.ebeln, _korailVendor: x.lifnr,
        bidNtceDtlUrl: `${B}/`,
      };
    });
  });
}
// 계약 목록 구분값 (화면: 계약현황). 시작 시 점검 로그로 확인한 값만 사용
let POARTS = ['2'];
const POART_KIND = {};

// 서버 시작 시 1회: 구분값별 건수 확인 → 실제 쓰는 구분값 결정
export async function korailWarm() {
  const kst = (ms) => new Date(Date.now() + 9 * 3600e3 - ms).toISOString().slice(0, 10);
  const f = kst(30 * 864e5); const t = kst(0);
  const found = [];
  for (const p of ['1', '2', '3', '4', '5', '6']) {
    try {
      const out = await rfc('ZMME_EBID_INFO_0014', { I_POART: p, I_EBELN: '', I_ZZCTRDESC: '', I_GUBUN: 'A', I_ZZCONTRWAY: '', I_ZZBIDINV: '', I_DAT_FR: plain(f), I_DAT_TO: plain(t) }, '/goods/contList.do');
      const rows = tableOf(out);
      const ex = rows.slice(0, 3).map((x) => x.zzctrdesc).join(' / ');
      console.log(`[korail] 계약 구분 ${p} 최근30일 ${rows.length}건 ${ex}`);
      if (rows.length) found.push([p, rows]);
    } catch (e) { console.log(`[korail] 계약 구분 ${p} 실패 ${e.message}`); }
  }
  if (found.length) {
    // 같은 계약이 여러 구분에 겹치면 하나만 씀
    const sigs = new Map();
    POARTS = found.filter(([p, rows]) => { const s = rows.map((x) => x.ebeln).sort().join(); if (sigs.has(s)) return false; sigs.set(s, p); return true; }).map(([p]) => p);
    for (const [p, rows] of found) {
      const k = rows.map((x) => kindOf(x.zzwayofbidding_txt, x.zzctrdesc));
      const top = ['Cnstwk', 'Servc', 'Thng'].map((x) => [x, k.filter((y) => y === x).length]).sort((a, b) => b[1] - a[1])[0];
      if (top[1] / k.length > 0.9) POART_KIND[p] = top[0];
    }
    console.log(`[korail] 사용 구분 ${POARTS.join(',')} 종류 ${JSON.stringify(POART_KIND)}`);
  }
  try {
    const n = await korailNotices(kst(14 * 864e5), t);
    const by = n.reduce((m, r) => ((m[r._kind] = (m[r._kind] || 0) + 1), m), {});
    console.log(`[korail] 입찰공고 최근14일 ${n.length}건 ${JSON.stringify(by)} 예: ${n.slice(0, 2).map((r) => `${r.bidNtceNo} ${r.bidNtceNm} ${r.cntrctCnclsMthdNm}`).join(' / ')}`);
    // 개찰결과 상세에 사업자번호가 있는지 확인
    const c = (await korailContracts(f, t)).find((r) => /^\d/.test(r.bidNtceNo));
    const sample = n[0];
    for (const [no, st] of [[sample?._korailNo?.replace(/-\d+$/, ''), sample?._korailNo?.split('-')[1] || '00'], [c?.bidNtceNo, '00']]) {
      if (!no) continue;
      const out = await rfc('ZMME_EBID_INFO_0016', { I_ZZBIDINV: no, I_ZZSTNUM: st }, '/goods/openDetail.do');
      const tb = Object.entries(out).filter(([k, v]) => /^ET_/.test(k) && Array.isArray(v)).map(([k, v]) => `${k}:${v.length} ${JSON.stringify(v[0] || {}).slice(0, 600)}`);
      console.log(`[korail] 개찰상세 ${no}-${st} ${out.E_MSG || ''} ${tb.join(' || ')}`);
    }
  } catch (e) { console.log(`[korail] 점검 실패 ${e.message}`); }
}
