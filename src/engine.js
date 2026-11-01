// 문서 처리 엔진 — 비대면·대면·링크·대량 네 방식이 모두 이 엔진을 쓴다.
// 방식에 따라 달라지는 것은 "참여자 확인 방법"과 "문서 생성 경로"뿐이다.
const { all, get, run, tx, J } = require('./db');
const C = require('./core');

const BASE_URL = () => (process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, '');
const STATUS = {
  draft: '작성 중', approval: '내부 결재 중', ready: '결재 완료(발송 대기)', in_progress: '서명 진행 중',
  review: '담당자 확인 대기', completed: '완료', rejected: '서명 거절', cancelled: '취소', expired: '기한 만료',
};
const META_KEYS = ['site', 'partner', 'amount', 'start_date', 'end_date', 'sign_deadline'];

function loadTV(id) {
  const tv = get(`select v.*, t.company_id, t.name as template_name, t.doc_type, t.scope, t.owner_id, t.archived from template_versions v join templates t on t.id=v.template_id where v.id=?`, id);
  if (!tv) throw C.notFound('템플릿을 찾을 수 없습니다');
  tv.fields = J(tv.fields, []); tv.roles = J(tv.roles, []); tv.attachments_spec = J(tv.attachments_spec, {});
  return tv;
}
function currentTV(templateId) {
  const t = get(`select * from templates where id=?`, templateId);
  if (!t) throw C.notFound('템플릿을 찾을 수 없습니다');
  return loadTV(get(`select id from template_versions where template_id=? and version=?`, t.id, t.current_version).id);
}

// 템플릿 사용 권한: 내 개인 서식, 또는 회사 공용 서식 중 나·내 부서·내 그룹에 공유된 것(공유 대상이 없으면 회사 전체)
function canUseTemplate(user, t) {
  if (!user || t.company_id !== user.company_id || t.archived) return false;
  if (t.owner_id === user.id) return true;
  if (t.scope !== 'company') return false;
  const shares = all(`select * from template_shares where template_id=?`, t.id ?? t.template_id);
  if (!shares.length) return true;
  const gids = all(`select group_id from group_members where user_id=?`, user.id).map((r) => r.group_id);
  return shares.some((s) => (s.target_type === 'user' && s.target_id === user.id) || (s.target_type === 'dept' && s.target_id === user.dept_id) || (s.target_type === 'group' && gids.includes(s.target_id)));
}

function checkValue(f, v) {
  if (v == null || v === '' || (f.type === 'check' && v !== true && v !== 'true')) return f.required ? `${f.label}: 필수 ${f.type === 'check' ? '동의' : '입력'}입니다` : null;
  if (f.type === 'check') return null;
  const s = String(v);
  if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) return `${f.label}: 숫자만 입력하세요`;
  if (f.type === 'date' && (!C.DATE_RE.test(s) || isNaN(Date.parse(s)))) return `${f.label}: 날짜 형식(YYYY-MM-DD)이 아닙니다`;
  if (f.type === 'email' && !C.EMAIL_RE.test(s)) return `${f.label}: 이메일 형식이 아닙니다`;
  if (f.type === 'phone' && !C.PHONE_RE.test(s)) return `${f.label}: 전화번호 형식이 아닙니다`;
  if (s.length > 2000) return `${f.label}: 너무 깁니다`;
  return null;
}
const normValue = (f, v) => (f.type === 'number' && v !== '' && v != null ? Number(String(v).replace(/,/g, '')) : f.type === 'check' ? (v === true || v === 'true') : typeof v === 'string' ? v.trim() : v);

function fieldsFor(tv, owner) { return tv.fields.filter((f) => (f.owner || 'sender') === owner); }

// 내용 해시 — 결재가 승인한 대상과 발송 대상이 같은지 확인하는 기준
function contentHash(docId) {
  const d = get(`select * from documents where id=?`, docId);
  const ps = all(`select role_key,order_no,kind,user_id,name,email,phone from participants where document_id=? order by order_no,id`, docId);
  const at = all(`select f.sha256, a.kind, a.caption from doc_attachments a join files f on f.id=a.file_id where a.document_id=? order by a.sort,a.id`, docId);
  const base = d.base_file_id ? get(`select sha256 from files where id=?`, d.base_file_id).sha256 : null;
  return C.sha256(JSON.stringify([d.template_version_id, d.title, J(d.vals, {}), ps, at, base, J(d.delivery, {})]));
}

function metaFrom(vals, extra = {}) {
  const m = {};
  for (const k of META_KEYS) m[k] = extra[k] ?? vals[k] ?? null;
  if (m.amount != null && m.amount !== '') m.amount = Math.round(Number(String(m.amount).replace(/,/g, ''))) || null; else m.amount = null;
  return m;
}

function createDocument({ companyId, user = null, tvId, title, mode, vals = {}, participants = [], meta = {}, linkCampaignId = null, bulkJobId = null, bulkRow = null, baseFileId = null, attachments = [], delivery = {}, ip = null, skipTemplateCheck = false, ownerId = null }) {
  const tv = loadTV(tvId);
  if (tv.company_id !== companyId) throw C.forbid();
  if (user && !skipTemplateCheck) {
    C.need(user, 'doc.create');
    if (!canUseTemplate(user, { ...tv, id: tv.template_id })) throw C.forbid('이 템플릿을 사용할 권한이 없습니다');
  }
  if (!['remote', 'inperson', 'link', 'bulk'].includes(mode)) throw C.bad('계약 방식이 올바르지 않습니다');
  // 작성자 입력값: 템플릿에 있는 작성자 항목만 받는다
  const sv = {};
  for (const f of fieldsFor(tv, 'sender')) {
    if (vals[f.key] === undefined) continue;
    const e = vals[f.key] === '' ? null : checkValue({ ...f, required: false }, vals[f.key]);
    if (e) throw C.bad(e);
    sv[f.key] = normValue(f, vals[f.key]);
  }
  const roleMap = Object.fromEntries(tv.roles.map((r, i) => [r.key, { ...r, order: r.order ?? i + 1 }]));
  for (const r of tv.roles) if (!participants.find((p) => p.role_key === r.key)) throw C.bad(`참여자 지정이 필요합니다: ${r.label}`);
  const m = metaFrom(sv, meta);
  return tx(() => {
    const d = run(`insert into documents(company_id,template_version_id,title,mode,status,creator_id,dept_id,site,partner,doc_type,amount,start_date,end_date,sign_deadline,vals,link_campaign_id,bulk_job_id,bulk_row,base_file_id,delivery)
      values(?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    companyId, tvId, String(title || tv.template_name).slice(0, 200), mode, ownerId ?? user?.id ?? null, (ownerId ? get(`select dept_id from users where id=?`, ownerId)?.dept_id : user?.dept_id) ?? null,
    m.site, m.partner, tv.doc_type, m.amount, m.start_date, m.end_date, m.sign_deadline, JSON.stringify(sv), linkCampaignId, bulkJobId, bulkRow, baseFileId, JSON.stringify(delivery));
    const id = Number(d.lastInsertRowid);
    for (const p of participants) addParticipant(id, roleMap, p, companyId);
    attachments.forEach((a, i) => run(`insert into doc_attachments(document_id,file_id,kind,caption,sort,added_by) values(?,?,?,?,?,?)`, id, a.file_id, a.kind || 'other', a.caption || null, i, 'creator'));
    run(`update documents set content_hash=? where id=?`, contentHash(id), id);
    C.audit({ companyId, documentId: id, actor: user ? C.actorOf(user) : { type: 'system', name: mode === 'link' ? '링크 접수' : '시스템' }, action: 'DOC_CREATE', detail: { mode, template: tv.template_name, version: tv.version }, ip });
    applyRules(id); syncSchedules(id);
    return id;
  });
}

function addParticipant(docId, roleMap, p, companyId) {
  const r = roleMap[p.role_key];
  if (!r) throw C.bad(`템플릿에 없는 참여자 역할입니다: ${p.role_key}`);
  let name = String(p.name || '').trim(), email = p.email || null, phone = p.phone || null, userId = null;
  if (r.kind === 'internal' || r.kind === 'seal') {
    if (r.kind === 'internal') {
      const u = get(`select * from users where id=? and company_id=? and status='active'`, p.user_id, companyId);
      if (!u) throw C.bad(`${r.label}: 회사 직원을 지정하세요`);
      userId = u.id; name = u.name; email = u.email;
    } else name = name || '회사 직인';
  } else {
    if (!name) throw C.bad(`${r.label}: 이름을 입력하세요`);
    if (email && !C.EMAIL_RE.test(email)) throw C.bad(`${r.label}: 이메일 형식이 아닙니다`);
    if (phone && !C.PHONE_RE.test(phone)) throw C.bad(`${r.label}: 전화번호 형식이 아닙니다`);
  }
  const auth = ['link', 'email_otp', 'phone_otp'].includes(p.auth_method) ? p.auth_method : 'link';
  run(`insert into participants(document_id,order_no,role_key,role_label,kind,user_id,name,email,phone,auth_method,delivery) values(?,?,?,?,?,?,?,?,?,?,?)`,
    docId, r.order, r.key, r.label, r.kind, userId, name.slice(0, 50), email, phone, auth, p.delivery || (email ? 'email' : phone ? 'sms' : 'none'));
}

function getDoc(id) { const d = get(`select * from documents where id=?`, id); if (!d) throw C.notFound('문서를 찾을 수 없습니다'); return d; }

// 열람 권한 — 폴더·태그·자동분류는 여기 쓰지 않는다 (분류가 권한을 넓히지 않게)
function canViewDoc(user, d) {
  if (!user || user.company_id !== d.company_id) return false;
  if (d.creator_id === user.id) return true;
  if (C.can(user, 'doc.view_all')) return true;
  if (C.can(user, 'doc.view_dept') && d.dept_id && d.dept_id === user.dept_id) return true;
  if (get(`select 1 from participants where document_id=? and user_id=?`, d.id, user.id)) return true;
  if (get(`select 1 from approvals where target_type='document' and target_id=? and user_id=?`, d.id, user.id)) return true;
  if (d.bulk_job_id && get(`select 1 from approvals where target_type='bulk_job' and target_id=? and user_id=?`, d.bulk_job_id, user.id)) return true;
  if (d.bulk_job_id && get(`select 1 from bulk_jobs where id=? and created_by=?`, d.bulk_job_id, user.id)) return true;
  return false;
}
function viewableSql(user) {
  // 목록 조회용 SQL 조건 (canViewDoc 과 같은 규칙)
  const conds = [`d.creator_id=${user.id}`,
    `exists(select 1 from participants p where p.document_id=d.id and p.user_id=${user.id})`,
    `exists(select 1 from approvals a where a.target_type='document' and a.target_id=d.id and a.user_id=${user.id})`,
    `exists(select 1 from approvals a where a.target_type='bulk_job' and a.target_id=d.bulk_job_id and a.user_id=${user.id})`,
    `exists(select 1 from bulk_jobs j where j.id=d.bulk_job_id and j.created_by=${user.id})`];
  if (C.can(user, 'doc.view_all')) conds.push('1=1');
  if (C.can(user, 'doc.view_dept') && user.dept_id) conds.push(`d.dept_id=${Number(user.dept_id)}`);
  return `d.company_id=${Number(user.company_id)} and (${conds.join(' or ')})`;
}
function mustView(user, d) { if (!canViewDoc(user, d)) throw C.forbid('이 문서를 볼 권한이 없습니다'); }

const EDITABLE = ['draft', 'approval', 'ready'];
// 내용·참여자 수정. 결재가 진행됐거나 끝난 뒤 내용이 바뀌면 버전을 올리고 재결재를 요구한다.
function updateDocument(user, docId, patch, ip) {
  const d = getDoc(docId);
  mustView(user, d);
  if (d.creator_id !== user.id && !C.can(user, 'doc.view_all')) throw C.forbid('작성자만 수정할 수 있습니다');
  if (!EDITABLE.includes(d.status)) throw C.conflict(`${STATUS[d.status]} 상태의 문서는 수정할 수 없습니다. 취소 후 다시 작성하세요`);
  const tv = loadTV(d.template_version_id);
  return tx(() => {
    const before = d.content_hash;
    if (patch.title != null) run(`update documents set title=? where id=?`, String(patch.title).slice(0, 200), d.id);
    if (patch.vals) {
      const sv = { ...J(d.vals, {}) };
      for (const f of fieldsFor(tv, 'sender')) if (patch.vals[f.key] !== undefined) {
        const e = patch.vals[f.key] === '' ? null : checkValue({ ...f, required: false }, patch.vals[f.key]); if (e) throw C.bad(e);
        sv[f.key] = normValue(f, patch.vals[f.key]);
      }
      const m = metaFrom(sv);
      run(`update documents set vals=?,site=?,partner=?,amount=?,start_date=?,end_date=?,sign_deadline=? where id=?`, JSON.stringify(sv), m.site, m.partner, m.amount, m.start_date, m.end_date, m.sign_deadline, d.id);
    }
    if (patch.participants) {
      run(`delete from participants where document_id=?`, d.id);
      const roleMap = Object.fromEntries(tv.roles.map((r, i) => [r.key, { ...r, order: r.order ?? i + 1 }]));
      for (const r of tv.roles) if (!patch.participants.find((p) => p.role_key === r.key)) throw C.bad(`참여자 지정이 필요합니다: ${r.label}`);
      for (const p of patch.participants) addParticipant(d.id, roleMap, p, d.company_id);
    }
    if (patch.delivery) run(`update documents set delivery=? where id=?`, JSON.stringify(patch.delivery), d.id);
    const after = contentHash(d.id);
    run(`update documents set content_hash=?, updated_at=datetime('now') where id=?`, after, d.id);
    if (after !== before) {
      const rounds = get(`select max(round) r from approvals where target_type='document' and target_id=?`, d.id).r;
      if (rounds) {
        // 기존 승인은 재사용하지 않는다: 남은 단계는 무효 처리, 버전을 올리고 같은 결재선으로 새 차수를 연다
        const line = all(`select user_id,kind,step_no from approvals where target_type='document' and target_id=? and round=? order by step_no,id`, d.id, rounds);
        run(`update approvals set status='void' where target_type='document' and target_id=? and round=? and status='waiting'`, d.id, rounds);
        run(`update documents set version=version+1 where id=?`, d.id);
        openRound('document', d.id, d.company_id, line.map((x) => ({ user_id: x.user_id, kind: x.kind, step: x.step_no })), user, '내용 변경 후 재결재');
        C.audit({ companyId: d.company_id, documentId: d.id, actor: C.actorOf(user), action: 'REAPPROVAL_REQUIRED', detail: { reason: '결재 후 내용 또는 서명 대상 변경', prevHash: before, newHash: after }, ip });
      }
      C.audit({ companyId: d.company_id, documentId: d.id, actor: C.actorOf(user), action: 'DOC_UPDATE', detail: { prevHash: before, newHash: after }, ip });
      applyRules(d.id); syncSchedules(d.id);
    }
    return getDoc(d.id);
  });
}

// ── 결재
// 조건부 결재선: 제한된 조건(필드·연산자·값)만 허용하는 규칙. 코드 실행 없음.
const RULE_FIELDS = { amount: 'number', site: 'text', doc_type: 'text', partner: 'text', mode: 'text', template_id: 'number' };
const RULE_OPS = ['=', '!=', '>=', '<=', '>', '<', 'contains'];
function validateConditions(conds) {
  if (!Array.isArray(conds) || conds.length > 10) throw C.bad('조건은 1~10개까지입니다');
  for (const c of conds) {
    if (!RULE_FIELDS[c.field]) throw C.bad(`쓸 수 없는 조건 항목입니다: ${c.field}`);
    if (!RULE_OPS.includes(c.op)) throw C.bad(`쓸 수 없는 연산자입니다: ${c.op}`);
    if (c.value == null || String(c.value).length > 100) throw C.bad('조건 값이 올바르지 않습니다');
  }
  return conds.map((c) => ({ field: c.field, op: c.op, value: RULE_FIELDS[c.field] === 'number' ? Number(c.value) : String(c.value) }));
}
function matchCond(c, ctx) {
  const v = ctx[c.field];
  if (v == null) return false;
  switch (c.op) {
    case '=': return String(v) === String(c.value);
    case '!=': return String(v) !== String(c.value);
    case '>=': return Number(v) >= Number(c.value);
    case '<=': return Number(v) <= Number(c.value);
    case '>': return Number(v) > Number(c.value);
    case '<': return Number(v) < Number(c.value);
    case 'contains': return String(v).includes(String(c.value));
  }
  return false;
}
function ruleContext(d) { const tv = get(`select template_id from template_versions where id=?`, d.template_version_id); return { amount: d.amount, site: d.site, doc_type: d.doc_type, partner: d.partner, mode: d.mode, template_id: tv?.template_id }; }
function matchApprovalRule(d) {
  const ctx = ruleContext(d);
  for (const r of all(`select * from approval_rules where company_id=? and active=1 order by sort,id`, d.company_id)) {
    if (J(r.conditions, []).every((c) => matchCond(c, ctx))) return r;
  }
  return null;
}

function stepsFrom(companyId, { lineId, steps }) {
  let s = steps;
  if (lineId) { const l = get(`select * from approval_lines where id=? and company_id=?`, lineId, companyId); if (!l) throw C.notFound('결재선을 찾을 수 없습니다'); s = J(l.steps, []); }
  if (!Array.isArray(s) || !s.length) throw C.bad('결재선이 비어 있습니다');
  return s.map((x, i) => {
    const u = get(`select id from users where id=? and company_id=? and status='active'`, x.user_id, companyId);
    if (!u) throw C.bad(`결재자(${x.user_id})가 회사 재직자가 아닙니다`);
    return { user_id: u.id, kind: x.kind === 'reference' ? 'reference' : 'approve', step: x.step ?? i + 1 };
  });
}
function openRound(type, id, companyId, steps, user, note) {
  const round = (get(`select max(round) r from approvals where target_type=? and target_id=?`, type, id).r || 0) + 1;
  const tgt = type === 'document' ? getDoc(id) : get(`select * from bulk_jobs where id=?`, id);
  const ver = type === 'document' ? tgt.version : 1;
  const hash = type === 'document' ? tgt.content_hash : tgt.content_hash;
  let n = 0;
  for (const s of steps) {
    if (s.kind === 'approve' && s.user_id === user?.id && type === 'document' && tgt.creator_id === user.id && steps.filter((x) => x.kind === 'approve').length === 1) throw C.bad('작성자 본인만 결재하는 결재선은 쓸 수 없습니다');
    run(`insert into approvals(company_id,target_type,target_id,round,step_no,user_id,kind,status,target_version,target_hash) values(?,?,?,?,?,?,?,?,?,?)`,
      companyId, type, id, round, s.kind === 'reference' ? 0 : ++n, s.user_id, s.kind, s.kind === 'reference' ? 'reference' : 'waiting', ver, hash);
  }
  if (!n) throw C.bad('결재자(승인 단계)가 한 명 이상 필요합니다');
  if (type === 'document') run(`update documents set status='approval' where id=?`, id);
  else run(`update bulk_jobs set status='approval' where id=?`, id);
  const title = type === 'document' ? tgt.title : `[일괄] ${tgt.title}`;
  for (const r of all(`select * from approvals where target_type=? and target_id=? and round=? and kind='reference'`, type, id, round))
    C.notify({ companyId, channel: 'inapp', userId: r.user_id, subject: `[참조] ${title}`, body: link(type, id), dedupe: `ref:${r.id}` });
  notifyNextApprover(type, id, round, title, companyId);
  C.audit({ companyId, documentId: type === 'document' ? id : null, actor: C.actorOf(user), action: 'APPROVAL_SUBMIT', detail: { target: type, id, round, version: ver, hash, note } });
  return round;
}
const link = (type, id) => (type === 'document' ? `#/doc/${id}` : `#/bulk/${id}`);
function currentStep(type, id, round) {
  return get(`select * from approvals where target_type=? and target_id=? and round=? and kind='approve' and status='waiting' order by step_no limit 1`, type, id, round);
}
function notifyNextApprover(type, id, round, title, companyId) {
  const s = currentStep(type, id, round);
  if (s) C.notify({ companyId, channel: 'inapp', userId: s.user_id, subject: `[결재 대기] ${title}`, body: link(type, id), dedupe: `appr:${s.id}` });
}
function submitApproval(user, type, id, opts, ip) {
  if (type === 'document') {
    const d = getDoc(id); mustView(user, d);
    if (d.creator_id !== user.id) throw C.forbid('작성자만 결재를 올릴 수 있습니다');
    if (d.status !== 'draft') throw C.conflict('작성 중 문서만 결재를 올릴 수 있습니다');
    let o = opts;
    if (!o.lineId && !o.steps) { const r = matchApprovalRule(d); if (!r) throw C.bad('결재선을 고르세요'); o = { lineId: r.line_id }; }
    return openRound('document', id, d.company_id, stepsFrom(d.company_id, o), user);
  }
  const j = get(`select * from bulk_jobs where id=? and company_id=?`, id, user.company_id);
  if (!j || j.created_by !== user.id) throw C.forbid();
  return openRound('bulk_job', id, j.company_id, stepsFrom(j.company_id, opts), user);
}
function latestRound(type, id) { return get(`select max(round) r from approvals where target_type=? and target_id=?`, type, id).r || 0; }
function roundState(type, id) {
  const round = latestRound(type, id);
  if (!round) return { round: 0, state: 'none' };
  const rows = all(`select * from approvals where target_type=? and target_id=? and round=? and kind='approve'`, type, id, round);
  if (rows.some((r) => r.status === 'rejected')) return { round, state: 'rejected', rows };
  if (rows.every((r) => r.status === 'approved')) return { round, state: 'approved', rows };
  return { round, state: 'pending', rows };
}
function actApproval(user, approvalId, decision, comment, ip) {
  const a = get(`select * from approvals where id=?`, approvalId);
  if (!a || a.company_id !== user.company_id) throw C.notFound();
  if (a.user_id !== user.id) throw C.forbid('지정된 결재자만 처리할 수 있습니다');
  if (a.status !== 'waiting') throw C.conflict('이미 처리했거나 무효가 된 결재입니다');
  const cur = currentStep(a.target_type, a.target_id, a.round);
  if (!cur || cur.id !== a.id) throw C.conflict('앞 단계 결재가 끝나지 않았습니다');
  if (a.round !== latestRound(a.target_type, a.target_id)) throw C.conflict('지난 차수의 결재입니다');
  // 승인 대상 버전 고정: 결재 요청 이후 문서가 바뀌었으면 처리하지 않는다
  if (a.target_type === 'document') { const d = getDoc(a.target_id); if (d.content_hash !== a.target_hash) throw C.conflict('결재 요청 이후 문서가 바뀌었습니다. 새 결재 차수로 처리하세요'); }
  if (!['approve', 'reject'].includes(decision)) throw C.bad('승인 또는 반려를 고르세요');
  if (decision === 'reject' && !String(comment || '').trim()) throw C.bad('반려 사유를 적어 주세요');
  return tx(() => {
    run(`update approvals set status=?, comment=?, acted_at=datetime('now') where id=?`, decision === 'approve' ? 'approved' : 'rejected', comment || null, a.id);
    const docId = a.target_type === 'document' ? a.target_id : null;
    const title = a.target_type === 'document' ? getDoc(a.target_id).title : get(`select title from bulk_jobs where id=?`, a.target_id).title;
    const owner = a.target_type === 'document' ? getDoc(a.target_id).creator_id : get(`select created_by from bulk_jobs where id=?`, a.target_id).created_by;
    C.audit({ companyId: a.company_id, documentId: docId, actor: C.actorOf(user), action: decision === 'approve' ? 'APPROVAL_APPROVE' : 'APPROVAL_REJECT', detail: { target: a.target_type, id: a.target_id, round: a.round, step: a.step_no, comment, version: a.target_version }, ip });
    if (decision === 'reject') {
      run(`update approvals set status='void' where target_type=? and target_id=? and round=? and status='waiting'`, a.target_type, a.target_id, a.round);
      if (a.target_type === 'document') run(`update documents set status='draft' where id=?`, a.target_id); else run(`update bulk_jobs set status='validated' where id=?`, a.target_id);
      C.notify({ companyId: a.company_id, channel: 'inapp', userId: owner, subject: `[반려] ${title} — ${comment}`, body: link(a.target_type, a.target_id), dedupe: `rej:${a.id}` });
    } else if (!currentStep(a.target_type, a.target_id, a.round)) {
      if (a.target_type === 'document') run(`update documents set status='ready' where id=?`, a.target_id); else run(`update bulk_jobs set status='approved' where id=?`, a.target_id);
      C.notify({ companyId: a.company_id, channel: 'inapp', userId: owner, subject: `[결재 완료] ${title}`, body: link(a.target_type, a.target_id), dedupe: `done:${a.target_type}:${a.target_id}:${a.round}` });
    } else notifyNextApprover(a.target_type, a.target_id, a.round, title, a.company_id);
    return roundState(a.target_type, a.target_id);
  });
}

// ── 발송
function issueToken(pid, days = 14) {
  const raw = C.token(24);
  run(`update participants set token_hash=?, token_expires=? where id=?`, C.sha256(raw), Date.now() + days * 864e5, pid);
  return raw;
}
function brandOf(companyId) { const c = get(`select * from companies where id=?`, companyId); return { name: c.name, ...J(c.brand, {}) }; }

function sendDocument(actor, docId, { system = false, ip = null, dedupePrefix = null } = {}) {
  const d = getDoc(docId);
  if (!system) {
    mustView(actor, d);
    C.need(actor, d.mode === 'bulk' ? 'bulk.send' : 'doc.send');
    if (d.creator_id !== actor.id) throw C.forbid('작성자만 발송할 수 있습니다');
  }
  if (!['draft', 'ready'].includes(d.status)) throw C.conflict(`${STATUS[d.status]} 상태에서는 발송할 수 없습니다`);
  const rs = roundState('document', d.id);
  if (rs.round) {
    if (rs.state !== 'approved') throw C.conflict('내부 결재가 끝나지 않았습니다');
    if (rs.rows.some((r) => r.target_hash !== d.content_hash)) throw C.conflict('결재 후 문서가 바뀌었습니다. 재결재가 필요합니다');
  } else if (!system && matchApprovalRule(d)) throw C.conflict('이 문서는 회사 결재 규칙에 따라 내부 결재가 필요합니다');
  const tv = loadTV(d.template_version_id);
  const vals = J(d.vals, {});
  for (const f of fieldsFor(tv, 'sender')) { const e = checkValue(f, vals[f.key]); if (e) throw C.bad(e); }
  tx(() => {
    run(`update documents set status='in_progress', updated_at=datetime('now') where id=?`, d.id);
    C.audit({ companyId: d.company_id, documentId: d.id, actor: system ? { type: 'system', name: '시스템' } : C.actorOf(actor), action: 'DOC_SEND', detail: { mode: d.mode, version: d.version, hash: d.content_hash }, ip });
    C.emitEvent(d.company_id, d.id, 'document.sent', { documentId: d.id, title: d.title, version: d.version }, `sent:${d.id}`);
  });
  activateNext(d.id, { dedupePrefix });
  return getDoc(d.id);
}

// 다음 차례 참여자 활성화 (같은 순번은 동시에)
function activateNext(docId, { dedupePrefix } = {}) {
  const d = getDoc(docId);
  const waiting = all(`select * from participants where document_id=? and status='waiting' order by order_no`, docId);
  if (get(`select 1 from participants where document_id=? and status='current'`, docId)) return;
  if (!waiting.length) return completeOrReview(docId);
  const order = waiting[0].order_no;
  let sealed = false;
  for (const p of waiting.filter((x) => x.order_no === order)) {
    run(`update participants set status='current' where id=?`, p.id);
    if (p.kind === 'seal') sealed = trySeal(d, p) || sealed; else notifyParticipant(d, p, dedupePrefix);
  }
  if (sealed) return activateNext(docId, { dedupePrefix });
}
// 현재 차례 참여자에게 서명 요청 알림. 같은 알림이 이미 나갔으면 다시 보내지 않는다 (재실행·재시도 멱등).
// 대면(inperson)은 링크를 보내지 않는다 — 담당자 기기에서 참여자 확인 후 서명 세션을 연다.
// 링크계약(link)은 접수 때 받은 토큰으로 이어서 서명한다.
function notifyParticipant(d, p, dedupePrefix) {
  const pre = dedupePrefix || 'sign';
  if (p.kind === 'internal') {
    C.notify({ companyId: d.company_id, channel: 'inapp', userId: p.user_id, subject: `[서명 요청] ${d.title}`, body: `#/doc/${d.id}`, dedupe: `${pre}:inapp:${p.id}` });
    return;
  }
  if (p.kind !== 'external' || !(d.mode === 'remote' || d.mode === 'bulk')) return;
  const ch = p.email ? 'email' : p.phone ? 'sms' : null;
  if (!ch) return;
  const key = `${pre}:${ch}:${p.id}`;
  if (get(`select 1 from outbox where dedupe_key=?`, key)) return;
  const brand = brandOf(d.company_id);
  const raw = issueToken(p.id);
  const url = `${BASE_URL()}/s/${raw}`;
  const msg = `${brand.sender_name || brand.name}에서 서명을 요청했습니다.\n${brand.request_msg || ''}\n문서: ${d.title}\n서명하기: ${url}${d.sign_deadline ? `\n서명 기한: ${d.sign_deadline}` : ''}${brand.contact ? `\n문의: ${brand.contact}` : ''}`;
  C.notify({ companyId: d.company_id, channel: ch, to: ch === 'email' ? p.email : p.phone, subject: `[서명 요청] ${d.title}`, body: msg, dedupe: key, documentId: d.id });
}
function notifyCurrent(docId, dedupePrefix) {
  const d = getDoc(docId);
  for (const p of all(`select * from participants where document_id=? and status='current'`, docId)) notifyParticipant(d, p, dedupePrefix);
}

// 사전 날인: 회사가 승인한 서식·버전·사용자·조건 안에서만 자동 날인
function trySeal(d, p) {
  const tv = get(`select template_id, version from template_versions where id=?`, d.template_version_id);
  const pol = all(`select sp.*, s.image, s.status sstatus from seal_policies sp join seals s on s.id=sp.seal_id where sp.company_id=? and sp.status='approved' and sp.template_id=? and sp.template_version=?`, d.company_id, tv.template_id, tv.version)
    .find((x) => x.sstatus === 'active' && J(x.user_ids, []).includes(d.creator_id) && (x.max_amount == null || (d.amount ?? 0) <= x.max_amount));
  if (!pol) return false; // 직인 사용 권한자가 직접 날인해야 한다
  run(`update participants set status='signed', sign_image=?, sign_kind='preseal', signed_at=datetime('now'), confirm_method=? where id=?`, pol.image, `사전날인 정책 #${pol.id}`, p.id);
  run(`insert into seal_usages(company_id,seal_id,document_id,participant_id,user_id,kind,policy_id,representative_approved,note) values(?,?,?,?,?,?,?,0,?)`,
    d.company_id, pol.seal_id, d.id, p.id, d.creator_id, 'preseal', pol.id, '승인된 사전날인 정책에 따른 직인 이미지 날인 — 대표자의 개별 계약 승인 기록 아님');
  C.audit({ companyId: d.company_id, documentId: d.id, actor: { type: 'system', name: '사전날인' }, action: 'SEAL_PRESEAL', detail: { seal: pol.seal_id, policy: pol.id, representativeApproved: false } });
  C.emitEvent(d.company_id, d.id, 'participant.signed', { documentId: d.id, participant: p.role_label, kind: 'seal' }, `signed:${p.id}`);
  return true;
}

function participantView(p, d) {
  // 서명자에게 보여줄 문서: 본인 입력값 + 다른 참여자의 개인정보 항목은 가린다
  const tv = loadTV(d.template_version_id);
  const vals = { ...J(d.vals, {}) };
  for (const q of all(`select * from participants where document_id=?`, d.id)) {
    const pv = J(q.vals, {});
    for (const f of fieldsFor(tv, q.role_key)) {
      if (q.id === p.id) vals[f.key] = pv[f.key] ?? '';
      else vals[f.key] = pv[f.key] == null ? '' : (f.pii ? '●●●●' : pv[f.key]);
    }
  }
  return { body: tv.body, vals, fields: fieldsFor(tv, p.role_key) };
}

function validateParticipantInput(p, d, input) {
  const tv = loadTV(d.template_version_id);
  const out = {};
  for (const f of fieldsFor(tv, p.role_key)) {
    const e = checkValue(f, input?.[f.key]); if (e) throw C.bad(e);
    if (input?.[f.key] != null && input[f.key] !== '') out[f.key] = normValue(f, input[f.key]);
  }
  return out;
}
const PNG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

async function signParticipant(pid, { vals, image, agree, ip, ua, confirmMethod, actorUser, sealId } = {}) {
  const p = get(`select * from participants where id=?`, pid);
  const d = getDoc(p.document_id);
  if (d.status !== 'in_progress') throw C.conflict(`${STATUS[d.status]} 상태라 서명할 수 없습니다`);
  if (p.status !== 'current') throw C.conflict(p.status === 'signed' ? '이미 서명했습니다' : '아직 서명 차례가 아닙니다');
  if (agree !== true) throw C.bad('문서 내용 확인·동의가 필요합니다');
  if (p.kind === 'internal' && actorUser?.id !== p.user_id) throw C.forbid('지정된 직원 본인만 서명할 수 있습니다');
  let img = image, kind = 'draw';
  if (p.kind === 'seal') {
    if (!actorUser || !C.can(actorUser, 'seal.use')) throw C.forbid('직인 사용 권한이 필요합니다');
    const s = get(`select * from seals where id=? and company_id=? and status='active'`, sealId, d.company_id);
    if (!s) throw C.bad('사용 가능한(승인된) 직인을 고르세요');
    img = s.image; kind = 'seal';
    run(`insert into seal_usages(company_id,seal_id,document_id,participant_id,user_id,kind,representative_approved,note) values(?,?,?,?,?,'apply',0,?)`,
      d.company_id, s.id, d.id, p.id, actorUser.id, `${actorUser.name} 직인 날인 — 날인 사실 기록, 대표자 승인은 별도`);
  } else if (!PNG_RE.test(String(img || '')) || img.length > 300000) throw C.bad('서명 이미지가 올바르지 않습니다');
  if (p.kind === 'external' && p.auth_method !== 'link' && !p.verified_at && d.mode !== 'inperson') throw C.forbid('본인 인증이 먼저 필요합니다');
  const v = validateParticipantInput(p, d, vals);
  tx(() => {
    run(`update participants set status='signed', vals=?, sign_image=?, sign_kind=?, signed_at=?, ip=?, ua=?, confirm_method=coalesce(?,confirm_method), token_hash=case when ?='inperson' then null else token_hash end where id=?`,
      JSON.stringify(v), img, kind, C.now(), ip || null, String(ua || '').slice(0, 200), confirmMethod || null, d.mode, p.id);
    C.audit({ companyId: d.company_id, documentId: d.id, actor: actorUser ? C.actorOf(actorUser) : { type: 'participant', id: p.id, name: p.name }, action: kind === 'seal' ? 'SEAL_APPLY' : 'PARTICIPANT_SIGN',
      detail: { role: p.role_label, signer: p.name, mode: d.mode, confirm: confirmMethod || p.confirm_method || (p.verified_at ? p.auth_method : '서명 링크'), operator: d.mode === 'inperson' && actorUser ? actorUser.name : undefined }, ip });
    C.emitEvent(d.company_id, d.id, 'participant.signed', { documentId: d.id, participant: p.role_label, order: p.order_no }, `signed:${p.id}`);
  });
  await afterSign(d.id);
  return getDoc(d.id);
}
async function afterSign(docId) {
  activateNext(docId);
  const d = getDoc(docId);
  if (d.status === 'completed' && !d.pdf_file_id) await require('./pdf').finalize(docId);
}
function completeOrReview(docId, reviewed = false) {
  const d = getDoc(docId);
  if (d.status !== 'in_progress') return;
  const camp = !reviewed && d.link_campaign_id ? get(`select review_required from link_campaigns where id=?`, d.link_campaign_id) : null;
  if (camp?.review_required) {
    run(`update documents set status='review' where id=?`, d.id);
    C.audit({ companyId: d.company_id, documentId: d.id, action: 'REVIEW_WAIT', detail: '제출 완료 — 담당자 확인 대기' });
    return;
  }
  run(`update documents set status='completed', completed_at=datetime('now') where id=?`, d.id);
  C.audit({ companyId: d.company_id, documentId: d.id, action: 'DOC_COMPLETE', detail: { hash: d.content_hash, version: d.version } });
  C.emitEvent(d.company_id, d.id, 'document.completed', { documentId: d.id, title: d.title }, `completed:${d.id}`);
  applyRules(d.id); syncSchedules(d.id);
}
async function reviewConfirm(user, docId, ip) {
  const d = getDoc(docId); mustView(user, d);
  if (d.status !== 'review') throw C.conflict('담당자 확인 대기 문서가 아닙니다');
  run(`update documents set status='in_progress' where id=?`, d.id);
  C.audit({ companyId: d.company_id, documentId: d.id, actor: C.actorOf(user), action: 'REVIEW_CONFIRM', ip });
  completeOrReview(d.id, true);
  await afterSign(d.id);
  return getDoc(d.id);
}

function rejectParticipant(pid, reason, ip) {
  const p = get(`select * from participants where id=?`, pid);
  const d = getDoc(p.document_id);
  if (d.status !== 'in_progress' || p.status !== 'current') throw C.conflict('서명 거절을 할 수 없는 상태입니다');
  if (!String(reason || '').trim()) throw C.bad('거절 사유를 적어 주세요');
  tx(() => {
    run(`update participants set status='rejected', reject_reason=?, token_hash=null where id=?`, String(reason).slice(0, 500), p.id);
    run(`update documents set status='rejected' where id=?`, d.id);
    C.audit({ companyId: d.company_id, documentId: d.id, actor: { type: 'participant', id: p.id, name: p.name }, action: 'PARTICIPANT_REJECT', detail: { reason }, ip });
    C.emitEvent(d.company_id, d.id, 'document.rejected', { documentId: d.id, participant: p.role_label, reason }, `rejected:${d.id}`);
    if (d.creator_id) C.notify({ companyId: d.company_id, channel: 'inapp', userId: d.creator_id, subject: `[서명 거절] ${d.title} — ${p.name}: ${reason}`, body: `#/doc/${d.id}`, dedupe: `rej-p:${p.id}` });
  });
}
function cancelDocument(actor, docId, reason, { system = false, ip } = {}) {
  const d = getDoc(docId);
  if (!system) { mustView(actor, d); C.need(actor, 'doc.cancel'); }
  if (['completed', 'cancelled'].includes(d.status)) throw C.conflict(`${STATUS[d.status]} 문서는 취소할 수 없습니다`);
  tx(() => {
    run(`update documents set status='cancelled', cancelled_reason=? where id=?`, String(reason || '').slice(0, 500) || null, d.id);
    run(`update participants set token_hash=null where document_id=?`, d.id);
    run(`update approvals set status='void' where target_type='document' and target_id=? and status='waiting'`, d.id);
    C.audit({ companyId: d.company_id, documentId: d.id, actor: system ? { type: 'api', name: actor?.name || 'API' } : C.actorOf(actor), action: 'DOC_CANCEL', detail: { reason }, ip });
    C.emitEvent(d.company_id, d.id, 'document.cancelled', { documentId: d.id, reason: reason || null }, `cancelled:${d.id}`);
  });
  return getDoc(d.id);
}
function expireOverdue() {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  for (const d of all(`select * from documents where status='in_progress' and sign_deadline is not null and sign_deadline < ?`, today)) {
    run(`update documents set status='expired' where id=?`, d.id);
    run(`update participants set token_hash=null where document_id=?`, d.id);
    C.audit({ companyId: d.company_id, documentId: d.id, action: 'DOC_EXPIRE', detail: { deadline: d.sign_deadline } });
    C.emitEvent(d.company_id, d.id, 'document.expired', { documentId: d.id, deadline: d.sign_deadline }, `expired:${d.id}`);
  }
}

// ── 자동 분류 (보는 방법만 바꾼다. 권한과 무관)
const CLASS_FIELDS = { site: 'text', doc_type: 'text', partner: 'text', amount: 'number', status: 'text', end_within_days: 'number', title: 'text' };
function validateClassRule(cond, action) {
  if (!Array.isArray(cond) || !cond.length || cond.length > 10) throw C.bad('조건을 1~10개 넣으세요');
  const c2 = cond.map((c) => {
    if (!CLASS_FIELDS[c.field]) throw C.bad(`쓸 수 없는 조건 항목: ${c.field}`);
    if (!RULE_OPS.includes(c.op)) throw C.bad(`쓸 수 없는 연산자: ${c.op}`);
    return { field: c.field, op: c.op, value: CLASS_FIELDS[c.field] === 'number' ? Number(c.value) : String(c.value ?? '') };
  });
  const a = {};
  if (action?.folder) a.folder = String(action.folder).slice(0, 50);
  if (action?.tag) a.tag = String(action.tag).slice(0, 30);
  if (!a.folder && !a.tag) throw C.bad('폴더 또는 태그를 지정하세요');
  return { cond: c2, action: a };
}
function applyRules(docId) {
  const d = getDoc(docId);
  run(`delete from doc_folders where document_id=? and source='rule'`, d.id);
  run(`delete from doc_tags where document_id=? and source='rule'`, d.id);
  const today = Date.parse(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
  const ctx = { ...d, end_within_days: d.end_date ? Math.round((Date.parse(d.end_date) - today) / 864e5) : null };
  for (const r of all(`select * from class_rules where company_id=? and active=1 order by sort,id`, d.company_id)) {
    const cond = J(r.cond, []);
    const ok = cond.every((c) => (c.field === 'end_within_days' ? ctx.end_within_days != null && ctx.end_within_days >= 0 && ctx.end_within_days <= Number(c.value) : matchCond(c, ctx)));
    if (!ok) continue;
    const a = J(r.action, {});
    if (a.folder) {
      run(`insert or ignore into folders(company_id,name) values(?,?)`, d.company_id, a.folder);
      const f = get(`select id from folders where company_id=? and name=?`, d.company_id, a.folder);
      run(`insert or ignore into doc_folders(document_id,folder_id,source) values(?,?,'rule')`, d.id, f.id);
    }
    if (a.tag) run(`insert or ignore into doc_tags(document_id,tag,source) values(?,?,'rule')`, d.id, a.tag);
  }
}

// ── 일정: 계약 데이터에서 자동으로 가져오고, 담당자가 고친 값은 덮어쓰지 않는다
function addDays(s, n) { const t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function syncSchedules(docId) {
  const d = getDoc(docId);
  if (['cancelled'].includes(d.status)) return;
  const c = get(`select settings from companies where id=?`, d.company_id);
  const renewalDays = J(c.settings, {}).renewal_days ?? 30;
  const want = [];
  if (d.sign_deadline && !['completed'].includes(d.status)) want.push(['sign_deadline', '서명 마감', d.sign_deadline]);
  if (d.start_date) want.push(['start', '계약 시작', d.start_date]);
  if (d.end_date) { want.push(['end', '계약 종료', d.end_date]); want.push(['renewal', '갱신 검토', addDays(d.end_date, -renewalDays)]); }
  for (const [kind, title, date] of want) {
    const s = get(`select * from schedules where document_id=? and kind=?`, d.id, kind);
    if (!s) run(`insert into schedules(company_id,document_id,kind,title,date,source) values(?,?,?,?,?,'auto')`, d.company_id, d.id, kind, title, date);
    else if (s.source === 'auto' && s.date !== date) {
      run(`update schedules set date=?, updated_at=datetime('now') where id=?`, date, s.id);
      run(`insert into schedule_history(schedule_id,changed_by,before_v,after_v) values(?,?,?,?)`, s.id, null, s.date, date);
    }
  }
}

module.exports = {
  STATUS, BASE_URL, loadTV, currentTV, canUseTemplate, checkValue, fieldsFor, contentHash, createDocument, getDoc, canViewDoc, viewableSql, mustView,
  updateDocument, RULE_FIELDS, RULE_OPS, validateConditions, matchApprovalRule, submitApproval, actApproval, roundState, latestRound, openRound,
  issueToken, sendDocument, activateNext, notifyCurrent, participantView, signParticipant, rejectParticipant, cancelDocument, expireOverdue, reviewConfirm, afterSign,
  brandOf, CLASS_FIELDS, validateClassRule, applyRules, syncSchedules, addDays, PNG_RE, validateParticipantInput,
};
