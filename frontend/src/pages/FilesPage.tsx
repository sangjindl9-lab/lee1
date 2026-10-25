import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, downloadFile, errMsg, FIELD_LABELS, fmt, ROLE_LABELS } from '../api'

const COL = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const MAP_FIELDS = ['name', 'spec', 'unit', 'qty', 'mat_price', 'mat_amt', 'lab_price', 'lab_amt', 'exp_price', 'exp_amt', 'tot_price', 'tot_amt', 'note', 'work_code', 'item_code', 'code']

export default function FilesPage() {
  const { pid } = useParams()
  const nav = useNavigate()
  const { reloadProject } = useOutletContext<any>()
  const [files, setFiles] = useState<any[]>([])
  const [sel, setSel] = useState<any>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null)
  const [mapSheet, setMapSheet] = useState<string | null>(null)
  const inp = useRef<HTMLInputElement>(null)
  const load = async () => {
    const r = await api.get(`/projects/${pid}/files`)
    setFiles(r.data)
    if (sel) { const s = r.data.find((f: any) => f.id === sel.id); setSel(s || null); if (s?.status === 'analyzed') loadAnalysis(s.id) }
    return r.data
  }
  const loadAnalysis = async (fid: number) => { const a = await api.get(`/files/${fid}/analysis`); setAnalysis(a.data) }
  useEffect(() => { load() }, [pid])
  useEffect(() => {
    if (!files.some((f) => f.status === 'analyzing' || f.status === 'uploaded')) return
    const t = setTimeout(load, 2500); return () => clearTimeout(t)
  }, [files])
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const fd = new FormData(); fd.append('file', f); fd.append('purpose', 'contract'); fd.append('sync', 'true')
    setBusy('업로드 및 분석 중... (큰 파일은 수십 초 걸릴 수 있습니다)')
    try {
      const r = await api.post(`/projects/${pid}/files`, fd)
      setMsg({ t: '분석이 완료되었습니다. 시트 인식 결과와 검증 결과를 확인한 뒤 "계약내역으로 가져오기"를 누르세요.', k: 'ok' })
      const list = await load(); const s = list.find((x: any) => x.id === r.data.id); setSel(s); loadAnalysis(s.id)
    } catch (err) { setMsg({ t: errMsg(err), k: 'err' }) } finally { setBusy(''); if (inp.current) inp.current.value = '' }
  }
  const select = async (f: any) => { setSel(f); setAnalysis(null); setMapSheet(null); if (f.status === 'analyzed') loadAnalysis(f.id) }
  const setRole = async (sheet: string, role: string) => {
    setBusy('재분석 중...')
    try { await api.put(`/files/${sel.id}/sheets/${encodeURIComponent(sheet)}`, { user_role: role || null }); await load() } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) } finally { setBusy('') }
  }
  const doImport = async () => {
    if (!confirm('이 파일의 공종별 내역서를 계약내역(최초계약)으로 가져옵니다. 이미 작성중(draft) 버전이 있으면 교체됩니다.')) return
    setBusy('가져오는 중...')
    try {
      const r = await api.post(`/files/${sel.id}/import`, { label: '최초계약' })
      setMsg({ t: `계약내역 v${r.data.version_no} 생성: 품목 ${r.data.item_count}개, 합계 ${fmt(r.data.totals.tot_amt)}원`, k: 'ok' })
      reloadProject()
      setTimeout(() => nav(`/projects/${pid}/estimate`), 800)
    } catch (e) { setMsg({ t: errMsg(e), k: 'err' }) } finally { setBusy('') }
  }
  const del = async (f: any) => {
    if (!confirm(`${f.name} 파일을 삭제할까요?\n이 파일에서 가져온 계약내역(내역서 버전)·원가비목·단가표도 함께 삭제됩니다.`)) return
    try { const r = await api.delete(`/files/${f.id}`); setSel(null); load(); alert(r.data.deleted_versions ? `파일과 계약내역 ${r.data.deleted_versions}개를 삭제했습니다.` : '파일을 삭제했습니다.') }
    catch (e) { alert(errMsg(e)) }
  }
  return (
    <>
      <div className="topbar"><h1>원본 내역서 관리</h1>
        <div className="actions"><input ref={inp} type="file" accept=".xlsx,.xlsm,.xls" onChange={upload} style={{ display: 'none' }} />
          <button className="primary" disabled={!!busy} onClick={() => inp.current?.click()}>+ 엑셀 업로드 (계약내역서)</button></div></div>
      {busy && <div className="alert info">{busy}</div>}
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      <div className="panel">
        <table className="t"><thead><tr><th>파일명</th><th>크기</th><th>상태</th><th>시트</th><th>내역서 시트</th><th>합계금액</th><th>업로드</th><th></th></tr></thead>
          <tbody>{files.map((f) => (
            <tr key={f.id} style={{ cursor: 'pointer', background: sel?.id === f.id ? '#eff6ff' : undefined }} onClick={() => select(f)}>
              <td>{f.name}</td><td className="r">{(f.size / 1024).toFixed(0)} KB</td>
              <td className="c"><span className={`badge ${f.status === 'analyzed' ? 'ok' : f.status === 'error' ? 'err' : 'warn'}`}>{{ uploaded: '대기', analyzing: '분석중', analyzed: '분석완료', error: '오류' }[f.status as string]}</span></td>
              <td className="c">{f.summary.sheet_count ?? ''}</td><td>{(f.summary.estimate_sheets || []).join(', ')}</td>
              <td className="r">{fmt(f.summary.grand_totals?.tot_amt)}</td><td className="c">{f.uploaded_at.slice(0, 16).replace('T', ' ')}</td>
              <td className="c"><button className="sm" onClick={(e) => { e.stopPropagation(); downloadFile(`/files/${f.id}/download`) }}>원본</button> <button className="sm danger" onClick={(e) => { e.stopPropagation(); del(f) }}>삭제</button></td>
            </tr>))}
            {files.length === 0 && <tr><td colSpan={8} className="muted">업로드된 파일이 없습니다.</td></tr>}</tbody></table>
        {sel?.status === 'error' && <div className="alert err" style={{ marginTop: 10 }}>{sel.error}</div>}
      </div>
      {sel && analysis && analysis.status === 'analyzed' && (
        <>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div className="row">
              <span className="badge info">원본은 변경되지 않습니다</span>
              {analysis.file.has_macro && <span className="badge warn">매크로 파일</span>}
              {analysis.has_cost_sheet ? <span className="badge ok">원가계산서 인식</span> : <span className="badge warn">원가계산서 없음</span>}
              {analysis.has_unit_price ? <span className="badge ok">일위대가 인식 ({String(Object.values(analysis.unit_price_count as Record<string, number>).reduce((a, b) => a + b, 0))}호)</span> : <span className="badge warn">일위대가 없음</span>}
            </div>
            <div className="row"><button onClick={() => api.post(`/files/${sel.id}/analyze`).then(load)}>재분석</button>
              <button className="primary" disabled={!analysis.estimate_sheets?.length} onClick={doImport}>계약내역으로 가져오기 →</button></div>
          </div>
          {analysis.file.warnings.length > 0 && <div className="alert warn"><b>주의</b><ul className="plain">{analysis.file.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></div>}
          {analysis.unidentified.length > 0 && <div className="alert warn"><b>확인 필요</b><ul className="plain">{analysis.unidentified.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></div>}
          <div className="grid2">
            <div className="panel">
              <h2>시트 인식 결과 <span className="muted" style={{ fontWeight: 400 }}>— 역할이 틀리면 직접 지정하세요</span></h2>
              <div className="tbl-wrap" style={{ maxHeight: 420 }}>
                <table className="t"><thead><tr><th>시트</th><th>자동 인식</th><th>신뢰도</th><th>사용 역할</th><th>품목</th><th>검증</th><th></th></tr></thead>
                  <tbody>{analysis.roles.map((r: any) => {
                    const sh = sel.sheets.find((s: any) => s.name === r.sheet) || {}
                    const isEst = analysis.estimate_sheets.includes(r.sheet)
                    return (<tr key={r.sheet} style={{ opacity: sh.hidden ? 0.6 : 1 }}>
                      <td>{r.sheet} {sh.hidden && <span className="badge">숨김</span>} {isEst && <span className="badge ok">계약내역</span>}</td>
                      <td>{r.label}</td>
                      <td className="c"><span className={`badge ${r.confidence >= 0.8 ? 'ok' : r.confidence >= 0.5 ? 'warn' : 'err'}`}>{Math.round(r.confidence * 100)}%</span></td>
                      <td><select value={sh.user_role || ''} onChange={(e) => setRole(r.sheet, e.target.value)}>
                        <option value="">(자동)</option>{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                      <td className="r">{sh.item_count ?? ''}</td>
                      <td className="c">{sh.finding_count > 0 ? <span className="badge warn">{sh.finding_count}건</span> : sh.item_count ? <span className="badge ok">OK</span> : ''}</td>
                      <td className="c">{analysis.column_maps[r.sheet] && <button className="sm" onClick={() => setMapSheet(r.sheet)}>열 매핑</button>}</td>
                    </tr>)
                  })}</tbody></table>
              </div>
            </div>
            <div>
              <div className="panel">
                <h2>금액 검증</h2>
                <table className="t"><thead><tr><th>구분</th><th>내역서 합계</th><th>원가계산서</th><th>결과</th></tr></thead>
                  <tbody>
                    {(['mat_amt', 'lab_amt', 'exp_amt', 'tot_amt'] as const).map((k) => {
                      const cc = analysis.cost_compare.find((c: any) => c.field === k)
                      return <tr key={k}><td>{FIELD_LABELS[k]}</td><td className="r">{fmt(analysis.grand_totals[k])}</td>
                        <td className="r">{cc ? fmt(cc.cost_amount) : '-'}</td>
                        <td className="c">{cc ? (cc.matched === 'all' ? <span className="badge ok">일치</span> : cc.matched === 'excluding_sections' ? <span className="badge ok" title={`제외: ${cc.excluded_sections.join(', ')}`}>관급 등 제외 시 일치</span> : <span className="badge err">불일치 (차이 {fmt(cc.diff)})</span>) : ''}</td></tr>
                    })}
                  </tbody></table>
                {analysis.section_totals?.length > 0 && <><div className="help" style={{ marginTop: 8 }}>최상위 공종별 합계</div>
                  <table className="t"><tbody>{analysis.section_totals.map((s: any, i: number) => <tr key={i}><td>{s.sheet !== analysis.primary_estimate || analysis.estimate_sheets.length > 1 ? `[${s.sheet}] ` : ''}{s.section}</td><td className="r">{fmt(s.tot_amt)}</td><td className="r muted">{s.items}개</td></tr>)}</tbody></table></>}
              </div>
              {Object.entries(analysis.validations).filter(([s]: any) => analysis.estimate_sheets.includes(s)).map(([s, v]: any) => (
                <div className="panel" key={s}>
                  <h2>검증 상세 — {s} <span className="muted" style={{ fontWeight: 400 }}>품목 {v.item_count} · 공종 {v.section_count} · 검사 {v.checked}건 · 소계 {v.subtotal_checked}개</span></h2>
                  <div className="help">감지된 금액 반올림: {Object.entries(v.rounding).map(([k, r]: any) => `${FIELD_LABELS[k] || k}=${r.func}${r.digits ? `(${r.digits})` : ''}`).join(', ') || '없음'}</div>
                  {v.finding_count === 0 ? <div className="ok" style={{ marginTop: 6 }}>✔ 수량×단가=금액, 소계 대조 모두 일치</div> : (
                    <div className="tbl-wrap" style={{ maxHeight: 220, marginTop: 6 }}><table className="t"><tbody>{v.findings.slice(0, 100).map((f: any, i: number) => <tr key={i}><td><span className={`badge ${f.type === 'rate_row' ? '' : 'warn'}`}>{{ amount_mismatch: '금액 불일치', total_mismatch: '합계 불일치', subtotal_mismatch: '소계 불일치', item_issue: '항목', rate_row: '요율행' }[f.type as string] || f.type}</span></td><td>{f.message}</td></tr>)}</tbody></table></div>)}
                </div>))}
            </div>
          </div>
        </>
      )}
      {mapSheet && sel && analysis && <MappingEditor file={sel} sheet={mapSheet} cm={analysis.column_maps[mapSheet]} onClose={() => setMapSheet(null)} onSaved={() => { setMapSheet(null); load() }} />}
    </>
  )
}

function MappingEditor({ file, sheet, cm, onClose, onSaved }: any) {
  const [pv, setPv] = useState<any>(null)
  const [map, setMap] = useState<Record<string, number | null>>(() => Object.fromEntries(Object.entries(cm.fields).map(([k, v]: any) => [k, v.col])))
  const [saveRule, setSaveRule] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => { api.get(`/files/${file.id}/preview`, { params: { sheet, rows: 12, cols: 32 } }).then((r) => setPv(r.data)) }, [sheet])
  const save = async () => {
    try { await api.put(`/files/${file.id}/sheets/${encodeURIComponent(sheet)}`, { user_column_map: map, save_as_rule: saveRule }); onSaved() } catch (e) { setErr(errMsg(e)) }
  }
  const used = new Map<number, string>(); Object.entries(map).forEach(([k, v]) => { if (v) used.set(v, k) })
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal" style={{ width: 'min(1100px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
      <h3>열 매핑 편집 — {sheet} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>헤더 {cm.header_row}행 · 데이터 {cm.data_start_row}행부터</span></h3>
      <div className="help">각 표준 항목이 원본의 어느 열인지 지정합니다. 저장하면 재분석되고, "양식 규칙으로 저장"을 켜면 같은 헤더 구조의 파일에 자동 적용됩니다.</div>
      <div className="row" style={{ margin: '10px 0', gap: 10 }}>
        {MAP_FIELDS.map((f) => (<label className="f" key={f}>{FIELD_LABELS[f]}
          <select value={map[f] ?? ''} onChange={(e) => setMap({ ...map, [f]: e.target.value ? Number(e.target.value) : null })}>
            <option value="">(없음)</option>
            {pv && Array.from({ length: pv.rows[0]?.length || 30 }, (_, i) => i + 1).map((c) => <option key={c} value={c}>{COL(c)} {cm.raw_headers[COL(c)] ? `· ${cm.raw_headers[COL(c)]}` : ''}{used.get(c) && used.get(c) !== f ? ` (=${FIELD_LABELS[used.get(c)!]})` : ''}</option>)}
          </select></label>))}
      </div>
      {pv && <div className="tbl-wrap" style={{ maxHeight: 300 }}><table className="t"><thead><tr><th>행</th>{pv.rows[0].map((_: any, i: number) => <th key={i}>{COL(i + 1)}<br /><span style={{ fontWeight: 400, color: '#1d4ed8' }}>{used.get(i + 1) ? FIELD_LABELS[used.get(i + 1)!] : ''}</span></th>)}</tr></thead>
        <tbody>{pv.rows.map((row: string[], ri: number) => <tr key={ri} className={ri + 1 === cm.header_row ? 'sec' : ''}><td className="c">{ri + 1}</td>{row.map((c, ci) => <td key={ci} style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</td>)}</tr>)}</tbody></table></div>}
      {err && <div className="err">{err}</div>}
      <div className="row between" style={{ marginTop: 12 }}>
        <label className="row"><input type="checkbox" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} /> 양식 규칙으로 저장 (다음 업로드부터 자동 적용)</label>
        <div className="row"><button onClick={onClose}>취소</button><button className="primary" onClick={save}>저장 후 재분석</button></div></div>
    </div></div>
  )
}
