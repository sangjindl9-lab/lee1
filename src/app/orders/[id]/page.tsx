import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db, one, all } from '../../../server/db.ts';
import * as trade from '../../../server/trade.ts';
import { getProvider } from '../../../server/providers/sim.ts';
import { AppError, won, dt, hasRole } from '../../../server/util.ts';
import { requireUser, F, Flash, Row, St, Lines, In } from '../../lib.tsx';
import { Rights, FileTable, ScanNote } from '../../parts.tsx';

export default async function Order({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const id = Number((await params).id); const sp = await searchParams; const back = `/orders/${id}`;
  const u = await requireUser(back);
  let o: any; try { o = await trade.getOrder(u, id); } catch (e) { if (e instanceof AppError) redirect('/me?err=' + encodeURIComponent(e.message)); throw e; }
  const s = o.snapshot; const isBuyer = u.id === o.buyer_id; const isSeller = u.id === o.seller_id;
  const company = o.company_id ? await one(db, 'SELECT m.role, c.name FROM company_members m JOIN companies c ON c.id=m.company_id WHERE m.company_id=$1 AND m.user_id=$2', [o.company_id, u.id]) : null;
  const asBuyer = isBuyer || ['admin', 'inspector'].includes(company?.role);
  const pay = await one(db, 'SELECT * FROM payments WHERE order_id=$1', [id]);
  const approval = await one(db, 'SELECT * FROM purchase_approvals WHERE order_id=$1', [id]);
  const files = o.order_type === 'product' ? await all(db, 'SELECT * FROM files WHERE version_id=$1 ORDER BY id', [o.version_id])
    : await all(db, "SELECT f.* FROM files f WHERE f.version_id IN (SELECT version_id FROM deliveries WHERE order_id=$1 AND status='granted') ORDER BY f.id", [id]);
  const links: Record<number, string> = {};
  if (asBuyer && o.delivery_status === 'granted' && ['paid', 'partially_refunded'].includes(o.payment_status)) for (const f of files) { try { links[f.id] = await trade.issueDownload(u, id, f.id); } catch { /* 접근 불가 */ } }
  const disputes = await all(db, 'SELECT * FROM disputes WHERE order_id=$1 ORDER BY id', [id]);
  const entries = disputes.length ? await all(db, 'SELECT e.*, x.name FROM dispute_entries e JOIN users x ON x.id=e.author_id WHERE e.dispute_id IN (SELECT id FROM disputes WHERE order_id=$1) ORDER BY e.id', [id]) : [];
  const refunds = await all(db, 'SELECT * FROM refunds WHERE order_id=$1 ORDER BY id', [id]);
  const payout = await one(db, 'SELECT * FROM payouts WHERE order_id=$1', [id]);
  const messages = await all(db, 'SELECT m.*, x.name FROM messages m JOIN users x ON x.id=m.sender_id WHERE m.order_id=$1 ORDER BY m.id', [id]);
  const downloads = (isSeller || u.operator_role) ? await all(db, 'SELECT d.created_at, f.filename FROM download_logs d JOIN files f ON f.id=d.file_id WHERE d.order_id=$1 ORDER BY d.id', [id]) : [];
  const inspections = await all(db, 'SELECT i.*, x.name FROM inspections i JOIN users x ON x.id=i.inspector_id WHERE i.order_id=$1 ORDER BY i.round', [id]);
  const review = await one(db, 'SELECT 1 FROM reviews WHERE order_id=$1', [id]);
  const closeReq = await one(db, "SELECT * FROM close_requests WHERE order_id=$1 ORDER BY id DESC LIMIT 1", [id]);
  const openDispute = disputes.find((d) => d.status === 'open');
  const est = (isSeller || hasRole(u, 'settlement')) ? (await trade.settlementOf(o)).s : null;
  const caps = getProvider().capabilities();
  const inspecting = ['in_progress', 'revision_requested'].includes(o.inspection_status);
  const overdue = o.inspection_due_at && new Date(o.inspection_due_at) < new Date();
  const paid = ['paid', 'partially_refunded'].includes(o.payment_status);
  return (<>
    <p className="muted num">주문 {o.order_no} · {dt(o.created_at)}{company && ` · ${company.name}`}</p>
    <h1>{s.title}</h1><Flash sp={sp} />
    {approval?.status === 'pending' && <div className="card"><h2>기업 구매 승인 대기</h2>
      {company?.role === 'admin' ? <div className="acts"><F a="purchase_decide" back={back} h={{ id, approve: 1 }}><button className="pri">구매 승인</button></F><F a="purchase_decide" back={back} h={{ id, approve: 0 }} className="inline"><In label="반려 사유" name="note" /><button>반려</button></F></div> : <p className="muted">기업 관리자의 승인을 기다리고 있습니다</p>}</div>}
    {isBuyer && ['unpaid', 'pending'].includes(o.payment_status) && approval?.status !== 'pending' && approval?.status !== 'rejected' && <div className="card acts"><span>결제가 아직 확인되지 않았습니다</span>
      <F a="order_pay" back={back} h={{ id }}><button className="pri">결제 계속</button></F><F a="order_sync" back={back} h={{ id }}><button>결제 상태 다시 확인</button></F></div>}
    <div className="grid split">
      <div>
        <div className="card"><h2>지금 돈과 납품물의 상태</h2>
          <dl>
            <Row label="결제"><St k="payment" v={o.payment_status} /> <span className="num">{won(o.amount)}</span>{o.refunded_amount > 0 && <span className="muted"> · 환불 {won(o.refunded_amount)}</span>}
              {pay && <div className="muted" style={{ fontSize: 13 }}>결제 사업자 조회 결과: {pay.external_status} · 확인 {dt(pay.external_checked_at)}</div>}</Row>
            <Row label="대금 보호"><St k="escrow" v={o.escrow_status} />{s.provider?.mode === 'test' && o.escrow_status !== 'test_simulated' && <span className="muted"> · 테스트 시뮬레이션이며 실제 돈의 이동은 없습니다</span>}</Row>
            <Row label="납품"><St k="delivery" v={o.delivery_status} />{o.delivery_detail && <div className="muted" style={{ fontSize: 13 }}>{o.delivery_detail}</div>}</Row>
            <Row label="검수"><St k="inspection" v={o.inspection_status} />{o.inspection_due_at && inspecting && <span className="muted"> · 기한 {dt(o.inspection_due_at)}{overdue && ' (지남)'}</span>}
              {o.inspection_status === 'not_started' && paid && <div className="muted" style={{ fontSize: 13 }}>납품물을 받을 수 있게 된 때부터 {o.inspection_days}일을 셉니다</div>}</Row>
            <Row label="분쟁"><St k="dispute" v={o.dispute_status} /></Row>
            <Row label="환불"><St k="refund" v={o.refund_status} /></Row>
            <Row label="판매자 지급"><St k="payout" v={o.payout_status} /></Row>
          </dl>
          {o.escrow_status === 'test_simulated' && <p className="note warn" style={{ marginTop: 12 }}>테스트 결제 주문입니다. 실제 결제대금 보호와 지급은 없습니다</p>}
          {o.payment_status === 'cancelled' && files.length > 0 && <p className="note" style={{ marginTop: 12 }}>환불이 완료되어 추가 다운로드가 차단되었습니다. 이미 내려받은 파일은 플랫폼이 회수하거나 원격 삭제할 수 없습니다. 구매자는 파일 이용을 끝내고 삭제해야 합니다</p>}
        </div>

        <div className="card"><h2>무엇을 받는가</h2>
          {s.stage && <p>{s.stage.seq}단계 산출물: {s.stage.deliverables}</p>}
          {files.length ? <><FileTable files={files} dl={(f) => (links[f.id] ? <a className="btn" href={`/api/dl?t=${encodeURIComponent(links[f.id])}`}>내려받기</a> : null)} /><ScanNote />
            {asBuyer && Object.keys(links).length > 0 && <p className="muted" style={{ fontSize: 13 }}>다운로드 링크는 5분 뒤 만료됩니다. 내려받는 것만으로 구매확정되지 않습니다{o.access_until && `. 보관 정책에 따라 ${dt(o.access_until)}까지 받을 수 있습니다`}</p>}</>
            : <p className="muted">{o.order_type === 'ip' ? '자산 인도 목록은 거래 화면에서 확인합니다' : paid ? '아직 납품된 파일이 없습니다' : '결제가 확인되면 표시됩니다'}</p>}
          {o.ip_deal_id && <p><Link href={`/ip/deals/${o.ip_deal_id}`}>지식재산권 거래 화면으로</Link></p>}
          {s.contractId && <p><Link href={`/contracts/${s.contractId}`}>계약 보기</Link>{s.contractDraft && <span className="tag" style={{ marginLeft: 8 }}>법률 검토 전 초안</span>}</p>}
          <div className="grid g2" style={{ marginTop: 12 }}><div><h3>포함</h3><Lines text={s.included} /></div><div><h3>제외</h3><Lines text={s.excluded} /></div></div>
        </div>
        <div className="card"><h2>어떤 권리를 받는가</h2><Rights lic={s.license} kind={s.kind} /></div>

        {asBuyer && o.delivery_status === 'granted' && inspecting && !openDispute && <div className="card"><h2>검수</h2>
          <p className="sub">주문 시 확정한 검수 기준: {s.inspection_criteria}</p>
          <F a="confirm" back={back} h={{ id }}>{trade.CHECKLIST.map(([k, label]) => <label key={k} className="check"><input type="checkbox" name={`c_${k}`} /> {label}</label>)}
            <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>구매확정하면 판매자 정산이 진행됩니다. 문제가 있으면 확정하지 말고 아래에서 수정 요청이나 문제 제기를 하세요</p><button className="pri">구매확정</button></F>
          {o.order_type !== 'product' && o.inspection_status === 'in_progress' && <F a="revision" back={back} h={{ id }} className="stack"><In label="수정 요청(계약 범위 안의 내용)" name="note" area /><button>수정 요청</button></F>}</div>}

        {(isBuyer || isSeller || company) && paid && !openDispute && o.payout_status !== 'void' && <details className="card"><summary>문제 제기·환불 요청</summary>
          <p className="muted" style={{ marginTop: 12 }}>문제를 제기하면 정산이 보류되고 양측이 자료를 제출합니다. 환불 여부는 운영자가 계약 기준으로 결정하며, 요청만으로 환불되지 않습니다{['requested', 'unknown', 'paid'].includes(o.payout_status) && '. 이미 판매자 지급이 진행된 거래라서 지급 보류는 불가능하고 사후 환불·회수 검토로 진행됩니다'}</p>
          <F a="dispute_open" back={back} h={{ id }}><label className="in"><span>문제 유형</span><select name="reason">{Object.entries(trade.DISPUTE_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <In label="계약 기준과 무엇이 다른지" name="description" area rows={4} required /><label className="check"><input type="checkbox" name="wants_refund" /> 환불을 요청합니다</label><button className="danger" style={{ marginTop: 8 }}>문제 제기</button></F></details>}

        {disputes.map((d) => <div className="card" key={d.id}><h2>분쟁 #{d.id} <St k="dispute" v={d.status} /></h2><dl>
          <Row label="유형">{trade.DISPUTE_REASONS[d.reason]}{d.wants_refund && ' · 환불 요청'}</Row><Row label="내용">{d.description}</Row>
          <Row label="플랫폼 정산 보류">{d.post_settlement ? '해당 없음(이미 지급이 진행된 거래)' : '적용됨'}</Row>
          <Row label="결제 사업자 지급 보류">{({ confirmed: '보류 확인됨', unsupported: '사업자가 지원하지 않음. 플랫폼 내부 보류만 적용 중', failed: '보류 요청 실패. 운영자 확인 중', not_requested: '요청 전', not_applicable: '해당 없음. 사후 환불·회수 검토 절차로 진행' } as any)[d.external_hold]}</Row>
          {d.status === 'resolved' && <><Row label="결정">{({ refund_full: '전액 환불', refund_partial: `부분 환불 ${won(d.decision_amount)}`, resume: '거래 재개', release: '정산 진행', external_resolution: '외부 해결 절차 안내' } as any)[d.decision]} · {dt(d.decided_at)}</Row>
            <Row label="근거">{d.decision_basis}</Row><Row label="이의제기">{dt(d.appeal_until)}까지 아래에 이의제기를 남길 수 있습니다. 결정에 동의하지 않으면 소비자분쟁조정위원회, 전자거래분쟁조정위원회, 법원 등 외부 절차를 이용할 수 있습니다</Row></>}</dl>
          {entries.filter((e) => e.dispute_id === d.id).map((e) => <div className="msg" key={e.id}><b>{({ buyer: '구매자', seller: '판매자', operator: '운영자' } as any)[e.role]} {e.name}</b> <span className="tag">{({ statement: '의견', evidence: '증빙', fix_offer: '수정 제안', settlement_offer: '합의 제안', appeal: '이의제기' } as any)[e.kind]}</span><time>{dt(e.created_at)}</time><div style={{ whiteSpace: 'pre-wrap' }}>{e.body}</div></div>)}
          {(isBuyer || isSeller || hasRole(u, 'support')) && <F a="dispute_entry" back={back} h={{ id: d.id }} className="stack"><div className="inline" style={{ marginTop: 12 }}><label className="in"><span>종류</span><select name="kind">{d.status === 'open' ? <><option value="statement">의견</option><option value="evidence">증빙</option><option value="fix_offer">수정 제안</option><option value="settlement_offer">합의 제안</option></> : <option value="appeal">이의제기</option>}</select></label></div><In label="내용" name="body" area required /><button>제출</button></F>}
        </div>)}

        {refunds.length > 0 && <div className="card"><h2>환불 내역</h2><table><thead><tr><th>금액</th><th>상태</th><th>근거</th><th>완료</th></tr></thead><tbody>{refunds.map((r) => <tr key={r.id}><td className="num">{won(r.amount)}</td>
          <td>{({ approved: '결정됨(실행 전)', processing: '결제 취소 처리 중', completed: '환불 완료', failed: '결제 취소 실패', unsupported: '부분 환불 미지원', rejected: '기각', post_settlement_review: '사후 환불·회수 검토', requested: '요청' } as any)[r.status]}{r.failure && <div className="muted" style={{ fontSize: 13 }}>{r.failure}</div>}</td><td>{r.basis}</td><td>{dt(r.completed_at)}</td></tr>)}</tbody></table></div>}

        <div className="card"><h2>메시지</h2>{messages.map((m) => <div className="msg" key={m.id}><b>{m.name}</b><time>{dt(m.created_at)}</time><div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div></div>)}
          {(isBuyer || isSeller) && <F a="message" back={back} h={{ order_id: id }}><In label="요청·답변은 여기에 남기면 기록으로 보관됩니다" name="body" area required /><button>보내기</button></F>}</div>

        {isBuyer && o.product_id && ['confirmed', 'auto_confirmed', 'closed_by_admin'].includes(o.inspection_status) && o.payment_status !== 'cancelled' && !review && <div className="card"><h2>구매 후기</h2>
          <F a="review" back={back} h={{ id }}><label className="in"><span>평점</span><select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select></label><In label="내용" name="body" area required /><button>후기 등록</button></F></div>}
      </div>
      <aside>
        <div className="card"><h3>거래 조건</h3><dl>
          <Row label="결제 금액"><span className="num">{won(o.amount)}</span></Row><Row label="추가 비용">{s.external_paid ? s.external_costs : '고지된 내용 없음'}</Row>
          <Row label="검수 기한">납품 후 {o.inspection_days}일</Row><Row label="검수 기준">{s.inspection_criteria}</Row><Row label="환불·분쟁">{s.refund_policy}</Row>
          <Row label="조건 동의">{dt(o.terms_agreed_at)}</Row><Row label="판매자">{s.sellerName}</Row></dl>
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>주문 시점의 조건입니다. 이후 상품이 바뀌어도 이 주문에는 영향이 없습니다</p></div>
        {est && <div className="card"><h3>정산 내역{payout ? '' : '(예상)'}</h3><dl>
          <Row label="정산 기준 금액"><span className="num">{won(est.base)}</span></Row><Row label="수수료(공급가액)"><span className="num">−{won(est.feeSupply)}</span> <span className="muted">{o.fee_bps / 100}%</span></Row>
          <Row label="수수료 부가세"><span className="num">−{won(est.feeVat)}</span></Row><Row label="결제 비용"><span className="num">−{won(est.sellerPgFee)}</span>{o.pg_fee_bearer === 'platform' && <span className="muted"> 플랫폼 부담</span>}</Row>
          {est.withholdingIncomeTax > 0 && <Row label="원천징수 3.3%"><span className="num">−{won(est.withholdingIncomeTax + est.withholdingLocalTax)}</span></Row>}
          <Row label="실제 지급액"><b className="num">{won(est.net)}</b></Row>
          {payout && <Row label="지급 상태">{({ requested: '지급 요청 접수(완료 아님)', unknown: '결과 확인 중', paid: `지급 완료 ${dt(payout.paid_at)}`, failed: `실패: ${payout.failure}` } as any)[payout.status]}</Row>}</dl>
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>수수료 증빙: {est.feeDoc === 'tax_invoice' ? '세금계산서' : '수수료 영수증'}. 주문 시점의 수수료 정책으로 계산합니다</p></div>}
        {isSeller && o.inspection_status === 'in_progress' && overdue && !openDispute && <div className="card"><h3>검수 종료 심사 요청</h3>
          {closeReq?.status === 'open' ? <p className="muted">심사 요청 중입니다</p> : <F a="close_request" back={back} h={{ id }}><In label="구매자가 확정도 문제 제기도 하지 않는 사정" name="note" area /><button>심사 요청</button></F>}</div>}
        {downloads.length > 0 && <div className="card"><h3>납품·다운로드 기록</h3>{downloads.map((d, i) => <div key={i} className="msg">{d.filename}<time>{dt(d.created_at)}</time></div>)}<p className="muted" style={{ fontSize: 13 }}>다운로드 기록은 증빙이며, 검수 완료의 근거가 아닙니다</p></div>}
        {inspections.length > 0 && <div className="card"><h3>검수 기록</h3>{inspections.map((i) => <div key={i.id} className="msg"><b>{i.round}회차</b> {({ accepted: '승인', revision_requested: '수정 요청', disputed: '분쟁' } as any)[i.result]} · {i.name}<time>{dt(i.created_at)}</time>{i.note && <div>{i.note}</div>}</div>)}</div>}
        {u.operator_role && <Link className="btn" href={`/admin?tab=orders&id=${id}`}>운영 화면에서 보기</Link>}
        <p className="muted" style={{ fontSize: 13 }}>결제 사업자: {caps.label}</p>
      </aside>
    </div>
  </>);
}
