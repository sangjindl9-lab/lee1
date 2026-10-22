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
  'bizno',
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
  const data = normalize(JSON.parse(text));
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

// 낙찰·개찰 API는 업종 조건이 제대로 걸러지지 않음(실측: 개찰 0건, 낙찰은 거의 전체).
// → 입찰공고 API(업종 필터 정상)로 해당 업종 공고번호를 먼저 받고, 결과를 그 번호로 거름.
async function industryJoin(op, params) {
  const kind = (op.match(/(Cnstwk|Servc|Thng|Frgcpt)/) || [])[1];
  const { indstrytyNm, indstrytyCd, pageNo = '1', numOfRows = '20', ...rest } = params;
  const dateDiv = rest.inqryDiv === '1' ? '1' : '2'; // 1:공고게시일, 2:개찰일 (세 API 공통 의미)
  const bidParams = { inqryDiv: dateDiv, inqryBgnDt: rest.inqryBgnDt, inqryEndDt: rest.inqryEndDt };
  if (indstrytyNm) bidParams.indstrytyNm = indstrytyNm;
  if (indstrytyCd) bidParams.indstrytyCd = indstrytyCd;
  // 개찰일 기준이면 공고가 기간보다 앞서 나왔을 수 있으므로 입찰공고도 개찰일 기준으로 조회
  const [bids, results] = await Promise.all([
    fetchAll('bid', `getBidPblancListInfo${kind}PPSSrch`, bidParams),
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
    const data = needJoin ? await industryJoin(op, params) : await upstream(svc, op, params);
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
