// 서식 기반 대량계약: 엑셀 양식 → 업로드·검증 → 미리보기 → (결재) → 큐 발송 → 현황·재시도·ZIP
const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { all, get, run, tx, J } = require('../db');
const C = require('../core');
const E = require('../engine');
const F = require('../files');
const P = require('../pdf');
const Q = require('../queue');
const wrap = require('../wrap');

const r = express.Router();
const MAX_ROWS = Number(process.env.BULK_MAX_ROWS || 5000);

// 템플릿에서 엑셀 열을 만든다. 외부 참여자는 성명·이메일·전화번호, 직원 참여자는 직원 이메일.
function columns(tv) {
  const cols = [{ key: '__title', header: '문서 제목(선택)', optional: true }];
  for (const ro of tv.roles) {
    const o = !!ro.optional;
    if (ro.kind === 'external') {
      if (ro.party === 'company') cols.push({ key: `${ro.key}.org`, header: `${ro.label} 상호`, role: ro.key, optional: o }, { key: `${ro.key}.orgno`, header: `${ro.label} 사업자등록번호`, role: ro.key, optional: true });
      cols.push({ key: `${ro.key}.name`, header: `${ro.label} ${ro.party === 'company' ? '대표자·담당자' : '성명'}`, role: ro.key, optional: o }, { key: `${ro.key}.email`, header: `${ro.label} 이메일`, role: ro.key, optional: true }, { key: `${ro.key}.phone`, header: `${ro.label} 전화번호`, role: ro.key, optional: true });
    }
    if (ro.kind === 'internal') cols.push({ key: `${ro.key}.user`, header: `${ro.label} (직원 이메일)`, role: ro.key, optional: o });
  }
  for (const f of E.fieldsFor(tv, 'sender').filter((x) => x.scope !== 'common')) cols.push({ key: f.key, header: f.label, field: f, optional: !f.required });
  cols.push({ key: '__owner', header: '계약 담당자(직원 이메일, 선택)', optional: true });
  return cols;
}
const commonFields = (tv) => E.fieldsFor(tv, 'sender').filter((x) => x.scope === 'common');

r.get('/form.xlsx', wrap(async (req, res) => {
  C.need(req.user, 'bulk.send');
  const t = get(`select * from templates where id=? and company_id=?`, req.query.template_id, req.user.company_id);
  if (!t || !E.canUseTemplate(req.user, t)) throw C.forbid('이 템플릿을 사용할 권한이 없습니다');
  const tv = E.currentTV(t.id);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('수신자별 값');
  const cols = columns(tv);
  ws.addRow(cols.map((c) => c.header));
  ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE7F2' } };
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(14, c.header.length * 2); if (c.field?.type === 'date' || c.field?.type === 'text' || c.key.endsWith('.phone')) ws.getColumn(i + 1).numFmt = '@'; });
  const help = wb.addWorksheet('공통값');
  help.addRow(['항목', '값 (모든 계약에 똑같이 들어갑니다)']).font = { bold: true };
  for (const f of commonFields(tv)) help.addRow([f.label, '']);
  help.getColumn(1).width = 24; help.getColumn(2).width = 40;
  const guide = wb.addWorksheet('작성 안내');
  [['한 행이 계약 한 건입니다. 1행(제목)은 지우지 마세요.'], ['날짜는 2026-03-01 처럼 YYYY-MM-DD 로 적습니다.'], ['전화번호는 010-1234-5678 형식, 금액은 숫자만 적습니다.'],
    ['외부 참여자는 이메일과 전화번호 중 하나 이상이 필요합니다.'], ['예시 행 없이 비어 있는 양식입니다. 실제 개인정보는 회사 내부에서만 다루세요.']].forEach((x) => guide.addRow(x));
  guide.getColumn(1).width = 80;
  res.set({ 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(t.name.replace(/[\[\]]/g, '') + '_대량계약양식.xlsx')}` });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

const cellText = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') { if (v.text) return String(v.text); if (v.result != null) return String(v.result); if (v.richText) return v.richText.map((x) => x.text).join(''); if (v.hyperlink) return String(v.text || v.hyperlink).replace(/^mailto:/, ''); }
  return String(v).trim();
};

async function parse(u, tv, buf, commonOverride = {}) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw C.bad('엑셀(.xlsx) 파일을 열 수 없습니다'); }
  const ws = wb.getWorksheet('수신자별 값') || wb.worksheets[0];
  const cols = columns(tv);
  const head = (ws.getRow(1).values || []).slice(1).map(cellText);
  const missing = cols.filter((c) => !c.optional && !head.includes(c.header)).map((c) => c.header);
  if (missing.length) throw C.bad(`필수 열이 없습니다: ${missing.join(', ')}`, { missingColumns: missing });
  const idx = Object.fromEntries(cols.map((c) => [c.key, head.indexOf(c.header) + 1]));
  // 공통값: 화면 입력 > 엑셀 '공통값' 시트
  const common = {};
  const cs = wb.getWorksheet('공통값');
  for (const f of commonFields(tv)) {
    let v = commonOverride[f.key];
    if (v == null && cs) cs.eachRow((row, n) => { if (n > 1 && cellText(row.getCell(1).value) === f.label) v = cellText(row.getCell(2).value); });
    if (v != null && v !== '') common[f.key] = v;
  }
  const commonErrors = commonFields(tv).map((f) => E.checkValue(f, common[f.key])).filter(Boolean);
  const staff = Object.fromEntries(all(`select id,email,name from users where company_id=? and status='active'`, u.company_id).map((x) => [x.email.toLowerCase(), x]));
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const raw = Object.fromEntries(cols.map((c) => [c.key, idx[c.key] ? cellText(row.getCell(idx[c.key]).value) : '']));
    if (Object.values(raw).every((v) => v === '')) return;
    const errors = [], vals = {}, participants = [];
    for (const ro of tv.roles) {
      if (ro.optional && [`${ro.key}.name`, `${ro.key}.org`, `${ro.key}.user`, `${ro.key}.email`, `${ro.key}.phone`].every((k) => !raw[k])) continue; // 선택 참여자 비어 있음
      if (ro.kind === 'external') {
        const name = raw[`${ro.key}.name`], email = raw[`${ro.key}.email`] || null, phone = raw[`${ro.key}.phone`] || null;
        if (ro.party === 'company' && !raw[`${ro.key}.org`]) errors.push(`${ro.label} 상호가 비었습니다`);
        if (!name) errors.push(`${ro.label} 성명이 비었습니다`);
        if (!email && !phone) errors.push(`${ro.label} 이메일 또는 전화번호가 필요합니다`);
        if (email && !C.EMAIL_RE.test(email)) errors.push(`${ro.label} 이메일 형식 오류: ${email}`);
        if (phone && !C.PHONE_RE.test(phone)) errors.push(`${ro.label} 전화번호 형식 오류: ${phone}`);
        participants.push({ role_key: ro.key, name, email, phone, delivery: email ? 'email' : 'sms', org_name: raw[`${ro.key}.org`] || null, org_no: raw[`${ro.key}.orgno`] || null });
      } else if (ro.kind === 'internal') {
        const st = staff[String(raw[`${ro.key}.user`] || '').toLowerCase()];
        if (!st) errors.push(`${ro.label}: 재직 중인 직원 이메일이 아닙니다`);
        participants.push({ role_key: ro.key, user_id: st?.id });
      } else participants.push({ role_key: ro.key });
    }
    for (const c of cols.filter((x) => x.field)) {
      const e = E.checkValue(c.field, raw[c.key]); if (e) errors.push(e);
      else if (raw[c.key] !== '') vals[c.key] = c.field.type === 'number' ? Number(String(raw[c.key]).replace(/,/g, '')) : raw[c.key];
    }
    let ownerId = null;
    if (raw.__owner) { const st = staff[raw.__owner.toLowerCase()]; if (!st) errors.push(`계약 담당자가 재직 중인 직원이 아닙니다: ${raw.__owner}`); else ownerId = st.id; }
    rows.push({ row_no: n, data: { __title: raw.__title || null, vals, participants, ownerId }, errors });
  });
  if (!rows.length) throw C.bad('입력된 행이 없습니다');
  if (rows.length > MAX_ROWS) throw C.bad(`한 번에 ${MAX_ROWS}건까지 올릴 수 있습니다 (현재 ${rows.length}건)`);
  // 중복 경고: 같은 파일 안의 같은 수신자 / 같은 내용, 진행 중인 같은 템플릿 문서
  const seen = new Map(), seenAll = new Map();
  for (const x of rows) {
    x.warnings = [];
    for (const p of x.data.participants.filter((y) => y.name)) {
      for (const k of [p.email && `e:${p.email.toLowerCase()}`, p.phone && `p:${C.normPhone(p.phone)}`].filter(Boolean)) {
        if (seen.has(k)) x.warnings.push(`중복 수신자: ${seen.get(k)}행과 같은 ${k.startsWith('e') ? '이메일' : '전화번호'}`); else seen.set(k, x.row_no);
      }
      const dup = get(`select d.id from documents d join participants q on q.document_id=d.id join template_versions v on v.id=d.template_version_id
        where d.company_id=? and v.template_id=? and d.status in ('draft','approval','ready','in_progress') and ((q.email is not null and lower(q.email)=lower(?)) or (q.phone is not null and replace(q.phone,'-','')=?)) limit 1`,
      u.company_id, tv.template_id, p.email || '', C.normPhone(p.phone) || '-');
      if (dup) x.warnings.push(`중복 요청: 같은 템플릿으로 진행 중인 문서 #${dup.id}가 있습니다 (${p.name})`);
    }
    const sig = JSON.stringify(x.data);
    if (seenAll.has(sig)) x.warnings.push(`중복 요청: ${seenAll.get(sig)}행과 내용이 같습니다`); else seenAll.set(sig, x.row_no);
  }
  return { rows, common, commonErrors };
}

const jobHash = (jobId) => {
  const j = get(`select * from bulk_jobs where id=?`, jobId);
  return C.sha256(JSON.stringify([j.template_version_id, j.common, all(`select row_no,data from bulk_rows where job_id=? and status!='invalid' order by row_no`, jobId)]));
};

r.post('/', wrap(async (req, res) => {
  C.need(req.user, 'bulk.send');
  const t = get(`select * from templates where id=? and company_id=?`, req.body.template_id, req.user.company_id);
  if (!t || !E.canUseTemplate(req.user, t)) throw C.forbid('이 템플릿을 사용할 권한이 없습니다');
  const tv = E.currentTV(t.id);
  const m = /^data:[^;]+;base64,(.+)$/s.exec(String(req.body.fileDataUrl || ''));
  if (!m) throw C.bad('엑셀 파일을 올려 주세요');
  const buf = Buffer.from(m[1], 'base64');
  const { rows, common, commonErrors } = await parse(req.user, tv, buf, req.body.common || {});
  const t0 = Date.now();
  const id = tx(() => {
    const id2 = Number(run(`insert into bulk_jobs(company_id,template_version_id,created_by,title,status,common,total) values(?,?,?,?,?,?,?)`, req.user.company_id, tv.id, req.user.id, String(req.body.title || t.name).slice(0, 100), commonErrors.length || rows.some((x) => x.errors.length) ? 'uploaded' : 'validated', JSON.stringify(common), rows.length).lastInsertRowid);
    const ins = require('../db').db.prepare(`insert into bulk_rows(job_id,row_no,data,errors,warnings,status) values(?,?,?,?,?,?)`);
    for (const x of rows) ins.run(id2, x.row_no, JSON.stringify(x.data), JSON.stringify(x.errors), JSON.stringify(x.warnings), x.errors.length ? 'invalid' : 'ready');
    return id2;
  });
  run(`update bulk_jobs set content_hash=? where id=?`, jobHash(id), id);
  F.storeFile(req.user.company_id, buf, `대량계약_${id}_원본.xlsx`, { origin: 'bulk_upload', originRef: String(id) });
  C.audit({ companyId: req.user.company_id, actor: C.actorOf(req.user), action: 'BULK_UPLOAD', detail: { job: id, rows: rows.length, invalid: rows.filter((x) => x.errors.length).length, ms: Date.now() - t0 }, ip: req.ip });
  res.status(201).json({ id, commonErrors });
}));

function summary(jobId) {
  const s = Object.fromEntries(all(`select status, count(*) n from bulk_rows where job_id=? group by status`, jobId).map((x) => [x.status, x.n]));
  const d = Object.fromEntries(all(`select status, count(*) n from documents where bulk_job_id=? group by status`, jobId).map((x) => [x.status, x.n]));
  return { rows: s, invalid: s.invalid || 0, queued: s.queued || 0, sent: s.sent || 0, failed: s.failed || 0, signing: d.in_progress || 0, completed: d.completed || 0, rejected: d.rejected || 0, docs: d };
}
function loadJob(u, id) {
  const j = get(`select * from bulk_jobs where id=? and company_id=?`, id, u.company_id);
  if (!j) throw C.notFound();
  if (j.created_by !== u.id && !C.can(u, 'doc.view_all') && !get(`select 1 from approvals where target_type='bulk_job' and target_id=? and user_id=?`, j.id, u.id)) throw C.forbid();
  return j;
}
r.get('/', (req, res) => { C.need(req.user, 'bulk.send'); res.json(all(`select * from bulk_jobs where company_id=? and (created_by=? or ?) order by id desc limit 100`, req.user.company_id, req.user.id, C.can(req.user, 'doc.view_all') ? 1 : 0).map((j) => ({ ...j, summary: summary(j.id) }))); });
r.get('/:id', (req, res) => {
  const j = loadJob(req.user, req.params.id);
  const tv = E.loadTV(j.template_version_id);
  const page = Math.max(Number(req.query.page) || 1, 1), only = req.query.only;
  const w = only === 'errors' ? `and (r.status='invalid' or r.warnings!='[]')` : only === 'failed' ? `and r.status='failed'` : '';
  const rows = all(`select r.*, d.status doc_status from bulk_rows r left join documents d on d.id=r.document_id where r.job_id=? ${w} order by r.row_no limit 100 offset ?`, j.id, (page - 1) * 100)
    .map((x) => ({ ...x, data: J(x.data, {}), errors: J(x.errors, []), warnings: J(x.warnings, []) }));
  res.json({ job: { ...j, common: J(j.common, {}) }, template: { name: tv.template_name, version: tv.version, roles: tv.roles, columns: columns(tv).map((c) => c.header), common: commonFields(tv) },
    summary: summary(j.id), rows, approval: E.roundState('bulk_job', j.id), approvals: all(`select a.*, u.name user_name from approvals a join users u on u.id=a.user_id where target_type='bulk_job' and target_id=? order by round,step_no`, j.id) });
});
// 개별 문서 미리보기 (발송 전): 해당 행 값으로 본문을 채워 보여 준다
r.get('/:id/preview', (req, res) => {
  const j = loadJob(req.user, req.params.id);
  const row = req.query.row ? get(`select * from bulk_rows where job_id=? and row_no=?`, j.id, req.query.row) : get(`select * from bulk_rows where job_id=? and status!='invalid' order by row_no limit 1`, j.id);
  if (!row) throw C.notFound('행이 없습니다');
  const tv = E.loadTV(j.template_version_id), data = J(row.data, {});
  const vals = { ...J(j.common, {}), ...data.vals };
  res.json({ row_no: row.row_no, title: data.__title || tv.template_name, body: P.fillBody(tv.body, vals), participants: data.participants.map((p) => ({ role: tv.roles.find((x) => x.key === p.role_key)?.label, name: p.name || (p.user_id ? get(`select name from users where id=?`, p.user_id)?.name : '회사 직인'), email: p.email, phone: p.phone })), errors: J(row.errors, []), warnings: J(row.warnings, []) });
});
r.put('/:id/common', wrap(async (req, res) => {
  const j = loadJob(req.user, req.params.id);
  if (j.created_by !== req.user.id || !['uploaded', 'validated'].includes(j.status)) throw C.conflict('발송 준비 단계에서만 공통값을 고칠 수 있습니다');
  const tv = E.loadTV(j.template_version_id);
  const common = {};
  for (const f of commonFields(tv)) { const v = req.body.common?.[f.key]; const e = E.checkValue(f, v); if (e) throw C.bad(e); if (v != null && v !== '') common[f.key] = v; }
  run(`update bulk_jobs set common=?, status=case when exists(select 1 from bulk_rows where job_id=? and status='invalid') then 'uploaded' else 'validated' end where id=?`, JSON.stringify(common), j.id, j.id);
  run(`update bulk_jobs set content_hash=? where id=?`, jobHash(j.id), j.id);
  res.json({ ok: true });
}));
// 오류 행을 빼고 진행
r.post('/:id/exclude-invalid', (req, res) => {
  const j = loadJob(req.user, req.params.id);
  if (j.created_by !== req.user.id || j.status !== 'uploaded') throw C.conflict('업로드 단계에서만 쓸 수 있습니다');
  run(`update bulk_rows set status='skipped' where job_id=? and status='invalid'`, j.id);
  run(`update bulk_jobs set status='validated' where id=?`, j.id);
  run(`update bulk_jobs set content_hash=? where id=?`, jobHash(j.id), j.id);
  res.json({ ok: true });
});
r.post('/:id/approval', wrap(async (req, res) => {
  const j = loadJob(req.user, req.params.id);
  if (j.status !== 'validated') throw C.conflict('검증이 끝난 작업만 결재를 올릴 수 있습니다');
  res.json({ round: E.submitApproval(req.user, 'bulk_job', j.id, { lineId: req.body.line_id, steps: req.body.steps }) });
}));
// 발송 시작: 행마다 큐 작업을 만든다. 두 번 눌러도 상태 확인과 dedupe 로 한 번만 처리된다.
r.post('/:id/start', wrap(async (req, res) => {
  C.need(req.user, 'bulk.send');
  const j = loadJob(req.user, req.params.id);
  if (j.created_by !== req.user.id) throw C.forbid('작업을 만든 사람만 발송할 수 있습니다');
  const rs = E.roundState('bulk_job', j.id);
  if (rs.round && (rs.state !== 'approved' || rs.rows.some((x) => x.target_hash !== jobHash(j.id)))) throw C.conflict('결재가 끝나지 않았거나 결재 후 내용이 바뀌었습니다');
  if (!rs.round && j.status !== 'validated') throw C.conflict(j.status === 'uploaded' ? '오류 행을 고치거나 제외한 뒤 발송하세요' : '이미 발송했거나 발송할 수 없는 상태입니다');
  if (rs.round && j.status !== 'approved') throw C.conflict('이미 발송했거나 발송할 수 없는 상태입니다');
  if (req.body.confirm !== true) throw C.bad('발송 확인이 필요합니다');
  const n = tx(() => {
    if (!run(`update bulk_jobs set status='running', started_at=datetime('now') where id=? and status in ('validated','approved')`, j.id).changes) throw C.conflict('이미 발송을 시작했습니다');
    const rows = all(`select id from bulk_rows where job_id=? and status='ready'`, j.id);
    for (const x of rows) { run(`update bulk_rows set status='queued' where id=?`, x.id); Q.enqueue('bulk_row', { rowId: x.id }, `bulkrow:${x.id}:0`); }
    return rows.length;
  });
  C.audit({ companyId: j.company_id, actor: C.actorOf(req.user), action: 'BULK_START', detail: { job: j.id, rows: n, hash: jobHash(j.id) }, ip: req.ip });
  res.json({ queued: n });
}));
r.post('/:id/retry-failed', wrap(async (req, res) => {
  const j = loadJob(req.user, req.params.id);
  if (j.created_by !== req.user.id) throw C.forbid();
  const n = tx(() => {
    const rows = all(`select id, attempts from bulk_rows where job_id=? and status='failed'`, j.id);
    for (const x of rows) { run(`update bulk_rows set status='queued' where id=?`, x.id); Q.enqueue('bulk_row', { rowId: x.id }, `bulkrow:${x.id}:${x.attempts}`); }
    if (rows.length) run(`update bulk_jobs set status='running', finished_at=null where id=?`, j.id);
    return rows.length;
  });
  C.audit({ companyId: j.company_id, actor: C.actorOf(req.user), action: 'BULK_RETRY', detail: { job: j.id, rows: n }, ip: req.ip });
  res.json({ queued: n });
}));
r.get('/:id/zip', wrap(async (req, res) => {
  const j = loadJob(req.user, req.params.id);
  const zip = new JSZip();
  const docs = all(`select * from documents where bulk_job_id=? and status='completed' order by bulk_row`, j.id).filter((d) => E.canViewDoc(req.user, d));
  for (const d of docs) {
    const fid = d.pdf_file_id || await P.finalize(d.id);
    zip.file(`${String(d.bulk_row).padStart(4, '0')}_${d.title.replace(/[\\/:*?"<>|]/g, '_')}_${d.id}.pdf`, F.readFile(fid).buf);
  }
  if (!docs.length) throw C.notFound('완료된 문서가 없습니다');
  C.audit({ companyId: j.company_id, actor: C.actorOf(req.user), action: 'BULK_ZIP', detail: { job: j.id, files: docs.length }, ip: req.ip });
  res.set({ 'content-type': 'application/zip', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(j.title + '_완료PDF.zip')}` });
  res.send(await zip.generateAsync({ type: 'nodebuffer' }));
}));
r.get('/:id/export.xlsx', wrap(async (req, res) => {
  const j = loadJob(req.user, req.params.id);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('진행 현황');
  ws.addRow(['행', '수신자', '연락처', '처리', '문서번호', '문서 상태', '오류·경고']).font = { bold: true };
  const RS = { ready: '대기', queued: '발송 중', sent: '발송 완료', failed: '실패', invalid: '오류', skipped: '제외' };
  for (const x of all(`select r.*, d.status ds from bulk_rows r left join documents d on d.id=r.document_id where job_id=? order by row_no`, j.id)) {
    const p = J(x.data, {}).participants?.find((y) => y.name) || {};
    ws.addRow([x.row_no, p.name || '', p.email || p.phone || '', RS[x.status] || x.status, x.document_id || '', x.ds ? E.STATUS[x.ds] : '', [...J(x.errors, []), ...J(x.warnings, []), x.last_error].filter(Boolean).join(' / ')]);
  }
  ws.columns.forEach((c, i) => { c.width = [6, 14, 26, 10, 10, 16, 60][i]; });
  res.set({ 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(j.title + '_진행현황.xlsx')}` });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

module.exports = r;
