import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db, one, all } from '../../../../server/db.ts';
import { getDeal, STAGES, ASSET_TYPES } from '../../../../server/ip.ts';
import { getProvider } from '../../../../server/providers/sim.ts';
import { AppError, won, dt } from '../../../../server/util.ts';
import { requireUser, F, Flash, Row, In, Check, St } from '../../../lib.tsx';

export default async function Deal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const id = Number((await params).id); const back = `/ip/deals/${id}`; const u = await requireUser(back);
  let d: any; try { d = await getDeal(u, id); } catch (e) { if (e instanceof AppError) redirect('/me?err=' + encodeURIComponent(e.message)); throw e; }
  const isBuyer = u.id === d.buyer_id; const isSeller = u.id === d.seller_id;
  const c = d.contract_id ? await one(db, 'SELECT c.*, v.buyer_agreed_at, v.seller_agreed_at, v.is_draft FROM contracts c JOIN contract_versions v ON v.contract_id=c.id AND v.version_no=c.current_version_no WHERE c.id=$1', [d.contract_id]) : null;
  const o = await one(db, 'SELECT * FROM orders WHERE ip_deal_id=$1', [id]);
  const items = await all(db, 'SELECT * FROM ip_transfer_items WHERE deal_id=$1 ORDER BY id', [id]);
  const caps = getProvider().capabilities();
  return (<><h1>{d.title}</h1><p><span className="tag">{STAGES[d.stage]}</span> <Link href={`/ip/${d.listing_id}`}>자산 소개와 자료실</Link></p><Flash sp={await searchParams} />
    <div className="grid split"><div>
      <div className="card"><h2>거래 조건</h2>
        {d.amount ? <dl><Row label="거래 금액"><b className="num">{won(d.amount)}</b></Row><Row label="조건"><span style={{ whiteSpace: 'pre-wrap' }}>{d.terms}</span></Row>
          <Row label="별도 확인 절차">{d.extra_verification ? '선택함: 정산 전에 운영자가 자산 인도와 권리 이전 증빙을 한 번 더 확인합니다' : '선택하지 않음'}</Row>
          {c && <><Row label="계약서"><Link href={`/contracts/${c.id}`}>계약 보기</Link> {c.is_draft && <span className="tag">법률 검토 전 초안</span>}</Row><Row label="동의">구매자 {dt(c.buyer_agreed_at)} · 판매자 {dt(c.seller_agreed_at)}</Row></>}</dl> : <p className="muted">판매자가 아직 조건을 제시하지 않았습니다. 자료실 열람과 권리·기술 확인을 먼저 진행하세요</p>}
        {isSeller && !o && (!c || c.status === 'negotiating') && <F a="ip_terms" back={back} h={{ id }} className="stack"><In label="거래 금액(원)" name="amount" type="number" value={d.amount} required /><In label="거래 조건" name="terms" area rows={5} value={d.terms} required hint="양도·이용허락 범위, 인도 자산, 기존 이용권 처리, 보증과 책임 범위" /><Check label="고액·권리 양도 거래의 별도 확인 절차 사용" name="extra_verification" on={d.extra_verification} /><button>조건 제시</button></F>}
        {isBuyer && c && !c.buyer_agreed_at && <F a="contract_agree" back={back} h={{ id: c.id }}><button className="pri">조건에 동의</button></F>}</div>
      {c?.status === 'active' && !o && isBuyer && <div className="card"><h2>결제</h2><ul className="lines"><li>독점 거래는 결제를 시작하면 다른 구매자에게 판매되지 않도록 잠깁니다</li><li>권리는 계약과 필요한 공식 이전 절차로 이전됩니다. 파일이나 계정 정보를 받는 것만으로는 이전되지 않습니다</li><li>{caps.mode === 'test' ? '테스트 결제입니다. 실제 대금 보호는 없습니다' : '대금 보호 범위는 주문 화면에 표시됩니다'}</li></ul>
        <F a="ip_pay" back={back} h={{ id }} className="stack"><label className="in" style={{ marginTop: 12 }}><span>결제수단</span><select name="method">{Object.entries(caps.methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="check"><input type="checkbox" name="agree" required /> 계약 조건과 권리 이전 절차 안내를 확인했습니다</label><button className="pri">{won(d.amount)} 결제</button></F></div>}
      {o && <div className="card"><h2>결제와 정산 상태</h2><p><St k="payment" v={o.payment_status} /> · <St k="delivery" v={o.delivery_status} /> · <St k="inspection" v={o.inspection_status} /> · <St k="payout" v={o.payout_status} /></p><Link href={`/orders/${o.id}`}>거래 작업실에서 자세히 보기</Link></div>}
      {o && ['paid', 'partially_refunded'].includes(o.payment_status) && <div className="card"><h2>자산 인도 목록</h2>
        {items.length ? <div className="scroll"><table><thead><tr><th>자산</th><th>판매자 인도</th><th>공식 이전 증빙</th><th>구매자 인수</th><th /></tr></thead><tbody>{items.map((it) => <tr key={it.id}><td>{ASSET_TYPES[it.asset_type]}<div className="muted" style={{ fontSize: 13 }}>{it.description}</div></td><td>{dt(it.seller_marked_at)}</td>
          <td>{it.official_transfer_required ? (it.official_transfer_evidence || '필요') : '해당 없음'}</td><td>{dt(it.buyer_confirmed_at)}</td>
          <td>{isSeller && !it.seller_marked_at && <F a="ip_item_mark" back={back} h={{ id: it.id }} className="inline">{it.official_transfer_required && <In label="공식 이전 완료 증빙" name="evidence" />}<button>인도 표시</button></F>}
            {isBuyer && it.seller_marked_at && !it.buyer_confirmed_at && <F a="ip_item_confirm" back={back} h={{ id: it.id }}><button>인수 확인</button></F>}</td></tr>)}</tbody></table></div> : <p className="muted">아직 목록이 없습니다</p>}
        {isSeller && o.delivery_status !== 'granted' && <><F a="ip_item_add" back={back} h={{ id }} className="inline"><label className="in"><span>자산 종류</span><select name="asset_type">{Object.entries(ASSET_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><In label="설명" name="description" required /><button>목록에 추가</button></F>
          <F a="ip_transfer_done" back={back} h={{ id }}><button className="pri" style={{ marginTop: 12 }}>모든 자산 인도 통지</button></F></>}
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>도메인과 서비스 계정·앱 등록 자산은 제공자의 공식 이전 절차를 마친 증빙이 있어야 합니다. 계정 비밀번호 전달만으로는 완료 처리되지 않습니다. 구매자가 모든 항목을 인수 확인한 뒤 거래 작업실에서 구매확정하면 정산이 진행됩니다</p></div>}
      {!o && (isBuyer || isSeller) && d.stage !== 'cancelled' && <F a="ip_cancel" back={back} h={{ id }}><button className="danger">거래 중단</button></F>}
    </div><aside><div className="card"><h3>진행 단계</h3><ol className="lines">{Object.entries(STAGES).filter(([k]) => k !== 'cancelled').map(([k, v]) => <li key={k} style={{ fontWeight: k === d.stage ? 600 : 400 }}>{v}</li>)}</ol></div></aside></div></>);
}
