// 작업 큐 (DB 테이블 기반). 대량 발송·Webhook 재전송·일정 알림·기한 만료를 처리한다.
// 같은 dedupe_key 작업은 한 번만 쌓이고, 각 작업은 다시 실행돼도 결과가 한 번만 생기게 짜여 있다.
const crypto = require('crypto');
const { all, get, run, tx, J } = require('./db');
const C = require('./core');
const E = require('./engine');

function enqueue(type, payload, dedupe = null, delayMs = 0) {
  return run(`insert or ignore into jobs(type,payload,run_at,dedupe_key) values(?,?,?,?)`, type, JSON.stringify(payload), Date.now() + delayMs, dedupe).changes;
}

// ── 대량계약 한 행 처리: 문서 생성(행당 하나, unique) → 발송(알림 dedupe)
async function bulkRow({ rowId }) {
  const row = get(`select * from bulk_rows where id=?`, rowId);
  const job = get(`select * from bulk_jobs where id=?`, row.job_id);
  if (['sent', 'invalid', 'skipped'].includes(row.status)) return;
  const creator = get(`select * from users where id=?`, job.created_by);
  const data = J(row.data, {});
  let docId = row.document_id || get(`select id from documents where bulk_job_id=? and bulk_row=?`, job.id, row.row_no)?.id;
  try {
    if (!docId) {
      try {
        docId = E.createDocument({
          companyId: job.company_id, user: creator, tvId: job.template_version_id, title: data.__title, mode: 'bulk',
          vals: { ...J(job.common, {}), ...data.vals }, participants: data.participants, bulkJobId: job.id, bulkRow: row.row_no, skipTemplateCheck: true, ownerId: data.ownerId || null,
        });
      } catch (e) {
        // 동시에 다른 작업자가 먼저 만들었으면 그 문서를 쓴다 (UNIQUE(bulk_job_id,bulk_row))
        docId = get(`select id from documents where bulk_job_id=? and bulk_row=?`, job.id, row.row_no)?.id;
        if (!docId) throw e;
      }
      run(`update bulk_rows set document_id=? where id=?`, docId, row.id);
    }
    const d = E.getDoc(docId);
    const prefix = `bulk:${job.id}:${row.row_no}`;
    if (d.status === 'draft') E.sendDocument(creator, docId, { system: true, dedupePrefix: prefix });
    else if (d.status === 'in_progress') E.notifyCurrent(docId, prefix);
    run(`update bulk_rows set status='sent', last_error=null, attempts=attempts+1 where id=?`, row.id);
  } catch (e) {
    run(`update bulk_rows set status='failed', last_error=?, attempts=attempts+1, document_id=coalesce(document_id,?) where id=?`, String(e.message).slice(0, 300), docId || null, row.id);
  }
  finishBulkIfDone(job.id);
}
function finishBulkIfDone(jobId) {
  const left = get(`select count(*) n from bulk_rows where job_id=? and status in ('queued')`, jobId).n;
  if (!left) run(`update bulk_jobs set status='done', finished_at=datetime('now') where id=? and status='running'`, jobId);
}

// ── Webhook 전송: 서명(HMAC-SHA256, "t=타임스탬프,v1=서명")과 지수 백오프 재전송
const BACKOFF = [10, 60, 300, 1800, 7200, 21600, 43200]; // 초
function signWebhook(secret, ts, body) { return crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex'); }
async function deliverOne(dl) {
  const w = get(`select * from webhooks where id=?`, dl.webhook_id);
  const ev = get(`select * from events where id=?`, dl.event_id);
  if (!w || !ev) return run(`update webhook_deliveries set status='failed', last_error='삭제됨' where id=?`, dl.id);
  const body = JSON.stringify({ id: ev.id, type: ev.type, created_at: ev.created_at, data: J(ev.payload, {}) });
  const ts = Math.floor(Date.now() / 1000);
  let code = null, err = null;
  try {
    const r = await fetch(w.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ieumsign-event-id': ev.id, 'x-ieumsign-event': ev.type, 'x-ieumsign-timestamp': String(ts), 'x-ieumsign-signature': `t=${ts},v1=${signWebhook(w.secret, ts, body)}` }, body, signal: AbortSignal.timeout(8000) });
    code = r.status;
  } catch (e) { err = e.message; }
  const attempts = dl.attempts + 1;
  if (code >= 200 && code < 300) run(`update webhook_deliveries set status='delivered', attempts=?, last_code=?, last_error=null, delivered_at=datetime('now') where id=?`, attempts, code, dl.id);
  else if (attempts > BACKOFF.length) run(`update webhook_deliveries set status='failed', attempts=?, last_code=?, last_error=? where id=?`, attempts, code, err, dl.id);
  else run(`update webhook_deliveries set status='retry', attempts=?, last_code=?, last_error=?, next_at=? where id=?`, attempts, code, err || `HTTP ${code}`, Date.now() + BACKOFF[attempts - 1] * 1000 * (Number(process.env.WEBHOOK_BACKOFF_SCALE) || 1), dl.id);
}

// ── 일정 알림 (완료된 계약도 종료일·갱신일 알림을 받는다. 취소 문서만 제외)
function todayKST() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
function runReminders(today = todayKST()) {
  let sent = 0;
  for (const s of all(`select s.*, d.title dtitle, d.creator_id, d.status dstatus from schedules s join documents d on d.id=s.document_id where s.done=0 and d.status!='cancelled'`)) {
    if (s.kind === 'sign_deadline' && ['completed', 'expired', 'rejected'].includes(s.dstatus)) continue;
    let date = s.date;
    if (s.repeat !== 'none' && date < today) {
      while (date < today) { const t = new Date(date + 'T00:00:00Z'); if (s.repeat === 'yearly') t.setUTCFullYear(t.getUTCFullYear() + 1); else t.setUTCMonth(t.getUTCMonth() + 1); date = t.toISOString().slice(0, 10); }
      run(`insert into schedule_history(schedule_id,changed_by,before_v,after_v) values(?,?,?,?)`, s.id, null, s.date, date);
      run(`update schedules set date=? where id=?`, date, s.id);
    }
    for (const n of J(s.remind_days, [])) {
      if (E.addDays(date, -Number(n)) !== today) continue;
      const subject = `[${s.title}] ${s.dtitle} — ${date} (${Number(n) === 0 ? '오늘' : `${n}일 전`})${s.dstatus === 'completed' ? ' · 완료 계약' : ''}`;
      for (const who of J(s.recipients, [])) {
        const targets = who === 'owner' ? [{ userId: s.creator_id }] : who === 'participants'
          ? all(`select email,phone from participants where document_id=? and kind='external'`, s.document_id).map((p) => ({ email: p.email, phone: p.phone }))
          : (typeof who === 'number' ? [{ userId: who }] : []);
        for (const t of targets) for (const ch of J(s.channels, [])) {
          const base = `rem:${s.id}:${date}:${n}:${t.userId || t.email || t.phone}:${ch}`;
          try {
            if (ch === 'inapp' && t.userId) C.notify({ companyId: s.company_id, channel: 'inapp', userId: t.userId, subject, body: `#/doc/${s.document_id}`, dedupe: base });
            else if (ch === 'email') { const to = t.email || get(`select email from users where id=?`, t.userId)?.email; if (to) C.notify({ companyId: s.company_id, channel: 'email', to, subject, body: subject, dedupe: base, documentId: s.document_id }); }
            else if (ch === 'sms' && t.phone) C.notify({ companyId: s.company_id, channel: 'sms', to: t.phone, subject, body: subject, dedupe: base, documentId: s.document_id });
            sent++;
          } catch { /* 개별 실패는 넘어감 */ }
        }
      }
    }
  }
  return sent;
}

let busy = false, lastDaily = '';
async function tick() {
  if (busy) return; busy = true;
  try {
    const jobs = all(`select * from jobs where status='queued' and run_at<=? order by id limit 50`, Date.now());
    for (const j of jobs) {
      if (!run(`update jobs set status='running', attempts=attempts+1 where id=? and status='queued'`, j.id).changes) continue;
      try {
        if (j.type === 'bulk_row') await bulkRow(J(j.payload, {}));
        run(`update jobs set status='done' where id=?`, j.id);
      } catch (e) { run(`update jobs set status='failed', last_error=? where id=?`, String(e.message).slice(0, 300), j.id); }
    }
    for (const dl of all(`select * from webhook_deliveries where status in ('pending','retry') and next_at<=? order by id limit 20`, Date.now())) await deliverOne(dl);
    const t = todayKST();
    if (t !== lastDaily) {
      lastDaily = t; E.expireOverdue(); runReminders(t);
      for (const d of all(`select id from documents where end_date is not null and status!='cancelled'`)) E.applyRules(d.id);
    }
  } finally { busy = false; }
}
let timer = null;
function start(ms = 300) { if (!timer) timer = setInterval(() => tick().catch((e) => console.error('queue', e)), ms); }
function stop() { clearInterval(timer); timer = null; }
async function drain(maxMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await tick();
    const n = get(`select count(*) n from jobs where status in ('queued','running')`).n + get(`select count(*) n from webhook_deliveries where status='pending' and next_at<=?`, Date.now()).n;
    if (!n) return true;
  }
  return false;
}
module.exports = { enqueue, start, stop, tick, drain, runReminders, signWebhook, todayKST, finishBulkIfDone };
