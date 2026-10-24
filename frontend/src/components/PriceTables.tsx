import { useEffect, useState } from 'react'
import { api, fmt } from '../api'

export default function PriceTables({ pid, kind }: { pid: string; kind: 'material' | 'labor' | 'etc' }) {
  const [tables, setTables] = useState<any[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [data, setData] = useState<any>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    api.get(`/projects/${pid}/price-tables`).then((r) => {
      const list = r.data.filter((t: any) => (kind === 'etc' ? !['material', 'labor'].includes(t.kind) : t.kind === kind))
      setTables(list); setSel(list[0]?.id ?? null); setData(null)
    })
  }, [pid, kind])
  useEffect(() => { if (sel) api.get(`/price-tables/${sel}`, { params: { q: q || undefined } }).then((r) => setData(r.data)) }, [sel, q])
  if (!tables.length) return <div className="panel muted">이 종류의 시트가 원본에서 인식되지 않았습니다. 원본 내역서 관리에서 해당 시트의 역할을 "자재단가/단가조사" 또는 "노임단가"로 지정한 뒤 다시 가져오기 하세요.</div>
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <select value={sel ?? ''} onChange={(e) => { setSel(Number(e.target.value)); setQ('') }}>{tables.map((t) => <option key={t.id} value={t.id}>{t.sheet} ({t.row_count}행)</option>)}</select>
        <input placeholder="품명·규격·직종 검색 (띄어쓰기로 여러 단어)" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
        {data && <span className="muted">{data.title} · {data.matched}/{data.total}행</span>}
      </div>
      {data && <div className="tbl-wrap"><table className="t">
        <thead><tr><th>행</th>{data.columns.map((c: any) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>{(() => {
          let lastGroup = ''
          return data.rows.map((r: any) => {
            const g = r._group && r._group !== lastGroup ? (lastGroup = r._group) : null
            return <>{g && <tr key={`g${r._row}`} className="sec"><td colSpan={data.columns.length + 1}>{g}</td></tr>}
              <tr key={r._row}><td className="c muted">{r._row}</td>{data.columns.map((c: any) => { const v = r[c.key]; return <td key={c.key} className={typeof v === 'number' ? 'r' : ''}>{typeof v === 'number' ? fmt(v, 4) : (v ?? '')}</td> })}</tr></>
          })
        })()}</tbody>
      </table></div>}
    </>
  )
}
