// 입찰정보 사이트 서버
// - 공공데이터포털(조달청 나라장터) API를 서버에서 대신 호출 → 인증키는 브라우저에 노출되지 않음
// - React 빌드 결과(client/dist)를 정적 파일로 서빙
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockResponse } from './mock.js';
import { selfTest } from './selftest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const KEY = process.env.DATA_GO_KR_KEY || '';
const MOCK = process.env.MOCK === '1';

const SERVICES = {
  bid: 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService', // 입찰공고정보서비스
  scs: 'https://apis.data.go.kr/1230000/as/ScsbidInfoService',    // 낙찰정보서비스
  usr: 'https://apis.data.go.kr/1230000/ao/UsrInfoService02',      // 사용자정보서비스(조달업체 기본정보)
};

// 호출 허용 오퍼레이션 (API 문서 기준)
const KINDS = ['Cnstwk', 'Servc', 'Thng', 'Frgcpt'];
const ALLOWED = {
  bid: new Set([
    ...KINDS.map((k) => `getBidPblancListInfo${k}PPSSrch`),
    'getBidPblancListInfoEtcPPSSrch',
    ...KINDS.map((k) => `getBidPblancListInfo${k}`),
    'getBidPblancListInfoLicenseLimit',       // 면허제한
    'getBidPblancListInfoPrtcptPsblRgn',      // 참가가능지역
    'getBidPblancListInfoCnstwkBsisAmount',   // 기초금액(공사)
    'getBidPblancListInfoServcBsisAmount',
    'getBidPblancListInfoThngBsisAmount',
  ]),
  usr: new Set(['getPrcrmntCorpBasicInfo02']),
  scs: new Set([
    ...KINDS.map((k) => `getScsbidListSttus${k}PPSSrch`),   // 낙찰목록
    ...KINDS.map((k) => `getOpengResultListInfo${k}PPSSrch`), // 개찰결과
    ...KINDS.map((k) => `getOpengResultListInfo${k}PreparPcDetail`), // 복수예가
    'getOpengResultListInfoOpengCompt',  // 개찰순위(개찰완료)
    'getOpengResultListInfoFailing',     // 유찰
    'getOpengResultListInfoRebid',       // 재입찰
  ]),
};

// 검색 파라미터 화이트리스트 (문서의 요청 메시지 명세)
const PARAMS = new Set([
  'numOfRows', 'pageNo', 'inqryDiv', 'inqryBgnDt', 'inqryEndDt', 'bidNtceNo', 'bidNtceOrd',
  'bidClsfcNo', 'rbidNo', 'bidNtceNm', 'ntceInsttCd', 'ntceInsttNm', 'dminsttCd', 'dminsttNm',
  'refNo', 'prtcptLmtRgnCd', 'prtcptLmtRgnNm', 'indstrytyCd', 'indstrytyNm', 'presmptPrceBgn',
  'presmptPrceEnd', 'dtilPrdctClsfcNo', 'masYn', 'prcrmntReqNo', 'bidClseExcpYn', 'intrntnlDivCd',
  'bizno', 'corpNm',
]);

// 간단한 메모리 캐시 (3분) — 같은 검색 반복 시 트래픽 절약
const cache = new Map();
const TTL = 3 * 60 * 1000;

// 에러는 type=json이어도 XML로 오는 경우가 있음
function parseXmlError(text) {
  const pick = (tag) => (text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1];
  const code = pick('returnReasonCode') || pick('resultCode');
  const msg = pick('returnAuthMsg') || pick('errMsg') || pick('resultMsg');
  return { code: code || 'XML', msg: msg || text.slice(0, 200) };
}

function normalize(json) {
  const res = json.response || json;
  const header = res.header || {};
  const body = res.body || {};
  let items = body.items;
  if (items && !Array.isArray(items)) items = items.item ?? [];
  if (items && !Array.isArray(items)) items = [items];
  return {
    resultCode: header.resultCode,
    resultMsg: header.resultMsg,
    totalCount: Number(body.totalCount || 0),
    pageNo: Number(body.pageNo || 1),
    numOfRows: Number(body.numOfRows || 0),
    items: items || [],
  };
}

// 공공데이터 API 1회 호출 (캐시 포함). 실패 시 Error throw
async function upstream(svc, op, params) {
  const qs = new URLSearchParams(params);
  qs.set('type', 'json');
  const cacheKey = `${svc}/${op}?${qs}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  if (MOCK || !KEY) return { ...mockResponse(svc, op, Object.fromEntries(qs)), mock: true };

  const url = `${SERVICES[svc]}/${op}?serviceKey=${encodeURIComponent(KEY)}&${qs}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  const text = await r.text();
  if (!text.trim().startsWith('{')) {
    const e = parseXmlError(text);
    throw new Error(`[${e.code}] ${e.msg}`);
  }
  const json = JSON.parse(text);
  // 인증 오류는 JSON으로도 옴: {"OpenAPI_ServiceResponse":{"cmmMsgHeader":{errMsg, returnReasonCode}}}
  const eh = json.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (eh) throw new Error(`[${eh.returnReasonCode || 'ERR'}] ${eh.errMsg || ''} ${eh.returnAuthMsg || ''}`.trim());
  const data = normalize(json);
  if (data.resultCode && data.resultCode !== '00') throw new Error(`[${data.resultCode}] ${data.resultMsg}`);
  cache.set(cacheKey, { t: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

// 여러 페이지를 모두 가져오기 (최대 maxPages × 999건)
async function fetchAll(svc, op, params, maxPages = 10) {
  const rows = 999;
  const first = await upstream(svc, op, { ...params, numOfRows: rows, pageNo: 1 });
  let items = [...first.items];
  const pages = Math.min(maxPages, Math.ceil(first.totalCount / rows));
  for (let p = 2; p <= pages; p++) {
    const d = await upstream(svc, op, { ...params, numOfRows: rows, pageNo: p });
    items = items.concat(d.items);
  }
  return { items, truncated: first.totalCount > maxPages * rows, mock: first.mock };
}

// 업종 여러 개(쉼표 구분) → 업종별로 입찰공고를 받아 공고번호 기준으로 합침
const splitNames = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
async function fetchBidsByIndustry(kind, base, indstrytyNm, indstrytyCd) {
  const names = splitNames(indstrytyNm);
  const queries = names.length ? names.map((n) => ({ ...base, indstrytyNm: n })) : [{ ...base }];
  if (indstrytyCd) queries.forEach((q) => { q.indstrytyCd = indstrytyCd; });
  const parts = await Promise.all(queries.map((q) => fetchAll('bid', `getBidPblancListInfo${kind}PPSSrch`, q)));
  const seen = new Set(); const items = [];
  for (const p of parts) for (const b of p.items) {
    const k = `${b.bidNtceNo}-${b.bidNtceOrd}`;
    if (!seen.has(k)) { seen.add(k); items.push(b); }
  }
  return { items, truncated: parts.some((p) => p.truncated), mock: parts[0]?.mock };
}

// 낙찰·개찰 API는 업종 조건이 제대로 걸러지지 않음(실측: 개찰 0건, 낙찰은 거의 전체).
// → 입찰공고 API(업종 필터 정상)로 해당 업종 공고번호를 먼저 받고, 결과를 그 번호로 거름.
async function industryJoin(op, params) {
  const kind = (op.match(/(Cnstwk|Servc|Thng|Frgcpt)/) || [])[1];
  const { indstrytyNm, indstrytyCd, pageNo = '1', numOfRows = '20', ...rest } = params;
  const dateDiv = rest.inqryDiv === '1' ? '1' : '2'; // 1:공고게시일, 2:개찰일 (세 API 공통 의미)
  const bidParams = { inqryDiv: dateDiv, inqryBgnDt: rest.inqryBgnDt, inqryEndDt: rest.inqryEndDt };
  // 개찰일 기준이면 공고가 기간보다 앞서 나왔을 수 있으므로 입찰공고도 개찰일 기준으로 조회
  const [bids, results] = await Promise.all([
    fetchBidsByIndustry(kind, bidParams, indstrytyNm, indstrytyCd),
    fetchAll('scs', op, rest),
  ]);
  const nos = new Set(bids.items.map((b) => b.bidNtceNo));
  const matched = results.items.filter((x) => nos.has(x.bidNtceNo));
  const size = Number(numOfRows); const page = Number(pageNo);
  return {
    resultCode: '00', totalCount: matched.length, pageNo: page, numOfRows: size,
    items: matched.slice((page - 1) * size, page * size),
    industryFiltered: true, truncated: bids.truncated || results.truncated, mock: results.mock,
    debug: { bidCount: bids.items.length, resultCount: results.items.length, matched: matched.length },
  };
}

// ── 낙찰정보 (타 입찰정보 사이트와 같은 방식) ──────────────────────────────
// 조달청 "최종낙찰목록" API에는 적격심사 등으로 낙찰자가 확정된 건만 올라와 개찰 직후 건이 빠짐.
// → 개찰결과(1순위 업체) 기준으로 목록을 만들고, 최종낙찰이 확정된 건은 그 정보로 덮어씀.
//   추정가격은 같은 기간 입찰공고에서 가져와 붙임.
const AWARD_KINDS = ['Cnstwk', 'Servc', 'Thng', 'Frgcpt'];

function parseCorp(s) {
  if (!s) return null;
  const [name, bizno, ceo, amt, rate] = String(s).split('^');
  return { name: (name || '').trim(), bizno, ceo, amt, rate };
}

async function awardForKind(kind, params) {
  const { indstrytyNm, indstrytyCd, bizno, pageNo, numOfRows, ...rest } = params;
  const dateDiv = rest.inqryDiv === '1' ? '1' : '2';
  const dates = { inqryDiv: dateDiv, inqryBgnDt: rest.inqryBgnDt, inqryEndDt: rest.inqryEndDt };
  const bidParams = { ...dates };
  if (rest.prtcptLmtRgnCd && !indstrytyNm && !indstrytyCd) bidParams.prtcptLmtRgnCd = rest.prtcptLmtRgnCd;
  const scsParams = { ...dates };
  if (rest.prtcptLmtRgnCd) scsParams.prtcptLmtRgnCd = rest.prtcptLmtRgnCd;

  const [opens, bids, finals] = await Promise.all([
    fetchAll('scs', `getOpengResultListInfo${kind}PPSSrch`, rest),
    fetchBidsByIndustry(kind, bidParams, indstrytyNm, indstrytyCd),
    fetchAll('scs', `getScsbidListSttus${kind}PPSSrch`, scsParams),
  ]);
  const bidMap = new Map();
  for (const b of bids.items) bidMap.set(`${b.bidNtceNo}-${b.bidNtceOrd}`, b), bidMap.set(b.bidNtceNo, bidMap.get(b.bidNtceNo) || b);
  const finMap = new Map();
  for (const f of finals.items) indexCompany(f);
  for (const f of finals.items) finMap.set(`${f.bidNtceNo}-${f.bidNtceOrd}-${f.bidClsfcNo}`, f), finMap.set(f.bidNtceNo, finMap.get(f.bidNtceNo) || f);

  const useIndustry = !!(indstrytyNm || indstrytyCd);
  const rows = [];
  for (const o of opens.items) {
    if (o.progrsDivCdNm && o.progrsDivCdNm !== '개찰완료') continue; // 유찰·재입찰 제외
    const bid = bidMap.get(`${o.bidNtceNo}-${o.bidNtceOrd}`) || bidMap.get(o.bidNtceNo);
    if (useIndustry && !bid) continue; // 업종은 입찰공고 면허제한 기준
    const fin = finMap.get(`${o.bidNtceNo}-${o.bidNtceOrd}-${o.bidClsfcNo}`) || finMap.get(o.bidNtceNo);
    const top = parseCorp(o.opengCorpInfo) || {};
    const row = {
      ...o, _kind: kind,
      awardStatus: fin ? '낙찰확정' : '1순위',
      bidwinnrNm: fin?.bidwinnrNm || top.name || '',
      bidwinnrBizno: fin?.bidwinnrBizno || top.bizno || '',
      bidwinnrCeoNm: fin?.bidwinnrCeoNm || top.ceo || '',
      bidwinnrTelNo: fin?.bidwinnrTelNo || '',
      bidwinnrAdrs: fin?.bidwinnrAdrs || '',
      sucsfbidAmt: fin?.sucsfbidAmt || top.amt || '',
      sucsfbidRate: fin?.sucsfbidRate || top.rate || '',
      fnlSucsfDate: fin?.fnlSucsfDate || '',
      rlOpengDt: o.opengDt,
      presmptPrce: bid?.presmptPrce || '',
      bdgtAmt: bid?.bdgtAmt || '',
      cntrctCnclsMthdNm: bid?.cntrctCnclsMthdNm || '',
      sucsfbidLwltRate: bid?.sucsfbidLwltRate || '',
      bidNtceDtlUrl: bid?.bidNtceDtlUrl || '',
    };
    if (bizno) {
      const b = bizno.replaceAll('-', '');
      if (row.bidwinnrBizno !== b && top.bizno !== b) continue;
    }
    rows.push(row);
  }
  return { rows, truncated: opens.truncated || bids.truncated || finals.truncated, mock: opens.mock };
}

// ── 업체 정보 (주소·대표자·전화) ─────────────────────────────────────────
// 개찰 1순위 정보에는 상호·사업자번호·대표자만 있음. 주소·전화는 "최종낙찰목록"에만 있으므로
// 조회하면서 받은 낙찰 데이터로 사업자번호별 연락처를 모아두고, 없으면 최근 낙찰 이력을 찾아봄.
const companies = new Map(); // bizno → {name, ceo, adrs, tel, lastDate, lastBid}
function indexCompany(f) {
  const b = String(f.bidwinnrBizno || '').replaceAll('-', '');
  if (!b || (!f.bidwinnrAdrs && !f.bidwinnrTelNo)) return;
  const prev = companies.get(b);
  const date = f.fnlSucsfDate || f.rlOpengDt || '';
  if (prev && prev.lastDate > date) return;
  companies.set(b, { bizno: b, name: f.bidwinnrNm, ceo: f.bidwinnrCeoNm, adrs: String(f.bidwinnrAdrs || '').replace(/\s*\(\s*\)\s*$/, ''), tel: f.bidwinnrTelNo,
    lastDate: date, lastBid: f.bidNtceNm, lastAmt: f.sucsfbidAmt, t: Date.now() });
  if (companies.size > 20000) companies.delete(companies.keys().next().value);
}
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

// 1순위: 사용자정보서비스(나라장터 등록업체 전체) — 낙찰 여부와 관계없이 주소·전화·대표자 제공
// 2순위: 최근 낙찰 이력(최종낙찰목록)에서 찾기
let usrState = 'unknown'; // 'ok' | 'notRegistered' | 'unknown'
async function corpBasic(b) {
  const d = await upstream('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: '3', bizno: b, numOfRows: 5, pageNo: 1 });
  usrState = 'ok';
  const c = (d.items || []).find((x) => String(x.bizno) === b) || d.items?.[0];
  if (!c) return null;
  const adrs = [c.adrs, c.dtlAdrs].filter(Boolean).join(' ').trim();
  return {
    found: true, source: 'usr', bizno: b, name: c.corpNm, ceo: c.ceoNm, adrs, tel: c.telNo, fax: c.faxNo,
    homepage: c.hmpgAdrs, rgnNm: c.rgnNm, opbizDt: c.opbizDt, corpBsnsDivNm: c.corpBsnsDivNm, hdoffceDivNm: c.hdoffceDivNm,
    emplyeNum: c.emplyeNum, t: Date.now(),
  };
}

const corpCache = new Map();
// 업체 1곳 조회: 등록업체 정보 → (실패 시) 최근 낙찰 이력
async function lookupCompany(b, { deep = true } = {}) {
  const cached = corpCache.get(b);
  if (cached && Date.now() - cached.t < 7 * 86400000) return cached;
  let usrError = '';
  try {
    const c = await corpBasic(b);
    if (c && (c.adrs || c.tel)) { corpCache.set(b, c); return c; }
  } catch (err) {
    usrError = err.message;
    if (/SERVICE_KEY_IS_NOT_REGISTERED|등록되지 않은|\[30\]/.test(err.message)) usrState = 'notRegistered';
    console.log(`[company] 사용자정보서비스 실패 ${b}: ${err.message}`);
  }
  const hit = companies.get(b);
  if (hit) return { found: true, source: 'award', ...hit, usrState };
  if (!deep) return { found: false, bizno: b, usrState, usrError };
  // 최근 180일을 30일씩 거슬러 올라가며 이 업체의 최종낙찰 건을 찾음 (공사·용역·물품)
  for (let w = 0; w < 6; w++) {
    const endD = new Date(Date.now() - w * 30 * 86400000);
    const startD = new Date(endD.getTime() - 29 * 86400000);
    const q = { inqryDiv: '2', inqryBgnDt: `${ymd(startD)}0000`, inqryEndDt: `${ymd(endD)}2359`, bizno: b, numOfRows: 50, pageNo: 1 };
    const parts = await Promise.all(['Cnstwk', 'Servc', 'Thng'].map((k) => upstream('scs', `getScsbidListSttus${k}PPSSrch`, q).catch(() => ({ items: [] }))));
    for (const p of parts) for (const f of p.items || []) if (String(f.bidwinnrBizno) === b) indexCompany(f);
    if (companies.has(b)) return { found: true, source: 'award', ...companies.get(b), usrState };
  }
  return { found: false, bizno: b, usrState, usrError };
}

app.get('/api/company/:bizno', async (req, res) => {
  const b = String(req.params.bizno).replace(/[^0-9]/g, '');
  if (b.length !== 10) return res.status(400).json({ error: '사업자번호 10자리가 필요합니다' });
  try { res.json(await lookupCompany(b)); } catch (err) { res.status(502).json({ error: `업체 정보 조회 실패: ${err.message}` }); }
});

// 여러 업체 한꺼번에 (엑셀 다운로드용). 동시 6건씩 조회
app.get('/api/companies', async (req, res) => {
  const list = [...new Set(String(req.query.b || '').split(',').map((x) => x.replace(/[^0-9]/g, '')).filter((x) => x.length === 10))].slice(0, 500);
  const out = {};
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const b = list[i++];
      try { out[b] = await lookupCompany(b, { deep: false }); } catch { out[b] = { found: false, bizno: b }; }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  res.json({ companies: out, usrState });
});

app.get('/api/award/:kind', async (req, res) => {
  const { kind } = req.params;
  const kinds = kind === 'All' ? AWARD_KINDS : AWARD_KINDS.includes(kind) ? [kind] : null;
  if (!kinds) return res.status(404).json({ error: '알 수 없는 업무구분' });
  const params = {};
  for (const [k, v] of Object.entries(req.query)) if (PARAMS.has(k) && v !== '' && v != null) params[k] = String(v);
  if (!params.inqryBgnDt || !params.inqryEndDt) return res.status(400).json({ error: '조회 기간을 입력하세요' });
  try {
    const parts = await Promise.all(kinds.map((k) => awardForKind(k, params)));
    const rows = parts.flatMap((p) => p.rows).sort((a, b) => String(b.opengDt).localeCompare(String(a.opengDt)));
    const size = Number(params.numOfRows || 20); const page = Number(params.pageNo || 1);
    res.json({
      resultCode: '00', totalCount: rows.length, pageNo: page, numOfRows: size,
      items: rows.slice((page - 1) * size, page * size),
      industryFiltered: !!(params.indstrytyNm || params.indstrytyCd),
      truncated: parts.some((p) => p.truncated), mock: parts.some((p) => p.mock),
    });
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? '공공데이터 API 응답 지연 (잠시 후 다시 시도)' : err.message;
    res.status(502).json({ error: msg.startsWith('[') ? msg : `공공데이터 API 호출 실패: ${msg}` });
  }
});

app.get('/api/:svc/:op', async (req, res) => {
  const { svc, op } = req.params;
  if (!SERVICES[svc] || !ALLOWED[svc].has(op)) return res.status(404).json({ error: '허용되지 않은 오퍼레이션' });

  const params = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (PARAMS.has(k) && v !== '' && v != null) params[k] = String(v);
  }
  params.numOfRows ??= '20';
  params.pageNo ??= '1';

  try {
    const needJoin = svc === 'scs' && /PPSSrch$/.test(op) && (params.indstrytyNm || params.indstrytyCd)
      && params.inqryDiv !== '3' && !params.bidNtceNo;
    const multiBid = svc === 'bid' && /PPSSrch$/.test(op) && splitNames(params.indstrytyNm).length > 1;
    let data;
    if (needJoin) data = await industryJoin(op, params);
    else if (multiBid) {
      const kind = (op.match(/(Cnstwk|Servc|Thng|Frgcpt|Etc)/) || [])[1];
      const { indstrytyNm, pageNo, numOfRows, ...rest } = params;
      const all = await fetchBidsByIndustry(kind, rest, indstrytyNm);
      const items = all.items.sort((a, b) => String(b.bidNtceDt).localeCompare(String(a.bidNtceDt)));
      const size = Number(numOfRows); const page = Number(pageNo);
      data = { resultCode: '00', totalCount: items.length, pageNo: page, numOfRows: size,
        items: items.slice((page - 1) * size, page * size), truncated: all.truncated, mock: all.mock };
    } else data = await upstream(svc, op, params);
    res.json(data);
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? '공공데이터 API 응답 지연 (잠시 후 다시 시도)' : err.message;
    res.status(502).json({ error: msg.startsWith('[') ? msg : `공공데이터 API 호출 실패: ${msg}` });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, mock: MOCK || !KEY }));

const dist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => {
  console.log(`입찰정보 서버 :${PORT} ${MOCK || !KEY ? '(샘플데이터 모드)' : ''}`);
  if (process.env.SELFTEST === '1') setTimeout(() => selfTest(`http://localhost:${PORT}`), 1000);
});
