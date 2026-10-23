import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errMsg, fmt } from '../api'

export default function ChangesPage() {
  const { pid } = useParams()
  const nav = useNavigate()
  const [changes, setChanges] = useState<any[]>([])
  const [versions, setVersions] = useState<any[]>([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState<any>({ title: '', reason: '', applied_date: '', price_rule: 'contract' })
  const [err, setErr] = useState('')
  const load = () => { api.get(`/projects/${pid}/changes`).then((r) => setChanges(r.data)); api.get(`/projects/${pid}/versions`).then((r) => setVersions(r.data)) }
  useEffect(() => { load() }, [pid])
  const create = async () => { try { const r = await api.post(`/projects/${pid}/changes`, form); nav(`/projects/${pid}/changes/${r.data.id}`) } catch (e) { setErr(errMsg(e)) } }
  const open = changes.some((c) => c.status !== 'approved')
  return (
    <>
      <div className="topbar"><h1>설계변경 작성</h1><button className="primary" disabled={!versions.length || open} onClick={() => setShow(true)}>+ 설계변경 차수 생성</button></div>
      {!versions.length && <div className="alert warn">계약내역이 없습니다. <Link to={`/projects/${pid}/files`}>원본 내역서 관리</Link>에서 가져오기 하세요.</div>}
      <div className="panel">
        <table className="t"><thead><tr><th>차수</th><th>제목</th><th>기준 버전</th><th>상태</th><th>당초금액</th><th>변경금액</th><th>증감</th><th>변경/신규/삭제</th><th>승인일</th></tr></thead>
          <tbody>{changes.map((c) => {
            const bv = versions.find((v) => v.id === c.base_version_id)
            return <tr key={c.id}><td className="c"><Link to={`/projects/${pid}/changes/${c.id}`}>{c.change_no}차</Link></td><td>{c.title}</td><td className="c">{bv ? `v${bv.version_no} ${bv.label}` : ''}</td>
              <td className="c"><span className={`badge ${c.status === 'approved' ? 'ok' : 'warn'}`}>{c.status === 'approved' ? '승인(변경계약 확정)' : '작성중'}</span></td>
              <td className="r">{fmt(c.totals?.orig?.tot_amt)}</td><td className="r">{fmt(c.totals?.chg?.tot_amt)}</td><td className={`r ${+(c.totals?.diff?.tot_amt || 0) < 0 ? 'err' : 'ok'}`}>{fmt(c.totals?.diff?.tot_amt)}</td>
              <td className="c">{c.totals?.counts ? `${c.totals.counts.modify} / ${c.totals.counts.add} / ${c.totals.counts.delete}` : ''}</td><td className="c">{c.approved_at?.slice(0, 10) || ''}</td></tr>
          })}{changes.length === 0 && <tr><td colSpan={9} className="muted">설계변경이 없습니다.</td></tr>}</tbody></table>
      </div>
      <div className="panel"><h2>계약내역 버전 이력</h2>
        <table className="t"><thead><tr><th>버전</th><th>구분</th><th>상태</th><th>재료비</th><th>노무비</th><th>경비</th><th>합계</th></tr></thead>
          <tbody>{versions.map((v) => <tr key={v.id}><td className="c">v{v.version_no}</td><td>{v.label}</td><td className="c"><span className={`badge ${v.status === 'approved' ? 'ok' : 'warn'}`}>{v.status === 'approved' ? '확정' : '작성중'}</span></td>
            <td className="r">{fmt(v.totals?.mat_amt)}</td><td className="r">{fmt(v.totals?.lab_amt)}</td><td className="r">{fmt(v.totals?.exp_amt)}</td><td className="r">{fmt(v.totals?.tot_amt)}</td></tr>)}</tbody></table></div>
      {show && <div className="modal-bg" onClick={() => setShow(false)}><div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{changes.length + 1}차 설계변경 생성</h3>
        <div className="help" style={{ marginBottom: 8 }}>기준은 직전 확정 계약내역(최신 버전)입니다. 작성중인 계약내역이 있으면 자동으로 확정됩니다.</div>
        <div className="grid2">
          <label className="f">제목<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 현장 여건 변경에 따른 1차 설계변경" /></label>
          <label className="f">적용(승인 예정)일<input type="date" value={form.applied_date} onChange={(e) => setForm({ ...form, applied_date: e.target.value })} /></label>
          <label className="f">단가 적용 규칙 (기본)<select value={form.price_rule} onChange={(e) => setForm({ ...form, price_rule: e.target.value })}>
            <option value="contract">기존 계약단가 유지 (국가계약법 시행령 제65조 검토)</option><option value="negotiated">협의단가</option><option value="bid_rate">낙찰률 적용단가</option></select></label>
        </div>
        <label className="f" style={{ marginTop: 8 }}>변경 사유<textarea rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button onClick={() => setShow(false)}>취소</button><button className="primary" onClick={create}>생성</button></div>
      </div></div>}
    </>
  )
}
