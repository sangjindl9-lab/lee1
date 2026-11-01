// 직원용 API (로그인 세션)
const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const QRCode = require('qrcode');
const { all, get, run, tx, J } = require('../db');
const C = require('../core');
const E = require('../engine');
const F = require('../files');
const P = require('../pdf');
const Q = require('../queue');
const wrap = require('../wrap');

const r = express.Router();
const ip = (req) => req.ip;
const int = (v) => (v == null || v === '' ? null : Number.parseInt(v, 10));
const str = (v, n = 200) => (v == null ? null : String(v).trim().slice(0, n) || null);
const ownCompany = (u, row) => { if (!row || row.company_id !== u.company_id) throw C.notFound(); return row; };

// ── 내 정보
r.get('/me', (req, res) => {
  const u = req.user; const c = get(`select * from companies where id=?`, u.company_id);
  res.json({
    user: { id: u.id, name: u.name, email: u.email, role: u.role, dept_id: u.dept_id, perms: [...C.userPerms(u)] },
    company: { id: c.id, name: c.name, brand: J(c.brand, {}), settings: J(c.settings, {}) },
    unread: get(`select count(*) n from inbox where user_id=? and read_at is null`, u.id).n,
    approvalsWaiting: all(`select a.* from approvals a where a.user_id=? and a.status='waiting'`, u.id).filter((a) => E.roundState(a.target_type, a.target_id).round === a.round).length,
    perms: C.PERMS, status: E.STATUS,
  });
});
r.post('/me/password', wrap(async (req, res) => {
  const u = req.user;
  if (!C.checkPw(String(req.body.current || ''), u.pw_hash)) throw C.bad('현재 비밀번호가 맞지 않습니다');
  if (String(req.body.next || '').length < 8) throw C.bad('새 비밀번호는 8자 이상입니다');
  run(`update users set pw_hash=? where id=?`, C.hashPw(req.body.next), u.id);
  C.audit({ companyId: u.company_id, actor: C.actorOf(u), action: 'PASSWORD_CHANGE', ip: ip(req) });
  res.json({ ok: true });
}));
// 대면계약 기기 잠금 해제 (기기를 서명자에게 넘긴 뒤 담당자 화면으로 돌아올 때)
r.post('/me/verify-password', (req, res) => {
  if (!C.checkPw(String(req.body.password || ''), req.user.pw_hash)) { C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'UNLOCK_FAIL', ip: ip(req) }); throw C.bad('비밀번호가 맞지 않습니다'); }
  run(`update sessions set locked=0 where token_hash=?`, req.user._session); res.json({ ok: true });
});
r.get('/inbox', (req, res) => res.json(all(`select * from inbox where user_id=? order by id desc limit 100`, req.user.id)));
r.post('/inbox/read', (req, res) => { run(`update inbox set read_at=datetime('now') where user_id=? and read_at is null`, req.user.id); res.json({ ok: true }); });

// ── 조직·멤버
r.get('/org', (req, res) => {
  const cid = req.user.company_id;
  res.json({
    users: all(`select id,name,email,role,dept_id,status,phone,perms,retired_at from users where company_id=? order by status, name`, cid).map((u) => ({ ...u, perms: [...C.userPerms(u)], custom: J(u.perms, []).length > 0 })),
    depts: all(`select * from departments where company_id=? order by id`, cid),
    groups: all(`select g.*, (select json_group_array(user_id) from group_members m where m.group_id=g.id) members from groups_ g where company_id=?`, cid).map((g) => ({ ...g, members: J(g.members, []) })),
    roles: C.ROLE_PRESETS,
  });
});
r.post('/users', wrap(async (req, res) => {
  C.need(req.user, 'org.manage');
  const b = req.body;
  const email = String(b.email || '').trim().toLowerCase();
  if (!C.EMAIL_RE.test(email) || !str(b.name)) throw C.bad('이름과 이메일을 확인하세요');
  if (String(b.password || '').length < 8) throw C.bad('초기 비밀번호는 8자 이상입니다');
  if (get(`select 1 from users where email=?`, email)) throw C.conflict('이미 쓰는 이메일입니다');
  const role = ['admin', 'manager', 'member'].includes(b.role) ? b.role : 'member';
  if (b.dept_id) ownCompany(req.user, get(`select * from departments where id=?`, b.dept_id));
  const id = Number(run(`insert into users(company_id,dept_id,email,name,pw_hash,role,phone) values(?,?,?,?,?,?,?)`, req.user.company_id, int(b.dept_id), email, str(b.name, 50), C.hashPw(b.password), role, str(b.phone, 20)).lastInsertRowid);
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'USER_CREATE', detail: { id, email, role }, ip: ip(req) });
  res.status(201).json({ id });
}));
r.put('/users/:id', wrap(async (req, res) => {
  C.need(req.user, 'org.manage');
  const u = ownCompany(req.user, get(`select * from users where id=?`, req.params.id));
  const b = req.body;
  const role = ['admin', 'manager', 'member'].includes(b.role) ? b.role : u.role;
  let perms = u.perms;
  if (Array.isArray(b.perms)) perms = JSON.stringify(b.perms.filter((p) => C.PERMS[p]));
  if (b.resetPerms) perms = '[]';
  if (u.id === req.user.id && (role !== 'admin' || (perms !== '[]' && !J(perms, []).includes('org.manage')))) throw C.bad('본인의 조직 관리 권한은 뺄 수 없습니다');
  if (b.dept_id) ownCompany(req.user, get(`select * from departments where id=?`, b.dept_id));
  run(`update users set name=coalesce(?,name), role=?, perms=?, dept_id=? where id=?`, str(b.name, 50), role, perms, b.dept_id === undefined ? u.dept_id : int(b.dept_id), u.id);
  C.audit({ companyId: u.company_id, actor: C.actorOf(req.user), action: 'USER_UPDATE', detail: { id: u.id, role, perms: J(perms, []) }, ip: ip(req) });
  res.json({ ok: true });
}));
// 퇴사 처리: 로그인·API 차단, 문서·이력은 그대로 두고 담당자를 인계
r.post('/users/:id/retire', wrap(async (req, res) => {
  C.need(req.user, 'org.manage');
  const u = ownCompany(req.user, get(`select * from users where id=?`, req.params.id));
  if (u.id === req.user.id) throw C.bad('본인은 퇴사 처리할 수 없습니다');
  const to = ownCompany(req.user, get(`select * from users where id=? and status='active'`, req.body.handover_to));
  if (to.id === u.id) throw C.bad('인계받을 직원을 고르세요');
  const counts = tx(() => {
    run(`update users set status='retired', retired_at=datetime('now') where id=?`, u.id);
    run(`delete from sessions where user_id=?`, u.id);
    run(`update api_keys set revoked_at=datetime('now') where created_by=? and revoked_at is null`, u.id);
    const docs = run(`update documents set creator_id=? where creator_id=? and company_id=?`, to.id, u.id, u.company_id).changes;
    const tpls = run(`update templates set owner_id=? where owner_id=? and company_id=?`, to.id, u.id, u.company_id).changes;
    const appr = run(`update approvals set user_id=? where user_id=? and status='waiting' and company_id=?`, to.id, u.id, u.company_id).changes;
    const ps = run(`update participants set user_id=?, name=? where user_id=? and status in ('waiting','current')`, to.id, to.name, u.id).changes;
    return { docs, tpls, appr, ps };
  });
  C.audit({ companyId: u.company_id, actor: C.actorOf(req.user), action: 'USER_RETIRE', detail: { id: u.id, name: u.name, handoverTo: to.name, ...counts }, ip: ip(req) });
  res.json({ ok: true, ...counts });
}));
r.post('/depts', wrap(async (req, res) => { C.need(req.user, 'org.manage'); const n = str(req.body.name, 50); if (!n) throw C.bad('부서명을 입력하세요'); res.status(201).json({ id: Number(run(`insert into departments(company_id,name) values(?,?)`, req.user.company_id, n).lastInsertRowid) }); }));
r.post('/groups', wrap(async (req, res) => {
  C.need(req.user, 'org.manage');
  const n = str(req.body.name, 50); if (!n) throw C.bad('그룹명을 입력하세요');
  const id = Number(run(`insert into groups_(company_id,name) values(?,?)`, req.user.company_id, n).lastInsertRowid);
  for (const uid of req.body.members || []) { ownCompany(req.user, get(`select * from users where id=?`, uid)); run(`insert or ignore into group_members(group_id,user_id) values(?,?)`, id, uid); }
  res.status(201).json({ id });
}));

// ── 템플릿
const tplRow = (t, u) => ({ ...t, mine: t.owner_id === u.id, owner: get(`select name from users where id=?`, t.owner_id)?.name, shares: all(`select target_type,target_id from template_shares where template_id=?`, t.id) });
r.get('/templates', (req, res) => {
  const u = req.user;
  res.json(all(`select * from templates where company_id=? and archived=0 order by scope desc, name`, u.company_id).filter((t) => E.canUseTemplate(u, t) || C.can(u, 'template.share')).map((t) => ({ ...tplRow(t, u), usable: E.canUseTemplate(u, t) })));
});
r.get('/templates/:id', (req, res) => {
  const t = ownCompany(req.user, get(`select * from templates where id=?`, req.params.id));
  if (!E.canUseTemplate(req.user, t) && !C.can(req.user, 'template.share')) throw C.forbid();
  const tv = E.currentTV(t.id);
  res.json({ ...tplRow(t, req.user), version: tv, versions: all(`select id,version,created_at from template_versions where template_id=? order by version desc`, t.id) });
});
function checkTplInput(b) {
  const roles = Array.isArray(b.roles) ? b.roles : [];
  const fields = Array.isArray(b.fields) ? b.fields : [];
  if (!str(b.name)) throw C.bad('템플릿 이름을 입력하세요');
  if (!roles.length || roles.length > 10) throw C.bad('참여자 역할을 1~10개 정하세요');
  const keys = new Set();
  const R = roles.map((x, i) => {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(x.key || '')) throw C.bad('역할 키는 영문 소문자로 시작해야 합니다');
    if (keys.has(x.key)) throw C.bad('역할 키가 겹칩니다'); keys.add(x.key);
    return { key: x.key, label: str(x.label, 30) || x.key, kind: ['external', 'internal', 'seal'].includes(x.kind) ? x.kind : 'external', order: int(x.order) || i + 1 };
  });
  const fk = new Set();
  const Fs = fields.map((x) => {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(x.key || '')) throw C.bad(`항목 키 "${x.key}"는 영문 소문자로 시작해야 합니다`);
    if (fk.has(x.key)) throw C.bad(`항목 키가 겹칩니다: ${x.key}`); fk.add(x.key);
    const owner = x.owner || 'sender';
    if (owner !== 'sender' && !keys.has(owner)) throw C.bad(`항목 "${x.label}"의 작성자 역할이 없습니다`);
    return { key: x.key, label: str(x.label, 50) || x.key, type: ['text', 'textarea', 'number', 'date', 'email', 'phone', 'check'].includes(x.type) ? x.type : 'text', required: !!x.required, owner, pii: !!x.pii, scope: x.scope === 'common' ? 'common' : 'each' };
  });
  const body = String(b.body || '');
  if (!body.trim() || body.length > 50000) throw C.bad('본문을 입력하세요');
  for (const m of body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) if (!fk.has(m[1])) throw C.bad(`본문의 {{${m[1]}}} 항목이 정의되지 않았습니다`);
  return { roles: R, fields: Fs, body, attachments: { photo: !!b.attachments?.photo, drawing: !!b.attachments?.drawing } };
}
r.post('/templates', wrap(async (req, res) => {
  C.need(req.user, 'template.edit');
  const v = checkTplInput(req.body);
  let baseFile = null;
  if (req.body.base_file_id) baseFile = ownCompany(req.user, get(`select * from files where id=?`, req.body.base_file_id)).id;
  const id = require('../seed').createTemplate(req.user.company_id, req.user.id, { name: str(req.body.name), doc_type: str(req.body.doc_type, 50), ...v }, 'personal');
  if (baseFile) run(`update template_versions set base_file_id=? where template_id=?`, baseFile, id);
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'TEMPLATE_CREATE', detail: { id }, ip: ip(req) });
  res.status(201).json({ id });
}));
// 수정은 새 버전을 만든다 (이미 쓰인 버전은 바뀌지 않음)
r.put('/templates/:id', wrap(async (req, res) => {
  C.need(req.user, 'template.edit');
  const t = ownCompany(req.user, get(`select * from templates where id=?`, req.params.id));
  if (t.owner_id !== req.user.id && !(t.scope === 'company' && C.can(req.user, 'template.share'))) throw C.forbid('이 템플릿을 고칠 권한이 없습니다');
  const v = checkTplInput({ ...req.body, name: req.body.name || t.name });
  const ver = t.current_version + 1;
  tx(() => {
    run(`insert into template_versions(template_id,version,body,fields,roles,attachments_spec,created_by) values(?,?,?,?,?,?,?)`, t.id, ver, v.body, JSON.stringify(v.fields), JSON.stringify(v.roles), JSON.stringify(v.attachments), req.user.id);
    run(`update templates set current_version=?, name=?, doc_type=? where id=?`, ver, str(req.body.name) || t.name, str(req.body.doc_type, 50) ?? t.doc_type, t.id);
  });
  C.audit({ companyId: t.company_id, actor: C.actorOf(req.user), action: 'TEMPLATE_VERSION', detail: { id: t.id, version: ver }, ip: ip(req) });
  res.json({ version: ver });
}));
r.post('/templates/:id/share', wrap(async (req, res) => {
  C.need(req.user, 'template.share');
  const t = ownCompany(req.user, get(`select * from templates where id=?`, req.params.id));
  const scope = req.body.scope === 'company' ? 'company' : 'personal';
  tx(() => {
    run(`update templates set scope=? where id=?`, scope, t.id);
    run(`delete from template_shares where template_id=?`, t.id);
    for (const s of req.body.shares || []) {
      if (!['dept', 'group', 'user'].includes(s.target_type)) continue;
      const tbl = { dept: 'departments', group: 'groups_', user: 'users' }[s.target_type];
      ownCompany(req.user, get(`select company_id from ${tbl} where id=?`, s.target_id));
      run(`insert or ignore into template_shares values(?,?,?)`, t.id, s.target_type, s.target_id);
    }
  });
  C.audit({ companyId: t.company_id, actor: C.actorOf(req.user), action: 'TEMPLATE_SHARE', detail: { id: t.id, scope, shares: req.body.shares || [] }, ip: ip(req) });
  res.json({ ok: true });
}));
r.post('/templates/:id/archive', wrap(async (req, res) => {
  const t = ownCompany(req.user, get(`select * from templates where id=?`, req.params.id));
  if (t.owner_id !== req.user.id && !C.can(req.user, 'template.share')) throw C.forbid();
  run(`update templates set archived=1 where id=?`, t.id); res.json({ ok: true });
}));

// ── 파일 (로컬 업로드: 올린 순간의 내용을 복사해 고정)
r.post('/files', wrap(async (req, res) => {
  const id = F.fromDataUrl(req.user.company_id, req.body.dataUrl, req.body.name, { origin: 'upload' });
  const f = get(`select id,name,mime,size,sha256 from files where id=?`, id);
  res.status(201).json(f);
}));
// 클라우드 가져오기: 공급자별 연결 모듈. 연결 정보가 없으면 미연동으로 표시한다.
const CLOUD = { google_drive: ['구글 드라이브', 'GOOGLE_CLIENT_ID'], onedrive: ['원드라이브', 'MS_CLIENT_ID'], dropbox: ['드롭박스', 'DROPBOX_APP_KEY'] };
r.get('/cloud/providers', (req, res) => res.json(Object.entries(CLOUD).map(([k, [n, env]]) => ({ key: k, name: n, connected: !!process.env[env] }))));
r.post('/cloud/:provider/import', wrap(async (req, res) => {
  const p = CLOUD[req.params.provider]; if (!p) throw C.notFound();
  if (!process.env[p[1]]) return res.status(501).json({ error: `${p[0]}는 아직 연동되지 않았습니다. 파일을 내려받아 직접 올려 주세요.` });
  res.status(501).json({ error: `${p[0]} 가져오기 모듈은 연결 정보 등록 후 활성화됩니다` });
}));
function fileOk(u, id) { return ownCompany(u, get(`select * from files where id=?`, id)); }

// ── 문서 목록·검색
r.get('/documents', (req, res) => {
  const u = req.user, q = req.query;
  const w = [E.viewableSql(u)], p = [];
  if (q.status) { w.push(`d.status=?`); p.push(q.status); }
  if (q.mode) { w.push(`d.mode=?`); p.push(q.mode); }
  for (const k of ['site', 'partner', 'doc_type']) if (q[k]) { w.push(`d.${k}=?`); p.push(q[k]); }
  if (q.dept_id) { w.push(`d.dept_id=?`); p.push(int(q.dept_id)); }
  if (q.owner) { w.push(`d.creator_id=?`); p.push(int(q.owner)); }
  if (q.q) { w.push(`(d.title like ? or d.partner like ? or d.site like ? or exists(select 1 from participants x where x.document_id=d.id and x.name like ?))`); const s = `%${q.q}%`; p.push(s, s, s, s); }
  if (q.amin) { w.push(`d.amount>=?`); p.push(Number(q.amin)); }
  if (q.amax) { w.push(`d.amount<=?`); p.push(Number(q.amax)); }
  if (q.from) { w.push(`d.end_date>=?`); p.push(q.from); }
  if (q.to) { w.push(`d.start_date<=?`); p.push(q.to); }
  if (q.tag) { w.push(`exists(select 1 from doc_tags t where t.document_id=d.id and t.tag=?)`); p.push(q.tag); }
  if (q.folder) { w.push(`exists(select 1 from doc_folders f where f.document_id=d.id and f.folder_id=?)`); p.push(int(q.folder)); }
  if (q.renewal) { w.push(`exists(select 1 from schedules s where s.document_id=d.id and s.kind='renewal' and s.done=0 and s.date<=date('now','+${Math.min(int(q.renewal) || 30, 365)} days'))`); }
  if (q.bulk) { w.push(`d.bulk_job_id=?`); p.push(int(q.bulk)); }
  if (q.link) { w.push(`d.link_campaign_id=?`); p.push(int(q.link)); }
  const limit = Math.min(int(q.limit) || 100, 500), offset = int(q.offset) || 0;
  const rows = all(`select d.*, (select name from users where id=d.creator_id) creator_name,
      (select group_concat(name, ', ') from participants where document_id=d.id and kind!='seal') parties,
      (select group_concat(tag, ',') from doc_tags where document_id=d.id) tags
    from documents d where ${w.join(' and ')} order by d.id desc limit ${limit} offset ${offset}`, ...p);
  const total = get(`select count(*) n from documents d where ${w.join(' and ')}`, ...p).n;
  res.json({ total, rows });
});
r.get('/documents/facets', (req, res) => {
  const v = E.viewableSql(req.user);
  const col = (c) => all(`select distinct ${c} v from documents d where ${v} and ${c} is not null order by 1`).map((x) => x.v);
  res.json({
    sites: col('site'), partners: col('partner'), doc_types: col('doc_type'),
    tags: all(`select tag, count(*) n from doc_tags t join documents d on d.id=t.document_id where ${v} group by tag order by tag`),
    // 폴더 이름은 회사 공통, 개수는 내가 볼 수 있는 문서만 센다
    folders: all(`select f.id, f.name, (select count(*) from doc_folders x join documents d on d.id=x.document_id where x.folder_id=f.id and ${v}) n from folders f where f.company_id=? order by name`, req.user.company_id),
  });
});

function docDetail(u, d) {
  const tv = E.loadTV(d.template_version_id);
  const ps = all(`select id,order_no,role_key,role_label,kind,user_id,name,email,phone,status,auth_method,verified_at,confirm_method,confirmed_by,vals,sign_kind,signed_at,viewed_at,ip,reject_reason,delivery from participants where document_id=? order by order_no,id`, d.id)
    .map((p) => ({ ...p, vals: J(p.vals, {}), signed: !!p.signed_at }));
  const rounds = all(`select a.*, u.name user_name from approvals a join users u on u.id=a.user_id where target_type='document' and target_id=? order by round, step_no, id`, d.id);
  const rs = E.roundState('document', d.id);
  return {
    doc: { ...d, vals: J(d.vals, {}), delivery: J(d.delivery, {}), status_label: E.STATUS[d.status] }, template: { id: tv.template_id, name: tv.template_name, version: tv.version, fields: tv.fields, roles: tv.roles, body: tv.body, attachments: tv.attachments_spec },
    participants: ps, approvals: rounds, approval: { round: rs.round, state: rs.state, ruleRequired: !rs.round && !!E.matchApprovalRule(d) },
    attachments: all(`select a.id,a.kind,a.caption,a.sort,f.name,f.mime,f.size,f.sha256 from doc_attachments a join files f on f.id=a.file_id where a.document_id=? order by a.sort,a.id`, d.id),
    base_file: d.base_file_id ? get(`select id,name,mime,size,sha256,origin from files where id=?`, d.base_file_id) : null,
    audit: all(`select id,actor_type,actor_name,action,detail,ip,at,hash from audit_logs where document_id=? order by id`, d.id),
    schedules: all(`select * from schedules where document_id=? order by date`, d.id).map((s) => ({ ...s, remind_days: J(s.remind_days, []), recipients: J(s.recipients, []), channels: J(s.channels, []) })),
    folders: all(`select f.id,f.name,x.source from doc_folders x join folders f on f.id=x.folder_id where x.document_id=?`, d.id),
    tags: all(`select tag,source from doc_tags where document_id=?`, d.id),
    seal_usages: all(`select s.*, (select name from seals where id=s.seal_id) seal_name, (select name from users where id=s.user_id) user_name from seal_usages s where document_id=?`, d.id),
    can: {
      edit: ['draft', 'approval', 'ready'].includes(d.status) && (d.creator_id === u.id), send: ['draft', 'ready'].includes(d.status) && d.creator_id === u.id && C.can(u, 'doc.send'),
      cancel: !['completed', 'cancelled'].includes(d.status) && C.can(u, 'doc.cancel'), submitApproval: d.status === 'draft' && d.creator_id === u.id,
    },
    creator: get(`select id,name from users where id=?`, d.creator_id),
  };
}
r.get('/documents/:id', (req, res) => { const d = E.getDoc(req.params.id); E.mustView(req.user, d); res.json(docDetail(req.user, d)); });

// 비대면·대면 계약 문서 만들기 (링크·대량은 각자 메뉴에서 같은 엔진으로 만든다)
r.post('/documents', wrap(async (req, res) => {
  const b = req.body, u = req.user;
  if (!['remote', 'inperson'].includes(b.mode)) throw C.bad('비대면 또는 대면 방식을 고르세요');
  const t = ownCompany(u, get(`select * from templates where id=?`, b.template_id));
  const tv = E.currentTV(t.id);
  const attachments = (b.attachments || []).map((a) => ({ file_id: fileOk(u, a.file_id).id, kind: ['photo', 'drawing', 'other'].includes(a.kind) ? a.kind : 'other', caption: str(a.caption, 100) }));
  const id = E.createDocument({ companyId: u.company_id, user: u, tvId: tv.id, title: b.title, mode: b.mode, vals: b.vals || {}, participants: b.participants || [], baseFileId: b.base_file_id ? fileOk(u, b.base_file_id).id : (tv.base_file_id || null), attachments, delivery: b.delivery || {}, ip: ip(req) });
  res.status(201).json({ id });
}));
r.put('/documents/:id', wrap(async (req, res) => { res.json(E.updateDocument(req.user, Number(req.params.id), req.body, ip(req))); }));
r.post('/documents/:id/attachments', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  if (!['draft', 'approval', 'ready'].includes(d.status) || d.creator_id !== req.user.id) throw C.conflict('작성 단계 문서에만 첨부를 바꿀 수 있습니다');
  const fid = req.body.file_id ? fileOk(req.user, req.body.file_id).id : F.fromDataUrl(d.company_id, req.body.dataUrl, req.body.name);
  const sort = (get(`select max(sort) m from doc_attachments where document_id=?`, d.id).m ?? -1) + 1;
  run(`insert into doc_attachments(document_id,file_id,kind,caption,sort,added_by) values(?,?,?,?,?,?)`, d.id, fid, ['photo', 'drawing', 'other'].includes(req.body.kind) ? req.body.kind : 'other', str(req.body.caption, 100), sort, req.user.name);
  res.status(201).json({ ok: true, reapproval: rehash(req.user, d.id) });
}));
r.delete('/documents/:id/attachments/:aid', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  if (!['draft', 'approval', 'ready'].includes(d.status) || d.creator_id !== req.user.id) throw C.conflict('작성 단계 문서에만 첨부를 바꿀 수 있습니다');
  run(`delete from doc_attachments where id=? and document_id=?`, req.params.aid, d.id);
  res.json({ ok: true, reapproval: rehash(req.user, d.id) });
}));
// 첨부가 바뀌면 내용 해시가 바뀐다 → updateDocument 가 재결재 규칙을 적용
function rehash(u, id) { const before = E.getDoc(id).version; E.updateDocument(u, id, { __touch: 1 }); return E.getDoc(id).version !== before; }
r.get('/documents/:id/attachments/:aid', (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  const a = get(`select * from doc_attachments where id=? and document_id=?`, req.params.aid, d.id); if (!a) throw C.notFound();
  const f = F.readFile(a.file_id); res.set({ 'content-type': f.mime, 'cache-control': 'private, max-age=60' }); res.send(f.buf);
});
r.get('/documents/:id/base', (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d); if (!d.base_file_id) throw C.notFound();
  const f = F.readFile(d.base_file_id); res.set({ 'content-type': f.mime }); res.send(f.buf);
});
r.post('/documents/:id/approval', wrap(async (req, res) => {
  res.json({ round: E.submitApproval(req.user, 'document', Number(req.params.id), { lineId: int(req.body.line_id), steps: req.body.steps }, ip(req)) });
}));
r.post('/documents/:id/send', wrap(async (req, res) => {
  const d = E.sendDocument(req.user, Number(req.params.id), { ip: ip(req) });
  await E.afterSign(d.id);
  res.json(docDetail(req.user, E.getDoc(d.id)));
}));
r.post('/documents/:id/cancel', wrap(async (req, res) => { E.cancelDocument(req.user, Number(req.params.id), req.body.reason, { ip: ip(req) }); res.json({ ok: true }); }));
r.post('/documents/:id/review-confirm', wrap(async (req, res) => { res.json(await E.reviewConfirm(req.user, Number(req.params.id), ip(req))); }));
// 내부 참여자(로그인 직원) 서명 · 직인 날인
r.post('/documents/:id/sign', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  const p = get(`select * from participants where id=? and document_id=?`, req.body.participant_id, d.id);
  if (!p || p.kind === 'external') throw C.bad('직원이 서명할 수 있는 참여자가 아닙니다');
  await E.signParticipant(p.id, { vals: req.body.vals, image: req.body.image, agree: req.body.agree, ip: ip(req), ua: req.headers['user-agent'], confirmMethod: p.kind === 'seal' ? '직인 사용 권한자 날인' : '로그인 직원 본인', actorUser: req.user, sealId: int(req.body.seal_id) });
  res.json(docDetail(req.user, E.getDoc(d.id)));
}));

// ── 대면계약: 담당자 화면에서 참여자 확인 후, 그 참여자만 쓰는 1회용 서명 세션을 연다
const CONFIRM_METHODS = ['신분증 대조(담당자 확인)', '휴대폰 인증번호', '사전 등록 정보 대조', '본인 진술(신원 미확인)'];
r.post('/documents/:id/inperson/start', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  if (d.mode !== 'inperson') throw C.bad('대면계약 문서가 아닙니다');
  if (d.creator_id !== req.user.id && !C.can(req.user, 'doc.send')) throw C.forbid();
  if (d.status !== 'in_progress') throw C.conflict('서명 진행 중인 문서가 아닙니다');
  const p = get(`select * from participants where id=? and document_id=?`, req.body.participant_id, d.id);
  if (!p || p.kind !== 'external') throw C.bad('외부 참여자를 고르세요');
  if (p.status !== 'current') throw C.conflict(p.status === 'signed' ? '이미 서명한 참여자입니다' : '아직 이 참여자의 차례가 아닙니다');
  const method = CONFIRM_METHODS.includes(req.body.confirm_method) ? req.body.confirm_method : null;
  if (!method) throw C.bad('참여자 확인 방법을 고르세요');
  // 같은 기기에서 이전 참여자의 세션이 남지 않도록, 이 문서의 다른 서명 세션은 모두 닫는다
  run(`update participants set token_hash=null where document_id=? and id!=?`, d.id, p.id);
  const raw = E.issueToken(p.id, 1 / 48); // 30분
  run(`update sessions set locked=1 where token_hash=?`, req.user._session);
  run(`update participants set verified_at=datetime('now'), confirm_method=?, confirmed_by=? where id=?`, `${method} (확인 담당자 ${req.user.name})`, req.user.id, p.id);
  C.audit({ companyId: d.company_id, documentId: d.id, actor: C.actorOf(req.user), action: 'INPERSON_IDENTIFY', detail: { participant: p.name, role: p.role_label, method, note: str(req.body.note, 200) }, ip: ip(req) });
  res.json({ url: `/s/${raw}?inperson=1`, expiresInMin: 30 });
}));
r.get('/inperson/confirm-methods', (req, res) => res.json(CONFIRM_METHODS));

// ── 결재선·결재
r.get('/approval-lines', (req, res) => res.json(all(`select * from approval_lines where company_id=? order by id`, req.user.company_id).map((l) => ({ ...l, steps: J(l.steps, []).map((s) => ({ ...s, name: get(`select name from users where id=?`, s.user_id)?.name })) }))));
r.post('/approval-lines', wrap(async (req, res) => {
  const name = str(req.body.name, 50); if (!name) throw C.bad('결재선 이름을 입력하세요');
  const steps = req.body.steps || [];
  if (!steps.filter((s) => s.kind !== 'reference').length) throw C.bad('결재자를 한 명 이상 넣으세요');
  for (const s of steps) ownCompany(req.user, get(`select * from users where id=? and status='active'`, s.user_id));
  res.status(201).json({ id: Number(run(`insert into approval_lines(company_id,name,steps,created_by) values(?,?,?,?)`, req.user.company_id, name, JSON.stringify(steps.map((s) => ({ user_id: s.user_id, kind: s.kind === 'reference' ? 'reference' : 'approve' }))), req.user.id).lastInsertRowid) });
}));
r.delete('/approval-lines/:id', (req, res) => { ownCompany(req.user, get(`select * from approval_lines where id=?`, req.params.id)); if (get(`select 1 from approval_rules where line_id=?`, req.params.id)) throw C.conflict('조건부 결재 규칙에서 쓰는 결재선입니다'); run(`delete from approval_lines where id=?`, req.params.id); res.json({ ok: true }); });
r.get('/approval-rules', (req, res) => res.json({ rules: all(`select * from approval_rules where company_id=? order by sort,id`, req.user.company_id).map((x) => ({ ...x, conditions: J(x.conditions, []) })), fields: E.RULE_FIELDS, ops: E.RULE_OPS }));
r.post('/approval-rules', wrap(async (req, res) => {
  C.need(req.user, 'org.manage');
  const conds = E.validateConditions(req.body.conditions);
  ownCompany(req.user, get(`select * from approval_lines where id=?`, req.body.line_id));
  res.status(201).json({ id: Number(run(`insert into approval_rules(company_id,name,sort,conditions,line_id) values(?,?,?,?,?)`, req.user.company_id, str(req.body.name, 50) || '규칙', int(req.body.sort) || 0, JSON.stringify(conds), req.body.line_id).lastInsertRowid) });
}));
r.delete('/approval-rules/:id', (req, res) => { C.need(req.user, 'org.manage'); ownCompany(req.user, get(`select * from approval_rules where id=?`, req.params.id)); run(`delete from approval_rules where id=?`, req.params.id); res.json({ ok: true }); });
r.get('/approvals', (req, res) => {
  const mine = all(`select a.*, case a.target_type when 'document' then (select title from documents where id=a.target_id) else (select '[일괄] '||title from bulk_jobs where id=a.target_id) end title from approvals a where a.user_id=? and a.company_id=? order by a.id desc limit 200`, req.user.id, req.user.company_id);
  res.json(mine.map((a) => { const rs = E.roundState(a.target_type, a.target_id); const cur = rs.rows?.find((x) => x.status === 'waiting'); return { ...a, actionable: a.status === 'waiting' && rs.round === a.round && cur?.id === a.id }; }));
});
r.post('/approvals/:id', wrap(async (req, res) => { res.json(E.actApproval(req.user, Number(req.params.id), req.body.decision, req.body.comment, ip(req))); }));

// ── PDF·다운로드 (권한 확인 후 만료 주소)
r.get('/documents/:id/pdf', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  let buf;
  if (d.pdf_file_id) buf = F.readFile(d.pdf_file_id).buf; else buf = await P.buildPdf(d.id, { draft: true });
  C.audit({ companyId: d.company_id, documentId: d.id, actor: C.actorOf(req.user), action: d.pdf_file_id ? 'PDF_DOWNLOAD' : 'PDF_PREVIEW', ip: ip(req) });
  res.set({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.title + (d.pdf_file_id ? '' : '_미리보기') + '.pdf')}`, 'cache-control': 'no-store' });
  res.send(buf);
}));

// ── 폴더·태그 (수동) — 권한과 무관하게 "보는 방법"만 바꾼다
r.post('/documents/:id/tags', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  const tag = str(req.body.tag, 30); if (!tag) throw C.bad('태그를 입력하세요');
  if (req.body.remove) run(`delete from doc_tags where document_id=? and tag=? and source='manual'`, d.id, tag); else run(`insert or ignore into doc_tags(document_id,tag,source) values(?,?,'manual')`, d.id, tag);
  res.json({ ok: true });
}));
r.post('/documents/:id/folders', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  const name = str(req.body.name, 50); if (!name) throw C.bad('폴더 이름을 입력하세요');
  run(`insert or ignore into folders(company_id,name) values(?,?)`, d.company_id, name);
  const f = get(`select id from folders where company_id=? and name=?`, d.company_id, name);
  if (req.body.remove) run(`delete from doc_folders where document_id=? and folder_id=? and source='manual'`, d.id, f.id); else run(`insert or ignore into doc_folders(document_id,folder_id,source) values(?,?,'manual')`, d.id, f.id);
  res.json({ ok: true });
}));
r.get('/class-rules', (req, res) => res.json({ rules: all(`select * from class_rules where company_id=? order by sort,id`, req.user.company_id).map((x) => ({ ...x, cond: J(x.cond, []), action: J(x.action, {}) })), fields: E.CLASS_FIELDS, ops: E.RULE_OPS }));
r.post('/class-rules', wrap(async (req, res) => {
  C.need(req.user, 'rule.manage');
  const v = E.validateClassRule(req.body.cond, req.body.action);
  const id = Number(run(`insert into class_rules(company_id,name,cond,action,sort) values(?,?,?,?,?)`, req.user.company_id, str(req.body.name, 50) || '분류 규칙', JSON.stringify(v.cond), JSON.stringify(v.action), int(req.body.sort) || 0).lastInsertRowid);
  for (const d of all(`select id from documents where company_id=?`, req.user.company_id)) E.applyRules(d.id);
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'CLASS_RULE_CREATE', detail: { id, ...v }, ip: ip(req) });
  res.status(201).json({ id });
}));
r.delete('/class-rules/:id', (req, res) => {
  C.need(req.user, 'rule.manage'); ownCompany(req.user, get(`select * from class_rules where id=?`, req.params.id));
  run(`delete from class_rules where id=?`, req.params.id);
  for (const d of all(`select id from documents where company_id=?`, req.user.company_id)) E.applyRules(d.id);
  res.json({ ok: true });
});

// ── 일정
r.get('/schedules', (req, res) => {
  const v = E.viewableSql(req.user);
  const from = req.query.from || '0000', to = req.query.to || '9999';
  res.json(all(`select s.*, d.title doc_title, d.status dstatus from schedules s join documents d on d.id=s.document_id where ${v} and s.date between ? and ? and d.status!='cancelled' order by s.date`, from, to)
    .map((s) => ({ ...s, remind_days: J(s.remind_days, []), recipients: J(s.recipients, []), channels: J(s.channels, []) })));
});
r.post('/documents/:id/schedules', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  if (!C.DATE_RE.test(req.body.date || '')) throw C.bad('날짜를 YYYY-MM-DD 로 입력하세요');
  const id = Number(run(`insert into schedules(company_id,document_id,kind,title,date,source,remind_days,recipients,channels,repeat,updated_by,updated_at) values(?,?,'custom',?,?,'manual',?,?,?,?,?,datetime('now'))`,
    d.company_id, d.id, str(req.body.title, 50) || '사용자 일정', req.body.date, JSON.stringify(sanitizeDays(req.body.remind_days)), JSON.stringify(sanitizeRecipients(req.user, req.body.recipients)), JSON.stringify(sanitizeChannels(req.body.channels)), ['none', 'monthly', 'yearly'].includes(req.body.repeat) ? req.body.repeat : 'none', req.user.id).lastInsertRowid);
  res.status(201).json({ id });
}));
const sanitizeDays = (x) => (Array.isArray(x) ? x : [7, 1]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365).slice(0, 5);
const sanitizeChannels = (x) => (Array.isArray(x) ? x : ['inapp']).filter((c) => ['inapp', 'email', 'sms'].includes(c));
const sanitizeRecipients = (u, x) => (Array.isArray(x) ? x : ['owner']).filter((v) => v === 'owner' || v === 'participants' || (Number.isInteger(v) && get(`select 1 from users where id=? and company_id=?`, v, u.company_id)));
r.put('/schedules/:id', wrap(async (req, res) => {
  const s = ownCompany(req.user, get(`select * from schedules where id=?`, req.params.id));
  E.mustView(req.user, E.getDoc(s.document_id));
  const b = req.body;
  if (b.date && !C.DATE_RE.test(b.date)) throw C.bad('날짜를 YYYY-MM-DD 로 입력하세요');
  const after = { date: b.date || s.date, remind_days: JSON.stringify(b.remind_days ? sanitizeDays(b.remind_days) : J(s.remind_days)), recipients: JSON.stringify(b.recipients ? sanitizeRecipients(req.user, b.recipients) : J(s.recipients)),
    channels: JSON.stringify(b.channels ? sanitizeChannels(b.channels) : J(s.channels)), repeat: ['none', 'monthly', 'yearly'].includes(b.repeat) ? b.repeat : s.repeat, done: b.done == null ? s.done : (b.done ? 1 : 0), title: str(b.title, 50) || s.title };
  // 담당자가 날짜를 고치면 이후 계약 데이터 자동 갱신으로 덮어쓰지 않는다 (source=manual)
  run(`update schedules set date=?, remind_days=?, recipients=?, channels=?, repeat=?, done=?, title=?, source=case when ?!=date then 'manual' else source end, updated_by=?, updated_at=datetime('now') where id=?`,
    after.date, after.remind_days, after.recipients, after.channels, after.repeat, after.done, after.title, after.date, req.user.id, s.id);
  run(`insert into schedule_history(schedule_id,changed_by,before_v,after_v) values(?,?,?,?)`, s.id, req.user.id, JSON.stringify({ date: s.date, remind_days: J(s.remind_days), repeat: s.repeat, done: s.done }), JSON.stringify({ ...after, remind_days: J(after.remind_days) }));
  res.json({ ok: true });
}));
r.get('/schedules/:id/history', (req, res) => { const s = ownCompany(req.user, get(`select * from schedules where id=?`, req.params.id)); E.mustView(req.user, E.getDoc(s.document_id)); res.json(all(`select h.*, u.name by_name from schedule_history h left join users u on u.id=h.changed_by where schedule_id=? order by h.id`, s.id)); });

// ── 메모·의견 (내부 메모 / 참여자 공유 의견)
r.get('/documents/:id/comments', (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  const reader = `u:${req.user.id}`;
  res.json(all(`select c.*, exists(select 1 from comment_reads r where r.comment_id=c.id and r.reader=?) is_read from comments c where document_id=? order by id`, reader, d.id)
    .map((c) => ({ ...c, body: c.deleted_at ? '' : c.body, attachments: c.deleted_at ? [] : J(c.attachments, []), mentions: J(c.mentions, []), revisions: all(`select action,by_name,at from comment_revisions where comment_id=?`, c.id) })));
});
r.post('/documents/:id/comments', wrap(async (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  const vis = req.body.visibility === 'shared' ? 'shared' : 'internal';
  const body = str(req.body.body, 4000); if (!body) throw C.bad('내용을 입력하세요');
  if (req.body.parent_id) { const pc = get(`select * from comments where id=? and document_id=?`, req.body.parent_id, d.id); if (!pc) throw C.bad('원 댓글이 없습니다'); if (pc.visibility !== vis) throw C.bad('답글은 원 댓글과 같은 공개 범위여야 합니다'); }
  const atts = (req.body.attachments || []).map((a) => fileOk(req.user, a).id);
  // @이름 언급 → 같은 회사 직원에게만 알림
  const mentions = all(`select id,name from users where company_id=? and status='active'`, d.company_id).filter((u) => body.includes('@' + u.name)).map((u) => u.id);
  const id = Number(run(`insert into comments(document_id,parent_id,visibility,author_type,author_id,author_name,body,attachments,mentions) values(?,?,?,?,?,?,?,?,?)`, d.id, int(req.body.parent_id), vis, 'user', req.user.id, req.user.name, body, JSON.stringify(atts), JSON.stringify(mentions)).lastInsertRowid);
  run(`insert into comment_revisions(comment_id,body,action,by_name) values(?,?,'create',?)`, id, body, req.user.name);
  run(`insert or ignore into comment_reads values(?,?)`, id, `u:${req.user.id}`);
  const label = vis === 'internal' ? '내부 메모' : '공유 의견';
  for (const uid of new Set([...mentions, d.creator_id].filter((x) => x && x !== req.user.id)))
    C.notify({ companyId: d.company_id, channel: 'inapp', userId: uid, subject: `[${label}] ${d.title} — ${req.user.name}`, body: `#/doc/${d.id}`, dedupe: `cmt:${id}:${uid}` });
  // 공유 의견만 외부 참여자에게 알린다. 내부 메모는 외부로 나가지 않는다.
  if (vis === 'shared') for (const p of all(`select * from participants where document_id=? and kind='external' and email is not null`, d.id))
    C.notify({ companyId: d.company_id, channel: 'email', to: p.email, subject: `[의견] ${d.title}`, body: `${req.user.name}: ${body.slice(0, 200)}`, dedupe: `cmt:${id}:p${p.id}`, documentId: d.id });
  res.status(201).json({ id });
}));
r.put('/comments/:id', wrap(async (req, res) => {
  const c = get(`select * from comments where id=?`, req.params.id); if (!c) throw C.notFound();
  E.mustView(req.user, E.getDoc(c.document_id));
  if (c.author_type !== 'user' || c.author_id !== req.user.id || c.deleted_at) throw C.forbid('본인 글만 고칠 수 있습니다');
  const body = str(req.body.body, 4000); if (!body) throw C.bad('내용을 입력하세요');
  run(`update comments set body=?, edited_at=datetime('now') where id=?`, body, c.id);
  run(`insert into comment_revisions(comment_id,body,action,by_name) values(?,?,'edit',?)`, c.id, c.body, req.user.name);
  res.json({ ok: true });
}));
r.delete('/comments/:id', wrap(async (req, res) => {
  const c = get(`select * from comments where id=?`, req.params.id); if (!c) throw C.notFound();
  E.mustView(req.user, E.getDoc(c.document_id));
  if (c.author_type !== 'user' || c.author_id !== req.user.id) throw C.forbid('본인 글만 지울 수 있습니다');
  run(`update comments set deleted_at=datetime('now') where id=?`, c.id);
  run(`insert into comment_revisions(comment_id,body,action,by_name) values(?,?,'delete',?)`, c.id, c.body, req.user.name);
  res.json({ ok: true });
}));
r.post('/documents/:id/comments/read', (req, res) => {
  const d = E.getDoc(req.params.id); E.mustView(req.user, d);
  for (const c of all(`select id from comments where document_id=?`, d.id)) run(`insert or ignore into comment_reads values(?,?)`, c.id, `u:${req.user.id}`);
  res.json({ ok: true });
});
r.get('/comments/:id/file/:fid', (req, res) => {
  const c = get(`select * from comments where id=?`, req.params.id); if (!c) throw C.notFound();
  E.mustView(req.user, E.getDoc(c.document_id));
  if (!J(c.attachments, []).includes(Number(req.params.fid))) throw C.notFound();
  const f = F.readFile(Number(req.params.fid)); res.set({ 'content-type': f.mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` }); res.send(f.buf);
});

// ── 직인 (등록·승인·사용·폐기 권한 분리, 모든 사용 기록)
r.get('/seals', (req, res) => res.json({
  seals: all(`select s.*, (select name from users where id=s.registered_by) reg_name, (select name from users where id=s.approved_by) appr_name from seals s where company_id=? order by id desc`, req.user.company_id),
  policies: all(`select p.*, (select name from templates where id=p.template_id) template_name, (select name from seals where id=p.seal_id) seal_name from seal_policies p where company_id=? order by id desc`, req.user.company_id).map((p) => ({ ...p, user_ids: J(p.user_ids, []) })),
  usages: all(`select u.*, (select name from seals where id=u.seal_id) seal_name, (select name from users where id=u.user_id) user_name, (select title from documents where id=u.document_id) doc_title from seal_usages u where company_id=? order by id desc limit 300`, req.user.company_id),
}));
r.post('/seals', wrap(async (req, res) => {
  C.need(req.user, 'seal.register');
  if (!E.PNG_RE.test(req.body.image || '') || req.body.image.length > 400000) throw C.bad('직인 이미지는 투명 배경 PNG(300KB 이하)로 올리세요');
  const id = Number(run(`insert into seals(company_id,name,image,registered_by) values(?,?,?,?)`, req.user.company_id, str(req.body.name, 50) || '법인 직인', req.body.image, req.user.id).lastInsertRowid);
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'SEAL_REGISTER', detail: { id }, ip: ip(req) });
  res.status(201).json({ id });
}));
r.post('/seals/:id/approve', wrap(async (req, res) => {
  C.need(req.user, 'seal.approve');
  const s = ownCompany(req.user, get(`select * from seals where id=?`, req.params.id));
  if (s.status !== 'pending') throw C.conflict('승인 대기 직인이 아닙니다');
  run(`update seals set status='active', approved_by=? where id=?`, req.user.id, s.id);
  C.audit({ companyId: s.company_id, actor: C.actorOf(req.user), action: 'SEAL_APPROVE', detail: { id: s.id }, ip: ip(req) });
  res.json({ ok: true });
}));
r.post('/seals/:id/retire', wrap(async (req, res) => {
  C.need(req.user, 'seal.retire');
  const s = ownCompany(req.user, get(`select * from seals where id=?`, req.params.id));
  run(`update seals set status='retired', retired_by=? where id=?`, req.user.id, s.id);
  run(`update seal_policies set status='revoked' where seal_id=?`, s.id);
  C.audit({ companyId: s.company_id, actor: C.actorOf(req.user), action: 'SEAL_RETIRE', detail: { id: s.id }, ip: ip(req) });
  res.json({ ok: true });
}));
// 사전 날인 정책: 특정 서식·버전·사용자·금액 한도 안에서만. 승인권자가 승인해야 효력.
r.post('/seal-policies', wrap(async (req, res) => {
  C.need(req.user, 'seal.use');
  const s = ownCompany(req.user, get(`select * from seals where id=? and status='active'`, req.body.seal_id));
  const t = ownCompany(req.user, get(`select * from templates where id=?`, req.body.template_id));
  const users = (req.body.user_ids || []).map((x) => ownCompany(req.user, get(`select * from users where id=?`, x)).id);
  if (!users.length) throw C.bad('사전날인을 쓸 수 있는 사용자를 고르세요');
  const id = Number(run(`insert into seal_policies(company_id,seal_id,template_id,template_version,user_ids,max_amount,created_by) values(?,?,?,?,?,?,?)`, req.user.company_id, s.id, t.id, t.current_version, JSON.stringify(users), int(req.body.max_amount), req.user.id).lastInsertRowid);
  C.audit({ companyId: s.company_id, actor: C.actorOf(req.user), action: 'SEAL_POLICY_CREATE', detail: { id, template: t.id, version: t.current_version, users, maxAmount: int(req.body.max_amount) }, ip: ip(req) });
  res.status(201).json({ id });
}));
r.post('/seal-policies/:id/:act', wrap(async (req, res) => {
  C.need(req.user, 'seal.approve');
  const p = ownCompany(req.user, get(`select * from seal_policies where id=?`, req.params.id));
  const st = req.params.act === 'approve' ? 'approved' : 'revoked';
  if (st === 'approved' && p.created_by === req.user.id && get(`select count(*) n from users where company_id=? and status='active'`, req.user.company_id).n > 1) throw C.bad('정책을 만든 사람과 승인하는 사람이 달라야 합니다');
  run(`update seal_policies set status=?, approved_by=? where id=?`, st, req.user.id, p.id);
  C.audit({ companyId: p.company_id, actor: C.actorOf(req.user), action: st === 'approved' ? 'SEAL_POLICY_APPROVE' : 'SEAL_POLICY_REVOKE', detail: { id: p.id }, ip: ip(req) });
  res.json({ ok: true });
}));

// ── 링크계약 (공통 URL·QR 접수 창구 → 접속자마다 별도 문서)
r.get('/links', (req, res) => {
  C.need(req.user, 'link.manage');
  res.json(all(`select c.*, (select count(*) from documents where link_campaign_id=c.id and status!='cancelled') submitted,
      (select count(*) from documents where link_campaign_id=c.id and status='completed') completed,
      (select count(*) from documents where link_campaign_id=c.id and status='review') review
    from link_campaigns c where company_id=? order by id desc`, req.user.company_id).map((c) => ({ ...c, privacy: J(c.privacy, []), url: `${E.BASE_URL()}/l/${c.slug}` })));
});
function linkInput(req) {
  const b = req.body;
  if (!str(b.title)) throw C.bad('제목을 입력하세요');
  for (const k of ['starts_at', 'ends_at']) if (b[k] && isNaN(Date.parse(b[k]))) throw C.bad('접수 기간 형식이 올바르지 않습니다');
  return { title: str(b.title), intro: str(b.intro, 2000), starts_at: b.starts_at || null, ends_at: b.ends_at || null, max_count: int(b.max_count), auth: ['phone_otp', 'none'].includes(b.auth) ? b.auth : 'phone_otp',
    dup_policy: ['once_per_phone', 'allow'].includes(b.dup_policy) ? b.dup_policy : 'once_per_phone', privacy: JSON.stringify((b.privacy || []).map((x) => ({ text: String(x.text || x).slice(0, 300), required: x.required !== false })).slice(0, 10)),
    after_msg: str(b.after_msg, 1000), review_required: b.review_required ? 1 : 0, site: str(b.site, 100) };
}
r.post('/links', wrap(async (req, res) => {
  C.need(req.user, 'link.manage');
  const t = ownCompany(req.user, get(`select * from templates where id=?`, req.body.template_id));
  if (!E.canUseTemplate(req.user, t)) throw C.forbid('이 템플릿을 사용할 권한이 없습니다');
  const tv = E.currentTV(t.id);
  if (tv.roles.filter((x) => x.kind === 'external').length !== 1 || tv.roles.some((x) => x.kind === 'internal')) throw C.bad('링크계약 템플릿은 외부 참여자 1명(+직인)이어야 합니다');
  const v = linkInput(req);
  const slug = C.token(9);
  const id = Number(run(`insert into link_campaigns(company_id,template_version_id,slug,title,intro,starts_at,ends_at,max_count,auth,dup_policy,privacy,after_msg,review_required,site,created_by) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    req.user.company_id, tv.id, slug, v.title, v.intro, v.starts_at, v.ends_at, v.max_count, v.auth, v.dup_policy, v.privacy, v.after_msg, v.review_required, v.site, req.user.id).lastInsertRowid);
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'LINK_CREATE', detail: { id, slug }, ip: ip(req) });
  res.status(201).json({ id, slug, url: `${E.BASE_URL()}/l/${slug}` });
}));
r.put('/links/:id', wrap(async (req, res) => {
  C.need(req.user, 'link.manage');
  const c = ownCompany(req.user, get(`select * from link_campaigns where id=?`, req.params.id));
  if (req.body.status) {
    const st = { pause: 'paused', close: 'closed', resume: 'active' }[req.body.status];
    if (!st) throw C.bad('상태 값이 올바르지 않습니다');
    if (c.status === 'closed' && st !== 'closed') throw C.conflict('종료한 링크는 다시 열 수 없습니다. 새 링크를 만드세요');
    run(`update link_campaigns set status=? where id=?`, st, c.id);
    C.audit({ companyId: c.company_id, actor: C.actorOf(req.user), action: 'LINK_STATUS', detail: { id: c.id, status: st }, ip: ip(req) });
    return res.json({ ok: true });
  }
  const v = linkInput(req);
  run(`update link_campaigns set title=?,intro=?,starts_at=?,ends_at=?,max_count=?,auth=?,dup_policy=?,privacy=?,after_msg=?,review_required=?,site=? where id=?`, v.title, v.intro, v.starts_at, v.ends_at, v.max_count, v.auth, v.dup_policy, v.privacy, v.after_msg, v.review_required, v.site, c.id);
  res.json({ ok: true });
}));
r.get('/links/:id/qr.png', wrap(async (req, res) => {
  C.need(req.user, 'link.manage');
  const c = ownCompany(req.user, get(`select * from link_campaigns where id=?`, req.params.id));
  const png = await QRCode.toBuffer(`${E.BASE_URL()}/l/${c.slug}`, { width: 600, margin: 2 });
  res.set({ 'content-type': 'image/png', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(c.title + '_QR.png')}` }); res.send(png);
}));
async function linkRows(c) {
  const tv = E.loadTV(c.template_version_id);
  const ext = tv.roles.find((x) => x.kind === 'external');
  const cols = E.fieldsFor(tv, ext.key).filter((f) => f.type !== 'check');
  const docs = all(`select d.*, p.name pname, p.phone pphone, p.vals pvals, p.signed_at, p.confirm_method from documents d join participants p on p.document_id=d.id and p.kind='external' where d.link_campaign_id=? order by d.id`, c.id);
  return { header: ['문서번호', '접수 시각', '이름', '전화번호', ...cols.map((f) => f.label), '서명 시각', '상태', '확인 방식'], rows: docs.map((d) => [d.id, d.created_at, d.pname, d.pphone, ...cols.map((f) => J(d.pvals, {})[f.key] ?? ''), d.signed_at || '', E.STATUS[d.status], d.confirm_method || '']) };
}
r.get('/links/:id/export', wrap(async (req, res) => {
  C.need(req.user, 'link.manage');
  const c = ownCompany(req.user, get(`select * from link_campaigns where id=?`, req.params.id));
  const { header, rows } = await linkRows(c);
  C.audit({ companyId: c.company_id, actor: C.actorOf(req.user), action: 'LINK_EXPORT', detail: { id: c.id, format: req.query.format, rows: rows.length }, ip: ip(req) });
  if (req.query.format === 'csv') {
    const cell = (v) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`; };
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(c.title + '.csv')}` });
    return res.send('﻿' + [header, ...rows].map((r2) => r2.map(cell).join(',')).join('\r\n'));
  }
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('접수');
  ws.addRow(header).font = { bold: true }; rows.forEach((x) => ws.addRow(x)); ws.columns.forEach((col) => { col.width = 16; });
  res.set({ 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(c.title + '.xlsx')}` });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

// ── 대량계약
r.use('/bulk', require('./bulk'));

// ── 회사 브랜딩·설정
r.get('/company', (req, res) => { const c = get(`select * from companies where id=?`, req.user.company_id); res.json({ ...c, brand: J(c.brand, {}), settings: J(c.settings, {}) }); });
r.put('/company', wrap(async (req, res) => {
  C.need(req.user, 'org.manage');
  const b = req.body.brand || {};
  if (b.logo && (!/^data:image\/(png|jpeg);base64,/.test(b.logo) || b.logo.length > 300000)) throw C.bad('로고는 PNG/JPG 200KB 이하로 올리세요');
  if (b.color && !/^#[0-9a-fA-F]{6}$/.test(b.color)) throw C.bad('색상은 #RRGGBB 형식입니다');
  const brand = { logo: b.logo || null, color: b.color || '#1f4e79', sender_name: str(b.sender_name, 50), request_msg: str(b.request_msg, 500), done_msg: str(b.done_msg, 500), contact: str(b.contact, 100) };
  const s = req.body.settings || {};
  const settings = { renewal_days: Math.min(Math.max(int(s.renewal_days) ?? 30, 0), 365) };
  run(`update companies set name=coalesce(?,name), biz_no=coalesce(?,biz_no), brand=?, settings=? where id=?`, str(req.body.name, 100), str(req.body.biz_no, 20), JSON.stringify(brand), JSON.stringify(settings), req.user.company_id);
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'COMPANY_UPDATE', ip: ip(req) });
  res.json({ ok: true });
}));

// ── API 키·Webhook
r.get('/api-keys', (req, res) => { C.need(req.user, 'api.manage'); res.json(all(`select id,name,prefix,scopes,rate_per_min,created_at,revoked_at,last_used_at,(select name from users where id=created_by) by_name from api_keys where company_id=? order by id desc`, req.user.company_id).map((k) => ({ ...k, scopes: J(k.scopes, []) }))); });
const SCOPES = ['templates:read', 'documents:read', 'documents:write', 'documents:send', 'documents:cancel', 'files:read'];
function newKey(u, name, scopes, rate) {
  const raw = `isk_${C.token(28)}`;
  const id = Number(run(`insert into api_keys(company_id,name,prefix,key_hash,scopes,rate_per_min,created_by) values(?,?,?,?,?,?,?)`, u.company_id, name, raw.slice(0, 10), C.sha256(raw), JSON.stringify(scopes), rate, u.id).lastInsertRowid);
  return { id, key: raw };
}
r.post('/api-keys', wrap(async (req, res) => {
  C.need(req.user, 'api.manage');
  const scopes = (req.body.scopes || []).filter((s) => SCOPES.includes(s)); if (!scopes.length) throw C.bad('권한 범위를 하나 이상 고르세요');
  const k = newKey(req.user, str(req.body.name, 50) || 'API 키', scopes, Math.min(Math.max(int(req.body.rate_per_min) || 60, 1), 600));
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'API_KEY_CREATE', detail: { id: k.id, scopes }, ip: ip(req) });
  res.status(201).json({ ...k, notice: '이 키는 지금 한 번만 보여 줍니다. 안전한 곳에 보관하세요.' });
}));
r.post('/api-keys/:id/revoke', wrap(async (req, res) => {
  C.need(req.user, 'api.manage'); const k = ownCompany(req.user, get(`select * from api_keys where id=?`, req.params.id));
  run(`update api_keys set revoked_at=datetime('now') where id=? and revoked_at is null`, k.id);
  C.audit({ companyId: k.company_id, actor: C.actorOf(req.user), action: 'API_KEY_REVOKE', detail: { id: k.id }, ip: ip(req) }); res.json({ ok: true });
}));
r.post('/api-keys/:id/rotate', wrap(async (req, res) => {
  C.need(req.user, 'api.manage'); const k = ownCompany(req.user, get(`select * from api_keys where id=?`, req.params.id));
  run(`update api_keys set revoked_at=datetime('now') where id=? and revoked_at is null`, k.id);
  const n = newKey(req.user, k.name, J(k.scopes, []), k.rate_per_min);
  C.audit({ companyId: k.company_id, actor: C.actorOf(req.user), action: 'API_KEY_ROTATE', detail: { old: k.id, new: n.id }, ip: ip(req) });
  res.status(201).json(n);
}));
r.get('/webhooks', (req, res) => {
  C.need(req.user, 'api.manage');
  res.json({ hooks: all(`select id,url,events,active,created_at from webhooks where company_id=?`, req.user.company_id).map((w) => ({ ...w, events: J(w.events, []) })), events: C.EVENT_TYPES,
    deliveries: all(`select d.*, e.type from webhook_deliveries d join webhooks w on w.id=d.webhook_id join events e on e.id=d.event_id where w.company_id=? order by d.id desc limit 100`, req.user.company_id) });
});
r.post('/webhooks', wrap(async (req, res) => {
  C.need(req.user, 'api.manage');
  let u; try { u = new URL(req.body.url); } catch { throw C.bad('주소가 올바르지 않습니다'); }
  if (u.protocol !== 'https:' && process.env.ALLOW_HTTP_WEBHOOK !== '1') throw C.bad('Webhook 주소는 https 만 쓸 수 있습니다');
  const events = (req.body.events || C.EVENT_TYPES).filter((e) => C.EVENT_TYPES.includes(e));
  const secret = `whsec_${C.token(24)}`;
  const id = Number(run(`insert into webhooks(company_id,url,secret,events) values(?,?,?,?)`, req.user.company_id, u.toString(), secret, JSON.stringify(events)).lastInsertRowid);
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'WEBHOOK_CREATE', detail: { id, url: u.origin, events }, ip: ip(req) });
  res.status(201).json({ id, secret, notice: '서명 비밀값은 지금 한 번만 보여 줍니다.' });
}));
r.delete('/webhooks/:id', (req, res) => { C.need(req.user, 'api.manage'); ownCompany(req.user, get(`select * from webhooks where id=?`, req.params.id)); run(`update webhooks set active=0 where id=?`, req.params.id); res.json({ ok: true }); });
r.post('/webhook-deliveries/:id/resend', (req, res) => {
  C.need(req.user, 'api.manage');
  const d = get(`select d.*, w.company_id from webhook_deliveries d join webhooks w on w.id=d.webhook_id where d.id=?`, req.params.id); ownCompany(req.user, d);
  run(`update webhook_deliveries set status='retry', next_at=? where id=?`, Date.now(), d.id); res.json({ ok: true });
});

// ── 발송함(알림 기록)·감사
r.get('/outbox', (req, res) => {
  const v = E.viewableSql(req.user);
  const rows = C.can(req.user, 'org.manage')
    ? all(`select * from outbox where company_id=? order by id desc limit 300`, req.user.company_id)
    : all(`select o.* from outbox o join documents d on d.id=o.document_id where ${v} order by o.id desc limit 300`);
  res.json(rows);
});
r.get('/audit', (req, res) => {
  C.need(req.user, 'org.manage');
  res.json({ chain: C.verifyAuditChain(req.user.company_id), logs: all(`select * from audit_logs where company_id=? order by id desc limit 300`, req.user.company_id) });
});
r.get('/stats', (req, res) => {
  const v = E.viewableSql(req.user);
  res.json({
    byStatus: all(`select status, count(*) n from documents d where ${v} group by status`),
    renewal: get(`select count(*) n from schedules s join documents d on d.id=s.document_id where ${v} and s.kind='renewal' and s.done=0 and s.date<=date('now','+30 days') and d.status!='cancelled'`).n,
    upcoming: all(`select s.*, d.title doc_title from schedules s join documents d on d.id=s.document_id where ${v} and s.done=0 and s.date>=date('now') and d.status!='cancelled' order by s.date limit 8`),
  });
});

module.exports = r;
