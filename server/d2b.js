// 방위사업청 군수품조달정보 (apis.data.go.kr/1690000) — 입찰공고·입찰결과
// 오퍼레이션별 하루 100회 제한 → 최근 60일치를 1시간에 한 번만 받아 서버에 보관하고, 검색은 보관본에서 처리
const PBLANC = 'https://apis.data.go.kr/1690000/BidPblancInfoService';
const RESULT = 'https://apis.data.go.kr/1690000/BidResultInfoService';
const OPS = {
  fcltyNotice: [PBLANC, 'getFcltyCmpetBidPblancList', 'anmtDate'],   // 시설(공사·용역) 경쟁입찰공고
  dmstcNotice: [PBLANC, 'getDmstcCmpetBidPblancList', 'anmtDate'],   // 국내(물품) 경쟁입찰공고
  fcltyResult: [RESULT, 'getFcltyCmpetBidResultList', 'opengDate'],  // 시설 경쟁입찰결과
  dmstcResult: [RESULT, 'getDmstcCmpetBidResultList', 'opengDate'],  // 국내 경쟁입찰결과
};
const WINDOW_DAYS = 60;
const REFRESH_MS = 60 * 60 * 1000;
const store = new Map(); // key → {t, rows, error}
const inflight = new Map();

const unx = (v) => v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
function parse(text) {
  const code = (text.match(/<resultCode>([^<]*)</) || [])[1];
  const auth = (text.match(/<returnReasonCode>([^<]*)</) || [])[1];
  if (auth) throw new Error(`방위사업청 API 인증 오류 [${auth}] ${(text.match(/<returnAuthMsg>([^<]*)</) || [])[1] || ''}`);
  if (code && code !== '00' && code !== '03') throw new Error(`방위사업청 API 오류 [${code}] ${(text.match(/<resultMsg>([^<]*)</) || [])[1] || ''}`);
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const o = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = unx(f[2]);
    return o;
  });
  return { items, total: Number((text.match(/<totalCount>(\d+)</) || [])[1] || items.length) };
}
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
export const d2bDate = (v) => {
  const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?/);
  return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : '';
};

async function refresh(key, serviceKey) {
  const [base, op, dateParam] = OPS[key];
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const begin = new Date(now.getTime() - WINDOW_DAYS * 86400000);
  let rows = [];
  for (let p = 1; p <= 5; p++) { // 한 번에 999건, 최대 5페이지
    const qs = new URLSearchParams({ [`${dateParam}Begin`]: ymd(begin), [`${dateParam}End`]: ymd(now), numOfRows: '999', pageNo: String(p) });
    const r = await fetch(`${base}/${op}?serviceKey=${encodeURIComponent(serviceKey)}&${qs}`, { signal: AbortSignal.timeout(45000) });
    const d = parse(await r.text());
    rows = rows.concat(d.items);
    if (rows.length >= d.total || !d.items.length) break;
  }
  console.log(`[d2b] ${op} 최근 ${WINDOW_DAYS}일 ${rows.length}건 갱신`);
  return rows;
}

// 보관본 반환. 1시간 지났으면 새로 받고, 실패하면 이전 보관본 사용
export async function d2bRows(key, serviceKey) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < REFRESH_MS) return hit.rows;
  if (!inflight.has(key)) {
    inflight.set(key, refresh(key, serviceKey)
      .then((rows) => { store.set(key, { t: Date.now(), rows }); return rows; })
      .catch((e) => { console.log(`[d2b] ${key} 갱신 실패: ${e.message}`); if (hit) { store.set(key, { ...hit, t: Date.now() - REFRESH_MS + 10 * 60 * 1000 }); return hit.rows; } throw e; })
      .finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

const kindOf = (busi, title = '') => {
  if (/공사/.test(busi)) return 'Cnstwk';
  if (/용역/.test(busi)) return 'Servc';
  if (busi) return 'Thng';
  return /용역|설계|감리/.test(title) ? 'Servc' : /공사/.test(title) ? 'Cnstwk' : 'Thng';
};

export function d2bNoticeRow(x, src) {
  const title = x.cntrwkNm || x.bidNm || x.prdlstNm || x.reprsntPrdlstNm || x.pblancNm || '';
  return {
    _org: 'd2b', _orgNm: '방위사업청', _kind: src === 'dmstc' && !x.busiDivs ? 'Thng' : kindOf(x.busiDivs, title),
    bidNtceNo: x.g2bPblancNo || x.pblancNo || x.cntrwkNo || '', bidNtceOrd: String(x.pblancOdr || '1').padStart(3, '0'),
    bidNtceNm: title, ntceInsttNm: x.ornt || '방위사업청', dminsttNm: x.ornt || x.dmndInsttNm || '',
    presmptPrce: String(x.baseAmnt || x.bsicExpt || x.budgetAmount || '').replace(/[^0-9]/g, ''),
    cntrctCnclsMthdNm: x.cntrctMth || '', ntceKindNm: x.pblancSe || '등록공고',
    bidNtceDt: d2bDate(x.pblancDate), bidClseDt: d2bDate(x.biddocPresentnClosDt || x.bidPartcptRegistClosDt), opengDt: d2bDate(x.opengDt),
    _status: x.pblancSe || '', _officer: '', _basicLabel: '기초금액',
    bidNtceDtlUrl: 'https://www.d2b.go.kr/', _raw: { cntrwkNo: x.cntrwkNo, pblancNo: x.pblancNo, pblancOdr: x.pblancOdr, orntCode: x.orntCode },
  };
}

export function d2bResultRow(x, src) {
  const title = x.cntrwkNm || x.bidNm || x.prdlstNm || x.reprsntPrdlstNm || '';
  return {
    _org: 'd2b', _orgNm: '방위사업청', _kind: src === 'dmstc' ? 'Thng' : kindOf(x.busiDivs, title),
    bidNtceNo: x.pblancNo || x.cntrwkNo || '', bidNtceOrd: String(x.pblancOdr || '1').padStart(3, '0'), bidNtceNm: title,
    ntceInsttNm: x.ornt || '방위사업청', dminsttNm: x.ornt || '', presmptPrce: '',
    awardStatus: x.bidResult || '개찰', bidwinnrNm: x.sucbidrNm || x.scsbidEntrpsNm || '', bidwinnrBizno: '', bidwinnrCeoNm: '',
    sucsfbidAmt: String(x.sucbidAmount || x.scsbidAmt || '').replace(/[^0-9]/g, ''), sucsfbidRate: '', prtcptCnum: '',
    opengDt: d2bDate(x.opengDt || x.opengDate), rlOpengDt: d2bDate(x.opengDt || x.opengDate),
    cntrctCnclsMthdNm: x.cntrctMth || '', _selection: x.sucbidrDecsnMth || '', _bidMth: x.bidMth || '',
    bidNtceDtlUrl: 'https://www.d2b.go.kr/', _raw: { cntrwkNo: x.cntrwkNo, pblancNo: x.pblancNo, pblancOdr: x.pblancOdr, orntCode: x.orntCode },
  };
}
