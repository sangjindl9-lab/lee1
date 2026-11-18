import { notFound } from 'next/navigation';
import { db, one } from '../../../server/db.ts';
import { config } from '../../../server/config.ts';
import { simProvider } from '../../../server/providers/sim.ts';
import { won } from '../../../server/util.ts';
import { requireUser, F, Flash } from '../../lib.tsx';

// 테스트 결제창(시뮬레이터). 실 결제 사업자를 연동하면 이 화면 대신 사업자의 결제창을 쓴다.
export default async function Pay({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const ppid = (await params).id; const sp = await searchParams;
  const u = await requireUser(`/pay/${ppid}`);
  if (config.paymentProvider !== 'test') notFound();
  const pay = await one(db, 'SELECT p.*, o.buyer_id, o.order_no, o.snapshot FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.provider_payment_id=$1', [ppid]);
  if (!pay || pay.buyer_id !== u.id) notFound();
  const ext = await simProvider.getPayment(ppid);
  return (<div style={{ maxWidth: 460, margin: '0 auto' }}>
    <h1>테스트 결제창</h1><Flash sp={sp} />
    <p className="note warn">결제 사업자 역할을 하는 시뮬레이터입니다. 실제 돈이 움직이지 않습니다</p>
    <div className="card"><p>{pay.snapshot.title}</p><p className="price-lg">{won(pay.amount)}</p><p className="muted num">주문 {pay.order_no} · {simProvider.capabilities().methodLabels[pay.method]}</p>
      {ext?.status === 'ready' ? <div className="acts">
        <F a="sim_pay" back={`/pay/${ppid}`} h={{ ppid, result: 'approve' }}><button className="pri">결제 승인</button></F>
        <F a="sim_pay" back={`/pay/${ppid}`} h={{ ppid, result: 'fail' }}><button>결제 실패로 처리</button></F></div>
        : <p>이미 처리된 결제입니다. <a href={`/orders/${pay.order_id}`}>거래 작업실로 이동</a></p>}</div>
  </div>);
}
