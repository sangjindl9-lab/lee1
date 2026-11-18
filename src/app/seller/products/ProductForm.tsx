import { CATEGORIES, FILE_KINDS } from '../../../server/catalog.ts';
import { F, In, Check } from '../../lib.tsx';

export function ProductForm({ p, back }: { p?: any; back: string }) {
  const lic = p?.license || {}; const del: string[] = p?.deliverables || ['source', 'install_doc'];
  return (<F a="product_save" back={back} h={p ? { id: p.id } : {}}>
    <div className="card"><h2>기본 정보</h2>
      <div className="inline"><label className="in"><span>거래 유형 <b>필수</b></span><select name="kind" defaultValue={p?.kind || 'source'}><option value="source">소스코드 구매</option><option value="license">완성형 프로그램 사용권</option></select></label>
        <label className="in"><span>분야 <b>필수</b></span><select name="category" defaultValue={p?.category || ''}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
      <In label="상품명" name="title" value={p?.title} required /><In label="한 줄 요약" name="summary" value={p?.summary} />
      <In label="해결하는 업무 문제" name="problem" value={p?.problem} area hint="한 줄에 하나씩" /><In label="기능 목록" name="features" value={p?.features} area rows={5} hint="한 줄에 하나씩" /><In label="설명" name="description" value={p?.description} area rows={5} />
      <In label="실제 화면·영상 주소" name="media_urls" value={p?.media_urls} area hint="한 줄에 하나씩" /><In label="체험 링크" name="demo_url" type="url" value={p?.demo_url} /></div>
    <div className="card"><h2>범위와 제공 파일</h2>
      <In label="포함 범위" name="included" value={p?.included} area required /><In label="제외 범위" name="excluded" value={p?.excluded} area />
      <div className="in"><span>제공 파일 종류 <b>필수</b></span>{Object.entries(FILE_KINDS).filter(([k]) => !['evidence', 'other'].includes(k)).map(([k, v]) => <label key={k} className="check"><input type="checkbox" name="deliverables" value={k} defaultChecked={del.includes(k)} /> {v}</label>)}<small>여기서 약속한 종류의 파일이 모두 등록되어야 판매할 수 있습니다</small></div>
      <Check label="소스코드 제공" name="has_source" on={p?.has_source} /></div>
    <div className="card"><h2>가격과 라이선스</h2>
      <In label="가격(원)" name="price" type="number" value={p?.option?.price} required />
      <div className="inline"><label className="in"><span>이용 기간</span><select name="license_term" defaultValue={lic.term || 'perpetual'}><option value="perpetual">영구</option><option value="subscription">기간제</option></select></label>
        <In label="기간(개월)" name="term_months" type="number" value={lic.term_months} /><In label="사용자 수" name="max_users" type="number" value={lic.max_users} /><In label="기기 수" name="max_devices" type="number" value={lic.max_devices} /></div>
      <Check label="수정 가능" name="can_modify" on={lic.can_modify} /><Check label="상업적 이용 가능" name="can_commercial" on={lic.can_commercial} /><Check label="재배포 가능" name="can_redistribute" on={lic.can_redistribute} /><Check label="재판매 가능" name="can_resell" on={lic.can_resell} />
      <In label="추가 라이선스 조건" name="license_notes" value={lic.notes} area /><In label="제3자 라이선스·구성요소" name="third_party" value={p?.third_party} area />
      <p className="muted" style={{ fontSize: 13 }}>상품 판매로는 지식재산권이 이전되지 않습니다. 권리 양도는 지식재산권 거래 메뉴에서 등록하세요</p></div>
    <div className="card"><h2>환경·설치·비용</h2>
      <In label="지원 환경" name="environment" value={p?.environment} area /><In label="설치·배포 방법" name="install_method" value={p?.install_method} area />
      <Check label="설치 지원 포함" name="install_support" on={p?.install_support} /><In label="설치 완료 조건" name="install_done_criteria" value={p?.install_done_criteria} />
      <Check label="커스터마이징 가능" name="customizable" on={p?.customizable} /><Check label="외부 유료 서비스(API·서버·구독) 필요" name="external_paid" on={p?.external_paid} />
      <In label="외부 비용 내용" name="external_costs" value={p?.external_costs} area hint="고지하지 않은 추가 비용은 분쟁 사유가 됩니다" /><In label="업데이트·지원 기간" name="update_support" value={p?.update_support} area /></div>
    <div className="card"><h2>검수와 환불</h2>
      <In label="검수 기준" name="inspection_criteria" value={p?.inspection_criteria} area required hint="어떤 환경에서 무엇이 되면 정상인지 적습니다. 분쟁 시 이 기준으로 판단합니다" />
      <In label="검수 기간(일)" name="inspection_days" type="number" value={p?.inspection_days ?? 7} required /><In label="납품 방식과 기한" name="delivery_note" value={p?.delivery_note} />
      <In label="환불·분쟁 절차" name="refund_policy" value={p?.refund_policy} area required />
      <p className="note">운영 비밀번호, 실사용 API 키, 개인정보가 들어 있는 DB는 납품 파일에 넣지 마세요. 업로드 시 일부 패턴을 자동으로 탐지하지만 모든 경우를 찾아내지는 못합니다</p></div>
    <button className="pri">저장</button>{p?.status === 'on_sale' && <span className="muted" style={{ marginLeft: 12 }}>판매 중인 상품을 고치면 다시 심사를 받습니다. 기존 주문은 주문 시점 조건을 유지합니다</span>}
  </F>);
}
