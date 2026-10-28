import { useState } from 'react';
import { matPrice, won } from './calc.js';
import { uid } from './seed.js';
import { NumInput, TextInput, PasteBox, num } from './ui.jsx';
import { WAGES_2026H2 } from './stdlib.js';

export default function Prices({ p, update, toast }) {
  const [sub, setSub] = useState('mat');
  const [q, setQ] = useState('');
  const [pct, setPct] = useState(0);
  const [paste, setPaste] = useState(false);

  const upMat = (id, patch) => update((d) => Object.assign(d.mats.find((x) => x.id === id), patch));
  const upLab = (id, patch) => update((d) => Object.assign(d.labors.find((x) => x.id === id), patch));
  const used = (id) => p.units.some((u) => u.items.some((i) => i.ref === id)) || p.sections.some((s) => s.items.some((i) => i.ref === id));

  const applyPct = () => {
    const f = 1 + num(pct) / 100;
    if (!num(pct)) return;
    update((d) => {
      if (sub === 'mat') d.mats.forEach((m) => { ['p1', 'p2', 'p3', 'applied'].forEach((k) => { if (m[k] > 0) m[k] = Math.floor(m[k] * f); }); });
      else d.labors.forEach((l) => { l.wage = Math.floor(num(l.wage) * f); });
    });
    toast(`${sub === 'mat' ? '자재단가' : '노임단가'}를 ${num(pct) > 0 ? '+' : ''}${num(pct)}% 조정했습니다.`);
    setPct(0);
  };

  const mats = p.mats.filter((m) => (m.code + m.name + m.spec).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={sub === 'mat'} className={sub === 'mat' ? 'on' : ''} onClick={() => setSub('mat')}>자재단가 <span className="cnt">{p.mats.length}</span></button>
          <button role="tab" aria-selected={sub === 'lab'} className={sub === 'lab' ? 'on' : ''} onClick={() => setSub('lab')}>노임단가 <span className="cnt">{p.labors.length}</span></button>
        </div>
        <div className="grp">
          <span className="muted small">일괄 조정</span>
          <NumInput id="pct" dec={2} className="w80" value={pct} onChange={setPct} aria-label="조정 퍼센트" />
          <span className="muted small">%</span>
          <button className="btn sm" onClick={applyPct}>적용</button>
        </div>
      </div>

      {sub === 'mat' ? (
        <>
          <div className="toolbar">
            <div className="grp">
              <button className="btn primary sm" onClick={() => update((d) => d.mats.push({ id: uid(), code: `M${String(d.mats.length + 1).padStart(2, '0')}`, name: '', spec: '', unit: 'EA', p1: 0, p2: 0, p3: 0, applied: 0 }))}>＋ 자재</button>
              <button className="btn sm" onClick={() => setPaste(true)}>엑셀 붙여넣기</button>
            </div>
            <input id="mat-search" className="search sm" placeholder="품명·규격 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="tbl-wrap">
            <table className="grid">
              <thead><tr><th className="w-code">코드</th><th className="w-name">품명</th><th className="w-spec">규격</th><th className="w-unit">단위</th><th className="w-price">조달청</th><th className="w-price">물가정보</th><th className="w-price">거래가격</th><th className="w-price">지정단가</th><th className="w-price">적용단가</th><th className="w-x"></th></tr></thead>
              <tbody>
                {mats.map((m) => {
                  const ap = matPrice(m);
                  return (
                    <tr key={m.id}>
                      <td className="w-code"><TextInput className="mono" value={m.code} onChange={(v) => upMat(m.id, { code: v })} aria-label="코드" /></td>
                      <td className="w-name"><TextInput value={m.name} onChange={(v) => upMat(m.id, { name: v })} placeholder="품명" aria-label="품명" /></td>
                      <td className="w-spec"><TextInput value={m.spec} onChange={(v) => upMat(m.id, { spec: v })} aria-label="규격" /></td>
                      <td className="w-unit"><TextInput className="c" value={m.unit} onChange={(v) => upMat(m.id, { unit: v })} aria-label="단위" /></td>
                      {['p1', 'p2', 'p3'].map((k) => <td key={k} className={!m.applied && m[k] > 0 && m[k] === ap ? 'pick' : ''}><NumInput value={m[k]} onChange={(v) => upMat(m.id, { [k]: v })} aria-label={k} /></td>)}
                      <td><NumInput value={m.applied} onChange={(v) => upMat(m.id, { applied: v })} placeholder="최저가" aria-label="지정단가" /></td>
                      <td className="r mono strong">{won(ap)}</td>
                      <td className="w-x"><button className="x-btn" aria-label="자재 삭제" onClick={() => { if (used(m.id)) return toast('일위대가나 내역서에서 사용 중인 자재는 삭제할 수 없습니다.'); update((d) => { d.mats = d.mats.filter((x) => x.id !== m.id); }); }}>×</button></td>
                    </tr>
                  );
                })}
                {!mats.length && <tr><td colSpan={10} className="empty">등록된 자재가 없습니다. ＋ 자재 또는 엑셀 붙여넣기로 추가하세요.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted small">조달청·물가정보·거래가격 중 0이 아닌 최저가를 자동 적용합니다(밑줄 표시). 특정 단가를 쓰려면 ‘지정단가’에 입력하세요.</p>
          {paste && (
            <PasteBox onClose={() => setPaste(false)} hint="자재 목록을 엑셀에서 복사해 붙여넣으세요."
              columns={['품명', '규격', '단위', '조달청', '물가정보', '거래가격']}
              onApply={(rows) => update((d) => rows.forEach((c) => d.mats.push({ id: uid(), code: `M${String(d.mats.length + 1).padStart(2, '0')}`, name: c[0] || '', spec: c[1] || '', unit: c[2] || '', p1: num(c[3]), p2: num(c[4]), p3: num(c[5]), applied: 0 })))} />
          )}
        </>
      ) : (
        <>
          <div className="toolbar"><div className="grp"><button className="btn primary sm" onClick={() => update((d) => d.labors.push({ id: uid(), name: '', wage: 0 }))}>＋ 직종</button>
            <button className="btn sm" onClick={() => { const ids = WAGES_2026H2.list.map(() => uid()); let added = 0, changed = 0;
              WAGES_2026H2.list.forEach(([n, w]) => { const hit = p.labors.find((x) => x.name === n); if (!hit) added++; else if (Number(hit.wage) !== w) changed++; });
              update((d) => { WAGES_2026H2.list.forEach(([n, w], i) => { const hit = d.labors.find((x) => x.name === n); if (hit) hit.wage = w; else d.labors.push({ id: ids[i], name: n, wage: w }); }); });
              toast(`2026 하반기 시중노임 적용: ${changed}개 직종 갱신, ${added}개 직종 추가`); }}>2026 하반기 시중노임 적용</button></div></div>
          <div className="tbl-wrap narrow">
            <table className="grid">
              <thead><tr><th className="w-name">직종</th><th className="w-price">일 노임 (원/인)</th><th className="w-x"></th></tr></thead>
              <tbody>
                {p.labors.map((l) => (
                  <tr key={l.id}>
                    <td className="w-name"><TextInput value={l.name} onChange={(v) => upLab(l.id, { name: v })} placeholder="직종명" aria-label="직종" /></td>
                    <td><NumInput value={l.wage} onChange={(v) => upLab(l.id, { wage: v })} aria-label="노임" /></td>
                    <td className="w-x"><button className="x-btn" aria-label="직종 삭제" onClick={() => { if (used(l.id)) return toast('일위대가에서 사용 중인 직종은 삭제할 수 없습니다.'); update((d) => { d.labors = d.labors.filter((x) => x.id !== l.id); }); }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">‘2026 하반기 시중노임 적용’은 대한건설협회 2026년 하반기 건설업 임금실태조사(2026.9.1~12.31 적용) 중 전기·통신·공통 {WAGES_2026H2.list.length}개 직종 금액을 넣습니다. 같은 이름의 직종은 금액만 바꾸고, 없는 직종은 추가합니다.</p>
        </>
      )}
    </div>
  );
}
