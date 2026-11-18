import Link from 'next/link';
import { db, all } from '../../server/db.ts';
import { dt } from '../../server/util.ts';
import { me, Flash } from '../lib.tsx';
import { run } from '../actions.ts';

export default async function Support({ searchParams }: { searchParams: Promise<any> }) {
  const u = await me(); const tickets = u ? await all(db, 'SELECT * FROM support_tickets WHERE user_id=$1 ORDER BY id DESC', [u.id]) : [];
  return (<div style={{ maxWidth: 760 }}><h1>고객지원</h1><Flash sp={await searchParams} />
    <div className="card"><h2>문제가 생기면</h2><ul className="lines"><li>거래 중 문제: 해당 주문의 <Link href="/me">거래 작업실</Link>에서 문제 제기를 하면 정산이 보류되고 분쟁 절차가 시작됩니다</li><li>권리 침해·문제 상품: 상품 화면의 신고를 이용하세요</li><li>그 밖의 문의: 아래에 남기면 운영자가 확인합니다</li></ul></div>
    {u ? <div className="card"><h2>문의 남기기</h2><form action={run}><input type="hidden" name="_a" value="ticket" /><input type="hidden" name="_back" value="/support" />
      <label className="in"><span>제목</span><input name="subject" required /></label><label className="in"><span>내용</span><textarea name="body" rows={4} required /></label><button>보내기</button></form>
      {tickets.map((t) => <div className="msg" key={t.id}><b>{t.subject}</b> <span className="tag">{({ open: '접수', answered: '답변됨', closed: '종료' } as any)[t.status]}</span><time>{dt(t.created_at)}</time><div>{t.body}</div></div>)}</div> : <p className="card muted"><Link href="/login?back=/support">로그인</Link> 후 문의를 남길 수 있습니다</p>}</div>);
}
