import { useState } from 'react';
import { won, wonShort, daysAgo, exportExcel } from './lib.js';

// 한국수자원공사 전자조달 (공공데이터포털 OpenAPI) — 입찰공고(공사·용역·물품·내자) / 낙찰결과
const NOTICE_KINDS = [['cntrwk', '공사'], ['servc', '용역'], ['gds', '물품'], ['dmscpt', '내자']];

export default function KwaterPage({ mode }) { // mode: 'notice' | 'rst'
  const [kind, setKind] = useState('cntrwk');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [pageNo, setPageNo] = useState(1);
  const [sel, setSel] = useState(null);
  const [s, setS] = useState({ loading: false, error: '', items: [], total: 0, searched: false });
  const api = mode === 'rst' ? 'rst' : kind;

  async function run(p = 1, k = api) {
    setPageNo(p);
    setS((x) => ({ ...x, loading: true, error: '' }));
    try {
      const d = await fetch(`/api/kwater/${k}?${new URLSearchParams({ q, from, to, pageNo: p, numOfRows: 30 })}`).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setS({ loading: false, error: '', items: d.items, total: d.totalCount, searched: true, mock: d.mock });
    } catch (e) {
      setS({ loading: false, error: e.message, items: [], total: 0, searched: true });
    }
  }

  async function download() {
    const d = await fetch(`/api/kwater/${api}?${new URLSearchParams({ q, from, to, pageNo: 1, numOfRows: 3000 })}`).then((r) => r.json());
    if (d.error) return setS((x) => ({ ...x, error: d.error }));
    const cols = mode === 'rst' ? [
      { key: 'kindNm', label: '구분', wch: 6 }, { key: 'bidNtceNo', label: '공고번호', wch: 16 }, { key: 'bidNtceNm', label: '공고명', wch: 50 },
      { key: 'dept', label: '부서', wch: 16 }, { key: 'method', label: '계약방법', wch: 12 }, { key: 'selection', label: '낙찰자결정방법', wch: 16 },
      { key: 'winnerNm', label: '낙찰업체', wch: 24 }, { key: 'winnerAmt', label: '낙찰금액', wch: 14, excel: (r) => Number(r.winnerAmt) || '' },
      { key: 'status', label: '진행상태', wch: 10 }, { key: 'ntceDt', label: '공고일', wch: 12 }, { key: 'opengDt', label: '처리일', wch: 12 },
      { key: 'officer', label: '담당자', wch: 8 },
    ] : [
      { key: 'kindNm', label: '구분', wch: 6 }, { key: 'bidNtceNo', label: '공고번호', wch: 16 }, { key: 'bidNtceNm', label: '공고명', wch: 50 },
      { key: 'dept', label: '계약부서', wch: 16 }, { key: 'method', label: '계약방법', wch: 12 },
      { key: 'plnprc', label: '예정가격', wch: 14, excel: (r) => Number(r.plnprc) || '' }, { key: 'status', label: '입찰상태', wch: 10 },
      { key: 'ntceDt', label: '공고일', wch: 12 }, { key: 'clseDt', label: '공고마감', wch: 12 }, { key: 'prtcptCnt', label: '참가업체수', wch: 8 },
      { key: 'officer', label: '담당자', wch: 8 },
    ];
    exportExcel(d.items, cols, `한국수자원공사_${mode === 'rst' ? '낙찰결과' : `입찰공고_${NOTICE_KINDS.find((x) => x[0] === kind)[1]}`}_${from}_${to}.xlsx`);
  }

  const pages = Math.max(1, Math.ceil(s.total / 30));
  return (
    <>
      <div className="banner inline">
        ⓘ 한국수자원공사 자체 전자조달(ebid.kwater.or.kr) 데이터를 공공데이터포털 API로 받아옵니다.
        {mode === 'rst' && <> 낙찰결과에는 <b>낙찰업체명·낙찰금액</b>만 있고 사업자번호가 없어 업체 연락처는 연결되지 않습니다.</>}
      </div>
      {mode === 'notice' && (
        <div className="kind-tabs sub">
          {NOTICE_KINDS.map(([id, label]) => (
            <button key={id} className={kind === id ? 'on' : ''} onClick={() => { setKind(id); if (s.searched) run(1, id); }}>{label}</button>
          ))}
        </div>
      )}
      <form className="filters" onSubmit={(e) => { e.preventDefault(); run(1); }}>
        <div className="row">
          <label className="fld grow"><span>공고명·업체명 (띄어쓰기로 여러 단어)</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 전기, 계측제어, 통신" /></label>
          <label className="fld"><span>{mode === 'rst' ? '처리일' : '공고일'}</span>
            <div className="dates">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <em>~</em>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div></label>
          <div className="quick">
            <button type="button" onClick={() => { setFrom(daysAgo(6)); setTo(daysAgo(0)); }}>1주</button>
            <button type="button" onClick={() => { setFrom(daysAgo(29)); setTo(daysAgo(0)); }}>1개월</button>
            <button type="button" onClick={() => { setFrom(daysAgo(89)); setTo(daysAgo(0)); }}>3개월</button>
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={s.loading}>{s.loading ? '불러오는 중…' : '검색'}</button>
          </div>
        </div>
      </form>

      <div className="result-head">
        <div>
          <strong>한국수자원공사 {mode === 'rst' ? '낙찰결과' : `${NOTICE_KINDS.find((x) => x[0] === kind)[1]} 입찰공고`}</strong>
          {s.searched && <span className="count">총 {s.total.toLocaleString()}건</span>}
          {s.mock && <span className="mock">샘플 모드: 데이터 없음</span>}
        </div>
        <button className="ghost" disabled={!s.items.length} onClick={download}>엑셀 다운로드</button>
      </div>
      {s.error && <div className="error">⚠ {s.error}</div>}

      <div className="table-wrap">
        <table className="list">
          <thead>
            {mode === 'rst' ? (
              <tr><th className="mid">구분</th><th>공고명</th><th className="corp">낙찰업체</th><th className="num">낙찰금액</th><th className="mid">상태</th><th className="date">처리일</th></tr>
            ) : (
              <tr><th>공고명</th><th className="mid">계약방법</th><th className="num">예정가격</th><th className="mid">상태</th><th className="date">공고일</th><th className="date">마감</th></tr>
            )}
          </thead>
          <tbody>
            {!s.items.length && <tr><td colSpan={6} className="empty">{s.loading ? '불러오는 중…' : s.searched ? '조건에 맞는 자료가 없습니다.' : '[검색] 버튼을 누르세요.'}</td></tr>}
            {s.items.map((r, i) => (
              <tr key={i} onClick={() => setSel(r)}>
                {mode === 'rst' ? <>
                  <td className="mid">{r.kindNm}</td>
                  <td><div className="title-cell"><div className="t">{r.bidNtceNm}</div><div className="s">{[r.bidNtceNo, r.dept, r.method].filter(Boolean).join(' · ')}</div></div></td>
                  <td className="corp strong">{r.winnerNm || '-'}</td>
                  <td className="num">{won(r.winnerAmt)}</td>
                  <td className="mid"><span className={`pill ${/낙찰/.test(r.status) ? 'ok' : ''}`}>{r.status || '-'}</span></td>
                  <td className="date">{r.opengDt || r.ntceDt || '-'}</td>
                </> : <>
                  <td><div className="title-cell"><div className="t">{r.bidNtceNm}</div><div className="s">{[r.bidNtceNo, r.dept, r.officer].filter(Boolean).join(' · ')}</div></div></td>
                  <td className="mid">{r.method || '-'}</td>
                  <td className="num" title={won(r.plnprc)}>{Number(r.plnprc) ? wonShort(r.plnprc) : '미공개'}</td>
                  <td className="mid"><span className="pill">{r.status || '-'}</span></td>
                  <td className="date">{r.ntceDt || '-'}</td>
                  <td className="date">{r.clseDt || '-'}</td>
                </>}
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
      {sel && (
        <div className="modal-bg" onClick={() => setSel(null)}>
          <div className="corp-card" onClick={(e) => e.stopPropagation()}>
            <header><div><span className="badge">한국수자원공사 · {sel.kindNm}</span><h2>{sel.bidNtceNm}</h2></div>
              <button className="close" onClick={() => setSel(null)} aria-label="닫기">✕</button></header>
            <dl className="corp-dl">
              <dt>공고번호</dt><dd>{sel.bidNtceNo || '-'}</dd>
              <dt>부서</dt><dd>{sel.dept || '-'}</dd>
              <dt>계약방법</dt><dd>{sel.method || '-'}{sel.selection ? ` · ${sel.selection}` : ''}</dd>
              {mode === 'rst' ? <>
                <dt>낙찰업체</dt><dd><strong>{sel.winnerNm || '-'}</strong></dd>
                <dt>낙찰금액</dt><dd>{won(sel.winnerAmt)}{Number(sel.winnerAmt) ? '원' : ''}</dd>
                <dt>진행상태</dt><dd>{sel.status || '-'}</dd>
                <dt>공고일</dt><dd>{sel.ntceDt || '-'}</dd>
                <dt>처리일</dt><dd>{sel.opengDt || '-'}</dd>
              </> : <>
                <dt>예정가격</dt><dd>{Number(sel.plnprc) ? `${won(sel.plnprc)}원` : '미공개'}</dd>
                <dt>입찰상태</dt><dd>{sel.status || '-'}</dd>
                <dt>공고일</dt><dd>{sel.ntceDt || '-'}</dd>
                <dt>공고마감</dt><dd>{sel.clseDt || '-'}</dd>
                {sel.prtcptCnt && <><dt>참가업체수</dt><dd>{sel.prtcptCnt}</dd></>}
              </>}
              <dt>담당자</dt><dd>{sel.officer || '-'}</dd>
            </dl>
            <p className="links"><a href="https://ebid.kwater.or.kr/" target="_blank" rel="noreferrer">수자원공사 전자조달 원문 ↗</a></p>
          </div>
        </div>
      )}
    </>
  );
}
