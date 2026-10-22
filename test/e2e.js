// 통합 테스트: 실행 중인 서버(BASE)와 같은 DB(DATABASE_URL)에 대해 예약 흐름·권한·보안을 검증
// 사용: DATABASE_URL=... BASE=http://localhost:3100 node test/e2e.js   (서버는 DEMO_LOGIN=true, SEED_DEMO=true)
import pg from 'pg';
import crypto from 'node:crypto';
import sharp from 'sharp';

const BASE = process.env.BASE || 'http://localhost:3100';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

class Client {
  constructor(name) { this.name = name; this.cookie = ''; this.csrf = null; }
  async req(path, { method = 'GET', body, form, origin = true, csrf = true } = {}) {
    const h = { cookie: this.cookie };
    if (origin && method !== 'GET') h.origin = BASE;
    if (csrf && this.csrf && method !== 'GET') h['x-csrf-token'] = this.csrf;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers: h, body: form || (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' });
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) { const kv = c.split(';')[0]; const [k] = kv.split('='); this.cookie = [...this.cookie.split('; ').filter(x => x && !x.startsWith(k + '=')), kv].join('; '); }
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data, headers: r.headers };
  }
  async me() { const r = await this.req('/api/me'); this.csrf = r.data.csrf; this.user = r.data.user; return r.data.user; }
  async demo(role) { const r = await this.req('/api/auth/demo', { method: 'POST', body: { role } }); await this.me(); return r; }
}

// 데모가 아닌 일반 회원 세션을 DB에 직접 만들어 둔다 (두 번째 게스트용)
async function makeUser(name, phone) {
  const u = (await db.query(`INSERT INTO users(provider,provider_id,name,phone) VALUES ('test',$1,$2,$3) RETURNING id`, [crypto.randomUUID(), name, phone])).rows[0];
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')`,
    [crypto.createHash('sha256').update(token).digest('hex'), u.id, crypto.randomBytes(24).toString('base64url')]);
  const c = new Client(name); c.cookie = 'mm_sid=' + token; await c.me(); return c;
}
const d = n => new Date(Date.now() + 9 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

console.log('보안 헤더·CSRF');
{
  const r = await fetch(BASE + '/');
  ok(/default-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'CSP 헤더 적용');
  ok(r.headers.get('x-frame-options') === 'SAMEORIGIN' || /frame-ancestors 'none'/.test(r.headers.get('content-security-policy')), '클릭재킹 방지');
  ok(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff');
  ok(!r.headers.get('x-powered-by'), '서버 정보 숨김');
  const anon = new Client('anon');
  ok((await anon.req('/api/auth/demo', { method: 'POST', body: { role: 'guest' }, origin: false })).status === 403, 'Origin 없는 POST 차단');
  const evil = await fetch(BASE + '/api/auth/demo', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"role":"guest"}' });
  ok(evil.status === 403, '다른 사이트 Origin POST 차단');
  ok((await anon.req('/api/bookings')).status === 401, '비로그인 예약 조회 401');
  ok((await anon.req('/api/admin/stats')).status === 401, '비로그인 관리자 API 401');
}

const guest = new Client('guest'), host = new Client('host'), admin = new Client('admin');
await guest.demo('guest'); await host.demo('host'); await admin.demo('admin');
ok(guest.user?.role === 'guest' && host.user?.role === 'host' && admin.user?.role === 'admin', '데모 로그인 3종');
ok((await guest.req('/api/wishlist/1', { method: 'POST', csrf: false })).status === 403, 'CSRF 토큰 없는 요청 차단');

console.log('권한 분리');
ok((await guest.req('/api/host/listings')).status === 403, '게스트는 호스트 API 불가');
ok((await guest.req('/api/admin/users')).status === 403, '게스트는 관리자 API 불가');
ok((await host.req('/api/admin/users')).status === 403, '호스트는 관리자 API 불가');

console.log('검색·상세');
const list = (await guest.req('/api/listings')).data.items;
ok(list.length >= 12, `승인된 숙소 검색 (${list.length}곳)`);
const L = list.find(x => !x.instant_book && x.host_id === host.user.id) || list[0];
const det = (await guest.req(`/api/listings/${L.id}`)).data;
ok(det.address === undefined, '상세 주소는 비공개');
ok((await guest.req('/api/listings?checkIn=2020-01-01&checkOut=2019-01-01')).status === 400, '잘못된 날짜 검색 400');
ok((await guest.req("/api/listings?q=%27%3B%20DROP%20TABLE%20users%3B--")).status === 200, 'SQL 주입 문자열 안전 처리');

console.log('예약');
const ci = d(20), co = d(23);
let r = await guest.req('/api/bookings', { method: 'POST', body: { listingId: Number(L.id), checkIn: ci, checkOut: co, guests: 2 } });
ok(r.status === 400 && r.data.code === 'PHONE_REQUIRED', '휴대폰 번호 없으면 예약 불가');
ok((await guest.req('/api/me', { method: 'PUT', body: { name: '데모 게스트', phone: '010-1111-2222' } })).status === 200, '휴대폰 번호 등록');
await guest.me();
r = await guest.req('/api/bookings', { method: 'POST', body: { listingId: Number(L.id), checkIn: ci, checkOut: co, guests: 2, total: 1, price: 1 } });
ok(r.status === 201, '예약 요청 생성');
const B = r.data.id;
const bk = (await db.query('SELECT total, nightly, nights, status FROM bookings WHERE id=$1', [B])).rows[0];
ok(bk.nightly === L.price && bk.nights === 3 && bk.total > L.price * 3, '요금은 서버가 계산 (조작 무시)');
ok(bk.status === (L.instant_book ? 'confirmed' : 'requested'), '예약 상태');
ok((await guest.req('/api/bookings', { method: 'POST', body: { listingId: Number(L.id), checkIn: d(21), checkOut: d(22), guests: 1 } })).status === 409, '겹치는 날짜 중복 예약 차단');
ok((await guest.req('/api/bookings', { method: 'POST', body: { listingId: Number(L.id), checkIn: d(-2), checkOut: d(1), guests: 1 } })).status === 400, '지난 날짜 예약 차단');
ok((await guest.req('/api/bookings', { method: 'POST', body: { listingId: Number(L.id), checkIn: d(40), checkOut: d(41), guests: 99 } })).status === 400, '최대 인원 초과 차단');
ok((await host.req('/api/bookings', { method: 'POST', body: { listingId: Number(L.id), checkIn: d(50), checkOut: d(51), guests: 1 } })).status === 400, '내 숙소 예약 불가');

// 동시 요청 경쟁: 같은 날짜로 두 사람이 동시에 예약
const g2 = await makeUser('경쟁 게스트', '010-3333-4444');
const L2 = list.find(x => x.id !== L.id);
const [a, b2] = await Promise.all([
  guest.req('/api/bookings', { method: 'POST', body: { listingId: Number(L2.id), checkIn: d(60), checkOut: d(62), guests: 1 } }),
  g2.req('/api/bookings', { method: 'POST', body: { listingId: Number(L2.id), checkIn: d(61), checkOut: d(63), guests: 1 } }),
]);
ok([a.status, b2.status].sort().join() === '201,409', `동시 예약 중 하나만 성공 (${a.status}, ${b2.status})`);

console.log('예약 열람 권한');
ok((await g2.req(`/api/bookings/${B}`)).status === 404, '남의 예약은 볼 수 없음');
ok((await g2.req(`/api/bookings/${B}/messages`)).status === 404, '남의 메시지는 볼 수 없음');
let gv = (await guest.req(`/api/bookings/${B}`)).data;
ok(gv.host_payout === undefined && !gv.address && !gv.host_phone, '확정 전 게스트에게 주소·연락처·정산액 비공개');
ok((await g2.req(`/api/host/bookings/${B}/accept`, { method: 'POST', body: {} })).status === 403, '다른 사람은 수락 불가');
if (bk.status === 'requested') {
  ok((await host.req(`/api/host/bookings/${B}/accept`, { method: 'POST', body: {} })).status === 200, '호스트 수락');
  ok((await host.req(`/api/host/bookings/${B}/accept`, { method: 'POST', body: {} })).status === 409, '중복 수락 방지');
}
gv = (await guest.req(`/api/bookings/${B}`)).data;
ok(gv.status === 'confirmed' && !!gv.address && !!gv.host_phone, '확정 후 주소·연락처 공개');
ok((await guest.req(`/api/bookings/${B}/messages`, { method: 'POST', body: { body: '도착은 오후 4시쯤이에요 <script>alert(1)</script>' } })).status === 201, '메시지 전송');
ok((await host.req(`/api/bookings/${B}/messages`)).data.items.length >= 1, '호스트가 메시지 확인');
ok((await guest.req(`/api/bookings/${B}/review`, { method: 'POST', body: { rating: 5, cleanliness: 5, accuracy: 5, location: 5, body: '아직 숙박 전인데 후기를 씁니다' } })).status === 400, '숙박 전 후기 차단');
ok((await guest.req('/api/me', { method: 'DELETE' })).status === 400, '진행 중 예약이 있으면 탈퇴 차단');

console.log('호스트 숙소 등록·사진·심사');
const nl = await host.req('/api/host/listings', { method: 'POST', body: { title: '테스트 숲속 독채', description: '테스트용 숙소 설명입니다. 서른 글자를 넘기기 위해 조금 더 적습니다.', category: 'cabin', region: '가평', area: '가평군 설악면', address: '경기 가평군 설악면 테스트로 1', price: 99000, cleaningFee: 10000, maxGuests: 2, bedrooms: 1, beds: 1, baths: 1, amenities: ['wifi'], rules: '', checkinTime: '15:00', checkoutTime: '11:00', minNights: 1, instantBook: false } });
ok(nl.status === 201, '숙소 초안 생성');
const NL = nl.data.id;
ok((await host.req('/api/host/listings', { method: 'POST', body: { title: 'x' } })).status === 400, '잘못된 입력 검증');
ok((await g2.req(`/api/host/listings/${NL}`)).status === 403, '게스트는 남의 숙소 관리 불가');
ok((await guest.req(`/api/listings/${NL}`)).status === 404, '승인 전 숙소는 공개 안 됨');
ok((await host.req(`/api/host/listings/${NL}/submit`, { method: 'POST' })).status === 400, '사진 3장 미만 심사 요청 차단');
const fd = new FormData();
for (let i = 0; i < 3; i++) {
  const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 40 + i * 40, g: 120, b: 90 } } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'GPS-TEST' } } }).toBuffer();
  fd.append('photos', new Blob([png], { type: 'image/jpeg' }), `p${i}.jpg`);
}
r = await host.req(`/api/host/listings/${NL}/photos`, { method: 'POST', form: fd });
ok(r.status === 201 && r.data.ids.length === 3, '사진 3장 업로드');
const pmeta = await sharp((await db.query('SELECT data FROM listing_photos WHERE id=$1', [r.data.ids[0]])).rows[0].data).metadata();
ok(pmeta.format === 'webp' && !pmeta.exif, '사진 WebP 재인코딩·EXIF 제거');
const fake = new FormData(); fake.append('photos', new Blob(['<?php echo 1; ?>'], { type: 'image/jpeg' }), 'evil.jpg');
ok((await host.req(`/api/host/listings/${NL}/photos`, { method: 'POST', form: fake })).status === 400, '이미지로 위장한 파일 차단');
ok((await guest.req(`/photos/${r.data.ids[0]}.webp`)).status === 404, '승인 전 사진은 남이 볼 수 없음');
ok((await host.req(`/api/host/listings/${NL}/submit`, { method: 'POST' })).status === 200, '심사 요청');
ok((await admin.req(`/api/admin/listings/${NL}/reject`, { method: 'POST', body: {} })).status === 400, '보완 요청은 사유 필수');
ok((await admin.req(`/api/admin/listings/${NL}/approve`, { method: 'POST', body: {} })).status === 200, '관리자 승인');
ok((await guest.req(`/api/listings/${NL}`)).status === 200, '승인 후 공개');
ok((await host.req(`/api/host/listings/${NL}/blocks`, { method: 'PUT', body: { add: [d(30), d(31)] } })).status === 200, '달력 날짜 차단');
ok((await guest.req('/api/bookings', { method: 'POST', body: { listingId: Number(NL), checkIn: d(30), checkOut: d(32), guests: 1 } })).status === 409, '차단된 날짜 예약 불가');
const av = (await guest.req(`/api/listings/${NL}/availability`)).data.unavailable;
ok(av.includes(d(30)) && av.includes(d(31)), '예약 불가 날짜 공개');

console.log('관리자');
ok((await admin.req(`/api/admin/users/${admin.user.id}`, { method: 'PUT', body: { status: 'suspended' } })).status === 400, '자기 자신 정지 불가');
ok((await admin.req(`/api/admin/users/${g2.user.id}`, { method: 'PUT', body: { status: 'suspended' } })).status === 200, '회원 이용 정지');
ok((await g2.req('/api/me')).data.user === null, '정지된 회원은 즉시 로그아웃');
ok((await admin.req('/api/admin/audit')).data.items.some(x => x.action === 'admin_user_update'), '관리자 활동 기록');
ok((await guest.req(`/api/bookings/${B}/cancel`, { method: 'POST', body: {} })).status === 200, '게스트 예약 취소');

console.log(`\n결과: ${pass}개 통과, ${fail}개 실패`);
await db.end();
process.exit(fail ? 1 : 0);
