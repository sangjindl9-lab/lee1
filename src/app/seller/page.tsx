import Link from 'next/link';
import { db, one, all } from '../../server/db.ts';
import { BUSINESS_TYPES } from '../../server/catalog.ts';
import { won, dt } from '../../server/util.ts';
import { requireUser, F, Flash, St, In, Check } from '../lib.tsx';

export default async function Seller({ searchParams }: { searchParams: Promise<any> }) {
  const sp = await searchParams; const u = await requireUser('/seller');
  const s = await one(db, 'SELECT * FROM sellers WHERE user_id=$1', [u.id]);
  const products = s ? await all(db, 'SELECT p.id, p.title, p.status, p.review_note, (SELECT price FROM product_options WHERE product_id=p.id ORDER BY id LIMIT 1) AS price FROM products p WHERE seller_id=$1 ORDER BY id DESC', [u.id]) : [];
  const sales = s ? await all(db, `SELECT o.*, po.net_amount, po.status AS po_status FROM orders o LEFT JOIN payouts po ON po.order_id=o.id WHERE o.seller_id=$1 AND o.payment_status NOT IN ('unpaid','pending','failed') ORDER BY o.id DESC LIMIT 100`, [u.id]) : [];
  const listings = s ? await all(db, 'SELECT id, title, status FROM ip_listings WHERE seller_id=$1 ORDER BY id DESC', [u.id]) : [];
  const paidOut = sales.filter((o) => o.po_status === 'paid').reduce((a, o) => a + Number(o.net_amount), 0);
  return (<>
    <h1>판매 관리</h1><Flash sp={sp} />
    {!s || s.status === 'withdrawn' ? <div className="card" style={{ maxWidth: 640 }}><h2>판매자 등록</h2><p className="sub">심사 후 상품을 판매할 수 있습니다. 사업자 유형에 따라 수수료 증빙과 원천징수 처리가 달라집니다</p>
      <F a="seller_apply" back="/seller"><In label="상점 이름" name="display_name" required /><In label="소개" name="intro" area /><In label="포트폴리오" name="portfolio" area hint="한 줄에 하나씩" />
        <label className="in"><span>사업자 유형</span><select name="business_type">{Object.entries(BUSINESS_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <In label="사업자등록번호" name="biz_reg_no" hint="개인(비사업자)은 비워 둡니다. 주민등록번호는 받지 않습니다" /><Check label="간이과세자이며 세금계산서를 발행할 수 있음" name="tax_invoice_issuable" /><button className="pri">등록 신청</button></F></div> : <>
      <div className="grid g3">
        <div className="card"><div className="muted">판매자 상태</div><div style={{ fontSize: 18, fontWeight: 600 }}>{({ pending: '심사 대기', approved: '승인됨', suspended: '정지됨' } as any)[s.status]}</div><div className="muted" style={{ fontSize: 13 }}>{s.display_name} · {BUSINESS_TYPES[s.business_type]}</div></div>
        <div className="card"><div className="muted">정산 계좌</div><div style={{ fontSize: 18, fontWeight: 600 }}>{s.payout_account_hint || '미등록'}</div><div className="muted" style={{ fontSize: 13 }}>{s.payout_account_enc ? (s.payout_verified ? '운영자 확인 완료' : '운영자 확인 대기. 확인 전에는 지급되지 않습니다') : '등록해야 지급받을 수 있습니다'}</div></div>
        <div className="card"><div className="muted">지급 완료 합계</div><div className="num" style={{ fontSize: 18, fontWeight: 600 }}>{won(paidOut)}</div><div className="muted" style={{ fontSize: 13 }}>사업자 지급 확인 기준</div></div>
      </div>
      <div className="card"><div className="acts" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>상품</h2><Link href="/seller/products/new" className="btn pri">상품 등록</Link></div>
        {products.length ? <table style={{ marginTop: 12 }}><thead><tr><th>상품</th><th>상태</th><th className="r">가격</th></tr></thead><tbody>{products.map((p) => <tr key={p.id}><td><Link href={`/seller/products/${p.id}`}>{p.title}</Link>{p.review_note && p.status !== 'on_sale' && <div className="muted" style={{ fontSize: 13 }}>심사 의견: {p.review_note}</div>}</td><td><St k="product" v={p.status} /></td><td className="r num">{won(p.price)}</td></tr>)}</tbody></table> : <p className="muted" style={{ marginTop: 12 }}>등록한 상품이 없습니다</p>}</div>
      <div className="card"><h2>판매와 정산</h2>{sales.length ? <div className="scroll"><table><thead><tr><th>주문</th><th>납품</th><th>검수</th><th>분쟁·환불</th><th>지급</th><th className="r">결제액</th><th className="r">지급액</th></tr></thead><tbody>
        {sales.map((o) => <tr key={o.id}><td><Link href={`/orders/${o.id}`}>{o.snapshot.title}</Link><div className="muted num" style={{ fontSize: 12 }}>{o.order_no} · {dt(o.paid_at)}</div></td><td><St k="delivery" v={o.delivery_status} /></td><td><St k="inspection" v={o.inspection_status} /></td>
          <td>{o.dispute_status !== 'none' && <St k="dispute" v={o.dispute_status} />} {o.refund_status !== 'none' && <St k="refund" v={o.refund_status} />}</td><td><St k="payout" v={o.payout_status} /></td><td className="r num">{won(o.amount - o.refunded_amount)}</td><td className="r num">{o.net_amount != null ? won(o.net_amount) : '-'}</td></tr>)}</tbody></table></div> : <p className="muted">판매 내역이 없습니다</p>}</div>
      <div className="card"><div className="acts" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>지식재산권 등록</h2><Link href="/ip/new" className="btn">자산 등록</Link></div>{listings.map((l) => <div className="msg" key={l.id}><Link href={`/ip/${l.id}`}>{l.title}</Link> <span className="tag">{l.status}</span></div>)}</div>
      <div className="grid g2">
        <div className="card"><h2>정산 계좌 변경</h2>
          {u.stepup ? <F a="payout_account" back="/seller"><In label="은행" name="bank" required /><In label="계좌번호" name="number" required /><In label="예금주" name="holder" required /><button>저장</button><p className="muted" style={{ fontSize: 13, marginTop: 8 }}>변경하면 알림이 발송되고, 운영자가 다시 확인할 때까지 지급이 보류됩니다</p></F>
            : <F a="stepup" back="/seller"><In label="계좌를 바꾸려면 비밀번호를 다시 입력하세요" name="password" type="password" required /><button>확인</button></F>}</div>
        <div className="card"><h2>판매자 탈퇴</h2><p className="sub">신규 판매만 중단됩니다. 이미 판매한 주문의 납품물은 보관 정책 기간 동안 구매자가 계속 받을 수 있고, 진행 중인 거래의 검수·분쟁·정산도 끝까지 진행됩니다</p>
          {u.stepup ? <F a="seller_withdraw" back="/seller"><button className="danger">탈퇴</button></F> : <p className="muted">왼쪽에서 비밀번호를 확인하면 진행할 수 있습니다</p>}</div>
      </div></>}
  </>);
}
