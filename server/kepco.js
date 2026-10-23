// 한국전력 전력데이터 개방포털 — 전자입찰 계약정보 (bigdata.kepco.co.kr/openapi/v1/electContract.do)
// 한전 + 발전 자회사 입찰공고. data.go.kr 와 별개 키(apiKey, 40자리). 최대 90일, 페이지 없음, {"data":[...]} 응답.
const URL_ = 'https://bigdata.kepco.co.kr/openapi/v1/electContract.do';
export const KEPCO_CO = {
  COM01: '한국전력공사', COM02: '한국서부발전', COM03: '한국전력국제원자력대학원대학교', COM04: '한국남부발전', COM05: '한국중부발전',
  COM06: '한국남동발전', COM08: '한국동서발전', COM09: '한국전력기술', COM10: '한전KPS', COM11: '한국전력거래소',
  COM12: '한국원자력연료', COM14: '한국발전교육원', COM16: '한국해상풍력', COM19: 'KAPES',
};
const COMP = { Open: '일반경쟁', Destination: '지명경쟁', Limited: '제한경쟁', Private: '수의계약' };
const STATE = { PreAttendProgress: '공고진행', AttendProgress: '입찰진행', Close: '마감', Fail: '유찰', OpenTimed: '개찰', Final: '공고종료' };
const BIDTYPE = { LimitedLowestPrice: '제한적최저가', LowestPrice: '최저가', QualifiedEval: '적격심사', CollectivelyBid: '일괄입찰', Nego: '협상', TotalEvalSuccess: '종합심사낙찰제' };
const KIND = { Construction: 'Cnstwk', Service: 'Servc', Product: 'Thng' };

const cache = new Map();
const dt = (s) => {
  const m = String(s || '').match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:[ T]?(\d{2}):?(\d{2}))?/);
  return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : '';
};
const ymd = (iso) => iso.replaceAll('-', '');

export async function kepcoNotices(from, to, apiKey) {
  // 90일씩 나눠 조회
  const out = [];
  let start = new Date(from);
  const end = new Date(to);
  while (start <= end) {
    const chunkEnd = new Date(Math.min(end.getTime(), start.getTime() + 89 * 86400000));
    const f = start.toISOString().slice(0, 10); const t = chunkEnd.toISOString().slice(0, 10);
    const ck = `${f}|${t}`;
    let rows = cache.get(ck);
    if (!rows || Date.now() - rows.t > 30 * 60 * 1000) {
      const qs = new URLSearchParams({ apiKey, noticeBeginDate: ymd(f), noticeEndDate: ymd(t), returnType: 'json' });
      const r = await fetch(`${URL_}?${qs}`, { signal: AbortSignal.timeout(60000) });
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { throw new Error(`한전 API 응답 오류: ${text.slice(0, 150)}`); }
      if (!Array.isArray(j.data)) throw new Error(`한전 API 오류: ${JSON.stringify(j).slice(0, 150)}`);
      rows = { t: Date.now(), data: j.data };
      cache.set(ck, rows);
      if (cache.size > 40) cache.delete(cache.keys().next().value);
    }
    out.push(...rows.data);
    start = new Date(chunkEnd.getTime() + 86400000);
  }
  return out.map((x) => {
    const co = KEPCO_CO[x.companyId] || x.placeName || '한전';
    return {
      _org: 'kepco', _orgNm: co.replace(/^한국/, '').replace('전력공사', '한전'), _kind: KIND[x.itemType] || (x.purchaseType === 'Product' ? 'Thng' : 'Cnstwk'),
      bidNtceNo: String(x.no || ''), bidNtceOrd: '000', bidNtceNm: x.name || '',
      ntceInsttNm: co, dminsttNm: [co, x.placeName, x.contractReqDepartmentName].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' '),
      presmptPrce: String(x.presumedPrice || x.presumedAmount || '').replace(/[^0-9]/g, ''),
      cntrctCnclsMthdNm: COMP[x.competitionType] || x.competitionType || '', sucsfbidMthdNm: BIDTYPE[x.bidType] || x.bidType || '',
      ntceKindNm: x.emergencyNoticeYn === '1' ? '긴급공고' : '등록공고',
      bidNtceDt: dt(x.noticeDate), bidClseDt: dt(x.endDatetime), opengDt: '',
      _status: STATE[x.progressState] || x.progressState || '', _officer: x.creatorName || '',
      _restrict: x.bidAttendRestrict || x.etc || '', _basic: String(x.estimatedPriceBasicAmount || '').replace(/[^0-9]/g, ''),
      _files: [1, 2, 3, 4, 5].map((i) => x[`filenlink${i}`] && { url: x[`filenlink${i}`], name: x[`filename${i}`] || `첨부${i}` }).filter(Boolean),
      bidNtceDtlUrl: 'https://srm.kepco.net/',
    };
  });
}
