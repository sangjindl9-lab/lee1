import { wonShort, won, shortDt, dday, parseCorpInfo } from './lib.js';
import { CompanyName } from './Company.jsx';

const num = (v) => Number(v) || 0;
const KIND_LABEL = { Cnstwk: '공사', Servc: '용역', Thng: '물품', Frgcpt: '외자', Etc: '기타' };

const Dday = ({ s }) => {
  const d = dday(s);
  return d ? <span className={`dday ${d.cls}`}>{d.text}</span> : null;
};

const titleCell = (r, sub) => (
  <div className="title-cell">
    <div className="t">{r._org && r._org !== 'g2b' && <span className={`org-pill ${r._org}`}>{r._orgNm}</span>}{r.bidNtceNm}</div>
    <div className="s">{r.bidNtceNo}-{r.bidNtceOrd}{sub ? ` · ${sub}` : ''}</div>
  </div>
);

export const PAGES = [
  {
    id: 'bid', title: '입찰공고', svc: 'bids', op: (k) => k,
    dateDivs: [['1', '공고게시일'], ['2', '개찰일']],
    columns: [
      { key: 'bidNtceNm', label: '공고명', render: (r) => titleCell(r, [r.ntceKindNm !== '등록공고' && r.ntceKindNm, r.cntrctCnclsMthdNm].filter(Boolean).join(' · ')),
        excel: (r) => r.bidNtceNm, wch: 50 },
      { key: 'bidNtceNo', label: '공고번호', cls: 'hide', excel: (r) => `${r.bidNtceNo}-${r.bidNtceOrd}`, wch: 18 },
      { key: '_orgNm', label: '발주처', cls: 'hide', excel: (r) => r._orgNm || '나라장터', wch: 10 },
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
      { key: 'opengCorpInfo', label: '1순위 업체', cls: 'corp', render: (r) => { const c = parseCorpInfo(r.opengCorpInfo); return c ? <CompanyName name={c.name} bizno={c.bizno} ceo={c.ceo} /> : '-'; },
        excel: (r) => parseCorpInfo(r.opengCorpInfo)?.name || '' },
      { key: 'bidAmt', label: '투찰금액', cls: 'num', render: (r) => wonShort(parseCorpInfo(r.opengCorpInfo)?.amt),
        sortVal: (r) => num(parseCorpInfo(r.opengCorpInfo)?.amt), excel: (r) => num(parseCorpInfo(r.opengCorpInfo)?.amt) },
      { key: 'bidRate', label: '투찰률', cls: 'num', render: (r) => { const c = parseCorpInfo(r.opengCorpInfo); return c && num(c.rate) ? `${c.rate}%` : '-'; },
        sortVal: (r) => num(parseCorpInfo(r.opengCorpInfo)?.rate), excel: (r) => parseCorpInfo(r.opengCorpInfo)?.rate || '' },
      { key: 'opengDt', label: '개찰일시', cls: 'date', render: (r) => shortDt(r.opengDt) },
    ],
  },
  {
    id: 'scs', title: '낙찰정보', svc: 'award', op: (k) => k,
    dateDivs: [['2', '개찰일'], ['1', '공고게시일']],
    columns: [
      { key: '_kind', label: '구분', cls: 'mid', render: (r) => KIND_LABEL[r._kind] || '-', excel: (r) => KIND_LABEL[r._kind] || '' },
      { key: 'bidNtceNm', label: '공고명', render: (r) => titleCell(r, r.cntrctCnclsMthdNm), excel: (r) => r.bidNtceNm, wch: 50 },
      { key: 'bidNtceNo', label: '공고번호', cls: 'hide', excel: (r) => `${r.bidNtceNo}-${r.bidNtceOrd}`, wch: 18 },
      { key: 'dminsttNm', label: '수요기관', cls: 'org', wch: 24 },
      { key: 'presmptPrce', label: '추정가격', cls: 'num', render: (r) => wonShort(r.presmptPrce), sortVal: (r) => num(r.presmptPrce),
        excel: (r) => num(r.presmptPrce) },
      { key: 'awardStatus', label: '상태', cls: 'mid', render: (r) => <span className={`pill ${r.awardStatus === '낙찰확정' ? 'ok' : ''}`}>{r.awardStatus}</span> },
      { key: '_orgNm', label: '발주처', cls: 'hide', excel: (r) => r._orgNm || '나라장터', wch: 10 },
      { key: 'bidwinnrNm', label: '낙찰(1순위)업체', cls: 'corp strong', wch: 24,
        render: (r) => <><CompanyName name={r.bidwinnrNm} bizno={r.bidwinnrBizno} ceo={r.bidwinnrCeoNm} tel={r.bidwinnrTelNo} adrs={r.bidwinnrAdrs} />{r.bidwinnrTelNo && <div className="s">{r.bidwinnrTelNo}</div>}</> },
      { key: 'sucsfbidAmt', label: '금액', cls: 'num', render: (r) => <>{won(r.sucsfbidAmt)}<div className="s">{num(r.sucsfbidRate) ? `${r.sucsfbidRate}%` : ''}</div></>,
        sortVal: (r) => num(r.sucsfbidAmt), excel: (r) => num(r.sucsfbidAmt) },
      { key: 'sucsfbidRate', label: '투찰률', cls: 'hide', excel: (r) => r.sucsfbidRate || '' },
      { key: 'prtcptCnum', label: '참가', cls: 'num', render: (r) => (r.prtcptCnum ? `${num(r.prtcptCnum).toLocaleString()}` : '-'), sortVal: (r) => num(r.prtcptCnum) },
      { key: 'rlOpengDt', label: '개찰일시', cls: 'date', render: (r) => shortDt(r.rlOpengDt) },
    ],
  },
];

export const fullWon = won;
