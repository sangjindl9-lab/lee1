import Link from 'next/link';
import { db, all } from '../../server/db.ts';
import { BUSINESS_TYPES } from '../../server/catalog.ts';
import { Lines } from '../lib.tsx';

export default async function Experts() {
  const rows = await all(db, `SELECT s.*, (SELECT count(*)::int FROM products p WHERE p.seller_id=s.user_id AND p.status='on_sale') AS products,
    (SELECT count(*)::int FROM reviews r JOIN products p ON p.id=r.product_id WHERE p.seller_id=s.user_id AND r.hidden_reason IS NULL) AS reviews FROM sellers s WHERE s.status='approved' ORDER BY s.created_at DESC LIMIT 60`);
  return (<><h1>전문가 찾기</h1><p className="sub">심사를 거친 판매자입니다. 소개와 포트폴리오는 판매자가 직접 적은 내용입니다</p>
    {rows.length ? <div className="plist">{rows.map((s) => <div key={s.user_id} className="pcard"><h3>{s.display_name}</h3><div className="meta"><span className="tag">{BUSINESS_TYPES[s.business_type]}</span><span>판매 중 {s.products}개</span><span>구매 후기 {s.reviews}건</span></div>
      <p className="sub" style={{ fontSize: 14 }}>{s.intro}</p>{s.portfolio && <Lines text={s.portfolio} />}<p style={{ marginTop: 8 }}><Link href={`/market?seller=${s.user_id}`}>상점 보기</Link></p></div>)}</div> : <p className="card muted">등록된 판매자가 없습니다</p>}</>);
}
