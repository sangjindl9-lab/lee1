import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errMsg, fmt } from '../api'

const EMPTY = { name: '', client: '', contractor: '', work_type: '전기', contract_type: '국가계약', contract_amount: '', start_date: '', end_date: '' }

export default function Dashboard() {
  const [data, setData] = useState<any>({ projects: [], recent_files: [] })
  const [show, setShow] = useState(false)
  const [form, setForm] = useState<any>(EMPTY)
  const [err, setErr] = useState('')
  const load = () => api.get('/dashboard').then((r) => setData(r.data))
  useEffect(() => { load() }, [])
  const create = async () => {
    try {
      await api.post('/projects', { ...form, contract_amount: form.contract_amount ? Number(form.contract_amount) : null })
      setShow(false); setForm(EMPTY); load()
    } catch (e) { setErr(errMsg(e)) }
  }
  const ps = data.projects
  const sum = (k: string) => ps.reduce((a: number, p: any) => a + parseFloat(p[k] || 0), 0)
  return (
    <>
      <div className="topbar"><h1>대시보드</h1><button className="primary" onClick={() => setShow(true)}>+ 공사 등록</button></div>
      <div className="kpis">
        <div className="kpi"><div className="l">현장 수</div><div className="v">{ps.length}</div></div>
        <div className="kpi"><div className="l">계약금액 합계(현재)</div><div className="v small">{fmt(sum('current_amount'))} 원</div></div>
        <div className="kpi"><div className="l">누계기성 합계</div><div className="v small">{fmt(sum('cum_progress_amount'))} 원</div></div>
        <div className="kpi"><div className="l">잔여계약 합계</div><div className="v small">{fmt(sum('remaining_amount'))} 원</div></div>
      </div>
      <div className="cards">
        {ps.map((p: any) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card" style={{ color: 'inherit' }}>
            <h3>{p.name}</h3>
            <div className="meta">
              <span>발주처 {p.client || '-'}</span><span>{p.work_type} / {p.contract_type}</span>
              <span>계약금액 {fmt(p.original_amount)}</span><span>변경계약 {fmt(p.current_amount)}</span>
              <span>누계기성 {fmt(p.cum_progress_amount)}</span><span>잔여 {fmt(p.remaining_amount)}</span>
            </div>
            <div className="bar"><div style={{ width: `${Math.min(100, parseFloat(p.cum_rate))}%` }} /></div>
            <div className="row between" style={{ fontSize: 12 }}>
              <span>기성률 <b>{p.cum_rate}%</b> · 기성 {p.confirmed_claims}/{p.claim_count}회</span>
              <span>{p.current_version ? <span className="badge info">{p.current_version.label}</span> : <span className="badge warn">내역서 미등록</span>}
                {p.open_changes > 0 && <span className="badge warn" style={{ marginLeft: 4 }}>설계변경 진행중</span>}</span>
            </div>
          </Link>
        ))}
        {ps.length === 0 && <div className="panel muted">등록된 공사가 없습니다. "공사 등록" 후 계약내역서 엑셀을 업로드하세요.</div>}
      </div>
      {data.recent_files.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h2>최근 업로드</h2>
          <table className="t"><thead><tr><th>파일</th><th>용도</th><th>상태</th><th>일시</th></tr></thead>
            <tbody>{data.recent_files.map((f: any) => (
              <tr key={f.id}><td><Link to={`/projects/${f.project_id}/files`}>{f.name}</Link></td><td className="c">{f.purpose}</td>
                <td className="c"><span className={`badge ${f.status === 'analyzed' ? 'ok' : f.status === 'error' ? 'err' : ''}`}>{f.status}</span></td>
                <td className="c">{f.at.slice(0, 16).replace('T', ' ')}</td></tr>))}</tbody></table>
        </div>
      )}
      {show && (
        <div className="modal-bg" onClick={() => setShow(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>공사 등록</h3>
            <div className="grid2">
              <label className="f">공사명 *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="f">발주처<input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></label>
              <label className="f">계약상대자<input value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} /></label>
              <label className="f">사업종류<select value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value })}>
                {['전기', '정보통신', '소방', '건축', '토목', '기계', '기타'].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="f">계약 구분<select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
                {['국가계약', '지방계약', '민간계약', '하도급계약'].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="f">계약금액 (비우면 내역서 합계 사용)<input type="number" value={form.contract_amount} onChange={(e) => setForm({ ...form, contract_amount: e.target.value })} /></label>
              <label className="f">착공일<input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
              <label className="f">준공일<input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
            </div>
            {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setShow(false)}>취소</button><button className="primary" disabled={!form.name} onClick={create}>등록</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
