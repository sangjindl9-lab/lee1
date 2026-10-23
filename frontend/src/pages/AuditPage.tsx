import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

export default function AuditPage() {
  const { pid } = useParams()
  const [logs, setLogs] = useState<any[]>([])
  useEffect(() => { api.get(`/projects/${pid}/audit`).then((r) => setLogs(r.data)) }, [pid])
  return (
    <>
      <div className="topbar"><h1>변경이력</h1></div>
      <div className="panel"><div className="tbl-wrap"><table className="t"><thead><tr><th>일시</th><th>사용자</th><th>작업</th><th>대상</th><th>변경 전</th><th>변경 후</th><th>사유</th></tr></thead>
        <tbody>{logs.map((l) => <tr key={l.id}><td className="c">{l.at.slice(0, 19).replace('T', ' ')}</td><td>{l.user}</td><td>{l.action}</td><td>{l.target}</td>
          <td className="muted" style={{ maxWidth: 260, whiteSpace: 'normal', fontSize: 11 }}>{l.before ? JSON.stringify(l.before).slice(0, 200) : ''}</td>
          <td className="muted" style={{ maxWidth: 260, whiteSpace: 'normal', fontSize: 11 }}>{l.after ? JSON.stringify(l.after).slice(0, 200) : ''}</td><td>{l.reason}</td></tr>)}</tbody></table></div></div>
    </>
  )
}
