import { notFound } from 'next/navigation';
import { getProduct, FILE_KINDS } from '../../../../server/catalog.ts';
import { getProvider } from '../../../../server/providers/sim.ts';
import { myCompanies } from '../../../../server/company.ts';
import { checkoutBlockers } from '../../../../domain/states.ts';
import { won } from '../../../../server/util.ts';
import { requireUser, F, Flash, Row, Lines } from '../../../lib.tsx';
import { Rights } from '../../../parts.tsx';

export default async function Checkout({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const id = Number((await params).id); const sp = await searchParams;
  const u = await requireUser(`/products/${id}/checkout`);
  const p = await getProduct(id); if (!p || p.status !== 'on_sale') notFound();
  const caps = getProvider().capabilities();
  const companies = (await myCompanies(u.id)).filter((c) => c.role !== 'inspector');
  const blocked = checkoutBlockers(caps, p.inspection_days, 'card').filter((b) => !b.includes('결제수단'));
  return (<div style={{ maxWidth: 760, margin: '0 auto' }}>
    <h1>구매 조건 확인</h1><p className="sub">아래 내용이 주문에 그대로 고정됩니다. 판매자가 나중에 상품을 고쳐도 이 주문의 조건과 파일은 바뀌지 않습니다</p><Flash sp={sp} />
    <div className="card"><h2>{p.title}</h2><dl>
      <Row label="받는 파일">{p.files.map((f: any) => `${FILE_KINDS[f.kind]}(${f.filename})`).join(', ')} · 버전 {p.version?.label}</Row>
      <Row label="포함"><Lines text={p.included} /></Row><Row label="제외"><Lines text={p.excluded} /></Row>
      <Row label="결제 금액"><b className="num">{won(p.option.price)}</b></Row>
      <Row label="추가 비용">{p.external_paid ? <Lines text={p.external_costs} /> : '고지된 외부 유료 서비스 없음'}</Row>
      <Row label="검수">{p.inspection_days}일. 기준: {p.inspection_criteria}</Row><Row label="환불·분쟁"><Lines text={p.refund_policy} /></Row></dl></div>
    <div className="card"><h2>받는 권리</h2><Rights lic={p.license} kind={p.kind} /></div>
    <div className="card"><h2>안전거래 범위</h2><ul className="lines">
      <li>결제대금 보호: {caps.mode === 'test' ? '테스트 결제입니다. 실제 돈이 움직이지 않고 실제 대금 보호도 없습니다' : `결제 사업자(${caps.label})의 기능으로 처리하며, 주문 화면에 실제 상태를 표시합니다`}</li>
      <li>납품물 보관: 판매자가 미리 등록한 파일을 플랫폼이 암호화해 보관하고, 결제 확인 즉시 이 주문에 접근을 엽니다. 전문 소스코드 에스크로 계약과는 다른 서비스입니다</li>
      <li>검수 후 정산: 구매확정 또는 검수 종료 뒤에만 판매자 지급을 요청합니다. 문제를 제기하면 정산을 보류합니다</li>
      <li>환불이 완료되면 추가 다운로드가 차단됩니다. 이미 받은 파일은 삭제하고 이용을 끝내야 합니다</li></ul></div>
    {blocked.length ? <p className="flash bad">{blocked.join(' / ')}</p> :
      <div className="card"><F a="checkout" back={`/products/${id}/checkout`} h={{ id }}>
        <label className="in"><span>결제수단</span><select name="method">{Object.entries(caps.methodLabels).map(([k, v]) => <option key={k} value={k}>{v}{caps.partialRefund[k] ? '' : ' · 부분 환불 미지원'}</option>)}</select></label>
        {companies.length > 0 && <label className="in"><span>구매 주체</span><select name="company_id"><option value="">개인</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.purchase_approval_required && c.role !== 'admin' ? ' · 관리자 승인 필요' : ''}</option>)}</select></label>}
        <label className="check"><input type="checkbox" name="agree" required /> 제공 파일, 받는 권리, 검수 기준과 기한, 환불·분쟁 절차, 안전거래 범위를 확인했고 이 조건으로 구매합니다</label>
        <button className="pri" style={{ marginTop: 12 }}>{won(p.option.price)} 결제</button></F></div>}
  </div>);
}
