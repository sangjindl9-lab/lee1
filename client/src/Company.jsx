import { useEffect, useState } from 'react';
import { bizno as fmtBizno, won } from './lib.js';

// 어디서든 업체명을 누르면 업체 카드를 띄움
export function openCompany(info) {
  window.dispatchEvent(new CustomEvent('open-company', { detail: info }));
}

export function CompanyName({ name, bizno, ceo, tel, adrs, children }) {
  if (!name) return <>-</>;
  return (
    <button type="button" className="corp-link" title="업체 정보 보기"
      onClick={(e) => { e.stopPropagation(); openCompany({ name, bizno, ceo, tel, adrs }); }}>
      {children || name}
    </button>
  );
}

export default function CompanyCard({ info, onClose }) {
  const [s, setS] = useState({ loading: true, data: null, error: '' });
  const b = String(info.bizno || '').replace(/[^0-9]/g, '');
  const known = false; // 항상 등록업체 정보로 최신 연락처 확인

  useEffect(() => {
    const byName = b.length !== 10 && info.name;
    if (known || (b.length !== 10 && !byName)) { setS({ loading: false, data: null, error: '' }); return; }
    let alive = true;
    fetch(byName ? `/api/company-by-name?name=${encodeURIComponent(info.name)}` : `/api/company/${b}`).then((r) => r.json())
      .then((d) => alive && setS({ loading: false, data: d.error ? null : d, error: d.error || '' }))
      .catch((e) => alive && setS({ loading: false, data: null, error: e.message }));
    return () => { alive = false; };
  }, [b, known, info.name]);

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const d = s.data?.found ? s.data : null;
  const adrs = d?.adrs || info.adrs;
  const tel = d?.tel || info.tel;
  const ceo = d?.ceo || info.ceo;
  const telHref = tel ? `tel:${tel.replace(/[^0-9+]/g, '')}` : null;
  const mapHref = adrs ? `https://map.naver.com/p/search/${encodeURIComponent(adrs)}` : null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="corp-card" role="dialog" aria-label="업체 정보" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <span className="badge">업체 정보</span>
            <h2>{info.name}</h2>
          </div>
          <button className="close" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <dl className="corp-dl">
          <dt>대표자</dt><dd>{ceo || '-'}</dd>
          <dt>사업자번호</dt><dd>{fmtBizno(b || d?.bizno || '') || '-'}</dd>
          <dt>주소</dt>
          <dd>{s.loading ? <span className="muted">찾는 중…</span> : adrs ? <>{adrs} {mapHref && <a href={mapHref} target="_blank" rel="noreferrer" className="mini">지도</a>}</> : <span className="muted">정보 없음</span>}</dd>
          <dt>전화번호</dt>
          <dd>{s.loading ? <span className="muted">찾는 중…</span> : tel ? <a href={telHref} className="tel">{tel}</a> : <span className="muted">정보 없음</span>}</dd>
          {d?.fax && <><dt>팩스</dt><dd>{d.fax}</dd></>}
          {d?.homepage && <><dt>홈페이지</dt><dd><a href={/^https?:/.test(d.homepage) ? d.homepage : `http://${d.homepage}`} target="_blank" rel="noreferrer">{d.homepage}</a></dd></>}
          {d?.source === 'usr' && (d.corpBsnsDivNm || d.hdoffceDivNm || d.emplyeNum) && (
            <><dt>구분</dt><dd>{[d.corpBsnsDivNm, d.hdoffceDivNm, Number(d.emplyeNum) ? `직원 ${d.emplyeNum}명` : '', d.opbizDt ? `개업 ${String(d.opbizDt).slice(0, 10)}` : ''].filter(Boolean).join(' · ')}</dd></>
          )}
        </dl>
        {!s.loading && !adrs && !tel && (
          <p className="muted small">나라장터 등록업체 정보에서 이 업체를 찾지 못했습니다.{b.length !== 10 ? ' (사업자번호가 없는 자료라 업체명이 똑같은 곳을 찾았습니다)' : ''}</p>
        )}
        {s.data?.usrState === 'notRegistered' && (
          <p className="error small">사용자정보서비스 API 활용신청이 필요합니다. 공공데이터포털에서 「조달청_나라장터 사용자정보 서비스」를 신청하면 모든 업체 연락처가 나옵니다.</p>
        )}
        {s.error && <p className="error small">⚠ {s.error}</p>}
        {d && b.length !== 10 && <p className="muted small">※ 이 기관 자료에는 사업자번호가 없어 업체명이 똑같은 나라장터 등록업체를 찾아 보여줍니다.</p>}
        {d?.source === 'usr' && <p className="muted small">출처: 나라장터 등록업체 정보 (조달청 사용자정보서비스)</p>}
        {d?.source === 'award' && d?.lastBid && (
          <p className="muted small">연락처 출처: 최근 낙찰 「{d.lastBid}」 {d.lastDate ? `(${String(d.lastDate).slice(0, 10)})` : ''}{Number(d.lastAmt) ? ` · ${won(d.lastAmt)}원` : ''}</p>
        )}
      </div>
    </div>
  );
}
