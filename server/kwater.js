// 한국수자원공사 전자조달 OpenAPI (apis.data.go.kr/B500001/ebid/tndr3)
// 실측 주의사항(참고: github.com/aohus/bidding docs/external-bid-api.md)
//  - searchDt 는 월 단위(YYYYMM). 날짜 범위 조회 없음 → 월별로 받아 서버에서 거름
//  - rstList 는 cntrctDivCd(1 공사 2 용역 3 내자 4 물품) 필수, 생략 시 조용히 0건
//  - 금액에 쉼표, 빈 날짜는 '-'
const BASE = 'https://apis.data.go.kr/B500001/ebid/tndr3';
export const KW_OPS = { cntrwk: 'cntrwkList', servc: 'servcList', gds: 'gdsList', dmscpt: 'dmscptList', rst: 'rstList' };
export const KW_LABEL = { cntrwk: '공사', servc: '용역', gds: '물품', dmscpt: '내자', rst: '낙찰결과' };
const RST_DIV = { 1: '공사', 2: '용역', 3: '내자', 4: '물품' };

const cache = new Map(); // `${op}|${ym}|${div}` → {t, rows}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function kwDate(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '-') return '';
  const m = s.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:[ T]?(\d{2}):?(\d{2}))?/);
  return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : s;
}
const amt = (v) => String(v ?? '').replace(/[^0-9]/g, '');

async function call(op, params, key) {
  const qs = new URLSearchParams({ ...params, _type: 'json' });
  const r = await fetch(`${BASE}/${op}?serviceKey=${encodeURIComponent(key)}&${qs}`, { signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (r.status === 403) throw new Error('수자원공사 API 활용신청이 필요합니다 (403)');
  let j;
  try { j = JSON.parse(text); } catch {
    const code = (text.match(/<(?:returnReasonCode|resultCode)>([^<]+)</) || [])[1];
    const msg = (text.match(/<(?:returnAuthMsg|errMsg|resultMsg)>([^<]+)</) || [])[1];
    throw new Error(`수자원공사 API 오류 [${code || r.status}] ${msg || text.slice(0, 100)}`);
  }
  const eh = j.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (eh) throw new Error(`수자원공사 API 오류 [${eh.returnReasonCode}] ${eh.returnAuthMsg || eh.errMsg || ''}`);
  const h = j.response?.header || {};
  if (h.resultCode && h.resultCode !== '00' && h.resultCode !== '03') throw new Error(`수자원공사 API 오류 [${h.resultCode}] ${h.resultMsg || ''}`);
  const b = j.response?.body || {};
  let items = b.items?.item ?? b.items ?? [];
  if (!Array.isArray(items)) items = items && typeof items === 'object' ? [items] : [];
  return { items, total: Number(b.totalCount || 0) };
}

async function month(op, ym, key, extra = {}) {
  const ck = `${op}|${ym}|${extra.cntrctDivCd || ''}`;
  const hit = cache.get(ck);
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const thisYm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const ttl = ym >= thisYm ? 20 * 60 * 1000 : 12 * 3600 * 1000; // 지난달은 오래 캐시
  if (hit && Date.now() - hit.t < ttl) return hit.rows;
  let rows = [];
  for (let p = 1; p <= 20; p++) {
    const d = await call(op, { searchDt: ym, numOfRows: 500, pageNo: p, ...extra }, key);
    rows = rows.concat(d.items);
    if (rows.length >= d.total || !d.items.length) break;
    await sleep(150);
  }
  cache.set(ck, { t: Date.now(), rows });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return rows;
}

function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)); let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)); const em = Number(to.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 12) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function normNotice(x, kind) {
  return {
    org: '한국수자원공사', kind, kindNm: x.cntrctDivNm || KW_LABEL[kind],
    bidNtceNo: x.tndrPbanno || '', bidNtceNm: x.tndrPblancNm || '', dept: x.cntrctDeptNm || x.dept || '',
    method: x.ctrmthdCdNm || x.ctrmthdNm || '', ntceDt: kwDate(x.tndrPblancDe), clseDt: kwDate(x.tndrPblancEnddt),
    plnprc: amt(x.tndrPlnprc), status: x.tndrStat || '', officer: x.intnChargerNm || '',
    prtcptCnt: x.tndrPartcptEntrpsCo || '', raw: x,
  };
}
function normResult(x, div) {
  return {
    org: '한국수자원공사', kind: 'rst', kindNm: x.cntrctDivNm || RST_DIV[div],
    bidNtceNo: x.tndrPbanno || '', bidNtceNm: x.tndrPblancNm || '', dept: x.dept || x.cntrctDeptNm || '',
    method: x.ctrmthdNm || x.ctrmthdCdNm || '', selection: x.sucbidrDcsnMthNm || '',
    winnerNm: x.entrpsNm || '', winnerAmt: amt(x.scsbidAmt), status: x.cntrctPrgstsNm || '',
    ntceDt: kwDate(x.tndrPblancDe), opengDt: kwDate(x.cardPrcsDt), officer: x.intnChargerNm || '', raw: x,
  };
}

export async function kwSearch(kind, { from, to, q = '' }, key) {
  const months = monthsBetween(from, to);
  let rows = [];
  for (const ym of months) {
    if (kind === 'rst') {
      for (const div of [1, 2, 3, 4]) {
        const items = await month(KW_OPS.rst, ym, key, { cntrctDivCd: String(div) });
        rows = rows.concat(items.map((x) => normResult(x, div)));
      }
    } else {
      const items = await month(KW_OPS[kind], ym, key);
      rows = rows.concat(items.map((x) => normNotice(x, kind)));
    }
  }
  const words = q.split(/\s+/).filter(Boolean);
  const dateOf = (r) => (kind === 'rst' ? r.opengDt || r.ntceDt : r.ntceDt) || '';
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = `${r.bidNtceNo}|${r.winnerNm || ''}|${r.kindNm}`;
    if (seen.has(k)) return false; seen.add(k);
    const d = dateOf(r).slice(0, 10);
    if (d && (d < from || d > to)) return false;
    return words.every((w) => `${r.bidNtceNm} ${r.dept} ${r.winnerNm || ''}`.includes(w));
  });
  rows.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return rows;
}
