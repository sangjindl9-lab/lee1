// 고객사별 쇼룸: 브랜드(로고·색상·이름) 설정 → 공유 화면 반영 → /c/<주소> 제품 목록 (고객사끼리 격리)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, signup, upload, waitJob, newProject, Client } from './helpers.js';

let A, B, projA;
before(async () => { await startServer(); A = await signup('쇼룸A'); B = await signup('쇼룸B'); projA = await newProject(A, '금형 쇼룸', 'mold'); });
after(stopServer);

const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('T. 고객사 브랜드 설정 → 공유 쇼룸 머리글 → 고객사 쇼룸 목록(공개·비공개·폐기 구분) → 업종별 기본 템플릿', async () => {
  // 브랜드 설정 (관리자)
  assert.equal((await A.put('/api/company', { slug: 'API' })).status, 400, '예약어');
  assert.equal((await A.put('/api/company', { brand: { color: 'red' } })).status, 400, '색상 형식');
  const s1 = await A.put('/api/company', { slug: 'hanil-mold', brand: { programName: '한일금형 3D 쇼룸', color: '#0ea5e9', logo: PNG1, tagline: '정밀 사출금형', phone: '031-000-0000', website: 'hanil.example.kr' } });
  assert.equal(s1.status, 200, JSON.stringify(s1.data));
  assert.equal(s1.data.slug, 'hanil-mold');
  assert.equal(s1.data.brand.website, 'https://hanil.example.kr');
  assert.equal((await B.put('/api/company', { slug: 'hanil-mold' })).status, 409, '다른 회사가 쓰는 주소');
  // B 는 기본 주소(c-xxxxxxxx)
  const bco = (await B.get('/api/company')).data;
  assert.match(bco.slug, /^c-[0-9a-f]{8}$/);

  // 2D 도면 업로드 → 자동 초안 → 업종(금형) 기본 템플릿
  const up = await upload(A, projA.id, 'three_view_block.dxf');
  const j = await waitJob(A, up.data.job.id);
  const mid = j.result.modelId;
  const md = (await A.get(`/api/models/${mid}`)).data;
  assert.equal(md.scene.data.background, 'mold', '금형 프로젝트 → 금형 기술설명 쇼룸');
  assert.equal(md.model.has_thumb, false);
  assert.equal((await A.put(`/api/models/${mid}/thumbnail`, { image: 'data:text/plain;base64,AAAA' })).status, 400);
  assert.equal((await A.put(`/api/models/${mid}/thumbnail`, { image: PNG1 })).status, 200);
  assert.equal((await B.put(`/api/models/${mid}/thumbnail`, { image: PNG1 })).status, 404, '타사 썸네일 변경 차단');

  const open = await A.post(`/api/models/${mid}/shares`, { title: '3면도 블록' });
  const locked = await A.post(`/api/models/${mid}/shares`, { title: '비공개 견적용', password: 'secret1' });
  const hidden = await A.post(`/api/models/${mid}/shares`, { title: '목록 제외', listed: false });
  const gone = await A.post(`/api/models/${mid}/shares`, { title: '폐기될 링크' });
  await A.patch(`/api/shares/${gone.data.id}`, { revoke: true });

  // 공유 화면: 브랜드·쇼룸 주소·참고용 표시
  const pub = new Client();
  const sh = await pub.get(`/api/public/shares/${open.data.token}`);
  assert.equal(sh.status, 200);
  assert.equal(sh.data.company.brand.programName, '한일금형 3D 쇼룸');
  assert.equal(sh.data.company.brand.color, '#0ea5e9');
  assert.equal(sh.data.company.slug, 'hanil-mold');
  assert.equal(sh.data.model.provenance.reference, true);
  assert.equal(sh.data.model.review_status, 'pending');
  assert.equal((await pub.get(`/api/public/shares/${hidden.data.token}`)).data.company.slug, null, '목록 제외 링크는 쇼룸 주소 숨김');

  // 고객사 쇼룸 목록
  const gal = await pub.get('/api/public/companies/hanil-mold');
  assert.equal(gal.status, 200);
  assert.equal(gal.data.brand.programName, '한일금형 3D 쇼룸');
  const titles = gal.data.items.map((i) => i.title).sort();
  assert.deepEqual(titles, ['3면도 블록', '비공개 견적용'], '폐기·목록 제외는 빠짐');
  const op = gal.data.items.find((i) => i.title === '3면도 블록'), lk = gal.data.items.find((i) => i.locked);
  assert.ok(op.thumb && op.reference && op.industry === 'mold');
  assert.equal(lk.thumb, null, '비밀번호 링크는 썸네일 비공개');
  const th = await pub.get(op.thumb);
  assert.equal(th.status, 200); assert.equal(th.data.subarray(1, 4).toString(), 'PNG');
  assert.equal((await pub.get(`/api/public/shares/${locked.data.token}/thumb`)).status, 401);
  // 대문자 주소도 같은 쇼룸, 없는 주소는 404, B 쇼룸에는 A 제품 없음
  assert.equal((await pub.get('/api/public/companies/HANIL-MOLD')).status, 200);
  assert.equal((await pub.get('/api/public/companies/no-such-co')).status, 404);
  assert.equal((await pub.get(`/api/public/companies/${bco.slug}`)).data.items.length, 0);
  // 목록 표시 끄기
  await A.patch(`/api/shares/${open.data.id}`, { listed: false });
  assert.equal((await pub.get('/api/public/companies/hanil-mold')).data.items.length, 1);
  // 웹 화면 경로
  const page = await pub.get('/c/hanil-mold');
  assert.equal(page.status, 200);
});

test('T-2. 브랜드 수정은 관리자만', async () => {
  const em = `v-${Date.now()}@test.kr`;
  const add = await A.post('/api/auth/users', { email: em, name: '보기', password: 'password123', role: 'viewer' });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  const V = new Client();
  await V.post('/api/auth/login', { email: em, password: 'password123' });
  assert.equal((await V.get('/api/company')).status, 200);
  assert.equal((await V.put('/api/company', { brand: { tagline: 'x' } })).status, 403);
});
