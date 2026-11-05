import { useState, useMemo } from 'react';
import { itemRow, won, unitCost, matPrice, sectionTotals, splitTotal } from './calc.js';
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

export default function Naeyeok({ p, update, clip, setClip, toast }) {
  const [secId, setSecId] = useState(p.sections[0]?.id);
  const [checked, setChecked] = useState([]);
  const [modal, setModal] = useState(null);
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
        <p className="muted small">금액 칸을 눌러 원하는 금액을 넣으면 그 금액으로 고정됩니다(색 표시). 공사 전체 단가 조정·할인·목표금액은 원가계산서 탭의 ‘금액 조정’에서 합니다. 수량을 바꾸면 고정이 풀리고, 행 끝 ↺로 조정을 해제할 수 있습니다. 일위대가·자재와 연결된 행은 품명 옆 ‘수정’으로 연결을 끊고 단가를 직접 고칩니다.</p>
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
