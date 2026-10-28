import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { sampleProject, blankProject, uid } from './seed.js';
import { costSheet, won } from './calc.js';
import { loadAll, saveProject, deleteProject, saveFile } from './store.js';
import { TextInput } from './ui.jsx';
import { buildWorkbook } from './excel.js';
import { PrintArea, PrintDialog } from './PrintView.jsx';

export const LIVE_URL = 'https://web-jeoksan-production.up.railway.app';
const inArtifact = () => typeof window !== 'undefined' && !!window.claude?.use;
import Naeyeok from './Naeyeok.jsx';
import Ilwi from './Ilwi.jsx';
import Prices from './Prices.jsx';
import Cost, { contractFit } from './Cost.jsx';
import Estimate, { estimateCalc } from './Estimate.jsx';

const TABS = [
  ['proj', '프로젝트'], ['naeyeok', '설계내역서'], ['ilwi', '일위대가'], ['price', '자재·노임단가'], ['cost', '원가계산서'], ['est', '견적서'],
];

function Projects({ projects, cur, setCur, update, add, remove, importJson, exportJson, p }) {
  const [del, setDel] = useState(null);
  const fileRef = useRef(null);
  return (
    <div className="proj">
      <section className="panel">
        <div className="row-between">
          <h2>공사 목록</h2>
          <div className="grp">
            <button className="btn primary sm" onClick={() => add(blankProject())}>＋ 새 공사</button>
            <button className="btn sm" onClick={() => add(sampleProject())}>샘플 공사</button>
            <button className="btn sm ghost" onClick={() => fileRef.current?.click()}>파일 불러오기</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="grid list">
            <thead><tr><th>공사명</th><th className="w-g">공종</th><th>발주처</th><th className="w-price">설계금액</th><th className="w-date">작성일</th><th className="w-act"></th></tr></thead>
            <tbody>
              {projects.map((x) => (
                <tr key={x.id} className={x.id === cur ? 'sel' : ''} onClick={() => setCur(x.id)}>
                  <td><b>{x.name}</b>{x.sample && <span className="chip warn">샘플</span>}</td>
                  <td>{x.kind}</td><td>{x.client}</td>
                  <td className="r mono">{won(costSheet(x).grand)}</td>
                  <td className="mono">{x.date}</td>
                  <td className="w-act" onClick={(e) => e.stopPropagation()}>
                    {del === x.id ? (
                      <span className="confirm">삭제할까요?<button className="btn sm danger" onClick={() => { remove(x.id); setDel(null); }}>삭제</button><button className="btn sm ghost" onClick={() => setDel(null)}>취소</button></span>
                    ) : (
                      <span className="grp">
                        <button className="btn sm ghost" onClick={() => add({ ...JSON.parse(JSON.stringify(x)), id: uid(), name: x.name + ' (복사)', sample: false })}>복제</button>
                        <button className="btn sm ghost danger" onClick={() => setDel(x.id)}>삭제</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {p && (
        <section className="panel">
          <div className="row-between"><h2>공사 정보</h2><button className="btn sm ghost" onClick={exportJson}>공사 파일 백업 (.json)</button></div>
          <div className="form-grid">
            <label className="span2">공사명<TextInput id="p-name" value={p.name} onChange={(v) => update((d) => { d.name = v; d.sample = false; })} /></label>
            <label>공종
              <select id="p-kind" className="cell" value={p.kind} onChange={(e) => update((d) => { d.kind = e.target.value; })}>
                {['전기', '정보통신', '소방', '기계설비', '건축', '토목', '조경'].map((k) => <option key={k}>{k}</option>)}
              </select>
            </label>
            <label>작성일<input id="p-date" type="date" className="cell" value={p.date} onChange={(e) => update((d) => { d.date = e.target.value; })} /></label>
            <label className="span2">발주처<TextInput id="p-client" value={p.client} onChange={(v) => update((d) => { d.client = v; })} /></label>
            <label className="span2">공사장소<TextInput id="p-loc" value={p.location} onChange={(v) => update((d) => { d.location = v; })} /></label>
            <label className="span2">업체명 (견적서 공급자)<TextInput id="p-company" value={p.company} onChange={(v) => update((d) => { d.company = v; })} /></label>
            <label className="span2">사업자등록번호<TextInput id="p-biz" value={p.bizNo} onChange={(v) => update((d) => { d.bizNo = v; })} /></label>
          </div>
          <ol className="flow">
            <li><b>자재·노임단가</b> 조달청·물가정보·거래가격을 넣으면 최저가가 적용됩니다.</li>
            <li><b>일위대가</b> 자재 소요량과 품셈 인력품으로 단위당 단가를 만듭니다.</li>
            <li><b>설계내역서</b> 공종별로 일위대가·자재를 불러와 수량을 넣습니다.</li>
            <li><b>원가계산서</b> 제비율로 간접비·일반관리비·이윤·부가세를 계산하고 낙찰률을 적용합니다.</li>
            <li><b>견적서</b> 목표금액에 맞춰 공사비를 조정하고 엑셀로 저장합니다.</li>
          </ol>
        </section>
      )}
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState(null);
  const [cur, setCur] = useState(null);
  const [tab, setTab] = useState('naeyeok');
  const [mode, setMode] = useState('local');
  const [saveState, setSaveState] = useState('');
  const [msg, setMsg] = useState('');
  const [clip, setClip] = useState([]);
  const [printOpen, setPrintOpen] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const dirty = useRef(new Set());
  const listRef = useRef([]);

  const toast = useCallback((t) => { setMsg(t); clearTimeout(toast.t); toast.t = setTimeout(() => setMsg(''), 3200); }, []);

  useEffect(() => {
    let alive = true;
    loadAll().then(({ mode, list }) => {
      if (!alive) return;
      setMode(mode);
      const l = list && list.length ? list : [sampleProject()];
      l.sort((a, b) => (b.updated || 0) - (a.updated || 0));
      setProjects(l);
      setCur(l[0].id);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { listRef.current = projects || []; }, [projects]);

  useEffect(() => {
    if (!printJob) return;
    const done = () => setPrintJob(null);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 120);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printJob]);
  const openPrint = (docs) => {
    if (inArtifact()) return toast(`이 미리보기 창에서는 인쇄가 막혀 있습니다. ${LIVE_URL} 에서 출력하세요.`);
    setPrintOpen(docs || ['est', 'cost', 'sum', 'bill']);
  };

  useEffect(() => {
    if (!projects || !dirty.current.size) return;
    setSaveState('저장 중…');
    const t = setTimeout(async () => {
      const ids = [...dirty.current]; dirty.current.clear();
      let res = 'local';
      for (const id of ids) { const p = listRef.current.find((x) => x.id === id); if (p) res = await saveProject(p, listRef.current); }
      setSaveState(res.startsWith('error') ? '저장 실패' : res === 'cloud' ? '저장됨' : '이 브라우저에 저장됨');
    }, 900);
    return () => clearTimeout(t);
  }, [projects]);

  const p = useMemo(() => projects?.find((x) => x.id === cur), [projects, cur]);

  const update = useCallback((fn) => {
    setProjects((prev) => prev.map((x) => {
      if (x.id !== cur) return x;
      const d = structuredClone(x); fn(d); d.updated = Date.now();
      return d;
    }));
    dirty.current.add(cur);
  }, [cur]);

  const add = (np) => { np.updated = Date.now(); setProjects((prev) => [np, ...prev]); dirty.current.add(np.id); setCur(np.id); };
  const remove = (id) => {
    const rest = projects.filter((x) => x.id !== id);
    const next = rest.length ? rest : [blankProject()];
    setProjects(next);
    if (!rest.length) dirty.current.add(next[0].id);
    if (cur === id) setCur(next[0].id);
    deleteProject(id, next);
  };

  const download = async (name, data) => {
    const r = await saveFile(name, data);
    if (r === 'ok') toast(`${name} 파일을 내보냈습니다.`);
    else if (r === 'declined') toast('저장을 취소했습니다.');
    else toast('이 화면에서는 파일 저장을 쓸 수 없습니다.');
  };
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || '공사';

  const exportXlsx = async (kind) => {
    if (kind === 'design') return download(`${safeName(p.name)}_설계내역서.xlsx`, buildWorkbook(p, { title: '설계내역서' }));
    if (kind === 'contract') {
      const f = contractFit(p);
      return download(`${safeName(p.name)}_계약내역서.xlsx`, buildWorkbook({ ...p, roundUnit: 1 }, { title: '계약내역서', factor: f.factor, profitAdd: f.profitAdd }));
    }
    const r = estimateCalc(p);
    return download(`${safeName(p.name)}_견적서.xlsx`, buildWorkbook({ ...p, roundUnit: 1 }, { title: '견적내역서', factor: r.factor, profitAdd: r.profitAdd, estimate: { ...p.estimate, date: p.estimate.date || new Date().toISOString().slice(0, 10), amount: r.amount } }));
  };
  const exportJson = () => download(`${safeName(p.name)}.json`, JSON.stringify(p, null, 1));
  const importJson = async (f) => {
    try {
      const d = JSON.parse(await f.text());
      if (!d.sections || !d.rates) throw new Error();
      add({ ...d, id: uid() });
      toast(`‘${d.name}’ 공사를 불러왔습니다.`);
    } catch { toast('이 파일은 웹적산 공사 파일(.json)이 아닙니다.'); }
  };

  if (!projects) return <div className="loading">공사 목록을 불러오는 중…</div>;

  const cs = p ? costSheet(p) : null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">積</span>
          <div><b>웹적산</b><small>{p?.company || '㈜에스에스전력'}</small></div>
        </div>
        <div className="proj-pick">
          <select id="cur-proj" className="cell" value={cur || ''} onChange={(e) => setCur(e.target.value)} aria-label="공사 선택">
            {projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="total">
          <span>총 공사금액</span>
          <b className="mono">{cs ? won(cs.grand) : '—'}</b>
        </div>
        <button className="btn sm print-btn" onClick={() => openPrint()} disabled={!p}>출력</button>
        <span className={'save ' + (saveState === '저장 실패' ? 'bad' : '')}>{saveState || (mode === 'cloud' ? '내 계정에 저장' : '이 브라우저에 저장')}</span>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
        ))}
      </nav>

      {p?.sample && tab !== 'proj' && <div className="banner">샘플 공사입니다. 노임은 2026년 하반기 시중노임이고, 자재단가와 품은 화면 확인용 예시값입니다. 실제 공사는 ‘프로젝트’에서 새 공사를 만들고 ‘2026 표준대가’로 시작하세요.</div>}

      <main className="body">
        {tab === 'proj' && <Projects {...{ projects, cur, setCur, update, add, remove, importJson, exportJson, p }} />}
        {p && tab === 'naeyeok' && <Naeyeok key={p.id} p={p} update={update} clip={clip} setClip={setClip} toast={toast} />}
        {p && tab === 'ilwi' && <Ilwi key={p.id} p={p} update={update} toast={toast} />}
        {p && tab === 'price' && <Prices key={p.id} p={p} update={update} toast={toast} />}
        {p && tab === 'cost' && <Cost key={p.id} p={p} update={update} exportXlsx={exportXlsx} onPrint={() => openPrint(['cost', 'sum', 'bill'])} />}
        {p && tab === 'est' && <Estimate key={p.id} p={p} update={update} exportXlsx={exportXlsx} onPrint={() => openPrint(['est'])} />}
      </main>

      {msg && <div className="toast" role="status">{msg}</div>}
      {printOpen && p && <PrintDialog p={p} initial={printOpen} onClose={() => setPrintOpen(null)} onPrint={(job) => { setPrintOpen(null); setPrintJob(job); }} />}
      {p && <PrintArea p={p} job={printJob} />}
    </div>
  );
}
