import { requireUser, Flash } from '../../../lib.tsx';
import { ProductForm } from '../ProductForm.tsx';
export default async function New({ searchParams }: { searchParams: Promise<any> }) {
  await requireUser('/seller/products/new');
  return (<div style={{ maxWidth: 820 }}><h1>상품 등록</h1><Flash sp={await searchParams} /><ProductForm back="/seller/products/new" /></div>);
}
