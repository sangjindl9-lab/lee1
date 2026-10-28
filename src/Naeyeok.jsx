import { useState, useMemo } from 'react';
import { itemRow, won, unitCost, matPrice, sectionTotals, costSheet, splitTotal } from './calc.js';
import { uid } from './seed.js';
import { NumInput, TextInput, Modal, PasteBox, num } from './ui.jsx';
import StdLibrary, { planStdUnits } from './StdLibrary.jsx';

function Picker({ p, kind, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState([]);
  const list = kind === 'unit'
    ? p.units.map((u) => { const c = unitCost(p, u); return { id: u.id, code: u.code, name: u.name, spec: u.spec, unit: u.unit, price: c.total }; })
    : p.mats.map((m) => ({ id: m.id, code: m.code, name: m.name, spec: m.spec, unit: m.unit, price: matPrice(m) }));
  const f = list.filter((x) => (x.code + x.name + x.spec).toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Modal title={kind === 'unit' ? '일위대가에서 추가' : '자재단가에서 추가'} onClose={onClose} wide>
      <input id="picker-search" className="search" autoFocus placeholder="호표·품명·규격 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tbl-wrap picker">
        <table className="grid">
          <thead><tr><th className="w-chk"></th><th>{kind === 'unit' ? '호표' : '코드'}</th><th>품명</th><th>규격</th><th>단위</th><th className="r">단가</th></tr></thead>
          <tbody>
            {f.map((x) => (
              <tr key={x.id} className={sel.includes(x.id) ? 'sel' : ''} onClick={() => toggle(x.id)}>
                <td className="w-chk"><input type="checkbox" readOnly checked={sel.includes(x.id)} aria-label="선택" /></td>
                <td className="mono">{x.code}</td><td>{x.name}</td><td>{x.spec}</td><td>{x.unit}</td><td className="r mono">{won(x.price)}</td>
              </tr>
            ))}
            {!f.length && <tr><td colSpan={6} className="empty">{list.length ? '검색 결과가 없습니다.' : (kind === 'unit' ? '일위대가 탭에서 먼저 일위대가를 만드세요.' : '단가 탭에서 먼저 자재를 등록하세요.')}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row-between">
        <span className="muted">{sel.length}개 선택</span>
        <button className="btn primary" disabled={!sel.length} onClick={() => { onPick(sel); onClose(); }}>내역에 추가</button>
      </div>
    </Modal>
  );
}

function AdjustPanel({ p, update, sec, checked, toast, onClose }) {
  const [scope, setScope] = useState(checked.length ? 'sel' : 'sec');
  const [rate, setRate] = useState({ m: 100, l: 100, e: 100 });
  const [target, setTarget] = useState(0);
  const cs = useMemo(() => costSheet(p), [p]);

  const targets = () => {
    if (scope === 'sel') return sec.items.filter((x) => checked.includes(x.id)).map((x) => [sec.id, x.id]);
    const ss = scope === 'sec' ? [sec] : p.sections;
    return ss.flatMap((s) => s.items.map((x) => [s.id, x.id]));
  };
  const tgt = targets();
  const tset = new Set(tgt.map((t) => t[1]));
  const sumOf = (pp) => pp.sections.reduce((a, s) => a + s.items.filter((x) => tset.has(x.id)).reduce((b, x) => b + itemRow(pp, x).amt, 0), 0);
  const curSum = sumOf(p);
  const scopeLabel = { sel: `선택한 ${checked.length}개 행`, sec: `‘${sec.name}’ 공종`, all: '전체 공종' }[scope];
  const each = (d, fn) => d.sections.forEach((s) => s.items.forEach((x) => { if (tset.has(x.id)) fn(x); }));

  const applyRate = () => {
    if (!tgt.length) return toast('조정할 행이 없습니다. 대상을 확인하세요.');
    update((d) => each(d, (x) => { x.adj = { m: num(rate.m), l: num(rate.l), e: num(rate.e) }; delete x.fix; }));
    toast(`${scopeLabel}에 재료비 ${num(rate.m)}%, 노무비 ${num(rate.l)}%, 경비 ${num(rate.e)}%를 적용했습니다.`);
  };
  const fitTarget = () => {
    const T = Math.floor(num(target));
    if (!tgt.length) return toast('조정할 행이 없습니다. 대상을 확인하세요.');
    if (!(T > 0)) return toast('목표 금액을 입력하세요.');
    const draft = structuredClone(p);
    each(draft, (x) => { delete x.fix; delete x.adj; });
    const base = sumOf(draft);
    if (!(base > 0)) return toast('대상 행의 금액이 0원이라 비율로 맞출 수 없습니다.');
    let lo = 0, hi = Math.max(2, (T / base) * 2);
    const setK = (k) => each(draft, (x) => { x.adj = { m: k * 100, l: k * 100, e: k * 100 }; });
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; setK(mid); if (sumOf(draft) <= T) lo = mid; else hi = mid; }
    const k = Math.round(lo * 1e8) / 1e8;
    setK(k);
    let rest = T - sumOf(draft);
    let pick = null, best = -1;
    each(draft, (x) => { const r = itemRow(draft, x); if (r.amt > best) { best = r.amt; pick = x.id; } });
    update((d) => {
      each(d, (x) => { delete x.fix; x.adj = { m: k * 100, l: k * 100, e: k * 100 }; });
      if (rest && pick) {
        each(d, (x) => {
          if (x.id !== pick) return;
          const r = itemRow(d, x);
          const comp = ['m', 'l', 'e'].sort((a, b) => r['a' + b] - r['a' + a])[0];
          x.fix = { [comp]: r['a' + comp] + rest };
        });
      }
    });
    toast(`${scopeLabel}을 ${won(T)}원에 맞췄습니다 (조정률 ${(k * 100).toFixed(4)}%${rest ? `, 끝수 ${won(rest)}원은 가장 큰 행에 반영` : ''}).`);
  };
  const reset = () => {
    update((d) => each(d, (x) => { delete x.adj; delete x.fix; }));
    toast(`${scopeLabel}의 요율·금액 조정을 모두 해제했습니다.`);
  };
  const upRate = (key, patch) => update((d) => Object.assign(d.rates.find((r) => r.key === key), patch));

  return (
    <div className="adj-panel">
      <div className="row-between">
        <h3>요율·금액 조정</h3>
        <button className="btn sm ghost" onClick={onClose}>닫기</button>
      </div>
      <div className="adj-grid">
        <section>
          <div className="seg full">
            {[['sel', `선택 행 ${checked.length}`], ['sec', '현재 공종'], ['all', '전체']].map(([k, t]) => (
              <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)} disabled={k === 'sel' && !checked.length}>{t}</button>
            ))}
          </div>
          <p className="muted small">대상: {scopeLabel} · 현재 직접공사비 <b className="mono">{won(curSum)}</b>원</p>
          <div className="adj-rates">
            {[['m', '재료비'], ['l', '노무비'], ['e', '경비']].map(([k, t]) => (
              <label key={k} className="fld">{t} 단가 (%)<NumInput id={'adj-' + k} dec={4} value={rate[k]} onChange={(v) => setRate((r) => ({ ...r, [k]: v }))} /></label>
            ))}
          </div>
          <div className="grp">
            <button className="btn sm primary" onClick={applyRate}>요율 적용</button>
            <button className="btn sm ghost" onClick={reset}>조정 해제</button>
          </div>
          <label className="fld adj-target">목표 금액 (대상 직접공사비)
            <span className="grp"><NumInput id="adj-target" value={target} onChange={setTarget} placeholder="예: 45,000,000" /><button className="btn sm" onClick={fitTarget}>금액 맞추기</button></span>
          </label>
          <p className="muted small">요율은 단가에 곱하고 원 미만은 버립니다. 금액 맞추기는 같은 비율을 곱한 뒤 남는 끝수를 가장 큰 행에 넣습니다. 행마다 금액 칸을 눌러 직접 고칠 수도 있습니다.</p>
        </section>
        <section>
          <div className="row-between"><b className="small">원가 제비율</b><span className="small muted">총 공사금액 <b className="mono total-inline">{won(cs.grand)}</b>원</span></div>
          <div className="rates-wrap"><table className="rates">
            <tbody>
              {p.rates.map((r) => (
                <tr key={r.key} className={r.on ? '' : 'off'}>
                  <td><input type="checkbox" id={'nrate-' + r.key} checked={r.on} onChange={(e) => upRate(r.key, { on: e.target.checked })} /></td>
                  <td><label htmlFor={'nrate-' + r.key}>{r.label}</label></td>
                  <td className="w-rate"><NumInput dec={4} value={r.rate} onChange={(v) => upRate(r.key, { rate: v })} aria-label={r.label + ' 요율'} /></td>
                  <td className="pct">%</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      </div>
    </div>
  );
}

export default function Naeyeok({ p, update, clip, setClip, toast }) {
  const [secId, setSecId] = useState(p.sections[0]?.id);
  const [checked, setChecked] = useState([]);
  const [modal, setModal] = useState(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const sec = p.sections.find((s) => s.id === secId) || p.sections[0];
  const totals = useMemo(() => sectionTotals(p), [p]);
  const grandDirect = totals.reduce((a, s) => a + s.sum, 0);
  const secTot = totals.find((t) => t.section.id === sec?.id);

  const upSec = (fn) => update((d) => { const s = d.sections.find((x) => x.id === sec.id); fn(s, d); });
  const upItem = (id, patch) => upSec((s) => { const it = s.items.find((x) => x.id === id); Object.assign(it, patch); });
  const newItem = (o = {}) => ({ id: uid(), src: 'manual', ref: null, name: '', spec: '', unit: '식', qty: 1, m: 0, l: 0, e: 0, note: '', ...o });

  const addSection = () => { const id = uid(); update((d) => { d.sections.push({ id, name: `${d.sections.length + 1}. 새 공종`, items: [] }); }); setSecId(id); };
  const delSection = () => {
    if (p.sections.length <= 1) return toast('공종은 하나 이상 있어야 합니다.');
    update((d) => { d.sections = d.sections.filter((x) => x.id !== sec.id); });
    setSecId(p.sections.find((s) => s.id !== sec.id)?.id);
  };
  const moveSection = (dir) => update((d) => {
    const i = d.sections.findIndex((x) => x.id === sec.id), j = i + dir;
    if (j < 0 || j >= d.sections.length) return;
    [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]];
  });

  const sel = sec ? sec.items.filter((x) => checked.includes(x.id)) : [];
  const doCopy = (cut) => {
    if (!sel.length) return toast('복사할 행을 먼저 체크하세요.');
    setClip(sel.map((x) => ({ ...x })));
    if (cut) upSec((s) => { s.items = s.items.filter((x) => !checked.includes(x.id)); });
    setChecked([]);
    toast(`${sel.length}개 행을 ${cut ? '잘라냈습니다' : '복사했습니다'}. 원하는 공종에서 붙여넣기를 누르세요.`);
  };
  const doPaste = () => {
    if (!clip?.length) return toast('붙여넣을 행이 없습니다. 먼저 행을 복사하세요.');
    upSec((s) => {
      const copies = clip.map((x) => ({ ...x, id: uid() }));
      const lastSel = s.items.map((x) => x.id).filter((id) => checked.includes(id)).pop();
      const at = lastSel ? s.items.findIndex((x) => x.id === lastSel) + 1 : s.items.length;
      s.items.splice(at, 0, ...copies);
    });
    toast(`${clip.length}개 행을 붙여넣었습니다.`);
  };
  const doDelete = () => { if (!sel.length) return; upSec((s) => { s.items = s.items.filter((x) => !checked.includes(x.id)); }); setChecked([]); };
  const doMove = (dir) => upSec((s) => {
    const idx = s.items.map((x, i) => (checked.includes(x.id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    const order = dir < 0 ? idx : idx.reverse();
    for (const i of order) { const j = i + dir; if (j < 0 || j >= s.items.length || checked.includes(s.items[j].id)) continue; [s.items[i], s.items[j]] = [s.items[j], s.items[i]]; }
  });
  const unlink = (it) => { const r = itemRow(p, it); upItem(it.id, { src: 'manual', ref: null, name: r.name, spec: r.spec, unit: r.unit, m: r.m, l: r.l, e: r.e }); };
  const dropFix = (fix, k) => { if (!fix) return undefined; const n = { ...fix }; delete n[k]; return Object.keys(n).length ? n : undefined; };
  const setAmt = (it, k, v, cur) => { if (Math.floor(num(v)) === cur) return; upItem(it.id, { fix: { ...(it.fix || {}), [k]: Math.floor(num(v)) } }); };
  const setTotal = (it, r, v) => { const T = Math.floor(num(v)); if (T === r.amt) return; upItem(it.id, { fix: splitTotal(r, T) }); };
  const allChecked = sec && sec.items.length > 0 && sec.items.every((x) => checked.includes(x.id));

  if (!sec) return <div className="panel empty">공종이 없습니다. <button className="btn" onClick={addSection}>공종 추가</button></div>;

  return (
    <div className="split">
      <aside className="side">
        <div className="side-head"><span className="eyebrow">공종</span><button className="btn sm" onClick={addSection}>＋ 추가</button></div>
        <ul className="side-list">
          {totals.map((t) => (
            <li key={t.section.id} className={t.section.id === sec.id ? 'on' : ''} onClick={() => { setSecId(t.section.id); setChecked([]); }}>
              <span className="nm">{t.section.name}</span><span className="mono amt">{won(t.sum)}</span>
            </li>
          ))}
        </ul>
        <div className="side-foot"><span>직접공사비 계</span><b className="mono">{won(grandDirect)}</b></div>
      </aside>

      <section className="main">
        <div className="sec-head">
          <TextInput id="sec-name" className="title-input" value={sec.name} onChange={(v) => upSec((s) => { s.name = v; })} aria-label="공종명" />
          <div className="btns">
            <button className="btn sm ghost" onClick={() => moveSection(-1)} title="공종 위로">▲</button>
            <button className="btn sm ghost" onClick={() => moveSection(1)} title="공종 아래로">▼</button>
            <button className="btn sm ghost danger" onClick={delSection}>공종 삭제</button>
          </div>
        </div>

        <div className="toolbar">
          <div className="grp">
            <button className="btn primary sm" onClick={() => setModal('std')}>＋ 2026 표준대가</button>
            <button className="btn sm" onClick={() => setModal('unit')}>＋ 일위대가</button>
            <button className="btn sm" onClick={() => setModal('mat')}>＋ 자재</button>
            <button className="btn sm" onClick={() => upSec((s) => s.items.push(newItem()))}>＋ 직접입력</button>
            <button className="btn sm" onClick={() => setModal('paste')}>엑셀 붙여넣기</button>
            <button className={'btn sm' + (adjOpen ? ' primary' : '')} onClick={() => setAdjOpen(!adjOpen)}>요율·금액 조정</button>
          </div>
          <div className="grp">
            <button className="btn sm" onClick={() => doCopy(false)}>복사</button>
            <button className="btn sm" onClick={() => doCopy(true)}>잘라내기</button>
            <button className="btn sm" onClick={doPaste} disabled={!clip?.length}>붙여넣기{clip?.length ? ` (${clip.length})` : ''}</button>
            <button className="btn sm ghost" onClick={() => doMove(-1)} title="선택 행 위로">▲</button>
            <button className="btn sm ghost" onClick={() => doMove(1)} title="선택 행 아래로">▼</button>
            <button className="btn sm ghost danger" onClick={doDelete} disabled={!sel.length}>삭제</button>
          </div>
        </div>

        {adjOpen && <AdjustPanel p={p} update={update} sec={sec} checked={checked} toast={toast} onClose={() => setAdjOpen(false)} />}

        <div className="tbl-wrap">
          <table className="grid naeyeok">
            <thead>
              <tr>
                <th rowSpan={2} className="w-chk"><input type="checkbox" aria-label="전체 선택" checked={allChecked} onChange={() => setChecked(allChecked ? [] : sec.items.map((x) => x.id))} /></th>
                <th rowSpan={2} className="w-name">품명</th><th rowSpan={2} className="w-spec">규격</th><th rowSpan={2} className="w-unit">단위</th><th rowSpan={2} className="w-qty">수량</th>
                <th colSpan={2}>재료비</th><th colSpan={2}>노무비</th><th colSpan={2}>경비</th><th colSpan={2}>합계</th>
                <th rowSpan={2} className="w-note">비고</th>
              </tr>
              <tr><th>단가</th><th>금액</th><th>단가</th><th>금액</th><th>단가</th><th>금액</th><th>단가</th><th>금액</th></tr>
            </thead>
            <tbody>
              {sec.items.map((it, i) => {
                const r = secTot.rows[i];
                const linked = it.src !== 'manual';
                return (
                  <tr key={it.id} className={checked.includes(it.id) ? 'sel' : ''}>
                    <td className="w-chk"><input type="checkbox" aria-label="행 선택" checked={checked.includes(it.id)} onChange={() => setChecked((c) => (c.includes(it.id) ? c.filter((x) => x !== it.id) : [...c, it.id]))} /></td>
                    {linked ? (
                      <>
                        <td className="w-name"><span className={'tag ' + it.src}>{r.link || (it.src === 'unit' ? '일위' : '자재')}</span>{r.name}
                          <button className="link-btn" title="연결을 끊고 직접 수정" onClick={() => unlink(it)}>수정</button></td>
                        <td className="w-spec">{r.spec}</td><td className="w-unit c">{r.unit}</td>
                      </>
                    ) : (
                      <>
                        <td className="w-name"><TextInput value={it.name} onChange={(v) => upItem(it.id, { name: v })} placeholder="품명" aria-label="품명" /></td>
                        <td className="w-spec"><TextInput value={it.spec} onChange={(v) => upItem(it.id, { spec: v })} aria-label="규격" /></td>
                        <td className="w-unit"><TextInput className="c" value={it.unit} onChange={(v) => upItem(it.id, { unit: v })} aria-label="단위" /></td>
                      </>
                    )}
                    <td className="w-qty"><NumInput dec={4} value={it.qty} onChange={(v) => upItem(it.id, { qty: v, fix: undefined })} aria-label="수량" /></td>
                    {['m', 'l', 'e'].map((k) => {
                      const u = r['u' + k], a = r['a' + k], label = { m: '재료비', l: '노무비', e: '경비' }[k];
                      const adjK = it.adj && it.adj[k] != null && Number(it.adj[k]) !== 100;
                      return [
                        (linked || r.fixed[k] || adjK)
                          ? <td key={k + 'u'} className={'r mono' + (adjK ? ' adj' : '')} title={adjK ? `단가 ${Number(it.adj[k]).toFixed(2)}% 적용` : ''}>{won(u)}</td>
                          : <td key={k + 'u'}><NumInput value={it[k]} onChange={(v) => upItem(it.id, { [k]: v, fix: dropFix(it.fix, k) })} aria-label={label + ' 단가'} /></td>,
                        <td key={k + 'a'} className={r.fixed[k] ? 'fixed' : ''}><NumInput value={a} onChange={(v) => setAmt(it, k, v, a)} aria-label={label + ' 금액'} title="금액을 직접 입력하면 이 값으로 고정됩니다" /></td>,
                      ];
                    })}
                    <td className="r mono">{won(r.up)}</td>
                    <td className={'strong' + (r.fixed.m || r.fixed.l || r.fixed.e ? ' fixed' : '')}><NumInput className="strong" value={r.amt} onChange={(v) => setTotal(it, r, v)} aria-label="합계 금액" /></td>
                    <td className="w-note"><span className="note-cell"><TextInput value={it.note} onChange={(v) => upItem(it.id, { note: v })} aria-label="비고" />{(it.fix || r.adjusted) && <button className="x-btn undo" title="이 행의 요율·금액 조정 해제" aria-label="조정 해제" onClick={() => upItem(it.id, { fix: undefined, adj: undefined })}>↺</button>}</span></td>
                  </tr>
                );
              })}
              {!sec.items.length && <tr><td colSpan={14} className="empty">이 공종에 내역이 없습니다. 위의 ＋ 버튼으로 일위대가·자재를 넣거나 엑셀에서 붙여넣으세요.</td></tr>}
            </tbody>
            <tfoot>
              <tr><td colSpan={5} className="c">[ 소 계 ]</td><td></td><td className="r mono">{won(secTot.m)}</td><td></td><td className="r mono">{won(secTot.l)}</td><td></td><td className="r mono">{won(secTot.e)}</td><td></td><td className="r mono strong">{won(secTot.sum)}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small">금액 칸을 눌러 원하는 금액을 넣으면 그 금액으로 고정됩니다(색 표시). 수량을 바꾸면 고정이 풀리고, 행 끝 ↺로 조정을 해제할 수 있습니다. 일위대가·자재와 연결된 행은 품명 옆 ‘수정’으로 연결을 끊고 단가를 직접 고칩니다.</p>
      </section>

      {(modal === 'unit' || modal === 'mat') && (
        <Picker p={p} kind={modal} onClose={() => setModal(null)}
          onPick={(ids) => upSec((s) => ids.forEach((id) => s.items.push(newItem({ src: modal, ref: id, name: '', unit: '', qty: 1 }))))} />
      )}
      {modal === 'std' && (
        <StdLibrary onClose={() => setModal(null)} actionLabel="내역에 추가"
          existing={p.units.filter((x) => x.std).map((x) => x.std.code)}
          onPick={(picks) => {
            const { ids, fresh } = planStdUnits(p, picks);
            const items = ids.map((id) => newItem({ src: 'unit', ref: id, name: '', unit: '', qty: 1 }));
            update((d) => { fresh.forEach((u) => d.units.push(structuredClone(u))); d.sections.find((x) => x.id === sec.id).items.push(...structuredClone(items)); });
            toast(`표준대가 ${picks.length}개를 ‘${sec.name}’에 넣었습니다. 수량을 입력하세요.`);
          }} />
      )}
      {modal === 'paste' && (
        <PasteBox onClose={() => setModal(null)}
          hint="엑셀 내역서에서 행을 선택해 복사(Ctrl+C)한 뒤 아래에 붙여넣으면 현재 공종 끝에 추가됩니다. 단가가 없는 열은 비워 두면 됩니다."
          columns={['품명', '규격', '단위', '수량', '재료비 단가', '노무비 단가', '경비 단가', '비고']}
          onApply={(rows) => upSec((s) => rows.forEach((c) => s.items.push(newItem({ name: c[0] || '', spec: c[1] || '', unit: c[2] || '', qty: num(c[3]), m: num(c[4]), l: num(c[5]), e: num(c[6]), note: c[7] || '' }))))} />
      )}
    </div>
  );
}
