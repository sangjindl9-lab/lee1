import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, errMsg, fmt } from '../api'

export default function ProjectHome() {
  const { pid } = useParams()
  const nav = useNavigate()
  const { reloadProject } = useOutletContext<any>()
  const [p, setP] = useState<any>(null)
  const [form, setForm] = useState<any>(null)
  const [versions, setVersions] = useState<any[]>([])
  const [claims, setClaims] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const load = async () => {
    const r = await api.get(`/projects/${pid}`)
    setP(r.data)
    setForm({ ...r.data, rounding_func: r.data.rounding?.amount?.func || 'trunc', rounding_digits: r.data.rounding?.amount?.digits ?? 0, qty_digits: r.data.rounding?.qty_digits ?? 4 })
    setVersions((await api.get(`/projects/${pid}/versions`)).data)
    setClaims((await api.get(`/projects/${pid}/claims`)).data)
    setMembers((await api.get(`/projects/${pid}/members`)).data)
    api.get('/admin/users').then((u) => setUsers(u.data)).catch(() => {})
  }
  useEffect(() => { load() }, [pid])
  if (!p || !form) return <div>불러오는 중...</div>
  const save = async () => {
    try {
      await api.put(`/projects/${pid}`, {
        name: form.name, client: form.client, contractor: form.contractor, work_type: form.work_type, contract_type: form.contract_type,
        contract_amount: Number(form.contract_amount), start_date: form.start_date || null, end_date: form.end_date || null,
        rounding: { amount: { func: form.rounding_func, digits: Number(form.rounding_digits) }, qty_digits: Number(form.qty_digits) },
      })
      setMsg('저장되었습니다.'); load(); reloadProject()
    } catch (e) { setMsg(errMsg(e)) }
  }
  const del = async () => {
    if (!confirm('이 공사와 모든 자료(파일·기성·설계변경)를 삭제합니다. 계속할까요?')) return
    await api.delete(`/projects/${pid}`); nav('/')
  }
  const addMember = async (uid: number, access: string) => { await api.post(`/projects/${pid}/members`, { user_id: uid, access }); load() }
  return (
    <>
      <div className="topbar"><h1>{p.name}</h1><div className="actions"><button className="danger" onClick={del}>공사 삭제</button></div></div>
      <div className="kpis">
        <div className="kpi"><div className="l">당초 계약금액</div><div className="v small">{fmt(p.original_amount)}</div></div>
        <div className="kpi"><div className="l">현재(변경) 계약금액</div><div className="v small">{fmt(p.current_amount)}</div></div>
        <div className="kpi"><div className="l">누계 기성금액</div><div className="v small">{fmt(p.cum_progress_amount)}</div></div>
        <div className="kpi"><div className="l">잔여 계약금액</div><div className="v small">{fmt(p.remaining_amount)}</div></div>
        <div className="kpi"><div className="l">누계 기성률</div><div className="v">{p.cum_rate}%</div></div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h2>공사 정보</h2>
          <div className="grid2">
            <label className="f">공사명<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="f">발주처<input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></label>
            <label className="f">계약상대자<input value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} /></label>
            <label className="f">사업종류<select value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value })}>{['전기', '정보통신', '소방', '건축', '토목', '기계', '기타'].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="f">계약 구분<select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>{['국가계약', '지방계약', '민간계약', '하도급계약'].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="f">계약금액<input type="number" value={form.contract_amount} onChange={(e) => setForm({ ...form, contract_amount: e.target.value })} /></label>
            <label className="f">착공일<input type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
            <label className="f">준공일<input type="date" value={form.end_date || ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
          </div>
          <h2 style={{ marginTop: 14 }}>금액 계산 규칙 (현장 설정)</h2>
          <div className="row">
            <label className="f">금액 처리<select value={form.rounding_func} onChange={(e) => setForm({ ...form, rounding_func: e.target.value })}>
              <option value="trunc">절사(TRUNC)</option><option value="round">반올림(ROUND)</option><option value="roundup">올림</option><option value="none">처리 안 함</option></select></label>
            <label className="f">금액 소수 자리<input type="number" className="num" value={form.rounding_digits} onChange={(e) => setForm({ ...form, rounding_digits: e.target.value })} /></label>
            <label className="f">수량 소수 자리<input type="number" className="num" value={form.qty_digits} onChange={(e) => setForm({ ...form, qty_digits: e.target.value })} /></label>
          </div>
          <div className="help">원본 내역서에서 감지한 규칙이 기본값으로 들어갑니다. 금액 = 수량 × 단가에 이 규칙을 적용합니다.</div>
          <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={save}>저장</button><span className="muted">{msg}</span></div>
        </div>
        <div>
          <div className="panel">
            <h2>계약내역 버전</h2>
            {versions.length === 0 ? <div className="muted">아직 계약내역서가 없습니다. <Link to={`/projects/${pid}/files`}>원본 내역서 관리</Link>에서 업로드하세요.</div> : (
              <table className="t"><thead><tr><th>버전</th><th>구분</th><th>상태</th><th>합계금액</th><th>품목</th></tr></thead>
                <tbody>{versions.map((v) => <tr key={v.id}><td className="c">v{v.version_no}</td><td>{v.label}</td>
                  <td className="c"><span className={`badge ${v.status === 'approved' ? 'ok' : 'warn'}`}>{v.status === 'approved' ? '확정' : '작성중'}</span></td>
                  <td className="r">{fmt(v.totals?.tot_amt)}</td><td className="r">{v.item_count}</td></tr>)}</tbody></table>)}
          </div>
          <div className="panel">
            <h2>기성 회차</h2>
            {claims.length === 0 ? <div className="muted">기성 회차가 없습니다.</div> : (
              <table className="t"><thead><tr><th>회차</th><th>기준일</th><th>상태</th><th>금회금액</th><th>누계금액</th><th>기성률</th></tr></thead>
                <tbody>{claims.map((c) => <tr key={c.id}><td className="c"><Link to={`/projects/${pid}/claims/${c.id}`}>{c.title}</Link></td><td className="c">{c.base_date || ''}</td>
                  <td className="c"><span className={`badge ${c.status === 'confirmed' ? 'ok' : 'warn'}`}>{c.status === 'confirmed' ? '확정' : '작성중'}</span></td>
                  <td className="r">{fmt(c.totals?.this_amt)}</td><td className="r">{fmt(c.totals?.cum_amt)}</td><td className="r">{c.totals?.cum_rate ? `${c.totals.cum_rate}%` : ''}</td></tr>)}</tbody></table>)}
          </div>
          <div className="panel">
            <h2>현장 접근 권한</h2>
            <table className="t"><thead><tr><th>사용자</th><th>권한</th></tr></thead>
              <tbody>{members.map((m) => <tr key={m.user_id}><td>{m.display_name || m.username}</td><td className="c">
                <select value={m.access} onChange={(e) => addMember(m.user_id, e.target.value)}><option value="view">조회</option><option value="edit">편집</option><option value="approve">승인</option></select>
                <button className="sm danger" style={{ marginLeft: 6 }} onClick={async () => { await api.delete(`/projects/${pid}/members/${m.user_id}`); load() }}>제거</button></td></tr>)}</tbody></table>
            {users.length > 0 && <div className="row" style={{ marginTop: 8 }}>
              <select id="addm" defaultValue=""><option value="" disabled>사용자 추가...</option>{users.filter((u) => !members.some((m) => m.user_id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}</select>
              <button className="sm" onClick={() => { const s = document.getElementById('addm') as HTMLSelectElement; if (s.value) addMember(Number(s.value), 'edit') }}>추가(편집)</button></div>}
          </div>
        </div>
      </div>
    </>
  )
}
