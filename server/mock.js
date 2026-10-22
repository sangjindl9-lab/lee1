// 인증키가 없거나 MOCK=1일 때 사용하는 샘플 데이터 (API 문서의 응답 필드명 그대로)
const ORGS = [
  ['강원특별자치도 원주시', '4201000'], ['한국전력공사 강원본부', 'B551250'], ['강원특별자치도교육청', '7590000'],
  ['국민건강보험공단', 'B551182'], ['조달청 강원지방조달청', '1230100'], ['강원특별자치도 횡성군', '4204000'],
  ['한국토지주택공사 강원지역본부', 'B552555'], ['원주지방환경청', '1480540'],
];
const TITLES = {
  Cnstwk: ['청사 노후 수배전반 교체 전기공사', '가로등 LED 교체공사', '초등학교 정보통신 설비 개선공사', '체육관 조명설비 교체공사',
    '하수처리장 전기설비 보수공사', 'CCTV 설치 정보통신공사', '태양광 발전설비 설치공사', '도서관 소방전기 보수공사',
    '공영주차장 전기차 충전시설 설치공사', '마을회관 전기·통신 개보수공사'],
  Servc: ['전기안전관리 대행용역', '정보통신 유지보수 용역', '전기설비 정밀안전진단 용역', '설계용역(전기·통신)'],
  Thng: ['LED 투광등 구매', '수배전반 제작 구매', 'UTP 케이블 구매', '분전반 구매'],
  Frgcpt: ['측정장비 외자구매'],
  Etc: ['기타 매각 공고'],
};
const CORPS = [['㈜가나전력', '2248112345', '김가나'], ['㈜한빛전기', '2248154321', '이한빛'], ['원주전력㈜', '2248199887', '박원주'],
  ['㈜강원정보통신', '2238176543', '최강원'], ['대성전기공사㈜', '2248133221', '정대성'], ['㈜동해전설', '2258122110', '한동해']];

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const kindOf = (op) => (op.match(/(Cnstwk|Servc|Thng|Frgcpt|Etc)/) || [])[1] || 'Cnstwk';
const noOf = (i) => `R26BK0${String(1150000 + i * 37).padStart(7, '0')}`;

function bidItem(kind, i) {
  const now = new Date();
  const ntce = new Date(now.getTime() - (i % 6) * 86400000 - i * 3600000);
  const clse = new Date(ntce.getTime() + (3 + (i % 5)) * 86400000);
  const openg = new Date(clse.getTime() + 2 * 3600000);
  const [org, cd] = ORGS[i % ORGS.length];
  const price = Math.round((20 + rnd() * 900) * 1e6 / 1000) * 1000;
  const no = noOf(i);
  return {
    bidNtceNo: no, bidNtceOrd: '000', reNtceYn: 'N', rgstTyNm: '조달청 또는 나라장터 자체 공고건',
    ntceKindNm: i % 9 === 4 ? '변경공고' : '등록공고', intrbidYn: 'N', bidNtceDt: fmt(ntce), refNo: `제2026-${100 + i}호`,
    bidNtceNm: `2026년 ${TITLES[kind][i % TITLES[kind].length]}`, ntceInsttCd: cd, ntceInsttNm: org, dminsttCd: cd, dminsttNm: org,
    bidMethdNm: '전자입찰', cntrctCnclsMthdNm: i % 3 ? '제한경쟁' : '일반경쟁', ntceInsttOfclNm: '홍길동', ntceInsttOfclTelNo: '033-737-0000',
    bidQlfctRgstDt: fmt(new Date(clse.getTime() - 86400000)), bidBeginDt: fmt(new Date(ntce.getTime() + 86400000)),
    bidClseDt: fmt(clse), opengDt: fmt(openg), presmptPrce: String(price), bdgtAmt: String(Math.round(price * 1.1)),
    VAT: String(Math.round(price * 0.1)), sucsfbidLwltRate: kind === 'Cnstwk' ? '87.745' : '87.995',
    sucsfbidMthdNm: '적격심사', prearngPrceDecsnMthdNm: '복수예가', prearngPrceDcsnMthdNm: '복수예가', totPrdprcNum: '15', drwtPrdprcNum: '4',
    mainCnsttyNm: kind === 'Cnstwk' ? (i % 3 === 2 ? '정보통신공사업' : '전기공사업') : '', cnstrtsiteRgnNm: '강원특별자치도 원주시',
    opengPlce: '국가종합전자조달시스템(나라장터)', ntceSpecFileNm1: '입찰공고문.hwp', ntceSpecDocUrl1: 'https://www.g2b.go.kr',
    ntceSpecFileNm2: '내역서.xlsx', ntceSpecDocUrl2: 'https://www.g2b.go.kr',
    bidNtceDtlUrl: 'https://www.g2b.go.kr', bidNtceUrl: 'https://www.g2b.go.kr', indstrytyLmtYn: 'Y', rgnDutyJntcontrctYn: 'N',
  };
}

function list(gen, q, total = 57) {
  const page = Number(q.pageNo || 1);
  const rows = Number(q.numOfRows || 20);
  const start = (page - 1) * rows;
  const items = [];
  for (let i = start; i < Math.min(start + rows, total); i++) items.push(gen(i));
  let out = items;
  if (q.bidNtceNm) out = out.filter((x) => (x.bidNtceNm || '').includes(q.bidNtceNm));
  if (q.bidNtceNo) out = out.filter((x) => x.bidNtceNo === q.bidNtceNo).concat(out.length ? [] : [gen(0)]).map((x) => ({ ...x, bidNtceNo: q.bidNtceNo }));
  if (q.bizno) out = out.map((x) => ({ ...x, bidwinnrNm: '㈜샘플전력', bidwinnrBizno: q.bizno }));
  return { resultCode: '00', resultMsg: '정상', totalCount: q.bidNtceNm || q.bidNtceNo ? out.length : total, pageNo: page, numOfRows: rows, items: out };
}

export function mockResponse(svc, op, q) {
  seed = 7 + Number(q.pageNo || 1);
  const kind = kindOf(op);
  if (svc === 'usr') {
    const c = CORPS.find((x) => x[1] === q.bizno) || ['샘플정보통신㈜', q.bizno, '홍대표'];
    return { resultCode: '00', resultMsg: '정상', totalCount: 1, pageNo: 1, numOfRows: 5, items: [{
      bizno: c[1], corpNm: c[0], ceoNm: c[2], adrs: '강원특별자치도 원주시 시청로 1', dtlAdrs: '2층', telNo: '033-123-4567', faxNo: '033-123-4568',
      rgnNm: '강원특별자치도', corpBsnsDivNm: '공사', hdoffceDivNm: '본사', opbizDt: '2010-03-02 00:00:00', emplyeNum: '8', hmpgAdrs: '' }] };
  }
  if (svc === 'bid') {
    if (op.endsWith('LicenseLimit')) return list(() => ({ bidNtceNo: q.bidNtceNo, bidNtceOrd: '000', lmtGrpNo: '1', lmtSno: '1', lcnsLmtNm: '전기공사업/0036', permsnIndstrytyList: '' }), q, 1);
    if (op.endsWith('PrtcptPsblRgn')) return list(() => ({ bidNtceNo: q.bidNtceNo, lmtSno: '1', prtcptPsblRgnNm: '강원특별자치도' }), q, 1);
    if (op.endsWith('BsisAmount')) return list(() => ({ bidNtceNo: q.bidNtceNo, bssamt: '254300000', rsrvtnPrceRngBgnRate: '-2', rsrvtnPrceRngEndRate: '+2', bssamtOpenDt: fmt(new Date()) }), q, 1);
    return list((i) => bidItem(kind, i), q);
  }
  if (op.startsWith('getScsbidListSttus')) {
    return list((i) => {
      const b = bidItem(kind, i + 40); const c = CORPS[i % CORPS.length];
      const rate = (87.745 + rnd() * 3).toFixed(3);
      return { bidNtceNo: b.bidNtceNo, bidNtceOrd: '000', bidClsfcNo: '1', rbidNo: '000', bidNtceNm: b.bidNtceNm, prtcptCnum: String(30 + Math.floor(rnd() * 400)),
        bidwinnrNm: c[0], bidwinnrBizno: c[1], bidwinnrCeoNm: c[2], bidwinnrAdrs: '강원특별자치도 원주시', bidwinnrTelNo: '033-000-0000',
        sucsfbidAmt: String(Math.round(Number(b.presmptPrce) * 1.1 * rate / 100)), sucsfbidRate: rate, rlOpengDt: b.opengDt,
        dminsttCd: b.dminsttCd, dminsttNm: b.dminsttNm, fnlSucsfDate: b.opengDt.slice(0, 10) };
    }, q);
  }
  if (op === 'getOpengResultListInfoOpengCompt') {
    return list((i) => {
      const c = CORPS[i % CORPS.length]; const rt = (89.9 - i * 0.137).toFixed(3);
      return { opengRsltDivNm: '개찰완료', bidNtceNo: q.bidNtceNo, opengRank: String(i + 1), prcbdrBizno: c[1], prcbdrNm: i < CORPS.length ? c[0] : `${c[0]} ${i}`,
        prcbdrCeoNm: c[2], bidprcAmt: String(Math.round(254300000 * rt / 100)), bidprcrt: rt, rmrk: i === 0 ? '낙찰예정' : '', bidprcDt: fmt(new Date()) };
    }, q, 24);
  }
  if (op.endsWith('PreparPcDetail')) {
    return list((i) => ({ bidNtceNo: q.bidNtceNo, bidNtceOrd: '000', bssamt: '254300000', plnprc: '253871200', totRsrvtnPrceNum: '15',
      compnoRsrvtnPrceSno: String(i + 1), bsisPlnprc: String(Math.round(254300000 * (0.98 + rnd() * 0.04))), drwtYn: [2, 5, 9, 13].includes(i) ? 'Y' : 'N',
      drwtNum: String(Math.floor(rnd() * 40)) }), q, 15);
  }
  // 개찰결과 목록
  return list((i) => {
    const b = bidItem(kind, i + 20); const c = CORPS[i % CORPS.length];
    const done = i % 7 !== 3;
    return { bidNtceNo: b.bidNtceNo, bidNtceOrd: '000', bidClsfcNo: '1', rbidNo: '000', bidNtceNm: b.bidNtceNm, opengDt: b.opengDt,
      prtcptCnum: String(30 + Math.floor(rnd() * 400)), opengCorpInfo: done ? `${c[0]}^${c[1]}^${c[2]}^${Math.round(Number(b.presmptPrce) * 1.1 * 0.8885)}^88.857` : '',
      progrsDivCdNm: done ? '개찰완료' : '유찰', ntceInsttNm: b.ntceInsttNm, dminsttNm: b.dminsttNm, rsrvtnPrceFileExistnceYn: 'Y' };
  }, q);
}
