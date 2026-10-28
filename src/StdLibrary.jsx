import { useMemo, useState } from 'react';
import { STD_ELEC, STD_COMM, STD_SOURCES } from './stdlib.js';
import { uid } from './seed.js';
import { won } from './calc.js';
import { Modal } from './ui.jsx';

const DATA = { elec: STD_ELEC, comm: STD_COMM };

// 표준시장단가 한 행을 일위대가로 바꾼다: 노무비 = 적용단가 × 노무비율, 나머지는 재료비(재료·경비·공구손료 포함)
export function makeStdUnit(row, src) {
  const [code, , name, spec, unit, price, rate] = row;
  const labor = Math.round(price * rate / 100);
  return {
    id: uid(), code, name, spec, unit, toolRate: 0,
    std: { src, code, price, rate, period: STD_SOURCES[src].period },
    items: [
      { id: uid(), kind: '자재', ref: null, name: '재료비·경비·공구손료', spec: '표준시장단가', unit: '식', qty: 1, price: price - labor },
      { id: uid(), kind: '노무', ref: null, name: '직접노무비', spec: `노무비율 ${rate}%`, unit: '식', qty: 1, price: labor },
    ],
  };
}

// 이미 들어 있는 같은 공종코드의 일위대가는 다시 만들지 않는다. 상태 밖에서 미리 만들어 두어 id가 바뀌지 않게 한다.
export function planStdUnits(p, picks) {
  const fresh = [];
  const ids = picks.map(({ row, src }) => {
    const hit = p.units.find((u) => u.std && u.std.code === row[0]) || fresh.find((u) => u.std.code === row[0]);
    if (hit) return hit.id;
    const u = makeStdUnit(row, src);
    fresh.push(u);
    return u.id;
  });
  return { ids, fresh };
}

export default function StdLibrary({ onClose, onPick, actionLabel, existing = [] }) {
  const [src, setSrc] = useState('elec');
  const [q, setQ] = useState('');
  const [grp, setGrp] = useState('');
  const [sel, setSel] = useState({});
  const rows = DATA[src];
  const groups = useMemo(() => [...new Set(rows.map((r) => r[1]))], [rows]);
  const f = rows.filter((r) => (!grp || r[1] === grp) && (r[0] + r[2] + r[3]).toLowerCase().includes(q.toLowerCase()));
  const picked = Object.values(sel);
  const toggle = (r) => setSel((s) => { const n = { ...s }; if (n[r[0]]) delete n[r[0]]; else n[r[0]] = { row: r, src }; return n; });
  const allOn = f.length > 0 && f.every((r) => sel[r[0]]);

  return (
    <Modal title="2026 표준대가 불러오기" onClose={onClose} wide>
      <div className="row-between">
        <div className="seg">
          {Object.entries(STD_SOURCES).map(([k, s]) => (
            <button key={k} className={src === k ? 'on' : ''} onClick={() => { setSrc(k); setGrp(''); }}>{s.title} <span className="cnt">{DATA[k].length}</span></button>
          ))}
        </div>
        <select id="std-grp" className="cell w-grp" value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="분류">
          <option value="">전체 분류</option>
          {groups.map((g) => <option key={g}>{g}</option>)}
        </select>
      </div>
      <p className="muted small">{STD_SOURCES[src].period} · {STD_SOURCES[src].note}. 적용단가는 재료비·노무비·기계경비·공구손료를 포함하며, 노무비율로 노무비를 나눠 일위대가를 만듭니다.</p>
      <input id="std-search" className="search" placeholder="공종명·규격·코드 검색 (예: HFIX 2.5, CD 16, UTP)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tbl-wrap picker">
        <table className="grid">
          <thead><tr>
            <th className="w-chk"><input type="checkbox" aria-label="보이는 항목 모두 선택" checked={allOn} onChange={() => setSel((s) => { const n = { ...s }; f.forEach((r) => { if (allOn) delete n[r[0]]; else n[r[0]] = { row: r, src }; }); return n; })} /></th>
            <th>공종코드</th><th>공종명칭</th><th>규격</th><th>단위</th><th className="r">적용단가</th><th className="r">노무비율</th>
          </tr></thead>
          <tbody>
            {f.map((r) => {
              const on = !!sel[r[0]];
              const had = existing.includes(r[0]);
              return (
                <tr key={r[0]} className={on ? 'sel' : ''} onClick={() => toggle(r)}>
                  <td className="w-chk"><input type="checkbox" readOnly checked={on} aria-label="선택" /></td>
                  <td className="mono small">{r[0]}{had && <span className="chip">등록됨</span>}</td>
                  <td>{r[2]}</td><td>{r[3]}</td><td className="c">{r[4]}</td>
                  <td className="r mono">{won(r[5])}</td><td className="r mono">{r[6]}%</td>
                </tr>
              );
            })}
            {!f.length && <tr><td colSpan={7} className="empty">검색 결과가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row-between">
        <span className="muted">{picked.length}개 선택</span>
        <button className="btn primary" disabled={!picked.length} onClick={() => { onPick(picked); onClose(); }}>{actionLabel}</button>
      </div>
    </Modal>
  );
}
