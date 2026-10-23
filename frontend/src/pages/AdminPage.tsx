import { useEffect, useState } from 'react'
import { api, errMsg } from '../api'

export default function AdminPage() {
  const [users, setUsers] = useState<any[]>([])
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'user' })
  const [rules, setRules] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const load = () => { api.get('/admin/users').then((r) => setUsers(r.data)); api.get('/mapping-rules').then((r) => setRules(r.data)) }
  useEffect(() => { load() }, [])
  const create = async () => { try { await api.post('/admin/users', form); setForm({ username: '', password: '', display_name: '', role: 'user' }); load(); setMsg('사용자가 추가되었습니다.') } catch (e) { setMsg(errMsg(e)) } }
  const upd = async (u: any, body: any) => { try { await api.put(`/admin/users/${u.id}`, body); load() } catch (e) { setMsg(errMsg(e)) } }
  return (
    <>
      <div className="topbar"><h1>관리자 설정</h1></div>
      {msg && <div className="alert info">{msg}</div>}
      <div className="grid2">
        <div className="panel"><h2>사용자 관리</h2>
          <table className="t"><thead><tr><th>아이디</th><th>이름</th><th>역할</th><th>활성</th><th></th></tr></thead>
            <tbody>{users.map((u) => <tr key={u.id}><td>{u.username}</td><td>{u.display_name}</td>
              <td className="c"><select value={u.role} onChange={(e) => upd(u, { role: e.target.value })}><option value="admin">관리자</option><option value="user">사용자</option><option value="viewer">조회</option></select></td>
              <td className="c"><input type="checkbox" checked={u.is_active} onChange={(e) => upd(u, { is_active: e.target.checked })} /></td>
              <td className="c"><button className="sm" onClick={() => { const p = prompt('새 비밀번호'); if (p) upd(u, { password: p }) }}>비밀번호</button></td></tr>)}</tbody></table>
          <h2 style={{ marginTop: 14 }}>사용자 추가</h2>
          <div className="row"><input placeholder="아이디" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /><input placeholder="비밀번호" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <input placeholder="이름" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="user">사용자</option><option value="admin">관리자</option><option value="viewer">조회</option></select>
            <button className="primary" disabled={!form.username || !form.password} onClick={create}>추가</button></div>
          <div className="help">현장별 접근 권한(조회/편집/승인)은 각 공사의 "공사 개요" 화면에서 지정합니다.</div>
        </div>
        <div className="panel"><h2>저장된 엑셀 열 매핑 규칙</h2>
          <table className="t"><thead><tr><th>양식(파일/시트)</th><th>역할</th><th>매핑</th></tr></thead>
            <tbody>{rules.map((r) => <tr key={r.id}><td>{r.name}</td><td className="c">{r.role}</td><td className="muted">{JSON.stringify(r.column_map)}</td></tr>)}{rules.length === 0 && <tr><td colSpan={3} className="muted">저장된 규칙이 없습니다. 원본 내역서 관리 → 열 매핑에서 "양식 규칙으로 저장"을 사용하세요.</td></tr>}</tbody></table>
        </div>
      </div>
    </>
  )
}
