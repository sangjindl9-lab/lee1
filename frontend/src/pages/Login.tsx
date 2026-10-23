import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errMsg } from '../api'

export default function Login() {
  const nav = useNavigate()
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const r = await api.post('/auth/login-json', { username: u, password: p })
      localStorage.setItem('token', r.data.access_token)
      nav('/')
    } catch (e) { setErr(errMsg(e)) }
  }
  return (
    <div className="login panel">
      <h1>공사내역서 재가공 시스템</h1>
      <p className="muted">기성내역서 · 설계변경내역서 자동 생성</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
        <label className="f">아이디<input value={u} onChange={(e) => setU(e.target.value)} autoFocus /></label>
        <label className="f">비밀번호<input type="password" value={p} onChange={(e) => setP(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        <button className="primary" type="submit">로그인</button>
      </form>
    </div>
  )
}
