import Link from 'next/link';
import { db, all } from '../../server/db.ts';
import { WORK_TYPES } from '../../server/custom.ts';
import { won, dt } from '../../server/util.ts';

export default async function Requests() {
  const rows = await all(db, "SELECT r.*, (SELECT count(*)::int FROM quotes q WHERE q.request_id=r.id) AS quotes FROM requests r WHERE r.is_public AND r.status='open' ORDER BY r.id DESC LIMIT 60");
  return (<>
    <div className="acts" style={{ justifyContent: 'space-between' }}><h1>맞춤 개발 의뢰</h1><Link href="/requests/new" className="btn pri">의뢰 등록</Link></div>
    <p className="sub">단계마다 조건을 정하고, 그 단계의 결제가 확인된 뒤 작업을 시작합니다. 단계별로 따로 주문·결제하며 각 단계가 납품·검수·정산을 거칩니다</p>
    {rows.length ? rows.map((r) => <Link key={r.id} href={`/requests/${r.id}`} className="pcard" style={{ marginBottom: 12 }}><h3>{r.title}</h3>
      <div className="meta"><span className="tag">{WORK_TYPES[r.work_type]}</span>{r.budget_max && <span>예산 {won(r.budget_max)} 이내</span>}{r.due_date && <span>희망 납기 {dt(r.due_date).slice(0, 12)}</span>}<span>견적 {r.quotes}건</span></div>
      <div className="sub" style={{ fontSize: 14 }}>{String(r.requirements).slice(0, 140)}</div></Link>) : <p className="card muted">공개된 의뢰가 없습니다</p>}
  </>);
}
