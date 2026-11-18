import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db, one, all } from '../../server/db.ts';
import { getProvider } from '../../server/providers/sim.ts';
import { settlementOf, DISPUTE_REASONS } from '../../server/trade.ts';
import { BUSINESS_TYPES, CATEGORIES } from '../../server/catalog.ts';
import { won, dt, hasRole, getSetting } from '../../server/util.ts';
import { requireUser, F, Flash, St, Row, In } from '../lib.tsx';

const TABS: [string, string][] = [['queue', '심사·대기'], ['orders', '거래'], ['disputes', '분쟁'], ['settle', '환불·정산'], ['fees', '수수료·정책'], ['caps', '결제 사업자 기능'], ['recon', '대사'], ['stats', '통계'], ['audit', '감사 기록']];
const CAP_KEYS: [string, string][] = [['digital_goods', '디지털 상품·개발 용역 취급'], ['multi_seller', '다수 판매자 입점(지급대행)'], ['methods', '지원 결제수단'], ['escrow_structure', '대금 보호·정산 구조'], ['max_hold_days', '최대 보류 기간'],
  ['auto_confirm', '구매확정·자동확정 방식'], ['dispute_hold', '분쟁 시 지급 중지 범위'], ['partial_refund', '부분 환불 조건'], ['staged_payments', '단계별 결제'], ['seller_kyc', '판매자 확인 절차'], ['post_payout_refund', '지급 후 환불 처리 방식']];

export default async function Admin({ searchParams }: { searchParams: Promise<any> }) {
  const sp = await searchParams; const u = await requireUser('/admin');
  if (!u.operator_role) redirect('/');
  const tab = sp.tab || 'queue'; const back = `/admin?tab=${tab}${sp.id ? `&id=${sp.id}` : ''}`;
  const caps = getProvider().capabilities();
  if (!u.stepup) return (<div style={{ maxWidth: 420, margin: '0 auto' }}><h1>운영자 추가 인증</h1><Flash sp={sp} /><div className="card"><F a="stepup" back={back}><In label="비밀번호를 다시 입력하세요" name="password" type="password" required /><button className="pri">확인</button></F><p className="muted" style={{ fontSize: 13, marginTop: 8 }}>30분 동안 유지됩니다. 모든 운영 처리는 감사 기록에 남습니다</p></div></div>);
  const B = ({ a, id, label, h, pri }: any) => <F a={a} back={back} h={{ id, ...(h || {}) }}><button className={pri ? 'pri' : ''}>{label}</button></F>;
  let body: any = null;

  if (tab === 'queue') {
    const sellers = await all(db, "SELECT s.*, x.email FROM sellers s JOIN users x ON x.id=s.user_id WHERE s.status='pending' OR (s.payout_account_enc IS NOT NULL AND NOT s.payout_verified AND s.status<>'withdrawn') ORDER BY s.created_at");
    const products = await all(db, "SELECT p.id, p.title, s.display_name FROM products p JOIN sellers s ON s.user_id=p.seller_id WHERE p.status='pending_review' OR EXISTS (SELECT 1 FROM file_versions v WHERE v.product_id=p.id AND v.status='submitted') ORDER BY p.updated_at");
    const pfiles = products.length ? await all(db, "SELECT f.*, v.product_id, v.label FROM files f JOIN file_versions v ON v.id=f.version_id WHERE v.status='submitted' ORDER BY f.id") : [];
    const ips = await all(db, "SELECT id, title FROM ip_listings WHERE status='pending_review'");
    const closes = await all(db, "SELECT c.*, o.order_no, o.inspection_due_at FROM close_requests c JOIN orders o ON o.id=c.order_id WHERE c.status='open'");
    const reports = await all(db, "SELECT r.*, p.title FROM reports r LEFT JOIN products p ON p.id=r.product_id WHERE r.status IN ('open','reviewing') ORDER BY r.id");
    const tickets = await all(db, "SELECT t.*, x.email FROM support_tickets t JOIN users x ON x.id=t.user_id WHERE t.status='open' ORDER BY t.id");
    const failed = await all(db, "SELECT id, order_no, delivery_detail FROM orders WHERE payment_status='paid' AND delivery_status='failed'");
    const late = await all(db, "SELECT id, order_no, inspection_due_at FROM orders WHERE inspection_status='in_progress' AND inspection_due_at < now() AND dispute_status<>'open'");
    body = <>
      <div className="card"><h2>판매자 심사와 계좌 확인</h2>{sellers.length ? sellers.map((s) => <div className="msg acts" key={s.user_id}><span>{s.display_name} {s.email} · {BUSINESS_TYPES[s.business_type]} · {s.status}{s.payout_account_hint && ` · 계좌 ${s.payout_account_hint}${s.payout_verified ? '' : '(미확인)'}`}</span>
        {s.status === 'pending' && <B a="ad_seller" id={s.user_id} h={{ do: 'approve' }} label="판매자 승인" pri />}{s.payout_account_enc && !s.payout_verified && <B a="ad_seller" id={s.user_id} h={{ do: 'verify_payout' }} label="계좌 확인 완료" />}<B a="ad_seller" id={s.user_id} h={{ do: 'suspend' }} label="정지" /></div>) : <p className="muted">대기 없음</p>}</div>
      <div className="card"><h2>상품·파일 심사</h2>{products.length ? products.map((p) => <div className="msg" key={p.id}><Link href={`/products/${p.id}`}>{p.title}</Link> · {p.display_name}
        <ul className="lines">{pfiles.filter((f) => f.product_id === p.id).map((f) => <li key={f.id}>{f.filename} · 압축 <St k="scan" v={f.scan_archive} /> 비밀키 <St k="scan" v={f.scan_secret} /> 악성 <St k="scan" v={f.scan_malware} /></li>)}</ul>
        <F a="ad_review" back={back} h={{ id: p.id }} className="inline"><In label="심사 의견(반려 시 필수)" name="note" /><button name="approve" value="1" className="pri">승인</button><button name="approve" value="0">반려</button></F></div>) : <p className="muted">대기 없음</p>}
        <p className="muted" style={{ fontSize: 13 }}>심사는 등록 항목과 파일 검사 결과를 확인하는 것이며 품질이나 권리를 보증하는 절차가 아닙니다</p></div>
      <div className="card"><h2>지식재산권 등록 심사</h2>{ips.length ? ips.map((l) => <div className="msg" key={l.id}><Link href={`/ip/${l.id}`}>{l.title}</Link><F a="ad_ip_review" back={back} h={{ id: l.id }} className="inline"><In label="의견" name="note" /><button name="approve" value="1" className="pri">승인</button><button name="approve" value="0">반려</button></F></div>) : <p className="muted">대기 없음</p>}</div>
      <div className="card"><h2>미납품·검수 지연</h2>{failed.map((o) => <div className="msg acts" key={o.id}><Link href={`/admin?tab=orders&id=${o.id}`}>{o.order_no}</Link> 전달 실패: {o.delivery_detail}<B a="ad_delivery_retry" id={o.id} label="납품 다시 확인" /></div>)}
        {late.map((o) => <div className="msg" key={o.id}><Link href={`/admin?tab=orders&id=${o.id}`}>{o.order_no}</Link> 검수 기한 {dt(o.inspection_due_at)} 지남</div>)}{!failed.length && !late.length && <p className="muted">없음</p>}</div>
      <div className="card"><h2>검수 종료 심사 요청</h2>{closes.length ? closes.map((c) => <div className="msg" key={c.id}><Link href={`/admin?tab=orders&id=${c.order_id}`}>{c.order_no}</Link> · 기한 {dt(c.inspection_due_at)} · {c.note}
        <F a="ad_close" back={back} h={{ id: c.id }} className="inline"><In label="결정 근거" name="basis" required /><button name="approve" value="1" className="pri">검수 종료</button><button name="approve" value="0">기각</button></F></div>) : <p className="muted">없음</p>}</div>
      <div className="card"><h2>신고</h2>{reports.length ? reports.map((r) => <div className="msg" key={r.id}>{r.title && <Link href={`/products/${r.product_id}`}>{r.title}</Link>} · {r.reason} · {r.body}
        <F a="ad_report" back={back} h={{ id: r.id }} className="inline"><In label="처리 근거" name="note" required /><button name="do" value="restrict" className="danger">신규 판매 제한</button><button name="do" value="dismiss">기각</button></F></div>) : <p className="muted">없음</p>}</div>
      <div className="card"><h2>문의</h2>{tickets.length ? tickets.map((t) => <div className="msg" key={t.id}><b>{t.subject}</b> {t.email}<div>{t.body}</div><F a="ad_ticket" back={back} h={{ id: t.id }} className="inline"><In label="답변" name="answer" required /><button>답변</button></F></div>) : <p className="muted">없음</p>}</div>
      <div className="card acts"><B a="ad_jobs" label="복구·기한 작업 지금 실행" /><span className="muted">결제 조회, 납품 복구, 환불·지급 확인, 기한 알림. 서버에서 1분마다 자동 실행됩니다</span></div></>;
  }

  if (tab === 'orders' && sp.id) {
    const o = await one(db, 'SELECT o.*, b.email AS buyer_email, s.email AS seller_email FROM orders o JOIN users b ON b.id=o.buyer_id JOIN users s ON s.id=o.seller_id WHERE o.id=$1', [Number(sp.id)]);
    if (o) {
      const pay = await one(db, 'SELECT * FROM payments WHERE order_id=$1', [o.id]); const po = await one(db, 'SELECT * FROM payouts WHERE order_id=$1', [o.id]);
      const ledger = await all(db, 'SELECT * FROM ledger_entries WHERE order_id=$1 ORDER BY id', [o.id]); const escrow = await all(db, 'SELECT * FROM escrow_records WHERE order_id=$1 ORDER BY id', [o.id]);
      const { s, seller } = await settlementOf(o);
      await db.query("INSERT INTO audit_logs(actor_id, actor_role, action, target_type, target_id) VALUES ($1,$2,'order.view','order',$3)", [u.id, u.operator_role, String(o.id)]);
      body = <><p><Link href="/admin?tab=orders">거래 목록</Link> · <Link href={`/orders/${o.id}`}>거래 작업실</Link></p>
        <div className="card"><h2>{o.order_no} · {o.snapshot.title}</h2><dl><Row label="구매자">{o.buyer_email}</Row><Row label="판매자">{o.seller_email} · {BUSINESS_TYPES[o.seller_business_type]} · 계좌 {seller.payout_verified ? '확인됨' : '미확인'}</Row>
          <Row label="결제"><St k="payment" v={o.payment_status} /> 내부 {won(o.amount)} / 환불 {won(o.refunded_amount)} · 사업자 조회: {pay?.external_status || '-'} 환불 {won(pay?.external_refunded)} ({dt(pay?.external_checked_at)})</Row>
          <Row label="대금 보호"><St k="escrow" v={o.escrow_status} /></Row><Row label="납품"><St k="delivery" v={o.delivery_status} /> {o.delivery_detail}</Row><Row label="검수"><St k="inspection" v={o.inspection_status} /> 기한 {dt(o.inspection_due_at)}</Row>
          <Row label="분쟁"><St k="dispute" v={o.dispute_status} /></Row><Row label="환불"><St k="refund" v={o.refund_status} /></Row><Row label="판매자 지급"><St k="payout" v={o.payout_status} />{po && ` · ${po.status} · 키 ${po.idempotency_key}${po.failure ? ` · ${po.failure}` : ''}`}</Row></dl></div>
        <div className="grid g2"><div className="card"><h3>정산 계산</h3><dl><Row label="기준 금액"><span className="num">{won(s.base)}</span></Row><Row label="수수료 공급가액"><span className="num">{won(s.feeSupply)}</span></Row><Row label="수수료 부가세"><span className="num">{won(s.feeVat)}</span></Row>
          <Row label="결제 비용"><span className="num">{won(s.pgFee)}</span> (판매자 {won(s.sellerPgFee)} / 플랫폼 {won(s.platformPgFee)})</Row><Row label="원천징수"><span className="num">{won(s.withholdingIncomeTax)} + {won(s.withholdingLocalTax)}</span></Row><Row label="지급액"><b className="num">{won(s.net)}</b></Row></dl>
          {hasRole(u, 'settlement') && <div className="acts" style={{ marginTop: 12 }}>
            {['eligible', 'failed'].includes(o.payout_status) && <B a="ad_payout" id={o.id} label="판매자 지급 요청" pri />}{['requested', 'unknown'].includes(o.payout_status) && <B a="ad_payout_sync" id={o.id} label="지급 결과 조회" />}
            {caps.mode === 'test' && po?.status === 'requested' && <F a="ad_sim_payout" back={back} h={{ key: po.idempotency_key }}><button>테스트: 은행 이체 완료 시뮬레이션</button></F>}</div>}</div>
          <div className="card"><h3>직권 환불</h3>{hasRole(u, 'settlement') && ['paid', 'partially_refunded'].includes(o.payment_status) ? <F a="ad_refund" back={back} h={{ id: o.id }}><In label="환불 금액(원)" name="amount" type="number" value={o.amount - o.refunded_amount} required /><In label="근거" name="basis" required /><button className="danger">환불 실행</button>
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>결제 사업자의 취소 성공을 확인한 뒤에만 환불 완료로 바뀝니다. 이미 지급이 진행된 거래는 사후 환불·회수 검토로 넘어갑니다{!caps.partialRefund[o.pay_method] && '. 이 결제수단은 부분 환불을 지원하지 않습니다'}</p></F> : <p className="muted">환불할 수 있는 상태가 아니거나 정산 권한이 없습니다</p>}</div></div>
        <div className="card"><h3>거래 원장</h3><table><tbody>{ledger.map((e) => <tr key={e.id}><td>{e.kind}</td><td className="r num">{won(e.amount)}</td><td className="muted">{e.memo}</td><td className="muted num">{e.ref}</td><td>{dt(e.created_at)}</td></tr>)}</tbody></table>
          <h3 style={{ marginTop: 16 }}>대금 보호 기록(사업자에서 실제로 일어난 일)</h3>{escrow.map((e) => <div key={e.id} className="msg">{e.event} · {e.mode} {e.detail}<time>{dt(e.created_at)}</time></div>)}</div></>;
    }
  } else if (tab === 'orders') {
    const rows = await all(db, 'SELECT * FROM orders ORDER BY id DESC LIMIT 200');
    body = <div className="card scroll"><table><thead><tr><th>주문</th><th>결제</th><th>납품</th><th>검수</th><th>분쟁</th><th>환불</th><th>지급</th><th className="r">금액</th></tr></thead><tbody>{rows.map((o) => <tr key={o.id}><td><Link href={`/admin?tab=orders&id=${o.id}`}>{o.order_no}</Link><div className="muted" style={{ fontSize: 12 }}>{o.snapshot.title}</div></td>
      <td><St k="payment" v={o.payment_status} /></td><td><St k="delivery" v={o.delivery_status} /></td><td><St k="inspection" v={o.inspection_status} /></td><td><St k="dispute" v={o.dispute_status} /></td><td><St k="refund" v={o.refund_status} /></td><td><St k="payout" v={o.payout_status} /></td><td className="r num">{won(o.amount)}</td></tr>)}</tbody></table></div>;
  }

  if (tab === 'disputes') {
    const rows = await all(db, "SELECT d.*, o.order_no, o.amount, o.refunded_amount, o.pay_method FROM disputes d JOIN orders o ON o.id=d.order_id ORDER BY (d.status='open') DESC, d.id DESC LIMIT 100");
    body = rows.length ? rows.map((d) => <div className="card" key={d.id}><h3><Link href={`/orders/${d.order_id}`}>{d.order_no}</Link> · {DISPUTE_REASONS[d.reason]} <St k="dispute" v={d.status} /></h3><p>{d.description}</p>
      <p className="muted">환불 요청 {d.wants_refund ? '있음' : '없음'} · 사업자 지급 보류: {d.external_hold}{d.post_settlement && ' · 지급 이후 접수(사후 검토 대상)'} · 결제 {won(d.amount)}, 환불 누계 {won(d.refunded_amount)}</p>
      {d.status === 'open' && hasRole(u, 'support') ? <F a="ad_dispute" back={back} h={{ id: d.id }}><div className="inline"><label className="in"><span>결정</span><select name="decision"><option value="resume">거래 재개(수정·보완 합의)</option><option value="release">정산 진행</option><option value="refund_full">전액 환불</option>
        <option value="refund_partial">부분 환불{caps.partialRefund[d.pay_method] ? '' : '(이 결제수단은 미지원)'}</option><option value="external_resolution">외부 해결 절차 안내</option></select></label><In label="부분 환불 금액" name="amount" type="number" /></div>
        <In label="결정 근거(계약 기준과 제출 자료)" name="basis" area required /><button className="pri">결정</button><p className="muted" style={{ fontSize: 13, marginTop: 8 }}>양측 자료를 거래 작업실에서 확인한 뒤 결정하세요. 결정은 처리자·일시와 함께 기록되고 양측에 이의제기 방법이 안내됩니다</p></F>
        : d.status === 'resolved' && <p className="muted">결정: {d.decision} · {d.decision_basis} · {dt(d.decided_at)}</p>}</div>) : <p className="card muted">분쟁이 없습니다</p>;
  }

  if (tab === 'settle') {
    const eligible = await all(db, "SELECT o.*, s.payout_verified FROM orders o JOIN sellers s ON s.user_id=o.seller_id WHERE o.payout_status IN ('eligible','failed','requested','unknown') ORDER BY o.id");
    const refunds = await all(db, "SELECT r.*, o.order_no FROM refunds r JOIN orders o ON o.id=r.order_id WHERE r.status NOT IN ('completed') ORDER BY r.id DESC");
    const tax = await all(db, 'SELECT t.*, s.display_name FROM tax_records t JOIN sellers s ON s.user_id=t.seller_id ORDER BY t.id DESC LIMIT 100');
    body = <><div className="card"><h2>지급 대상과 진행 중인 지급</h2>{eligible.length ? <table><tbody>{eligible.map((o) => <tr key={o.id}><td><Link href={`/admin?tab=orders&id=${o.id}`}>{o.order_no}</Link></td><td><St k="payout" v={o.payout_status} /></td><td>{o.payout_verified ? '' : '판매자 계좌 미확인'}</td><td className="r num">{won(o.amount - o.refunded_amount)}</td>
      <td className="r">{['eligible', 'failed'].includes(o.payout_status) ? <B a="ad_payout" id={o.id} label="지급 요청" pri /> : <B a="ad_payout_sync" id={o.id} label="결과 조회" />}</td></tr>)}</tbody></table> : <p className="muted">없음</p>}</div>
      <div className="card"><h2>완료되지 않은 환불</h2>{refunds.length ? refunds.map((r) => <div key={r.id} className="msg acts"><span><Link href={`/admin?tab=orders&id=${r.order_id}`}>{r.order_no}</Link> {won(r.amount)} · {r.status} {r.failure}</span>{['approved', 'failed'].includes(r.status) && <B a="ad_refund_retry" id={r.id} label="다시 실행" />}
        {r.status === 'post_settlement_review' && <span className="muted">사후 환불·회수 검토: 판매자와 회수 방법을 협의하고 결과를 감사 기록에 남기세요(수동 절차)</span>}{r.status === 'unsupported' && <span className="muted">대체 절차: 전액 환불 후 재결제 또는 합의 종결</span>}</div>) : <p className="muted">없음</p>}</div>
      <div className="card"><h2>세무·증빙 기초 데이터</h2><div className="scroll"><table><thead><tr><th>귀속</th><th>판매자</th><th>종류</th><th className="r">공급가액</th><th className="r">부가세</th><th className="r">지급액</th><th className="r">소득세</th><th className="r">지방소득세</th></tr></thead><tbody>{tax.map((t) => <tr key={t.id}><td>{t.period}</td><td>{t.display_name}</td><td>{({ tax_invoice: '세금계산서 대상', fee_receipt: '수수료 영수증', withholding_statement: '지급명세서 기초' } as any)[t.doc_type]}</td>
        {[t.supply_amount, t.vat_amount, t.gross_payment, t.income_tax, t.local_tax].map((v, i) => <td key={i} className="r num">{won(v)}</td>)}</tr>)}</tbody></table></div><p className="muted" style={{ fontSize: 13 }}>발행·신고 전 세무 검토가 필요합니다</p></div></>;
  }

  if (tab === 'fees') {
    const rows = await all(db, 'SELECT * FROM fee_policies ORDER BY active DESC, id DESC'); const ac = await getSetting('auto_confirm', 'off'); const wb = await getSetting('withholding_base', 'net');
    body = <><div className="card"><h2>수수료 정책</h2><p className="sub">우선순위: 판매자별 → 분야별 → 기본. 기간을 넣으면 그 기간에만 적용됩니다(할인 기간). 변경은 새 주문부터 적용되고 기존 주문은 주문 시점 정책을 유지합니다</p>
      <table><thead><tr><th>범위</th><th>대상</th><th className="r">요율</th><th>결제 비용 부담</th><th>기간</th><th /></tr></thead><tbody>{rows.map((r) => <tr key={r.id} style={{ opacity: r.active ? 1 : .5 }}><td>{({ default: '기본', category: '분야', seller: '판매자' } as any)[r.scope]}</td><td>{r.scope === 'category' ? CATEGORIES[r.scope_ref] || r.scope_ref : r.scope_ref}</td><td className="r num">{r.rate_bps / 100}%</td><td>{r.pg_fee_bearer === 'seller' ? '판매자' : '플랫폼'}</td><td>{r.valid_from || r.valid_to ? `${dt(r.valid_from)} ~ ${dt(r.valid_to)}` : '상시'}</td>
        <td className="r">{r.active && hasRole(u, 'settlement') && <B a="ad_fee_off" id={r.id} label="중지" />}</td></tr>)}</tbody></table>
      {hasRole(u, 'settlement') && <F a="ad_fee" back={back} className="inline"><label className="in"><span>범위</span><select name="scope"><option value="default">기본</option><option value="category">분야</option><option value="seller">판매자</option></select></label><In label="대상(분야 코드 또는 판매자 번호)" name="scope_ref" /><In label="요율(%)" name="rate_percent" required />
        <label className="in"><span>결제 비용 부담</span><select name="pg_fee_bearer"><option value="seller">판매자</option><option value="platform">플랫폼</option></select></label><In label="시작" name="valid_from" type="date" /><In label="종료" name="valid_to" type="date" /><In label="메모" name="note" /><button>정책 추가</button></F>}</div>
      <div className="card"><h2>운영 정책</h2>
        <F a="ad_setting" back={back} h={{ key: 'auto_confirm' }} className="inline"><label className="in"><span>검수 기한 경과 시 자동확정</span><select name="value" defaultValue={ac}><option value="off">끔</option><option value="on">켬</option></select></label><button>저장</button></F>
        <p className="muted" style={{ fontSize: 13 }}>자동확정은 결제 사업자 정책과 검토를 마친 운영 정책(약관 고지 포함)이 일치할 때만 켜세요. 꺼져 있으면 판매자의 검수 종료 심사 요청으로 처리합니다</p>
        <F a="ad_setting" back={back} h={{ key: 'withholding_base' }} className="inline"><label className="in"><span>개인 판매자 원천징수 기준</span><select name="value" defaultValue={wb}><option value="net">지급액 기준</option><option value="gross">수수료 차감 전 기준</option></select></label><button>저장</button></F>
        <p className="muted" style={{ fontSize: 13 }}>세무사 검토 결과에 맞춰 설정하세요</p></div>
      {u.operator_role === 'super' && <div className="card"><h2>운영자 권한</h2><F a="ad_role" back={back} className="inline"><In label="회원 이메일" name="email" type="email" required /><label className="in"><span>권한</span><select name="role"><option value="">해제</option><option value="review">심사</option><option value="support">고객지원</option><option value="settlement">정산</option><option value="super">최고관리자</option></select></label><button>적용</button></F></div>}</>;
  }

  if (tab === 'caps') {
    const rows = await all(db, 'SELECT * FROM provider_capabilities ORDER BY provider, key');
    body = <div className="card"><h2>실결제 도입 전 확인표</h2><p className="sub">현재 사업자: {caps.label}({caps.mode === 'test' ? '테스트' : '실결제'}). 실결제에서는 확인됨으로 기록한 기능만 켜집니다. 미확인·미지원 기능은 결제를 막거나 대체 절차로 안내합니다</p>
      <table><thead><tr><th>항목</th><th>사업자</th><th>상태</th><th>값</th><th>미지원 시 대체 절차</th><th>근거</th></tr></thead><tbody>
        {CAP_KEYS.map(([k, label]) => { const found = rows.filter((r) => r.key === k || r.key.startsWith(k + ':')); return found.length ? found.map((r) => <tr key={r.provider + r.key}><td>{label}<div className="muted num" style={{ fontSize: 12 }}>{r.key}</div></td><td>{r.provider}</td><td>{({ unverified: '미확인', confirmed: '확인됨', unsupported: '미지원' } as any)[r.status]}</td><td>{r.value}</td><td>{r.fallback}</td><td>{r.evidence}</td></tr>)
          : <tr key={k}><td>{label}<div className="muted num" style={{ fontSize: 12 }}>{k}</div></td><td colSpan={5} className="muted">기록 없음(미확인)</td></tr>; })}</tbody></table>
      {u.operator_role === 'super' && <F a="ad_cap" back={back} className="inline"><In label="사업자" name="provider" required /><label className="in"><span>항목</span><select name="key">{CAP_KEYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="in"><span>상태</span><select name="status"><option value="confirmed">확인됨</option><option value="unsupported">미지원</option><option value="unverified">미확인</option></select></label><In label="값" name="value" /><In label="대체 절차" name="fallback" /><In label="근거(계약서·공식 문서)" name="evidence" /><button>기록</button></F>}</div>;
  }

  if (tab === 'recon') {
    const runs = await all(db, 'SELECT * FROM recon_runs ORDER BY id DESC LIMIT 10');
    const mm = runs[0] ? await all(db, 'SELECT m.*, o.order_no FROM recon_mismatches m LEFT JOIN orders o ON o.id=m.order_id WHERE m.run_id=$1 ORDER BY m.id', [runs[0].id]) : [];
    body = <div className="card"><h2>대사</h2><p className="sub">플랫폼 내부 기록과 결제 사업자의 결제·환불·지급 상태를 비교해 불일치를 찾습니다</p>{hasRole(u, 'settlement') && <B a="ad_recon" label="지금 대사 실행" pri />}
      {runs.map((r) => <div key={r.id} className="msg">#{r.id} {r.provider} · 확인 {r.checked}건 · 불일치 {r.mismatched}건<time>{dt(r.started_at)}</time></div>)}
      {mm.length > 0 && <><h3 style={{ marginTop: 16 }}>최근 실행의 불일치</h3><table><thead><tr><th>주문</th><th>항목</th><th>내부</th><th>사업자</th></tr></thead><tbody>{mm.map((m) => <tr key={m.id}><td><Link href={`/admin?tab=orders&id=${m.order_id}`}>{m.order_no}</Link></td><td>{m.kind}</td><td>{m.internal_value}</td><td>{m.external_value}</td></tr>)}</tbody></table></>}</div>;
  }

  if (tab === 'stats') {
    const g = await one(db, `SELECT COALESCE(SUM(amount) FILTER (WHERE kind='payment_in'),0)::bigint AS paid, COALESCE(SUM(amount) FILTER (WHERE kind='refund_out'),0)::bigint AS refunded,
      COALESCE(SUM(amount) FILTER (WHERE kind='platform_fee_supply'),0)::bigint AS fee, COALESCE(SUM(amount) FILTER (WHERE kind='platform_fee_vat'),0)::bigint AS vat, COALESCE(SUM(amount) FILTER (WHERE kind='pg_fee_platform'),0)::bigint AS pgp,
      COALESCE(SUM(amount) FILTER (WHERE kind IN ('withholding_income_tax','withholding_local_tax')),0)::bigint AS wh, COALESCE(SUM(amount) FILTER (WHERE kind='payout_paid'),0)::bigint AS out FROM ledger_entries`);
    const cnt = await one(db, "SELECT count(*) FILTER (WHERE payment_status IN ('paid','partially_refunded'))::int AS paid, count(*) FILTER (WHERE dispute_status='open')::int AS disputes, count(*) FILTER (WHERE payment_status='cancelled')::int AS cancelled FROM orders");
    body = <><div className="grid g3"><div className="card"><div className="muted">총 거래액(결제 − 환불)</div><div className="price-lg">{won(g.paid - g.refunded)}</div><div className="muted" style={{ fontSize: 13 }}>결제 {won(g.paid)} · 환불 {won(g.refunded)}</div></div>
      <div className="card"><div className="muted">플랫폼 순수수료 수익</div><div className="price-lg">{won(g.fee - g.pgp)}</div><div className="muted" style={{ fontSize: 13 }}>수수료 공급가액 {won(g.fee)} − 플랫폼 부담 결제 비용 {won(g.pgp)}. 지급 완료 기준</div></div>
      <div className="card"><div className="muted">판매자 지급 완료</div><div className="price-lg">{won(g.out)}</div><div className="muted" style={{ fontSize: 13 }}>예수 부가세 {won(g.vat)} · 예수 원천세 {won(g.wh)}</div></div></div>
      <p className="muted">결제된 주문 {cnt.paid}건 · 진행 중 분쟁 {cnt.disputes}건 · 전액 환불 {cnt.cancelled}건{caps.mode === 'test' && ' · 테스트 결제 데이터입니다'}</p></>;
  }

  if (tab === 'audit') {
    const rows = await all(db, 'SELECT a.*, x.email FROM audit_logs a LEFT JOIN users x ON x.id=a.actor_id ORDER BY a.id DESC LIMIT 300');
    body = <div className="card scroll"><table><thead><tr><th>일시</th><th>처리자</th><th>행위</th><th>대상</th><th>내용</th></tr></thead><tbody>{rows.map((a) => <tr key={a.id}><td style={{ whiteSpace: 'nowrap' }}>{dt(a.created_at)}</td><td>{a.email || '시스템'} <span className="muted">{a.actor_role}</span></td><td className="num">{a.action}</td><td>{a.target_type} {a.target_id}</td><td>{a.detail}</td></tr>)}</tbody></table></div>;
  }

  return (<><h1>운영</h1><p className="muted">{u.email} · {({ review: '심사', support: '고객지원', settlement: '정산', super: '최고관리자' } as any)[u.operator_role!]}</p><Flash sp={sp} />
    <div className="tabs">{TABS.map(([k, v]) => <Link key={k} href={`/admin?tab=${k}`} className={tab === k ? 'on' : ''}>{v}</Link>)}</div>{body}</>);
}
