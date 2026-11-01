// 범용 계약(기업 간 B2B·개인 고객 B2C)과 부동산 계약 예시 서식.
// 모두 "회사 검토용 예시"이며 기관 승인 양식·법정 서식이 아니다. 부동산 서식은 공개된 표준계약서의 구성과
// 관련 법령(주택임대차보호법·상가건물 임대차보호법·민법·공인중개사법·부동산 거래신고법)을 참고해 새로 쓴 것이다.
const NOTE = '\n※ 이음사인이 제공하는 회사 검토용 예시 서식입니다. 기관 승인 양식이나 법정 서식이 아니므로 사용 전 법률·세무 전문가 검토를 받으세요.';
const RE_NOTE = '\n※ 공개된 표준계약서의 구성과 관련 법령을 참고해 만든 회사 검토용 예시입니다. 법무부·국토교통부 표준계약서 원문이나 법정 서식이 아니며, 실제 거래 전 전문가 검토를 받으세요. 주민등록번호는 받지 않습니다.';
const f = (key, label, type = 'text', o = {}) => ({ key, label, type, required: o.required ?? true, owner: o.owner || 'sender', pii: !!o.pii, scope: o.scope || 'each', ...(o.options ? { options: o.options } : {}), ...(o.schedule ? { schedule: o.schedule } : {}) });
const opt = { required: false };
const person = (prefix, owner) => [f(`${prefix}_birth`, '생년월일', 'date', { owner, pii: true }), f(`${prefix}_addr`, '주소', 'text', { owner, pii: true }), f(`${prefix}_phone`, '연락처', 'phone', { owner, pii: true })];

const GENERAL = [
  {
    category: '일반', name: '[예시] 용역(업무위탁) 계약서', doc_type: '용역계약서',
    roles: [{ key: 'vendor', label: '수탁자(을)', kind: 'external', party: 'company', order: 1 }, { key: 'company', label: '위탁자(갑) 직인', kind: 'seal', order: 2 }],
    fields: [f('service_name', '용역명'), f('scope', '업무 범위', 'textarea'), f('deliverable', '산출물·검수 기준', 'textarea'), f('amount', '용역대금(원, VAT 별도)', 'number'),
      f('pay_terms', '지급 조건', 'textarea'), f('start_date', '계약 시작일', 'date'), f('end_date', '계약 종료일', 'date'), f('special', '특약', 'textarea', opt),
      f('v_addr', '수탁자 주소', 'text', { owner: 'vendor' })],
    body: `## 제1조 (당사자)
위탁자(갑): {{@company}} (사업자등록번호 {{@company_bizno}})
수탁자(을): {{@vendor.org}} (사업자등록번호 {{@vendor.orgno}}, 대표 {{@vendor.name}}, 주소 {{v_addr}})

## 제2조 (용역의 내용)
용역명: {{service_name}}
업무 범위: {{scope}}

## 제3조 (계약기간)
{{start_date}} 부터 {{end_date}} 까지로 한다.

## 제4조 (용역대금과 지급)
용역대금은 {{amount|한글}}({{amount}}원, 부가가치세 별도)으로 하며 다음 조건에 따라 지급한다.
{{pay_terms}}

## 제5조 (검수)
을은 다음 산출물을 제출하고, 갑은 받은 날부터 10일 안에 검수 결과를 알린다.
{{deliverable}}

## 제6조 (비밀유지)
양 당사자는 이 계약으로 알게 된 상대방의 영업상 비밀을 계약 종료 후에도 제3자에게 누설하지 않는다.

## 제7조 (계약 해지)
한쪽이 이 계약을 위반하고 14일 이상의 기간을 정한 시정 요구에도 고치지 않으면 상대방은 계약을 해지할 수 있다.

## 제8조 (특약)
{{special}}

계약일: {{@date}}${NOTE}`,
  },
  {
    category: '일반', name: '[예시] 물품 공급 계약서', doc_type: '공급계약서',
    roles: [{ key: 'supplier', label: '공급자', kind: 'external', party: 'company', order: 1 }, { key: 'company', label: '구매자 직인', kind: 'seal', order: 2 }],
    fields: [f('items', '품목·규격·수량·단가', 'textarea'), f('amount', '공급가액(원, VAT 별도)', 'number'), f('delivery_date', '납품기한', 'date', { schedule: '납품기한' }), f('delivery_place', '납품 장소'),
      f('pay_terms', '대금 지급 조건', 'textarea'), f('warranty', '하자보증 기간', 'text'), f('special', '특약', 'textarea', opt)],
    body: `## 제1조 (당사자)
구매자: {{@company}}
공급자: {{@supplier.org}} (사업자등록번호 {{@supplier.orgno}}, 대표 {{@supplier.name}})

## 제2조 (공급 물품)
{{items}}
공급가액: {{amount|한글}}({{amount}}원, 부가가치세 별도)

## 제3조 (납품)
공급자는 {{delivery_date}}까지 {{delivery_place}}에 물품을 납품한다. 납품 지연 시 지체일수에 따라 별도 합의한 지체상금을 부담한다.

## 제4조 (검수와 대금 지급)
구매자는 납품받은 물품을 검수하고, 다음 조건에 따라 대금을 지급한다.
{{pay_terms}}

## 제5조 (하자보증)
공급자는 검수 완료일부터 {{warranty}} 동안 물품의 하자에 대해 무상으로 수리·교환한다.

## 제6조 (특약)
{{special}}

계약일: {{@date}}${NOTE}`,
  },
  {
    category: '일반', name: '[예시] 비밀유지계약서 (NDA, 상호)', doc_type: '비밀유지계약서',
    roles: [{ key: 'counterpart', label: '상대 회사', kind: 'external', party: 'company', order: 1 }, { key: 'company', label: '당사 직인', kind: 'seal', order: 2 }],
    fields: [f('purpose', '정보 제공 목적', 'textarea'), f('start_date', '효력 발생일', 'date'), f('end_date', '비밀유지 의무 종료일', 'date'), f('special', '특약', 'textarea', opt)],
    body: `## 제1조 (목적)
{{@company}}와 {{@counterpart.org}}(이하 "양 당사자")는 다음 목적을 위해 서로 제공하는 비밀정보의 보호에 관하여 합의한다.
{{purpose}}

## 제2조 (비밀정보)
서면·전자적 방법으로 제공되거나 구두로 제공된 후 비밀임을 알린 기술·영업·재무 정보를 말한다. 이미 공개된 정보, 받기 전부터 적법하게 보유한 정보, 독자적으로 개발한 정보는 제외한다.

## 제3조 (의무)
양 당사자는 비밀정보를 목적 외로 쓰지 않으며, 업무상 알 필요가 있는 임직원 외에는 공개하지 않는다.

## 제4조 (기간과 반환)
이 계약은 {{start_date}}부터 효력이 있고 비밀유지 의무는 {{end_date}}까지 유지된다. 상대방이 요청하면 비밀정보를 지체 없이 반환하거나 파기한다.

## 제5조 (특약)
{{special}}

계약일: {{@date}}${NOTE}`,
  },
  {
    category: '일반', name: '[예시] 서비스 이용 계약서 (개인 고객)', doc_type: '서비스이용계약서',
    roles: [{ key: 'customer', label: '고객', kind: 'external', order: 1 }, { key: 'company', label: '회사 직인', kind: 'seal', order: 2, optional: true }],
    fields: [f('service_name', '서비스명'), f('amount', '이용요금(원, VAT 포함)', 'number'), f('start_date', '이용 시작일', 'date'), f('end_date', '이용 종료일', 'date'), f('refund', '해지·환불 기준', 'textarea'),
      f('c_addr', '주소', 'text', { owner: 'customer', pii: true }), f('c_phone', '연락처', 'phone', { owner: 'customer', pii: true }),
      f('c_terms', '계약 내용과 해지·환불 기준을 확인했습니다', 'check', { owner: 'customer' }), f('c_privacy', '계약 이행을 위한 개인정보 수집·이용(이름·주소·연락처, 계약 종료 후 5년 보관)에 동의합니다', 'check', { owner: 'customer' }),
      f('c_marketing', '(선택) 이벤트·혜택 안내 수신에 동의합니다', 'check', { owner: 'customer', required: false })],
    body: `## 서비스 이용 계약
회사: {{@company}}
고객: {{@customer.name}} (주소 {{c_addr}}, 연락처 {{c_phone}})

## 1. 서비스와 기간
서비스: {{service_name}}
기간: {{start_date}} ~ {{end_date}}
이용요금: {{amount|한글}}({{amount}}원, 부가가치세 포함)

## 2. 해지·환불
{{refund}}
고객은 관련 법령이 정한 청약철회 등의 권리를 가집니다.

## 3. 확인과 동의
계약 내용 확인: {{c_terms}}
개인정보 수집·이용 동의: {{c_privacy}}
마케팅 수신 동의(선택): {{c_marketing}}

계약일: {{@date}}${NOTE}`,
  },
  {
    category: '일반', name: '[예시] 개인정보 수집·이용 동의서', doc_type: '개인정보동의서',
    roles: [{ key: 'subject', label: '정보주체', kind: 'external', order: 1 }],
    fields: [f('purpose', '수집·이용 목적', 'textarea'), f('items', '수집 항목'), f('retention', '보유·이용 기간'),
      f('s_agree', '위 개인정보 수집·이용에 동의합니다 (동의를 거부할 수 있으며, 거부 시 해당 서비스 이용이 제한될 수 있습니다)', 'check', { owner: 'subject' }),
      f('s_marketing', '(선택) 홍보·마케팅 목적 이용에 동의합니다', 'check', { owner: 'subject', required: false })],
    body: `## 개인정보 수집·이용 동의서
수집 기관: {{@company}}
정보주체: {{@subject.name}}

수집·이용 목적: {{purpose}}
수집 항목: {{items}}
보유·이용 기간: {{retention}}

필수 동의: {{s_agree}}
선택 동의: {{s_marketing}}

동의일: {{@date}}${NOTE}`,
  },
];

// ── 부동산
const RE_ROLES = (a, aLabel, b, bLabel) => [
  { key: a, label: aLabel, kind: 'external', order: 1 }, { key: `${a}2`, label: `공동${aLabel}`, kind: 'external', order: 1, optional: true },
  { key: b, label: bLabel, kind: 'external', order: 2 }, { key: `${b}2`, label: `공동${bLabel}`, kind: 'external', order: 2, optional: true },
  { key: 'broker', label: '개업공인중개사(당사)', kind: 'internal', order: 3, optional: true },
  { key: 'broker2', label: '공동중개 개업공인중개사', kind: 'external', party: 'company', order: 3, optional: true },
];
const PROPERTY = [f('site', '소재지(도로명주소)'), f('land_type', '토지 지목', 'text', opt), f('land_area', '토지 면적(㎡)', 'text', opt), f('bldg', '건물 구조·용도'), f('bldg_area', '건물 면적(㎡)')];
const PAY = (totalLabel) => [f('amount', `${totalLabel}(원)`, 'number'), f('down', '계약금(원, 계약 시 지급)', 'number'), f('mid', '중도금(원)', 'number', opt), f('mid_date', '중도금 지급일', 'date', { required: false, schedule: '중도금 지급일' }),
  f('balance', '잔금(원)', 'number'), f('balance_date', '잔금 지급일', 'date', { schedule: '잔금 지급일' })];
const BROKER_FIELDS = [f('bk_office', '중개사무소 명칭', 'text', { owner: 'broker' }), f('bk_regno', '중개사무소 등록번호', 'text', { owner: 'broker' }), f('bk_addr', '중개사무소 소재지', 'text', { owner: 'broker' }),
  f('b2_regno', '중개사무소 등록번호', 'text', { owner: 'broker2' }), f('b2_addr', '중개사무소 소재지', 'text', { owner: 'broker2' })];
const CHECKS = [{ type: 'sum', parts: ['down', 'mid', 'balance'], total: 'amount', label: '대금 분할 확인' }];
const BROKER_CLAUSE = `## 중개보수와 확인·설명서
개업공인중개사가 이 계약을 중개한 경우, 중개보수는 관계 법령이 정한 상한 안에서 따로 약정하며 본인의 고의·과실 없이 계약이 무효·취소·해제되어도 지급한다. 개업공인중개사는 중개대상물 확인·설명서를 작성해 서명·날인하고 거래당사자에게 교부한다.
중개사무소: {{bk_office}} (등록번호 {{bk_regno}}, {{bk_addr}}) / 공동중개: {{@broker2.org}} (등록번호 {{b2_regno}})`;
const PARTIES = (a, aL, ap, b, bL, bp) => `## 당사자
${aL}: {{@${a}.name}} (생년월일 {{${ap}_birth}}, 주소 {{${ap}_addr}}, 연락처 {{${ap}_phone}})  공동${aL}: {{@${a}2.name}}
${bL}: {{@${b}.name}} (생년월일 {{${bp}_birth}}, 주소 {{${bp}_addr}}, 연락처 {{${bp}_phone}})  공동${bL}: {{@${b}2.name}}`;
const PROP_TEXT = `## 부동산의 표시
소재지: {{site}}
토지: 지목 {{land_type}}, 면적 {{land_area}}㎡
건물: 구조·용도 {{bldg}}, 면적 {{bldg_area}}㎡`;

const REAL_ESTATE = [
  {
    category: '부동산', name: '[예시] 주택 임대차 계약서 (전세·월세)', doc_type: '주택임대차계약서',
    roles: RE_ROLES('lessor', '임대인', 'lessee', '임차인'),
    fields: [...PROPERTY, f('lease_part', '임차할 부분'), f('lease_kind', '임대차 종류', 'select', { options: ['전세', '월세', '보증부 월세'] }), ...PAY('보증금'),
      f('rent', '차임(월세, 원)', 'number', opt), f('rent_day', '차임 지급일(매월 며칠)', 'text', opt), f('mgmt_fee', '관리비(정액, 원)', 'number', opt),
      f('start_date', '임대차 시작일(주택 인도일)', 'date'), f('end_date', '임대차 종료일', 'date'), f('repair', '입주 전 수리할 사항', 'textarea', opt),
      f('info_way', '임대인 정보 제시 방법', 'select', { options: ['선순위 확정일자 부여현황·납세증명서를 제시함', '임차인의 정보 열람에 동의함'] }),
      f('special', '특약사항', 'textarea', opt),
      ...person('lr', 'lessor'), ...person('le', 'lessee'), ...BROKER_FIELDS],
    extra: {
      checks: CHECKS,
      deadlines: [{ from: '@contract', days: 30, title: '주택임대차 신고 기한(신고 대상인 경우)' }, { from: 'end_date', days: -180, title: '갱신 거절·조건 변경 통지 시작(만료 6개월 전)' }, { from: 'end_date', days: -60, title: '갱신 거절·조건 변경 통지 마감(만료 2개월 전)' }],
      checklist: ['등기사항증명서로 소유자와 근저당·가압류 등 권리관계를 확인했다', '임대인 신분증과 등기상 소유자가 같은지(대리인이면 위임장·인감증명서) 확인했다', '선순위 확정일자·보증금 정보와 미납 국세·지방세를 제시받았거나 열람했다', '건축물대장으로 주거용 여부와 위반건축물 여부를 확인했다', '중개대상물 확인·설명서를 교부하고 설명했다(중개한 경우)', '임차인에게 전입신고·확정일자(또는 주택임대차 신고)를 안내했다'],
    },
    body: `${PROP_TEXT}
임차할 부분: {{lease_part}}

${PARTIES('lessor', '임대인', 'lr', 'lessee', '임차인', 'le')}

## 제1조 (보증금과 차임)
임대차 종류: {{lease_kind}}
보증금: {{amount|한글}}({{amount}}원)
계약금 {{down}}원은 계약 시 지급하고 영수함. 중도금 {{mid}}원은 {{mid_date}}에, 잔금 {{balance}}원은 {{balance_date}}에 지급한다.
차임(월세): {{rent}}원, 매월 {{rent_day}}일 지급. 관리비(정액): {{mgmt_fee}}원

## 제2조 (임대차기간)
임대인은 주택을 {{start_date}}까지 임차인에게 인도하며, 임대차기간은 인도일부터 {{end_date}}까지로 한다.

## 제3조 (입주 전 수리)
{{repair}}

## 제4조 (임차주택의 사용·관리·수선)
임차인은 임대인의 동의 없이 주택의 구조를 바꾸거나 전대·양도하지 못한다. 임대인은 임차인이 주택을 사용·수익하는 데 필요한 상태를 유지하고, 주요 설비의 노후·불량으로 인한 수선은 임대인이, 임차인의 고의·과실 또는 통상의 간단한 수선은 임차인이 부담한다.

## 제5조 (계약의 해제)
임차인이 임대인에게 중도금(중도금이 없으면 잔금)을 지급하기 전까지 임대인은 계약금의 배액을 상환하고, 임차인은 계약금을 포기하고 이 계약을 해제할 수 있다.

## 제6조 (채무불이행과 손해배상)
당사자 한쪽이 채무를 이행하지 않으면 상대방은 상당한 기간을 정해 이행을 최고하고 계약을 해제할 수 있으며, 그로 인한 손해배상을 청구할 수 있다.

## 제7조 (임대인의 정보 제시)
임대인은 주택임대차보호법 제3조의7에 따라 확정일자 부여일·차임·보증금 등 임대차 정보와 납세증명서를 제시하여야 한다. 이 계약에서는 다음과 같이 하였다: {{info_way}}

## 제8조 (계약의 종료)
임대차가 끝나면 임차인은 주택을 원래 상태로 복구해 임대인에게 반환하고, 임대인은 보증금을 임차인에게 반환한다. 갱신 거절·조건 변경 통지는 임대차기간 만료 6개월 전부터 2개월 전까지 하여야 하며, 그 기간에 통지가 없으면 관계 법령에 따라 갱신된 것으로 본다.

${BROKER_CLAUSE}

## 특약사항
{{special}}
(권장 특약 예) 임대인이 미리 알리지 않은 선순위 임대차 정보나 미납·체납 국세·지방세가 잔금 지급 전까지 확인되는 경우 임차인은 위약금 없이 계약을 해제할 수 있다.

계약일: {{@date}}${RE_NOTE}`,
  },
  {
    category: '부동산', name: '[예시] 부동산 매매 계약서', doc_type: '부동산매매계약서',
    roles: RE_ROLES('seller', '매도인', 'buyer', '매수인'),
    fields: [...PROPERTY, ...PAY('매매대금'), f('assume', '매수인이 승계할 융자금·임대보증금(있으면)', 'text', opt), f('special', '특약사항', 'textarea', opt),
      ...person('sr', 'seller'), ...person('by', 'buyer'), ...BROKER_FIELDS],
    extra: {
      checks: CHECKS,
      deadlines: [{ from: '@contract', days: 30, title: '부동산 거래신고 기한(계약일부터 30일)' }],
      checklist: ['등기사항증명서로 소유자와 제한물권(근저당·가압류·가처분 등)을 확인했다', '매도인 본인 여부(대리인이면 위임장·인감증명서)를 확인했다', '토지이용계획·건축물대장으로 용도와 위반건축물 여부를 확인했다', '승계할 융자금·임대차가 있으면 금액과 조건을 확인했다', '중개대상물 확인·설명서를 교부하고 설명했다(중개한 경우)', '계약일부터 30일 안에 부동산 거래신고를 하도록 안내했다'],
    },
    body: `${PROP_TEXT}

${PARTIES('seller', '매도인', 'sr', 'buyer', '매수인', 'by')}

## 제1조 (매매대금)
매매대금: {{amount|한글}}({{amount}}원)
계약금 {{down}}원은 계약 시 지급하고 영수함. 중도금 {{mid}}원은 {{mid_date}}에, 잔금 {{balance}}원은 {{balance_date}}에 지급한다.
매수인이 승계할 융자금·임대보증금: {{assume}}

## 제2조 (소유권 이전 등)
매도인은 잔금을 받는 동시에 소유권 이전등기에 필요한 모든 서류를 교부하고 등기 절차에 협력하며, 위 부동산을 {{balance_date}}에 인도한다.

## 제3조 (제한물권 등의 소멸)
매도인은 위 부동산에 설정된 저당권·지상권·임차권 등 소유권 행사를 제한하는 사유나 제세공과금 등의 미납금이 있으면 잔금 지급일까지 이를 말소한다. 다만 당사자가 승계하기로 합의한 권리와 금액은 그렇지 않다.

## 제4조 (지방세 등)
위 부동산에서 생긴 수익과 제세공과금은 인도일을 기준으로 그 전까지는 매도인, 그 이후는 매수인이 부담한다. 지방세 납부의무자와 납부책임은 지방세법 규정에 따른다.

## 제5조 (계약의 해제)
매수인이 매도인에게 중도금(중도금이 없으면 잔금)을 지급하기 전까지 매도인은 계약금의 배액을 상환하고, 매수인은 계약금을 포기하고 이 계약을 해제할 수 있다.

## 제6조 (채무불이행과 손해배상)
당사자 한쪽이 채무를 이행하지 않으면 상대방은 상당한 기간을 정해 이행을 최고하고 계약을 해제할 수 있으며, 그로 인한 손해배상을 청구할 수 있다.

${BROKER_CLAUSE}

## 특약사항
{{special}}

계약일: {{@date}}
※ 매매계약 체결일부터 30일 이내 부동산 거래신고가 필요합니다(중개사가 계약서를 작성한 경우 중개사가 신고).${RE_NOTE}`,
  },
  {
    category: '부동산', name: '[예시] 상가건물 임대차 계약서', doc_type: '상가임대차계약서',
    roles: RE_ROLES('lessor', '임대인', 'lessee', '임차인'),
    fields: [...PROPERTY, f('lease_part', '임차할 부분'), f('use', '업종(용도)'), ...PAY('보증금'), f('rent', '차임(월세, 원)', 'number'),
      f('vat', '차임의 부가가치세', 'select', { options: ['부가가치세 별도', '부가가치세 포함'] }), f('rent_day', '차임 지급일(매월 며칠)', 'text'), f('mgmt_fee', '관리비(원)', 'number', opt),
      f('start_date', '임대차 시작일(인도일)', 'date'), f('end_date', '임대차 종료일', 'date'), f('special', '특약사항', 'textarea', opt),
      ...person('lr', 'lessor'), ...person('le', 'lessee'), ...BROKER_FIELDS],
    extra: {
      checks: CHECKS,
      deadlines: [{ from: 'end_date', days: -180, title: '갱신 요구·거절 통지 시작(만료 6개월 전)' }, { from: 'end_date', days: -30, title: '임차인 갱신요구 마감(만료 1개월 전)' }],
      checklist: ['등기사항증명서로 소유자와 권리관계를 확인했다', '건축물대장으로 해당 업종 영업이 가능한 용도인지 확인했다', '임대인 본인 여부(대리인이면 위임 서류)를 확인했다', '중개대상물 확인·설명서를 교부하고 설명했다(중개한 경우)', '사업자등록과 확정일자(대항력·우선변제) 절차를 안내했다'],
    },
    body: `${PROP_TEXT}
임차할 부분: {{lease_part}} / 업종: {{use}}

${PARTIES('lessor', '임대인', 'lr', 'lessee', '임차인', 'le')}

## 제1조 (보증금과 차임)
보증금: {{amount|한글}}({{amount}}원)
계약금 {{down}}원은 계약 시 지급하고 영수함. 중도금 {{mid}}원은 {{mid_date}}에, 잔금 {{balance}}원은 {{balance_date}}에 지급한다.
차임: 월 {{rent}}원({{vat}}), 매월 {{rent_day}}일 지급. 관리비: {{mgmt_fee}}원

## 제2조 (임대차기간)
임대인은 건물을 {{start_date}}까지 인도하며, 임대차기간은 인도일부터 {{end_date}}까지로 한다.

## 제3조 (사용·관리)
임차인은 임대인의 동의 없이 건물의 구조·용도를 바꾸거나 전대·양도하지 못하며, 정한 업종 외의 용도로 사용하지 않는다.

## 제4조 (계약의 해제)
임차인이 중도금(중도금이 없으면 잔금)을 지급하기 전까지 임대인은 계약금의 배액을 상환하고, 임차인은 계약금을 포기하고 계약을 해제할 수 있다.

## 제5조 (계약갱신)
임차인은 임대차기간 만료 6개월 전부터 1개월 전까지 계약갱신을 요구할 수 있으며, 갱신요구권은 최초 임대차기간을 포함해 전체 10년을 넘지 않는 범위에서 행사할 수 있다(상가건물 임대차보호법 적용 범위 안에서).

## 제6조 (원상회복)
임대차가 끝나면 임차인은 건물을 원래 상태로 회복해 반환하고, 임대인은 보증금을 반환한다.

${BROKER_CLAUSE}

## 특약사항
{{special}}

계약일: {{@date}}${RE_NOTE}`,
  },
  {
    category: '부동산', name: '[예시] 임대차 갱신·변경 합의서', doc_type: '임대차변경합의서',
    roles: [{ key: 'lessor', label: '임대인', kind: 'external', order: 1 }, { key: 'lessee', label: '임차인', kind: 'external', order: 2 }],
    fields: [f('site', '소재지'), f('orig_date', '원계약일', 'date'), f('renew_type', '갱신 구분', 'select', { options: ['계약갱신요구권 행사에 따른 갱신', '합의에 의한 갱신', '조건 변경(기간 중)'] }),
      f('orig_amount', '종전 보증금(원)', 'number'), f('amount', '변경 보증금(원)', 'number'), f('orig_rent', '종전 차임(원)', 'number', opt), f('new_rent', '변경 차임(원)', 'number', opt),
      f('start_date', '변경·갱신 시작일', 'date'), f('end_date', '종료일', 'date'), f('special', '기타 합의사항', 'textarea', opt)],
    extra: { deadlines: [{ from: 'end_date', days: -180, title: '갱신 통지 시작(만료 6개월 전)' }, { from: 'end_date', days: -60, title: '갱신 통지 마감(주택, 만료 2개월 전)' }] },
    body: `## 임대차 갱신·변경 합의서
소재지: {{site}} / 원계약일: {{orig_date}}
임대인: {{@lessor.name}}   임차인: {{@lessee.name}}

구분: {{renew_type}}
보증금: {{orig_amount}}원 → {{amount}}원
차임: {{orig_rent}}원 → {{new_rent}}원
기간: {{start_date}} ~ {{end_date}}

위 사항 외의 계약 조건은 원계약과 같다.
기타 합의사항: {{special}}

※ 주택 임차인의 계약갱신요구권 행사로 갱신하는 경우, 차임·보증금 증액은 약정 금액의 20분의 1(5%)을 넘지 못합니다(시·도 조례로 더 낮게 정할 수 있음).
합의일: {{@date}}${RE_NOTE}`,
  },
  {
    category: '부동산', name: '[예시] 중개대상물 확인·설명서 수령 확인', doc_type: '확인설명서수령',
    roles: [{ key: 'broker', label: '개업공인중개사(당사)', kind: 'internal', order: 1 }, { key: 'receiver', label: '매수인·임차인', kind: 'external', order: 2 }],
    fields: [f('site', '중개대상물 소재지'), f('deal_kind', '거래 종류', 'select', { options: ['매매', '전세', '월세', '상가 임대차', '기타'] }), f('bk_office', '중개사무소 명칭', 'text', { owner: 'broker' }), f('bk_regno', '등록번호', 'text', { owner: 'broker' }),
      f('r_ok', '개업공인중개사로부터 중개대상물의 상태·권리관계·공법상 제한 등을 설명 듣고 확인·설명서를 받았습니다', 'check', { owner: 'receiver' })],
    attachments: { drawing: false, photo: false },
    body: `## 중개대상물 확인·설명서 수령 확인
중개대상물: {{site}} ({{deal_kind}})
개업공인중개사: {{bk_office}} (등록번호 {{bk_regno}}) / {{@broker.name}}
받는 사람: {{@receiver.name}}

확인: {{r_ok}}

※ 확인·설명서 원본(법정 서식)은 첨부 파일로 붙여 함께 보관합니다. 공인전자문서센터 보관 여부는 중개사무소에서 따로 판단하세요.
확인일: {{@date}}${RE_NOTE}`,
  },
];

module.exports = { GENERAL, REAL_ESTATE };
