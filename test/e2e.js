/**
 * 종단 테스트: 서버를 띄운 상태에서 실행 (BASE 기본 http://localhost:3000)
 * 관리자 이메일은 서버의 ADMIN_EMAILS 에 admin@test.kr 이 들어 있어야 한다.
 *   ADMIN_EMAILS=admin@test.kr DATABASE_URL=... npm start  →  npm test
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'stayon', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) { const kv = c.split(';')[0]; if (kv.startsWith('so_sess=')) cookie = kv; }
    const j = await r.json().catch(() => ({}));
    return { s: r.status, j };
  };
}
const day = n => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const admin = client(), u1 = client(), u2 = client();
const stamp = Date.now();

console.log('회원');
let r = await admin('POST', '/api/auth/signup', { email: 'admin@test.kr', password: 'admin1234', name: '관리자', phone: '01000000000', agreeTerms: true, agreePrivacy: true, agreeAge: true });
if (r.s !== 200) r = await admin('POST', '/api/auth/login', { email: 'admin@test.kr', password: 'admin1234' });
ok(r.j.me && r.j.me.role === 'admin', '관리자 이메일로 가입하면 관리자 권한');
r = await u1('POST', '/api/auth/signup', { email: `u${stamp}@test.kr`, password: 'short', name: '홍길동', phone: '010-1111-2222', agreeTerms: true, agreePrivacy: true, agreeAge: true });
ok(r.s === 400, '약한 비밀번호 거절');
r = await u1('POST', '/api/auth/signup', { email: `u${stamp}@test.kr`, password: 'pass1234', name: '홍길동', phone: '010-1111-2222', agreeTerms: true, agreePrivacy: true });
ok(r.s === 400, '필수 약관 미동의 거절');
r = await u1('POST', '/api/auth/signup', { email: `u${stamp}@test.kr`, password: 'pass1234', name: '홍길동', phone: '010-1111-2222', agreeTerms: true, agreePrivacy: true, agreeAge: true });
ok(r.s === 200 && r.j.me.points === 3000, '가입 + 가입축하 3000P');
r = await u1('POST', '/api/auth/signup', { email: `u${stamp}@test.kr`, password: 'pass1234', name: 'x', phone: '01011112222', agreeTerms: true, agreePrivacy: true, agreeAge: true });
ok(r.s === 400, '중복 이메일 거절');
r = await u2('POST', '/api/auth/signup', { email: `v${stamp}@test.kr`, password: 'pass1234', name: '김철수', phone: '01033334444', agreeTerms: true, agreePrivacy: true, agreeAge: true });
ok(r.s === 200, '두 번째 회원 가입');
r = await fetch(BASE + '/api/auth/logout', { method: 'POST' });
ok(r.status === 403, 'CSRF 헤더 없는 요청 거절');

console.log('관리자: 숙소·객실');
r = await admin('POST', '/api/admin/places', { name: '테스트 펜션 ' + stamp, type: '펜션/풀빌라', sido: '강원', area: '강릉', amenities: ['무료주차'], tags: [] });
const placeId = r.j.id; ok(placeId, '숙소 등록');
r = await admin('POST', '/api/admin/rooms', { place_id: placeId, name: '단 1실 객실', base: 2, max: 4, stock: 1, price: 100000, weekend_price: 150000 });
const roomId = r.j.id; ok(roomId, '객실 등록 (재고 1)');
r = await u1('POST', '/api/admin/places', { name: 'hack' });
ok(r.s === 403, '일반 회원은 관리자 API 거절');

console.log('예약·포인트·테스트 결제');
const ci = day(20), co = day(22);
r = await u1('POST', '/api/bookings', { roomId, checkIn: ci, checkOut: co, adults: 2, children: 0, guestName: '홍길동', phone: '01011112222', payMethod: 'card', points: 5000 });
ok(r.s === 400, '보유보다 많은 포인트 사용 거절');
r = await u1('POST', '/api/bookings', { roomId, checkIn: ci, checkOut: co, adults: 5, guestName: '홍길동', phone: '01011112222', payMethod: 'card' });
ok(r.s === 400, '최대 인원 초과 거절');
r = await u1('POST', '/api/bookings', { roomId, checkIn: ci, checkOut: co, adults: 2, children: 0, guestName: '홍길동', phone: '01011112222', payMethod: 'card', points: 3000 });
ok(r.s === 200 && r.j.payment && r.j.booking.status === 'pending', '카드 예약 생성 (결제대기)');
const total = r.j.booking.total, order = r.j.payment;
ok(order.amount === total - 3000, `포인트 차감 후 결제 금액 ${order.amount}`);
r = await u2('POST', '/api/bookings', { roomId, checkIn: ci, checkOut: co, adults: 2, guestName: '김철수', phone: '01033334444', payMethod: 'bank' });
ok(r.s === 409, '같은 날짜 재고 소진 → 다른 회원 예약 거절');
r = await u1('POST', '/api/payments/confirm', { orderId: order.orderId, paymentKey: 'mock_x', amount: order.amount + 1 });
ok(r.s === 400, '금액이 다른 승인 요청 거절');
r = await u2('POST', '/api/payments/confirm', { orderId: order.orderId, paymentKey: 'mock_x', amount: order.amount });
ok(r.s === 400, '다른 회원의 결제 승인 거절');
r = await u1('POST', '/api/payments/confirm', { orderId: order.orderId, paymentKey: 'mock_' + stamp, amount: order.amount });
ok(r.s === 200 && r.j.booking.status === 'ok', '테스트 결제 승인 → 예약확정');
const code = r.j.booking.code;
r = await u1('GET', '/api/me');
ok(r.j.me.points === 0, '포인트 잔액 0');

console.log('취소·환불');
r = await u1('GET', `/api/me/bookings/${code}/cancel-preview`);
ok(r.j.rate === 100 && r.j.refundCash === order.amount && r.j.refundPoints === 3000, '20일 전 취소 미리보기: 전액 환불');
r = await u1('POST', `/api/me/bookings/${code}/cancel`, {});
ok(r.s === 200 && r.j.status === 'cancel' && r.j.refund_amount === order.amount, '고객 취소 → 카드 환불');
r = await u1('GET', '/api/me');
ok(r.j.me.points === 3000, '사용 포인트 반환');
r = await u2('POST', '/api/bookings', { roomId, checkIn: ci, checkOut: co, adults: 2, guestName: '김철수', phone: '01033334444', payMethod: 'bank' });
ok(r.s === 200 && r.j.booking.status === 'wait', '취소로 풀린 객실을 무통장으로 예약 (입금대기)');
const bankId = r.j.booking.id;

console.log('관리자 처리');
r = await admin('POST', `/api/admin/bookings/${bankId}/status`, { status: 'done' });
ok(r.s === 400, '입금대기를 바로 이용완료로 바꾸기 거절');
r = await admin('POST', `/api/admin/bookings/${bankId}/status`, { status: 'ok' });
ok(r.j.status === 'ok', '입금 확인 → 예약확정');
r = await admin('POST', `/api/admin/bookings/${bankId}/status`, { status: 'done' });
ok(r.j.status === 'done' && r.j.points_earned === Math.floor(r.j.amount_due * 0.03 / 10) * 10, `이용완료 → ${r.j.points_earned}P 적립`);
const bcode = r.j.code;
r = await u2('POST', '/api/reviews', { code: bcode, rating: 5, text: '깨끗하고 친절했어요. 다시 오고 싶어요.' });
ok(r.s === 200, '이용완료 예약에 후기 작성 + 후기 적립');
r = await u2('POST', '/api/reviews', { code: bcode, rating: 5, text: '두 번째 후기를 써봅니다 테스트' });
ok(r.s === 400, '같은 예약 중복 후기 거절');
r = await admin('GET', '/api/admin/members?q=' + encodeURIComponent('김철수'));
const m2 = r.j.rows.find(x => x.email === `v${stamp}@test.kr`);
r = await admin('POST', `/api/admin/members/${m2.id}/points`, { amount: -999999, memo: '테스트' });
ok(r.s === 400, '잔액보다 큰 차감 거절');
r = await admin('POST', `/api/admin/members/${m2.id}/points`, { amount: 1000, memo: '이벤트 지급' });
ok(r.s === 200, '관리자 포인트 지급');

console.log('재고·요금 관리');
const d1 = day(40);
r = await admin('POST', '/api/admin/inventory', { room: roomId, dates: [d1], action: 'close' });
r = await u1('POST', '/api/bookings', { roomId, checkIn: d1, checkOut: day(41), adults: 2, guestName: '홍길동', phone: '01011112222', payMethod: 'site' });
ok(r.s === 409, '판매중지 날짜 예약 거절');
await admin('POST', '/api/admin/inventory', { room: roomId, dates: [d1], action: 'open' });
await admin('POST', '/api/admin/inventory', { room: roomId, dates: [d1], action: 'price', price: 77000 });
r = await u1('POST', '/api/bookings', { roomId, checkIn: d1, checkOut: day(41), adults: 2, guestName: '홍길동', phone: '01011112222', payMethod: 'site' });
ok(r.s === 200 && r.j.booking.total === 77000 && r.j.booking.status === 'ok', '지정 요금 77,000원으로 현장결제 예약확정');

console.log('동시 예약 (재고 1실에 10명 동시)');
const d2 = day(60), users = [];
for (let i = 0; i < 10; i++) { const c = client(); await c('POST', '/api/auth/signup', { email: `c${i}_${stamp}@test.kr`, password: 'pass1234', name: '동시' + i, phone: '01055556666', agreeTerms: true, agreePrivacy: true, agreeAge: true }); users.push(c); }
const res = await Promise.all(users.map(c => c('POST', '/api/bookings', { roomId, checkIn: d2, checkOut: day(61), adults: 2, guestName: '동시', phone: '01055556666', payMethod: 'bank' })));
ok(res.filter(x => x.s === 200).length === 1 && res.filter(x => x.s === 409).length === 9, `1건만 성공, 9건 마감 (${res.map(x => x.s).join(',')})`);

console.log('광고');
r = await admin('POST', '/api/admin/banners', { title: '테스트 배너', advertiser: '광고주', slot: 'list', link: 'https://example.com', start_date: day(0), end_date: day(10), fee: 300000 });
const banner = r.j.id; ok(banner, '배너 등록');
await u1('POST', '/api/ads/track', { id: banner, k: 'i' }); await u1('POST', '/api/ads/track', { id: banner, k: 'c' });
r = await admin('GET', '/api/admin/banners');
const bb = r.j.rows.find(x => x.id === banner);
ok(bb.imp === 1 && bb.clk === 1, '노출 1 · 클릭 1 집계');
r = await admin('GET', '/api/admin/dashboard');
ok(r.s === 200 && r.j.kpi, '대시보드');
r = await fetch(BASE + '/api/admin/bookings.csv', { headers: {} });
ok(r.status === 403, 'CSV 는 관리자만');

console.log('탈퇴');
r = await u1('POST', '/api/me/withdraw', { password: 'pass1234' });
ok(r.s === 400, '진행 중 예약이 있으면 탈퇴 거절');

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
