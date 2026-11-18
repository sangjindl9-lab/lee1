import Link from 'next/link';
import { db, all } from '../../server/db.ts';
import { myCompanies, members, COMPANY_ROLES } from '../../server/company.ts';
import { won, dt } from '../../server/util.ts';
import { requireUser, F, Flash, St, In, Check } from '../lib.tsx';

export default async function Me({ searchParams }: { searchParams: Promise<any> }) {
  const sp = await searchParams; const u = await requireUser('/me');
  const orders = await all(db, `SELECT * FROM orders WHERE buyer_id=$1 OR company_id IN (SELECT company_id FROM company_members WHERE user_id=$1) ORDER BY id DESC LIMIT 100`, [u.id]);
  const notes = await all(db, 'SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 20', [u.id]);
  const wishes = await all(db, 'SELECT p.id, p.title FROM wishlist w JOIN products p ON p.id=w.product_id WHERE w.user_id=$1 ORDER BY w.created_at DESC', [u.id]);
  const requests = await all(db, 'SELECT id, title, status FROM requests WHERE buyer_id=$1 ORDER BY id DESC', [u.id]);
  const contracts = await all(db, `SELECT c.id, c.status, v.terms->>'title' AS title FROM contracts c JOIN contract_versions v ON v.contract_id=c.id AND v.version_no=c.current_version_no WHERE c.buyer_id=$1 OR c.seller_id=$1 ORDER BY c.id DESC`, [u.id]);
  const deals = await all(db, 'SELECT d.id, d.stage, l.title FROM ip_deals d JOIN ip_listings l ON l.id=d.listing_id WHERE d.buyer_id=$1 OR l.seller_id=$1 ORDER BY d.id DESC', [u.id]);
  const companies = await myCompanies(u.id);
  return (<>
    <h1>내 거래</h1><p className="sub">{u.name} · {u.email}</p><Flash sp={sp} />
    <div className="grid split"><div>
      <div className="card"><h2>구매 관리</h2>{orders.length ? <div className="scroll"><table><thead><tr><th>주문</th><th>결제</th><th>납품</th><th>검수</th><th className="r">금액</th></tr></thead><tbody>
        {orders.map((o) => <tr key={o.id}><td><Link href={`/orders/${o.id}`}>{o.snapshot.title}</Link><div className="muted num" style={{ fontSize: 12 }}>{o.order_no} · {dt(o.created_at)}</div></td>
          <td><St k="payment" v={o.payment_status} /></td><td><St k="delivery" v={o.delivery_status} /></td><td><St k="inspection" v={o.inspection_status} />{o.dispute_status === 'open' && <div><St k="dispute" v="open" /></div>}</td><td className="r num">{won(o.amount)}</td></tr>)}</tbody></table></div> : <p className="muted">구매 내역이 없습니다</p>}</div>
      <div className="card"><h2>견적·의뢰와 계약</h2>
        {requests.map((r) => <div className="msg" key={`r${r.id}`}><Link href={`/requests/${r.id}`}>의뢰: {r.title}</Link> <span className="tag">{({ open: '견적 받는 중', contracted: '계약됨', closed: '종료', draft: '작성 중' } as any)[r.status]}</span></div>)}
        {contracts.map((c) => <div className="msg" key={`c${c.id}`}><Link href={`/contracts/${c.id}`}>계약: {c.title}</Link> <span className="tag">{({ negotiating: '협의 중', active: '진행 중', completed: '완료', terminated: '해지' } as any)[c.status]}</span></div>)}
        {deals.map((d) => <div className="msg" key={`d${d.id}`}><Link href={`/ip/deals/${d.id}`}>지식재산권 거래: {d.title}</Link> <span className="tag">{d.stage}</span></div>)}
        {!requests.length && !contracts.length && !deals.length && <p className="muted">진행 중인 의뢰나 계약이 없습니다. <Link href="/requests/new">맞춤 개발 의뢰하기</Link></p>}</div>
      <div className="card"><h2>기업 계정</h2>
        {await Promise.all(companies.map(async (c) => <div key={c.id} style={{ marginBottom: 16 }}><h3>{c.name} <span className="tag">{COMPANY_ROLES[c.role]}</span>{c.purchase_approval_required && <span className="tag" style={{ marginLeft: 4 }}>구매 승인 필요</span>}</h3>
          {(await members(c.id)).map((m) => <div key={m.email} className="muted" style={{ fontSize: 14 }}>{m.name} {m.email} · {COMPANY_ROLES[m.role]}</div>)}
          {c.role === 'admin' && <F a="company_member" back="/me" h={{ id: c.id }} className="inline"><In label="구성원 이메일" name="email" type="email" required /><label className="in"><span>역할</span><select name="role">{Object.entries(COMPANY_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><button>추가·변경</button></F>}</div>))}
        <details><summary>기업 계정 만들기</summary><F a="company_create" back="/me" className="stack"><In label="기업명" name="name" required /><Check label="구매 담당자의 결제 전에 관리자 승인을 받는다" name="approval" /><button>만들기</button></F></details></div>
    </div><aside>
      <div className="card"><h3>알림</h3>{notes.length ? notes.map((n) => <div className="msg" key={n.id} style={{ fontWeight: n.read_at ? 400 : 500 }}>{n.link ? <Link href={n.link.split('#')[0]}>{n.body}</Link> : n.body}<time>{dt(n.created_at)}</time></div>) : <p className="muted">알림이 없습니다</p>}
        {notes.some((n) => !n.read_at) && <F a="notif_read" back="/me"><button className="link">모두 읽음으로 표시</button></F>}</div>
      <div className="card"><h3>찜한 상품</h3>{wishes.length ? wishes.map((w) => <div key={w.id}><Link href={`/products/${w.id}`}>{w.title}</Link></div>) : <p className="muted">없음</p>}</div>
    </aside></div>
  </>);
}
