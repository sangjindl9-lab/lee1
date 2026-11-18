import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProduct, CATEGORIES } from '../../../server/catalog.ts';
import { getProvider } from '../../../server/providers/sim.ts';
import { db, one, all } from '../../../server/db.ts';
import { won, dt } from '../../../server/util.ts';
import { me, F, Flash, Lines, Row, In } from '../../lib.tsx';
import { Rights, FileTable, ScanNote } from '../../parts.tsx';

export default async function Product({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const id = Number((await params).id); const sp = await searchParams;
  const p = await getProduct(id); const u = await me();
  if (!p || (!['on_sale', 'coming_soon'].includes(p.status) && u?.id !== p.seller_id && !u?.operator_role)) notFound();
  const soon = p.status === 'coming_soon';
  const caps = getProvider().capabilities();
  const wished = u && await one(db, 'SELECT 1 FROM wishlist WHERE user_id=$1 AND product_id=$2', [u.id, id]);
  const qna = u ? await all(db, 'SELECT m.*, s.name FROM messages m JOIN users s ON s.id=m.sender_id WHERE m.product_id=$1 AND m.order_id IS NULL AND ($2 IN (m.sender_id, m.recipient_id) OR m.sender_id=$3) ORDER BY m.id', [id, u.id, p.seller_id]) : [];
  const back = `/products/${id}`;
  return (<>
    <Flash sp={sp} />
    {soon ? <p className="note">출시 예정 상품입니다. 아직 구매할 수 없습니다. 가격, 제공 파일, 검수 기준은 납품 파일 등록과 심사를 거쳐 판매를 시작할 때 확정됩니다</p> : p.status !== 'on_sale' && <p className="note warn">판매 중이 아닌 상품입니다. 판매자와 운영자에게만 보입니다</p>}
    <div className={`grid split${soon ? ' soon' : ''}`}>
      <div>
        <div className="card">
          <div className="acts muted" style={{ fontSize: 13 }}><span className="tag">{p.kind === 'source' ? '소스코드 구매' : '완성형 프로그램 사용권'}</span><span className="tag">{CATEGORIES[p.category]}</span></div>
          <h1 style={{ marginTop: 8 }}>{p.title}</h1><p className="sub">{p.summary}</p>
          <h3>해결하는 업무 문제</h3><Lines text={p.problem} />
          <h3 style={{ marginTop: 16 }}>기능</h3><Lines text={p.features} />
          {p.description && <><h3 style={{ marginTop: 16 }}>설명</h3><p style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p></>}
          {p.media_urls && <><h3>실제 화면과 영상</h3><Lines text={p.media_urls} /></>}
          {p.demo_url && <p><a href={p.demo_url} rel="noopener noreferrer nofollow" target="_blank">체험 링크 열기</a></p>}
        </div>
        <div className="card detail"><h2>무엇을 받는가</h2>
          <div className="grid g2"><div><h3>포함</h3><Lines text={p.included} /></div><div><h3>제외</h3><Lines text={p.excluded} /></div></div>
          <h3 style={{ marginTop: 16 }}>제공 파일 {p.version && <span className="muted" style={{ fontWeight: 400 }}>버전 {p.version.label}</span>}</h3>
          {p.files.length ? <><FileTable files={p.files} /><ScanNote /></> : <p className="muted">등록된 납품 파일이 없습니다</p>}
        </div>
        <div className="card detail"><h2>어떤 권리를 받는가</h2><Rights lic={p.license} kind={p.kind} />
          {p.third_party && <><h3 style={{ marginTop: 16 }}>제3자 라이선스·구성요소</h3><Lines text={p.third_party} /></>}</div>
        <div className="card"><h2>환경과 설치</h2><dl>
          <Row label="지원 환경"><Lines text={p.environment} /></Row><Row label="설치·배포 방법"><Lines text={p.install_method} /></Row>
          <Row label="설치 지원">{p.install_support ? `포함. 완료 조건: ${p.install_done_criteria || '판매자에게 문의'}` : '포함되지 않음'}</Row>
          <Row label="커스터마이징">{p.customizable ? <>가능. <Link href={`/requests/new?product=${id}`}>추가 개발 의뢰</Link></> : '제공하지 않음'}</Row>
          <Row label="업데이트·지원"><Lines text={p.update_support} /></Row></dl></div>
        <div className="card detail"><h2>검수와 문제 해결</h2><dl>
          <Row label="검수 기간">납품물을 받을 수 있게 된 때부터 {p.inspection_days}일</Row><Row label="검수 기준"><Lines text={p.inspection_criteria} /></Row>
          <Row label="환불·분쟁 절차"><Lines text={p.refund_policy} /></Row>
          <Row label="문제가 생기면">거래 작업실에서 문제 제기 → 양측 자료 제출 → 운영자 결정. 결정에는 근거가 기록되고 7일 안에 이의제기할 수 있습니다</Row></dl></div>
        <div className="card detail"><h2>구매 후기</h2>
          {p.reviews.length ? p.reviews.map((r: any, i: number) => <div className="msg" key={i}><b>{r.name}</b> <span className="num">{r.rating}/5</span><time>{dt(r.created_at)}</time><div>{r.body}</div></div>) : <p className="muted">아직 후기가 없습니다. 후기는 검수를 마친 실제 구매자만 쓸 수 있습니다</p>}</div>
        {u && u.id !== p.seller_id && <div className="card"><h2>구매 전 문의</h2>
          {qna.map((m: any) => <div className="msg" key={m.id}><b>{m.name}</b><time>{dt(m.created_at)}</time><div>{m.body}</div></div>)}
          <F a="message" back={back} h={{ product_id: id }}><In label="문의 내용" name="body" area required /><button>보내기</button></F></div>}
      </div>
      <aside>
        <div className="card">
          <div className="muted" style={{ fontSize: 13 }}>얼마를 지불하는가</div><div className="price-lg">{p.option ? won(p.option.price) : '가격 미정'}</div>
          <dl className="detail" style={{ margin: '12px 0' }}>
            <Row label="추가 비용">{p.external_paid ? <Lines text={p.external_costs} /> : '판매자가 고지한 외부 유료 서비스 없음'}</Row>
            <Row label="언제 받는가">결제가 확인되면 바로 내려받을 수 있습니다{p.delivery_note ? `. ${p.delivery_note}` : ''}</Row>
            <Row label="검수 기한">{p.inspection_days}일</Row>
            <Row label="대금 보호">{caps.mode === 'test' ? '테스트 환경: 실제 대금 보호 없음' : '결제 사업자의 보호 기능 적용. 주문 화면에 실제 상태 표시'}</Row>
            <Row label="판매자"><Link href={`/market?seller=${p.seller_id}`}>{p.seller_name}</Link></Row>
          </dl>
          {p.status === 'on_sale' && u?.id !== p.seller_id && <Link href={`/products/${id}/checkout`} className="btn pri" style={{ width: '100%', textAlign: 'center' }}>조건 확인하고 구매</Link>}
          {soon && <p className="muted">판매자: <Link href={`/market?seller=${p.seller_id}`}>{p.seller_name}</Link></p>}
          {u?.id === p.seller_id && <Link href={`/seller/products/${id}`} className="btn" style={{ width: '100%', textAlign: 'center' }}>상품 관리</Link>}
          {u && u.id !== p.seller_id && <F a="wish" back={back} h={{ id }}><button className="link" style={{ width: '100%' }}>{wished ? '찜 해제' : '찜하기'}</button></F>}
        </div>
        {u && u.id !== p.seller_id && <details className="card"><summary>권리 침해·문제 신고</summary>
          <F a="report" back={back} h={{ product_id: id }} className="stack"><label className="in" style={{ marginTop: 12 }}><span>사유</span><select name="reason"><option value="rights_infringement">타인의 소스·권리 침해 의심</option><option value="false_description">설명과 다름</option><option value="malware">악성 파일 의심</option><option value="fake_review">허위 후기</option><option value="other">기타</option></select></label>
            <In label="내용" name="body" area required /><button>신고</button></F></details>}
      </aside>
    </div>
  </>);
}
