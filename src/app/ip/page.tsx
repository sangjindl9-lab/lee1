import Link from 'next/link';
import { db, all } from '../../server/db.ts';
import { RIGHT_TYPES } from '../../server/ip.ts';
import { won } from '../../server/util.ts';

export default async function Ip() {
  const rows = await all(db, "SELECT l.*, s.display_name FROM ip_listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.status IN ('listed','locked') ORDER BY l.id DESC LIMIT 60");
  return (<><div className="acts" style={{ justifyContent: 'space-between' }}><h1>지식재산권 거래</h1><Link href="/ip/new" className="btn pri">자산 등록</Link></div>
    <p className="sub">저작재산권 양도와 이용허락을 다룹니다. 권리는 계약과 필요한 공식 이전 절차로 이전되며, 파일이나 계정 정보를 넘겨받는 것만으로는 이전되지 않습니다. 플랫폼은 등록 항목과 증빙 제출 여부만 확인하고 권리의 진위를 보증하지 않습니다</p>
    {rows.length ? <div className="plist">{rows.map((l) => <Link key={l.id} href={`/ip/${l.id}`} className="pcard"><h3>{l.title}</h3><div className="meta"><span className="tag">{RIGHT_TYPES[l.right_type]}</span>{l.is_exclusive && <span className="tag">독점</span>}{l.status === 'locked' && <span className="tag">거래 진행 중</span>}</div>
      <div className="price">{l.asking_price ? won(l.asking_price) : '금액 협의'}</div><div className="muted" style={{ fontSize: 13 }}>{l.display_name}</div></Link>)}</div> : <p className="card muted">등록된 자산이 없습니다</p>}</>);
}
