import { useEffect, useState } from 'react';
import { bizno as fmtBizno, won } from './lib.js';

// 어디서든 업체명을 누르면 업체 카드를 띄움
export function openCompany(info) {
  window.dispatchEvent(new CustomEvent('open-company', { detail: info }));
}

export function CompanyName({ name, bizno, ceo, tel, adrs, children }) {
  if (!name) return <>-</>;
  if (!bizno) return <>{children || name}</>;
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
  const known = info.adrs || info.tel;

  useEffect(() => {
    if (known || b.length !== 10) { setS({ loading: false, data: null, error: '' }); return; }
    let alive = true;
    fetch(`/api/company/${b}`).then((r) => r.json())
      .then((d) => alive && setS({ loading: false, data: d.error ? null : d, error: d.error || '' }))
      .catch((e) => alive && setS({ loading: false, data: null, error: e.message }));
    return () => { alive = false; };
  }, [b, known]);

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const d = s.data?.found ? s.data : null;
  const adrs = info.adrs || d?.adrs;
  const tel = info.tel || d?.tel;
  const ceo = info.ceo || d?.ceo;
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
          <dt>사업자번호</dt><dd>{fmtBizno(b)}</dd>
          <dt>주소</dt>
          <dd>{s.loading ? <span className="muted">찾는 중…</span> : adrs ? <>{adrs} {mapHref && <a href={mapHref} target="_blank" rel="noreferrer" className="mini">지도</a>}</> : <span className="muted">정보 없음</span>}</dd>
          <dt>전화번호</dt>
          <dd>{s.loading ? <span className="muted">찾는 중…</span> : tel ? <a href={telHref} className="tel">{tel}</a> : <span className="muted">정보 없음</span>}</dd>
        </dl>
        {!s.loading && !adrs && !tel && (
          <p className="muted small">최근 6개월 안에 최종 낙찰된 이력이 없어 주소·전화번호를 찾지 못했습니다. (조달청 데이터는 낙찰 확정 건에만 연락처가 있습니다)</p>
        )}
        {s.error && <p className="error small">⚠ {s.error}</p>}
        {d?.lastBid && (
          <p className="muted small">연락처 출처: 최근 낙찰 「{d.lastBid}」 {d.lastDate ? `(${String(d.lastDate).slice(0, 10)})` : ''}{Number(d.lastAmt) ? ` · ${won(d.lastAmt)}원` : ''}</p>
        )}
      </div>
    </div>
  );
}
