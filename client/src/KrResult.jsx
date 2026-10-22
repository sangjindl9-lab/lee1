import { useEffect, useState } from 'react';
import { won, wonShort, daysAgo, exportExcel, bizno as fmtBizno } from './lib.js';
import { CompanyName } from './Company.jsx';

// 국가철도공단 개찰결과·낙찰결과 (전자조달 공개 화면을 서버가 읽어옴)
const LABEL = { openg: '개찰결과', award: '낙찰결과' };

function KrDetail({ type, row, onClose }) {
  const [s, setS] = useState({ loading: true, d: null, error: '' });
  useEffect(() => {
    const qs = new URLSearchParams(row.key);
    fetch(`/api/krbid/${type}/detail?${qs}`).then((r) => r.json())
      .then((d) => setS({ loading: false, d: d.error ? null : d, error: d.error || '' }))
      .catch((e) => setS({ loading: false, d: null, error: e.message }));
  }, [type, row]);
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const d = s.d;
  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <span className="badge">국가철도공단 · {LABEL[type]}</span>
            <h2>{row.bidNtceNm}</h2>
            <p className="s">{row.bidNtceNo} · {row.kindNm} · {row.status}</p>
          </div>
          <div className="drawer-actions"><button className="close" onClick={onClose} aria-label="닫기">✕</button></div>
        </header>
        <div className="drawer-body">
          {s.loading && <p className="muted">철도공단 사이트에서 불러오는 중…</p>}
          {s.error && <p className="error small">⚠ {s.error}</p>}
          {d && (
            <>
              <h3>공고 정보</h3>
              <dl className="grid">
                <div className="kv"><dt>설계금액</dt><dd>{won(d.amount)}원</dd></div>
                <div className="kv"><dt>추정가격</dt><dd>{won(d.presmptPrce)}원</dd></div>
                <div className="kv"><dt>예정가격</dt><dd><strong>{won(d.plnprc)}{Number(d.plnprc) ? '원' : ''}</strong></dd></div>
                <div className="kv"><dt>낙찰하한율</dt><dd>{d.lowerRate ? `${d.lowerRate}%` : '-'}</dd></div>
                <div className="kv"><dt>계약방법</dt><dd>{d.method || '-'}</dd></div>
                <div className="kv"><dt>낙찰자선정</dt><dd>{d.selection || '-'}</dd></div>
                <div className="kv wide"><dt>심사기준</dt><dd>{d.standard || '-'}</dd></div>
                <div className="kv"><dt>접수기간</dt><dd>{d.period || '-'}</dd></div>
                <div className="kv"><dt>개찰일시</dt><dd>{d.opengDt || '-'}</dd></div>
              </dl>
              <h3>{type === 'award' ? '낙찰업체' : '개찰순위'} {d.bidders.length > 0 && <small>({d.bidders.length}개사)</small>}</h3>
              {!d.bidders.length && <p className="muted">공개된 업체 정보가 없습니다.</p>}
              {d.bidders.length > 0 && (
                <div className="table-wrap tight">
                  <table className="sub">
                    <thead><tr>{type === 'openg' && <th>순위</th>}<th>업체명</th><th className="hide-sm">사업자번호</th><th className="num">{type === 'award' ? '낙찰금액' : '입찰금액'}</th>{type === 'openg' && <th className="num">투찰률</th>}<th>비고</th></tr></thead>
                    <tbody>
                      {d.bidders.map((b, i) => (
                        <tr key={i}>
                          {type === 'openg' && <td className="num">{b.rank}</td>}
                          <td><CompanyName name={b.name} bizno={b.bizno} ceo={b.ceo} />{b.ceo && <div className="s">{b.ceo}</div>}</td>
                          <td className="hide-sm">{fmtBizno(b.bizno)}</td>
                          <td className="num">{won(b.amount)}</td>
                          {type === 'openg' && <td className="num">{b.rate ? `${b.rate}%` : '-'}</td>}
                          <td className="rmrk">{[b.note, b.jv].filter(Boolean).join(' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.notice && <p className="muted small">{d.notice}</p>}
            </>
          )}
          <p className="links"><a href="https://ebid.kr.or.kr/" target="_blank" rel="noreferrer">국가철도공단 전자조달 원문 ↗</a></p>
        </div>
      </aside>
    </div>
  );
}

export default function KrResult({ type }) {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(daysAgo(0));
  const [pageNo, setPageNo] = useState(1);
  const [sel, setSel] = useState(null);
  const [exporting, setExporting] = useState('');
  const [s, setS] = useState({ loading: false, error: '', items: [], total: 0, searched: false });

  async function run(p = 1) {
    setPageNo(p);
    setS((x) => ({ ...x, loading: true, error: '' }));
    try {
      const d = await fetch(`/api/krbid/${type}?${new URLSearchParams({ q, from, to, pageNo: p, numOfRows: 30 })}`).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setS({ loading: false, error: '', items: d.items, total: d.totalCount, searched: true });
    } catch (e) {
      setS({ loading: false, error: e.message, items: [], total: 0, searched: true });
    }
  }

  async function download() {
    try {
      setExporting('결과 불러오는 중… (상세를 하나씩 읽어 시간이 걸립니다)');
      const d = await fetch(`/api/krbid/${type}?${new URLSearchParams({ q, from, to, pageNo: 1, numOfRows: 300 })}`).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      const biznos = [...new Set(d.items.map((r) => r.winnerBizno).filter(Boolean))];
      const info = {};
      for (let i = 0; i < biznos.length; i += 50) {
        setExporting(`업체 정보 조회 중… ${Math.min(i + 50, biznos.length)}/${biznos.length}`);
        const r = await fetch(`/api/companies?b=${biznos.slice(i, i + 50).join(',')}`).then((x) => x.json());
        Object.assign(info, r.companies || {});
      }
      const ci = (r) => info[r.winnerBizno] || {};
      exportExcel(d.items, [
        { key: 'kindNm', label: '구분', wch: 6 }, { key: 'bidNtceNo', label: '공고번호', wch: 18 }, { key: 'bidNtceNm', label: '공고명', wch: 50 },
        { key: 'amount', label: '설계금액', wch: 14, excel: (r) => Number(r.amount) || '' },
        { key: 'presmptPrce', label: '추정가격', wch: 14, excel: (r) => Number(r.presmptPrce) || '' },
        { key: 'plnprc', label: '예정가격', wch: 14, excel: (r) => Number(r.plnprc) || '' },
        { key: 'lowerRate', label: '낙찰하한율', wch: 9 }, { key: 'status', label: '처리상태', wch: 9 },
        { key: 'winnerNm', label: type === 'award' ? '낙찰업체명' : '1순위 업체명', wch: 24 },
        { key: '_ceo', label: '대표자', wch: 10, excel: (r) => ci(r).ceo || r.winnerCeo || '' },
        { key: '_biz', label: '사업자번호', wch: 14, excel: (r) => fmtBizno(r.winnerBizno) },
        { key: '_adrs', label: '업체주소', wch: 46, excel: (r) => ci(r).adrs || '' },
        { key: '_tel', label: '전화번호', wch: 15, excel: (r) => ci(r).tel || '' },
        { key: '_fax', label: '팩스', wch: 15, excel: (r) => ci(r).fax || '' },
        { key: 'winnerAmt', label: type === 'award' ? '낙찰금액' : '투찰금액', wch: 14, excel: (r) => Number(r.winnerAmt) || '' },
        { key: 'winnerRate', label: '투찰률', wch: 8 }, { key: 'bidderCount', label: '참가', wch: 6 },
        { key: 'opengDt', label: '개찰일시', wch: 16 },
      ], `국가철도공단_${LABEL[type]}_${from}_${to}.xlsx`);
    } catch (e) {
      setS((x) => ({ ...x, error: `엑셀 다운로드 실패: ${e.message}` }));
    } finally { setExporting(''); }
  }

  const pages = Math.max(1, Math.ceil(s.total / 30));
  return (
    <>
      <div className="banner inline">
        ⓘ 국가철도공단은 개찰·낙찰 API가 없어 <b>전자조달 사이트(ebid.kr.or.kr)의 공개 화면</b>을 읽어옵니다. 실시간이지만 첫 검색은 10~30초 걸릴 수 있습니다.
      </div>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); run(1); }}>
        <div className="row">
          <label className="fld grow"><span>공고명 (띄어쓰기로 여러 단어)</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 전기, 통신, 신호" /></label>
          <label className="fld"><span>개찰일</span>
            <div className="dates">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <em>~</em>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div></label>
          <div className="quick">
            <button type="button" onClick={() => { setFrom(daysAgo(0)); setTo(daysAgo(0)); }}>오늘</button>
            <button type="button" onClick={() => { setFrom(daysAgo(6)); setTo(daysAgo(0)); }}>1주</button>
            <button type="button" onClick={() => { setFrom(daysAgo(29)); setTo(daysAgo(0)); }}>1개월</button>
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={s.loading}>{s.loading ? '불러오는 중…' : '검색'}</button>
          </div>
        </div>
      </form>

      <div className="result-head">
        <div>
          <strong>국가철도공단 {LABEL[type]}</strong>
          {s.searched && <span className="count">총 {s.total.toLocaleString()}건</span>}
        </div>
        <button className="ghost" disabled={!s.items.length || !!exporting} onClick={download}>{exporting || '엑셀 다운로드'}</button>
      </div>
      {s.error && <div className="error">⚠ {s.error}</div>}

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th className="mid">구분</th><th>공고명</th><th className="num">설계금액</th><th className="mid">상태</th>
              <th className="corp">{type === 'award' ? '낙찰업체' : '1순위 업체'}</th><th className="num">금액</th>
              {type === 'openg' && <th className="num hide-sm">참가</th>}<th className="date">개찰일시</th>
            </tr>
          </thead>
          <tbody>
            {!s.items.length && <tr><td colSpan={8} className="empty">{s.loading ? '철도공단 사이트에서 불러오는 중…' : s.searched ? '조건에 맞는 공고가 없습니다.' : '[검색] 버튼을 누르세요.'}</td></tr>}
            {s.items.map((r, i) => (
              <tr key={i} onClick={() => setSel(r)}>
                <td className="mid">{r.kindNm}</td>
                <td><div className="title-cell"><div className="t">{r.bidNtceNm}</div><div className="s">{r.bidNtceNo}{r.lowerRate ? ` · 하한 ${r.lowerRate}%` : ''}</div></div></td>
                <td className="num">{wonShort(r.amount)}</td>
                <td className="mid"><span className={`pill ${/낙찰|계약/.test(r.status) ? 'ok' : /유찰/.test(r.status) ? 'warn' : ''}`}>{r.status}</span></td>
                <td className="corp strong">{r.winnerNm ? <CompanyName name={r.winnerNm} bizno={r.winnerBizno} ceo={r.winnerCeo} /> : <span className="muted small">{r.detailError || '-'}</span>}</td>
                <td className="num">{won(r.winnerAmt)}{r.winnerRate && <div className="s">{r.winnerRate}%</div>}</td>
                {type === 'openg' && <td className="num hide-sm">{r.bidderCount || '-'}</td>}
                <td className="date">{(r.opengDt || '').slice(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pager">
          <button disabled={pageNo <= 1 || s.loading} onClick={() => run(pageNo - 1)}>‹ 이전</button>
          <span>{pageNo} / {pages}</span>
          <button disabled={pageNo >= pages || s.loading} onClick={() => run(pageNo + 1)}>다음 ›</button>
        </nav>
      )}
      {sel && <KrDetail type={type} row={sel} onClose={() => setSel(null)} />}
    </>
  );
}
