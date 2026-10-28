import { useState } from 'react';
import { costSheet, sectionTotals, unitCost, won, hangulAmount } from './calc.js';
import { contractFit } from './Cost.jsx';
import { estimateCalc } from './Estimate.jsx';
import { Modal } from './ui.jsx';

export const DOCS = [
  ['est', '견적서'],
  ['cost', '원가계산서'],
  ['sum', '공종별 집계표'],
  ['bill', '내역서'],
  ['unit', '일위대가표'],
];

function Head({ p, title, sub }) {
  return (
    <div className="pr-head">
      <h1>{title}</h1>
      <div className="pr-meta">
        <span>공사명 : {p.name}</span>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

function EstimateDoc({ p, r }) {
  const e = p.estimate;
  const cs = r.cs;
  const direct = cs.DM + cs.DL + cs.ME;
  const date = e.date || new Date().toISOString().slice(0, 10);
  return (
    <section className="pr-page">
      <h1 className="pr-title-big">견 적 서</h1>
      <div className="pr-est-top">
        <div>
          <p className="pr-to">{e.to || ''}</p>
          <p>공 사 명 : {p.name}</p>
          <p>공사장소 : {p.location || ''}</p>
          <p>견 적 일 : {date} (유효기간 {e.validDays}일)</p>
          <p className="pr-lead">아래와 같이 견적합니다.</p>
        </div>
        <table className="pr-supplier">
          <tbody>
            <tr><th rowSpan={3}>공<br />급<br />자</th><th>상 호</th><td>{p.company}</td></tr>
            <tr><th>사업자번호</th><td>{p.bizNo}</td></tr>
            <tr><th>업태·종목</th><td>건설업 · 전기·정보통신공사</td></tr>
          </tbody>
        </table>
      </div>
      <div className="pr-amount">견적금액 : 일금 {hangulAmount(r.amount)}원정 (￦{won(r.amount)}) <small>부가세 포함</small></div>
      <table className="pr-tbl">
        <thead><tr><th className="pr-no">No</th><th>공 종</th><th>재료비</th><th>노무비</th><th>경 비</th><th>합 계</th></tr></thead>
        <tbody>
          {cs.secs.map((s, i) => (
            <tr key={s.section.id}><td className="c">{i + 1}</td><td>{s.section.name}</td><td className="r">{won(s.m)}</td><td className="r">{won(s.l)}</td><td className="r">{won(s.e)}</td><td className="r">{won(s.sum)}</td></tr>
          ))}
          <tr className="pr-sub"><td></td><td>직접공사비 계</td><td className="r">{won(cs.DM)}</td><td className="r">{won(cs.DL)}</td><td className="r">{won(cs.ME)}</td><td className="r">{won(direct)}</td></tr>
          <tr><td></td><td>간접비·제경비·일반관리비·이윤</td><td colSpan={3}></td><td className="r">{won(cs.total - direct)}</td></tr>
          <tr><td></td><td>부가가치세</td><td colSpan={3}></td><td className="r">{won(cs.vat)}</td></tr>
          {r.amount !== cs.raw && <tr><td></td><td>단수조정</td><td colSpan={3}></td><td className="r">{won(r.amount - cs.raw)}</td></tr>}
          <tr className="pr-total"><td></td><td>합 계</td><td colSpan={3}></td><td className="r">{won(r.amount)}</td></tr>
        </tbody>
      </table>
      {e.note && <div className="pr-note"><b>비 고</b>{e.note.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>}
    </section>
  );
}

function CostDoc({ p, cs, label }) {
  return (
    <section className="pr-page">
      <Head p={p} title={`${label} 원가계산서`} sub={p.client ? `발주처 : ${p.client}` : ''} />
      <table className="pr-tbl">
        <thead><tr><th className="pr-g">비 목</th><th>구 분</th><th className="pr-amt">금 액</th><th>산출근거</th></tr></thead>
        <tbody>
          {cs.rows.map((r, i) => (
            <tr key={i} className={(r.sub ? 'pr-sub ' : '') + (r.sum ? 'pr-sum ' : '') + (r.grand ? 'pr-total' : '')}>
              <td className="c">{i === 0 || cs.rows[i - 1].g !== r.g ? r.g : ''}</td>
              <td>{r.label}</td><td className="r">{won(r.amt)}</td><td className="pr-small">{r.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pr-hangul">공사금액 : 일금 {hangulAmount(cs.grand)}원정 (￦{won(cs.grand)})</p>
    </section>
  );
}

function SumDoc({ p, cs, label }) {
  return (
    <section className="pr-page">
      <Head p={p} title={`${label} 공종별 집계표`} />
      <table className="pr-tbl">
        <thead><tr><th className="pr-no">No</th><th>공 종</th><th>재료비</th><th>노무비</th><th>경 비</th><th>합 계</th></tr></thead>
        <tbody>
          {cs.secs.map((s, i) => <tr key={s.section.id}><td className="c">{i + 1}</td><td>{s.section.name}</td><td className="r">{won(s.m)}</td><td className="r">{won(s.l)}</td><td className="r">{won(s.e)}</td><td className="r">{won(s.sum)}</td></tr>)}
          <tr className="pr-total"><td></td><td>합 계</td><td className="r">{won(cs.DM)}</td><td className="r">{won(cs.DL)}</td><td className="r">{won(cs.ME)}</td><td className="r">{won(cs.DM + cs.DL + cs.ME)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

function BillDoc({ p, factor, label }) {
  const secs = sectionTotals(p, factor);
  return (
    <section className="pr-page pr-land">
      <Head p={p} title={`${label}내역서`} />
      <table className="pr-tbl pr-bill">
        <thead>
          <tr><th rowSpan={2}>품 명</th><th rowSpan={2}>규 격</th><th rowSpan={2}>단위</th><th rowSpan={2}>수 량</th><th colSpan={2}>재 료 비</th><th colSpan={2}>노 무 비</th><th colSpan={2}>경 비</th><th colSpan={2}>합 계</th><th rowSpan={2}>비 고</th></tr>
          <tr><th>단가</th><th>금액</th><th>단가</th><th>금액</th><th>단가</th><th>금액</th><th>단가</th><th>금액</th></tr>
        </thead>
        {secs.map((s) => (
          <tbody key={s.section.id}>
            <tr className="pr-secname"><td colSpan={13}>{s.section.name}</td></tr>
            {s.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td><td>{r.spec}</td><td className="c">{r.unit}</td><td className="r">{won(r.qty)}</td>
                <td className="r">{won(r.um)}</td><td className="r">{won(r.am)}</td><td className="r">{won(r.ul)}</td><td className="r">{won(r.al)}</td>
                <td className="r">{won(r.ue)}</td><td className="r">{won(r.ae)}</td><td className="r">{won(r.up)}</td><td className="r">{won(r.amt)}</td>
                <td className="pr-small">{s.section.items[i].note}</td>
              </tr>
            ))}
            <tr className="pr-sub"><td colSpan={4} className="c">[ 소 계 ]</td><td></td><td className="r">{won(s.m)}</td><td></td><td className="r">{won(s.l)}</td><td></td><td className="r">{won(s.e)}</td><td></td><td className="r">{won(s.sum)}</td><td></td></tr>
          </tbody>
        ))}
      </table>
    </section>
  );
}

function UnitDoc({ p, factor }) {
  const used = p.units;
  if (!used.length) return null;
  return (
    <section className="pr-page">
      <Head p={p} title="일위대가표" />
      {used.map((u) => {
        const c = unitCost(p, u);
        return (
          <table key={u.id} className="pr-tbl pr-unit">
            <thead>
              <tr><th colSpan={7} className="pr-unit-title">{u.code}　{u.name}　{u.spec}　({u.unit}당)</th></tr>
              <tr><th>구분</th><th>품 명</th><th>규 격</th><th>단위</th><th>수 량</th><th>단 가</th><th>금 액</th></tr>
            </thead>
            <tbody>
              {c.lines.map((l) => <tr key={l.id}><td className="c">{l.kind}</td><td>{l.name}</td><td>{l.spec}</td><td className="c">{l.unit}</td><td className="r">{Number(l.qty)}</td><td className="r">{won(Math.floor(l.price * factor))}</td><td className="r">{won(Math.floor(l.amt * factor))}</td></tr>)}
              {c.tool > 0 && <tr><td className="c">경비</td><td>공구손료</td><td>노무비의 {u.toolRate}%</td><td className="c">식</td><td className="r">1</td><td className="r">{won(c.tool)}</td><td className="r">{won(c.tool)}</td></tr>}
              <tr className="pr-sub"><td colSpan={4} className="c">합 계</td><td colSpan={2} className="r pr-small">재 {won(c.m)} · 노 {won(c.l)} · 경 {won(c.e)}</td><td className="r">{won(c.total)}</td></tr>
            </tbody>
          </table>
        );
      })}
    </section>
  );
}

export function PrintArea({ p, job }) {
  if (!job) return null;
  let factor = 1, profitAdd = 0, label = '설계';
  if (job.basis === 'contract') { const f = contractFit(p); if (f) { factor = f.factor; profitAdd = f.profitAdd; label = '계약'; } }
  if (job.basis === 'est') { const r = estimateCalc(p); factor = r.factor; profitAdd = r.profitAdd; label = '견적'; }
  const pp = job.basis === 'design' ? p : { ...p, roundUnit: 1 };
  const cs = costSheet(pp, { factor, profitAdd });
  const est = estimateCalc(p);
  return (
    <div className="print-root" aria-hidden="true">
      {job.docs.includes('est') && <EstimateDoc p={p} r={est} />}
      {job.docs.includes('cost') && <CostDoc p={p} cs={cs} label={label} />}
      {job.docs.includes('sum') && <SumDoc p={p} cs={cs} label={label} />}
      {job.docs.includes('bill') && <BillDoc p={pp} factor={factor} label={label} />}
      {job.docs.includes('unit') && <UnitDoc p={p} factor={1} />}
    </div>
  );
}

export function PrintDialog({ p, initial, onClose, onPrint }) {
  const [docs, setDocs] = useState(initial || ['est', 'cost', 'sum', 'bill']);
  const hasContract = !!contractFit(p);
  const [basis, setBasis] = useState('design');
  const toggle = (k) => setDocs((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));
  return (
    <Modal title="출력" onClose={onClose}>
      <p className="muted small">인쇄할 서류를 고르세요. 프린터 대신 ‘PDF로 저장’을 고르면 PDF 파일로 받을 수 있습니다.</p>
      <div className="pr-pick">
        {DOCS.map(([k, t]) => (
          <label key={k} className="pr-check"><input type="checkbox" id={'pd-' + k} checked={docs.includes(k)} onChange={() => toggle(k)} />{t}</label>
        ))}
      </div>
      <div className="fld">
        <span>원가계산서·집계표·내역서 기준</span>
        <div className="seg full">
          <button className={basis === 'design' ? 'on' : ''} onClick={() => setBasis('design')}>설계금액</button>
          <button className={basis === 'contract' ? 'on' : ''} disabled={!hasContract} onClick={() => setBasis('contract')} title={hasContract ? '' : '원가계산서 탭에서 낙찰률·계약금액을 먼저 정하세요'}>계약금액</button>
          <button className={basis === 'est' ? 'on' : ''} onClick={() => setBasis('est')}>견적금액</button>
        </div>
      </div>
      <div className="row-between">
        <span className="muted small">A4 · 내역서는 가로 방향</span>
        <button className="btn primary" disabled={!docs.length} onClick={() => onPrint({ docs: DOCS.map((d) => d[0]).filter((k) => docs.includes(k)), basis })}>인쇄하기</button>
      </div>
    </Modal>
  );
}
