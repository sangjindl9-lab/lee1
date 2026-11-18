import Link from 'next/link';
import { searchProducts, CATEGORIES } from '../server/catalog.ts';
import { ProductCard } from './parts.tsx';

export default async function Home() {
  const items = (await searchProducts({})).slice(0, 6);
  return (<>
    <section className="hero">
      <div>
        <h1>소프트웨어와 소스코드를 사고파는 거래를 납품부터 정산까지 추적합니다</h1>
        <p>무엇을 받는지, 어떤 권리를 받는지, 돈과 납품물이 지금 어디에 있는지 거래마다 그대로 보여줍니다</p>
        <div className="acts"><Link href="/market" className="btn pri">상품 둘러보기</Link><Link href="/safe-trade" className="btn">안전거래 범위와 한계</Link></div>
      </div>
      <div className="ledger" aria-label="거래 작업실 화면 예시">
        <div className="cap"><span>거래 작업실 화면 예시</span><span>실제 주문 아님</span></div>
        {[['결제', '결제 완료', '사업자 조회로 확인'], ['대금 보호', '결제 사업자 보호 중', '검수 종료까지'], ['납품', '받을 수 있음', 'source.zip 3f9a2c41d07e'], ['검수', '검수 중', '7일 중 5일 남음'], ['분쟁', '없음', ''], ['환불', '없음', ''], ['판매자 지급', '정산 조건 미충족', '검수 종료 후']].map(([a, b, c]) => (
          <div className="l" key={a}><span>{a}</span><span>{b}</span><span>{c}</span></div>))}
      </div>
    </section>
    <h2>분야</h2>
    <p className="acts" style={{ marginBottom: 32 }}>{Object.entries(CATEGORIES).map(([k, v]) => <Link key={k} href={`/market?category=${k}`} className="btn">{v}</Link>)}</p>
    <h2>새로 등록된 상품</h2>
    {items.length ? <div className="plist">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      : <p className="card muted">아직 판매 중인 상품이 없습니다. <Link href="/seller">판매자로 등록</Link>해 첫 상품을 올릴 수 있습니다</p>}
    <p className="muted" style={{ marginTop: 32 }}>판매 수수료는 판매자에게만 부과하며, 상품 등록 화면에서 예상 정산액을 미리 볼 수 있습니다</p>
  </>);
}
