import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, errMsg, fmt } from '../api'

export default function CostRulesPage() {
  const { pid } = useParams()
  const [versions, setVersions] = useState<any[]>([])
  const [vid, setVid] = useState<number | null>(null)
  const [rules, setRules] = useState<any[]>([])
  const [edit, setEdit] = useState<any>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { api.get(`/projects/${pid}/versions`).then((r) => { setVersions(r.data); if (r.data.length) setVid(r.data[r.data.length - 1].id) }) }, [pid])
  useEffect(() => { if (vid) api.get(`/projects/${pid}/cost-rules`, { params: { version_id: vid } }).then((r) => setRules(r.data)) }, [vid])
  const save = async () => {
    try { const r = await api.put(`/cost-rules/${edit.id}`, { rate: edit.rate === '' ? null : +edit.rate, rate_base: edit.rate_base, fixed: edit.fixed, source: edit.source, effective_date: edit.effective_date || null }); setRules(rules.map((x) => (x.id === r.data.id ? r.data : x))); setEdit(null); setMsg('저장되었습니다.') } catch (e) { setMsg(errMsg(e)) }
  }
  return (
    <>
      <div className="topbar"><h1>원가계산서 · 제비율</h1>
        <select value={vid ?? ''} onChange={(e) => setVid(Number(e.target.value))}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.version_no} {v.label}</option>)}</select></div>
      <div className="alert info">원본 원가계산서에서 읽어온 비목·요율·산식입니다. 요율은 연도별 법정 기준에 따라 달라지므로 프로그램에 고정하지 않고, 적용 근거(출처·시행일)를 함께 기록하세요. "정산 비목"으로 지정하면 설계변경 시 재계산하지 않고 원본 금액을 유지합니다.</div>
      {msg && <div className="alert ok">{msg}</div>}
      <div className="panel">
        {rules.length === 0 ? <div className="muted">이 버전에 등록된 원가 비목이 없습니다. 원본 파일에 원가계산서 시트가 없거나 인식되지 않았습니다.</div> : (
          <table className="t"><thead><tr><th>#</th><th>비목</th><th>구분</th><th>금액</th><th>요율(%)</th><th>산정기준</th><th>원본 산식</th><th>정산</th><th>적용근거/출처</th><th>시행일</th><th></th></tr></thead>
            <tbody>{rules.map((r) => <tr key={r.id} className={r.kind !== 'line' ? 'sub' : ''}>
              <td className="c">{r.seq + 1}</td><td>{r.name}</td><td className="c">{{ line: '', subtotal: '소계', total: '합계' }[r.kind as string]}</td><td className="r">{fmt(r.amount)}</td>
              <td className="r">{r.rate ? +r.rate : ''}</td><td>{r.rate_base}</td><td className="muted">{r.base_text}</td><td className="c">{r.fixed ? '✔' : ''}</td><td>{r.source}</td><td className="c">{r.effective_date || ''}</td>
              <td className="c"><button className="sm" onClick={() => setEdit({ ...r, rate: r.rate ?? '' })}>수정</button></td></tr>)}</tbody></table>)}
      </div>
      {edit && <div className="modal-bg" onClick={() => setEdit(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{edit.name}</h3>
        <div className="grid2">
          <label className="f">요율(%)<input className="num" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} /></label>
          <label className="f">산정기준<select value={edit.rate_base} onChange={(e) => setEdit({ ...edit, rate_base: e.target.value })}>
            {['', '직접노무비', '노무비', '직접재료비', '재료+직노', '재료+노무', '재료+노무+경비', '노무+경비+일반관리비', '건강보험료', '총원가'].map((b) => <option key={b} value={b}>{b || '(없음 - 고정금액)'}</option>)}</select></label>
          <label className="f">적용 근거 / 출처<input value={edit.source || ''} onChange={(e) => setEdit({ ...edit, source: e.target.value })} placeholder="예: 고용노동부 고시 제2026-xx호" /></label>
          <label className="f">시행일<input type="date" value={edit.effective_date || ''} onChange={(e) => setEdit({ ...edit, effective_date: e.target.value })} /></label>
        </div>
        <label className="row" style={{ marginTop: 8 }}><input type="checkbox" checked={!!edit.fixed} onChange={(e) => setEdit({ ...edit, fixed: e.target.checked })} /> 정산 비목 (설계변경 시 재계산 제외, 원본 금액 유지)</label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button onClick={() => setEdit(null)}>취소</button><button className="primary" onClick={save}>저장</button></div>
      </div></div>}
    </>
  )
}
