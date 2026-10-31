// 입찰정보 사이트 서버
// - 공공데이터포털(조달청 나라장터) API를 서버에서 대신 호출 → 인증키는 브라우저에 노출되지 않음
// - React 빌드 결과(client/dist)를 정적 파일로 서빙
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockResponse } from './mock.js';
import { selfTest } from './selftest.js';
import { krResults, krDetail } from './krbid.js';
import { kwSearch, KW_OPS } from './kwater.js';
import { extBids, extAwards } from './unify.js';

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
  if (/^\s*<!DOCTYPE html|^\s*<html/i.test(text)) {
    // 공공데이터포털이 API 대신 웹페이지(점검·오류 안내)를 돌려줌
    const title = ((text.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    const body = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    console.log(`[upstream] ${svc}/${op} HTTP ${r.status} 웹페이지 응답: ${title} | ${body}`);
    throw new Error(`공공데이터포털(조달청 API)이 지금 응답하지 않고 안내 페이지를 보내고 있습니다${title ? ` (${title})` : ''}. 잠시 후 다시 검색해 주세요.`);
  }
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
  const adrs = [c.adrs, c.dtlAdrs].filter(Boolean).join(' ')
    .replace(/\s*\(\s*\)/g, '')          // 빈 괄호
    .replace(/(\d)-0(?![0-9])/g, '$1')      // 22-0 → 22 (부번 없음)
    .replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
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

// 한국철도공사 개찰결과(공고별 참가업체 순위)
app.get('/api/korail/openg/:no', async (req, res) => {
  try {
    const { korailOpeng } = await import('./korail.js');
    const d = await korailOpeng(String(req.params.no));
    res.json(d || { list: [] });
  } catch (err) { res.status(/데이터가 없/.test(err.message) ? 200 : 502).json(/데이터가 없/.test(err.message) ? { list: [] } : { error: err.message }); }
});

// 사업자번호 없이 업체명만 있는 경우(철도공사·수자원공사 등) → 나라장터 등록업체에서 이름이 똑같은 곳을 찾아 연락처 조회
const normCorp = (x) => String(x || '').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)|합자회사|\(사\)|사단법인|\s/g, '');
const nameBizCache = new Map(); // 정규화된 이름 → {t, bizno}
async function biznoByName(name, { quickOnly = false } = {}) {
  const nq = normCorp(name);
  if (nq.length < 2) return '';
  const hit = nameBizCache.get(nq);
  if (hit && Date.now() - hit.t < 7 * 86400000) return hit.bizno;
  let b = '';
  for (const c of companies.values()) if (normCorp(c.name) === nq) { b = c.bizno; break; }
  if (!b) for (const { data } of cache.values()) for (const it of data?.items || []) {
    if (it.bidwinnrBizno && normCorp(it.bidwinnrNm) === nq) { b = String(it.bidwinnrBizno); break; }
  }
  if (!b) {
    for (const { data } of corpSearchCache.values()) for (const c of data.items || []) if (normCorp(c.name) === nq) { b = c.bizno; break; }
  }
  if (!b && quickOnly) return '';
  if (!b && !MOCK && KEY) {
    // 등록연도별로 업체명 검색 (최근 연도부터, 찾으면 중단)
    const q = name.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, '').trim();
    const nowY = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
    const years = []; for (let y = nowY; y >= 2000; y--) years.push(y);
    for (let i = 0; i < years.length && !b; i += 13) {
      const res = await pool(years.slice(i, i + 13).map((y) => () => upstream('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: '1', inqryBgnDt: `${y}01010000`, inqryEndDt: `${y}12312359`, corpNm: q, numOfRows: 100, pageNo: 1 }).catch(() => ({ items: [] }))), 13);
      for (const d of res) for (const c of d?.items || []) if (!b && normCorp(c.corpNm) === nq) b = String(c.bizno);
    }
  }
  nameBizCache.set(nq, { t: Date.now(), bizno: b });
  if (nameBizCache.size > 5000) nameBizCache.delete(nameBizCache.keys().next().value);
  return b;
}
app.get('/api/company-by-name', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (normCorp(name).length < 2) return res.status(400).json({ error: '업체명이 필요합니다' });
  try {
    const b = await biznoByName(name);
    if (!b) return res.json({ found: false, name, notFoundByName: true });
    res.json(await lookupCompany(b));
  } catch (err) { res.status(502).json({ error: `업체 정보 조회 실패: ${err.message}` }); }
});

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
  const ok = Object.values(out).filter((c) => c.adrs || c.tel).length;
  console.log(`[companies] 요청 ${list.length}곳 → 연락처 ${ok}곳 (usr=${usrState})`);
  res.json({ companies: out, usrState });
});

// ── 철도기관 (공공데이터포털 파일데이터 API, api.odcloud.kr) ─────────────────
// 실시간 API가 아니라 기관이 올린 파일을 API로 제공. Swagger에서 최신 파일(uddi)을 찾아 전체를 받아 캐시.
const EXT = {
  kr: { name: '국가철도공단', ns: '3070357/v1' },
  korail: { name: '한국철도공사', ns: '15136102/v1' },
  d2bfac: { name: '방위사업청 시설공사 경쟁 입찰결과', ns: '15050927/v1' },
};
const extCache = new Map(); // src → {t, rows, files}

function normDate(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:[ T]?(\d{2}):?(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) { // 엑셀 날짜 일련번호
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 16).replace('T', ' ').replace(' 00:00', '');
  }
  return s;
}
const pick = (o, ...keys) => { for (const k of keys) { const hit = Object.keys(o).find((x) => x === k || x.startsWith(k)); if (hit && o[hit] !== '' && o[hit] != null) return o[hit]; } return ''; };

async function extFiles(ns) {
  const r = await fetch(`https://infuser.odcloud.kr/oas/docs?namespace=${ns}`, { signal: AbortSignal.timeout(20000) });
  const spec = await r.json();
  return Object.entries(spec.paths || {}).map(([p, v]) => ({ path: p.replace(/^\/api/, ''), title: v.get?.summary || '' }))
    .sort((a, b) => (b.title.match(/(\d{8})\s*$/)?.[1] || '').localeCompare(a.title.match(/(\d{8})\s*$/)?.[1] || ''));
}

async function extLoad(src) {
  const cfg = EXT[src];
  const hit = extCache.get(src);
  if (hit && Date.now() - hit.t < 12 * 3600 * 1000) return hit;
  const files = await extFiles(cfg.ns);
  if (!files.length) throw new Error('파일 목록을 찾지 못했습니다');
  // 기준일이 다른 파일 여러 개(예: 2023·2024·2026)를 모두 받아 합침. 최신 파일부터 읽어 같은 공고는 최신 상태를 남김
  const raw = [];
  for (const file of files) {
    let page = 1; let total = Infinity; let got = 0;
    while (got < total && page <= 50) {
      const u = `https://api.odcloud.kr/api${file.path}?page=${page}&perPage=1000&returnType=JSON&serviceKey=${encodeURIComponent(KEY)}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch { console.log(`[ext] ${file.title} 응답 오류: ${text.slice(0, 120)}`); break; }
      if (d.code && d.code < 0) { console.log(`[ext] ${file.title} [${d.code}] ${d.msg || ''}`); break; }
      total = d.totalCount ?? d.matchCount ?? 0;
      for (const x of d.data || []) raw.push({ x, file: file.title });
      got += (d.data || []).length;
      if (!d.data?.length) break;
      page++;
    }
  }
  const norm = []; const seen = new Set();
  for (const { x, file } of raw) {
    const r = src === 'd2bfac' ? {
      org: '방위사업청', bidNtceNo: String(pick(x, '입찰공고번호')), bidNtceOrd: String(pick(x, '입찰공고차수') || '1'),
      bidNtceNm: pick(x, '입찰공고명'), kindNm: pick(x, '업무구분명'), method: pick(x, '계약체결방법명'), selection: pick(x, '낙찰자결정방법명'),
      ntceInstt: pick(x, '공고기관명'), dminstt: pick(x, '수요기관명'), lowerRate: String(pick(x, '낙찰하한율')),
      plnprc: String(pick(x, '예정가격')).replace(/[^0-9]/g, ''), basic: String(pick(x, '기초금액')).replace(/[^0-9]/g, ''),
      amount: String(pick(x, '추정가격')).replace(/[^0-9]/g, ''),
      opengDt: normDate(pick(x, '개찰일시') || `${pick(x, '개찰일자')}${String(pick(x, '개찰시각')).replace(/[^0-9]/g, '').padStart(4, '0').slice(0, 4)}`),
      status: pick(x, '개찰결과구분명'), rate: String(pick(x, '최종낙찰율')), fnlDate: normDate(pick(x, '최종낙찰일자')),
      winnerNm: pick(x, '최종낙찰업체명'), winnerCeo: pick(x, '최종낙찰업체대표자명'),
      winnerBizno: String(pick(x, '최종낙찰업체사업자등록번호')).replace(/[^0-9]/g, ''), winnerAdrs: pick(x, '최종낙찰업체주소'), file,
    } : src === 'kr' ? {
      org: cfg.name, bidNtceNo: '', bidNtceNm: pick(x, '공고명'), kindNm: pick(x, '공고구분'),
      amount: String(pick(x, '설계금액')).replace(/[^0-9]/g, ''), prearng: pick(x, '예가방식'), method: pick(x, '계약방법'),
      standard: pick(x, '심사기준'), lowerRate: pick(x, '낙찰하한율'), jv: pick(x, '공동수급협정서구성방식'),
      ntceDt: normDate(pick(x, '공고게시일자')), beginDt: normDate(pick(x, '입찰서접수게시일자')),
      clseDt: normDate(pick(x, '입찰서접수마감일자')), opengDt: normDate(pick(x, '개찰일자')),
      status: pick(x, '진행상태'), officer: pick(x, '입찰담당관'), dept: pick(x, '소속'), file,
    } : {
      org: cfg.name, bidNtceNo: String(pick(x, '입찰공고번호')), bidNtceNm: pick(x, '입찰공고명'),
      ntceDt: '', beginDt: normDate(pick(x, '입찰서접수개시일')), clseDt: normDate(pick(x, '입찰서접수마감일')),
      opengDt: normDate(pick(x, '개찰일')), file,
    };
    const k = src === 'd2bfac' ? `${r.bidNtceNo}-${r.bidNtceOrd}` : (r.bidNtceNo || `${r.bidNtceNm}|${r.ntceDt}|${r.opengDt}`);
    if (seen.has(k)) continue;
    seen.add(k); norm.push(r);
  }
  if (!norm.length) throw new Error('파일 데이터를 받지 못했습니다');
  const out = { t: Date.now(), rows: norm, file: files.map((f) => f.title.match(/(\d{8})\s*$/)?.[1] || f.title).join(' + '), files: files.map((f) => f.title) };
  extCache.set(src, out);
  console.log(`[ext] ${cfg.name} 파일 ${files.length}개 → 원본 ${raw.length}건, 중복 제거 후 ${norm.length}건`);
  return out;
}

app.get('/api/ext/:src', async (req, res) => {
  const { src } = req.params;
  if (!EXT[src]) return res.status(404).json({ error: '알 수 없는 기관' });
  if (MOCK || !KEY) return res.json({ items: [], totalCount: 0, file: '(샘플 모드: 데이터 없음)', mock: true });
  try {
    const d = await extLoad(src);
    const q = String(req.query.q || '').trim();
    const words = q.split(/\s+/).filter(Boolean);
    const from = req.query.from || ''; const to = req.query.to ? `${req.query.to} 99` : '';
    const dateOf = (r) => r.ntceDt || r.beginDt || r.opengDt || '';
    let items = d.rows.filter((r) => words.every((w) => `${r.bidNtceNm} ${r.dept || ''} ${r.kindNm || ''}`.includes(w)));
    if (from) items = items.filter((r) => dateOf(r) >= from);
    if (to) items = items.filter((r) => dateOf(r) <= to);
    items.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    const latest = d.rows.reduce((m, r) => (dateOf(r) > m ? dateOf(r) : m), '');
    const size = Math.min(Number(req.query.numOfRows || 30), 5000); const page = Number(req.query.pageNo || 1);
    res.json({ items: items.slice((page - 1) * size, page * size), totalCount: items.length, all: d.rows.length, file: d.file, latest });
  } catch (err) {
    res.status(502).json({ error: `${EXT[src].name} 데이터 조회 실패: ${err.message}` });
  }
});

// ── 국가철도공단 개찰·낙찰 (전자조달 공개 화면) ─────────────────────────────
app.get('/api/krbid/:type', async (req, res) => {
  const { type } = req.params;
  if (!['award', 'openg'].includes(type)) return res.status(404).json({ error: '알 수 없는 구분' });
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const from = String(req.query.from || '') || new Date(Date.now() + 9 * 3600 * 1000 - 7 * 86400000).toISOString().slice(0, 10);
  const to = String(req.query.to || '') || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: '날짜 형식 오류' });
  if ((new Date(to) - new Date(from)) / 86400000 > 92) return res.status(400).json({ error: '기간은 3개월 이내로 지정하세요' });
  try {
    const size = Math.min(Number(req.query.numOfRows || 30), 300);
    const d = await krResults(type, from, to, { q: String(req.query.q || ''), page: Number(req.query.pageNo || 1), size });
    res.json({ items: d.rows, totalCount: d.total, truncated: d.truncated, from, to });
  } catch (err) {
    res.status(502).json({ error: `철도공단 사이트 조회 실패: ${err.message}` });
  }
});

app.get('/api/krbid/:type/detail', async (req, res) => {
  const { type } = req.params;
  const key = Object.fromEntries(['ggNyeondo', 'ggGubun', 'ggIrBeonho', 'ggChasu', 'gyErBeonho'].map((k) => [k, String(req.query[k] || '').replace(/[^0-9]/g, '')]));
  if (!['award', 'openg'].includes(type) || !key.ggNyeondo || !key.ggIrBeonho) return res.status(400).json({ error: '잘못된 요청' });
  try { res.json(await krDetail(type, key)); } catch (err) { res.status(502).json({ error: `철도공단 상세 조회 실패: ${err.message}` }); }
});

// ── 한국수자원공사 전자조달 (data.go.kr B500001) ──────────────────────────────
app.get('/api/kwater/:kind', async (req, res) => {
  const { kind } = req.params;
  if (!KW_OPS[kind]) return res.status(404).json({ error: '알 수 없는 구분' });
  if (MOCK || !KEY) return res.json({ items: [], totalCount: 0, mock: true });
  const kst = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const to = String(req.query.to || '') || kst(new Date());
  const from = String(req.query.from || '') || kst(new Date(Date.now() - 29 * 86400000));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: '날짜 형식 오류' });
  if ((new Date(to) - new Date(from)) / 86400000 > 186) return res.status(400).json({ error: '기간은 6개월 이내로 지정하세요' });
  try {
    const rows = await kwSearch(kind, { from, to, q: String(req.query.q || '') }, KEY);
    const size = Math.min(Number(req.query.numOfRows || 30), 3000); const page = Number(req.query.pageNo || 1);
    res.json({ items: rows.slice((page - 1) * size, page * size).map(({ raw, ...r }) => ({ ...r, raw: req.query.raw ? raw : undefined })),
      totalCount: rows.length, from, to });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── 입찰공고 통합 (나라장터 + 다른 기관) ──────────────────────────────────
app.get('/api/bids/:kind', async (req, res) => {
  const { kind } = req.params;
  const op = `getBidPblancListInfo${kind}PPSSrch`;
  if (!ALLOWED.bid.has(op)) return res.status(404).json({ error: '알 수 없는 구분' });
  const params = {};
  for (const [k, v] of Object.entries(req.query)) if (PARAMS.has(k) && v !== '' && v != null) params[k] = String(v);
  const size = Number(params.numOfRows || 30); const page = Number(params.pageNo || 1);
  try {
    const extP = (MOCK || !KEY || req.query.ext === '0') ? Promise.resolve([])
      : extBids(kind, params, { key: KEY, extLoad }).catch((e) => { console.log(`[unify] bids 실패 ${e.message}`); return []; });
    const multi = String(params.indstrytyNm || '').split(',').filter(Boolean).length > 1;
    const first = multi ? null : await upstream('bid', op, { ...params, numOfRows: 1, pageNo: 1 });
    const ext = await extP;
    const dateOf = (r) => String((params.inqryDiv === '2' ? r.opengDt : r.bidNtceDt) || '');
    let g2b; let g2bTotal;
    if (multi || first.totalCount <= 3000) {
      // 나라장터 결과가 많지 않으면 전부 받아 날짜순으로 섞음
      if (multi) {
        const { indstrytyNm, ...rest } = params;
        const names = String(indstrytyNm).split(',').map((x) => x.trim()).filter(Boolean);
        const parts = await Promise.all(names.map((n) => fetchAll('bid', op, { ...rest, indstrytyNm: n })));
        const seen = new Set(); g2b = [];
        for (const pt of parts) for (const b of pt.items) { const k = `${b.bidNtceNo}-${b.bidNtceOrd}`; if (!seen.has(k)) { seen.add(k); g2b.push(b); } }
      } else g2b = (await fetchAll('bid', op, params)).items;
      const all = g2b.map((r) => ({ ...r, _org: 'g2b' })).concat(ext).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      return res.json({ resultCode: '00', totalCount: all.length, items: all.slice((page - 1) * size, page * size), extCount: ext.length,
        orgCounts: all.reduce((m, r) => { m[r._org] = (m[r._org] || 0) + 1; return m; }, {}), mock: MOCK || !KEY });
    }
    // 나라장터 결과가 아주 많으면: 다른 기관 결과를 앞에, 나라장터는 이어서 페이지 단위로
    g2bTotal = first.totalCount;
    ext.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    const start = (page - 1) * size; const end = start + size;
    const items = ext.slice(start, end);
    if (items.length < size) {
      const gStart = Math.max(0, start - ext.length); const need = size - items.length;
      const p1 = Math.floor(gStart / size) + 1;
      const a = await upstream('bid', op, { ...params, numOfRows: size, pageNo: p1 });
      let pool = a.items;
      if ((gStart % size) + need > size) pool = pool.concat((await upstream('bid', op, { ...params, numOfRows: size, pageNo: p1 + 1 })).items);
      items.push(...pool.slice(gStart % size, (gStart % size) + need).map((r) => ({ ...r, _org: 'g2b' })));
    }
    res.json({ resultCode: '00', totalCount: g2bTotal + ext.length, items, extCount: ext.length, orgCounts: { g2b: g2bTotal, ext: ext.length } });
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? '공공데이터 API 응답 지연 (잠시 후 다시 시도)' : err.message;
    res.status(502).json({ error: msg.startsWith('[') ? msg : `공공데이터 API 호출 실패: ${msg}` });
  }
});

// ── 업체검색 ─────────────────────────────────────────────────────────────
// 사업자번호: 등록업체 기본정보 + 업종(면허) + 최근 낙찰이력
// 업체명: 사용자정보서비스는 업체명 검색에 등록일 기간(최대 1년)이 필요 → 2000년부터 1년씩 나눠 병렬 조회
const corpSearchCache = new Map();
function corpRow(c) {
  const adrs = [c.adrs, c.dtlAdrs].filter(Boolean).join(' ').replace(/\s*\(\s*\)/g, '').replace(/(\d)-0(?![0-9])/g, '$1').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
  return { bizno: String(c.bizno), name: c.corpNm, ceo: c.ceoNm, adrs, tel: c.telNo, fax: c.faxNo, rgnNm: c.rgnNm,
    bsns: c.corpBsnsDivNm, hdoffce: c.hdoffceDivNm, emplyeNum: c.emplyeNum, opbizDt: String(c.opbizDt || '').slice(0, 10),
    rgstDt: String(c.rgstDt || '').slice(0, 10), homepage: c.hmpgAdrs, mnfct: c.mnfctDivNm };
}
async function pool(tasks, n = 6) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k]().catch((e) => ({ error: e.message })); } }));
  return out;
}

// 업체명 검색 — 결과를 연도별로 오는 대로 바로 흘려보냄 (NDJSON). 첫 결과가 1~2초 안에 보임
app.get('/api/corps/stream', async (req, res) => {
  const q = String(req.query.q || '').trim();
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (o) => res.write(JSON.stringify(o) + '\n');
  if (q.length < 2) { send({ type: 'error', error: '업체명은 2글자 이상 입력하세요' }); return res.end(); }
  const idx = corpIndexSearch?.(q);
  if (idx) { send({ type: 'rows', items: idx.items, done: 1, total: 1, fromIndex: true }); send({ type: 'end', totalCount: idx.totalCount, fromIndex: true }); return res.end(); }
  const hit = corpSearchCache.get(q);
  if (hit && Date.now() - hit.t < 24 * 3600 * 1000) { send({ type: 'rows', items: hit.data.items, done: 1, total: 1 }); send({ type: 'end', totalCount: hit.data.totalCount }); return res.end(); }
  if (MOCK || !KEY) { send({ type: 'end', totalCount: 0 }); return res.end(); }
  const nowY = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  const years = []; for (let y = nowY; y >= 2000; y--) years.push(y);
  const seen = new Set(); const all = []; let done = 0; let errors = 0; let closed = false;
  req.on('close', () => { closed = true; });
  send({ type: 'start', total: years.length });
  // 1단계(즉시): 서버가 이미 받아둔 낙찰·개찰 결과에 나온 업체 중 이름이 맞는 곳 → 사업자번호로 바로 조회
  try {
    const nq = q.replace(/\s/g, '');
    const quick = new Map();
    const take = (name, bizno) => { if (name && bizno && String(name).replace(/\s/g, '').includes(nq) && !quick.has(String(bizno))) quick.set(String(bizno), name); };
    for (const { data } of cache.values()) for (const it of data?.items || []) {
      take(it.bidwinnrNm, it.bidwinnrBizno);
      if (it.opengCorpInfo) { const [n, b] = String(it.opengCorpInfo).split('^'); take(n, b); }
      if (it.prcbdrNm) take(it.prcbdrNm, it.prcbdrBizno);
    }
    for (const c of companies.values()) take(c.name, c.bizno);
    const list = [...quick.keys()].slice(0, 30);
    if (list.length) {
      const rows = (await pool(list.map((b) => () => upstream('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: '3', bizno: b, numOfRows: 1, pageNo: 1 })), 10))
        .flatMap((d) => d?.items || []).map(corpRow).filter((r) => !seen.has(r.bizno));
      rows.forEach((r) => { seen.add(r.bizno); all.push(r); });
      if (rows.length && !closed) send({ type: 'rows', items: rows, done: 0, total: years.length, quick: true });
    }
  } catch (e) { console.log(`[corps] 빠른 찾기 실패 ${e.message}`); }
  await pool(years.map((y) => async () => {
    if (closed) return;
    try {
      const items = [];
      for (let p = 1; p <= 3; p++) {
        const d = await upstream('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: '1', inqryBgnDt: `${y}01010000`, inqryEndDt: `${y}12312359`, corpNm: q, numOfRows: 100, pageNo: p });
        items.push(...(d.items || []));
        if (items.length >= d.totalCount || !(d.items || []).length) break;
      }
      const fresh = [];
      for (const c of items) { const b = String(c.bizno); if (!seen.has(b)) { seen.add(b); const r = corpRow(c); fresh.push(r); all.push(r); } }
      done++;
      if (!closed) send({ type: 'rows', items: fresh, done, total: years.length });
    } catch (e) { errors++; done++; if (!closed) send({ type: 'progress', done, total: years.length }); }
  }), 12);
  if (!errors) corpSearchCache.set(q, { t: Date.now(), data: { items: all.slice(0, 300), totalCount: all.length } });
  if (corpSearchCache.size > 300) corpSearchCache.delete(corpSearchCache.keys().next().value);
  send({ type: 'end', totalCount: all.length, partial: errors > 0 });
  res.end();
});
let corpIndexSearch = null; // 등록업체 전체 색인이 준비되면 즉시 검색 함수로 바뀜

app.get('/api/corps/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.replace(/[^0-9]/g, '').length === 10 && /^[0-9-\s]+$/.test(q)) {
    const b = q.replace(/[^0-9]/g, '');
    try {
      const d = await upstream('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: '3', bizno: b, numOfRows: 5, pageNo: 1 });
      return res.json({ items: (d.items || []).map(corpRow), totalCount: d.items?.length || 0 });
    } catch (e) { return res.status(502).json({ error: e.message }); }
  }
  if (q.length < 2) return res.status(400).json({ error: '업체명은 2글자 이상 입력하세요' });
  if (MOCK || !KEY) return res.json({ items: [], totalCount: 0, mock: true });
  const hit = corpSearchCache.get(q);
  if (hit && Date.now() - hit.t < 24 * 3600 * 1000) return res.json(hit.data);
  const nowY = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  const years = []; for (let y = nowY; y >= 2000; y--) years.push(y);
  const results = await pool(years.map((y) => async () => {
    const items = [];
    for (let p = 1; p <= 3; p++) {
      const d = await upstream('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: '1', inqryBgnDt: `${y}01010000`, inqryEndDt: `${y}12312359`, corpNm: q, numOfRows: 100, pageNo: p });
      items.push(...(d.items || []));
      if (items.length >= d.totalCount || !(d.items || []).length) break;
    }
    return { items };
  }), 10);
  const seen = new Set(); const rows = [];
  const errors = results.filter((r) => r?.error).length;
  for (const r of results) for (const c of r?.items || []) { const b = String(c.bizno); if (!seen.has(b)) { seen.add(b); rows.push(corpRow(c)); } }
  const norm = (x) => String(x || '').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)|합자회사|\s/g, '');
  const nq = norm(q);
  rows.sort((a, b) => (norm(b.name) === nq) - (norm(a.name) === nq) || norm(a.name).localeCompare(norm(b.name), 'ko'));
  const data = { items: rows.slice(0, 300), totalCount: rows.length, partial: errors > 0 };
  if (!errors) corpSearchCache.set(q, { t: Date.now(), data });
  if (corpSearchCache.size > 300) corpSearchCache.delete(corpSearchCache.keys().next().value);
  res.json(data);
});

app.get('/api/corps/:bizno/detail', async (req, res) => {
  const b = String(req.params.bizno).replace(/[^0-9]/g, '');
  if (b.length !== 10) return res.status(400).json({ error: '사업자번호 10자리가 필요합니다' });
  try {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const months = [0, 1, 2, 3, 4, 5].map((m) => {
      const end = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - m + 1, 0));
      const start = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - m, 1));
      const f = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
      return [f(start), m === 0 ? f(kst) : f(end)];
    });
    const [basic, ind, wins] = await Promise.all([
      upstream('usr', 'getPrcrmntCorpBasicInfo02', { inqryDiv: '3', bizno: b, numOfRows: 5, pageNo: 1 }).catch((e) => ({ error: e.message })),
      upstream('usr', 'getPrcrmntCorpIndstrytyInfo02', { inqryDiv: '1', bizno: b, numOfRows: 100, pageNo: 1 }).catch((e) => ({ error: e.message })),
      pool(months.flatMap(([f, t]) => ['Cnstwk', 'Servc', 'Thng'].map((k) => () =>
        upstream('scs', `getScsbidListSttus${k}PPSSrch`, { inqryDiv: '2', inqryBgnDt: `${f}0000`, inqryEndDt: `${t}2359`, bizno: b, numOfRows: 100, pageNo: 1 })
          .then((d) => (d.items || []).filter((x) => String(x.bidwinnrBizno) === b).map((x) => ({ ...x, _kind: k }))))), 6),
    ]);
    // 방위사업청 시설공사 낙찰(파일 데이터, 2022~2025) — 사업자번호로 거름
    let d2bAwards = [];
    try {
      const f = await extLoad('d2bfac');
      d2bAwards = f.rows.filter((r) => r.winnerBizno === b).map((r) => ({ _kind: /용역/.test(r.kindNm) ? 'Servc' : 'Cnstwk', _org: 'd2b',
        bidNtceNo: r.bidNtceNo, bidNtceOrd: r.bidNtceOrd, bidNtceNm: r.bidNtceNm, dminsttNm: r.dminstt || r.ntceInstt,
        sucsfbidAmt: '', sucsfbidRate: r.rate, prtcptCnum: '', opengDt: r.opengDt }));
    } catch (e) { console.log(`[corp] 방위사업청 파일 실패 ${e.message}`); }
    const c = basic.items?.[0];
    const industries = (ind.items || []).map((x) => ({ name: x.indstrytyNm, code: x.indstrytyCd, main: x.rprsntIndstrytyYn === 'Y',
      rgstDt: String(x.rgstDt || '').slice(0, 10), expire: String(x.vldPrdExprtDt || '').slice(0, 10), state: x.indstrytyStatsNm }));
    const awards = wins.flatMap((w) => (Array.isArray(w) ? w : [])).map((x) => ({ _kind: x._kind, bidNtceNo: x.bidNtceNo, bidNtceOrd: x.bidNtceOrd,
      bidNtceNm: x.bidNtceNm, dminsttNm: x.dminsttNm, sucsfbidAmt: x.sucsfbidAmt, sucsfbidRate: x.sucsfbidRate, prtcptCnum: x.prtcptCnum, opengDt: x.rlOpengDt }))
      .concat(d2bAwards)
      .sort((a, b2) => String(b2.opengDt).localeCompare(String(a.opengDt)));
    const seen = new Set();
    res.json({ basic: c ? corpRow(c) : null, basicError: basic.error || '', industries, d2bCount: d2bAwards.length, awards: awards.filter((a) => { const k = `${a.bidNtceNo}-${a.bidNtceOrd}`; if (seen.has(k)) return false; seen.add(k); return true; }) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/award/:kind', async (req, res) => {
  const { kind } = req.params;
  const kinds = kind === 'All' ? AWARD_KINDS : AWARD_KINDS.includes(kind) ? [kind] : null;
  if (!kinds) return res.status(404).json({ error: '알 수 없는 업무구분' });
  const params = {};
  for (const [k, v] of Object.entries(req.query)) if (PARAMS.has(k) && v !== '' && v != null) params[k] = String(v);
  if (!params.inqryBgnDt || !params.inqryEndDt) return res.status(400).json({ error: '조회 기간을 입력하세요' });
  try {
    const withExt = req.query.ext !== '0' && !(MOCK || !KEY);
    const [parts, ext] = await Promise.all([
      Promise.all(kinds.map((k) => awardForKind(k, params))),
      withExt ? extAwards(kind, params, { key: KEY, extLoad }).catch((e) => { console.log(`[unify] award 실패 ${e.message}`); return []; }) : [],
    ]);
    // 사업자번호 없는 기관 자료: 이미 알고 있는 업체면 사업자번호 채움 (추가 조회 없이)
    for (const r of ext) if (!r.bidwinnrBizno && r.bidwinnrNm) r.bidwinnrBizno = await biznoByName(r.bidwinnrNm, { quickOnly: true });
    const rows = parts.flatMap((p) => p.rows).map((r) => ({ ...r, _org: 'g2b' })).concat(ext)
      .sort((a, b) => String(b.opengDt).localeCompare(String(a.opengDt)));
    const size = Number(params.numOfRows || 20); const page = Number(params.pageNo || 1);
    res.json({
      resultCode: '00', totalCount: rows.length, pageNo: page, numOfRows: size,
      items: rows.slice((page - 1) * size, page * size),
      industryFiltered: !!(params.indstrytyNm || params.indstrytyCd),
      truncated: parts.some((p) => p.truncated), mock: parts.some((p) => p.mock),
      extCount: ext.length, orgCounts: rows.reduce((m, r) => { m[r._org] = (m[r._org] || 0) + 1; return m; }, {}),
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
// index.html은 캐시하지 않음(새 버전이 바로 보이도록). 해시 붙은 assets는 오래 캐시
app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '365d', immutable: true }));
app.use(express.static(dist, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(dist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`입찰정보 서버 :${PORT} ${MOCK || !KEY ? '(샘플데이터 모드)' : ''}`);
  // 무료 플랜 잠들기 방지: 10분마다 자기 주소 호출 (Render가 RENDER_EXTERNAL_URL 자동 제공)
  if (process.env.RENDER_EXTERNAL_URL && process.env.KEEPALIVE !== '0') {
    setInterval(() => fetch(`${process.env.RENDER_EXTERNAL_URL}/api/health`).catch(() => {}), 10 * 60 * 1000);
  }
  // 파일 데이터(철도·방위사업청)는 처음 받는 데 1분 이상 걸려서 서버 시작 직후 미리 받아둠
  if (KEY && !MOCK) setTimeout(async () => { for (const src of ['d2bfac', 'kr', 'korail']) await extLoad(src).catch((e) => console.log(`[ext] 미리받기 실패 ${src}: ${e.message}`)); }, 3000);
  if (!MOCK && KEY) import('./korail.js').then((m) => m.korailWarm()).catch((e) => console.log('[korail] warm fail', e.message));
  if (process.env.CHECK !== '0') setTimeout(() => selfTest(`http://localhost:${PORT}`).catch((e) => console.log('[CHECK] fail', e.message)), 120000);
});
