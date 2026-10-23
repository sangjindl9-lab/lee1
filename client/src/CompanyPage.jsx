import { useEffect, useState } from 'react';
import { won, wonShort, bizno as fmtBizno, exportExcel, load, save } from './lib.js';

// 업체검색: 업체명 또는 사업자번호 → 나라장터 등록업체 정보 + 보유 업종 + 최근 6개월 낙찰이력
const KIND = { Cnstwk: '공사', Servc: '용역', Thng: '물품' };

function CorpDetail({ b, onClose }) {
  const [s, setS] = useState({ loading: true, d: null, error: '' });
  useEffect(() => {
    fetch(`/api/corps/${b}/detail`).then((r) => r.json())
      .then((d) => setS({ loading: false, d: d.error ? null : d, error: d.error || '' }))
      .catch((e) => setS({ loading: false, d: null, error: e.message }));
  }, [b]);
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const c = s.d?.basic;
  const tel = c?.tel && !/^\*+$/.test(c.tel) ? c.tel : '';
  const total = (s.d?.awards || []).reduce((sum, a) => sum + (Number(a.sucsfbidAmt) || 0), 0);
  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <span className="badge">업체 정보</span>
            <h2>{c?.name || (s.loading ? '불러오는 중…' : fmtBizno(b))}</h2>
            <p className="s">{fmtBizno(b)}{c?.bsns ? ` · ${c.bsns}` : ''}{c?.hdoffce ? ` · ${c.hdoffce}` : ''}</p>
          </div>
          <div className="drawer-actions"><button className="close" onClick={onClose} aria-label="닫기">✕</button></div>
        </header>
        <div className="drawer-body">
          {s.error && <p className="error small">⚠ {s.error}</p>}
          {s.loading && <p className="muted">등록정보·업종·최근 낙찰이력을 불러오는 중… (10초 정도 걸릴 수 있습니다)</p>}
          {c && (
            <>
              <h3>기본 정보</h3>
              <dl className="grid">
                <div className="kv"><dt>대표자</dt><dd><strong>{c.ceo || '-'}</strong></dd></div>
                <div className="kv"><dt>전화번호</dt><dd>{tel ? <a href={`tel:${tel.replace(/[^0-9]/g, '')}`} className="tel">{tel}</a> : '비공개'}</dd></div>
                <div className="kv wide"><dt>주소</dt><dd>{c.adrs || '-'} {c.adrs && <a className="mini" href={`https://map.naver.com/p/search/${encodeURIComponent(c.adrs)}`} target="_blank" rel="noreferrer">지도</a>}</dd></div>
                <div className="kv"><dt>팩스</dt><dd>{c.fax || '-'}</dd></div>
                <div className="kv"><dt>종업원수</dt><dd>{Number(c.emplyeNum) ? `${c.emplyeNum}명` : '-'}</dd></div>
                <div className="kv"><dt>개업일</dt><dd>{c.opbizDt || '-'}</dd></div>
                <div className="kv"><dt>나라장터 등록</dt><dd>{c.rgstDt || '-'}</dd></div>
                {c.homepage && <div className="kv wide"><dt>홈페이지</dt><dd><a href={/^https?:/.test(c.homepage) ? c.homepage : `http://${c.homepage}`} target="_blank" rel="noreferrer">{c.homepage}</a></dd></div>}
              </dl>
            </>
          )}
          {s.d && (
            <>
              <h3>보유 업종(면허) <small>({s.d.industries.length})</small></h3>
              {!s.d.industries.length ? <p className="muted">등록된 업종 정보가 없습니다.</p> : (
                <div className="chips">
                  {s.d.industries.map((x, i) => (
                    <span key={i} className={x.main ? 'chip on' : 'chip'} title={`등록 ${x.rgstDt}${x.expire ? ` · 만료 ${x.expire}` : ''}`}>
                      {x.main && '대표 '}{x.name}{x.state && x.state !== '정상' ? ` (${x.state})` : ''}
                    </span>
                  ))}
                </div>
              )}
              <h3>최근 6개월 낙찰이력 (나라장터) <small>({s.d.awards.length}건{total ? ` · 합계 ${wonShort(total)}` : ''})</small>
                {s.d.awards.length > 0 && (
                  <button className="ghost xs" onClick={() => exportExcel(s.d.awards, [
                    { key: '_kind', label: '구분', excel: (r) => KIND[r._kind] || '' }, { key: 'bidNtceNo', label: '공고번호', wch: 16 },
                    { key: 'bidNtceNm', label: '공고명', wch: 50 }, { key: 'dminsttNm', label: '수요기관', wch: 24 },
                    { key: 'sucsfbidAmt', label: '낙찰금액', wch: 14, excel: (r) => Number(r.sucsfbidAmt) || '' }, { key: 'sucsfbidRate', label: '낙찰률' },
                    { key: 'prtcptCnum', label: '참가' }, { key: 'opengDt', label: '개찰일', wch: 18 },
                  ], `${c?.name || b}_낙찰이력.xlsx`)}>엑셀</button>
                )}
              </h3>
              {!s.d.awards.length ? <p className="muted">최근 6개월 동안 낙찰이 확정된 나라장터 건이 없습니다.</p> : (
                <div className="table-wrap tight">
                  <table className="sub">
                    <thead><tr><th className="hide-sm">구분</th><th>공고명</th><th className="num">낙찰금액</th><th className="num hide-sm">낙찰률</th><th className="hide-sm">개찰일</th></tr></thead>
                    <tbody>
                      {s.d.awards.map((a, i) => (
                        <tr key={i}>
                          <td className="hide-sm">{KIND[a._kind]}</td>
                          <td>{a.bidNtceNm}<div className="s">{a.dminsttNm} · {String(a.opengDt || '').slice(0, 10)}</div></td>
                          <td className="num">{won(a.sucsfbidAmt)}<div className="s show-sm">{a.sucsfbidRate ? `${a.sucsfbidRate}%` : ''}</div></td>
                          <td className="num hide-sm">{a.sucsfbidRate ? `${a.sucsfbidRate}%` : '-'}</td>
                          <td className="rmrk hide-sm">{String(a.opengDt || '').slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted small">출처: 조달청 나라장터 사용자정보서비스·낙찰정보서비스</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function CompanyPage() {
  const [q, setQ] = useState(() => load('corpQ', ''));
  const [region, setRegion] = useState('');
  const [sel, setSel] = useState(null);
  const [s, setS] = useState({ loading: false, error: '', items: [], total: 0, searched: false, partial: false });

  async function run(e) {
    e?.preventDefault();
    const v = q.trim();
    if (!v) return;
    save('corpQ', v);
    setS((x) => ({ ...x, loading: true, error: '' }));
    try {
      const d = await fetch(`/api/corps/search?q=${encodeURIComponent(v)}`).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setS({ loading: false, error: '', items: d.items, total: d.totalCount, searched: true, partial: d.partial });
      if (d.items.length === 1) setSel(d.items[0].bizno);
    } catch (err) {
      setS({ loading: false, error: err.message, items: [], total: 0, searched: true });
    }
  }

  const items = region ? s.items.filter((c) => (c.rgnNm || c.adrs || '').includes(region)) : s.items;
  return (
    <section>
      <form className="filters" onSubmit={run}>
        <div className="row">
          <label className="fld grow"><span>업체명 또는 사업자번호</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 에스에스전력, 224-81-12345" autoFocus /></label>
          <div className="actions">
            <button type="submit" className="primary" disabled={s.loading}>{s.loading ? '검색 중…' : '검색'}</button>
          </div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>나라장터에 등록된 모든 업체를 찾습니다. 업체명 검색은 2000년 이후 등록 연도를 모두 뒤져서 5~10초 걸립니다. 일부만 입력해도 됩니다(예: "서화").</p>
      </form>

      <div className="result-head">
        <div>
          <strong>업체검색</strong>
          {s.searched && <span className="count">{s.total.toLocaleString()}곳{s.total > 300 ? ' (상위 300곳 표시)' : ''}</span>}
          {s.partial && <span className="mock">일부 연도 조회 실패 — 다시 검색해 보세요</span>}
        </div>
        {s.items.length > 0 && (
          <div className="dates">
            <input className="region-filter" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="지역으로 좁히기 (예: 강원)" />
            <button className="ghost" onClick={() => exportExcel(items, [
              { key: 'name', label: '업체명', wch: 26 }, { key: 'ceo', label: '대표자', wch: 10 }, { key: 'bizno', label: '사업자번호', wch: 14, excel: (r) => fmtBizno(r.bizno) },
              { key: 'adrs', label: '주소', wch: 46 }, { key: 'tel', label: '전화', wch: 15 }, { key: 'fax', label: '팩스', wch: 15 },
              { key: 'bsns', label: '업무구분', wch: 8 }, { key: 'emplyeNum', label: '종업원', wch: 7 }, { key: 'rgstDt', label: '등록일', wch: 12 },
            ], `업체검색_${q}.xlsx`)}>엑셀 다운로드</button>
          </div>
        )}
      </div>
      {s.error && <div className="error">⚠ {s.error}</div>}

      <div className="table-wrap">
        <table className="list">
          <thead><tr><th>업체명</th><th className="mid">대표자</th><th className="org">주소</th><th className="mid">전화</th><th className="mid hide-sm">구분</th></tr></thead>
          <tbody>
            {!items.length && <tr><td colSpan={5} className="empty">{s.loading ? '나라장터 등록업체를 찾는 중…' : s.searched ? '찾는 업체가 없습니다.' : '업체명이나 사업자번호를 입력하고 [검색]을 누르세요.'}</td></tr>}
            {items.map((c) => (
              <tr key={c.bizno} onClick={() => setSel(c.bizno)}>
                <td><div className="title-cell"><div className="t">{c.name}</div><div className="s">{fmtBizno(c.bizno)}</div></div></td>
                <td className="mid">{c.ceo || '-'}</td>
                <td className="org">{c.adrs || c.rgnNm || '-'}</td>
                <td className="mid">{c.tel && !/^\*+$/.test(c.tel) ? c.tel : '-'}</td>
                <td className="mid hide-sm">{c.bsns || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && <CorpDetail b={sel} onClose={() => setSel(null)} />}
    </section>
  );
}
