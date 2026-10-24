import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { api, downloadFile, errMsg, fmt, fq, trimNum } from '../api'

type Field = 'name' | 'spec' | 'unit' | 'qty' | 'mat_price' | 'lab_price' | 'exp_price' | 'note'
const EDIT_FIELDS: Field[] = ['name', 'spec', 'unit', 'qty', 'mat_price', 'lab_price', 'exp_price', 'note']
const NUM_FIELDS = new Set(['qty', 'mat_price', 'lab_price', 'exp_price'])

export default function EstimatePage() {
  const { pid } = useParams()
  const { reloadProject } = useOutletContext<any>()
  const [versions, setVersions] = useState<any[]>([])
  const [vid, setVid] = useState<number | null>(null)
  const [data, setData] = useState<any>(null)
  const [editable, setEditable] = useState<{ editable: boolean; reason: string }>({ editable: false, reason: '' })
  const [editMode, setEditMode] = useState(false)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [cell, setCell] = useState<{ uid: string; field: Field } | null>(null)   // 편집 중인 셀
  const [cellVal, setCellVal] = useState('')
  const [adding, setAdding] = useState<any>(null)
  const [lookup, setLookup] = useState<any[]>([])
  const [adj, setAdj] = useState<any>(null)   // 단가 % 조정 모달
  const [adjPreview, setAdjPreview] = useState<any>(null)
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadVersions = () => api.get(`/projects/${pid}/versions`).then((r) => { setVersions(r.data); if (!vid && r.data.length) setVid(r.data[r.data.length - 1].id) })
  const loadItems = async () => { if (!vid) return; const r = await api.get(`/versions/${vid}/items`); setData(r.data); const e = await api.get(`/versions/${vid}/editable`); setEditable(e.data) }
  useEffect(() => { loadVersions() }, [pid])
  useEffect(() => { loadItems(); setCell(null) }, [vid])
  useEffect(() => { if (cell) inputRef.current?.focus() }, [cell])

  const items = data?.items || []
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return items.filter((i: any) => !ql || i.row_type === 'section' || (i.name || '').toLowerCase().includes(ql) || (i.spec || '').toLowerCase().includes(ql))
  }, [items, q])
  const sectionTotals = useMemo(() => {
    const m: Record<string, { tot: number; mat: number; lab: number; exp: number; n: number }> = {}
    items.forEach((i: any) => { if (i.row_type !== 'item' || i.is_deleted) return; const k = i.section_path.join('::'); m[k] = m[k] || { tot: 0, mat: 0, lab: 0, exp: 0, n: 0 }; m[k].tot += +i.tot_amt || 0; m[k].mat += +i.mat_amt || 0; m[k].lab += +i.lab_amt || 0; m[k].exp += +i.exp_amt || 0; m[k].n++ })
    return m
  }, [items])
  const toggle = (k: string) => setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const hidden = (key: string) => Array.from(collapsed).some((c) => key === c || key.startsWith(c + '::'))
  const v = data?.version
  const hasSplit = items.some((i: any) => i.mat_amt !== null || i.lab_amt !== null)

  const startEdit = (i: any, field: Field) => {
    if (!editMode || !editable.editable) return
    setCell({ uid: i.uid, field })
    setCellVal(NUM_FIELDS.has(field) ? trimNum(i[field]) : (i[field] || ''))
  }
  const commit = async (move: 'next' | 'down' | null) => {
    if (!cell) return
    const i = items.find((x: any) => x.uid === cell.uid)
    const cur = NUM_FIELDS.has(cell.field) ? trimNum(i[cell.field]) : (i[cell.field] || '')
    if (cellVal !== cur) {
      try {
        const body: any = { reason: '내역서 편집' }
        body[cell.field] = NUM_FIELDS.has(cell.field) ? (cellVal === '' ? 0 : Number(cellVal.replace(/,/g, ''))) : cellVal
        if (NUM_FIELDS.has(cell.field) && Number.isNaN(body[cell.field])) throw new Error('숫자를 입력하세요')
        const r = await api.put(`/versions/${vid}/items/${cell.uid}`, body)
        setData((d: any) => ({ ...d, items: d.items.map((x: any) => (x.uid === cell.uid ? r.data : x)) }))
        loadVersions()
      } catch (e) { setMsg({ t: errMsg(e), k: 'err' }); setCell(null); return }
    }
    // 이동
    const visibleItems = filtered.filter((x: any) => x.row_type === 'item' && !hidden(x.section_path.join('::')))
    const idx = visibleItems.findIndex((x: any) => x.uid === cell.uid)
    if (move === 'down' && idx >= 0 && idx + 1 < visibleItems.length) startEditDeferred(visibleItems[idx + 1], cell.field)
    else if (move === 'next') {
      const fi = EDIT_FIELDS.indexOf(cell.field)
      const fields = EDIT_FIELDS.filter((f) => hasSplit || !['mat_price', 'lab_price', 'exp_price'].includes(f) || f === 'mat_price')
      const ni = fields.indexOf(cell.field) + 1
      if (ni < fields.length) startEditDeferred(visibleItems[idx], fields[ni])
      else if (idx + 1 < visibleItems.length) startEditDeferred(visibleItems[idx + 1], fields[0])
      else setCell(null)
      void fi
    } else setCell(null)
  }
  const startEditDeferred = (i: any, field: Field) => {
    setTimeout(() => { setCell({ uid: i.uid, field }); setCellVal(NUM_FIELDS.has(field) ? trimNum(i[field]) : (i[field] || '')) }, 0)
  }
  const onPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!cell || (!text.includes('\n') && !text.includes('\t'))) return
    e.preventDefault()
    const rows = text.split(/\r?\n/).filter((r) => r.trim() !== '').map((r) => r.split('\t'))
    const c0 = cell
    const visibleItems = filtered.filter((x: any) => x.row_type === 'item' && !hidden(x.section_path.join('::')))
    const start = visibleItems.findIndex((x: any) => x.uid === c0.uid)
    const fields = EDIT_FIELDS.filter((f) => hasSplit || !['lab_price', 'exp_price'].includes(f))
    const fStart = fields.indexOf(c0.field)
    let n = 0
    for (let r = 0; r < rows.length; r++) {
      const it = visibleItems[start + r]; if (!it) break
      const body: any = { reason: '붙여넣기' }
      rows[r].forEach((val, c) => { const f = fields[fStart + c]; if (!f) return; body[f] = NUM_FIELDS.has(f) ? Number(val.replace(/,/g, '')) || 0 : val })
      try { const res = await api.put(`/versions/${vid}/items/${it.uid}`, body); setData((d: any) => ({ ...d, items: d.items.map((x: any) => (x.uid === it.uid ? res.data : x)) })); n++ } catch (err) { setMsg({ t: errMsg(err), k: 'err' }); break }
    }
    setCell(null); loadVersions(); setMsg({ t: `${n}개 행에 붙여넣기 적용`, k: 'ok' })
  }
  const delItem = async (i: any) => {
    if (!confirm(`"${i.name}" 품목을 삭제할까요? (이력에 기록됩니다)`)) return
    try { await api.delete(`/versions/${vid}/items/${i.uid}`, { params: { reason: '내역서 편집' } }); loadItems(); loadVersions() } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) }
  }
  const addItem = async () => {
    try {
      await api.post(`/versions/${vid}/items`, { ...adding, qty: +adding.qty || 0, mat_price: +adding.mat_price || 0, lab_price: +adding.lab_price || 0, exp_price: +adding.exp_price || 0, reason: '내역서 편집' })
      setAdding(null); loadItems(); loadVersions()
    } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) }
  }
  const approve = async () => { if (!confirm('이 버전을 계약내역으로 확정합니다. 기성·설계변경에서 사용된 뒤에는 직접 수정할 수 없고 설계변경으로만 바꿀 수 있습니다.')) return; await api.post(`/versions/${vid}/approve`); loadVersions(); loadItems(); reloadProject() }

  if (!versions.length) return <><div className="topbar"><h1>내역서 분석·편집</h1></div><div className="panel muted">계약내역이 없습니다. <Link to={`/projects/${pid}/files`}>원본 내역서 관리</Link>에서 엑셀을 업로드하고 가져오기 하세요.</div></>

  const Cell = (i: any, field: Field, fmtv: (x: any) => any, cls?: string) => {
    const isEditing = !!cell && cell.uid === i.uid && cell.field === field
    if (isEditing) return <td className={cls}><input ref={inputRef} className="cell" style={{ width: NUM_FIELDS.has(field) ? 90 : 160, textAlign: NUM_FIELDS.has(field) ? 'right' : 'left' }} value={cellVal}
      onChange={(e) => setCellVal(e.target.value)} onPaste={onPaste} onBlur={() => commit(null)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit('down') } else if (e.key === 'Tab') { e.preventDefault(); commit('next') } else if (e.key === 'Escape') setCell(null) }} /></td>
    return <td className={`${cls || ''} ${editMode && editable.editable ? 'editable' : ''}`} onClick={() => startEdit(i, field)} title={editMode ? '클릭하여 편집' : ''}>{fmtv(i[field])}</td>
  }

  return (
    <>
      <div className="topbar"><h1>내역서 분석·편집</h1>
        <div className="actions">
          <select value={vid ?? ''} onChange={(e) => setVid(Number(e.target.value))}>{versions.map((x) => <option key={x.id} value={x.id}>v{x.version_no} {x.label} ({x.status === 'approved' ? '확정' : '작성중'})</option>)}</select>
          <input placeholder="품명/규격 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <button onClick={() => setCollapsed(new Set(Object.keys(sectionTotals)))}>모두 접기</button><button onClick={() => setCollapsed(new Set())}>모두 펼치기</button>
          <button className={editMode ? 'primary' : ''} disabled={!editable.editable} title={editable.reason} onClick={() => { setEditMode(!editMode); setCell(null) }}>{editMode ? '편집 모드 끄기' : '편집 모드'}</button>
          {editMode && <button onClick={() => { setAdj({ mat_pct: '100', lab_pct: '100', exp_pct: '100', section: '', price_digits: '0', price_round: 'trunc', reason: '' }); setAdjPreview(null) }}>단가 % 일괄 조정</button>}
          <button className="danger" onClick={async () => { if (!confirm(`v${v?.version_no} ${v?.label} 내역서를 삭제할까요? (품목·원가비목이 함께 삭제됩니다. 기성 회차가 있으면 먼저 삭제해야 합니다)`)) return; try { await api.delete(`/versions/${vid}`); setVid(null); setData(null); const r = await api.get(`/projects/${pid}/versions`); setVersions(r.data); if (r.data.length) setVid(r.data[r.data.length - 1].id); reloadProject(); setMsg({ t: '내역서를 삭제했습니다.', k: 'ok' }) } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) } }}>내역서 삭제</button>
          <button onClick={async () => { try { await downloadFile(`/versions/${vid}/export`); setMsg({ t: '원본 양식 그대로(시트·서식·수식 유지, 수정·추가·삭제 행만 반영) 엑셀을 내려받았습니다. Excel에서 열면 금액·소계가 자동 재계산됩니다.', k: 'ok' }) } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) } }}>엑셀 출력 (원본 양식 그대로)</button>
          {v?.status === 'draft' && <button onClick={approve}>계약내역 확정</button>}
        </div></div>
      {v && <div className="kpis">
        <div className="kpi"><div className="l">버전</div><div className="v small">v{v.version_no} {v.label} <span className={`badge ${v.status === 'draft' ? 'warn' : 'ok'}`}>{v.status === 'draft' ? '작성중' : '확정'}</span></div></div>
        <div className="kpi"><div className="l">재료비</div><div className="v small">{fmt(v.totals.mat_amt)}</div></div>
        <div className="kpi"><div className="l">노무비</div><div className="v small">{fmt(v.totals.lab_amt)}</div></div>
        <div className="kpi"><div className="l">경비</div><div className="v small">{fmt(v.totals.exp_amt)}</div></div>
        <div className="kpi"><div className="l">직접공사비 합계</div><div className="v small">{fmt(v.totals.tot_amt)}</div></div>
        <div className="kpi"><div className="l">품목 수</div><div className="v small">{v.item_count}</div></div>
      </div>}
      {!editable.editable && editable.reason && <div className="alert warn">{editable.reason}</div>}
      {editMode && editable.editable && <div className="alert info">편집 모드: 셀을 클릭해 수정하고 <b>Enter</b>(아래로)/<b>Tab</b>(옆으로)으로 저장합니다. 엑셀에서 여러 셀을 복사해 품명·수량 등 셀에 붙여넣으면 아래 행들에 순서대로 들어갑니다. 금액은 현장 반올림 규칙으로 자동 재계산되고 모든 수정은 이력에 남습니다.</div>}
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th style={{ width: 30 }}></th><th>품명</th><th>규격</th><th>단위</th><th>수량</th>
            {hasSplit ? <><th>재료비단가</th><th>재료비</th><th>노무비단가</th><th>노무비</th><th>경비단가</th><th>경비</th></> : <><th>재료비단가</th><th>노무비단가</th><th>경비단가</th></>}
            <th>합계단가</th><th>합계금액</th><th>비고</th><th>단가출처</th>{editMode && <th></th>}</tr></thead>
          <tbody>
            {filtered.map((i: any) => {
              const key = i.section_path.join('::')
              if (i.row_type === 'section') {
                const st = sectionTotals[key]
                if (hidden(key) && !collapsed.has(key)) return null
                return <tr key={i.uid} className="sec">
                  <td className="c" style={{ cursor: 'pointer' }} onClick={() => toggle(key)}>{collapsed.has(key) ? '▸' : '▾'}</td><td colSpan={3} style={{ paddingLeft: 6 + (i.level - 1) * 14, cursor: 'pointer' }} onClick={() => toggle(key)}>{i.name}</td>
                  <td className="r muted">{st?.n ? `${st.n}개` : ''}</td>
                  {hasSplit ? <><td /><td className="r">{st ? fmt(st.mat) : ''}</td><td /><td className="r">{st ? fmt(st.lab) : ''}</td><td /><td className="r">{st ? fmt(st.exp) : ''}</td></> : <><td /><td /><td /></>}
                  <td /><td className="r">{st ? fmt(st.tot) : ''}</td><td colSpan={2} />{editMode && <td className="c"><button className="sm" onClick={() => setAdding({ section_path: i.section_path, name: '', spec: '', unit: '', qty: '', mat_price: '', lab_price: '', exp_price: '', note: '' })}>+ 품목</button></td>}</tr>
              }
              if (hidden(key)) return null
              const src = i.price_source?.mat_price || i.price_source?.tot_price || (i.price_source?.manual ? '수동 입력' : '')
              return <tr key={i.uid} style={{ opacity: i.is_deleted ? 0.45 : 1, textDecoration: i.is_deleted ? 'line-through' : undefined }}>
                <td className="c">{i.is_new && <span className="badge info">신규</span>}{i.issues?.length > 0 && <span className="badge warn" title={i.issues.join(', ')}>!</span>}</td>
                {Cell(i, 'name', (x) => x)}{Cell(i, 'spec', (x) => x)}{Cell(i, 'unit', (x) => x, 'c')}{Cell(i, 'qty', fq, 'r')}
                {hasSplit ? <>{Cell(i, 'mat_price', fmt, 'r')}<td className="r">{fmt(i.mat_amt)}</td>{Cell(i, 'lab_price', fmt, 'r')}<td className="r">{fmt(i.lab_amt)}</td>{Cell(i, 'exp_price', fmt, 'r')}<td className="r">{fmt(i.exp_amt)}</td></>
                  : <>{Cell(i, 'mat_price', fmt, 'r')}{Cell(i, 'lab_price', fmt, 'r')}{Cell(i, 'exp_price', fmt, 'r')}</>}
                <td className="r">{fmt(i.tot_price)}</td><td className="r">{fmt(i.tot_amt)}</td>{Cell(i, 'note', (x) => x)}
                <td className="muted" style={{ fontSize: 11 }}>{i.unit_price_ref || src}</td>
                {editMode && <td className="c">{i.is_deleted ? <button className="sm" onClick={async () => { await api.post(`/versions/${vid}/items/${i.uid}/restore`); loadItems(); loadVersions() }}>복구</button> : <><button className="sm" title="아래에 품목 추가" onClick={() => setAdding({ section_path: i.section_path, after_uid: i.uid, name: '', spec: '', unit: i.unit, qty: '', mat_price: '', lab_price: '', exp_price: '', note: '' })}>+</button> <button className="sm danger" onClick={() => delItem(i)}>×</button></>}</td>}
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {adj && <div className="modal-bg" onClick={() => setAdj(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>단가 퍼센트 일괄 조정</h3>
        <div className="help">재료비·노무비·경비 단가에 적용률(%)을 곱해 일괄 변경합니다 (예: 낙찰률 87.747% 적용 → 재료비 87.747 입력). 100은 변동 없음. 수량×단가와 금액이 다른 요율 산정 행(공구손료 등)은 건드리지 않습니다.</div>
        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="f">재료비 단가 적용률 (%)<input className="num" value={adj.mat_pct} onChange={(e) => setAdj({ ...adj, mat_pct: e.target.value })} /></label>
          <label className="f">노무비 단가 적용률 (%)<input className="num" value={adj.lab_pct} onChange={(e) => setAdj({ ...adj, lab_pct: e.target.value })} /></label>
          <label className="f">경비 단가 적용률 (%)<input className="num" value={adj.exp_pct} onChange={(e) => setAdj({ ...adj, exp_pct: e.target.value })} /></label>
          <label className="f">적용 범위 (공종)<select value={adj.section} onChange={(e) => setAdj({ ...adj, section: e.target.value })}><option value="">전체</option>{Object.keys(sectionTotals).map((k) => <option key={k} value={k}>{k.split('::').join(' > ')}</option>)}</select></label>
          <label className="f">조정 단가 소수 자리<select value={adj.price_digits} onChange={(e) => setAdj({ ...adj, price_digits: e.target.value })}><option value="0">정수</option><option value="1">1자리</option><option value="2">2자리</option><option value="4">4자리</option></select></label>
          <label className="f">단가 처리<select value={adj.price_round} onChange={(e) => setAdj({ ...adj, price_round: e.target.value })}><option value="trunc">절사</option><option value="round">반올림</option></select></label>
          <label className="f">사유 (이력 기록)<input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="예: 낙찰률 87.747% 적용" /></label>
        </div>
        {adjPreview && <div className="alert info" style={{ marginTop: 10 }}>대상 {adjPreview.items}개 품목{adjPreview.skipped_count ? ` (요율행 ${adjPreview.skipped_count}개 제외)` : ''} · 재료비 {fmt(adjPreview.before.mat_amt)} → {fmt(adjPreview.after.mat_amt)} ({fmt(adjPreview.diff.mat_amt)}) · 노무비 {fmt(adjPreview.before.lab_amt)} → {fmt(adjPreview.after.lab_amt)} ({fmt(adjPreview.diff.lab_amt)}) · 합계 {fmt(adjPreview.before.tot_amt)} → <b>{fmt(adjPreview.after.tot_amt)}</b> ({fmt(adjPreview.diff.tot_amt)})</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={() => setAdj(null)}>취소</button>
          <button onClick={async () => { try { const r = await api.post(`/versions/${vid}/adjust-prices`, { mat_pct: +adj.mat_pct, lab_pct: +adj.lab_pct, exp_pct: +adj.exp_pct, section_prefix: adj.section ? adj.section.split('::') : null, price_digits: +adj.price_digits, price_round: adj.price_round, only_preview: true }); setAdjPreview(r.data) } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) } }}>미리보기</button>
          <button className="primary" disabled={!adjPreview} onClick={async () => { if (!confirm('단가를 일괄 조정합니다. 계속할까요?')) return; try { const r = await api.post(`/versions/${vid}/adjust-prices`, { mat_pct: +adj.mat_pct, lab_pct: +adj.lab_pct, exp_pct: +adj.exp_pct, section_prefix: adj.section ? adj.section.split('::') : null, price_digits: +adj.price_digits, price_round: adj.price_round, reason: adj.reason }); setAdj(null); loadItems(); loadVersions(); reloadProject(); setMsg({ t: `${r.data.items}개 품목 단가 조정 완료 — 합계 ${fmt(r.data.before.tot_amt)} → ${fmt(r.data.after.tot_amt)}`, k: 'ok' }) } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) } }}>적용</button>
        </div>
      </div></div>}
      {adding && <div className="modal-bg" onClick={() => setAdding(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>품목 추가 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{(adding.section_path || []).join(' > ')}</span></h3>
        <div className="grid2">
          <label className="f">품명 *<input autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></label>
          <label className="f">규격<input value={adding.spec} onChange={(e) => setAdding({ ...adding, spec: e.target.value })} /></label>
          <label className="f">단위<input value={adding.unit} onChange={(e) => setAdding({ ...adding, unit: e.target.value })} /></label>
          <label className="f">수량<input className="num" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value })} /></label>
          <label className="f">재료비 단가<input className="num" value={adding.mat_price} onChange={(e) => setAdding({ ...adding, mat_price: e.target.value })} /></label>
          <label className="f">노무비 단가<input className="num" value={adding.lab_price} onChange={(e) => setAdding({ ...adding, lab_price: e.target.value })} /></label>
          <label className="f">경비 단가<input className="num" value={adding.exp_price} onChange={(e) => setAdding({ ...adding, exp_price: e.target.value })} /></label>
          <label className="f">비고<input value={adding.note} onChange={(e) => setAdding({ ...adding, note: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="sm" onClick={async () => { const r = await api.get(`/projects/${pid}/price-lookup`, { params: { q: `${adding.name} ${adding.spec}`.trim() } }); setLookup(r.data) }} disabled={!adding.name}>단가표에서 찾기 (자재단가·노임)</button><span className="help">원본의 합산자재·단가조사·노임 표에서 품명/규격으로 검색해 단가를 가져옵니다.</span></div>
        {lookup.length > 0 && <div className="tbl-wrap" style={{ maxHeight: 200, marginTop: 6 }}><table className="t"><thead><tr><th>시트</th><th>품명</th><th>내용</th><th>단가</th><th></th></tr></thead>
          <tbody>{lookup.map((l: any, i: number) => <tr key={i}><td>{l.sheet}</td><td>{l.name}</td><td style={{ fontSize: 11 }}>{Object.values(l.text).filter((x: any) => x !== l.name).join(' / ').slice(0, 60)}</td>
            <td style={{ fontSize: 11 }}>{Object.entries(l.numbers).map(([k, v]: any) => `${k}: ${fmt(v, 2)}`).join(' · ')}</td>
            <td className="c"><button className="sm" onClick={() => { const n: any = l.numbers; const mat = n['재료비'] ?? n['적용단가'] ?? n['계'] ?? Object.values(n)[0]; setAdding({ ...adding, mat_price: mat ?? adding.mat_price, lab_price: n['노무비'] ?? adding.lab_price, exp_price: n['경비'] ?? adding.exp_price, unit: adding.unit || l.text['단위'] || '' }) }}>적용</button></td></tr>)}</tbody></table></div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button onClick={() => setAdding(null)}>취소</button><button className="primary" disabled={!adding.name} onClick={addItem}>추가</button></div>
      </div></div>}
    </>
  )
}
