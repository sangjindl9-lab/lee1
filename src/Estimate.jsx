import { useMemo, useState } from 'react';
import { costSheet, fitToTarget, won, hangulAmount } from './calc.js';
import { NumInput, TextInput } from './ui.jsx';

export function estimateCalc(p) {
  const e = p.estimate;
  let factor = (Number(e.rate) || 100) / 100, profitAdd = 0;
  if (Number(e.target) > 0) ({ factor, profitAdd } = fitToTarget(p, Number(e.target)));
  const cs = costSheet(p, { factor, profitAdd, roundUnit: 1 });
  const tail = Number(e.tail) || 1;
  const amount = Number(e.target) > 0 ? Number(e.target) : Math.floor(cs.raw / tail) * tail;
  return { factor, profitAdd, cs, amount };
}

export default function Estimate({ p, update, exportXlsx, onPrint }) {
  const e = p.estimate;
  const [detail, setDetail] = useState(false);
  const r = useMemo(() => estimateCalc(p), [p]);
  const design = useMemo(() => costSheet(p).grand, [p]);
  const up = (patch) => update((d) => { d.estimate = { ...d.estimate, ...patch }; });
  const direct = r.cs.DM + r.cs.DL + r.cs.ME;
  const date = e.date || new Date().toISOString().slice(0, 10);

  return (
    <div className="est">
      <aside className="panel est-ctrl">
        <h3>견적 조건</h3>
        <label className="fld">수신<TextInput id="e-to" value={e.to} onChange={(v) => up({ to: v })} /></label>
        <label className="fld">견적일<input id="e-date" type="date" className="cell" value={date} onChange={(ev) => up({ date: ev.target.value })} /></label>
        <label className="fld">유효기간 (일)<NumInput id="e-valid" value={e.validDays} onChange={(v) => up({ validDays: v })} /></label>
        <h3>공사비 조정</h3>
        <label className="fld">단가 조정률 (%)<NumInput id="e-rate" dec={3} value={e.rate} onChange={(v) => up({ rate: v, target: 0 })} disabled={Number(e.target) > 0} /></label>
        <label className="fld">또는 목표 견적금액 (부가세 포함)<NumInput id="e-target" value={e.target} onChange={(v) => up({ target: v })} placeholder="입력하면 조정률을 자동 계산" /></label>
        {Number(e.target) > 0 && <button className="btn sm ghost" onClick={() => up({ target: 0 })}>목표금액 해제</button>}
        <label className="fld">끝자리 정리
          <select id="e-tail" className="cell" value={e.tail} onChange={(ev) => up({ tail: Number(ev.target.value) })} disabled={Number(e.target) > 0}>
            {[1, 1000, 10000, 100000, 1000000].map((u) => <option key={u} value={u}>{u === 1 ? '정리 안 함' : `${u.toLocaleString()}원 미만 버림`}</option>)}
          </select>
        </label>
        <dl className="kv">
          <dt>설계금액</dt><dd className="mono">{won(design)}</dd>
          <dt>적용 조정률</dt><dd className="mono">{(r.factor * 100).toFixed(3)}%</dd>
          <dt>견적금액</dt><dd className="mono strong">{won(r.amount)}</dd>
          <dt>설계 대비</dt><dd className="mono">{design ? ((r.amount / design) * 100).toFixed(2) : 0}%</dd>
        </dl>
        <label className="fld">비고<textarea id="e-note" className="cell" rows={4} value={e.note} onChange={(ev) => up({ note: ev.target.value })} /></label>
        <div className="est-actions"><button className="btn primary" onClick={onPrint}>견적서 출력</button><button className="btn" onClick={() => exportXlsx('estimate')}>엑셀 저장</button></div>
      </aside>

      <article className="paper">
        <h1 className="paper-title">견 적 서</h1>
        <div className="paper-top">
          <div className="to">
            <p><b>{e.to || '수신처'}</b></p>
            <p className="muted">공사명 : {p.name}</p>
            <p className="muted">공사장소 : {p.location || '—'}</p>
            <p className="muted">견적일 : {date} · 유효기간 {e.validDays}일</p>
            <p className="lead">아래와 같이 견적합니다.</p>
          </div>
          <table className="supplier">
            <tbody>
              <tr><th rowSpan={3} className="vert">공급자</th><th>상호</th><td>{p.company}</td></tr>
              <tr><th>사업자번호</th><td className="mono">{p.bizNo}</td></tr>
              <tr><th>업태·종목</th><td>건설업 · 전기·정보통신공사</td></tr>
            </tbody>
          </table>
        </div>
        <div className="amount-box">
          <span>견적금액</span>
          <b>일금 {hangulAmount(r.amount)}원정</b>
          <span className="mono">(￦{won(r.amount)}) 부가세 포함</span>
        </div>
        <div className="tbl-wrap">
          <table className="grid doc">
            <thead><tr><th className="w-no">No</th><th>공종</th><th className="w-price">재료비</th><th className="w-price">노무비</th><th className="w-price">경비</th><th className="w-price">합계</th></tr></thead>
            <tbody>
              {r.cs.secs.map((s, i) => (
                <tr key={s.section.id}><td className="c">{i + 1}</td><td>{s.section.name}</td><td className="r mono">{won(s.m)}</td><td className="r mono">{won(s.l)}</td><td className="r mono">{won(s.e)}</td><td className="r mono">{won(s.sum)}</td></tr>
              ))}
              <tr className="sub"><td></td><td>직접공사비 계</td><td className="r mono">{won(r.cs.DM)}</td><td className="r mono">{won(r.cs.DL)}</td><td className="r mono">{won(r.cs.ME)}</td><td className="r mono">{won(direct)}</td></tr>
              <tr><td></td><td>간접비·제경비·일반관리비·이윤</td><td colSpan={3}></td><td className="r mono">{won(r.cs.total - direct)}</td></tr>
              <tr><td></td><td>부가가치세</td><td colSpan={3}></td><td className="r mono">{won(r.cs.vat)}</td></tr>
              {r.amount !== r.cs.raw && <tr><td></td><td>단수조정</td><td colSpan={3}></td><td className="r mono">{won(r.amount - r.cs.raw)}</td></tr>}
              <tr className="grand"><td></td><td>합 계</td><td colSpan={3}></td><td className="r mono">{won(r.amount)}</td></tr>
            </tbody>
          </table>
        </div>
        {e.note && <div className="paper-note"><b>비고</b>{e.note.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>}
        <button className="btn sm ghost" onClick={() => setDetail(!detail)}>{detail ? '상세내역 접기' : '상세내역 보기'}</button>
        {detail && (
          <div className="tbl-wrap">
            <table className="grid doc small">
              <thead><tr><th>품명</th><th>규격</th><th>단위</th><th className="r">수량</th><th className="r">단가</th><th className="r">금액</th></tr></thead>
              <tbody>
                {r.cs.secs.map((s) => [
                  <tr key={s.section.id} className="sec"><td colSpan={6}>{s.section.name}</td></tr>,
                  ...s.rows.map((x, i) => <tr key={s.section.id + i}><td>{x.name}</td><td>{x.spec}</td><td className="c">{x.unit}</td><td className="r mono">{won(x.qty)}</td><td className="r mono">{won(x.up)}</td><td className="r mono">{won(x.amt)}</td></tr>),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}
