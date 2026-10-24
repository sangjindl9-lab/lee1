import { useEffect, useState } from 'react'
import PriceTables from '../components/PriceTables'
import { useParams } from 'react-router-dom'
import { api, errMsg, fmt, fq } from '../api'

const EMPTY_C = { name: '', spec: '', unit: '', qty: '', mat_price: '', lab_price: '', exp_price: '' }

export default function UnitPricesPage() {
  const { pid } = useParams()
  const [list, setList] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<any>(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState<any>({ title: '', components: [{ ...EMPTY_C }] })
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState<'unit' | 'material' | 'labor' | 'etc'>('unit')
  const load = () => api.get(`/projects/${pid}/unit-prices`).then((r) => setList(r.data))
  useEffect(() => { load() }, [pid])
  const filtered = list.filter((u) => !q || u.title.toLowerCase().includes(q.toLowerCase()) || u.no.includes(q))
  const create = async () => {
    try {
      const r = await api.post(`/projects/${pid}/unit-prices`, { title: form.title, components: form.components.filter((c: any) => c.name).map((c: any) => ({ ...c, qty: +c.qty, mat_price: +c.mat_price || 0, lab_price: +c.lab_price || 0, exp_price: +c.exp_price || 0 })) })
      setShow(false); setForm({ title: '', components: [{ ...EMPTY_C }] }); load(); setSel(r.data); setMsg(`신규 일위대가 ${r.data.no} 작성 — 합계 ${fmt(r.data.total.tot_amt)}원. 설계변경 신규 품목의 단가 산정 근거로 사용하세요.`)
    } catch (e) { setMsg(errMsg(e)) }
  }
  const copyFrom = (u: any) => { setForm({ title: `${u.title} (복사)`, components: u.components.map((c: any) => ({ name: c.name, spec: c.spec, unit: c.unit, qty: c.qty || '', mat_price: c.mat_price || '', lab_price: c.lab_price || '', exp_price: c.exp_price || '' })) }); setShow(true) }
  return (
    <>
      <div className="topbar"><h1>일위대가 · 단가표 관리</h1><div className="actions">{tab === 'unit' && <><input placeholder="호표/명칭 검색" value={q} onChange={(e) => setQ(e.target.value)} /><button className="primary" onClick={() => setShow(true)}>+ 신규 일위대가 작성</button></>}</div></div>
      <div className="tabs"><button className={tab === 'unit' ? 'on' : ''} onClick={() => setTab('unit')}>일위대가</button><button className={tab === 'material' ? 'on' : ''} onClick={() => setTab('material')}>자재단가 (합산자재·단가조사·단가대비표)</button><button className={tab === 'labor' ? 'on' : ''} onClick={() => setTab('labor')}>노임단가 (노임근거·일위노임)</button><button className={tab === 'etc' ? 'on' : ''} onClick={() => setTab('etc')}>기타 참조표 (목차·산출서)</button></div>
      {tab !== 'unit' && <PriceTables pid={pid!} kind={tab === 'etc' ? 'etc' : tab} />}
      {tab === 'unit' && <>
      <div className="alert info">원본에서 읽은 일위대가는 기존 계약단가의 근거로 보존되며 수정하지 않습니다. 단가 변경이 필요하면 "복사"해서 신규 일위대가를 만들고 설계변경에서 "신규 일위대가 단가"로 연결하세요 (기존 계약단가는 그대로 유지됩니다).</div>
      {msg && <div className="alert ok">{msg}</div>}
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
        <div className="panel"><div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="t"><thead><tr><th>호표</th><th>명칭</th><th>재료비</th><th>노무비</th><th>합계</th><th></th></tr></thead>
            <tbody>{filtered.map((u) => <tr key={u.id} style={{ cursor: 'pointer', background: sel?.id === u.id ? '#eff6ff' : undefined }} onClick={() => setSel(u)}>
              <td className="c">{u.is_new ? <span className="badge info">{u.no}</span> : u.no}</td><td>{u.title}</td><td className="r">{fmt(u.total.mat_amt)}</td><td className="r">{fmt(u.total.lab_amt)}</td><td className="r">{fmt(u.total.tot_amt)}</td>
              <td className="c"><button className="sm" onClick={(e) => { e.stopPropagation(); copyFrom(u) }}>복사</button></td></tr>)}
              {filtered.length === 0 && <tr><td colSpan={6} className="muted">일위대가가 없습니다.</td></tr>}</tbody></table></div></div>
        <div className="panel">
          {!sel ? <div className="muted">왼쪽에서 일위대가를 선택하세요.</div> : <>
            <h2>{sel.no} {sel.title} <span className="muted" style={{ fontWeight: 400 }}>({sel.sheet})</span></h2>
            <table className="t"><thead><tr><th>구성품</th><th>규격</th><th>단위</th><th>수량</th><th>재료비단가</th><th>재료비</th><th>노무비단가</th><th>노무비</th><th>경비</th><th>출처</th></tr></thead>
              <tbody>{sel.components.map((c: any, i: number) => <tr key={i}><td>{c.name}</td><td>{c.spec}</td><td className="c">{c.unit}</td><td className="r">{fq(c.qty)}</td><td className="r">{fmt(c.mat_price)}</td><td className="r">{fmt(c.mat_amt, 1)}</td><td className="r">{fmt(c.lab_price)}</td><td className="r">{fmt(c.lab_amt, 1)}</td><td className="r">{fmt(c.exp_amt, 1)}</td><td className="muted" style={{ fontSize: 11 }}>{c.price_source}</td></tr>)}
                <tr className="sub"><td colSpan={5}>합 계</td><td className="r">{fmt(sel.total.mat_amt)}</td><td /><td className="r">{fmt(sel.total.lab_amt)}</td><td className="r">{fmt(sel.total.exp_amt)}</td><td className="r">{fmt(sel.total.tot_amt)}</td></tr></tbody></table></>}
        </div>
      </div>
      </>}
      {show && <div className="modal-bg" onClick={() => setShow(false)}><div className="modal" style={{ width: 'min(900px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <h3>신규 일위대가 작성</h3>
        <label className="f">명칭 (품명 규격 단위)<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 경질비닐전선관 HI 28mm M" /></label>
        <table className="t" style={{ marginTop: 10 }}><thead><tr><th>구성품</th><th>규격</th><th>단위</th><th>수량</th><th>재료비단가</th><th>노무비단가</th><th>경비단가</th><th></th></tr></thead>
          <tbody>{form.components.map((c: any, i: number) => <tr key={i}>{(['name', 'spec', 'unit', 'qty', 'mat_price', 'lab_price', 'exp_price'] as const).map((k) => <td key={k}><input style={{ width: k === 'name' ? 150 : k === 'spec' ? 130 : 80, padding: '2px 4px' }} value={c[k]} onChange={(e) => { const cs = [...form.components]; cs[i] = { ...cs[i], [k]: e.target.value }; setForm({ ...form, components: cs }) }} /></td>)}
            <td className="c"><button className="sm danger" onClick={() => setForm({ ...form, components: form.components.filter((_: any, j: number) => j !== i) })}>×</button></td></tr>)}</tbody></table>
        <div className="row" style={{ marginTop: 8 }}><button className="sm" onClick={() => setForm({ ...form, components: [...form.components, { ...EMPTY_C }] })}>+ 행 추가</button><span className="help">구성품 금액은 소수 1자리 절사, 합계는 정수 절사로 계산됩니다 (국내 관행).</span></div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button onClick={() => setShow(false)}>취소</button><button className="primary" disabled={!form.title} onClick={create}>저장</button></div>
      </div></div>}
    </>
  )
}
