import { one, q } from './db.js';

export const DEFAULTS = {
  brand: '스테이온',
  color: '#3b4bdf',
  phone: '',
  adContact: '',
  // 결제
  payMethods: ['card', 'bank', 'site'],
  bank: '',
  bankDeadlineHours: 24,          // 무통장 미입금 자동취소(시간), 0이면 끔
  payDeadline: '예약 후 24시간 이내 입금해 주세요. 미입금 시 자동 취소됩니다.',
  cardHoldMinutes: 15,            // 카드 결제창 진행 중 객실 잡아두는 시간
  // 취소 규정: 체크인 N일 전 이상이면 rate% 환불 (위에서부터 먼저 맞는 규칙 적용)
  cancelRules: [ { days: 7, rate: 100 }, { days: 3, rate: 50 }, { days: 0, rate: 0 } ],
  cancelNote: '숙박 당일 및 노쇼는 환불되지 않습니다. 사용한 포인트는 환불 비율만큼 돌려드립니다.',
  // 포인트
  points: { signupBonus: 3000, earnRate: 3, reviewBonus: 500, minUse: 1000, maxUseRate: 50, unit: 100, expireDays: 365 },
  // 사업자 정보
  company: '', ceo: '', bizNo: '', saleNo: '', address: '', privacyOfficer: '', email: '',
  termsService: `제1조 (목적)
이 약관은 {상호}(이하 "회사")가 운영하는 {서비스명}(이하 "서비스")에서 제공하는 숙박 예약 중개 서비스의 이용 조건과 절차, 회사와 회원의 권리·의무를 정합니다.

제2조 (회원가입)
① 이용자는 이 약관과 개인정보 처리방침에 동의하고 회원정보를 입력하여 가입을 신청합니다.
② 만 14세 미만은 가입할 수 없습니다.

제3조 (예약과 결제)
① 회원은 서비스에서 숙소와 객실, 일정, 인원을 선택해 예약을 신청합니다.
② 결제는 카드·간편결제, 무통장입금, 현장결제 중 회사가 제공하는 방법으로 합니다.
③ 무통장입금 예약은 정해진 시간 안에 입금하지 않으면 자동 취소됩니다.

제4조 (취소와 환불)
예약 취소와 환불은 서비스에 표시된 취소·환불 규정을 따릅니다.

제5조 (포인트)
① 회사는 회원가입, 숙박 이용 완료, 후기 작성 시 정해진 포인트를 적립할 수 있습니다.
② 포인트는 적립일로부터 정해진 기간이 지나면 소멸합니다.
③ 포인트는 현금으로 바꿀 수 없으며, 회원 탈퇴 시 소멸합니다.

제6조 (회원 탈퇴)
회원은 언제든지 마이페이지에서 탈퇴할 수 있습니다. 관계 법령에 따라 보관해야 하는 거래 기록은 정해진 기간 동안 보관합니다.

※ 이 약관은 기본 양식입니다. 운영 전 법률 검토를 받아 수정하세요.`,
  termsPrivacy: `{상호}(이하 "회사")는 이용자의 개인정보를 다음과 같이 처리합니다.

1. 수집 항목
- 필수: 이름, 휴대폰 번호, 이메일(또는 소셜 로그인 식별값)
- 예약 시: 예약자 이름, 휴대폰 번호, 방문 수단, 요청사항
- 자동 수집: 접속 기록

2. 이용 목적
회원 관리, 숙박 예약·결제·환불 처리, 숙소 운영자에게 예약 정보 전달, 고객 문의 응대

3. 보유 기간
회원 탈퇴 시까지. 단, 전자상거래법에 따라 계약·결제 기록 5년, 소비자 불만·분쟁 기록 3년, 접속 기록 3개월 보관

4. 제3자 제공
예약한 숙소의 운영자에게 예약자 이름, 연락처, 일정, 요청사항을 제공합니다.

5. 처리 위탁
결제 처리: 결제대행사(PG), 서버 운영: 클라우드 호스팅 사업자

6. 개인정보 보호책임자: {보호책임자}

※ 이 방침은 기본 양식입니다. 운영 전 실제 처리 내용에 맞게 수정하세요.`
};

let cache = null, cacheAt = 0;
export async function getSettings() {
  if (cache && Date.now() - cacheAt < 10_000) return cache;
  const row = await one(`SELECT value FROM settings WHERE key='main'`);
  const v = row ? row.value : {};
  cache = { ...DEFAULTS, ...v, points: { ...DEFAULTS.points, ...(v.points || {}) } };
  cacheAt = Date.now();
  return cache;
}
export async function saveSettings(v) {
  await q(`INSERT INTO settings(key, value, updated_at) VALUES('main', $1, now())
           ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`, [v]);
  cache = null;
}
export function fillTerms(text, s) {
  return String(text || '').replaceAll('{상호}', s.company || '(상호 미입력)').replaceAll('{서비스명}', s.brand)
    .replaceAll('{보호책임자}', s.privacyOfficer || '(미입력)');
}
export function cancelPolicyText(s) {
  const rules = [...(s.cancelRules || [])].sort((a, b) => b.days - a.days);
  const lines = rules.map((r, i) => {
    const prev = rules[i - 1];
    const range = i === 0 ? `체크인 ${r.days}일 전까지` : r.days === 0 ? `체크인 ${prev.days - 1}일 전 ~ 당일` : `체크인 ${r.days}~${prev.days - 1}일 전`;
    return `${range}: ${r.rate === 100 ? '전액 환불' : r.rate === 0 ? '환불 불가' : r.rate + '% 환불'}`;
  });
  return lines.join('\n') + (s.cancelNote ? '\n' + s.cancelNote : '');
}
