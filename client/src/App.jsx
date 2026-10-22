import { useCallback, useEffect, useState } from 'react';
import SearchPage from './SearchPage.jsx';
import RailPage from './RailPage.jsx';
import Detail from './Detail.jsx';
import CompanyCard from './Company.jsx';
import { PAGES } from './pages.jsx';
import { KINDS, load, save, shortDt, dday, wonShort } from './lib.js';
import './App.css';

const TABS = [...PAGES.map((p) => ({ id: p.id, label: p.title })), { id: 'rail', label: '철도기관' }, { id: 'star', label: '관심공고' }];

function Watchlist({ starred, onOpen, onStar }) {
  const list = Object.entries(starred).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
  const label = { bid: '입찰', openg: '개찰', scs: '낙찰' };
  if (!list.length) return <div className="empty-box">관심공고가 없습니다. 목록에서 ☆를 눌러 추가하세요.<br /><small>관심공고는 이 브라우저에 저장됩니다.</small></div>;
  return (
    <div className="table-wrap">
      <table className="list">
        <thead><tr><th className="star-col"></th><th>구분</th><th>공고명</th><th className="org">수요기관</th><th className="num">금액</th><th className="date">입찰마감 / 개찰</th></tr></thead>
        <tbody>
          {list.map(([k, v]) => {
            const r = v.item; const d = v.type === 'bid' ? dday(r.bidClseDt) : null;
            return (
              <tr key={k} onClick={() => onOpen(v)}>
                <td className="star-col" onClick={(e) => { e.stopPropagation(); onStar(k, v); }}><span className="star on">★</span></td>
                <td className="mid"><span className="pill">{label[v.type]}·{KINDS.find((x) => x.id === v.kind)?.label}</span></td>
                <td><div className="title-cell"><div className="t">{r.bidNtceNm}</div><div className="s">{r.bidNtceNo}-{r.bidNtceOrd}</div></div></td>
                <td className="org">{r.dminsttNm || r.ntceInsttNm || '-'}</td>
                <td className="num">{wonShort(r.presmptPrce || r.sucsfbidAmt)}</td>
                <td className="date">{v.type === 'bid' ? <>{shortDt(r.bidClseDt)} {d && <span className={`dday ${d.cls}`}>{d.text}</span>}</> : shortDt(r.opengDt || r.rlOpengDt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState(() => load('tab', 'bid'));
  const [sel, setSel] = useState(null);
  const [starred, setStarred] = useState(() => load('starred', {}));
  const [myBizno, setMyBizno] = useState(() => load('myBizno', ''));
  const [showSet, setShowSet] = useState(false);
  const [mock, setMock] = useState(false);
  const [company, setCompany] = useState(null);
  useEffect(() => {
    const h = (e) => setCompany(e.detail);
    window.addEventListener('open-company', h);
    return () => window.removeEventListener('open-company', h);
  }, []);
  const closeCompany = useCallback(() => setCompany(null), []);

  useEffect(() => { save('tab', tab); }, [tab]);
  useEffect(() => { fetch('/api/health').then((r) => r.json()).then((d) => setMock(d.mock)).catch(() => {}); }, []);

  const onStar = useCallback((key, v) => {
    setStarred((s) => {
      const n = { ...s };
      if (n[key]) delete n[key]; else n[key] = { ...v, savedAt: Date.now() };
      save('starred', n);
      return n;
    });
  }, []);
  const close = useCallback(() => setSel(null), []);
  const page = PAGES.find((p) => p.id === tab);
  const starCount = Object.keys(starred).length;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>入</span>
          <div><h1>입찰정보</h1><p>나라장터 입찰·개찰·낙찰 조회</p></div>
        </div>
        <nav className="main-nav">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}{t.id === 'star' && starCount > 0 && <span className="n">{starCount}</span>}
            </button>
          ))}
        </nav>
        <button className="set-btn" onClick={() => setShowSet((v) => !v)} aria-expanded={showSet}>⚙ 설정</button>
      </header>

      {showSet && (
        <div className="settings">
          <label className="fld"><span>우리 회사 사업자번호</span>
            <input value={myBizno} onChange={(e) => { setMyBizno(e.target.value); save('myBizno', e.target.value); }} placeholder="000-00-00000" /></label>
          <p className="muted small">개찰순위에서 우리 회사 순위를 강조 표시하고, 낙찰정보에서 우리 회사 낙찰 건만 볼 수 있습니다.</p>
        </div>
      )}

      {mock && <div className="banner">⚠ 서버에 공공데이터 인증키(DATA_GO_KR_KEY)가 설정되지 않아 <b>샘플 데이터</b>를 보여주고 있습니다.</div>}

      <main>
        {tab === 'rail' ? <RailPage /> : tab === 'star'
          ? <Watchlist starred={starred} onOpen={setSel} onStar={onStar} />
          : <SearchPage key={tab} page={page} onOpen={setSel} starred={starred} onStar={onStar} myBizno={myBizno} />}
      </main>

      <footer className="foot">자료: 조달청 나라장터 (공공데이터포털 OpenAPI) · 실제 입찰 전 나라장터 원문을 꼭 확인하세요. · 버전 10.22-24시</footer>

      {company && <CompanyCard info={company} onClose={closeCompany} />}
      {sel && <Detail sel={sel} onClose={close} onOpen={setSel} myBizno={myBizno} starred={starred} onStar={onStar} />}
    </div>
  );
}
