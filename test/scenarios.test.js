// 이음사인 검증 시나리오 — node --test test/
// 실제 서버(HTTP)와 실제 DB·파일로 돌린다. 메일·문자는 외부 연결이 없으므로 발송함(outbox)으로 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ieumsign-test-'));
Object.assign(process.env, { DATA_DIR: TMP, ALLOW_SIGNUP: '1', DEV_SHOW_OTP: '1', ALLOW_HTTP_WEBHOOK: '1', WEBHOOK_BACKOFF_SCALE: '0.0001', APP_SECRET: 'test-secret' });
process.removeAllListeners('warning');
const { app } = require('../src/app');
const Q = require('../src/queue');
const { get, all } = require('../src/db');
const ExcelJS = require('exceljs');

const FX = (f) => path.join(__dirname, 'fixtures', f);
const dataUrl = (f, mime) => `data:${mime};base64,${fs.readFileSync(FX(f)).toString('base64')}`;
const SIGN = dataUrl('sign.png', 'image/png');
let BASE, server;

async function req(method, url, { body, cookie, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) { h.cookie = cookie; if (method !== 'GET') h['x-ieum'] = '1'; }
  const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return r;
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, headers: r.headers };
}
async function login(email, password) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, `로그인 실패 ${email}`);
  return r.headers.get('set-cookie').split(';')[0];
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.json)); return r.json; };
const tokenFromOutbox = (to, docId) => {
  const row = all(`select * from outbox where to_addr=? and subject like '[서명 요청]%' ${docId ? 'and document_id=' + Number(docId) : ''} order by id desc`, to)[0];
  assert.ok(row, `서명 요청 알림 없음: ${to}`);
  return /\/s\/([\w-]+)/.exec(row.body)[1];
};
const tplId = (companyId, docType) => get(`select id from templates where company_id=? and doc_type=?`, companyId, docType).id;

const S = {}; // 시나리오 간 공유

test.before(async () => {
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.BASE_URL = BASE;
  // 회사 A (에스에스전력 예시) / 회사 B
  ok(await req('POST', '/api/signup', { body: { company: 'A전력(시험)', email: 'admin@a.test', name: 'A관리자', password: 'passA1234' } }), 201);
  ok(await req('POST', '/api/signup', { body: { company: 'B통신(시험)', email: 'admin@b.test', name: 'B관리자', password: 'passB1234' } }), 201);
  S.A = await login('admin@a.test', 'passA1234');
  S.B = await login('admin@b.test', 'passB1234');
  S.cidA = get(`select company_id from users where email='admin@a.test'`).company_id;
  S.cidB = get(`select company_id from users where email='admin@b.test'`).company_id;
  // A 직원: 현장소장(manager), 현장 담당자(member), 다른 부서 직원(member)
  const dept2 = ok(await req('POST', '/api/depts', { cookie: S.A, body: { name: '현장2팀' } }), 201).id;
  S.mgr = ok(await req('POST', '/api/users', { cookie: S.A, body: { email: 'mgr@a.test', name: '김소장', password: 'passM1234', role: 'manager' } }), 201).id;
  S.staff = ok(await req('POST', '/api/users', { cookie: S.A, body: { email: 'staff@a.test', name: '박담당', password: 'passS1234', role: 'member' } }), 201).id;
  S.other = ok(await req('POST', '/api/users', { cookie: S.A, body: { email: 'other@a.test', name: '최다른', password: 'passO1234', role: 'member', dept_id: dept2 } }), 201).id;
  S.adminA = get(`select id from users where email='admin@a.test'`).id;
  S.M = await login('mgr@a.test', 'passM1234');
  S.ST = await login('staff@a.test', 'passS1234');
  S.OT = await login('other@a.test', 'passO1234');
  // 직인 등록 → 승인
  const seal = ok(await req('POST', '/api/seals', { cookie: S.A, body: { name: '법인 직인', image: dataUrl('seal.png', 'image/png') } }), 201).id;
  ok(await req('POST', `/api/seals/${seal}/approve`, { cookie: S.A }));
  S.seal = seal;
  // 결재선: 현장소장 검토 → 본사(관리자) 승인
  S.line = ok(await req('POST', '/api/approval-lines', { cookie: S.ST, body: { name: '현장→본사', steps: [{ user_id: S.mgr }, { user_id: S.adminA }] } }), 201).id;
});
test.after(() => { server.close(); Q.stop(); });

test('1차: 비대면계약 — 작성→내부결재→외부 서명(이메일 인증)→직인→완료 PDF·감사이력', async () => {
  const id = ok(await req('POST', '/api/documents', { cookie: S.ST, body: {
    mode: 'remote', template_id: tplId(S.cidA, '협력업체계약서'), title: '협력업체 계약 - 가나전기',
    vals: { partner: '가나전기(시험)', site: 'A현장', scope: '전선관 배관·입선', amount: 55000000, start_date: '2026-11-10', end_date: '2027-03-31' },
    participants: [{ role_key: 'partner_rep', name: '홍대표', email: 'ceo@gana.test', auth_method: 'email_otp' }, { role_key: 'company' }],
  } }), 201).id;
  S.remoteDoc = id;
  // 결재 없이 발송 시도 → 결재선 지정 안 했으므로 규칙이 없으면 발송 가능하지만, 여기서는 결재를 올린다
  ok(await req('POST', `/api/documents/${id}/approval`, { cookie: S.ST, body: { line_id: S.line } }));
  assert.equal((await req('POST', `/api/documents/${id}/send`, { cookie: S.ST })).status, 409, '결재 중 발송 차단');
  // 순서 지키기: 본사가 먼저 승인하면 거부
  const appr = all(`select * from approvals where target_id=? and target_type='document' order by step_no`, id);
  assert.equal((await req('POST', `/api/approvals/${appr[1].id}`, { cookie: S.A, body: { decision: 'approve' } })).status, 409);
  ok(await req('POST', `/api/approvals/${appr[0].id}`, { cookie: S.M, body: { decision: 'approve', comment: '현장 확인' } }));
  ok(await req('POST', `/api/approvals/${appr[1].id}`, { cookie: S.A, body: { decision: 'approve' } }));
  let d = ok(await req('GET', `/api/documents/${id}`, { cookie: S.ST }));
  assert.equal(d.doc.status, 'ready');
  d = ok(await req('POST', `/api/documents/${id}/send`, { cookie: S.ST }));
  assert.equal(d.doc.status, 'in_progress');
  const tok = tokenFromOutbox('ceo@gana.test');
  let v = ok(await req('GET', `/api/s/${tok}`));
  assert.equal(v.needVerify, true); assert.equal(v.body, undefined, '인증 전에는 본문 비공개');
  assert.equal(v.company.name, 'A전력(시험)', '요청 회사 표시');
  const otp = ok(await req('POST', `/api/s/${tok}/otp`));
  assert.equal((await req('POST', `/api/s/${tok}/verify`, { body: { code: '000000' === otp.devCode ? '111111' : '000000' } })).status, 400);
  ok(await req('POST', `/api/s/${tok}/verify`, { body: { code: otp.devCode } }));
  v = ok(await req('GET', `/api/s/${tok}`));
  assert.match(v.body, /\{\{amount\}\}/); assert.equal(v.vals.amount, 55000000);
  assert.equal((await req('POST', `/api/s/${tok}/sign`, { body: { vals: { p_bizno: '123-45-67890' }, image: SIGN, agree: true } })).status, 400, '필수 입력 누락');
  ok(await req('POST', `/api/s/${tok}/sign`, { body: { vals: { p_bizno: '123-45-67890', p_addr: '강원 원주시 시험로 1' }, image: SIGN, agree: true } }));
  // 직인 차례: 직인 사용 권한 없는 담당자는 불가, 관리자(직인 사용 권한)가 날인
  const sealP = get(`select id from participants where document_id=? and kind='seal'`, id).id;
  assert.equal((await req('POST', `/api/documents/${id}/sign`, { cookie: S.ST, body: { participant_id: sealP, seal_id: S.seal, agree: true } })).status, 403);
  // 관리자는 이 문서를 볼 수 있다 (전체 열람 권한)
  d = ok(await req('POST', `/api/documents/${id}/sign`, { cookie: S.A, body: { participant_id: sealP, seal_id: S.seal, agree: true } }));
  assert.equal(d.doc.status, 'completed'); assert.ok(d.doc.pdf_file_id, '완료 PDF 생성');
  assert.ok(d.audit.some((a) => a.action === 'SEAL_APPLY'));
  const usage = get(`select * from seal_usages where document_id=?`, id);
  assert.equal(usage.representative_approved, 0, '직인 날인과 대표자 승인은 구분 기록');
  ok(await req('GET', '/api/audit', { cookie: S.A })).chain.ok || assert.fail('감사 해시 체인 불일치');
  // 완료 후 담당자 임의 수정 차단
  assert.equal((await req('PUT', `/api/documents/${id}`, { cookie: S.ST, body: { vals: { amount: 1 } } })).status, 409);
  // 완료본 전달 알림
  assert.ok(get(`select 1 from outbox where to_addr='ceo@gana.test' and subject like '[완료]%'`));
});

test('시나리오 1: 서로 다른 회사의 문서 접근 차단', async () => {
  const id = S.remoteDoc;
  assert.equal((await req('GET', `/api/documents/${id}`, { cookie: S.B })).status, 403);
  assert.equal((await req('GET', `/api/documents/${id}/pdf`, { cookie: S.B })).status, 403);
  assert.equal((await req('GET', `/api/documents/${id}/comments`, { cookie: S.B })).status, 403);
  const list = ok(await req('GET', '/api/documents', { cookie: S.B }));
  assert.equal(list.rows.filter((r) => r.company_id !== S.cidB).length, 0);
  // B 가 A 의 템플릿·결재선·직인을 쓰려는 경우
  assert.equal((await req('POST', '/api/documents', { cookie: S.B, body: { mode: 'remote', template_id: tplId(S.cidA, '협력업체계약서'), participants: [] } })).status, 404);
  assert.equal((await req('POST', `/api/approvals/${get(`select id from approvals limit 1`).id}`, { cookie: S.B, body: { decision: 'approve' } })).status, 404);
  // B 의 API 키로 A 문서 조회
  const key = ok(await req('POST', '/api/api-keys', { cookie: S.B, body: { name: 'B ERP', scopes: ['documents:read', 'files:read'] } }), 201).key;
  assert.equal((await req('GET', `/api/v1/documents/${id}`, { headers: { authorization: `Bearer ${key}` } })).status, 404);
  assert.equal((await req('GET', `/api/v1/documents/${id}/pdf-url`, { headers: { authorization: `Bearer ${key}` } })).status, 404);
  // 다운로드 주소 위조
  const fid = get(`select pdf_file_id from documents where id=?`, id).pdf_file_id;
  assert.equal((await req('GET', `/dl/${fid}?exp=${Date.now() + 60000}&sig=${'0'.repeat(64)}`)).status, 403);
  // 같은 회사라도 권한 없는 직원(다른 부서·참여 안 함)은 못 봄
  assert.equal((await req('GET', `/api/documents/${id}`, { cookie: S.OT })).status, 403);
});

test('2차 대면계약 · 시나리오 2: 같은 태블릿에서 참여자를 바꿔도 입력정보가 섞이지 않음', async () => {
  // 근로자 2명이 차례로 서명하는 서식 (각자 개인정보 항목)
  const t = ok(await req('POST', '/api/templates', { cookie: S.ST, body: {
    name: '현장 공동 작업확인서(시험)', doc_type: '작업확인서',
    roles: [{ key: 'w1', label: '작업자1', kind: 'external' }, { key: 'w2', label: '작업자2', kind: 'external' }],
    fields: [{ key: 'site', label: '현장', required: true }, { key: 'w1_birth', label: '작업자1 생년월일', type: 'date', owner: 'w1', pii: true, required: true }, { key: 'w1_phone', label: '작업자1 연락처', type: 'phone', owner: 'w1', pii: true, required: true },
      { key: 'w2_birth', label: '작업자2 생년월일', type: 'date', owner: 'w2', pii: true, required: true }, { key: 'w2_phone', label: '작업자2 연락처', type: 'phone', owner: 'w2', pii: true, required: true }],
    body: '## 작업 확인\n현장: {{site}}\n작업자1: {{w1_birth}} / {{w1_phone}}\n작업자2: {{w2_birth}} / {{w2_phone}}',
  } }), 201).id;
  const id = ok(await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'inperson', template_id: t, vals: { site: 'B현장' },
    participants: [{ role_key: 'w1', name: '이작업' }, { role_key: 'w2', name: '정작업' }], delivery: {} } }), 201).id;
  ok(await req('POST', `/api/documents/${id}/send`, { cookie: S.ST }));
  assert.equal(all(`select * from outbox where document_id=? and subject like '[서명 요청]%'`, id).length, 0, '대면계약은 링크를 보내지 않음');
  const ps = all(`select * from participants where document_id=? order by order_no`, id);
  assert.equal((await req('POST', `/api/documents/${id}/inperson/start`, { cookie: S.ST, body: { participant_id: ps[1].id, confirm_method: '신분증 대조(담당자 확인)' } })).status, 409, '차례 아닌 참여자');
  assert.equal((await req('POST', `/api/documents/${id}/inperson/start`, { cookie: S.ST, body: { participant_id: ps[0].id } })).status, 400, '확인 방법 필수');
  const s1 = ok(await req('POST', `/api/documents/${id}/inperson/start`, { cookie: S.ST, body: { participant_id: ps[0].id, confirm_method: '신분증 대조(담당자 확인)' } }));
  const t1 = /\/s\/([\w-]+)/.exec(s1.url)[1];
  let v = ok(await req('GET', `/api/s/${t1}`));
  assert.deepEqual(v.fields.map((f) => f.key), ['w1_birth', 'w1_phone'], '본인 항목만 입력');
  ok(await req('POST', `/api/s/${t1}/sign`, { body: { vals: { w1_birth: '1980-01-02', w1_phone: '010-1111-2222' }, image: SIGN, agree: true } }));
  assert.equal((await req('GET', `/api/s/${t1}`)).status, 404, '이전 세션 토큰은 서명 후 폐기');
  assert.equal((await req('POST', `/api/documents/${id}/inperson/start`, { cookie: S.ST, body: { participant_id: ps[1].id, confirm_method: '휴대폰 인증번호' } })).status, 423, '잠금 상태에서는 다음 참여자도 못 엶');
  ok(await req('POST', '/api/me/verify-password', { cookie: S.ST, body: { password: 'passS1234' } }));
  const s2 = ok(await req('POST', `/api/documents/${id}/inperson/start`, { cookie: S.ST, body: { participant_id: ps[1].id, confirm_method: '휴대폰 인증번호' } }));
  const t2 = /\/s\/([\w-]+)/.exec(s2.url)[1];
  v = ok(await req('GET', `/api/s/${t2}`));
  assert.equal(v.vals.w1_birth, '●●●●'); assert.equal(v.vals.w1_phone, '●●●●', '다른 참여자 개인정보 가림');
  assert.ok(!JSON.stringify(v).includes('1111-2222') && !JSON.stringify(v).includes('1980-01-02'));
  assert.equal(v.vals.w2_birth, '');
  // 작업자2가 작업자1 항목을 보내도 무시된다
  ok(await req('POST', `/api/s/${t2}/sign`, { body: { vals: { w2_birth: '1990-05-06', w2_phone: '010-3333-4444', w1_phone: '010-9999-9999' }, image: SIGN, agree: true } }));
  const after = all(`select * from participants where document_id=? order by order_no`, id);
  assert.deepEqual(JSON.parse(after[0].vals), { w1_birth: '1980-01-02', w1_phone: '010-1111-2222' });
  assert.deepEqual(JSON.parse(after[1].vals), { w2_birth: '1990-05-06', w2_phone: '010-3333-4444' });
  // 기기 소유자(로그인 직원)가 서명자로 기록되지 않음: 서명 이력의 행위자는 참여자 본인, 확인 담당자는 따로 기록
  const logs = all(`select * from audit_logs where document_id=? and action='PARTICIPANT_SIGN'`, id);
  assert.deepEqual(logs.map((l) => l.actor_name), ['이작업', '정작업']);
  assert.ok(logs.every((l) => l.actor_type === 'participant'));
  assert.match(after[0].confirm_method, /신분증 대조.*확인 담당자 박담당/);
  assert.match(after[1].confirm_method, /휴대폰 인증번호/);
  assert.equal(get(`select status from documents where id=?`, id).status, 'completed');
  // 기기를 넘긴 동안 담당자 세션은 서버에서 잠김 → 비밀번호로만 해제
  assert.equal((await req('GET', `/api/documents/${id}`, { cookie: S.ST })).status, 423, '담당자 화면 잠금');
  assert.equal((await req('POST', '/api/me/verify-password', { cookie: S.ST, body: { password: 'wrong' } })).status, 400);
  ok(await req('POST', '/api/me/verify-password', { cookie: S.ST, body: { password: 'passS1234' } }));
  assert.equal((await req('PUT', `/api/documents/${id}`, { cookie: S.ST, body: { title: '바꿈' } })).status, 409, '완료 후 수정 차단');
});

test('2차 링크계약 · 시나리오 3: 공개 링크 제출자가 다른 제출자의 문서를 보지 못함', async () => {
  const c = ok(await req('POST', '/api/links', { cookie: S.M, body: { template_id: tplId(S.cidA, '현장동의서'), title: 'A현장 출입 동의', site: 'A현장', auth: 'phone_otp', dup_policy: 'once_per_phone', max_count: 3,
    privacy: [{ text: '출입 관리 목적의 이름·전화번호 수집 동의', required: true }], after_msg: '제출되었습니다. 현장 담당자가 확인합니다.', review_required: true } }), 201);
  S.link = c;
  const before = get(`select count(*) n from documents`).n;
  const info = ok(await req('GET', `/api/l/${c.slug}`));
  assert.equal(info.closed, null); assert.equal(get(`select count(*) n from documents`).n, before, '링크(QR) 접속만으로는 아무것도 생성·인정되지 않음');
  assert.equal((await req('POST', `/api/l/${c.slug}/start`, { body: { name: '갑', phone: '010-5555-0001', consents: [false] } })).status, 400, '필수 동의');
  async function submit(name, phone, birth) {
    const s = ok(await req('POST', `/api/l/${c.slug}/start`, { body: { name, phone, consents: [true] } }));
    const t = ok(await req('POST', `/api/l/${c.slug}/verify`, { body: { startId: s.startId, startKey: s.startKey, code: s.devCode } })).token;
    const v = ok(await req('GET', `/api/s/${t}`));
    ok(await req('POST', `/api/s/${t}/sign`, { body: { vals: { a_company: name + '설비', a_birth: birth, a_safety: true, a_privacy: true }, image: SIGN, agree: true } }));
    return t;
  }
  const ta = await submit('갑제출', '010-5555-0001', '1985-01-01');
  const tb = await submit('을제출', '010-5555-0002', '1992-02-02');
  const va = ok(await req('GET', `/api/s/${ta}`)), vb = ok(await req('GET', `/api/s/${tb}`));
  assert.equal(va.vals.a_birth, '1985-01-01'); assert.equal(vb.vals.a_birth, '1992-02-02');
  assert.ok(!JSON.stringify(va).includes('을제출') && !JSON.stringify(va).includes('1992-02-02'), 'A 화면에 B 정보 없음');
  const docA = get(`select document_id from participants where token_hash=?`, crypto.createHash('sha256').update(ta).digest('hex')).document_id;
  const docB = get(`select document_id from participants where token_hash=?`, crypto.createHash('sha256').update(tb).digest('hex')).document_id;
  assert.notEqual(docA, docB, '접속자마다 별도 문서');
  // 개별 문서는 비공개: 로그인 없이 조회 불가, 토큰 바꿔치기 불가
  assert.equal((await req('GET', `/api/documents/${docB}`)).status, 401);
  assert.equal((await req('GET', `/api/s/${ta.slice(0, -2)}xx`)).status, 404);
  // 중복 제출 정책·상태
  assert.equal((await req('POST', `/api/l/${c.slug}/start`, { body: { name: '갑제출', phone: '010-5555-0001', consents: [true] } })).status, 409);
  assert.equal(get(`select status from documents where id=?`, docA).status, 'review', '내부 검토 단계');
  const done = ok(await req('POST', `/api/documents/${docA}/review-confirm`, { cookie: S.M }));
  assert.equal(done.status, 'completed');
  ok(await req('PUT', `/api/links/${c.id}`, { cookie: S.M, body: { status: 'pause' } }));
  assert.equal((await req('POST', `/api/l/${c.slug}/start`, { body: { name: '병', phone: '010-5555-0003', consents: [true] } })).status, 409, '일시 중지');
  ok(await req('PUT', `/api/links/${c.id}`, { cookie: S.M, body: { status: 'resume' } }));
  const csv = await req('GET', `/api/links/${c.id}/export?format=csv`, { cookie: S.M });
  assert.match(csv.json, /갑제출/); assert.match(csv.json, /을제출/);
  const xl = await req('GET', `/api/links/${c.id}/export?format=xlsx`, { cookie: S.M, raw: true });
  assert.equal(xl.status, 200);
  const qr = await req('GET', `/api/links/${c.id}/qr.png`, { cookie: S.M, raw: true });
  assert.equal(qr.headers.get('content-type'), 'image/png');
  // 접수 건수 제한(3): 세 번째까지 허용, 네 번째는 차단
  await submit('병제출', '010-5555-0003', '1970-03-03');
  assert.equal((await req('POST', `/api/l/${c.slug}/start`, { body: { name: '정', phone: '010-5555-0004', consents: [true] } })).status, 409, '건수 제한');
});

async function makeXlsx(templateId, cookie, rows, common = {}) {
  const r = await req('GET', `/api/bulk/form.xlsx?template_id=${templateId}`, { cookie, raw: true });
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const ws = wb.getWorksheet('수신자별 값');
  const head = ws.getRow(1).values.slice(1);
  for (const row of rows) ws.addRow(head.map((h) => row[h] ?? ''));
  const cs = wb.getWorksheet('공통값');
  cs.eachRow((row, n) => { if (n > 1 && common[row.getCell(1).value] != null) row.getCell(2).value = common[row.getCell(1).value]; });
  return 'data:application/octet-stream;base64,' + Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

test('2차 대량계약 · 시나리오 4: 사람별 계약금액·연락처 정확 반영, 오류 행 표시, 실패 건만 재시도, 재실행 멱등', async () => {
  const tid = tplId(S.cidA, '근로계약서');
  const rows = [];
  for (let i = 1; i <= 30; i++) rows.push({ '근로자 성명': `근로자${i}`, '근로자 이메일': i % 10 === 0 ? `w${i}@fail.test` : `w${i}@work.test`, '근로자 전화번호': `010-2000-${String(1000 + i)}`, '계약 시작일': '2026-12-01', '계약 종료일': '2027-02-28', '일급(원)': 180000 + i * 1000 });
  rows.push({ '근로자 성명': '', '근로자 이메일': 'bad-email', '계약 시작일': '2026-13-01', '계약 종료일': '2027-02-28', '일급(원)': '많이' }); // 오류 행
  rows.push({ ...rows[0] }); // 중복 행
  // 담당자(member)는 일괄 발송 권한이 없다
  assert.equal((await req('GET', `/api/bulk/form.xlsx?template_id=${tid}`, { cookie: S.ST })).status, 403, 'member 는 대량계약 불가');
  const f2 = await makeXlsx(tid, S.M, rows, { '현장명': 'C현장', '업무 내용': '전기 배선', '근로시간': '08:00~17:00' });
  const job = ok(await req('POST', '/api/bulk', { cookie: S.M, body: { template_id: tid, title: 'C현장 12월 근로계약', fileDataUrl: f2 } }), 201).id;
  let j = ok(await req('GET', `/api/bulk/${job}?only=errors`, { cookie: S.M }));
  assert.equal(j.job.status, 'uploaded');
  const bad = j.rows.find((x) => x.status === 'invalid');
  assert.equal(bad.row_no, 32, '행 번호별 오류');
  assert.ok(bad.errors.some((e) => /성명/.test(e)) && bad.errors.some((e) => /이메일 형식/.test(e)) && bad.errors.some((e) => /날짜/.test(e)) && bad.errors.some((e) => /숫자/.test(e)));
  const dup = j.rows.find((x) => x.row_no === 33);
  assert.ok(dup.warnings.some((w) => /중복 수신자/.test(w)) && dup.warnings.some((w) => /중복 요청/.test(w)));
  assert.equal((await req('POST', `/api/bulk/${job}/start`, { cookie: S.M, body: { confirm: true } })).status, 409, '오류가 있으면 발송 불가');
  ok(await req('POST', `/api/bulk/${job}/exclude-invalid`, { cookie: S.M }));
  const pv = ok(await req('GET', `/api/bulk/${job}/preview?row=5`, { cookie: S.M }));
  assert.match(pv.body, /184,000원/); assert.match(pv.body, /C현장/);
  process.env.TEST_FAIL_DOMAIN = 'fail.test';
  ok(await req('POST', `/api/bulk/${job}/start`, { cookie: S.M, body: { confirm: true } }));
  assert.equal((await req('POST', `/api/bulk/${job}/start`, { cookie: S.M, body: { confirm: true } })).status, 409, '두 번 시작 불가');
  await Q.drain();
  j = ok(await req('GET', `/api/bulk/${job}`, { cookie: S.M }));
  assert.equal(j.summary.sent, 28); assert.equal(j.summary.failed, 3, 'w10·w20·w30 실패');
  // 사람별 값 확인
  for (const r of all(`select r.row_no, r.data, d.amount, d.id from bulk_rows r join documents d on d.id=r.document_id where r.job_id=?`, job)) {
    const i = r.row_no - 1 > 30 ? 1 : r.row_no - 1;
    assert.equal(r.amount, 180000 + i * 1000, `${r.row_no}행 금액`);
    const p = get(`select email, phone, name from participants where document_id=? and kind='external'`, r.id);
    assert.equal(p.name, `근로자${i}`); assert.equal(p.phone, `010-2000-${1000 + i}`);
  }
  // 실패 건만 재시도
  delete process.env.TEST_FAIL_DOMAIN;
  const before = { docs: get(`select count(*) n from documents where bulk_job_id=?`, job).n, out: get(`select count(*) n from outbox o join documents d on d.id=o.document_id where d.bulk_job_id=?`, job).n };
  assert.equal(ok(await req('POST', `/api/bulk/${job}/retry-failed`, { cookie: S.M })).queued, 3);
  await Q.drain();
  j = ok(await req('GET', `/api/bulk/${job}`, { cookie: S.M }));
  assert.equal(j.summary.sent, 31); assert.equal(j.summary.failed, 0);
  assert.equal(get(`select count(*) n from documents where bulk_job_id=?`, job).n, before.docs, '재시도로 문서가 늘지 않음');
  assert.equal(get(`select count(*) n from outbox o join documents d on d.id=o.document_id where d.bulk_job_id=?`, job).n, before.out + 3, '실패했던 3건만 새로 발송');
  // 같은 작업을 강제로 다시 실행(큐 재투입)해도 중복 생성·중복 알림 없음
  for (const r of all(`select id from bulk_rows where job_id=?`, job)) { require('../src/db').run(`update bulk_rows set status='queued' where id=?`, r.id); Q.enqueue('bulk_row', { rowId: r.id }, `force:${r.id}`); }
  await Q.drain();
  assert.equal(get(`select count(*) n from documents where bulk_job_id=?`, job).n, 31);
  assert.equal(get(`select count(*) n from outbox o join documents d on d.id=o.document_id where d.bulk_job_id=?`, job).n, before.out + 3);
  // 한 명 서명 완료 → 집계·ZIP·진행 현황
  const d1 = get(`select id from documents where bulk_job_id=? and bulk_row=2`, job).id;
  const tk = tokenFromOutbox('w1@work.test', d1);
  ok(await req('POST', `/api/s/${tk}/sign`, { body: { vals: { w_birth: '1975-07-07', w_addr: '원주시', w_phone: '010-2000-1001', w_agree: true }, image: SIGN, agree: true } }));
  assert.equal(get(`select status from documents where id=?`, d1).status, 'in_progress', '직인 차례 대기');
  ok(await req('POST', `/api/documents/${d1}/sign`, { cookie: S.A, body: { participant_id: get(`select id from participants where document_id=? and kind='seal'`, d1).id, seal_id: S.seal, agree: true } }));
  j = ok(await req('GET', `/api/bulk/${job}`, { cookie: S.M }));
  assert.equal(j.summary.completed, 1); assert.equal(j.summary.signing, 30);
  const zip = await req('GET', `/api/bulk/${job}/zip`, { cookie: S.M, raw: true }); assert.equal(zip.status, 200);
  const zj = await require('jszip').loadAsync(Buffer.from(await zip.arrayBuffer())); assert.equal(Object.keys(zj.files).length, 1);
  assert.equal((await req('GET', `/api/bulk/${job}/export.xlsx`, { cookie: S.M, raw: true })).status, 200);
  S.bulkJob = job;
});

test('대량계약 1,000건 큐 처리 성능 (측정)', async () => {
  const tid = tplId(S.cidA, '근로계약서');
  const rows = [];
  for (let i = 1; i <= 1000; i++) rows.push({ '근로자 성명': `대량${i}`, '근로자 이메일': `m${i}@bulk.test`, '근로자 전화번호': `010-4000-${String(i).padStart(4, '0')}`, '계약 시작일': '2027-01-02', '계약 종료일': '2027-06-30', '일급(원)': 150000 + i });
  const file = await makeXlsx(tid, S.M, rows, { '현장명': 'D현장', '업무 내용': '케이블 포설', '근로시간': '08:00~17:00' });
  const t0 = Date.now();
  const job = ok(await req('POST', '/api/bulk', { cookie: S.M, body: { template_id: tid, title: '1000건 성능', fileDataUrl: file } }), 201).id;
  const tUpload = Date.now() - t0;
  ok(await req('POST', `/api/bulk/${job}/start`, { cookie: S.M, body: { confirm: true } }));
  const t1 = Date.now();
  await Q.drain(600000);
  const tSend = Date.now() - t1;
  const s = ok(await req('GET', `/api/bulk/${job}`, { cookie: S.M })).summary;
  assert.equal(s.sent, 1000); assert.equal(get(`select count(*) n from documents where bulk_job_id=?`, job).n, 1000);
  assert.equal(get(`select count(distinct o.to_addr) n from outbox o join documents d on d.id=o.document_id where d.bulk_job_id=?`, job).n, 1000);
  const wrong = get(`select count(*) n from documents d join bulk_rows r on r.document_id=d.id where r.job_id=? and d.amount != 150000 + (r.row_no - 1)`, job).n;
  assert.equal(wrong, 0, '1000건 모두 행별 금액 일치');
  S.perf = { uploadValidateMs: tUpload, sendMs: tSend, perDocMs: +(tSend / 1000).toFixed(1) };
  console.log('PERF', JSON.stringify(S.perf));
});

test('3차 · 시나리오 5: 내부 메모는 외부 사용자에게 노출되지 않음 (서버 검증)', async () => {
  const id = ok(await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'remote', template_id: tplId(S.cidA, '협력업체계약서'), title: '메모 시험 계약',
    vals: { partner: '다라통신(시험)', site: 'E현장', scope: '통신 배관', amount: 9000000, start_date: '2026-12-01', end_date: '2027-01-31' },
    participants: [{ role_key: 'partner_rep', name: '오대표', email: 'oh@dara.test' }, { role_key: 'company' }] } }), 201).id;
  ok(await req('POST', `/api/documents/${id}/comments`, { cookie: S.ST, body: { visibility: 'internal', body: '내부전용: 단가 15% 더 깎을 여지 있음 @김소장' } }), 201);
  ok(await req('POST', `/api/documents/${id}/comments`, { cookie: S.ST, body: { visibility: 'shared', body: '공유: 착공 전 보험증권 사본을 올려 주세요' } }), 201);
  assert.ok(get(`select 1 from inbox where user_id=? and title like '[내부 메모]%'`, S.mgr), '언급 알림');
  ok(await req('POST', `/api/documents/${id}/send`, { cookie: S.ST }));
  const tk = tokenFromOutbox('oh@dara.test');
  const v = ok(await req('GET', `/api/s/${tk}`));
  const cm = ok(await req('GET', `/api/s/${tk}/comments`));
  const ext = JSON.stringify([v, cm]);
  assert.ok(!ext.includes('내부전용') && !ext.includes('15%'), '서명 화면·의견 API 에 내부 메모 없음');
  assert.ok(ext.includes('보험증권'), '공유 의견은 보임');
  const outExt = all(`select subject, body from outbox where to_addr='oh@dara.test'`).map((o) => o.subject + o.body).join('\n');
  assert.ok(!outExt.includes('내부전용'), '외부 알림에 내부 메모 없음');
  ok(await req('POST', `/api/s/${tk}/comments`, { body: { body: '보험증권 내일 올리겠습니다' } }), 201);
  const staffView = ok(await req('GET', `/api/documents/${id}/comments`, { cookie: S.ST }));
  assert.equal(staffView.length, 3);
  // 메모로 계약 본문·상태가 바뀌지 않음
  const d = get(`select * from documents where id=?`, id);
  assert.equal(d.status, 'in_progress'); assert.equal(d.content_hash, get(`select content_hash from documents where id=?`, id).content_hash);
  // 수정·삭제 이력
  const mine = staffView.find((c) => c.visibility === 'internal');
  ok(await req('PUT', `/api/comments/${mine.id}`, { cookie: S.ST, body: { body: '내부전용: 수정됨' } }));
  ok(await req('DELETE', `/api/comments/${mine.id}`, { cookie: S.ST }));
  assert.deepEqual(all(`select action from comment_revisions where comment_id=? order by id`, mine.id).map((x) => x.action), ['create', 'edit', 'delete']);
  S.memoDoc = id;
});

test('시나리오 6: 승인 이후 변경된 문서는 재승인 절차를 거침', async () => {
  const id = ok(await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'remote', template_id: tplId(S.cidA, '협력업체계약서'), title: '재승인 시험',
    vals: { partner: '마바전력(시험)', site: 'A현장', scope: '수배전반', amount: 120000000, start_date: '2026-12-01', end_date: '2027-12-31' },
    participants: [{ role_key: 'partner_rep', name: '마대표', email: 'ma@maba.test' }, { role_key: 'company' }] } }), 201).id;
  ok(await req('POST', `/api/documents/${id}/approval`, { cookie: S.ST, body: { line_id: S.line } }));
  const r1 = all(`select * from approvals where target_type='document' and target_id=? and round=1 order by step_no`, id);
  ok(await req('POST', `/api/approvals/${r1[0].id}`, { cookie: S.M, body: { decision: 'approve' } }));
  ok(await req('POST', `/api/approvals/${r1[1].id}`, { cookie: S.A, body: { decision: 'approve' } }));
  assert.equal(get(`select status from documents where id=?`, id).status, 'ready');
  const h1 = get(`select content_hash, version from documents where id=?`, id);
  // 결재 후 금액 변경
  ok(await req('PUT', `/api/documents/${id}`, { cookie: S.ST, body: { vals: { amount: 150000000 } } }));
  const d = get(`select * from documents where id=?`, id);
  assert.equal(d.status, 'approval'); assert.equal(d.version, h1.version + 1); assert.notEqual(d.content_hash, h1.content_hash);
  assert.equal((await req('POST', `/api/documents/${id}/send`, { cookie: S.ST })).status, 409, '재승인 전 발송 차단');
  const r2 = all(`select * from approvals where target_type='document' and target_id=? and round=2 order by step_no`, id);
  assert.equal(r2.length, 2); assert.ok(r2.every((a) => a.target_hash === d.content_hash));
  // 서명 대상 변경도 재승인
  ok(await req('POST', `/api/approvals/${r2[0].id}`, { cookie: S.M, body: { decision: 'approve' } }));
  ok(await req('PUT', `/api/documents/${id}`, { cookie: S.ST, body: { participants: [{ role_key: 'partner_rep', name: '마대표', email: 'other@maba.test' }, { role_key: 'company' }] } }));
  assert.equal(get(`select max(round) r from approvals where target_type='document' and target_id=?`, id).r, 3);
  assert.equal((await req('POST', `/api/approvals/${r2[1].id}`, { cookie: S.A, body: { decision: 'approve' } })).status, 409, '지난 차수 승인 재사용 불가');
  // 반려 시 사유 필수
  const r3 = all(`select * from approvals where target_type='document' and target_id=? and round=3 order by step_no`, id);
  assert.equal((await req('POST', `/api/approvals/${r3[0].id}`, { cookie: S.M, body: { decision: 'reject' } })).status, 400);
  ok(await req('POST', `/api/approvals/${r3[0].id}`, { cookie: S.M, body: { decision: 'reject', comment: '금액 근거 첨부 필요' } }));
  assert.equal(get(`select status from documents where id=?`, id).status, 'draft');
  // 조건부 결재선 규칙: 1억 이상이면 결재 필수 (제한된 규칙만 허용)
  assert.equal((await req('POST', '/api/approval-rules', { cookie: S.A, body: { name: '코드', conditions: [{ field: 'process.exit()', op: '=', value: 1 }], line_id: S.line } })).status, 400);
  ok(await req('POST', '/api/approval-rules', { cookie: S.A, body: { name: '1억 이상', conditions: [{ field: 'amount', op: '>=', value: 100000000 }], line_id: S.line } }), 201);
  assert.equal((await req('POST', `/api/documents/${id}/send`, { cookie: S.ST })).status, 409, '규칙상 결재 필요');
  ok(await req('POST', `/api/documents/${id}/approval`, { cookie: S.ST, body: {} })); // 규칙의 결재선 자동 적용
  assert.equal(get(`select max(round) r from approvals where target_type='document' and target_id=?`, id).r, 4);
});

test('시나리오 7: 자동분류로 권한이 확대되지 않음', async () => {
  ok(await req('POST', '/api/class-rules', { cookie: S.A, body: { name: 'A현장 폴더', cond: [{ field: 'site', op: '=', value: 'A현장' }], action: { folder: 'A현장' } } }), 201);
  ok(await req('POST', '/api/class-rules', { cookie: S.A, body: { name: '중요계약', cond: [{ field: 'amount', op: '>=', value: 50000000 }], action: { tag: '중요계약' } } }), 201);
  ok(await req('POST', '/api/class-rules', { cookie: S.A, body: { name: '근로계약 인사', cond: [{ field: 'doc_type', op: '=', value: '근로계약서' }], action: { folder: '인사' } } }), 201);
  const folder = get(`select id from folders where company_id=? and name='A현장'`, S.cidA).id;
  const inFolder = all(`select document_id from doc_folders where folder_id=?`, folder).map((x) => x.document_id);
  assert.ok(inFolder.includes(S.remoteDoc));
  assert.ok(get(`select 1 from doc_tags where document_id=? and tag='중요계약'`, S.remoteDoc));
  // 권한 없는 직원: 폴더로 조회해도 목록에 없고, 직접 열어도 거부, 폴더 개수도 0
  const lst = ok(await req('GET', `/api/documents?folder=${folder}`, { cookie: S.OT }));
  assert.equal(lst.total, 0);
  assert.equal((await req('GET', `/api/documents/${S.remoteDoc}`, { cookie: S.OT })).status, 403);
  const facets = ok(await req('GET', '/api/documents/facets', { cookie: S.OT }));
  assert.equal(facets.folders.find((f) => f.name === 'A현장').n, 0);
  assert.equal(ok(await req('GET', '/api/documents?tag=중요계약', { cookie: S.OT })).total, 0);
  // 볼 수 있는 사람에게는 같은 원본 하나가 여러 목록에 보임
  const a1 = ok(await req('GET', `/api/documents?folder=${folder}`, { cookie: S.ST })).rows.map((r) => r.id);
  const a2 = ok(await req('GET', '/api/documents?tag=중요계약', { cookie: S.ST })).rows.map((r) => r.id);
  assert.ok(a1.includes(S.remoteDoc) && a2.includes(S.remoteDoc));
  assert.equal(get(`select count(*) n from documents where id=?`, S.remoteDoc).n, 1);
  // 일정: 완료된 계약도 종료·갱신 알림
  const sch = all(`select * from schedules where document_id=? order by kind`, S.remoteDoc);
  assert.deepEqual(sch.map((s) => s.kind).sort(), ['end', 'renewal', 'start']);
  const ren = sch.find((s) => s.kind === 'renewal');
  assert.equal(ren.date, '2027-03-01'); // 종료일 2027-03-31 - 30일
  const sent = Q.runReminders('2027-02-22'); // 갱신 검토 7일 전
  assert.ok(sent > 0);
  assert.ok(get(`select 1 from inbox where user_id=? and title like '[갱신 검토]%완료 계약%'`, S.staff), '완료 계약 갱신 알림');
  const again = get(`select count(*) n from inbox where user_id=? and title like '[갱신 검토]%'`, S.staff).n;
  Q.runReminders('2027-02-22');
  assert.equal(get(`select count(*) n from inbox where user_id=? and title like '[갱신 검토]%'`, S.staff).n, again, '같은 알림 중복 없음');
  // 담당자가 날짜 수정 → 이력, 이후 자동값으로 덮어쓰지 않음
  ok(await req('PUT', `/api/schedules/${ren.id}`, { cookie: S.ST, body: { date: '2027-02-15', remind_days: [14, 3] } }));
  assert.equal(get(`select source from schedules where id=?`, ren.id).source, 'manual');
  assert.ok(ok(await req('GET', `/api/schedules/${ren.id}/history`, { cookie: S.ST })).length >= 1);
});

test('조직·권한: 퇴사자 차단과 인계, 직인 권한 분리, 개인/공용 서식', async () => {
  const tmp = ok(await req('POST', '/api/users', { cookie: S.A, body: { email: 'leave@a.test', name: '퇴사예정', password: 'passL1234', role: 'manager' } }), 201).id;
  const L = await login('leave@a.test', 'passL1234');
  const tpl = ok(await req('POST', '/api/templates', { cookie: L, body: { name: '개인 서식', roles: [{ key: 'x', label: '상대방', kind: 'external' }], fields: [], body: '내용' } }), 201).id;
  assert.equal(ok(await req('GET', '/api/templates', { cookie: S.ST })).some((t) => t.id === tpl), false, '개인 서식은 남에게 안 보임');
  const did = ok(await req('POST', '/api/documents', { cookie: L, body: { mode: 'remote', template_id: tpl, participants: [{ role_key: 'x', name: '상대', email: 'x@x.test' }] } }), 201).id;
  const key = ok(await req('POST', '/api/api-keys', { cookie: S.A, body: { name: '임시', scopes: ['documents:read'] } }), 201);
  ok(await req('POST', `/api/users/${tmp}/retire`, { cookie: S.A, body: { handover_to: S.mgr } }));
  assert.equal((await req('GET', '/api/me', { cookie: L })).status, 401, '세션 차단');
  const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'leave@a.test', password: 'passL1234' }) });
  assert.equal(lr.status, 403, '로그인 차단');
  assert.equal(get(`select creator_id from documents where id=?`, did).creator_id, S.mgr, '문서 인계');
  assert.equal(get(`select owner_id from templates where id=?`, tpl).owner_id, S.mgr, '서식 인계');
  assert.ok(get(`select 1 from audit_logs where document_id=? and action='DOC_CREATE' and actor_name='퇴사예정'`, did), '기존 처리 이력 유지');
  assert.equal((await req('GET', `/api/v1/documents/${did}`, { headers: { authorization: `Bearer ${key.key}` } })).status, 200, '관리자 키는 유지');
  // 직인 권한 분리: 매니저는 등록 불가
  assert.equal((await req('POST', '/api/seals', { cookie: S.M, body: { name: 'x', image: dataUrl('seal.png', 'image/png') } })).status, 403);
  // 사전 날인: 정책 승인 전에는 자동 날인 안 됨, 승인 후 해당 서식·사용자·금액 안에서만
  const tId = tplId(S.cidA, '협력업체계약서');
  const pol = ok(await req('POST', '/api/seal-policies', { cookie: S.M, body: { seal_id: S.seal, template_id: tId, user_ids: [S.staff], max_amount: 10000000 } }), 201).id;
  const mk = async (amount) => ok(await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'remote', template_id: tId, vals: { partner: '사전날인(시험)', site: 'F현장', scope: '소규모', amount, start_date: '2026-12-01', end_date: '2026-12-31' }, participants: [{ role_key: 'partner_rep', name: '사대표', email: `pre${amount}@x.test` }, { role_key: 'company' }] } }), 201).id;
  const signExt = async (d, email) => { const t = tokenFromOutbox(email); ok(await req('POST', `/api/s/${t}/sign`, { body: { vals: { p_bizno: '1', p_addr: '주소' }, image: SIGN, agree: true } })); return get(`select status from documents where id=?`, d).status; };
  let d1 = await mk(5000000); ok(await req('POST', `/api/documents/${d1}/send`, { cookie: S.ST }));
  assert.equal(await signExt(d1, 'pre5000000@x.test'), 'in_progress', '정책 미승인 → 수동 날인 대기');
  ok(await req('POST', `/api/seal-policies/${pol}/approve`, { cookie: S.A }));
  let d2 = await mk(6000000); ok(await req('POST', `/api/documents/${d2}/send`, { cookie: S.ST }));
  assert.equal(await signExt(d2, 'pre6000000@x.test'), 'completed', '정책 범위 안 → 사전 날인');
  const u = get(`select * from seal_usages where document_id=?`, d2);
  assert.equal(u.kind, 'preseal'); assert.equal(u.representative_approved, 0);
  let d3 = await mk(20000000); ok(await req('POST', `/api/documents/${d3}/send`, { cookie: S.ST }));
  assert.equal(await signExt(d3, 'pre20000000@x.test'), 'in_progress', '한도 초과 → 자동 날인 안 함');
});

test('4차 · 시나리오 8: API·Webhook 재시도 시 중복 처리되지 않음', async () => {
  // Webhook 수신 서버: 첫 두 번은 500, 이후 200. 서명·타임스탬프 검증.
  let calls = 0; const got = []; let secret;
  const hook = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => {
      calls++;
      const [t, v1] = rq.headers['x-ieumsign-signature'].split(',').map((x) => x.split('=')[1]);
      const want = crypto.createHmac('sha256', secret).update(`${t}.${b}`).digest('hex');
      got.push({ id: rq.headers['x-ieumsign-event-id'], valid: want === v1 && Math.abs(Date.now() / 1000 - Number(t)) < 300, type: JSON.parse(b).type });
      rs.statusCode = calls <= 2 ? 500 : 200; rs.end();
    });
  }).listen(0);
  await new Promise((r) => hook.once('listening', r));
  const wh = ok(await req('POST', '/api/webhooks', { cookie: S.A, body: { url: `http://127.0.0.1:${hook.address().port}/hook`, events: ['document.sent', 'participant.signed', 'document.completed', 'document.cancelled'] } }), 201);
  secret = wh.secret;
  const key = ok(await req('POST', '/api/api-keys', { cookie: S.A, body: { name: 'ERP', scopes: ['templates:read', 'documents:read', 'documents:write', 'documents:send', 'documents:cancel', 'files:read'], rate_per_min: 30 } }), 201).key;
  const H = (k) => ({ authorization: `Bearer ${key}`, 'idempotency-key': k });
  const tpls = ok(await req('GET', '/api/v1/templates', { headers: { authorization: `Bearer ${key}` } }));
  const t = tpls.find((x) => x.doc_type === '검측확인서');
  assert.equal((await req('POST', '/api/v1/documents', { headers: { authorization: `Bearer ${key}` }, body: { template_id: t.id } })).status, 400, 'Idempotency-Key 필수');
  const body = { template_id: t.id, title: 'ERP 검측 요청', values: { site: 'A현장', work_name: '접지공사', location: '1공구', inspect_date: '2026-11-20', content: '접지저항 측정' }, participants: [{ role_key: 'reviewer', user_id: S.mgr }], send: true };
  const a = await req('POST', '/api/v1/documents', { headers: H('erp-req-001'), body });
  const b = await req('POST', '/api/v1/documents', { headers: H('erp-req-001'), body });
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(a.json.id, b.json.id, '같은 키 → 같은 결과');
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  assert.equal(get(`select count(*) n from documents where title='ERP 검측 요청'`).n, 1, '문서 1건만 생성');
  assert.equal((await req('POST', '/api/v1/documents', { headers: H('erp-req-001'), body: { ...body, title: '다른 내용' } })).status, 409);
  // 지정 검토자(로그인 직원) 확인 → 완료
  const pid = get(`select id from participants where document_id=?`, a.json.id).id;
  ok(await req('POST', `/api/documents/${a.json.id}/sign`, { cookie: S.M, body: { participant_id: pid, vals: { rv_result: '적합' }, image: SIGN, agree: true } }));
  // Webhook 재전송: 실패 후 재시도로 결국 전달, 이벤트별 한 번만 성공
  for (let i = 0; i < 20 && got.filter((g) => g.id).length < 5; i++) { await Q.tick(); await new Promise((r) => setTimeout(r, 30)); }
  await Q.drain();
  const ds = all(`select * from webhook_deliveries where webhook_id=?`, wh.id);
  assert.ok(ds.length >= 3 && ds.every((d) => d.status === 'delivered'), JSON.stringify(ds));
  assert.ok(ds.some((d) => d.attempts > 1), '실패 후 재전송');
  assert.ok(got.every((g) => g.valid), '서명·타임스탬프 검증');
  const okIds = got.filter((g, i) => i >= 2).map((g) => g.id);
  assert.equal(new Set(okIds).size, okIds.length, '성공 전달은 이벤트당 한 번');
  // 같은 이벤트가 두 번 발생하려 해도 1건 (취소 두 번)
  const own = ok(await req('POST', '/api/v1/documents', { headers: H('erp-req-002'), body: { ...body, title: 'ERP 취소 시험', participants: [{ role_key: 'reviewer', user_id: S.mgr }] } }), 201);
  ok(await req('POST', `/api/v1/documents/${own.id}/cancel`, { headers: H('cancel-2'), body: { reason: '요청 철회' } }));
  ok(await req('POST', `/api/v1/documents/${own.id}/cancel`, { headers: H('cancel-2'), body: { reason: '요청 철회' } }));
  assert.equal((await req('POST', `/api/v1/documents/${own.id}/cancel`, { headers: H('cancel-3'), body: { reason: '요청 철회' } })).status, 409);
  assert.equal(get(`select count(*) n from events where document_id=? and type='document.cancelled'`, own.id).n, 1);
  // 완료 PDF 다운로드 주소 (권한 확인 후, 만료)
  const pu = ok(await req('GET', `/api/v1/documents/${a.json.id}/pdf-url`, { headers: { authorization: `Bearer ${key}` } }));
  const pr = await fetch(pu.url); assert.equal(pr.status, 200); assert.equal(pr.headers.get('content-type'), 'application/pdf');
  const exp = new URL(pu.url); exp.searchParams.set('exp', String(Date.now() - 1000));
  assert.equal((await fetch(exp)).status, 403, '만료된 주소');
  // 요청 횟수 제한
  let limited = false;
  for (let i = 0; i < 40; i++) if ((await req('GET', '/api/v1/templates', { headers: { authorization: `Bearer ${key}` } })).status === 429) { limited = true; break; }
  assert.ok(limited, '분당 30회 제한');
  // 키 폐기·재발급
  const kid = get(`select id from api_keys where prefix=?`, key.slice(0, 10)).id;
  const nk = ok(await req('POST', `/api/api-keys/${kid}/rotate`, { cookie: S.A }), 201).key;
  assert.equal((await req('GET', '/api/v1/templates', { headers: { authorization: `Bearer ${key}` } })).status, 401);
  assert.equal((await req('GET', '/api/v1/templates', { headers: { authorization: `Bearer ${nk}` } })).status, 200);
  hook.close();
  S.inspectDoc = a.json.id;
});

test('시나리오 9: 완료 PDF의 한글·서명·첨부 구성 (사진대장 2×2, 도면, PDF 첨부)', async () => {
  const id = ok(await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'remote', template_id: tplId(S.cidA, '검측확인서'), title: '검측 확인 - 접지공사 1공구',
    vals: { site: 'A현장', work_name: '접지공사', location: '1공구 맨홀 #3', inspect_date: '2026-11-21', content: '접지봉 매설 깊이 확인\n접지저항 측정값 기록' },
    participants: [{ role_key: 'reviewer', user_id: S.mgr }] } }), 201).id;
  for (let i = 1; i <= 5; i++) ok(await req('POST', `/api/documents/${id}/attachments`, { cookie: S.ST, body: { dataUrl: dataUrl(`photo${i}.jpg`, 'image/jpeg'), name: `사진${i}.jpg`, kind: 'photo', caption: `접지 시공 사진 ${i}` } }), 201);
  ok(await req('POST', `/api/documents/${id}/attachments`, { cookie: S.ST, body: { dataUrl: dataUrl('drawing.png', 'image/png'), name: '도면.png', kind: 'drawing', caption: '접지 계통도' } }), 201);
  ok(await req('POST', `/api/documents/${id}/attachments`, { cookie: S.ST, body: { dataUrl: dataUrl('attached.pdf', 'application/pdf'), name: '시험성적서.pdf', kind: 'other', caption: '시험성적서' } }), 201);
  ok(await req('POST', `/api/documents/${id}/send`, { cookie: S.ST }));
  const pid = get(`select id from participants where document_id=?`, id).id;
  const d = ok(await req('POST', `/api/documents/${id}/sign`, { cookie: S.M, body: { participant_id: pid, vals: { rv_result: '적합', rv_note: '사진과 도면 일치' }, image: SIGN, agree: true } }));
  assert.equal(d.doc.status, 'completed');
  const r = await req('GET', `/api/documents/${id}/pdf`, { cookie: S.ST, raw: true });
  const buf = Buffer.from(await r.arrayBuffer());
  const out = path.join(TMP, 'final.pdf'); fs.writeFileSync(out, buf);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [out]).toString())[1]);
  // 본문·서명 1 + 사진대장 2(4+1) + 도면 1 + 이력 확인서 1 + 첨부 PDF 2 = 7
  assert.equal(pages, 7, `페이지 수 ${pages}`);
  const txt = execFileSync('pdftotext', ['-layout', out, '-']).toString();
  for (const s of ['검측 확인 - 접지공사 1공구', '1공구 맨홀 #3', '접지저항 측정값 기록', '지정 검토자', '김소장', '적합', '사진대장 (1/2)', '사진대장 (2/2)', '접지 시공 사진 5', '도면: 접지 계통도', '전자문서 처리 이력 확인서', '참여자 서명', 'ATTACHED SPEC SHEET page 2', '회사 검토용 예시'])
    assert.ok(txt.includes(s), `PDF 에 "${s}" 없음`);
  assert.ok(!/�/.test(txt), '깨진 글자 없음');
  execFileSync('pdftoppm', ['-r', '45', '-png', out, path.join(TMP, 'pg')]);
  S.pdfPath = out; S.pdfPages = pages;
  console.log('PDF', out, pages);
});

test('부동산: 주택 임대차 — 금액 분할 검증, 공동명의·중개사 선택, 법정 기한 일정, 한글 금액 PDF, 확인 목록', async () => {
  for (const r of ok(await req('GET', '/api/approval-rules', { cookie: S.A })).rules) ok(await req('DELETE', `/api/approval-rules/${r.id}`, { cookie: S.A })); // 앞 시험의 1억 이상 결재 규칙 제거
  const tid = tplId(S.cidA, '주택임대차계약서');
  const base = { site: '서울시 시험구 예시로 12, 101동 1001호', bldg: '철근콘크리트조 · 아파트', bldg_area: '84.9', lease_part: '101동 1001호 전부', lease_kind: '전세',
    amount: 300000000, down: 30000000, balance: 260000000, balance_date: '2026-12-20', start_date: '2026-12-20', end_date: '2028-12-19', info_way: '임차인의 정보 열람에 동의함' };
  const parts = [{ role_key: 'lessor', name: '김임대', email: 'lessor@re.test' }, { role_key: 'lessee', name: '이임차', email: 'lessee@re.test' }, { role_key: 'broker', user_id: S.staff }];
  const id = ok(await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'remote', template_id: tid, title: '전세 계약 - 예시로 12', vals: base, participants: parts } }), 201).id;
  assert.equal(all(`select * from participants where document_id=?`, id).length, 3, '공동명의·공동중개 생략 가능');
  const bad = await req('POST', `/api/documents/${id}/send`, { cookie: S.ST });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /계약금.*잔금.*보증금/, '계약금+중도금+잔금 ≠ 보증금 차단');
  ok(await req('PUT', `/api/documents/${id}`, { cookie: S.ST, body: { vals: { mid: 10000000, mid_date: '2026-11-30' } } }));
  ok(await req('POST', `/api/documents/${id}/checklist`, { cookie: S.ST, body: { index: 0, checked: true } }));
  ok(await req('POST', `/api/documents/${id}/send`, { cookie: S.ST }));
  const t1 = tokenFromOutbox('lessor@re.test', id);
  const v = ok(await req('GET', `/api/s/${t1}`));
  assert.equal(v.vals['@company'], 'A전력(시험)'); assert.equal(v.vals['@lessee.name'], '이임차');
  ok(await req('POST', `/api/s/${t1}/sign`, { body: { vals: { lr_birth: '1970-01-01', lr_addr: '서울시 예시동', lr_phone: '010-7000-0001' }, image: SIGN, agree: true } }));
  const t2 = tokenFromOutbox('lessee@re.test', id);
  ok(await req('POST', `/api/s/${t2}/sign`, { body: { vals: { le_birth: '1990-02-02', le_addr: '경기도 예시시', le_phone: '010-7000-0002' }, image: SIGN, agree: true } }));
  const bk = get(`select id from participants where document_id=? and role_key='broker'`, id).id;
  const d = ok(await req('POST', `/api/documents/${id}/sign`, { cookie: S.ST, body: { participant_id: bk, vals: { bk_office: '예시공인중개사사무소', bk_regno: '11000-2026-00001', bk_addr: '서울시 예시로 1' }, image: SIGN, agree: true } }));
  assert.equal(d.doc.status, 'completed');
  const sch = Object.fromEntries(all(`select kind,title,date from schedules where document_id=?`, id).map((x) => [x.title, x.date]));
  assert.equal(sch['중도금 지급일'], '2026-11-30'); assert.equal(sch['잔금 지급일'], '2026-12-20');
  assert.equal(sch['갱신 거절·조건 변경 통지 시작(만료 6개월 전)'], '2028-06-22'); assert.equal(sch['갱신 거절·조건 변경 통지 마감(만료 2개월 전)'], '2028-10-20');
  const kd = new Date(Date.now() + 9 * 3600e3); kd.setUTCDate(kd.getUTCDate() + 30);
  assert.equal(sch['주택임대차 신고 기한(신고 대상인 경우)'], kd.toISOString().slice(0, 10), '계약일+30일');
  const r = await req('GET', `/api/documents/${id}/pdf`, { cookie: S.ST, raw: true });
  const out = path.join(TMP, 'lease.pdf'); fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  const txt = execFileSync('pdftotext', ['-layout', out, '-']).toString().replace(/\s+/g, ' ');
  for (const k of ['일금 삼억원정', '300,000,000', '김임대', '이임차', '예시공인중개사사무소', '임대인의 정보 제시', '작성자 계약 전 확인 (1/6)', '[확인] 등기사항증명서', '주민등록번호는 받지 않습니다'])
    assert.ok(txt.includes(k), `PDF 에 "${k}" 없음`);
  S.leasePdf = out;
});

test('기업 간(B2B) 용역계약: 상대 회사 상호·사업자번호, 거래처 자동, 시스템 값', async () => {
  const tid = tplId(S.cidA, '용역계약서');
  const vals = { service_name: '사내 전산 유지보수', scope: 'PC·네트워크 점검', deliverable: '월간 점검 보고서', amount: 12000000, pay_terms: '매월 말 1,000,000원', start_date: '2027-01-01', end_date: '2027-12-31' };
  assert.equal((await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'remote', template_id: tid, vals, participants: [{ role_key: 'vendor', name: '박대표', email: 'ceo@vendor.test' }, { role_key: 'company' }] } })).status, 400, '회사 당사자는 상호 필수');
  assert.equal((await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'remote', template_id: tid, vals, participants: [{ role_key: 'vendor', name: '박대표', email: 'ceo@vendor.test', org_name: '예시IT(주)', org_no: '12-34' }, { role_key: 'company' }] } })).status, 400, '사업자번호 형식');
  const id = ok(await req('POST', '/api/documents', { cookie: S.ST, body: { mode: 'remote', template_id: tid, vals, participants: [{ role_key: 'vendor', name: '박대표', email: 'ceo@vendor.test', org_name: '예시IT(주)', org_no: '123-45-67891' }, { role_key: 'company' }] } }), 201).id;
  assert.equal(get(`select partner from documents where id=?`, id).partner, '예시IT(주)', '거래처 자동');
  ok(await req('POST', `/api/documents/${id}/send`, { cookie: S.ST }));
  const tk = tokenFromOutbox('ceo@vendor.test', id);
  const v = ok(await req('GET', `/api/s/${tk}`));
  assert.equal(v.vals['@vendor.org'], '예시IT(주)'); assert.equal(v.vals['@vendor.orgno'], '123-45-67891');
  // 잘못된 시스템 값·표시 방식은 템플릿 저장에서 거부
  assert.equal((await req('POST', '/api/templates', { cookie: S.ST, body: { name: 'x', roles: [{ key: 'a', label: 'A', kind: 'external' }], fields: [], body: '{{@nobody.name}}' } })).status, 400);
  assert.equal((await req('POST', '/api/templates', { cookie: S.ST, body: { name: 'x', roles: [{ key: 'a', label: 'A', kind: 'external' }], fields: [{ key: 'n', label: 'N', type: 'number' }], body: '{{n|eval}}' } })).status, 400);
  ok(await req('POST', '/api/templates', { cookie: S.ST, body: { name: 'B2B 테스트', category: '일반', roles: [{ key: 'a', label: 'A', kind: 'external', party: 'company' }], fields: [{ key: 'n', label: 'N', type: 'number' }, { key: 'd', label: 'D', type: 'date' }],
    body: '{{@company}} {{@a.org}} {{n|한글}} {{d}}', extra: { checks: [], deadlines: [{ from: 'd', days: -7, title: '7일 전' }], checklist: ['확인1'] } } }), 201);
});

test('부동산 도구: 중개보수 상한 계산', async () => {
  const fee = (q) => req('GET', '/api/tools/broker-fee?' + new URLSearchParams(q), { cookie: S.ST });
  assert.equal(ok(await fee({ property: 'house', deal: 'sale', price: 900000000 })).fee, 4500000);   // 9억: 0.5%
  assert.equal(ok(await fee({ property: 'house', deal: 'sale', price: 100000000 })).fee, 500000);    // 1억: 0.5% (한도 80만)
  assert.equal(ok(await fee({ property: 'house', deal: 'sale', price: 190000000 })).fee, 800000);    // 한도 적용
  assert.equal(ok(await fee({ property: 'house', deal: 'lease', deposit: 10000000, rent: 500000 })).fee, 240000); // 1천+50만×100=6천만, 0.4%
  const small = ok(await fee({ property: 'house', deal: 'lease', deposit: 5000000, rent: 300000 }));
  assert.equal(small.base, 26000000); assert.equal(small.fee, 130000);                                // 5천만 미만이면 ×70
  assert.equal(ok(await fee({ property: 'other', deal: 'lease', deposit: 50000000, rent: 2000000 })).fee, 2250000); // 상가 0.9%
  assert.equal((await fee({ property: 'house', deal: 'sale' })).status, 400);
});

test.after(() => { if (S.perf) fs.writeFileSync(path.join(__dirname, '..', 'docs', 'perf.json'), JSON.stringify({ ...S.perf, measuredAt: new Date().toISOString() }, null, 2)); });
