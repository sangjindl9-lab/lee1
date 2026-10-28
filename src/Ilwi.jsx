import { useState } from 'react';
import { unitCost, won, matPrice } from './calc.js';
import { uid } from './seed.js';
import { NumInput, TextInput } from './ui.jsx';
import StdLibrary, { planStdUnits } from './StdLibrary.jsx';

export default function Ilwi({ p, update, toast }) {
  const [uidSel, setUidSel] = useState(p.units[0]?.id);
  const [q, setQ] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [lib, setLib] = useState(false);
  const u = p.units.find((x) => x.id === uidSel) || p.units[0];
  const usage = (id) => p.sections.reduce((a, s) => a + s.items.filter((i) => i.src === 'unit' && i.ref === id).length, 0);

  const addUnit = (copyFrom) => {
    const id = uid();
    update((d) => {
      const base = copyFrom ? JSON.parse(JSON.stringify(copyFrom)) : { name: '새 일위대가', spec: '', unit: 'EA', toolRate: 3, items: [] };
      d.units.push({ ...base, id, code: `제${d.units.length + 1}호표`, name: copyFrom ? base.name + ' (복사)' : base.name, items: base.items.map((i) => ({ ...i, id: uid() })) });
    });
    setUidSel(id);
  };
  const upU = (fn) => update((d) => fn(d.units.find((x) => x.id === u.id)));
  const upLine = (lid, patch) => upU((x) => Object.assign(x.items.find((i) => i.id === lid), patch));

  const list = p.units.filter((x) => (x.code + x.name + x.spec).includes(q));

  return (
    <div className="split">
      <aside className="side">
        <div className="side-head"><span className="eyebrow">일위대가 목록</span><span className="grp"><button className="btn sm primary" onClick={() => setLib(true)}>＋ 표준대가</button><button className="btn sm" onClick={() => addUnit(null)}>＋ 새로</button></span></div>
        <input id="unit-search" className="search sm" placeholder="호표·명칭 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="side-list">
          {list.map((x) => (
            <li key={x.id} className={x.id === u?.id ? 'on' : ''} onClick={() => { setUidSel(x.id); setConfirmDel(false); }}>
              <span className="nm"><span className="mono code">{x.code}</span> {x.name}<small>{x.spec}{x.std && <span className={'tag ' + (x.std.src === 'comm' ? 'mat' : '')}>{x.std.src === 'comm' ? '통신' : '전기'} 표준</span>}</small></span>
              <span className="mono amt">{won(unitCost(p, x).total)}</span>
            </li>
          ))}
          {!list.length && <li className="empty">일위대가가 없습니다.</li>}
        </ul>
      </aside>

      <section className="main">
        {!u ? (
          <div className="panel empty">‘＋ 새로’를 눌러 첫 일위대가(호표)를 만드세요. 자재·노무·경비를 조합해 단위당 단가를 만듭니다.</div>
        ) : (() => {
          const c = unitCost(p, u);
          const used = usage(u.id);
          return (
            <>
              {u.std && <p className="note">{u.std.period} {u.std.src === 'comm' ? '정보통신' : '전기'}공사 표준시장단가 {u.std.code} · 적용단가 {won(u.std.price)}원 · 노무비율 {u.std.rate}%. 단가에 재료비·기계경비·공구손료가 포함되어 있어 공구손료는 0%로 둡니다.</p>}
              <div className="form-grid">
                <label>호표<TextInput id="u-code" value={u.code} onChange={(v) => upU((x) => { x.code = v; })} /></label>
                <label className="span2">명칭<TextInput id="u-name" value={u.name} onChange={(v) => upU((x) => { x.name = v; })} /></label>
                <label>규격<TextInput id="u-spec" value={u.spec} onChange={(v) => upU((x) => { x.spec = v; })} /></label>
                <label>단위<TextInput id="u-unit" value={u.unit} onChange={(v) => upU((x) => { x.unit = v; })} /></label>
                <label>공구손료 (노무비 %)<NumInput id="u-tool" dec={2} value={u.toolRate} onChange={(v) => upU((x) => { x.toolRate = v; })} /></label>
              </div>

              <div className="toolbar">
                <div className="grp">
                  <button className="btn primary sm" onClick={() => upU((x) => x.items.push({ id: uid(), kind: '자재', ref: p.mats[0]?.id || null, qty: 1 }))} disabled={!p.mats.length}>＋ 자재</button>
                  <button className="btn primary sm" onClick={() => upU((x) => x.items.push({ id: uid(), kind: '노무', ref: p.labors[0]?.id || null, qty: 0.1 }))} disabled={!p.labors.length}>＋ 노무</button>
                  <button className="btn sm" onClick={() => upU((x) => x.items.push({ id: uid(), kind: '경비', name: '', spec: '', unit: '식', qty: 1, price: 0 }))}>＋ 경비</button>
                </div>
                <div className="grp">
                  <button className="btn sm" onClick={() => addUnit(u)}>복제</button>
                  {!confirmDel ? (
                    <button className="btn sm ghost danger" onClick={() => setConfirmDel(true)}>삭제</button>
                  ) : (
                    <span className="confirm">{used ? `내역 ${used}곳에서 사용 중. ` : ''}삭제할까요?
                      <button className="btn sm danger" onClick={() => { update((d) => { d.units = d.units.filter((x) => x.id !== u.id); }); setConfirmDel(false); toast('일위대가를 삭제했습니다.'); }}>삭제</button>
                      <button className="btn sm ghost" onClick={() => setConfirmDel(false)}>취소</button></span>
                  )}
                </div>
              </div>

              <div className="tbl-wrap">
                <table className="grid">
                  <thead><tr><th className="w-kind">구분</th><th className="w-name">품명</th><th className="w-spec">규격</th><th className="w-unit">단위</th><th className="w-qty">수량</th><th className="w-price">단가</th><th className="w-price">금액</th><th className="w-x"></th></tr></thead>
                  <tbody>
                    {c.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="w-kind"><span className={'kind k-' + l.kind}>{l.kind}</span></td>
                        {l.kind !== '경비' && !l.ref && (
                          <>
                            <td className="w-name"><TextInput value={l.name} onChange={(v) => upLine(l.id, { name: v })} aria-label="품명" /></td>
                            <td className="w-spec"><TextInput value={l.spec} onChange={(v) => upLine(l.id, { spec: v })} aria-label="규격" /></td>
                            <td className="w-unit"><TextInput className="c" value={l.unit} onChange={(v) => upLine(l.id, { unit: v })} aria-label="단위" /></td>
                          </>
                        )}
                        {l.kind === '자재' && l.ref && (
                          <td className="w-name" colSpan={3}>
                            <select className="cell" value={l.ref || ''} onChange={(e) => upLine(l.id, { ref: e.target.value })} aria-label="자재 선택">
                              {p.mats.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.spec} ({m.unit}) — {won(matPrice(m))}</option>)}
                            </select>
                          </td>
                        )}
                        {l.kind === '노무' && l.ref && (
                          <td className="w-name" colSpan={3}>
                            <select className="cell" value={l.ref || ''} onChange={(e) => upLine(l.id, { ref: e.target.value })} aria-label="직종 선택">
                              {p.labors.map((m) => <option key={m.id} value={m.id}>{m.name} — {won(m.wage)}원/인</option>)}
                            </select>
                          </td>
                        )}
                        {l.kind === '경비' && (
                          <>
                            <td className="w-name"><TextInput value={l.name} placeholder="운반비, 장비사용료 등" onChange={(v) => upLine(l.id, { name: v })} aria-label="경비 품명" /></td>
                            <td className="w-spec"><TextInput value={l.spec} onChange={(v) => upLine(l.id, { spec: v })} aria-label="규격" /></td>
                            <td className="w-unit"><TextInput className="c" value={l.unit} onChange={(v) => upLine(l.id, { unit: v })} aria-label="단위" /></td>
                          </>
                        )}
                        <td className="w-qty"><NumInput dec={5} value={l.qty} onChange={(v) => upLine(l.id, { qty: v })} aria-label="수량" /></td>
                        {(l.kind === '경비' || !l.ref) ? <td><NumInput value={l.price} onChange={(v) => upLine(l.id, { price: v })} aria-label="단가" /></td> : <td className="r mono">{won(l.price)}</td>}
                        <td className="r mono">{won(l.amt)}</td>
                        <td className="w-x"><button className="x-btn" aria-label="행 삭제" onClick={() => upU((x) => { x.items = x.items.filter((i) => i.id !== l.id); })}>×</button></td>
                      </tr>
                    ))}
                    {c.tool > 0 && <tr className="auto"><td><span className="kind k-경비">경비</span></td><td>공구손료</td><td>노무비의 {u.toolRate}%</td><td className="c">식</td><td className="r mono">1</td><td className="r mono">{won(c.tool)}</td><td className="r mono">{won(c.tool)}</td><td></td></tr>}
                    {!c.lines.length && <tr><td colSpan={8} className="empty">＋ 자재 / ＋ 노무 / ＋ 경비로 구성 품목을 넣으세요. 수량에는 할증을 포함한 소요량과 품셈의 인력품(인)을 입력합니다.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="unit-sum">
                <div><span>재료비</span><b className="mono">{won(c.m)}</b></div>
                <div><span>노무비</span><b className="mono">{won(c.l)}</b></div>
                <div><span>경비</span><b className="mono">{won(c.e)}</b></div>
                <div className="tot"><span>{u.unit}당 합계</span><b className="mono">{won(c.total)}</b></div>
              </div>
              <p className="muted small">내역서 {used}곳에서 이 일위대가를 사용 중입니다. 여기서 바꾼 단가는 내역서·원가계산서·견적서에 바로 반영됩니다.</p>
            </>
          );
        })()}
      </section>
      {lib && (
        <StdLibrary onClose={() => setLib(false)} actionLabel="일위대가로 추가"
          existing={p.units.filter((x) => x.std).map((x) => x.std.code)}
          onPick={(picks) => { const { ids, fresh } = planStdUnits(p, picks); update((d) => { fresh.forEach((u) => d.units.push(structuredClone(u))); }); setUidSel(ids[ids.length - 1]); toast(fresh.length ? `표준대가 ${fresh.length}개를 일위대가에 넣었습니다.` : '선택한 표준대가는 이미 일위대가에 있습니다.'); }} />
      )}
    </div>
  );
}
