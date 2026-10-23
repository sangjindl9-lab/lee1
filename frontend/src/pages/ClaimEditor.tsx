import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { api, downloadFile, errMsg, fmt, fq, trimNum } from '../api'

type Mode = 'this_qty' | 'cum_qty' | 'rate'
const MODE_LABEL: Record<Mode, string> = { this_qty: 'A. 금회 수량', cum_qty: 'B. 누계 수량', rate: 'C. 누계 기성률(%)' }

const trunc = (v: number, d: number) => { const m = Math.pow(10, d); return Math.trunc(v * m + 1e-9) / m }

export default function ClaimEditor() {
  const { pid, cid } = useParams()
  const { reloadProject, proj } = useOutletContext<any>()
  const [data, setData] = useState<any>(null)
  const [versions, setVersions] = useState<any[]>([])
  const [mode, setMode] = useState<Mode>('this_qty')
  const [pending, setPending] = useState<Record<string, any>>({})
  const [q, setQ] = useState('')
  const [onlyInput, setOnlyInput] = useState(false)
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const load = async () => { const r = await api.get(`/claims/${cid}`); setData(r.data); setMode(r.data.claim.input_mode === 'cumulative' ? 'cum_qty' : r.data.claim.input_mode === 'rate' ? 'rate' : 'this_qty') }
  useEffect(() => { load(); api.get(`/projects/${pid}/versions`).then((r) => setVersions(r.data)) }, [cid])
  const rounding = proj?.rounding?.amount || { func: 'trunc', digits: 0 }
  const rd = (v: number) => (rounding.func === 'trunc' || rounding.func === 'rounddown' ? trunc(v, rounding.digits || 0) : rounding.func === 'round' ? Math.round(v) : v)
  const lines = data?.lines || []
  const confirmed = data?.claim.status === 'confirmed'

  // 클라이언트 즉시 계산 (저장 시 서버가 Decimal 로 재계산)
  const view = useMemo(() => lines.map((l: any) => {
    if (l.row_type !== 'item') return l
    const p = pending[l.uid]
    if (p === undefined) return l
    const cq = +l.contract_qty, prev = +l.prev_qty
    let tq = +l.this_qty
    if (p.this_qty !== undefined) tq = +p.this_qty
    else if (p.cum_qty !== undefined) tq = +p.cum_qty - prev
    else if (p.rate !== undefined) tq = cq * +p.rate / 100 - prev
    if (!Number.isFinite(tq)) tq = 0
    const m = rd(tq * (+l.mat_price || 0)), la = rd(tq * (+l.lab_price || 0)), e = rd(tq * (+l.exp_price || 0))
    const amt = (l.mat_price || l.lab_price || l.exp_price) ? m + la + e : rd(tq * (+l.contract_price || 0))
    const cum = prev + tq
    const cumAmt = +l.prev_amt + amt
    const warnings = [] as string[]
    if (tq < 0 && !data.claim.is_adjustment && !p.override_approved) warnings.push('음수')
    if (cum > cq + 1e-9 && !p.override_approved) warnings.push('계약수량 초과')
    return { ...l, this_qty: String(tq), this_mat_amt: String(m), this_lab_amt: String(la), this_exp_amt: String(e), this_amt: String(amt), cum_qty: String(cum), cum_amt: String(cumAmt), remain_qty: String(cq - cum), remain_amt: String(+l.contract_amt - cumAmt), rate: cq ? String((cumAmt / +l.contract_amt * 100).toFixed(2)) : '0', warnings, override_approved: p.override_approved ?? l.override_approved, memo: p.memo ?? l.memo, _dirty: true }
  }), [lines, pending, rounding])
  const totals = useMemo(() => {
    const t = { contract: 0, prev: 0, this: 0, cum: 0, warn: 0 }
    view.forEach((l: any) => { if (l.row_type !== 'item') return; t.contract += +l.contract_amt; t.prev += +l.prev_amt; t.this += +l.this_amt; t.cum += +l.cum_amt; if (l.warnings?.length) t.warn++ })
    return t
  }, [view])
  const secTotals = useMemo(() => {
    const m: Record<string, any> = {}
    view.forEach((l: any) => { if (l.row_type !== 'item') return; const k = l.section_path.join('::'); m[k] = m[k] || { c: 0, p: 0, t: 0, cu: 0 }; m[k].c += +l.contract_amt; m[k].p += +l.prev_amt; m[k].t += +l.this_amt; m[k].cu += +l.cum_amt })
    return m
  }, [view])

  const setVal = (uid: string, field: string, value: string) => setPending((p) => ({ ...p, [uid]: { ...(p[uid] || {}), [mode === 'rate' && field === 'v' ? 'rate' : mode === 'cum_qty' && field === 'v' ? 'cum_qty' : field === 'v' ? 'this_qty' : field]: value } }))
  const onPaste = (uid: string) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\r')) return
    e.preventDefault()
    const vals = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '')
    const itemsVisible = view.filter((l: any) => l.row_type === 'item' && visible(l))
    const start = itemsVisible.findIndex((l: any) => l.uid === uid)
    const upd: Record<string, any> = {}
    vals.forEach((v, i) => { const l = itemsVisible[start + i]; if (l) upd[l.uid] = { ...(pending[l.uid] || {}), [mode === 'rate' ? 'rate' : mode === 'cum_qty' ? 'cum_qty' : 'this_qty']: v.replace(/,/g, '') } })
    setPending((p) => ({ ...p, ...upd }))
  }
  const visible = (l: any) => {
    const ql = q.trim().toLowerCase()
    if (ql && !(l.name || '').toLowerCase().includes(ql) && !(l.spec || '').toLowerCase().includes(ql)) return false
    if (onlyInput && +l.this_qty === 0 && !pending[l.uid]) return false
    const key = l.section_path.join('::')
    return !Array.from(collapsed).some((c) => key === c || key.startsWith(c + '::'))
  }
  const save = async () => {
    setBusy(true)
    try { const r = await api.put(`/claims/${cid}/inputs`, { inputs: pending }); setData(r.data); setPending({}); setMsg({ t: `저장 완료 — 금회 ${fmt(r.data.summary.this_amt)}원, 경고 ${r.data.summary.warning_count}건`, k: 'ok' }) } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) } finally { setBusy(false) }
  }
  const confirmClaim = async () => {
    if (Object.keys(pending).length) { setMsg({ t: '먼저 저장하세요.', k: 'warn' }); return }
    if (!confirm('이 회차를 확정합니다. 확정 후에는 금회 수량을 수정할 수 없고 다음 회차의 전회 값으로 고정됩니다.')) return
    try { await api.post(`/claims/${cid}/confirm`); await load(); reloadProject(); setMsg({ t: '확정되었습니다.', k: 'ok' }) } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) }
  }
  const reopen = async () => { const reason = prompt('확정 취소 사유를 입력하세요 (이력에 기록됩니다)'); if (!reason) return; try { await api.post(`/claims/${cid}/reopen`, null, { params: { reason } }); load(); reloadProject() } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) } }
  const uploadQty = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f)
    try { const r = await api.post(`/claims/${cid}/upload-qty`, fd, { params: { mode: mode === 'rate' ? 'this_qty' : mode } }); await load(); setMsg({ t: `일괄 적용: ${r.data.matched}개 매칭${r.data.unmatched.length ? `, 미매칭 ${r.data.unmatched.length}개 (${r.data.unmatched.slice(0, 5).join(', ')}...)` : ''}${r.data.ambiguous.length ? `, 동일 품명 중복 ${r.data.ambiguous.length}개(첫 항목에 적용)` : ''}`, k: r.data.unmatched.length ? 'warn' : 'ok' }) } catch (err) { setMsg({ t: errMsg(err), k: 'err' }) } finally { if (fileRef.current) fileRef.current.value = '' }
  }
  const del = async () => { if (!confirm('이 회차를 삭제할까요?')) return; await api.delete(`/claims/${cid}`); location.href = `/projects/${pid}/claims` }
  if (!data) return <div>불러오는 중...</div>
  const c = data.claim
  const hasSplit = lines.some((l: any) => l.mat_price || l.lab_price)
  const dirty = Object.keys(pending).length > 0
  return (
    <>
      <div className="topbar">
        <h1><Link to={`/projects/${pid}/claims`}>기성</Link> › {c.title} <span className={`badge ${confirmed ? 'ok' : 'warn'}`}>{confirmed ? '확정' : '작성중'}</span>{c.is_adjustment && <span className="badge">정산회차</span>}</h1>
        <div className="actions">
          {!confirmed && <><select value={mode} onChange={(e) => setMode(e.target.value as Mode)} disabled={dirty}>{(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={uploadQty} />
            <button onClick={() => fileRef.current?.click()}>D. 엑셀 일괄 업로드</button>
            <button className="primary" disabled={!dirty || busy} onClick={save}>저장 {dirty ? `(${Object.keys(pending).length})` : ''}</button>
            <button onClick={confirmClaim} disabled={dirty}>회차 확정</button><button className="danger" onClick={del}>삭제</button></>}
          {confirmed && <button onClick={reopen}>확정 취소</button>}
          <button onClick={() => downloadFile(`/claims/${cid}/export`, { mode: 'standard' })}>엑셀 (표준양식)</button>
          <button onClick={() => downloadFile(`/claims/${cid}/export`, { mode: 'original' })}>엑셀 (원본서식)</button>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="l">기준일 / 계약버전</div><div className="v small">{c.base_date || '-'} · {(() => { const v = versions.find((x) => x.id === c.contract_version_id); return v ? `v${v.version_no} ${v.label}` : '' })()}</div></div>
        <div className="kpi"><div className="l">계약금액</div><div className="v small">{fmt(totals.contract)}</div></div>
        <div className="kpi"><div className="l">전회 누계</div><div className="v small">{fmt(totals.prev)}</div></div>
        <div className="kpi"><div className="l">금회 기성</div><div className="v small" style={{ color: '#1d4ed8' }}>{fmt(totals.this)}</div></div>
        <div className="kpi"><div className="l">누계 기성</div><div className="v small">{fmt(totals.cum)}</div></div>
        <div className="kpi"><div className="l">잔여 / 기성률</div><div className="v small">{fmt(totals.contract - totals.cum)} · {totals.contract ? (totals.cum / totals.contract * 100).toFixed(2) : 0}%</div></div>
        <div className="kpi"><div className="l">경고</div><div className="v small" style={{ color: totals.warn ? '#b45309' : '#15803d' }}>{totals.warn}건</div></div>
      </div>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder="품명/규격 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        <label className="row"><input type="checkbox" checked={onlyInput} onChange={(e) => setOnlyInput(e.target.checked)} /> 금회 입력 품목만</label>
        <button className="sm" onClick={() => setCollapsed(new Set(Object.keys(secTotals)))}>모두 접기</button><button className="sm" onClick={() => setCollapsed(new Set())}>모두 펼치기</button>
        <span className="help">입력 열에 여러 줄을 붙여넣으면 아래 품목으로 순서대로 채워집니다. 입력 중 금액은 즉시 재계산되고 저장 시 서버에서 정밀 계산됩니다.</span>
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>품명</th><th>규격</th><th>단위</th><th>계약수량</th><th>계약단가</th><th>계약금액</th><th>전회수량</th><th>전회금액</th>
            <th style={{ background: '#dbeafe' }}>{confirmed ? '금회수량' : MODE_LABEL[mode] + ' 입력'}</th><th>금회수량</th>{hasSplit && <><th>금회재료비</th><th>금회노무비</th><th>금회경비</th></>}<th>금회금액</th>
            <th>누계수량</th><th>누계금액</th><th>잔여수량</th><th>잔여금액</th><th>기성률</th><th>비고/메모</th></tr></thead>
          <tbody>
            {view.map((l: any) => {
              const key = l.section_path.join('::')
              if (l.row_type === 'section') {
                if (Array.from(collapsed).some((cc) => key !== cc && key.startsWith(cc + '::'))) return null
                const st = secTotals[key]
                return <tr key={l.uid} className="sec" style={{ cursor: 'pointer' }} onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })}>
                  <td colSpan={5}>{collapsed.has(key) ? '▸' : '▾'} {l.name}</td><td className="r">{st ? fmt(st.c) : ''}</td><td /><td className="r">{st ? fmt(st.p) : ''}</td><td /><td />{hasSplit && <><td /><td /><td /></>}
                  <td className="r">{st ? fmt(st.t) : ''}</td><td /><td className="r">{st ? fmt(st.cu) : ''}</td><td /><td className="r">{st ? fmt(st.c - st.cu) : ''}</td><td className="r">{st && st.c ? (st.cu / st.c * 100).toFixed(1) + '%' : ''}</td><td /></tr>
              }
              if (l.row_type !== 'item' || !visible(l)) return null
              const p = pending[l.uid] || {}
              const inputVal = p[mode] !== undefined ? p[mode] : mode === 'this_qty' ? (+l.this_qty ? trimNum(l.this_qty) : '') : mode === 'cum_qty' ? (+l.cum_qty ? trimNum(l.cum_qty) : '') : (+l.cum_amt ? trimNum(l.rate) : '')
              const warn = l.warnings?.length > 0
              return <tr key={l.uid}>
                <td>{l.name}</td><td>{l.spec}</td><td className="c">{l.unit}</td><td className="r">{fq(l.contract_qty)}</td><td className="r">{fmt(l.contract_price)}</td><td className="r">{fmt(l.contract_amt)}</td>
                <td className="r">{fq(l.prev_qty)}</td><td className="r">{fmt(l.prev_amt)}</td>
                <td className="c" style={{ background: '#f0f9ff' }}>{confirmed ? fq(l.this_qty) : <input className={`cell ${warn ? 'warn' : ''} ${l._dirty ? 'chg' : ''}`} value={inputVal} onChange={(e) => setVal(l.uid, 'v', e.target.value.replace(/,/g, ''))} onPaste={onPaste(l.uid)} title={l.warnings?.join(', ')} />}</td>
                <td className="r">{fq(l.this_qty)}</td>{hasSplit && <><td className="r">{fmt(l.this_mat_amt)}</td><td className="r">{fmt(l.this_lab_amt)}</td><td className="r">{fmt(l.this_exp_amt)}</td></>}<td className="r"><b>{fmt(l.this_amt)}</b></td>
                <td className="r">{fq(l.cum_qty)}</td><td className="r">{fmt(l.cum_amt)}</td><td className={`r ${+l.remain_qty < 0 ? 'err' : ''}`}>{fq(l.remain_qty)}</td><td className="r">{fmt(l.remain_amt)}</td><td className="r">{l.rate}%</td>
                <td>{warn && <span className="badge warn" title={l.warnings.join(', ')}>{l.warnings[0]}</span>}
                  {!confirmed && warn && <label className="row" style={{ display: 'inline-flex', marginLeft: 4 }}><input type="checkbox" checked={!!p.override_approved || !!l.override_approved} onChange={(e) => setPending((pp) => ({ ...pp, [l.uid]: { ...(pp[l.uid] || {}), override_approved: e.target.checked } }))} /><span style={{ fontSize: 11 }}>승인</span></label>}
                  {!confirmed && <input style={{ width: 90, padding: '1px 4px', marginLeft: 4 }} placeholder="메모" value={p.memo ?? l.memo ?? ''} onChange={(e) => setPending((pp) => ({ ...pp, [l.uid]: { ...(pp[l.uid] || {}), memo: e.target.value } }))} />}{confirmed && l.memo}</td>
              </tr>
            })}
          </tbody>
          <tfoot><tr className="sub"><td colSpan={5}>총 계</td><td className="r">{fmt(totals.contract)}</td><td /><td className="r">{fmt(totals.prev)}</td><td /><td />{hasSplit && <><td /><td /><td /></>}<td className="r">{fmt(totals.this)}</td><td /><td className="r">{fmt(totals.cum)}</td><td /><td className="r">{fmt(totals.contract - totals.cum)}</td><td className="r">{totals.contract ? (totals.cum / totals.contract * 100).toFixed(2) : 0}%</td><td /></tr></tfoot>
        </table>
      </div>
    </>
  )
}
