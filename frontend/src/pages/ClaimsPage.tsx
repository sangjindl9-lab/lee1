import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errMsg, fmt } from '../api'

export default function ClaimsPage() {
  const { pid } = useParams()
  const nav = useNavigate()
  const [claims, setClaims] = useState<any[]>([])
  const [versions, setVersions] = useState<any[]>([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState<any>({ base_date: '', is_final: false, is_adjustment: false, input_mode: 'qty', memo: '', contract_version_id: '' })
  const [err, setErr] = useState('')
  const load = () => { api.get(`/projects/${pid}/claims`).then((r) => setClaims(r.data)); api.get(`/projects/${pid}/versions`).then((r) => setVersions(r.data)) }
  useEffect(() => { load() }, [pid])
  const create = async () => {
    try {
      const r = await api.post(`/projects/${pid}/claims`, { ...form, contract_version_id: form.contract_version_id ? Number(form.contract_version_id) : null })
      nav(`/projects/${pid}/claims/${r.data.id}`)
    } catch (e) { setErr(errMsg(e)) }
  }
  const latestApproved = [...versions].reverse().find((v) => v.status === 'approved') || versions[versions.length - 1]
  const canCreate = versions.length > 0 && !claims.some((c) => c.status !== 'confirmed')
  return (
    <>
      <div className="topbar"><h1>기성내역서 작성</h1>
        <button className="primary" disabled={!canCreate} title={!versions.length ? '계약내역을 먼저 가져오세요' : !canCreate ? '작성중인 회차를 먼저 확정하세요' : ''} onClick={() => setShow(true)}>+ 기성 회차 생성</button></div>
      {!versions.length && <div className="alert warn">계약내역이 없습니다. <Link to={`/projects/${pid}/files`}>원본 내역서 관리</Link>에서 가져오기 하세요.</div>}
      <div className="panel">
        <table className="t"><thead><tr><th>회차</th><th>기준일</th><th>계약내역 버전</th><th>상태</th><th>계약금액</th><th>전회누계</th><th>금회기성</th><th>누계기성</th><th>잔여</th><th>기성률</th><th>경고</th></tr></thead>
          <tbody>{claims.map((c) => {
            const v = versions.find((x) => x.id === c.contract_version_id)
            return <tr key={c.id}>
              <td><Link to={`/projects/${pid}/claims/${c.id}`}>{c.title}</Link>{c.is_adjustment && <span className="badge" style={{ marginLeft: 4 }}>정산</span>}</td>
              <td className="c">{c.base_date || ''}</td><td className="c">{v ? `v${v.version_no} ${v.label}` : ''}</td>
              <td className="c"><span className={`badge ${c.status === 'confirmed' ? 'ok' : 'warn'}`}>{c.status === 'confirmed' ? '확정' : '작성중'}</span></td>
              <td className="r">{fmt(c.totals?.contract_amt)}</td><td className="r">{fmt(c.totals?.prev_amt)}</td><td className="r"><b>{fmt(c.totals?.this_amt)}</b></td>
              <td className="r">{fmt(c.totals?.cum_amt)}</td><td className="r">{fmt(c.totals?.remain_amt)}</td><td className="r">{c.totals?.cum_rate ? `${c.totals.cum_rate}%` : ''}</td>
              <td className="c">{c.totals?.warning_count > 0 ? <span className="badge warn">{c.totals.warning_count}</span> : ''}</td></tr>
          })}{claims.length === 0 && <tr><td colSpan={11} className="muted">기성 회차가 없습니다.</td></tr>}</tbody></table>
      </div>
      <div className="panel"><h2>안내</h2><ul className="plain muted">
        <li>회차는 순서대로 생성·확정됩니다. 확정된 회차의 전회 값은 다음 회차에 자동 반영되며 임의로 바뀌지 않습니다.</li>
        <li>설계변경이 승인되면 이후 회차는 변경계약 수량을 기준으로 잔여수량을 계산하고, 확정된 기성 기록은 그대로 유지됩니다.</li>
        <li>정산(음수 허용) 회차나 준공 정산은 생성 시 옵션으로 지정합니다.</li></ul></div>
      {show && <div className="modal-bg" onClick={() => setShow(false)}><div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>기성 회차 생성 (제 {claims.length + 1} 회)</h3>
        <div className="grid2">
          <label className="f">기성 기준일<input type="date" value={form.base_date} onChange={(e) => setForm({ ...form, base_date: e.target.value })} /></label>
          <label className="f">계약내역 버전<select value={form.contract_version_id} onChange={(e) => setForm({ ...form, contract_version_id: e.target.value })}>
            <option value="">최신 확정 버전 ({latestApproved ? `v${latestApproved.version_no} ${latestApproved.label}` : '-'})</option>
            {versions.map((v) => <option key={v.id} value={v.id}>v{v.version_no} {v.label}</option>)}</select></label>
          <label className="f">기본 입력 방식<select value={form.input_mode} onChange={(e) => setForm({ ...form, input_mode: e.target.value })}>
            <option value="qty">A. 금회 수량 직접 입력</option><option value="cumulative">B. 누계 수량 입력</option><option value="rate">C. 기성률(%) 입력</option></select></label>
          <label className="f">메모<input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 16 }}>
          <label className="row"><input type="checkbox" checked={form.is_final} onChange={(e) => setForm({ ...form, is_final: e.target.checked })} /> 최종(준공) 정산 회차 — 계약수량 완료 시 단수 보정</label>
          <label className="row"><input type="checkbox" checked={form.is_adjustment} onChange={(e) => setForm({ ...form, is_adjustment: e.target.checked })} /> 수정/정산 회차 — 음수 수량 허용</label>
        </div>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button onClick={() => setShow(false)}>취소</button><button className="primary" onClick={create}>생성</button></div>
      </div></div>}
    </>
  )
}
