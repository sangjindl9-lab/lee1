// 공통: 오류, 해시·토큰, 인증·권한, 감사 이력, 이벤트, 알림
const crypto = require('crypto');
const { all, get, run, J } = require('./db');

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const bad = (m, x) => new HttpError(400, m, x);
const forbid = (m = '권한이 없습니다') => new HttpError(403, m);
const notFound = (m = '찾을 수 없습니다') => new HttpError(404, m);
const conflict = (m, x) => new HttpError(409, m, x);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = (n = 24) => crypto.randomBytes(n).toString('base64url');
const now = () => new Date().toISOString();
const SECRET = process.env.APP_SECRET || (() => {
  const row = get(`select v from meta where k='secret'`);
  if (row) return row.v;
  const s = token(32); run(`insert into meta(k,v) values('secret',?)`, s); return s;
})();
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');

// ── 비밀번호
function hashPw(pw) { const salt = token(12); return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`; }
function checkPw(pw, h) {
  const [, salt, hex] = String(h).split('$'); if (!salt) return false;
  const a = crypto.scryptSync(pw, salt, 32), b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── 권한 (실제 업무 단위)
const PERMS = {
  'doc.create': '문서 작성', 'doc.send': '외부 발송', 'doc.cancel': '계약 취소',
  'doc.view_dept': '부서 문서 열람·다운로드', 'doc.view_all': '회사 전체 문서 열람·다운로드',
  'template.edit': '템플릿 작성·수정', 'template.share': '템플릿 회사 공용 등록·공유',
  'seal.register': '직인 등록', 'seal.use': '직인 사용', 'seal.approve': '직인·사전날인 승인', 'seal.retire': '직인 폐기',
  'bulk.send': '일괄 발송', 'link.manage': '링크계약 관리', 'org.manage': '조직·멤버 관리', 'rule.manage': '분류 규칙 관리',
  'api.manage': 'API·Webhook 관리',
};
const ROLE_PRESETS = {
  admin: Object.keys(PERMS),
  manager: ['doc.create', 'doc.send', 'doc.cancel', 'doc.view_dept', 'template.edit', 'template.share', 'bulk.send', 'link.manage', 'seal.use', 'rule.manage'],
  member: ['doc.create', 'doc.send', 'template.edit'],
};
const userPerms = (u) => new Set(J(u.perms, null)?.length ? J(u.perms, []) : ROLE_PRESETS[u.role] || []);
const can = (u, p) => !!u && userPerms(u).has(p);
function need(u, p) { if (!can(u, p)) throw forbid(`권한이 없습니다: ${PERMS[p] || p}`); }

// ── 감사 이력 (회사별 해시 체인 — 중간 기록을 고치면 이후 해시가 맞지 않는다)
function audit({ companyId, documentId = null, actor = {}, action, detail = null, ip = null }) {
  const prev = get(`select hash from audit_logs where company_id=? order by id desc limit 1`, companyId);
  const at = now();
  const d = detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail));
  const body = JSON.stringify([companyId, documentId, actor.type || 'system', actor.id ?? null, actor.name ?? null, action, d, ip, at, prev?.hash || '']);
  const hash = sha256(body);
  run(`insert into audit_logs(company_id,document_id,actor_type,actor_id,actor_name,action,detail,ip,at,prev_hash,hash) values(?,?,?,?,?,?,?,?,?,?,?)`,
    companyId, documentId, actor.type || 'system', actor.id ?? null, actor.name ?? null, action, d, ip, at, prev?.hash || '', hash);
}
function verifyAuditChain(companyId) {
  let prev = '';
  for (const r of all(`select * from audit_logs where company_id=? order by id`, companyId)) {
    const body = JSON.stringify([r.company_id, r.document_id, r.actor_type, r.actor_id, r.actor_name, r.action, r.detail, r.ip, r.at, prev]);
    if (r.prev_hash !== prev || sha256(body) !== r.hash) return { ok: false, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true };
}
const actorOf = (u) => u ? { type: 'user', id: u.id, name: u.name } : { type: 'system' };

// ── 이벤트 (Webhook 원천). 같은 dedupe 로 두 번 부르면 한 번만 생긴다.
const EVENT_TYPES = ['document.sent', 'participant.signed', 'document.rejected', 'document.cancelled', 'document.expired', 'document.completed'];
function emitEvent(companyId, documentId, type, payload, dedupe) {
  const id = 'evt_' + (dedupe ? sha256(`${companyId}:${type}:${dedupe}`).slice(0, 24) : token(12));
  const r = run(`insert or ignore into events(id,company_id,document_id,type,payload) values(?,?,?,?,?)`, id, companyId, documentId, type, JSON.stringify(payload));
  if (!r.changes) return id;
  for (const w of all(`select * from webhooks where company_id=? and active=1`, companyId)) {
    if (!J(w.events, []).includes(type)) continue;
    run(`insert or ignore into webhook_deliveries(webhook_id,event_id,next_at) values(?,?,?)`, w.id, id, Date.now());
  }
  return id;
}

// ── 알림. 실제 메일·문자 발송은 외부 연결이 필요하므로 outbox 에 쌓고 상태로 구분한다.
// dedupe_key 가 같으면 한 번만 쌓인다 (대량 발송 재실행·재시도 중복 방지).
function notify({ companyId, channel, to, userId = null, subject, body, dedupe, documentId = null }) {
  if (channel === 'inapp') {
    if (!userId) return;
    if (dedupe && get(`select 1 from outbox where dedupe_key=?`, dedupe)) return;
    run(`insert into inbox(user_id,title,link) values(?,?,?)`, userId, subject, body || null);
    run(`insert or ignore into outbox(company_id,channel,user_id,subject,body,dedupe_key,status,document_id) values(?,?,?,?,?,?,?,?)`,
      companyId, 'inapp', userId, subject, body, dedupe || null, 'sent', documentId);
    return;
  }
  if (!to) return;
  const failDomain = process.env.TEST_FAIL_DOMAIN; // 시험용: 이 도메인 주소는 발송 실패로 처리
  if (failDomain && String(to).endsWith('@' + failDomain)) throw new Error(`발송 실패(시험용 실패 도메인): ${to}`);
  const connected = channel === 'email' ? !!process.env.SMTP_URL : !!process.env.SMS_API_URL;
  run(`insert or ignore into outbox(company_id,channel,to_addr,user_id,subject,body,dedupe_key,status,document_id) values(?,?,?,?,?,?,?,?,?)`,
    companyId, channel, to, userId, subject, body, dedupe || null, connected ? 'queued' : 'not_connected', documentId);
}

const PHONE_RE = /^01[016789]-?\d{3,4}-?\d{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const normPhone = (p) => String(p || '').replace(/\D/g, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const maskPhone = (p) => { const d = normPhone(p); return d.length >= 8 ? d.slice(0, 3) + '-****-' + d.slice(-4) : '****'; };

const ACTION_LABEL = {
  LOGIN: '로그인', DOC_CREATE: '문서 작성', DOC_UPDATE: '내용·첨부 변경', REAPPROVAL_REQUIRED: '변경으로 재결재 필요', APPROVAL_SUBMIT: '결재 요청', APPROVAL_APPROVE: '결재 승인',
  APPROVAL_REJECT: '결재 반려', DOC_SEND: '발송', PARTICIPANT_VIEW: '참여자 열람', PARTICIPANT_VERIFY: '참여자 본인 인증', INPERSON_IDENTIFY: '대면 참여자 확인',
  PARTICIPANT_SIGN: '참여자 서명', SEAL_APPLY: '직인 날인', SEAL_PRESEAL: '사전날인 정책 직인', PARTICIPANT_REJECT: '서명 거절', DOC_CANCEL: '취소', DOC_EXPIRE: '기한 만료',
  REVIEW_WAIT: '담당자 확인 대기', REVIEW_CONFIRM: '담당자 확인', DOC_COMPLETE: '완료', PDF_CREATE: '완료 PDF 생성', PDF_DOWNLOAD: 'PDF 내려받기', PDF_PREVIEW: 'PDF 미리보기',
  LINK_SUBMIT_START: '링크 접수', API_DOC_CREATE: 'API 문서 생성', API_PDF_URL: 'API PDF 주소 발급',
};
function auditSummary(l) {
  let d = {}; try { d = JSON.parse(l.detail || '{}'); } catch { d = { note: l.detail }; }
  if (typeof d !== 'object' || !d) d = { note: String(d) };
  const parts = [];
  for (const [k, lab] of [['role', ''], ['signer', ''], ['participant', ''], ['confirm', '확인:'], ['method', '방법:'], ['operator', '진행 담당:'], ['round', '차수'], ['step', '단계'], ['comment', '의견:'], ['reason', '사유:'], ['version', '버전'], ['note', '']])
    if (d[k] != null && d[k] !== '') parts.push(`${lab}${lab && !lab.endsWith(':') ? ' ' : ''}${d[k]}`.trim());
  return parts.join(' · ');
}

// 금액을 한글로: 55000000 → "일금 오천오백만원정"
function krMoney(n) {
  n = Math.floor(Number(n)); if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return '일금 영원정';
  const D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], U = ['', '십', '백', '천'], B = ['', '만', '억', '조', '경'];
  let out = '', i = 0;
  while (n > 0) {
    const chunk = n % 10000; n = Math.floor(n / 10000);
    if (chunk) { let t = ''; String(chunk).padStart(4, '0').split('').forEach((c, k) => { const d = Number(c); if (d) t += D[d] + U[3 - k]; }); out = t + B[i] + out; }
    i++;
  }
  return `일금 ${out}원정`;
}

module.exports = {
  krMoney, ACTION_LABEL, auditSummary, HttpError, bad, forbid, notFound, conflict, sha256, token, now, hmac, SECRET,
  hashPw, checkPw, PERMS, ROLE_PRESETS, userPerms, can, need,
  audit, verifyAuditChain, actorOf, EVENT_TYPES, emitEvent, notify,
  PHONE_RE, EMAIL_RE, DATE_RE, normPhone, esc, maskPhone,
};
