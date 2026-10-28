import { useMemo } from 'react';
import { costSheet, fitToTarget, won, hangulAmount } from './calc.js';
import { DEFAULT_RATES } from './seed.js';
import { NumInput } from './ui.jsx';

export function contractFit(p) {
  const c = p.contract || { mode: 'none' };
  if (c.mode === 'none') return null;
  const design = costSheet(p).grand;
  const target = c.mode === 'rate' ? Math.floor(design * (Number(c.bidRate) || 0) / 100) : Number(c.target) || 0;
  if (!(target > 0)) return null;
  const fit = fitToTarget(p, target);
  return { ...fit, target, design };
}

export default function Cost({ p, update, exportXlsx, onPrint }) {
  const cs = useMemo(() => costSheet(p), [p]);
  const fit = useMemo(() => contractFit(p), [p]);
  const ct = useMemo(() => (fit ? costSheet(p, { factor: fit.factor, profitAdd: fit.profitAdd, roundUnit: 1 }) : null), [p, fit]);
  const upRate = (key, patch) => update((d) => Object.assign(d.rates.find((r) => r.key === key), patch));
  const c = p.contract || { mode: 'none', bidRate: 87.745, target: 0 };

  return (
    <div className="cost">
      <section className="panel">
        <div className="row-between">
          <h2>원가계산서</h2>
          <div className="grp">
            <button className="btn sm" onClick={onPrint}>출력</button>
            <button className="btn sm" onClick={() => exportXlsx('design')}>설계내역서 엑셀</button>
            {fit && <button className="btn sm primary" onClick={() => exportXlsx('contract')}>계약내역서 엑셀</button>}
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="grid costsheet">
            <thead><tr><th className="w-g">비목</th><th>구분</th><th className="w-price">설계금액</th>{ct && <th className="w-price">계약금액</th>}<th>산출근거</th></tr></thead>
            <tbody>
              {cs.rows.map((r, i) => {
                const r2 = ct?.rows.find((x) => x.g === r.g && x.label === r.label);
                return (
                  <tr key={i} className={(r.sub ? 'sub ' : '') + (r.sum ? 'sum ' : '') + (r.grand ? 'grand' : '')}>
                    <td className="w-g">{i === 0 || cs.rows[i - 1].g !== r.g ? r.g : ''}</td>
                    <td>{r.label}</td>
                    <td className="r mono">{won(r.amt)}</td>
                    {ct && <td className="r mono">{r2 ? won(r2.amt) : '—'}</td>}
                    <td className="muted small">{r.note || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hangul">설계금액 일금 <b>{hangulAmount(cs.grand)}</b>원정 (￦{won(cs.grand)})</p>
      </section>

      <aside className="cost-side">
        <section className="panel">
          <h3>계약금액 맞추기</h3>
          <div className="seg full">
            {[['none', '사용 안 함'], ['rate', '낙찰률'], ['target', '계약금액']].map(([k, t]) => (
              <button key={k} className={c.mode === k ? 'on' : ''} onClick={() => update((d) => { d.contract = { ...c, mode: k }; })}>{t}</button>
            ))}
          </div>
          {c.mode === 'rate' && <label className="fld">낙찰률 (%)<NumInput id="bid-rate" dec={3} value={c.bidRate} onChange={(v) => update((d) => { d.contract = { ...c, bidRate: v }; })} /></label>}
          {c.mode === 'target' && <label className="fld">계약금액 (부가세 포함)<NumInput id="ct-target" value={c.target} onChange={(v) => update((d) => { d.contract = { ...c, target: v }; })} /></label>}
          {fit && (
            <dl className="kv">
              <dt>설계금액</dt><dd className="mono">{won(fit.design)}</dd>
              <dt>계약 목표</dt><dd className="mono">{won(fit.target)}</dd>
              <dt>단가 적용률</dt><dd className="mono">{(fit.factor * 100).toFixed(4)}%</dd>
              <dt>이윤 단수조정</dt><dd className="mono">{won(fit.profitAdd)}</dd>
              <dt>계약 합계</dt><dd className={'mono ' + (ct.grand === fit.target ? 'ok' : 'warn')}>{won(ct.grand)} {ct.grand === fit.target ? '일치' : `차이 ${won(fit.target - ct.grand)}`}</dd>
            </dl>
          )}
          <p className="muted small">자재·노무·경비 단가에 같은 비율을 곱하고(원 미만 절사), 남는 차액은 이윤에서 자동으로 맞춥니다.</p>
        </section>

        <section className="panel">
          <div className="row-between"><h3>제비율</h3><button className="btn sm ghost" onClick={() => update((d) => { d.rates = DEFAULT_RATES.map((r) => ({ ...r })); })}>기본값</button></div>
          <table className="rates">
            <tbody>
              {p.rates.map((r) => (
                <tr key={r.key} className={r.on ? '' : 'off'}>
                  <td><input type="checkbox" id={'rate-' + r.key} checked={r.on} onChange={(e) => upRate(r.key, { on: e.target.checked })} /></td>
                  <td><label htmlFor={'rate-' + r.key}>{r.label}</label><small>{r.base}</small></td>
                  <td className="w-rate"><NumInput dec={4} value={r.rate} onChange={(v) => upRate(r.key, { rate: v })} aria-label={r.label + ' 요율'} /></td>
                  <td className="pct">%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="fld">작업설·부산물 (재료비에서 공제)<NumInput id="scrap" value={p.scrap} onChange={(v) => update((d) => { d.scrap = v; })} /></label>
          <label className="fld">비율 금액 끝수 처리
            <select id="rate-round" className="cell" value={p.rateRound || 'floor'} onChange={(e) => update((d) => { d.rateRound = e.target.value; })}>
              <option value="floor">원 미만 버림</option>
              <option value="round">원 미만 반올림 (엑셀 ROUND)</option>
            </select>
          </label>
          <label className="fld">총액 절사 단위
            <select id="round-unit" className="cell" value={p.roundUnit} onChange={(e) => update((d) => { d.roundUnit = Number(e.target.value); })}>
              {[1, 100, 1000, 10000, 100000].map((u) => <option key={u} value={u}>{u === 1 ? '절사 안 함' : `${u.toLocaleString()}원 미만 절사`}</option>)}
            </select>
          </label>
          <p className="note">4대보험 요율은 2026년 고시값(건강 3.595%, 장기요양 13.14%, 연금 4.75% 사업주분)으로 넣었습니다. 간접노무비·안전관리비·일반관리비·이윤 등은 발주기관 기준과 공사규모·기간에 맞게 확인 후 고쳐 쓰세요.</p>
        </section>
      </aside>
    </div>
  );
}
