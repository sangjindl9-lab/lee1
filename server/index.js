// 입찰정보 사이트 서버
// - 공공데이터포털(조달청 나라장터) API를 서버에서 대신 호출 → 인증키는 브라우저에 노출되지 않음
// - React 빌드 결과(client/dist)를 정적 파일로 서빙
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockResponse } from './mock.js';

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

app.get('/api/:svc/:op', async (req, res) => {
  const { svc, op } = req.params;
  if (!SERVICES[svc] || !ALLOWED[svc].has(op)) return res.status(404).json({ error: '허용되지 않은 오퍼레이션' });

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (PARAMS.has(k) && v !== '' && v != null) qs.set(k, String(v));
  }
  if (!qs.has('numOfRows')) qs.set('numOfRows', '20');
  if (!qs.has('pageNo')) qs.set('pageNo', '1');
  qs.set('type', 'json');

  const cacheKey = `${svc}/${op}?${qs}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.t < TTL) return res.json(hit.data);

  if (MOCK || !KEY) {
    const data = { ...mockResponse(svc, op, Object.fromEntries(qs)), mock: true };
    return res.json(data);
  }

  const url = `${SERVICES[svc]}/${op}?serviceKey=${encodeURIComponent(KEY)}&${qs}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let data;
    if (text.trim().startsWith('{')) {
      data = normalize(JSON.parse(text));
      if (data.resultCode && data.resultCode !== '00') {
        return res.status(502).json({ error: `[${data.resultCode}] ${data.resultMsg}` });
      }
    } else {
      const e = parseXmlError(text);
      return res.status(502).json({ error: `[${e.code}] ${e.msg}` });
    }
    cache.set(cacheKey, { t: Date.now(), data });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: `공공데이터 API 호출 실패: ${err.message}` });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, mock: MOCK || !KEY }));

const dist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => console.log(`입찰정보 서버 :${PORT} ${MOCK || !KEY ? '(샘플데이터 모드)' : ''}`));
