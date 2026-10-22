import { wonShort, won, shortDt, dday, parseCorpInfo } from './lib.js';

const num = (v) => Number(v) || 0;

const Dday = ({ s }) => {
  const d = dday(s);
  return d ? <span className={`dday ${d.cls}`}>{d.text}</span> : null;
};

const titleCell = (r, sub) => (
  <div className="title-cell">
    <div className="t">{r.bidNtceNm}</div>
    <div className="s">{r.bidNtceNo}-{r.bidNtceOrd}{sub ? ` · ${sub}` : ''}</div>
  </div>
);

export const PAGES = [
  {
    id: 'bid', title: '입찰공고', svc: 'bid', op: (k) => `getBidPblancListInfo${k}PPSSrch`,
    dateDivs: [['1', '공고게시일'], ['2', '개찰일']],
    columns: [
      { key: 'bidNtceNm', label: '공고명', render: (r) => titleCell(r, [r.ntceKindNm !== '등록공고' && r.ntceKindNm, r.cntrctCnclsMthdNm].filter(Boolean).join(' · ')),
        excel: (r) => r.bidNtceNm, wch: 50 },
      { key: 'bidNtceNo', label: '공고번호', cls: 'hide', excel: (r) => `${r.bidNtceNo}-${r.bidNtceOrd}`, wch: 18 },
      { key: 'dminsttNm', label: '수요기관', cls: 'org', wch: 24 },
      { key: 'presmptPrce', label: '추정가격', cls: 'num', render: (r) => wonShort(r.presmptPrce), sortVal: (r) => num(r.presmptPrce),
        excel: (r) => num(r.presmptPrce) },
      { key: 'mainCnsttyNm', label: '업종', cls: 'mid', render: (r) => r.mainCnsttyNm || '-' },
      { key: 'bidNtceDt', label: '공고일', cls: 'date', render: (r) => shortDt(r.bidNtceDt) },
      { key: 'bidClseDt', label: '입찰마감', cls: 'date', render: (r) => <>{shortDt(r.bidClseDt)} <Dday s={r.bidClseDt} /></> },
      { key: 'opengDt', label: '개찰', cls: 'date', render: (r) => shortDt(r.opengDt) },
    ],
  },
  {
    id: 'openg', title: '개찰결과', svc: 'scs', op: (k) => `getOpengResultListInfo${k}PPSSrch`,
    dateDivs: [['2', '개찰일'], ['1', '공고일']],
    columns: [
      { key: 'bidNtceNm', label: '공고명', render: (r) => titleCell(r), excel: (r) => r.bidNtceNm, wch: 50 },
      { key: 'bidNtceNo', label: '공고번호', cls: 'hide', excel: (r) => `${r.bidNtceNo}-${r.bidNtceOrd}`, wch: 18 },
      { key: 'dminsttNm', label: '수요기관', cls: 'org', wch: 24 },
      { key: 'progrsDivCdNm', label: '진행', cls: 'mid', render: (r) => <span className={`pill ${r.progrsDivCdNm === '개찰완료' ? 'ok' : 'warn'}`}>{r.progrsDivCdNm || '-'}</span> },
      { key: 'prtcptCnum', label: '참가', cls: 'num', render: (r) => (r.prtcptCnum ? `${num(r.prtcptCnum).toLocaleString()}개사` : '-'), sortVal: (r) => num(r.prtcptCnum) },
      { key: 'opengCorpInfo', label: '1순위 업체', cls: 'org', render: (r) => parseCorpInfo(r.opengCorpInfo)?.name || '-',
        excel: (r) => parseCorpInfo(r.opengCorpInfo)?.name || '' },
      { key: 'bidAmt', label: '투찰금액', cls: 'num', render: (r) => wonShort(parseCorpInfo(r.opengCorpInfo)?.amt),
        sortVal: (r) => num(parseCorpInfo(r.opengCorpInfo)?.amt), excel: (r) => num(parseCorpInfo(r.opengCorpInfo)?.amt) },
      { key: 'bidRate', label: '투찰률', cls: 'num', render: (r) => { const c = parseCorpInfo(r.opengCorpInfo); return c && num(c.rate) ? `${c.rate}%` : '-'; },
        sortVal: (r) => num(parseCorpInfo(r.opengCorpInfo)?.rate), excel: (r) => parseCorpInfo(r.opengCorpInfo)?.rate || '' },
      { key: 'opengDt', label: '개찰일시', cls: 'date', render: (r) => shortDt(r.opengDt) },
    ],
  },
  {
    id: 'scs', title: '낙찰정보', svc: 'scs', op: (k) => `getScsbidListSttus${k}PPSSrch`,
    dateDivs: [['2', '개찰일'], ['1', '공고게시일']],
    columns: [
      { key: 'bidNtceNm', label: '공고명', render: (r) => titleCell(r), excel: (r) => r.bidNtceNm, wch: 50 },
      { key: 'bidNtceNo', label: '공고번호', cls: 'hide', excel: (r) => `${r.bidNtceNo}-${r.bidNtceOrd}`, wch: 18 },
      { key: 'dminsttNm', label: '수요기관', cls: 'org', wch: 24 },
      { key: 'bidwinnrNm', label: '낙찰업체', cls: 'org strong', wch: 22 },
      { key: 'bidwinnrCeoNm', label: '대표', cls: 'mid hide-sm' },
      { key: 'sucsfbidAmt', label: '낙찰금액', cls: 'num', render: (r) => wonShort(r.sucsfbidAmt), sortVal: (r) => num(r.sucsfbidAmt),
        excel: (r) => num(r.sucsfbidAmt) },
      { key: 'sucsfbidRate', label: '낙찰률', cls: 'num', render: (r) => (num(r.sucsfbidRate) ? `${r.sucsfbidRate}%` : '-'), sortVal: (r) => num(r.sucsfbidRate) },
      { key: 'prtcptCnum', label: '참가', cls: 'num', render: (r) => (r.prtcptCnum ? `${num(r.prtcptCnum).toLocaleString()}개사` : '-'), sortVal: (r) => num(r.prtcptCnum) },
      { key: 'rlOpengDt', label: '개찰일시', cls: 'date', render: (r) => shortDt(r.rlOpengDt) },
    ],
  },
];

export const fullWon = won;
