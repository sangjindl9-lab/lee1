import { useEffect, useState } from 'react';
import { CompanyName } from './Company.jsx';
import { api, won, wonShort, dt, dday, bizno, parseCorpInfo, g2bLink, exportExcel } from './lib.js';

function useApi(svc, op, params, enabled = true) {
  const [s, setS] = useState({ loading: enabled, data: null, error: '' });
  const key = JSON.stringify([svc, op, params, enabled]);
  useEffect(() => {
    if (!enabled || !op) { setS({ loading: false, data: null, error: '' }); return; }
    let alive = true;
    setS({ loading: true, data: null, error: '' });
    api(svc, op, params)
      .then((d) => alive && setS({ loading: false, data: d, error: '' }))
      .catch((e) => alive && setS({ loading: false, data: null, error: e.message }));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

const Field = ({ label, children, wide }) => (
  <div className={wide ? 'kv wide' : 'kv'}><dt>{label}</dt><dd>{children || '-'}</dd></div>
);

const Status = ({ s, empty = '자료 없음' }) => {
  if (s.loading) return <p className="muted">불러오는 중…</p>;
  if (s.error) return <p className="error small">⚠ {s.error}</p>;
  if (!s.data?.items?.length) return <p className="muted">{empty}</p>;
  return null;
};

function BidInfo({ b }) {
  const d = dday(b.bidClseDt);
  const files = [];
  for (let i = 1; i <= 10; i++) if (b[`ntceSpecDocUrl${i}`]) files.push({ url: b[`ntceSpecDocUrl${i}`], name: b[`ntceSpecFileNm${i}`] || `규격서 ${i}` });
  if (b.stdNtceDocUrl) files.push({ url: b.stdNtceDocUrl, name: '표준공고서' });
  for (let i = 1; i <= 5; i++) if (b[`sptDscrptDocUrl${i}`]) files.push({ url: b[`sptDscrptDocUrl${i}`], name: `현장설명서 ${i}` });
  return (
    <>
      <h3>일정</h3>
      <dl className="grid">
        <Field label="공고일시">{dt(b.bidNtceDt)}</Field>
        <Field label="참가자격 등록마감">{dt(b.bidQlfctRgstDt)}</Field>
        <Field label="입찰개시">{dt(b.bidBeginDt)}</Field>
        <Field label="입찰마감">{dt(b.bidClseDt)} {d && <span className={`dday ${d.cls}`}>{d.text}</span>}</Field>
        <Field label="개찰일시">{dt(b.opengDt)}</Field>
        <Field label="공동수급 협정마감">{dt(b.cmmnSpldmdAgrmntClseDt)}</Field>
        {b.dcmtgOprtnDt && <Field label="설명회">{dt(b.dcmtgOprtnDt)} {b.dcmtgOprtnPlce}</Field>}
      </dl>
      <h3>금액·방식</h3>
      <dl className="grid">
        <Field label="추정가격">{won(b.presmptPrce)}{b.presmptPrce ? '원' : ''}</Field>
        <Field label="배정예산">{won(b.bdgtAmt)}{Number(b.bdgtAmt) ? '원' : ''}</Field>
        <Field label="부가세">{won(b.VAT)}</Field>
        <Field label="관급금액">{won(b.govsplyAmt)}</Field>
        <Field label="계약방법">{b.cntrctCnclsMthdNm}</Field>
        <Field label="낙찰방법">{b.sucsfbidMthdNm}</Field>
        <Field label="낙찰하한율">{b.sucsfbidLwltRate ? `${b.sucsfbidLwltRate}%` : ''}</Field>
        <Field label="예정가격 결정">{b.prearngPrceDcsnMthdNm}{b.totPrdprcNum ? ` (${b.totPrdprcNum}개 중 ${b.drwtPrdprcNum || '?'}개 추첨)` : ''}</Field>
        <Field label="주공종">{b.mainCnsttyNm}</Field>
        <Field label="공사현장">{b.cnstrtsiteRgnNm}</Field>
        <Field label="지역의무공동도급">{b.rgnDutyJntcontrctYn === 'Y' ? `있음 ${b.rgnDutyJntcontrctRt ? `(${b.rgnDutyJntcontrctRt}%)` : ''}` : '없음'}</Field>
        <Field label="공동수급">{b.cmmnSpldmdMethdNm}</Field>
      </dl>
      <h3>담당</h3>
      <dl className="grid">
        <Field label="공고기관">{b.ntceInsttNm}</Field>
        <Field label="수요기관">{b.dminsttNm}</Field>
        <Field label="담당자">{b.ntceInsttOfclNm}{b.ntceInsttOfclTelNo ? ` · ${b.ntceInsttOfclTelNo}` : ''}</Field>
        <Field label="참조번호">{b.refNo}</Field>
      </dl>
      {b.chgNtceRsn && <><h3>변경사유</h3><p className="note">{b.chgNtceRsn}</p></>}
      {files.length > 0 && (
        <>
          <h3>첨부파일</h3>
          <ul className="files">{files.map((x, i) => <li key={i}><a href={x.url} target="_blank" rel="noreferrer">{x.name}</a></li>)}</ul>
        </>
      )}
    </>
  );
}

function BidExtras({ b, kind }) {
  const p = { inqryDiv: '2', bidNtceNo: b.bidNtceNo, bidNtceOrd: b.bidNtceOrd, numOfRows: 50 };
  const lic = useApi('bid', 'getBidPblancListInfoLicenseLimit', p);
  const rgn = useApi('bid', 'getBidPblancListInfoPrtcptPsblRgn', p);
  const bsisOp = ['Cnstwk', 'Servc', 'Thng'].includes(kind) ? `getBidPblancListInfo${kind}BsisAmount` : null;
  const bsis = useApi('bid', bsisOp, { inqryDiv: '2', bidNtceNo: b.bidNtceNo, numOfRows: 10 }, !!bsisOp);
  const bs = bsis.data?.items?.find((x) => x.bidNtceOrd === b.bidNtceOrd) || bsis.data?.items?.[0];
  return (
    <>
      <h3>참가자격</h3>
      <dl className="grid">
        <Field label="면허제한" wide>
          {lic.loading ? '…' : lic.data?.items?.length
            ? lic.data.items.map((x, i) => <div key={i}>{x.lcnsLmtNm}{x.permsnIndstrytyList ? ` (허용: ${x.permsnIndstrytyList})` : ''}</div>)
            : '제한 없음 / 자료 없음'}
        </Field>
        <Field label="참가가능지역" wide>
          {rgn.loading ? '…' : rgn.data?.items?.length ? rgn.data.items.map((x) => x.prtcptPsblRgnNm).join(', ') : '제한 없음 / 자료 없음'}
        </Field>
      </dl>
      {bsisOp && (
        <>
          <h3>기초금액</h3>
          {bsis.loading ? <p className="muted">불러오는 중…</p> : bs ? (
            <dl className="grid">
              <Field label="기초금액"><strong>{won(bs.bssamt)}원</strong></Field>
              <Field label="예가범위">{bs.rsrvtnPrceRngBgnRate || '?'}% ~ {bs.rsrvtnPrceRngEndRate || '?'}%</Field>
              <Field label="공개일시">{dt(bs.bssamtOpenDt)}</Field>
              {bs.evlBssAmt && <Field label="평가기준금액">{won(bs.evlBssAmt)}</Field>}
            </dl>
          ) : <p className="muted">아직 공개되지 않았습니다.</p>}
        </>
      )}
    </>
  );
}

function Ranking({ r, myBizno }) {
  const s = useApi('scs', 'getOpengResultListInfoOpengCompt', {
    bidNtceNo: r.bidNtceNo, bidNtceOrd: r.bidNtceOrd, bidClsfcNo: r.bidClsfcNo || '1', rbidNo: r.rbidNo || '000', numOfRows: 999,
  });
  const items = s.data?.items || [];
  const mine = (myBizno || '').replaceAll('-', '');
  const me = mine && items.find((x) => x.prcbdrBizno === mine);
  return (
    <>
      <h3>개찰순위 {items.length > 0 && <small>({items.length}개사)</small>}
        {items.length > 0 && (
          <button className="ghost xs" onClick={() => exportExcel(items, [
            { key: 'opengRank', label: '순위', wch: 6 }, { key: 'prcbdrNm', label: '업체명', wch: 26 }, { key: 'prcbdrBizno', label: '사업자번호' },
            { key: 'prcbdrCeoNm', label: '대표' }, { key: 'bidprcAmt', label: '투찰금액', excel: (x) => Number(x.bidprcAmt) || '' },
            { key: 'bidprcrt', label: '투찰률' }, { key: 'rmrk', label: '비고', wch: 20 }, { key: 'bidprcDt', label: '투찰일시', wch: 20 },
          ], `개찰순위_${r.bidNtceNo}.xlsx`)}>엑셀</button>
        )}
      </h3>
      {me && <p className="mine-note">우리 회사 순위: <strong>{me.opengRank}위</strong> · 투찰률 {me.bidprcrt}% · {won(me.bidprcAmt)}원</p>}
      <Status s={s} empty="개찰순위 자료가 없습니다." />
      {items.length > 0 && (
        <div className="table-wrap tight">
          <table className="sub">
            <thead><tr><th>순위</th><th>업체명</th><th className="hide-sm">사업자번호</th><th className="num">투찰금액</th><th className="num">투찰률</th><th>비고</th></tr></thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i} className={x.prcbdrBizno === mine ? 'mine' : ''}>
                  <td className="num">{x.opengRank}</td>
                  <td><CompanyName name={x.prcbdrNm} bizno={x.prcbdrBizno} ceo={x.prcbdrCeoNm} /><div className="s show-sm">{x.prcbdrCeoNm}</div></td>
                  <td className="hide-sm">{bizno(x.prcbdrBizno)}</td>
                  <td className="num">{won(x.bidprcAmt)}</td>
                  <td className="num">{x.bidprcrt}%</td>
                  <td className="rmrk">{x.rmrk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Reserve({ r, kind }) {
  const s = useApi('scs', `getOpengResultListInfo${kind}PreparPcDetail`, { inqryDiv: '2', bidNtceNo: r.bidNtceNo, numOfRows: 100 });
  const all = s.data?.items || [];
  const items = all.filter((x) => !x.bidNtceOrd || x.bidNtceOrd === r.bidNtceOrd).sort((a, b) => Number(a.compnoRsrvtnPrceSno) - Number(b.compnoRsrvtnPrceSno));
  const first = items[0];
  const bss = Number(first?.bssamt); const pln = Number(first?.plnprc);
  const sajung = bss && pln ? (pln / bss) * 100 : null;
  return (
    <>
      <h3>복수예가 · 사정율</h3>
      <Status s={s} empty="복수예가 자료가 없습니다 (비공개이거나 미개찰)." />
      {first && (
        <>
          <dl className="grid">
            <Field label="기초금액">{won(first.bssamt)}원</Field>
            <Field label="예정가격"><strong>{won(first.plnprc)}원</strong></Field>
            <Field label="사정율"><strong className="accent">{sajung ? `${sajung.toFixed(4)}%` : '-'}</strong>
              {sajung ? <span className="muted"> ({sajung >= 100 ? '+' : ''}{(sajung - 100).toFixed(4)}%)</span> : null}</Field>
            <Field label="낙찰자 선정기준" wide>{first.bidwinrSlctnAplBssCntnts}</Field>
          </dl>
          <div className="yega">
            {items.map((x, i) => {
              const v = Number(x.bsisPlnprc); const pct = bss ? (v / bss) * 100 - 100 : 0;
              return (
                <div key={i} className={x.drwtYn === 'Y' ? 'y on' : 'y'} title={x.drwtYn === 'Y' ? '추첨된 예가' : ''}>
                  <span className="n">{x.compnoRsrvtnPrceSno}</span>
                  <span className="v">{won(v)}</span>
                  <span className="p">{pct >= 0 ? '+' : ''}{pct.toFixed(3)}%</span>
                  {x.drwtNum && <span className="c">{x.drwtNum}회</span>}
                </div>
              );
            })}
          </div>
          <p className="muted small">진하게 표시된 칸이 추첨된 예가입니다. 사정율 = 예정가격 ÷ 기초금액 × 100</p>
        </>
      )}
    </>
  );
}

function NoticeLookup({ r, kind }) {
  // 개찰/낙찰 화면에서 원래 공고 정보 조회 (inqryDiv=2: 입찰공고번호)
  const op = kind !== 'Etc' ? `getBidPblancListInfo${kind}` : null;
  const s = useApi('bid', op, { inqryDiv: '2', bidNtceNo: r.bidNtceNo, numOfRows: 10 }, !!op);
  const b = s.data?.items?.find((x) => x.bidNtceOrd === r.bidNtceOrd) || s.data?.items?.[0];
  if (s.loading) return <p className="muted">공고 정보 불러오는 중…</p>;
  if (!b) return null;
  return (
    <>
      <h3>공고 요약</h3>
      <dl className="grid">
        <Field label="추정가격">{won(b.presmptPrce)}원</Field>
        <Field label="낙찰하한율">{b.sucsfbidLwltRate ? `${b.sucsfbidLwltRate}%` : ''}</Field>
        <Field label="계약방법">{b.cntrctCnclsMthdNm}</Field>
        <Field label="낙찰방법">{b.sucsfbidMthdNm}</Field>
      </dl>
    </>
  );
}

function OpengInfo({ item: r, kind, type }) {
  const top = parseCorpInfo(r.opengCorpInfo);
  return (
    <>
      <h3>{type === 'scs' ? '낙찰 결과' : '개찰 결과'}</h3>
      <dl className="grid">
        {type === 'scs' ? (
          <>
            <Field label="상태">{r.awardStatus || '낙찰확정'}{r.awardStatus === '1순위' ? ' (낙찰자 심사 중)' : ''}</Field>
            <Field label="낙찰(1순위)업체"><strong><CompanyName name={r.bidwinnrNm} bizno={r.bidwinnrBizno} ceo={r.bidwinnrCeoNm} tel={r.bidwinnrTelNo} adrs={r.bidwinnrAdrs} /></strong></Field>
            <Field label="대표자">{r.bidwinnrCeoNm}</Field>
            <Field label="사업자번호">{bizno(r.bidwinnrBizno)}</Field>
            <Field label="연락처">{r.bidwinnrTelNo}</Field>
            <Field label="추정가격">{won(r.presmptPrce)}{Number(r.presmptPrce) ? '원' : ''}</Field>
            <Field label="낙찰하한율">{r.sucsfbidLwltRate ? `${r.sucsfbidLwltRate}%` : ''}</Field>
            <Field label="낙찰(투찰)금액"><strong>{won(r.sucsfbidAmt)}원</strong></Field>
            <Field label="투찰률">{r.sucsfbidRate ? `${r.sucsfbidRate}%` : ''}</Field>
            <Field label="주소" wide>{r.bidwinnrAdrs}</Field>
            <Field label="참가업체">{r.prtcptCnum ? `${Number(r.prtcptCnum).toLocaleString()}개사` : ''}</Field>
            <Field label="최종낙찰일">{r.fnlSucsfDate}</Field>
          </>
        ) : (
          <>
            <Field label="진행">{r.progrsDivCdNm}</Field>
            <Field label="참가업체">{r.prtcptCnum ? `${Number(r.prtcptCnum).toLocaleString()}개사` : ''}</Field>
            <Field label="1순위">{top ? <CompanyName name={top.name} bizno={top.bizno} ceo={top.ceo} /> : ''}</Field>
            <Field label="1순위 투찰">{top ? `${won(top.amt)}원 (${top.rate}%)` : ''}</Field>
            <Field label="개찰일시">{dt(r.opengDt)}</Field>
            <Field label="수요기관">{r.dminsttNm}</Field>
          </>
        )}
      </dl>
      {r.opengRsltNtcCntnts && <p className="note">{r.opengRsltNtcCntnts}</p>}
      <NoticeLookup r={r} kind={kind} />
    </>
  );
}

const ORG_SITE = { kepco: ['한전 전자조달(SRM)', 'https://srm.kepco.net/'], kwater: ['한국수자원공사 전자조달', 'https://ebid.kwater.or.kr/'], kr: ['국가철도공단 전자조달', 'https://ebid.kr.or.kr/'], korail: ['한국철도공사 전자조달', 'https://ebid.korail.com/'] };
function ExtInfo({ r, type }) {
  const [site, url] = ORG_SITE[r._org] || ['원문', '#'];
  return (
    <>
      <p className="note">이 공고는 나라장터가 아닌 <b>{site}</b> 자료입니다. 상세 조건과 첨부파일은 기관 사이트에서 확인하세요.</p>
      <h3>{type === 'bid' ? '공고 정보' : '결과'}</h3>
      <dl className="grid">
        <Field label="발주처">{r.ntceInsttNm}</Field>
        <Field label="부서">{r.dminsttNm}</Field>
        <Field label="공고번호">{r.bidNtceNo}</Field>
        <Field label="계약방법">{r.cntrctCnclsMthdNm}</Field>
        {type === 'bid' ? <>
          <Field label="금액">{Number(r.presmptPrce) ? `${won(r.presmptPrce)}원` : '미공개'}</Field>
          <Field label="낙찰하한율">{r.sucsfbidLwltRate ? `${r.sucsfbidLwltRate}%` : ''}</Field>
          <Field label="공고일">{dt(r.bidNtceDt)}</Field>
          <Field label="마감">{dt(r.bidClseDt)}</Field>
          <Field label="개찰">{dt(r.opengDt)}</Field>
          <Field label="상태">{r._status}</Field>
          <Field label="담당자">{r._officer}</Field>
          {r._basic && <Field label="예비가격기초금액">{won(r._basic)}원</Field>}
          {r.sucsfbidMthdNm && <Field label="낙찰방법">{r.sucsfbidMthdNm}</Field>}
          {r._restrict && <Field label="참가자격" wide>{r._restrict}</Field>}
        </> : <>
          <Field label="상태">{r.awardStatus}</Field>
          <Field label="낙찰(1순위)업체"><strong><CompanyName name={r.bidwinnrNm} bizno={r.bidwinnrBizno} ceo={r.bidwinnrCeoNm} /></strong></Field>
          <Field label="금액">{Number(r.sucsfbidAmt) ? `${won(r.sucsfbidAmt)}원` : ''}</Field>
          <Field label="투찰률">{r.sucsfbidRate ? `${r.sucsfbidRate}%` : ''}</Field>
          {r._plnprc && <Field label="예정가격">{won(r._plnprc)}원</Field>}
          {r.sucsfbidLwltRate && <Field label="낙찰하한율">{r.sucsfbidLwltRate}%</Field>}
          <Field label="개찰(처리)일">{dt(r.opengDt)}</Field>
          {r._selection && <Field label="낙찰자결정">{r._selection}</Field>}
        </>}
      </dl>
      {r._files?.length > 0 && <><h3>첨부파일</h3><ul className="files">{r._files.map((f, i) => <li key={i}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a></li>)}</ul></>}
      {r._org === 'kwater' && type !== 'bid' && <p className="muted small">수자원공사 결과에는 사업자번호가 없어 업체 연락처는 연결되지 않습니다.</p>}
      {r._org === 'kr' && type !== 'bid' && <p className="muted small">국가철도공단은 개찰결과를 1순위 업체만 공개합니다.</p>}
      <p className="links"><a href={url} target="_blank" rel="noreferrer">{site} 바로가기 ↗</a></p>
    </>
  );
}

function OpengFromBid({ b, kind, onOpen }) {
  // 입찰공고 상세에서 개찰결과가 나왔는지 확인 (조회구분 3: 입찰공고번호)
  const enabled = kind !== 'Etc' && b.opengDt && new Date(b.opengDt.replace(' ', 'T')) < new Date();
  const s = useApi('scs', `getOpengResultListInfo${kind}PPSSrch`, { inqryDiv: '3', bidNtceNo: b.bidNtceNo, numOfRows: 10 }, !!enabled);
  if (!enabled) return null;
  const o = s.data?.items?.find((x) => x.bidNtceOrd === b.bidNtceOrd) || s.data?.items?.[0];
  return (
    <>
      <h3>개찰결과</h3>
      {s.loading ? <p className="muted">확인 중…</p> : o ? (
        <button className="primary" onClick={() => onOpen({ type: 'openg', kind, item: o })}>개찰순위·사정율 보기 ({o.progrsDivCdNm})</button>
      ) : <p className="muted">개찰결과가 아직 등록되지 않았습니다.</p>}
    </>
  );
}

export default function Detail({ sel, onClose, onOpen, myBizno, starred, onStar }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const { type, kind, item: r } = sel;
  const key = `${type}:${r.bidNtceNo}-${r.bidNtceOrd}-${r.bidClsfcNo || ''}`;
  const label = { bid: '입찰공고', openg: '개찰결과', scs: '낙찰정보' }[type];
  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="상세">
        <header>
          <div>
            <span className="badge">{label}{r._orgNm ? ` · ${r._orgNm}` : ''}</span>
            <h2>{r.bidNtceNm}</h2>
            <p className="s">{r.bidNtceNo}-{r.bidNtceOrd} · {r.dminsttNm || r.ntceInsttNm}</p>
          </div>
          <div className="drawer-actions">
            <button className="ghost" onClick={() => onStar(key, sel)}>{starred[key] ? '★ 관심' : '☆ 관심'}</button>
            <button className="close" onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </header>
        <div className="drawer-body">
          {r._org && r._org !== 'g2b' ? <ExtInfo r={r} type={type} /> : type === 'bid' ? (
            <>
              <BidInfo b={r} />
              <BidExtras b={r} kind={kind} />
              <OpengFromBid b={r} kind={kind} onOpen={onOpen} />
              <p className="links"><a href={g2bLink(r)} target="_blank" rel="noreferrer">나라장터 원문 보기 ↗</a></p>
            </>
          ) : (
            <>
              <OpengInfo item={r} kind={kind} type={type} />
              {kind !== 'Etc' && <Reserve r={r} kind={kind} />}
              <Ranking r={r} myBizno={myBizno} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export { wonShort };
