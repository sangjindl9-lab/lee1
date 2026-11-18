import Link from 'next/link';
import { searchProducts, CATEGORIES } from '../../server/catalog.ts';
import { ProductCard } from '../parts.tsx';

export default async function Market({ searchParams }: { searchParams: Promise<any> }) {
  const sp = await searchParams;
  const items = await searchProducts(sp);
  return (<>
    <h1>{sp.kind === 'source' ? '소스코드 마켓' : sp.kind === 'license' ? '솔루션 마켓' : '전체 상품'}</h1>
    <p className="sub">{sp.kind === 'source' ? '소스 파일과 정해진 이용 범위를 받습니다. 지식재산권 자체는 이전되지 않습니다' : '완성된 프로그램의 사용권을 받습니다'}</p>
    <form className="card" method="get">
      {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}
      <div className="inline">
        <label className="in"><span>검색</span><input name="q" defaultValue={sp.q || ''} /></label>
        <label className="in"><span>분야</span><select name="category" defaultValue={sp.category || ''}><option value="">전체</option>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="in"><span>사용 환경</span><input name="env" defaultValue={sp.env || ''} placeholder="Windows, 웹" /></label>
        <label className="in"><span>최소 가격</span><input name="min" type="number" defaultValue={sp.min || ''} /></label>
        <label className="in"><span>최대 가격</span><input name="max" type="number" defaultValue={sp.max || ''} /></label>
        <label className="in"><span>정렬</span><select name="sort" defaultValue={sp.sort || ''}><option value="">최신순</option><option value="price">낮은 가격순</option><option value="rating">구매자 평가순</option></select></label>
      </div>
      <div className="acts" style={{ marginTop: 12 }}>
        {[['source', '소스 제공'], ['install', '설치 지원'], ['custom', '커스터마이징 가능'], ['noext', '외부 유료 서비스 불필요']].map(([k, v]) => <label key={k} className="check"><input type="checkbox" name={k} value="1" defaultChecked={!!sp[k]} /> {v}</label>)}
        <button className="pri">찾기</button>
      </div>
    </form>
    {items.length ? <div className="plist">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div> : <p className="card muted">조건에 맞는 상품이 없습니다</p>}
  </>);
}
