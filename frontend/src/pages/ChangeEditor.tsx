import { useEffect, useState } from "react"
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { api, downloadFile, errMsg, fmt, fq, trimNum } from '../api'

export default function ChangeEditor() {
  const { pid, cid } = useParams()
  const { reloadProject } = useOutletContext<any>()
  const [data, setData] = useState<any>(null)
  const [ptypes, setPtypes] = useState<any[]>([])
  const [pending, setPending] = useState<Record<string, any>>({})   // uid -> item body
  const [q, setQ] = useState('')
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null)
  const [addFor, setAddFor] = useState<any>(null)   // {section_path, after_uid}
  const [edit, setEdit] = useState<any>(null)        // modify modal
  const [tab, setTab] = useState<'items' | 'cost' | 'sections'>('items')
  const load = async () => { const r = await api.get(`/changes/${cid}`); setData(r.data) }
  useEffect(() => { load(); api.get('/price-types').then((r) => setPtypes(r.data)) }, [cid])
  if (!data) return <div>불러오는 중...</div>
  const c = data.change
  const approved = c.status === 'approved'
  const lines = data.lines
  const dirty = Object.keys(pending).length > 0
  const send = async (items: any[]) => {
    try { const r = await api.put(`/changes/${cid}/items`, items); setData(r.data); setPending({}); setMsg({ t: '저장되었습니다.', k: 'ok' }) } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) }
  }
  const save = () => send(Object.values(pending))
  const approve = async () => {
    if (dirty) { setMsg({ t: '먼저 저장하세요.', k: 'warn' }); return }
    if (data.summary.warnings.length) { setMsg({ t: `해결되지 않은 경고 ${data.summary.warnings.length}건이 있습니다.`, k: 'err' }); return }
    if (!confirm('설계변경을 승인하고 새 계약내역 버전을 생성합니다. 이후 기성은 변경계약 수량을 기준으로 계산됩니다.')) return
    try { const r = await api.post(`/changes/${cid}/approve`); await load(); reloadProject(); setMsg({ t: `승인 완료 — 계약내역 v${r.data.version.version_no} (${r.data.version.label}) 생성, 합계 ${fmt(r.data.version.totals.tot_amt)}원`, k: 'ok' }) } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) }
  }
  const del = async () => { if (!confirm('이 설계변경을 삭제할까요?')) return; await api.delete(`/changes/${cid}`); location.href = `/projects/${pid}/changes` }
  const quickQty = (l: any, v: string) => setPending((p) => ({ ...p, [l.uid]: { ...(p[l.uid] || { uid: l.uid, action: 'modify', price_type: l.price_type || 'contract', price_basis: l.price_basis || '', reason: l.reason || '' }), new_qty: v === '' ? null : +v } }))
  const resetItem = (l: any) => send([{ uid: l.uid, action: 'reset' }])
  const deleteItem = (l: any) => send([{ uid: l.uid, action: 'delete', reason: '삭제' }])
  const visible = (l: any) => { const ql = q.trim().toLowerCase(); if (ql && !(l.name || '').toLowerCase().includes(ql) && !(l.spec || '').toLowerCase().includes(ql)) return false; if (onlyChanged && l.action === 'keep' && !pending[l.uid]) return false; return true }
  const s = data.summary
  return (
    <>
      <div className="topbar">
        <h1><Link to={`/projects/${pid}/changes`}>설계변경</Link> › {c.title} <span className={`badge ${approved ? 'ok' : 'warn'}`}>{approved ? '승인' : '작성중'}</span></h1>
        <div className="actions">
          {!approved && <><button className="primary" disabled={!dirty} onClick={save}>저장 {dirty ? `(${Object.keys(pending).length})` : ''}</button><button disabled={dirty} onClick={approve}>승인 (변경계약 확정)</button><button className="danger" onClick={del}>삭제</button></>}
          <button onClick={() => downloadFile(`/changes/${cid}/export`)}>엑셀 출력 (대비표·변경내역서·총괄·원가)</button>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="l">당초 직접공사비</div><div className="v small">{fmt(s.orig.tot_amt)}</div></div>
        <div className="kpi"><div className="l">변경 직접공사비</div><div className="v small">{fmt(s.chg.tot_amt)}</div></div>
        <div className="kpi"><div className="l">증감</div><div className="v small" style={{ color: +s.diff.tot_amt < 0 ? '#b91c1c' : '#1d4ed8' }}>{+s.diff.tot_amt > 0 ? '+' : ''}{fmt(s.diff.tot_amt)}</div></div>
        <div className="kpi"><div className="l">재료비 / 노무비 / 경비 증감</div><div className="v small">{fmt(s.diff.mat_amt)} / {fmt(s.diff.lab_amt)} / {fmt(s.diff.exp_amt)}</div></div>
        <div className="kpi"><div className="l">변경 / 신규 / 삭제</div><div className="v small">{s.counts.modify} / {s.counts.add} / {s.counts.delete}</div></div>
        <div className="kpi"><div className="l">경고</div><div className="v small" style={{ color: s.warnings.length ? '#b45309' : '#15803d' }}>{s.warnings.length}건</div></div>
      </div>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      {s.warnings.length > 0 && <div className="alert warn"><b>승인 전 해결 필요</b><ul className="plain">{s.warnings.slice(0, 8).map((w: any, i: number) => <li key={i}>{w.name}: {w.messages.join(' / ')}</li>)}</ul></div>}
      <div className="tabs"><button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>품목별 당초·변경·증감</button><button className={tab === 'sections' ? 'on' : ''} onClick={() => setTab('sections')}>공종별 증감 총괄</button><button className={tab === 'cost' ? 'on' : ''} onClick={() => setTab('cost')}>변경 원가계산서</button></div>
      {tab === 'items' && <>
        <div className="row" style={{ marginBottom: 8 }}>
          <input placeholder="품명/규격 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <label className="row"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> 변경 품목만</label>
          <span className="help">변경수량 열에 직접 입력하면 수량 변경, "상세"에서 단가·규격·근거를 지정합니다. 공종행의 "+ 신규"로 품목을 추가합니다. 기성 인정수량보다 적게 줄이거나 삭제할 수 없습니다.</span>
        </div>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>구분</th><th>품명</th><th>규격</th><th>단위</th><th>당초수량</th><th>당초단가</th><th>당초금액</th><th style={{ background: '#dbeafe' }}>변경수량</th><th>변경단가</th><th>변경금액</th><th>증감수량</th><th>증감금액</th><th>기성인정</th><th>단가유형/근거</th><th></th></tr></thead>
          <tbody>{lines.map((l: any) => {
            if (l.row_type === 'section') return <tr key={l.uid} className="sec"><td colSpan={14}>{l.section_path.join(' > ') || l.name}</td><td className="c">{!approved && <button className="sm" onClick={() => setAddFor({ section_path: l.section_path })}>+ 신규</button>}</td></tr>
            if (!visible(l)) return null
            const p = pending[l.uid]
            const chgQty = p?.new_qty !== undefined && p?.new_qty !== null ? p.new_qty : l.chg.qty
            const act = p ? 'modify' : l.action
            const dq = +chgQty - +l.orig.qty
            const bad = l.warnings.length > 0
            return <tr key={l.uid} style={{ opacity: l.action === 'delete' ? 0.6 : 1 }}>
              <td className="c">{act === 'add' ? <span className="badge info">신규</span> : act === 'delete' ? <span className="badge err">삭제</span> : act === 'modify' ? <span className="badge warn">변경</span> : ''}</td>
              <td>{l.name}</td><td>{l.spec}</td><td className="c">{l.unit}</td>
              <td className="r">{fq(l.orig.qty)}</td><td className="r">{fmt(l.orig.tot_price)}</td><td className="r">{fmt(l.orig.tot_amt)}</td>
              <td className="c" style={{ background: '#f0f9ff' }}>{approved || l.action === 'add' || l.action === 'delete' ? fq(chgQty) : <input className={`cell ${p ? 'chg' : ''} ${bad ? 'warn' : ''}`} value={p ? (chgQty ?? '') : trimNum(chgQty)} onChange={(e) => quickQty(l, e.target.value.replace(/,/g, ''))} />}</td>
              <td className="r">{fmt(l.chg.tot_price)}</td><td className="r">{fmt(p ? Math.trunc(+chgQty * +l.chg.tot_price) : l.chg.tot_amt)}</td>
              <td className={`r ${dq < 0 ? 'err' : dq > 0 ? 'ok' : ''}`}>{dq ? fq(dq) : ''}</td><td className={`r ${+l.diff.tot_amt < 0 ? 'err' : +l.diff.tot_amt > 0 ? 'ok' : ''}`}>{p ? '' : (+l.diff.tot_amt ? fmt(l.diff.tot_amt) : '')}</td>
              <td className="r">{+l.progress_qty ? fq(l.progress_qty) : ''}</td>
              <td style={{ fontSize: 11 }}>{l.action !== 'keep' ? <>{l.price_type_label}{l.price_basis ? ` · ${l.price_basis}` : ''}</> : ''}{bad && <div className="warn">{l.warnings[0]}</div>}</td>
              <td className="c">{!approved && <><button className="sm" onClick={() => setEdit({ ...l })}>상세</button> {l.action === 'keep' && <button className="sm" onClick={() => deleteItem(l)}>삭제</button>}{l.action !== 'keep' && <button className="sm" onClick={() => resetItem(l)}>취소</button>}</>}</td>
            </tr>
          })}</tbody>
        </table></div>
      </>}
      {tab === 'sections' && <div className="panel"><table className="t"><thead><tr><th>공종</th><th>당초</th><th>변경</th><th>증감</th></tr></thead>
        <tbody>{s.sections.map((x: any, i: number) => <tr key={i}><td>{x.section}</td><td className="r">{fmt(x.orig)}</td><td className="r">{fmt(x.chg)}</td><td className={`r ${+x.diff < 0 ? 'err' : +x.diff > 0 ? 'ok' : ''}`}>{fmt(x.diff)}</td></tr>)}
          <tr className="sub"><td>직접공사비 계</td><td className="r">{fmt(s.orig.tot_amt)}</td><td className="r">{fmt(s.chg.tot_amt)}</td><td className="r">{fmt(s.diff.tot_amt)}</td></tr></tbody></table></div>}
      {tab === 'cost' && <div className="panel">
        {!s.cost_sheet ? <div className="muted">원본 파일에 원가계산서가 없어 제비율 재계산을 할 수 없습니다. 원가계산서·제비율 메뉴에서 비목을 등록하세요.</div> : <>
          <div className="help" style={{ marginBottom: 6 }}>원본 원가계산서의 비목 구조와 요율을 그대로 적용해 직접공사비 증감에 따른 간접비를 재산정한 참고값입니다. "정산" 비목(보험료 정산 등)은 원가계산서·제비율 메뉴에서 고정으로 지정하면 재계산에서 제외됩니다. 산정기준을 인식하지 못한 비목은 빈칸으로 표시됩니다.</div>
          <table className="t"><thead><tr><th>비목</th><th>원본 금액</th><th>당초(재계산)</th><th>변경</th><th>증감</th><th>요율</th><th>산정기준</th></tr></thead>
            <tbody>{s.cost_sheet.map((x: any, i: number) => <tr key={i} className={x.kind !== 'line' ? 'sub' : ''}><td>{x.name}{x.fixed && <span className="badge" style={{ marginLeft: 4 }}>정산</span>}</td><td className="r">{fmt(x.original_amount)}</td><td className="r">{fmt(x.orig)}</td><td className="r">{fmt(x.chg)}</td><td className={`r ${+(x.diff || 0) < 0 ? 'err' : +(x.diff || 0) > 0 ? 'ok' : ''}`}>{fmt(x.diff)}</td><td className="r">{x.rate ? `${+x.rate}%` : ''}</td><td className="muted">{x.base_text || x.rate_base}</td></tr>)}</tbody></table></>}
      </div>}
      {(addFor || edit) && <ItemModal ptypes={ptypes} line={edit} addFor={addFor} onClose={() => { setAddFor(null); setEdit(null) }} onSave={async (body: any) => { await send([body]); setAddFor(null); setEdit(null) }} />}
    </>
  )
}

function ItemModal({ ptypes, line, addFor, onClose, onSave }: any) {
  const isAdd = !!addFor || line?.action === 'add'
  const [f, setF] = useState<any>(() => line ? {
    uid: line.uid, action: line.action === 'add' ? 'add' : 'modify', name: line.name, spec: line.spec, unit: line.unit, new_qty: line.chg.qty, new_mat_price: line.chg.mat_price, new_lab_price: line.chg.lab_price, new_exp_price: line.chg.exp_price,
    price_type: line.price_type === 'contract' && line.action === 'add' ? 'new_unit_price' : line.price_type, price_basis: line.price_basis, reason: line.reason, spec_mode: 'modify', section_path: line.section_path,
  } : { action: 'add', name: '', spec: '', unit: '', new_qty: '', new_mat_price: '', new_lab_price: '', new_exp_price: '', price_type: 'new_unit_price', price_basis: '', reason: '', section_path: addFor.section_path, after_uid: addFor.after_uid })
  const priceChanged = line && line.action !== 'add' && (+f.new_mat_price !== +line.orig.mat_price || +f.new_lab_price !== +line.orig.lab_price || +f.new_exp_price !== +line.orig.exp_price)
  const specChanged = line && line.action !== 'add' && (f.spec !== line.spec || f.unit !== line.unit || f.name !== line.name)
  const tot = (+f.new_mat_price || 0) + (+f.new_lab_price || 0) + (+f.new_exp_price || 0)
  const submit = () => {
    const body: any = { uid: f.uid, action: isAdd ? 'add' : (specChanged && f.spec_mode === 'modify' ? 'spec_change' : 'modify'), new_qty: +f.new_qty, new_mat_price: +f.new_mat_price || 0, new_lab_price: +f.new_lab_price || 0, new_exp_price: +f.new_exp_price || 0, price_type: f.price_type, price_basis: f.price_basis, reason: f.reason }
    if (isAdd) body.new_item = { section_path: f.section_path, name: f.name, spec: f.spec, unit: f.unit, after_uid: f.after_uid }
    else if (specChanged && f.spec_mode === 'modify') body.new_item = { name: f.name, spec: f.spec, unit: f.unit }
    onSave(body)
  }
  return <div className="modal-bg" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
    <h3>{isAdd ? '신규 품목 추가' : '품목 변경 상세'} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{(f.section_path || []).join(' > ')}</span></h3>
    <div className="grid2">
      <label className="f">품명<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="f">규격<input value={f.spec} onChange={(e) => setF({ ...f, spec: e.target.value })} /></label>
      <label className="f">단위<input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></label>
      <label className="f">변경 수량 {line && line.action !== 'add' && <span className="muted">(당초 {fq(line.orig.qty)}{+line.progress_qty ? `, 기성인정 ${fq(line.progress_qty)}` : ''})</span>}<input className="num" value={f.new_qty ?? ''} onChange={(e) => setF({ ...f, new_qty: e.target.value })} /></label>
      <label className="f">재료비 단가 {line && line.action !== 'add' && <span className="muted">(당초 {fmt(line.orig.mat_price)})</span>}<input className="num" value={f.new_mat_price ?? ''} onChange={(e) => setF({ ...f, new_mat_price: e.target.value })} /></label>
      <label className="f">노무비 단가 {line && line.action !== 'add' && <span className="muted">(당초 {fmt(line.orig.lab_price)})</span>}<input className="num" value={f.new_lab_price ?? ''} onChange={(e) => setF({ ...f, new_lab_price: e.target.value })} /></label>
      <label className="f">경비 단가 {line && line.action !== 'add' && <span className="muted">(당초 {fmt(line.orig.exp_price)})</span>}<input className="num" value={f.new_exp_price ?? ''} onChange={(e) => setF({ ...f, new_exp_price: e.target.value })} /></label>
      <label className="f">합계 단가 / 금액<input disabled value={`${fmt(tot)} / ${fmt(Math.trunc(tot * (+f.new_qty || 0)))}`} /></label>
      <label className="f">적용단가 유형<select value={f.price_type} onChange={(e) => setF({ ...f, price_type: e.target.value })}>{ptypes.map((p: any) => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>
      <label className="f">단가 산정 근거 {(priceChanged || isAdd) && <span className="err">*필수</span>}<input value={f.price_basis} onChange={(e) => setF({ ...f, price_basis: e.target.value })} placeholder="예: 신규 일위대가 3호, 견적서 2건 평균, 협의단가(2026.3.1)" /></label>
      <label className="f">변경 사유<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
    </div>
    {specChanged && <div className="alert info" style={{ marginTop: 10 }}>규격/단위/품명이 바뀌었습니다. 처리 방식:
      <label className="row"><input type="radio" checked={f.spec_mode === 'modify'} onChange={() => setF({ ...f, spec_mode: 'modify' })} /> 기존 품목의 규격 변경으로 처리 (동일 품목, 이력 유지)</label>
      <label className="row"><input type="radio" checked={f.spec_mode === 'replace'} onChange={() => setF({ ...f, spec_mode: 'replace' })} /> 기존 품목 삭제 + 신규 품목 추가로 처리 (이 창에서 저장 후 "삭제"와 "+ 신규"를 각각 실행)</label></div>}
    <div className="help" style={{ marginTop: 8 }}>단가는 자동 추천(기존 계약단가)과 최종 적용단가를 구분합니다. 계약조건·법령 적용이 불명확하면 확정하지 말고 발주처와 협의한 근거를 기록하세요.</div>
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button onClick={onClose}>취소</button><button className="primary" disabled={!f.name || f.new_qty === '' || (f.spec_mode === 'replace')} onClick={submit}>저장</button></div>
  </div></div>
}
