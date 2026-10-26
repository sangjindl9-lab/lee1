// 나라장터 외 기관(수자원공사·국가철도공단·한국철도공사) 결과를 나라장터 목록과 같은 형태로 변환해 합치기
import { kwSearch } from './kwater.js';
import { krResults } from './krbid.js';
import { kepcoNotices } from './kepco.js';
import { d2bRows, d2bNoticeRow, d2bResultRow } from './d2b.js';
import { korailNotices, korailContracts } from './korail.js';

// 업종 체크박스 → 공고명 키워드 (다른 기관은 업종 정보가 없어 공고명으로 판단)
const INDUSTRY_WORDS = [
  [/전기/, ['전기', '전력', '배전', '변전', '조명', '태양광', '발전기', '수배전']],
  [/정보통신|통신/, ['통신', '정보통신', 'CCTV', 'LTE', '네트워크', '방송', '영상감시', 'ICT']],
  [/소방/, ['소방']],
  [/기계/, ['기계', '설비', '공조', '배관']],
  [/건축/, ['건축', '리모델링', '신축']],
  [/토목/, ['토목', '도로', '포장', '하천', '정비사업']],
  [/실내/, ['실내', '인테리어']],
  [/조경/, ['조경']],
];
function industryMatch(title, indstrytyNm) {
  const names = String(indstrytyNm || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!names.length) return true;
  return names.some((n) => {
    const rule = INDUSTRY_WORDS.find(([re]) => re.test(n));
    const words = rule ? rule[1] : [n.replace(/공사업|업$/g, '')];
    return words.some((w) => title.includes(w));
  });
}

const KIND_OF = (nm, title = '') => {
  if (/공사/.test(nm)) return 'Cnstwk';
  if (/용역/.test(nm)) return 'Servc';
  if (/물품|구매|내자|외자/.test(nm)) return nm === '외자' ? 'Frgcpt' : 'Thng';
  // 구분이 없는 자료(철도공사 파일)는 공고명으로 추정
  if (/용역|감리|설계|진단|관리/.test(title)) return 'Servc';
  if (/구매|구입|제조|납품/.test(title)) return 'Thng';
  return 'Cnstwk';
};

const ymd = (s) => String(s || '').slice(0, 10);
const inRange = (d, from, to) => { const x = ymd(d); return x && x >= from && x <= to; };
const apiToIso = (s) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');

function commonFilter(r, p) {
  const words = String(p.bidNtceNm || '').split(/\s+/).filter(Boolean);
  if (!words.every((w) => r.bidNtceNm.includes(w))) return false;
  if (!industryMatch(r.bidNtceNm, p.indstrytyNm)) return false;
  const inst = `${r.ntceInsttNm} ${r.dminsttNm}`;
  if (p.dminsttNm && !inst.includes(p.dminsttNm)) return false;
  if (p.ntceInsttNm && !inst.includes(p.ntceInsttNm)) return false;
  const price = Number(r.presmptPrce) || 0;
  if (p.presmptPrceBgn && (!price || price < Number(p.presmptPrceBgn))) return false;
  if (p.presmptPrceEnd && (!price || price > Number(p.presmptPrceEnd))) return false;
  return true;
}

// ── 입찰공고 ─────────────────────────────────────────────────────────────
export async function extBids(kind, p, { key, extLoad }) {
  const from = apiToIso(p.inqryBgnDt); const to = apiToIso(p.inqryEndDt);
  if (!from || !to) return [];
  const byOpeng = p.inqryDiv === '2';
  const rows = [];
  const jobs = [];
  // 수자원공사 (실시간 API): 공고일 기준만 제공
  if (!byOpeng) {
    const kwKinds = { Cnstwk: ['cntrwk'], Servc: ['servc'], Thng: ['gds', 'dmscpt'], Frgcpt: [], Etc: [] }[kind] || [];
    for (const k of kwKinds) {
      jobs.push(kwSearch(k, { from, to }, key).then((list) => list.forEach((x) => rows.push({
        _org: 'kwater', _orgNm: '수자원공사', _kind: kind, bidNtceNo: x.bidNtceNo, bidNtceOrd: '000', bidNtceNm: x.bidNtceNm,
        ntceInsttNm: '한국수자원공사', dminsttNm: `한국수자원공사 ${x.dept}`.trim(), presmptPrce: x.plnprc !== '0' ? x.plnprc : '',
        cntrctCnclsMthdNm: x.method, ntceKindNm: '등록공고', bidNtceDt: x.ntceDt, bidClseDt: x.clseDt, opengDt: '',
        _status: x.status, _officer: x.officer, bidNtceDtlUrl: 'https://ebid.kwater.or.kr/',
      }))).catch((e) => console.log(`[unify] 수자원공사 ${k} 실패: ${e.message}`)));
    }
  }
  // 한전 + 발전 자회사 (전력데이터 개방포털, 별도 키 KEPCO_API_KEY)
  if (!byOpeng && process.env.KEPCO_API_KEY) {
    jobs.push(kepcoNotices(from, to, process.env.KEPCO_API_KEY).then((list) => list.forEach((x) => {
      if (x._kind === kind && inRange(x.bidNtceDt, from, to)) rows.push(x);
    })).catch((e) => console.log(`[unify] 한전 실패: ${e.message}`)));
  }
  // 방위사업청 (시설=공사·용역, 국내=물품). 최근 60일 보관본에서 거름
  for (const [key, src] of [['fcltyNotice', 'fclty'], ['dmstcNotice', 'dmstc']]) {
    if (src === 'fclty' && !['Cnstwk', 'Servc'].includes(kind)) continue;
    if (src === 'dmstc' && kind !== 'Thng') continue;
    jobs.push(d2bRows(key, process.env.DATA_GO_KR_KEY).then((list) => list.forEach((x) => {
      const r = d2bNoticeRow(x, src);
      if (r._kind !== kind || /취소/.test(r.ntceKindNm)) return;
      if (!inRange(byOpeng ? r.opengDt : r.bidNtceDt, from, to)) return;
      rows.push(r);
    })).catch((e) => console.log(`[unify] 방위사업청 공고 실패: ${e.message}`)));
  }
  // 한국철도공사 (전자조달 실시간) — 공고일 기준. 실패하면 공공데이터 파일로 대신
  let korailLive = false;
  if (!byOpeng) {
    jobs.push(korailNotices(from, to).then((list) => { korailLive = true; list.forEach((r) => { if (r._kind === kind) rows.push(r); }); })
      .catch((e) => console.log(`[unify] 철도공사 실시간 실패: ${e.message}`)));
  }
  await Promise.all(jobs.splice(0));
  // 국가철도공단·한국철도공사 (공공데이터 파일)
  for (const src of ['kr', 'korail']) {
    if (src === 'korail' && korailLive) continue;
    jobs.push(extLoad(src).then((d) => d.rows.forEach((x) => {
      if (KIND_OF(x.kindNm || '', x.bidNtceNm) !== kind) return;
      const date = byOpeng ? x.opengDt : (x.ntceDt || x.beginDt);
      if (!inRange(date, from, to)) return;
      const orgNm = src === 'kr' ? '국가철도공단' : '한국철도공사';
      rows.push({
        _org: src, _orgNm: src === 'kr' ? '철도공단' : '철도공사', _kind: kind, bidNtceNo: x.bidNtceNo || '', bidNtceOrd: '000', bidNtceNm: x.bidNtceNm,
        ntceInsttNm: orgNm, dminsttNm: `${orgNm} ${x.dept || ''}`.trim(), presmptPrce: x.amount || '',
        cntrctCnclsMthdNm: x.method || '', ntceKindNm: '등록공고', bidNtceDt: x.ntceDt || x.beginDt, bidClseDt: x.clseDt, opengDt: x.opengDt,
        sucsfbidLwltRate: x.lowerRate || '', _status: x.status || '', _officer: x.officer || '',
        bidNtceDtlUrl: src === 'kr' ? 'https://ebid.kr.or.kr/' : 'https://ebid.korail.com/',
      });
    })).catch((e) => console.log(`[unify] ${src} 파일 실패: ${e.message}`)));
  }
  await Promise.all(jobs);
  // 같은 공고의 정정·재공고는 마지막 차수만 남김 (방위사업청)
  const latest = new Map();
  for (const r of rows) {
    if (r._org !== 'd2b') continue;
    const k = r._raw?.cntrwkNo || r.bidNtceNo;
    const prev = latest.get(k);
    if (!prev || Number(r.bidNtceOrd) >= Number(prev.bidNtceOrd)) latest.set(k, r);
  }
  return rows.filter((r) => (r._org !== 'd2b' || latest.get(r._raw?.cntrwkNo || r.bidNtceNo) === r) && commonFilter(r, p));
}

// ── 낙찰정보 ─────────────────────────────────────────────────────────────
export async function extAwards(kind, p, { key, extLoad }) {
  const from = apiToIso(p.inqryBgnDt); const to = apiToIso(p.inqryEndDt);
  if (!from || !to || p.inqryDiv === '1') return []; // 다른 기관은 개찰(처리)일 기준만
  const want = (k) => kind === 'All' || k === kind;
  const rows = []; const jobs = [];
  jobs.push(kwSearch('rst', { from, to }, key).then((list) => list.forEach((x) => {
    const k = KIND_OF(x.kindNm, x.bidNtceNm);
    if (!want(k)) return;
    rows.push({
      _org: 'kwater', _orgNm: '수자원공사', _kind: k, bidNtceNo: x.bidNtceNo, bidNtceOrd: '000', bidNtceNm: x.bidNtceNm,
      ntceInsttNm: '한국수자원공사', dminsttNm: `한국수자원공사 ${x.dept}`.trim(), presmptPrce: '',
      awardStatus: x.status === '낙찰' ? '낙찰확정' : '낙찰예정', bidwinnrNm: x.winnerNm, bidwinnrBizno: '', bidwinnrCeoNm: '',
      sucsfbidAmt: x.winnerAmt, sucsfbidRate: '', prtcptCnum: '', opengDt: x.opengDt, rlOpengDt: x.opengDt,
      cntrctCnclsMthdNm: x.method, _selection: x.selection, _officer: x.officer, bidNtceDtlUrl: 'https://ebid.kwater.or.kr/',
    });
  })).catch((e) => console.log(`[unify] 수자원공사 낙찰 실패: ${e.message}`)));
  // 방위사업청 시설공사 경쟁 입찰결과 파일(2022~2025): 최종낙찰업체·사업자번호·낙찰율 포함
  if (extLoad && from <= '2025-12-31') {
    jobs.push(extLoad('d2bfac').then((d) => d.rows.forEach((x) => {
      const k = /용역/.test(x.kindNm) ? 'Servc' : 'Cnstwk';
      if (!want(k) || !inRange(x.opengDt, from, to)) return;
      const rate = Number(x.rate) || 0; const pln = Number(x.plnprc) || 0;
      rows.push({
        _org: 'd2b', _orgNm: '방위사업청', _kind: k, bidNtceNo: x.bidNtceNo, bidNtceOrd: String(x.bidNtceOrd).padStart(3, '0'), bidNtceNm: x.bidNtceNm,
        ntceInsttNm: x.ntceInstt || '방위사업청', dminsttNm: x.dminstt || x.ntceInstt, presmptPrce: x.amount,
        awardStatus: x.winnerNm ? '낙찰확정' : (x.status || '개찰'), bidwinnrNm: x.winnerNm, bidwinnrBizno: x.winnerBizno, bidwinnrCeoNm: x.winnerCeo,
        bidwinnrAdrs: x.winnerAdrs, sucsfbidAmt: rate && pln ? String(Math.round((pln * rate) / 100)) : '', sucsfbidRate: x.rate, prtcptCnum: '',
        opengDt: x.opengDt, rlOpengDt: x.opengDt, sucsfbidLwltRate: x.lowerRate, cntrctCnclsMthdNm: x.method, _selection: x.selection,
        _plnprc: x.plnprc, _basic: x.basic, _amtEstimated: !!(rate && pln), bidNtceDtlUrl: 'https://www.d2b.go.kr/',
      });
    })).catch((e) => console.log(`[unify] 방위사업청 파일 실패: ${e.message}`)));
  }
  // 방위사업청 입찰결과 (낙찰업체는 상세 API 확인 전까지 비어 있음)
  for (const [key, src] of [['fcltyResult', 'fclty'], ['dmstcResult', 'dmstc']]) {
    jobs.push(d2bRows(key, process.env.DATA_GO_KR_KEY).then((list) => list.forEach((x) => {
      const r = d2bResultRow(x, src);
      if (!want(r._kind) || !inRange(r.opengDt, from, to)) return;
      rows.push(r);
    })).catch((e) => console.log(`[unify] 방위사업청 결과 실패: ${e.message}`)));
  }
  // 국가철도공단: 개찰결과 목록(1순위) — 처리상태가 낙찰이면 낙찰확정
  jobs.push(krResults('openg', from, to, { page: 1, size: 400 }).then((d) => d.rows.forEach((x) => {
    const k = KIND_OF(x.kindNm, x.bidNtceNm);
    if (!want(k) || !x.winnerNm) return;
    rows.push({
      _org: 'kr', _orgNm: '철도공단', _kind: k, bidNtceNo: x.bidNtceNo, bidNtceOrd: '000', bidNtceNm: x.bidNtceNm,
      ntceInsttNm: '국가철도공단', dminsttNm: '국가철도공단', presmptPrce: x.presmptPrce || x.amount,
      awardStatus: /낙찰|계약/.test(x.status) ? '낙찰확정' : '1순위', bidwinnrNm: x.winnerNm, bidwinnrBizno: x.winnerBizno, bidwinnrCeoNm: x.winnerCeo,
      sucsfbidAmt: x.winnerAmt, sucsfbidRate: x.winnerRate, prtcptCnum: '', opengDt: x.opengDt, rlOpengDt: x.opengDt,
      sucsfbidLwltRate: x.lowerRate, cntrctCnclsMthdNm: x.method, _plnprc: x.plnprc, _krKey: x.key, bidNtceDtlUrl: 'https://ebid.kr.or.kr/',
    });
  })).catch((e) => console.log(`[unify] 철도공단 개찰 실패: ${e.message}`)));
  // 한국철도공사 계약결과(실시간): 계약일로 조회한 뒤 개찰일이 기간 안인 것만
  {
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const until = new Date(Math.min(new Date(today), new Date(to).getTime() + 60 * 86400000)).toISOString().slice(0, 10);
    jobs.push(korailContracts(from, until).then((list) => list.forEach((r) => {
      if (want(r._kind) && inRange(r.opengDt, from, to)) rows.push(r);
    })).catch((e) => console.log(`[unify] 철도공사 계약 실패: ${e.message}`)));
  }
  await Promise.all(jobs);
  return rows.filter((r) => {
    if (!commonFilter(r, p)) return false;
    if (p.bizno && r.bidwinnrBizno !== p.bizno.replaceAll('-', '')) return false;
    return true;
  });
}
