// 나라장터 외 기관(수자원공사·국가철도공단·한국철도공사) 결과를 나라장터 목록과 같은 형태로 변환해 합치기
import { kwSearch } from './kwater.js';
import { krResults } from './krbid.js';
import { kepcoNotices } from './kepco.js';
import { d2bRows, d2bNoticeRow, d2bResultRow, d2bFillWinners } from './d2b.js';
import { korailNotices, korailContracts, korailOpengRows } from './korail.js';

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

// 참가지역 선택 시: 다른 기관 자료에는 지역 칸이 없어 기관·부서·공고명에 나오는 지명으로 판단
// (방위사업청은 발주 부대명으로 판단 — 강원 주둔 부대)
const RGN_WORDS = {
  51: '강원 강릉 춘천 원주 속초 태백 삼척 동해 정선 영월 평창 횡성 홍천 화천 양구 인제 양양 철원 소양강 영동선 태백선 정선선 경강선 고성군 3군단 제2군단 제7보병사단 제12보병사단 제15보병사단 제21보병사단 제22보병사단 제2보병사단 제3보병사단 제6보병사단 제11기동사단 제8385부대 제1862부대 해군제1함대 제8전투비행단 제18전투비행단',
  42: '강원 강릉 춘천 원주 속초 태백 삼척 동해 정선 영월 평창 횡성 홍천 화천 양구 인제 양양 철원 소양강 영동선 태백선 정선선 경강선 고성군 3군단 제2군단 제7보병사단 제12보병사단 제15보병사단 제21보병사단 제22보병사단 제2보병사단 제3보병사단 제6보병사단 제11기동사단 제8385부대 제1862부대 해군제1함대 제8전투비행단 제18전투비행단',
  11: '서울', 41: '경기 수원 성남 용인 고양 화성 안산 안양 평택 시흥 김포 파주 의정부 광명 하남 오산 이천 안성 여주 양평 가평 연천 포천 동두천 구리 남양주 군포 의왕 과천 부천 시화',
  28: '인천 강화 옹진', 43: '충북 충청북도 청주 충주 제천 보은 옥천 영동 증평 진천 괴산 음성 단양 충북선',
  44: '충남 충청남도 천안 공주 보령 아산 서산 논산 계룡 당진 금산 부여 서천 청양 홍성 예산 태안 장항선 대전충남',
  30: '대전', 36: '세종', 47: '경북 경상북도 포항 경주 김천 안동 구미 영주 영천 상주 문경 경산 의성 청송 영양 영덕 청도 고령 성주 칠곡 예천 봉화 울진 울릉 대구경북',
  48: '경남 경상남도 창원 진주 통영 사천 김해 밀양 거제 양산 의령 함안 창녕 남해 하동 산청 함양 거창 합천 부산경남',
  26: '부산', 27: '대구', 31: '울산 온산', 52: '전북 전라북도 전주 군산 익산 정읍 남원 김제 완주 진안 무주 장수 임실 순창 고창 부안 전라선',
  45: '전북 전라북도 전주 군산 익산 정읍 남원 김제 완주 진안 무주 장수 임실 순창 고창 부안 전라선',
  46: '전남 전라남도 목포 여수 순천 나주 광양 담양 곡성 구례 고흥 보성 화순 장흥 강진 해남 영암 무안 함평 영광 장성 완도 진도 신안 광주전남',
  29: '광주', 12: '광주 전남 전라남도 목포 여수 순천 나주 광양', 50: '제주',
};
function regionMatch(r, code) {
  if (!code || code === '00' || !RGN_WORDS[code]) return true;
  const text = `${r.ntceInsttNm} ${r.dminsttNm} ${r.bidNtceNm}`;
  return RGN_WORDS[code].split(' ').some((w) => text.includes(w));
}

function commonFilter(r, p) {
  if (!regionMatch(r, p.prtcptLmtRgnCd)) return false;
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
  const d2bOut = [];
  for (const [key, src] of [['fcltyResult', 'fclty'], ['dmstcResult', 'dmstc'], ['fcltyNego', 'nego']]) {
    jobs.push(d2bRows(key, process.env.DATA_GO_KR_KEY).then((list) => list.forEach((x) => {
      const r = d2bResultRow(x, src);
      if (!want(r._kind) || !inRange(r.opengDt, from, to)) return;
      if (src === 'nego' && /유찰|취소/.test(r.awardStatus)) return;
      d2bOut.push(r);
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
    // 계약결과(확정)를 우선, 아직 계약 전인 건은 개찰결과 1순위로
    jobs.push(Promise.all([
      korailContracts(from, until).catch((e) => { console.log(`[unify] 철도공사 계약 실패: ${e.message}`); return []; }),
      korailOpengRows(from, to).catch((e) => { console.log(`[unify] 철도공사 개찰 실패: ${e.message}`); return []; }),
    ]).then(([cont, openg]) => {
      const done = new Set();
      const g2bNo = (r) => /^R\d{2}/.test(r.bidNtceNo); // 나라장터로 발주한 건은 나라장터 자료에 이미 있음
      for (const r of cont) if (!g2bNo(r) && want(r._kind) && inRange(r.opengDt, from, to)) { rows.push(r); done.add(r.bidNtceNo); }
      for (const r of openg) if (!g2bNo(r) && want(r._kind) && !done.has(r.bidNtceNo)) rows.push(r);
    }));
  }
  await Promise.all(jobs);
  // 방위사업청: 조건에 맞는 건만 낙찰업체 채우기(하루 호출 제한 때문에 조회된 건 우선)
  rows.push(...d2bFillWinners(d2bOut.filter((r) => commonFilter(r, p)), process.env.DATA_GO_KR_KEY));
  return rows.filter((r) => {
    if (!commonFilter(r, p)) return false;
    if (p.bizno && r.bidwinnrBizno !== p.bizno.replaceAll('-', '')) return false;
    return true;
  });
}
