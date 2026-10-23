import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'

export default function Layout() {
  const { pid } = useParams()
  const nav = useNavigate()
  const [me, setMe] = useState<any>(null)
  const [proj, setProj] = useState<any>(null)
  useEffect(() => { api.get('/auth/me').then((r) => setMe(r.data)).catch(() => {}) }, [])
  useEffect(() => {
    if (pid) api.get(`/projects/${pid}`).then((r) => setProj(r.data)).catch(() => setProj(null))
    else setProj(null)
  }, [pid])
  const logout = () => { localStorage.removeItem('token'); nav('/login') }
  const L = ({ to, children, end }: any) => <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{children}</NavLink>
  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">공사내역서 재가공<small>기성 · 설계변경 관리 시스템</small></div>
        <L to="/" end>대시보드 (현장 목록)</L>
        {proj && (
          <>
            <div className="proj" title={proj.name}>{proj.name}</div>
            <L to={`/projects/${pid}`} end>① 공사 개요</L>
            <L to={`/projects/${pid}/files`}>② 원본 내역서 관리</L>
            <L to={`/projects/${pid}/estimate`}>③ 내역서 분석·편집</L>
            <L to={`/projects/${pid}/claims`}>④ 기성내역서 작성</L>
            <L to={`/projects/${pid}/changes`}>⑤ 설계변경 작성</L>
            <L to={`/projects/${pid}/unit-prices`}>⑥ 일위대가 관리</L>
            <L to={`/projects/${pid}/cost-rules`}>⑦ 원가계산서·제비율</L>
            <L to={`/projects/${pid}/audit`}>⑧ 변경이력</L>
          </>
        )}
        {me?.role === 'admin' && (<><div className="grp">관리</div><L to="/admin">⑨ 관리자 설정</L></>)}
        <div className="user">
          {me ? <>{me.display_name || me.username} ({me.role})<br /></> : null}
          <button className="sm" style={{ marginTop: 6 }} onClick={logout}>로그아웃</button>
        </div>
      </aside>
      <main className="main"><Outlet context={{ me, proj, reloadProject: () => pid && api.get(`/projects/${pid}`).then((r) => setProj(r.data)) }} /></main>
    </div>
  )
}
