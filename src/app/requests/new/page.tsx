import { WORK_TYPES } from '../../../server/custom.ts';
import { requireUser, F, Flash, In } from '../../lib.tsx';

export default async function NewRequest({ searchParams }: { searchParams: Promise<any> }) {
  const sp = await searchParams; await requireUser('/requests/new');
  return (<div style={{ maxWidth: 760 }}><h1>의뢰 등록</h1><Flash sp={sp} /><div className="card"><F a="request_create" back="/requests/new" h={sp.product ? { base_product_id: sp.product } : {}}>
    <label className="in"><span>작업 유형</span><select name="work_type" defaultValue={sp.product ? 'customize' : 'new'}>{Object.entries(WORK_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <In label="제목" name="title" required /><In label="개발 목적" name="purpose" area /><In label="기능 요구사항" name="requirements" area rows={6} required /><In label="실행 환경" name="environment" area />
    <div className="inline"><In label="예산 하한(원)" name="budget_min" type="number" /><In label="예산 상한(원)" name="budget_max" type="number" /><In label="희망 납기" name="due_date" type="date" /></div>
    <In label="참고 자료" name="reference_notes" area /><In label="소스코드 제공 조건" name="source_terms" hint="예: 최종 소스 전체 제공" /><In label="권리 귀속" name="rights_ownership" hint="예: 결과물의 저작재산권은 의뢰자에게 귀속" /><In label="유지보수" name="maintenance" />
    <label className="in"><span>공개 범위</span><select name="is_public"><option value="public">공개(판매자 누구나 견적 가능)</option><option value="private">비공개</option></select></label><button className="pri">등록</button></F></div></div>);
}
