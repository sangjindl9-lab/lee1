import { useEffect, useMemo, useState } from 'react';
import {
  KINDS, REGIONS, INDUSTRY_PRESETS, api, toApiDt, daysAgo, daysLater, load, save, exportExcel,
} from './lib.js';

const RANGES = [
  { label: '오늘', from: 0 }, { label: '3일', from: 2 }, { label: '1주', from: 6 }, { label: '2주', from: 13 }, { label: '1개월', from: 29 },
];

export default function SearchPage({ page, onOpen, starred, onStar, myBizno }) {
  const storeKey = `search:${page.id}`;
  const initial = useMemo(() => ({
    inqryDiv: page.dateDivs[0][0], from: daysAgo(6), to: daysAgo(0), bidNtceNm: '', dminsttNm: '', ntceInsttNm: '',
    prtcptLmtRgnCd: '', indstrytyNm: '', priceMin: '', priceMax: '', bidClseExcpYn: '', bizno: '', numOfRows: '30',
    industries: [],
    ...load(storeKey, {}),
    kind: 'Cnstwk', // 기본은 항상 공사
  }), [storeKey]);
  // 예전 버전에서 저장된 단일 업종값을 체크박스로 옮김
  if (!Array.isArray(initial.industries)) initial.industries = [];
  const preset = INDUSTRY_PRESETS.find(([, v]) => v === initial.indstrytyNm);
  if (preset) { initial.industries = [...new Set([...initial.industries, preset[1]])]; initial.indstrytyNm = ''; }
  const [f, setF] = useState(initial);
  const [pageNo, setPageNo] = useState(1);
  const [state, setState] = useState({ loading: false, error: '', items: [], total: 0, mock: false, joined: false, truncated: false });
  const [sort, setSort] = useState(null);
  const [adv, setAdv] = useState(false);
  const [searched, setSearched] = useState(false); // 검색 버튼을 누르기 전에는 조회하지 않음
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e?.target ? (e.target.type === 'checkbox' ? (e.target.checked ? 'Y' : '') : e.target.value) : e }));

  const kinds = KINDS.filter((k) => (!k.bidOnly || page.id === 'bid') && (!k.awardOnly || page.id === 'scs'));

  async function run(p = 1) {
    setState((s) => ({ ...s, loading: true, error: '' }));
    setPageNo(p);
    setSearched(true);
    save(storeKey, { ...f, from: undefined, to: undefined, kind: undefined });
    const q = {
      pageNo: p, numOfRows: f.numOfRows, inqryDiv: f.inqryDiv,
      inqryBgnDt: toApiDt(f.from), inqryEndDt: toApiDt(f.to, true),
      bidNtceNm: f.bidNtceNm.trim(), dminsttNm: f.dminsttNm.trim(), ntceInsttNm: f.ntceInsttNm.trim(),
      prtcptLmtRgnCd: f.prtcptLmtRgnCd,
      indstrytyNm: [...f.industries, ...f.indstrytyNm.split(',')].map((x) => x.trim()).filter(Boolean).join(','),
      presmptPrceBgn: f.priceMin ? Math.round(Number(f.priceMin) * 1e4) : '',
      presmptPrceEnd: f.priceMax ? Math.round(Number(f.priceMax) * 1e4) : '',
    };
    if (page.id === 'bid') q.bidClseExcpYn = f.bidClseExcpYn;
    if (page.id === 'scs') q.bizno = f.bizno.replaceAll('-', '').trim();
    try {
      const d = await api(page.svc, page.op(f.kind), q);
      setState({ loading: false, error: '', items: d.items, total: d.totalCount, mock: !!d.mock, joined: !!d.industryFiltered, truncated: !!d.truncated });
    } catch (e) {
      setState({ loading: false, error: e.message, items: [], total: 0, mock: false });
    }
  }

  // 이미 검색한 뒤 공사/용역/물품 탭을 바꾸면 같은 조건으로 다시 조회
  useEffect(() => { if (searched) run(1); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.kind]);

  const rows = useMemo(() => {
    if (!sort) return state.items;
    const col = page.columns.find((c) => c.key === sort.key);
    const val = (r) => (col.sortVal ? col.sortVal(r) : r[col.key] ?? '');
    return [...state.items].sort((a, b) => {
      const x = val(a); const y = val(b);
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      return sort.dir * cmp;
    });
  }, [state.items, sort, page.columns]);

  const pages = Math.max(1, Math.ceil(state.total / Number(f.numOfRows)));
  const kindLabel = kinds.find((k) => k.id === f.kind)?.label;

  return (
    <section>
      <div className="kind-tabs" role="tablist">
        {kinds.map((k) => (
          <button key={k.id} role="tab" aria-selected={f.kind === k.id} className={f.kind === k.id ? 'on' : ''}
            onClick={() => { setSort(null); setF((p) => ({ ...p, kind: k.id })); }}>{k.label}</button>
        ))}
      </div>

      <form className={adv ? 'filters adv-open' : 'filters'} onSubmit={(e) => { e.preventDefault(); run(1); }}>
        <div className="row">
          <label className="fld">
            <span>조회기준</span>
            <select value={f.inqryDiv} onChange={set('inqryDiv')}>
              {page.dateDivs.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="fld">
            <span>기간</span>
            <div className="dates">
              <input type="date" value={f.from} onChange={set('from')} />
              <em>~</em>
              <input type="date" value={f.to} onChange={set('to')} />
            </div>
          </label>
          <div className="quick">
            {RANGES.map((r) => (
              <button type="button" key={r.label} onClick={() => setF((p) => ({ ...p, from: daysAgo(r.from), to: daysAgo(0) }))}>{r.label}</button>
            ))}
            {page.id === 'bid' && f.inqryDiv === '2' && (
              <button type="button" onClick={() => setF((p) => ({ ...p, from: daysAgo(0), to: daysLater(14) }))}>앞으로 2주</button>
            )}
          </div>
        </div>

        <div className="row">
          <label className="fld grow"><span>공고명</span>
            <input value={f.bidNtceNm} onChange={set('bidNtceNm')} placeholder="예: 전기, LED, 수배전반" /></label>
          <label className="fld adv"><span>수요기관</span>
            <input value={f.dminsttNm} onChange={set('dminsttNm')} placeholder="예: 원주시" /></label>
          <label className="fld adv"><span>공고기관</span>
            <input value={f.ntceInsttNm} onChange={set('ntceInsttNm')} placeholder="예: 강원지방조달청" /></label>
        </div>

        <div className="row">
          <label className="fld adv"><span>참가제한지역</span>
            <select value={f.prtcptLmtRgnCd} onChange={set('prtcptLmtRgnCd')}>
              {REGIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          <div className="fld adv industry">
            <span>업종 <small>(여러 개 선택 가능)</small></span>
            <div className="chips">
              {INDUSTRY_PRESETS.map(([label, v]) => {
                const on = f.industries.includes(v);
                return (
                  <label key={v} className={on ? 'chip on' : 'chip'}>
                    <input type="checkbox" checked={on}
                      onChange={() => setF((p) => ({ ...p, industries: on ? p.industries.filter((x) => x !== v) : [...p.industries, v] }))} />
                    {label}
                  </label>
                );
              })}
              <input className="chip-input" value={f.indstrytyNm} onChange={set('indstrytyNm')} placeholder="직접입력 (쉼표로 여러 개)" />
              {(f.industries.length > 0 || f.indstrytyNm) && (
                <button type="button" className="ghost xs" onClick={() => setF((p) => ({ ...p, industries: [], indstrytyNm: '' }))}>선택 해제</button>
              )}
            </div>
          </div>
          <label className="fld adv"><span>추정가격 (만원)</span>
            <div className="dates">
              <input inputMode="numeric" value={f.priceMin} onChange={set('priceMin')} placeholder="이상" />
              <em>~</em>
              <input inputMode="numeric" value={f.priceMax} onChange={set('priceMax')} placeholder="이하" />
            </div></label>
          {page.id === 'scs' && (
            <label className="fld"><span>낙찰업체 사업자번호</span>
              <div className="dates">
                <input value={f.bizno} onChange={set('bizno')} placeholder="000-00-00000" />
                {myBizno && <button type="button" className="ghost xs" onClick={() => setF((p) => ({ ...p, bizno: myBizno }))}>우리회사</button>}
              </div></label>
          )}
          {page.id === 'bid' && (
            <label className="chk"><input type="checkbox" checked={f.bidClseExcpYn === 'Y'} onChange={set('bidClseExcpYn')} /> 입찰마감 제외</label>
          )}
          <div className="actions">
            <button type="button" className="ghost adv-toggle" onClick={() => setAdv((v) => !v)}>{adv ? '조건 접기' : '상세조건'}</button>
            <select value={f.numOfRows} onChange={set('numOfRows')} aria-label="페이지당 건수">
              {['20', '30', '50', '100'].map((n) => <option key={n} value={n}>{n}건</option>)}
            </select>
            <button type="submit" className="primary" disabled={state.loading}>{state.loading ? '조회 중…' : '검색'}</button>
          </div>
        </div>
      </form>

      <div className="result-head">
        <div>
          <strong>{kindLabel} {page.title}</strong>
          {searched && <span className="count">총 {state.total.toLocaleString()}건</span>}
          {state.mock && <span className="mock">샘플 데이터 (인증키 미설정)</span>}
          {state.joined && <span className="joined" title="조달청 개찰·낙찰 API의 업종 조건이 정상 동작하지 않아, 입찰공고의 업종(면허)제한 기준으로 걸렀습니다.">업종: 입찰공고 면허제한 기준{state.truncated ? ' · 기간이 길어 일부만 반영' : ''}</span>}
        </div>
        <button className="ghost" disabled={!rows.length}
          onClick={() => exportExcel(rows, page.columns.filter((c) => !c.noExcel), `${page.title}_${kindLabel}_${f.from}_${f.to}.xlsx`)}>
          엑셀 다운로드
        </button>
      </div>

      {state.error && <div className="error">⚠ {state.error}</div>}

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th className="star-col" aria-label="관심"></th>
              {page.columns.map((c) => (
                <th key={c.key} className={c.cls} style={c.width ? { width: c.width } : null}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? -s.dir : 1 }))}>
                  {c.label}{sort?.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.loading && !rows.length && <tr><td colSpan={page.columns.length + 1} className="empty">불러오는 중…</td></tr>}
            {!state.loading && !rows.length && !state.error && (
              <tr><td colSpan={page.columns.length + 1} className="empty">
                {searched ? '조건에 맞는 공고가 없습니다.' : '검색 조건을 정하고 [검색] 버튼을 누르세요.'}
              </td></tr>
            )}
            {rows.map((r, i) => {
              const key = `${page.id}:${r.bidNtceNo}-${r.bidNtceOrd}-${r.bidClsfcNo || ''}`;
              return (
                <tr key={key + i} onClick={() => onOpen({ type: page.id, kind: r._kind || f.kind, item: r })}>
                  <td className="star-col" onClick={(e) => { e.stopPropagation(); onStar(key, { type: page.id, kind: r._kind || f.kind, item: r }); }}>
                    <span className={starred[key] ? 'star on' : 'star'} title="관심공고">{starred[key] ? '★' : '☆'}</span>
                  </td>
                  {page.columns.map((c) => <td key={c.key} className={c.cls}>{c.render ? c.render(r) : r[c.key] || '-'}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="pager">
          <button disabled={pageNo <= 1 || state.loading} onClick={() => run(pageNo - 1)}>‹ 이전</button>
          <span>{pageNo} / {pages.toLocaleString()}</span>
          <button disabled={pageNo >= pages || state.loading} onClick={() => run(pageNo + 1)}>다음 ›</button>
        </nav>
      )}
    </section>
  );
}
