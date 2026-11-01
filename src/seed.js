// 회사 생성과 업무 예시 서식 (전기·통신공사업무). 예시 서식은 "회사 검토용"이며 기관 승인·법정 서식이 아니다.
const { get, run, tx } = require('./db');
const C = require('./core');

const NOTE = '\n※ 이 서식은 이음사인이 제공하는 회사 검토용 예시입니다. 기관 승인 양식이나 법정 필수서식이 아니므로 회사(노무·법률 담당)가 검토한 뒤 사용하세요.';
const f = (key, label, type = 'text', o = {}) => ({ key, label, type, required: o.required ?? true, owner: o.owner || 'sender', pii: !!o.pii, scope: o.scope || 'each' });

const SAMPLES = [
  {
    name: '[예시] 현장 근로계약서 (일용)', doc_type: '근로계약서', flow: 'A',
    roles: [{ key: 'worker', label: '근로자', kind: 'external', order: 1 }, { key: 'company', label: '사업주(직인)', kind: 'seal', order: 2 }],
    fields: [f('site', '현장명', 'text', { scope: 'common' }), f('job', '업무 내용', 'text', { scope: 'common' }), f('start_date', '계약 시작일', 'date'), f('end_date', '계약 종료일', 'date'),
      f('amount', '일급(원)', 'number'), f('work_time', '근로시간', 'text', { scope: 'common' }),
      f('w_birth', '생년월일', 'date', { owner: 'worker', pii: true }), f('w_addr', '주소', 'text', { owner: 'worker', pii: true }), f('w_phone', '연락처', 'phone', { owner: 'worker', pii: true }), f('w_agree', '근로조건을 확인했습니다', 'check', { owner: 'worker' })],
    body: `## 1. 근로 장소와 업무\n근로 장소: {{site}}\n업무 내용: {{job}}\n\n## 2. 계약 기간\n{{start_date}} 부터 {{end_date}} 까지\n\n## 3. 근로시간과 임금\n근로시간: {{work_time}}\n일급: {{amount}}원 (세전)\n\n## 4. 근로자 정보\n생년월일: {{w_birth}}\n주소: {{w_addr}}\n연락처: {{w_phone}}\n\n근로자는 위 근로조건을 확인하였습니다: {{w_agree}}${NOTE}`,
  },
  {
    name: '[예시] 자재 인수확인서', doc_type: '자재인수확인서', flow: 'B',
    roles: [{ key: 'receiver', label: '인수자', kind: 'external', order: 1 }],
    fields: [f('site', '현장명'), f('po_no', '발주번호'), f('partner', '납품업체'), f('items', '인수 품목·규격·수량', 'textarea'), f('recv_date', '인수일', 'date'),
      f('r_note', '인수 확인 의견(파손·부족 등)', 'textarea', { owner: 'receiver', required: false }), f('r_ok', '품목과 수량을 확인했습니다', 'check', { owner: 'receiver' })],
    attachments: { photo: true },
    body: `## 발주 정보\n현장: {{site}}\n발주번호: {{po_no}}\n납품업체: {{partner}}\n인수일: {{recv_date}}\n\n## 인수 품목\n{{items}}\n\n## 인수자 확인\n확인 의견: {{r_note}}\n품목·수량 확인: {{r_ok}}\n\n인수 사진은 뒤쪽 사진대장에 붙습니다.${NOTE}`,
  },
  {
    name: '[예시] 검측 확인서', doc_type: '검측확인서', flow: 'C',
    roles: [{ key: 'reviewer', label: '지정 검토자', kind: 'internal', order: 1 }],
    fields: [f('site', '현장명'), f('work_name', '공종'), f('location', '검측 위치'), f('inspect_date', '검측일', 'date'), f('content', '검측 내용', 'textarea'),
      f('rv_result', '검토 결과', 'text', { owner: 'reviewer' }), f('rv_note', '검토 의견', 'textarea', { owner: 'reviewer', required: false })],
    attachments: { photo: true, drawing: true },
    body: `## 검측 개요\n현장: {{site}}\n공종: {{work_name}}\n위치: {{location}}\n검측일: {{inspect_date}}\n\n## 검측 내용\n{{content}}\n\n## 검토\n결과: {{rv_result}}\n의견: {{rv_note}}\n\n사진대장(한 장에 가로 2장 × 세로 2장)과 도면이 뒤에 붙습니다.${NOTE}`,
  },
  {
    name: '[예시] 협력업체 공사계약서', doc_type: '협력업체계약서', flow: 'D',
    roles: [{ key: 'partner_rep', label: '협력업체 대표', kind: 'external', order: 1 }, { key: 'company', label: '당사(직인)', kind: 'seal', order: 2 }],
    fields: [f('partner', '협력업체명'), f('site', '현장명'), f('scope', '공사 범위', 'textarea'), f('amount', '계약금액(원, VAT 별도)', 'number'), f('start_date', '계약 시작일', 'date'), f('end_date', '계약 종료일', 'date'),
      f('p_bizno', '사업자등록번호', 'text', { owner: 'partner_rep' }), f('p_addr', '주소', 'text', { owner: 'partner_rep' })],
    body: `## 1. 계약 당사자\n도급인: 요청 회사\n수급인: {{partner}} (사업자등록번호 {{p_bizno}}, 주소 {{p_addr}})\n\n## 2. 공사 내용\n현장: {{site}}\n범위: {{scope}}\n\n## 3. 계약금액과 기간\n계약금액: {{amount}}원 (부가가치세 별도)\n기간: {{start_date}} ~ {{end_date}}\n\n## 4. 기타\n세부 조건은 양측이 따로 합의한 특약을 따릅니다.${NOTE}`,
  },
  {
    name: '[예시] 현장 출입·안전교육 동의서', doc_type: '현장동의서', flow: 'E',
    roles: [{ key: 'applicant', label: '신청자', kind: 'external', order: 1 }],
    fields: [f('site', '현장명'), f('a_company', '소속 회사', 'text', { owner: 'applicant' }), f('a_birth', '생년월일', 'date', { owner: 'applicant', pii: true }),
      f('a_safety', '현장 안전수칙을 읽고 지키겠습니다', 'check', { owner: 'applicant' }), f('a_privacy', '출입 관리 목적의 개인정보 수집·이용에 동의합니다', 'check', { owner: 'applicant' })],
    body: `## 현장 출입 신청\n현장: {{site}}\n소속: {{a_company}}\n생년월일: {{a_birth}}\n\n## 확인과 동의\n안전수칙 준수: {{a_safety}}\n개인정보 수집·이용 동의: {{a_privacy}}\n\n이 동의서는 제출 사실만 기록합니다. 안전교육 이수나 신원 확인은 담당자가 별도로 확인합니다.${NOTE}`,
  },
];

function createTemplate(companyId, ownerId, t, scope = 'company') {
  const r = run(`insert into templates(company_id,owner_id,scope,name,doc_type) values(?,?,?,?,?)`, companyId, ownerId, scope, t.name, t.doc_type || null);
  const id = Number(r.lastInsertRowid);
  run(`insert into template_versions(template_id,version,body,fields,roles,attachments_spec,created_by) values(?,?,?,?,?,?,?)`, id, 1, t.body, JSON.stringify(t.fields), JSON.stringify(t.roles), JSON.stringify(t.attachments || {}), ownerId);
  return id;
}

function createCompany({ name, bizNo, adminEmail, adminName, password }) {
  if (!name || !adminEmail || !password || String(password).length < 8) throw C.bad('회사명·이메일·비밀번호(8자 이상)를 입력하세요');
  if (!C.EMAIL_RE.test(adminEmail)) throw C.bad('이메일 형식이 아닙니다');
  if (get(`select 1 from users where lower(email)=lower(?)`, adminEmail)) throw C.conflict('이미 쓰는 이메일입니다');
  return tx(() => {
    const cid = Number(run(`insert into companies(name,biz_no,brand,settings) values(?,?,?,?)`, name, bizNo || null,
      JSON.stringify({ color: '#1f4e79', sender_name: name, request_msg: '아래 문서를 확인하고 서명해 주세요.', done_msg: '모든 서명이 끝나 계약이 완료되었습니다.', contact: '' }),
      JSON.stringify({ renewal_days: 30 })).lastInsertRowid);
    const dept = Number(run(`insert into departments(company_id,name) values(?,?)`, cid, '본사').lastInsertRowid);
    const uid = Number(run(`insert into users(company_id,dept_id,email,name,pw_hash,role) values(?,?,?,?,?,'admin')`, cid, dept, adminEmail.toLowerCase(), adminName || '관리자', C.hashPw(password)).lastInsertRowid);
    for (const t of SAMPLES) createTemplate(cid, uid, t);
    C.audit({ companyId: cid, actor: { type: 'system' }, action: 'COMPANY_CREATE', detail: { name } });
    return cid;
  });
}

function bootstrap() {
  if (get(`select 1 from companies limit 1`)) return;
  const email = process.env.ADMIN_EMAIL, pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) { console.log('[이음사인] 첫 회사가 없습니다. ADMIN_EMAIL·ADMIN_PASSWORD·COMPANY_NAME 환경변수로 시작하세요.'); return; }
  createCompany({ name: process.env.COMPANY_NAME || '우리 회사', bizNo: process.env.COMPANY_BIZNO, adminEmail: email, adminName: process.env.ADMIN_NAME || '관리자', password: pw });
  console.log(`[이음사인] 첫 회사와 관리자(${email})를 만들었습니다.`);
}
module.exports = { createCompany, createTemplate, bootstrap, SAMPLES };
