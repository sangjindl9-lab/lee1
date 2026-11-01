// 공개 링크계약 접수 창구 (/api/l/:slug)
// 공개되는 것은 접수 안내뿐이다. 접속자마다 별도 문서를 만들고, 그 문서는 제출자 본인 토큰으로만 열린다.
// QR 접속·링크 접속만으로는 본인확인이나 교육 이수로 처리하지 않는다.
const express = require('express');
const crypto = require('crypto');
const { get, run, all, J } = require('../db');
const C = require('../core');
const E = require('../engine');
const wrap = require('../wrap');

const r = express.Router();
function load(slug) { const c = get(`select * from link_campaigns where slug=?`, slug); if (!c) throw C.notFound('접수 링크를 찾을 수 없습니다'); return c; }
function openState(c) {
  const now = Date.now();
  if (c.status === 'paused') return '접수가 잠시 중지되었습니다';
  if (c.status === 'closed') return '접수가 종료되었습니다';
  if (c.starts_at && Date.parse(c.starts_at) > now) return `접수 시작 전입니다 (${c.starts_at} 부터)`;
  if (c.ends_at && Date.parse(c.ends_at) < now) return '접수 기간이 끝났습니다';
  if (c.max_count && get(`select count(*) n from documents where link_campaign_id=? and status!='cancelled'`, c.id).n >= c.max_count) return '접수 인원이 다 찼습니다';
  return null;
}
r.get('/:slug', (req, res) => {
  const c = load(req.params.slug);
  const brand = E.brandOf(c.company_id);
  res.json({ title: c.title, intro: c.intro, site: c.site, auth: c.auth, privacy: J(c.privacy, []), closed: openState(c),
    company: { name: brand.name, logo: brand.logo || null, color: brand.color, contact: brand.contact || null }, period: { starts_at: c.starts_at, ends_at: c.ends_at } });
});

const phoneHash = (c, ph) => C.hmac(`lp:${c.id}:${C.normPhone(ph)}`);
function checkDup(c, ph) {
  if (c.dup_policy !== 'once_per_phone') return;
  const x = get(`select s.document_id from link_starts s join documents d on d.id=s.document_id where s.campaign_id=? and s.phone_hash=? and d.status!='cancelled'`, c.id, phoneHash(c, ph));
  if (x) throw C.conflict('이 전화번호로 이미 제출(또는 작성 중)한 기록이 있습니다. 담당자에게 문의하세요');
}

function makeDoc(c, st, ip) {
  const tv = E.loadTV(c.template_version_id);
  const ext = tv.roles.find((x) => x.kind === 'external');
  const owner = get(`select * from users where id=?`, c.created_by);
  const ownerId = owner?.status === 'active' ? owner.id : get(`select id from users where company_id=? and status='active' and role='admin' limit 1`, c.company_id).id;
  const vals = {};
  if (c.site && tv.fields.find((f) => f.key === 'site' && (f.owner || 'sender') === 'sender')) vals.site = c.site;
  const docId = E.createDocument({ companyId: c.company_id, user: null, ownerId, tvId: tv.id, title: `${c.title} - ${st.name}`, mode: 'link', vals,
    participants: tv.roles.map((ro) => (ro.kind === 'external' ? { role_key: ro.key, name: st.name, phone: st.phone, auth_method: c.auth === 'phone_otp' ? 'phone_otp' : 'link', delivery: 'none' } : { role_key: ro.key })),
    linkCampaignId: c.id, ip });
  const p = get(`select * from participants where document_id=? and role_key=?`, docId, ext.key);
  const how = c.auth === 'phone_otp' ? '휴대폰 인증번호(링크 접수)' : '본인 입력(인증 없음, 링크 접수)';
  run(`update participants set verified_at=${c.auth === 'phone_otp' ? "datetime('now')" : 'null'}, confirm_method=? where id=?`, how, p.id);
  C.audit({ companyId: c.company_id, documentId: docId, actor: { type: 'participant', id: p.id, name: st.name }, action: 'LINK_SUBMIT_START', detail: { campaign: c.id, consents: J(st.consents, []), confirm: how }, ip });
  E.sendDocument(null, docId, { system: true, ip });
  run(`update link_starts set document_id=? where id=?`, docId, st.id);
  return E.issueToken(p.id, 2);
}

r.post('/:slug/start', wrap(async (req, res) => {
  const c = load(req.params.slug);
  const closed = openState(c); if (closed) throw C.conflict(closed);
  const name = String(req.body.name || '').trim().slice(0, 30), phone = String(req.body.phone || '').trim();
  if (!name) throw C.bad('이름을 입력하세요');
  if (!C.PHONE_RE.test(phone)) throw C.bad('휴대폰 번호를 확인하세요');
  const privacy = J(c.privacy, []);
  const consents = Array.isArray(req.body.consents) ? req.body.consents : [];
  privacy.forEach((x, i) => { if (x.required && consents[i] !== true) throw C.bad(`필수 동의 항목에 동의해 주세요: ${x.text.slice(0, 30)}`); });
  checkDup(c, phone);
  const st = { id: Number(run(`insert into link_starts(campaign_id,phone_hash,name,phone,consents) values(?,?,?,?,?)`, c.id, phoneHash(c, phone), name, phone, JSON.stringify(consents)).lastInsertRowid), name, phone, consents: JSON.stringify(consents) };
  if (c.auth === 'none') return res.json({ token: makeDoc(c, st, req.ip) });
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  run(`update link_starts set otp_hash=?, otp_expires=? where id=?`, C.hmac(`lotp:${st.id}:${code}`), Date.now() + 5 * 60e3, st.id);
  C.notify({ companyId: c.company_id, channel: 'sms', to: phone, subject: '[이음사인] 인증번호', body: `${c.title} 인증번호 ${code} (5분 안에 입력)`, dedupe: `lotp:${st.id}` });
  res.json({ startId: st.id, startKey: C.hmac(`lstart:${st.id}`).slice(0, 32), sentTo: C.maskPhone(phone), ...(process.env.DEV_SHOW_OTP === '1' ? { devCode: code } : {}) });
}));
r.post('/:slug/verify', wrap(async (req, res) => {
  const c = load(req.params.slug);
  const closed = openState(c); if (closed) throw C.conflict(closed);
  const st = get(`select * from link_starts where id=? and campaign_id=?`, req.body.startId, c.id);
  if (!st || req.body.startKey !== C.hmac(`lstart:${st.id}`).slice(0, 32)) throw C.bad('처음부터 다시 진행해 주세요');
  if (st.document_id) throw C.conflict('이미 인증을 마쳤습니다. 받은 화면에서 이어서 작성하세요');
  if (!st.otp_hash || st.otp_expires < Date.now()) throw C.bad('인증번호를 다시 받아 주세요');
  if (C.hmac(`lotp:${st.id}:${String(req.body.code || '').trim()}`) !== st.otp_hash) throw C.bad('인증번호가 맞지 않습니다');
  run(`update link_starts set verified=1, otp_hash=null where id=?`, st.id);
  checkDup(c, st.phone);
  res.json({ token: makeDoc(c, st, req.ip) });
}));

module.exports = r;
