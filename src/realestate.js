// 부동산 계약 도구: 중개보수 상한 계산과 계약 후 기한 안내
// 요율 출처: 서울부동산정보광장 중개보수 요율표 (주택: 서울특별시 주택중개보수 등에 관한 조례 별표1, 2021.12.30 시행 /
// 오피스텔·주택 외: 공인중개사법 시행규칙 제20조제4항, 2015.1.6 시행). 주택 요율은 시·도 조례로 정하므로 지역마다 다를 수 있다.
const C = require('./core');

const HOUSE_SALE = [[5e7, 6, 250000], [2e8, 5, 800000], [9e8, 4, null], [12e8, 5, null], [15e8, 6, null], [Infinity, 7, null]];
const HOUSE_LEASE = [[5e7, 5, 200000], [1e8, 4, 300000], [6e8, 3, null], [12e8, 4, null], [15e8, 5, null], [Infinity, 6, null]];

// 월세 거래금액: 보증금 + 월차임×100, 그 합이 5천만원 미만이면 보증금 + 월차임×70
function leaseBase(deposit, rent) {
  const a = deposit + rent * 100;
  return rent && a < 5e7 ? deposit + rent * 70 : a;
}
function brokerFee({ property = 'house', deal = 'sale', price = 0, deposit = 0, rent = 0, officetelQualified = true }) {
  const P = Number(price) || 0, D = Number(deposit) || 0, R = Number(rent) || 0;
  if (!['house', 'officetel', 'other'].includes(property) || !['sale', 'lease'].includes(deal)) throw C.bad('물건 종류·거래 유형이 올바르지 않습니다');
  const base = deal === 'sale' ? P : leaseBase(D, R);
  if (!(base > 0)) throw C.bad('거래금액을 입력하세요');
  let rateMil, cap = null, basis;
  if (property === 'house') {
    const row = (deal === 'sale' ? HOUSE_SALE : HOUSE_LEASE).find((r) => base < r[0]);
    [, rateMil, cap] = row; basis = '서울특별시 주택중개보수 조례 별표1 (2021.12.30 시행) — 다른 시·도는 조례 확인';
  } else if (property === 'officetel') {
    rateMil = officetelQualified ? (deal === 'sale' ? 5 : 4) : 9;
    basis = '공인중개사법 시행규칙 제20조제4항 (전용 85㎡ 이하·부엌·화장실·목욕시설 갖춘 오피스텔 ' + (officetelQualified ? '해당' : '외') + ')';
  } else { rateMil = 9; basis = '공인중개사법 시행규칙 제20조제4항 (주택·오피스텔 외: 토지·상가 등, 상한 0.9% 안에서 협의)'; }
  const raw = Math.floor((base * rateMil) / 1000);
  const fee = cap != null ? Math.min(raw, cap) : raw;
  return {
    base, rate: rateMil / 10, cap, fee, vat: Math.floor(fee * 0.1), basis,
    baseNote: deal === 'lease' && R ? `보증금 ${D.toLocaleString('ko-KR')} + 월차임 ${R.toLocaleString('ko-KR')} × ${base === D + R * 70 && D + R * 100 < 5e7 ? 70 : 100}` : null,
    notes: ['상한 금액이며, 실제 보수는 이 범위 안에서 의뢰인과 중개사가 협의해 정합니다', '부가가치세는 별도입니다(일반과세자 기준 10%)', '주택 면적이 건물의 1/2 이상이면 주택 요율, 미만이면 주택 외 요율을 적용합니다'],
  };
}

// 계약 후 해야 할 일 (일반 안내 — 법률 자문이 아님)
const GUIDE = [
  { title: '부동산 거래신고 (매매)', body: '매매계약 체결일부터 30일 이내 관할 시·군·구청에 신고. 원칙은 거래당사자 공동 신고, 중개사가 계약서를 작성·교부했다면 중개사가 신고합니다. (부동산 거래신고 등에 관한 법률 제3조)' },
  { title: '주택임대차 신고 (전월세 신고제)', body: '수도권·광역시·세종·제주 등에서 보증금 6천만원 초과 또는 월차임 30만원 초과 주택 임대차는 계약일부터 30일 이내 신고. 신고하면 확정일자가 자동 부여됩니다.' },
  { title: '임대인 정보 제시 의무', body: '주택 임대차계약을 맺을 때 임대인은 선순위 확정일자 부여일·차임·보증금 등 임대차 정보와 납세증명서를 제시해야 합니다. 계약 전 열람에 동의하면 제시를 갈음할 수 있습니다. (주택임대차보호법 제3조의7)' },
  { title: '갱신 통지 기간', body: '주택: 임대차 만료 6개월 전부터 2개월 전까지 갱신 거절·조건 변경 통지(놓치면 묵시적 갱신). 상가: 임차인 갱신요구는 만료 6개월 전부터 1개월 전까지, 최초 계약일부터 10년 범위.' },
  { title: '중개대상물 확인·설명서', body: '개업공인중개사는 거래계약서를 작성할 때 확인·설명서를 작성해 서명·날인하고 당사자에게 교부·보존해야 합니다. 공인전자문서센터에 보관하면 보존 의무가 면제됩니다. (공인중개사법 제25조)' },
  { title: '주민등록번호', body: '이음사인은 주민등록번호를 받지 않습니다. 법령 근거 없이는 주민등록번호를 처리할 수 없으므로 생년월일·연락처로 당사자를 표시하고, 필요한 신고는 정부 시스템에서 따로 하세요. (개인정보 보호법 제24조의2)' },
];
module.exports = { brokerFee, leaseBase, GUIDE };
