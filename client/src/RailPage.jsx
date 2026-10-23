import { useState } from 'react';
import { won, wonShort, daysAgo, exportExcel, load, save } from './lib.js';
import KrResult from './KrResult.jsx';
import KwaterPage from './KwaterPage.jsx';

// 철도기관 (국가철도공단·한국철도공사) — 공공데이터포털 파일데이터. 실시간이 아님.
const SOURCES = [
  { id: 'kw-notice', label: '수자원공사 입찰공고' },
  { id: 'kw-rst', label: '수자원공사 낙찰결과' },
  { id: 'kr-openg', label: '철도공단 개찰결과' },
  { id: 'kr-award', label: '철도공단 낙찰결과' },
  { id: 'kr', label: '철도공단 입찰정보(파일)' },
  { id: 'korail', label: '철도공사 입찰공고(파일)' },
];

const COLS = {
  kr: [
    { key: 'bidNtceNm', label: '공고명', wch: 50 },
    { key: 'kindNm', label: '구분', wch: 8 },
    { key: 'dept', label: '소속', wch: 16 },
    { key: 'amount', label: '설계금액', wch: 14, excel: (r) => Number(r.amount) || '' },
    { key: 'method', label: '계약방법', wch: 14 },
    { key: 'standard', label: '심사기준', wch: 16 },
    { key: 'lowerRate', label: '낙찰하한율', wch: 10 },
    { key: 'prearng', label: '예가방식', wch: 12 },
    { key: 'jv', label: '공동수급', wch: 12 },
    { key: 'ntceDt', label: '공고일', wch: 12 },
    { key: 'clseDt', label: '접수마감', wch: 16 },
    { key: 'opengDt', label: '개찰일', wch: 16 },
    { key: 'status', label: '진행상태', wch: 10 },
    { key: 'officer', label: '담당', wch: 10 },
  ],
  korail: [
    { key: 'bidNtceNo', label: '공고번호', wch: 16 },
    { key: 'bidNtceNm', label: '공고명', wch: 50 },
    { key: 'beginDt', label: '접수개시', wch: 16 },
    { key: 'clseDt', label: '접수마감', wch: 16 },
    { key: 'opengDt', label: '개찰일', wch: 16 },
  ],
};

export default function RailPage({ fixed }) {
  const saved = load('search:rail', {});
  const [srcState, setSrc] = useState('kw-rst');
  const src = fixed || srcState;
  const [q, setQ] = useState(saved.q || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [s, setS] = useState({ loading: false, error: '', items: [], total: 0, file: '', latest: '', all: 0, searched: false });

  async function run(p = 1, source = src) {
    setPageNo(p);
    save('search:rail', { q });
    setS((x) => ({ ...x, loading: true, error: '' }));
    const qs = new URLSearchParams({ q, from, to, pageNo: p, numOfRows: 30 });
    try {
      const d = await fetch(`/api/ext/${source}?${qs}`).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setS({ loading: false, error: '', items: d.items, total: d.totalCount, file: d.file, latest: d.latest, all: d.all, searched: true });
    } catch (e) {
      setS({ loading: false, error: e.message, items: [], total: 0, file: '', latest: '', all: 0, searched: true });
    }
  }

  async function download() {
    const qs = new URLSearchParams({ q, from, to, pageNo: 1, numOfRows: 5000 });
    const d = await fetch(`/api/ext/${src}?${qs}`).then((r) => r.json());
    if (d.error) return setS((x) => ({ ...x, error: d.error }));
    exportExcel(d.items, COLS[src], `${SOURCES.find((x) => x.id === src).label}.xlsx`);
  }

  const pages = Math.max(1, Math.ceil(s.total / 30));
  return (
    <section>
      {!fixed && <div className="kind-tabs" role="tablist">
        {SOURCES.map((x) => (
          <button key={x.id} role="tab" aria-selected={src === x.id} className={src === x.id ? 'on' : ''}
            onClick={() => { setSrc(x.id); if (s.searched && !/^(kr|kw)-/.test(x.id)) run(1, x.id); }}>{x.label}</button>
        ))}
      </div>}
      {src.startsWith('kw-') ? <KwaterPage key={src} mode={src === 'kw-rst' ? 'rst' : 'notice'} /> : src.startsWith('kr-') ? <KrResult key={src} type={src.slice(3)} /> : <>

      <div className="banner inline">
        ⓘ 이 기관들은 실시간 API가 없어 <b>기관이 공공데이터포털에 올린 파일</b>을 보여줍니다.
        {s.file && <> 현재 파일: <b>{s.file}</b>{s.latest && <> · 가장 최근 공고 {s.latest.slice(0, 10)}</>}</>}
        <br />최신 공고는 각 기관 전자조달 사이트에서 확인하세요:{' '}
        <a href="https://ebid.kr.or.kr/" target="_blank" rel="noreferrer">국가철도공단</a> ·{' '}
        <a href="https://ebid.korail.com/" target="_blank" rel="noreferrer">한국철도공사</a>
      </div>

      <form className="filters" onSubmit={(e) => { e.preventDefault(); run(1); }}>
        <div className="row">
          <label className="fld grow"><span>공고명 (띄어쓰기로 여러 단어)</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 전기, 통신, 신호" /></label>
          <label className="fld"><span>기간 (공고일)</span>
            <div className="dates">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <em>~</em>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div></label>
          <div className="quick">
            <button type="button" onClick={() => { setFrom(daysAgo(89)); setTo(daysAgo(0)); }}>3개월</button>
            <button type="button" onClick={() => { setFrom(daysAgo(364)); setTo(daysAgo(0)); }}>1년</button>
            <button type="button" onClick={() => { setFrom(''); setTo(''); }}>전체</button>
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={s.loading}>{s.loading ? '불러오는 중…' : '검색'}</button>
          </div>
        </div>
      </form>

      <div className="result-head">
        <div>
          <strong>{SOURCES.find((x) => x.id === src).label}</strong>
          {s.searched && <span className="count">총 {s.total.toLocaleString()}건{s.all ? ` (전체 ${s.all.toLocaleString()}건 중)` : ''}</span>}
        </div>
        <button className="ghost" disabled={!s.items.length} onClick={download}>엑셀 다운로드</button>
      </div>

      {s.error && <div className="error">⚠ {s.error}</div>}

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>공고명</th>
              {src === 'kr' && <><th className="num">설계금액</th><th className="mid">계약방법</th><th className="mid hide-sm">낙찰하한율</th><th className="mid">진행</th></>}
              <th className="date">공고/접수</th><th className="date">개찰</th>
            </tr>
          </thead>
          <tbody>
            {!s.items.length && <tr><td colSpan={7} className="empty">{s.loading ? '불러오는 중… (처음 한 번은 파일 전체를 받느라 시간이 걸립니다)' : s.searched ? '조건에 맞는 공고가 없습니다.' : '[검색] 버튼을 누르세요.'}</td></tr>}
            {s.items.map((r, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td><div className="title-cell"><div className="t">{r.bidNtceNm}</div>
                  <div className="s">{[r.bidNtceNo, r.kindNm, r.dept, r.officer].filter(Boolean).join(' · ')}</div></div></td>
                {src === 'kr' && <>
                  <td className="num" title={won(r.amount)}>{wonShort(r.amount)}</td>
                  <td className="mid">{r.method || '-'}</td>
                  <td className="mid hide-sm">{r.lowerRate || '-'}</td>
                  <td className="mid">{r.status ? <span className="pill">{r.status}</span> : '-'}</td>
                </>}
                <td className="date">{(r.ntceDt || r.beginDt || '-').slice(0, 16)}{r.clseDt && <div className="s">마감 {r.clseDt.slice(5, 16)}</div>}</td>
                <td className="date">{(r.opengDt || '-').slice(0, 16)}</td>
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
      </>}
    </section>
  );
}
