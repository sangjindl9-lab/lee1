import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { api, errMsg, fmt, fq } from '../api'

export default function EstimatePage() {
  const { pid } = useParams()
  const { reloadProject } = useOutletContext<any>()
  const [versions, setVersions] = useState<any[]>([])
  const [vid, setVid] = useState<number | null>(null)
  const [data, setData] = useState<any>(null)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [edit, setEdit] = useState<any>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { api.get(`/projects/${pid}/versions`).then((r) => { setVersions(r.data); if (r.data.length) setVid(r.data[r.data.length - 1].id) }) }, [pid])
  useEffect(() => { if (vid) api.get(`/versions/${vid}/items`).then((r) => setData(r.data)) }, [vid])
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
  const approve = async () => { if (!confirm('이 버전을 계약내역으로 확정합니다. 이후 수정은 설계변경으로만 가능합니다.')) return; await api.post(`/versions/${vid}/approve`); api.get(`/projects/${pid}/versions`).then((r) => setVersions(r.data)); setData({ ...data, version: { ...data.version, status: 'approved' } }); reloadProject() }
  const saveEdit = async () => {
    try {
      const r = await api.put(`/versions/${vid}/items/${edit.uid}`, { qty: +edit.qty, mat_price: +edit.mat_price || 0, lab_price: +edit.lab_price || 0, exp_price: +edit.exp_price || 0, name: edit.name, spec: edit.spec, unit: edit.unit, note: edit.note, reason: edit.reason || '' })
      setData({ ...data, items: items.map((i: any) => (i.uid === edit.uid ? r.data : i)) }); setEdit(null); setMsg('저장되었습니다.')
      api.get(`/projects/${pid}/versions`).then((rr) => setVersions(rr.data))
    } catch (e) { setMsg(errMsg(e)) }
  }
  const v = data?.version
  const draft = v?.status === 'draft'
  const hasSplit = items.some((i: any) => i.mat_amt !== null || i.lab_amt !== null)
  if (!versions.length) return <><div className="topbar"><h1>내역서 분석·편집</h1></div><div className="panel muted">계약내역이 없습니다. <Link to={`/projects/${pid}/files`}>원본 내역서 관리</Link>에서 엑셀을 업로드하고 가져오기 하세요.</div></>
  return (
    <>
      <div className="topbar"><h1>내역서 분석·편집</h1>
        <div className="actions">
          <select value={vid ?? ''} onChange={(e) => setVid(Number(e.target.value))}>{versions.map((x) => <option key={x.id} value={x.id}>v{x.version_no} {x.label} ({x.status === 'approved' ? '확정' : '작성중'})</option>)}</select>
          <input placeholder="품명/규격 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <button onClick={() => setCollapsed(new Set(Object.keys(sectionTotals)))}>모두 접기</button><button onClick={() => setCollapsed(new Set())}>모두 펼치기</button>
          {draft && <button className="primary" onClick={approve}>계약내역 확정</button>}
        </div></div>
      {v && <div className="kpis">
        <div className="kpi"><div className="l">버전</div><div className="v small">v{v.version_no} {v.label} <span className={`badge ${draft ? 'warn' : 'ok'}`}>{draft ? '작성중 (수정 가능)' : '확정'}</span></div></div>
        <div className="kpi"><div className="l">재료비</div><div className="v small">{fmt(v.totals.mat_amt)}</div></div>
        <div className="kpi"><div className="l">노무비</div><div className="v small">{fmt(v.totals.lab_amt)}</div></div>
        <div className="kpi"><div className="l">경비</div><div className="v small">{fmt(v.totals.exp_amt)}</div></div>
        <div className="kpi"><div className="l">직접공사비 합계</div><div className="v small">{fmt(v.totals.tot_amt)}</div></div>
        <div className="kpi"><div className="l">품목 수</div><div className="v small">{v.item_count}</div></div>
      </div>}
      {msg && <div className="alert info">{msg}</div>}
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th style={{ width: 30 }}></th><th>품명</th><th>규격</th><th>단위</th><th>수량</th>
            {hasSplit ? <><th>재료비단가</th><th>재료비</th><th>노무비단가</th><th>노무비</th><th>경비단가</th><th>경비</th></> : null}
            <th>합계단가</th><th>합계금액</th><th>비고</th><th>단가출처</th>{draft && <th></th>}</tr></thead>
          <tbody>
            {filtered.map((i: any) => {
              const key = i.section_path.join('::')
              if (i.row_type === 'section') {
                const st = sectionTotals[key]
                const anyCollapsed = Array.from(collapsed).some((c) => key === c || key.startsWith(c + '::'))
                if (anyCollapsed && !collapsed.has(key)) return null
                return <tr key={i.uid} className="sec" style={{ cursor: 'pointer' }} onClick={() => toggle(key)}>
                  <td className="c">{collapsed.has(key) ? '▸' : '▾'}</td><td colSpan={3} style={{ paddingLeft: 6 + (i.level - 1) * 14 }}>{i.name}</td>
                  <td className="r muted">{st?.n ? `${st.n}개` : ''}</td>
                  {hasSplit ? <><td /><td className="r">{st ? fmt(st.mat) : ''}</td><td /><td className="r">{st ? fmt(st.lab) : ''}</td><td /><td className="r">{st ? fmt(st.exp) : ''}</td></> : null}
                  <td /><td className="r">{st ? fmt(st.tot) : ''}</td><td colSpan={draft ? 3 : 2} /></tr>
              }
              if (Array.from(collapsed).some((c) => key === c || key.startsWith(c + '::'))) return null
              const src = i.price_source?.mat_price || i.price_source?.tot_price || ''
              return <tr key={i.uid} style={{ opacity: i.is_deleted ? 0.45 : 1, textDecoration: i.is_deleted ? 'line-through' : undefined }}>
                <td className="c">{i.is_new && <span className="badge info">신규</span>}{i.issues?.length > 0 && <span className="badge warn" title={i.issues.join(', ')}>!</span>}</td>
                <td>{i.name}</td><td>{i.spec}</td><td className="c">{i.unit}</td><td className="r">{fq(i.qty)}</td>
                {hasSplit ? <><td className="r">{fmt(i.mat_price)}</td><td className="r">{fmt(i.mat_amt)}</td><td className="r">{fmt(i.lab_price)}</td><td className="r">{fmt(i.lab_amt)}</td><td className="r">{fmt(i.exp_price)}</td><td className="r">{fmt(i.exp_amt)}</td></> : null}
                <td className="r">{fmt(i.tot_price)}</td><td className="r">{fmt(i.tot_amt)}</td><td>{i.note}</td>
                <td className="muted" style={{ fontSize: 11 }}>{i.unit_price_ref || src}</td>
                {draft && <td className="c"><button className="sm" onClick={() => setEdit({ ...i })}>수정</button></td>}
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {edit && <div className="modal-bg" onClick={() => setEdit(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>품목 수정 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(원본 {edit.sheet} {edit.source_row}행)</span></h3>
        <div className="grid2">
          <label className="f">품명<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="f">규격<input value={edit.spec} onChange={(e) => setEdit({ ...edit, spec: e.target.value })} /></label>
          <label className="f">단위<input value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} /></label>
          <label className="f">수량<input className="num" value={edit.qty ?? ''} onChange={(e) => setEdit({ ...edit, qty: e.target.value })} /></label>
          <label className="f">재료비 단가<input className="num" value={edit.mat_price ?? ''} onChange={(e) => setEdit({ ...edit, mat_price: e.target.value })} /></label>
          <label className="f">노무비 단가<input className="num" value={edit.lab_price ?? ''} onChange={(e) => setEdit({ ...edit, lab_price: e.target.value })} /></label>
          <label className="f">경비 단가<input className="num" value={edit.exp_price ?? ''} onChange={(e) => setEdit({ ...edit, exp_price: e.target.value })} /></label>
          <label className="f">비고<input value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
          <label className="f">수정 사유 (이력 기록)<input value={edit.reason || ''} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></label>
        </div>
        <div className="help">금액은 현장 반올림 규칙으로 자동 재계산됩니다. 확정된 버전은 수정할 수 없고 설계변경으로 처리합니다.</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button onClick={() => setEdit(null)}>취소</button><button className="primary" onClick={saveEdit}>저장</button></div>
      </div></div>}
    </>
  )
}
