// 외부 서명자 API (/api/s/:token). 토큰 하나 = 참여자 한 명. 로그인 쿠키를 쓰지 않는다.
// 응답에는 그 참여자에게 허용된 것만 담는다: 내부 메모·다른 참여자의 개인정보·내부 결재 정보는 없다.
const express = require('express');
const crypto = require('crypto');
const { all, get, run, J } = require('../db');
const C = require('../core');
const E = require('../engine');
const F = require('../files');
const wrap = require('../wrap');

const r = express.Router();
function byToken(raw) {
  if (!raw || raw.length < 20) throw C.notFound('서명 링크가 올바르지 않습니다');
  const p = get(`select * from participants where token_hash=?`, C.sha256(raw));
  if (!p || p.token_expires < Date.now()) throw C.notFound('서명 링크가 만료되었거나 이미 사용되었습니다');
  return { p, d: E.getDoc(p.document_id) };
}
const needVerify = (p, d) => p.kind === 'external' && p.auth_method !== 'link' && !p.verified_at && d.mode !== 'inperson';
const MODE = { remote: '비대면계약', inperson: '대면계약', link: '링크계약', bulk: '대량계약' };

r.get('/:token', (req, res) => {
  const { p, d } = byToken(req.params.token);
  const brand = E.brandOf(d.company_id);
  const base = { company: { name: brand.name, logo: brand.logo || null, color: brand.color, contact: brand.contact || null, request_msg: brand.request_msg || null, done_msg: brand.done_msg || null },
    doc: { title: d.title, status: d.status, status_label: E.STATUS[d.status], mode: d.mode, mode_label: MODE[d.mode], sign_deadline: d.sign_deadline },
    me: { name: p.name, role: p.role_label, status: p.status, auth_method: p.auth_method, verified: !needVerify(p, d), contact: p.auth_method === 'email_otp' ? p.email : C.maskPhone(p.phone) } };
  if (needVerify(p, d)) return res.json({ ...base, needVerify: true });
  if (!p.viewed_at) { run(`update participants set viewed_at=datetime('now') where id=?`, p.id); C.audit({ companyId: d.company_id, documentId: d.id, actor: { type: 'participant', id: p.id, name: p.name }, action: 'PARTICIPANT_VIEW', ip: req.ip }); }
  const view = E.participantView(p, d);
  res.json({
    ...base, body: view.body, vals: view.vals, fields: view.fields,
    participants: all(`select id, role_label, name, status, signed_at, kind from participants where document_id=? order by order_no,id`, d.id).map((q) => ({ role: q.role_label, name: q.kind === 'external' && q.id !== p.id ? q.name.slice(0, 1) + '*'.repeat(Math.max(q.name.length - 1, 1)) : q.name, status: q.status, signed: !!q.signed_at })),
    attachments: all(`select a.id, a.kind, a.caption, f.name, f.mime from doc_attachments a join files f on f.id=a.file_id where a.document_id=? order by a.sort,a.id`, d.id),
    has_base: !!d.base_file_id, has_pdf: d.status === 'completed' && !!d.pdf_file_id,
  });
});

// 본인 인증 (이메일·휴대폰 인증번호). 실제 문자·메일 발송은 외부 연결이 있어야 하며, 없으면 발송함에만 기록된다.
r.post('/:token/otp', wrap(async (req, res) => {
  const { p, d } = byToken(req.params.token);
  if (!needVerify(p, d)) return res.json({ ok: true, already: true });
  if (p.otp_expires && p.otp_expires - 4 * 60e3 > Date.now()) throw new C.HttpError(429, '1분 뒤에 다시 요청하세요');
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  run(`update participants set otp_hash=?, otp_expires=? where id=?`, C.hmac(`otp:${p.id}:${code}`), Date.now() + 5 * 60e3, p.id);
  const ch = p.auth_method === 'email_otp' ? 'email' : 'sms';
  C.notify({ companyId: d.company_id, channel: ch, to: ch === 'email' ? p.email : p.phone, subject: '[이음사인] 인증번호', body: `인증번호 ${code} (5분 안에 입력)`, dedupe: `otp:${p.id}:${Date.now()}`, documentId: d.id });
  res.json({ ok: true, sentTo: ch === 'email' ? p.email : C.maskPhone(p.phone), ...(process.env.DEV_SHOW_OTP === '1' ? { devCode: code } : {}) });
}));
r.post('/:token/verify', wrap(async (req, res) => {
  const { p, d } = byToken(req.params.token);
  if (!p.otp_hash || p.otp_expires < Date.now()) throw C.bad('인증번호를 다시 받아 주세요');
  if (C.hmac(`otp:${p.id}:${String(req.body.code || '').trim()}`) !== p.otp_hash) throw C.bad('인증번호가 맞지 않습니다');
  run(`update participants set verified_at=datetime('now'), otp_hash=null, confirm_method=? where id=?`, p.auth_method === 'email_otp' ? '이메일 인증번호' : '휴대폰 인증번호', p.id);
  C.audit({ companyId: d.company_id, documentId: d.id, actor: { type: 'participant', id: p.id, name: p.name }, action: 'PARTICIPANT_VERIFY', detail: { method: p.auth_method }, ip: req.ip });
  res.json({ ok: true });
}));

r.post('/:token/sign', wrap(async (req, res) => {
  const { p, d } = byToken(req.params.token);
  if (needVerify(p, d)) throw C.forbid('본인 인증이 먼저 필요합니다');
  if (p.kind !== 'external') throw C.forbid();
  await E.signParticipant(p.id, { vals: req.body.vals, image: req.body.image, agree: req.body.agree, ip: req.ip, ua: req.headers['user-agent'] });
  const after = E.getDoc(d.id);
  const camp = after.link_campaign_id ? get(`select after_msg from link_campaigns where id=?`, after.link_campaign_id) : null;
  res.json({ ok: true, status: after.status, status_label: E.STATUS[after.status], after_msg: camp?.after_msg || null, inperson: d.mode === 'inperson' });
}));
r.post('/:token/reject', wrap(async (req, res) => {
  const { p } = byToken(req.params.token);
  E.rejectParticipant(p.id, req.body.reason, req.ip); res.json({ ok: true });
}));

function guard(req) { const x = byToken(req.params.token); if (needVerify(x.p, x.d)) throw C.forbid('본인 인증이 먼저 필요합니다'); return x; }
r.get('/:token/att/:aid', (req, res) => {
  const { d } = guard(req);
  const a = get(`select * from doc_attachments where id=? and document_id=?`, req.params.aid, d.id); if (!a) throw C.notFound();
  const f = F.readFile(a.file_id); res.set({ 'content-type': f.mime, 'cache-control': 'no-store' }); res.send(f.buf);
});
r.get('/:token/base', (req, res) => {
  const { d } = guard(req); if (!d.base_file_id) throw C.notFound();
  const f = F.readFile(d.base_file_id); res.set({ 'content-type': f.mime, 'cache-control': 'no-store' }); res.send(f.buf);
});
r.get('/:token/pdf', (req, res) => {
  const { p, d } = guard(req);
  if (d.status !== 'completed' || !d.pdf_file_id) throw C.notFound('완료된 문서가 아닙니다');
  C.audit({ companyId: d.company_id, documentId: d.id, actor: { type: 'participant', id: p.id, name: p.name }, action: 'PDF_DOWNLOAD', ip: req.ip });
  const f = F.readFile(d.pdf_file_id);
  res.set({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.title + '.pdf')}`, 'cache-control': 'no-store' }); res.send(f.buf);
});

// 참여자 공유 의견만 보여 주고 쓸 수 있다. 내부 메모(visibility=internal)는 서버에서 제외한다.
r.get('/:token/comments', (req, res) => {
  const { p, d } = guard(req);
  res.json(all(`select id,parent_id,author_type,author_name,body,created_at,edited_at,deleted_at from comments where document_id=? and visibility='shared' order by id`, d.id)
    .map((c) => ({ ...c, body: c.deleted_at ? '(삭제된 의견)' : c.body, mine: c.author_type === 'participant' && c.author_name === p.name })));
});
r.post('/:token/comments', wrap(async (req, res) => {
  const { p, d } = guard(req);
  const body = String(req.body.body || '').trim().slice(0, 2000); if (!body) throw C.bad('내용을 입력하세요');
  if (req.body.parent_id && !get(`select 1 from comments where id=? and document_id=? and visibility='shared'`, req.body.parent_id, d.id)) throw C.bad('답글을 달 수 없는 의견입니다');
  const id = Number(run(`insert into comments(document_id,parent_id,visibility,author_type,author_id,author_name,body) values(?,?,'shared','participant',?,?,?)`, d.id, req.body.parent_id || null, p.id, p.name, body).lastInsertRowid);
  run(`insert into comment_revisions(comment_id,body,action,by_name) values(?,?,'create',?)`, id, body, p.name);
  if (d.creator_id) C.notify({ companyId: d.company_id, channel: 'inapp', userId: d.creator_id, subject: `[참여자 의견] ${d.title} — ${p.name}`, body: `#/doc/${d.id}`, dedupe: `cmt:${id}:${d.creator_id}` });
  res.status(201).json({ id });
}));

module.exports = r;
