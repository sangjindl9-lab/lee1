import { RIGHT_TYPES } from '../../../server/ip.ts';
import { requireUser, F, Flash, In, Check } from '../../lib.tsx';

export default async function NewIp({ searchParams }: { searchParams: Promise<any> }) {
  await requireUser('/ip/new');
  return (<div style={{ maxWidth: 760 }}><h1>지식재산권 자산 등록</h1><Flash sp={await searchParams} /><div className="card"><F a="ip_save" back="/ip/new">
    <label className="in"><span>권리 종류</span><select name="right_type">{Object.entries(RIGHT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <In label="제목" name="title" required /><In label="공개 소개" name="public_intro" area rows={4} hint="누구나 볼 수 있습니다. 소스나 영업 비밀은 비공개 자료실에 올리세요" /><In label="권리 대상" name="subject" />
    <In label="권리자" name="right_holder" required /><In label="판매 권한의 근거" name="seller_authority" required hint="예: 창작자 겸 단독 권리자, 권리자의 위임" /><In label="공동 권리자" name="co_owners" hint="있으면 모두 적고 동의 여부를 밝히세요" />
    <In label="양도 또는 이용허락 범위" name="scope" area required /><Check label="독점" name="is_exclusive" /><div className="inline"><In label="기간" name="term" /><In label="지역" name="territory" /><In label="사용 분야" name="field_of_use" /></div>
    <In label="기존 이용허락·판매 내역과 제약" name="existing_licenses" area hint="이미 판매한 사용권의 처리 조건을 포함해 적습니다" /><In label="제3자 구성요소" name="third_party" area /><In label="포함 자산" name="included_assets" area /><In label="제외 자산" name="excluded_assets" area />
    <In label="희망 금액(원)" name="asking_price" type="number" /><button className="pri">저장</button></F></div></div>);
}
