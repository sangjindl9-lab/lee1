// 이음사인 데이터베이스 (SQLite, node:sqlite 내장 모듈)
// 운영: DATA_DIR 볼륨에 ieumsign.db 와 files/ 를 둔다.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'ieumsign.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

const SCHEMA = `
create table if not exists meta (k text primary key, v text);
create table if not exists companies (
  id integer primary key, name text not null, biz_no text, brand text not null default '{}',
  settings text not null default '{}', created_at text not null default (datetime('now')));
create table if not exists departments (id integer primary key, company_id integer not null references companies(id), name text not null);
create table if not exists groups_ (id integer primary key, company_id integer not null references companies(id), name text not null);
create table if not exists group_members (group_id integer not null references groups_(id), user_id integer not null, primary key(group_id,user_id));
create table if not exists users (
  id integer primary key, company_id integer not null references companies(id), dept_id integer references departments(id),
  email text not null unique, name text not null, pw_hash text not null, role text not null default 'member',
  perms text not null default '[]', status text not null default 'active', phone text,
  created_at text not null default (datetime('now')), retired_at text);
create table if not exists sessions (token_hash text primary key, user_id integer not null references users(id), expires_at integer not null);
create table if not exists files (
  id integer primary key, company_id integer not null, name text not null, mime text not null, size integer not null,
  sha256 text not null, path text not null, origin text not null default 'upload', origin_ref text,
  created_at text not null default (datetime('now')));

create table if not exists templates (
  id integer primary key, company_id integer not null, owner_id integer not null references users(id),
  scope text not null default 'personal', name text not null, doc_type text, current_version integer not null default 1,
  archived integer not null default 0, created_at text not null default (datetime('now')));
create table if not exists template_versions (
  id integer primary key, template_id integer not null references templates(id), version integer not null,
  body text not null, fields text not null, roles text not null, attachments_spec text not null default '{}',
  base_file_id integer references files(id), created_by integer, created_at text not null default (datetime('now')),
  unique(template_id, version));
create table if not exists template_shares (template_id integer not null references templates(id), target_type text not null, target_id integer not null, primary key(template_id,target_type,target_id));

create table if not exists documents (
  id integer primary key, company_id integer not null references companies(id), template_version_id integer not null references template_versions(id),
  title text not null, mode text not null, status text not null default 'draft',
  creator_id integer references users(id), dept_id integer, site text, partner text, doc_type text,
  amount integer, start_date text, end_date text, sign_deadline text,
  vals text not null default '{}', version integer not null default 1, content_hash text,
  delivery text not null default '{}', base_file_id integer references files(id),
  link_campaign_id integer, bulk_job_id integer, bulk_row integer,
  pdf_file_id integer, completed_at text, cancelled_reason text,
  created_at text not null default (datetime('now')), updated_at text not null default (datetime('now')),
  unique(bulk_job_id, bulk_row));
create index if not exists ix_doc_company on documents(company_id, status);
create table if not exists doc_attachments (
  id integer primary key, document_id integer not null references documents(id), file_id integer not null references files(id),
  kind text not null default 'other', caption text, sort integer not null default 0, added_by text);
create table if not exists participants (
  id integer primary key, document_id integer not null references documents(id), order_no integer not null,
  role_key text not null, role_label text not null, kind text not null, user_id integer,
  name text not null, email text, phone text, status text not null default 'waiting',
  token_hash text, token_expires integer, auth_method text not null default 'link',
  otp_hash text, otp_expires integer, verified_at text, confirm_method text, confirmed_by integer,
  vals text not null default '{}', sign_image text, sign_kind text, signed_at text, viewed_at text,
  ip text, ua text, reject_reason text, delivery text);

create table if not exists approval_lines (id integer primary key, company_id integer not null, name text not null, steps text not null, created_by integer);
create table if not exists approval_rules (id integer primary key, company_id integer not null, name text not null, sort integer not null default 0,
  conditions text not null, line_id integer not null references approval_lines(id), active integer not null default 1);
create table if not exists approvals (
  id integer primary key, company_id integer not null, target_type text not null, target_id integer not null, round integer not null,
  step_no integer not null, user_id integer not null references users(id), kind text not null default 'approve',
  status text not null default 'waiting', comment text, acted_at text, target_version integer, target_hash text);
create index if not exists ix_appr on approvals(target_type, target_id, round);

create table if not exists seals (id integer primary key, company_id integer not null, name text not null, image text not null,
  status text not null default 'pending', registered_by integer, approved_by integer, retired_by integer, created_at text not null default (datetime('now')));
create table if not exists seal_policies (id integer primary key, company_id integer not null, seal_id integer not null references seals(id),
  template_id integer not null, template_version integer not null, user_ids text not null, max_amount integer, status text not null default 'pending',
  created_by integer, approved_by integer, created_at text not null default (datetime('now')));
create table if not exists seal_usages (id integer primary key, company_id integer not null, seal_id integer not null, document_id integer,
  participant_id integer, user_id integer, kind text not null, policy_id integer, representative_approved integer not null default 0,
  note text, at text not null default (datetime('now')));

create table if not exists link_campaigns (
  id integer primary key, company_id integer not null, template_version_id integer not null, slug text not null unique,
  title text not null, intro text, starts_at text, ends_at text, max_count integer, auth text not null default 'phone_otp',
  dup_policy text not null default 'once_per_phone', privacy text not null default '[]', after_msg text,
  review_required integer not null default 0, status text not null default 'active', site text,
  created_by integer, created_at text not null default (datetime('now')));
create table if not exists link_starts (id integer primary key, campaign_id integer not null, phone_hash text, otp_hash text, otp_expires integer,
  name text, phone text, consents text, verified integer not null default 0, document_id integer, created_at text not null default (datetime('now')));

create table if not exists bulk_jobs (
  id integer primary key, company_id integer not null, template_version_id integer not null, created_by integer not null,
  title text not null, status text not null default 'uploaded', common text not null default '{}', total integer not null default 0,
  approval_line text, refs text not null default '[]', content_hash text, created_at text not null default (datetime('now')),
  started_at text, finished_at text);
create table if not exists bulk_rows (
  id integer primary key, job_id integer not null references bulk_jobs(id), row_no integer not null, data text not null,
  errors text not null default '[]', warnings text not null default '[]', status text not null default 'ready',
  document_id integer, last_error text, attempts integer not null default 0, unique(job_id,row_no));

create table if not exists jobs (
  id integer primary key, type text not null, payload text not null, status text not null default 'queued',
  attempts integer not null default 0, run_at integer not null, dedupe_key text unique, last_error text,
  created_at text not null default (datetime('now')));
create index if not exists ix_jobs on jobs(status, run_at);

create table if not exists outbox (
  id integer primary key, company_id integer, channel text not null, to_addr text, user_id integer, subject text, body text,
  dedupe_key text unique, status text not null, error text, document_id integer, created_at text not null default (datetime('now')));
create table if not exists inbox (id integer primary key, user_id integer not null, title text not null, link text, read_at text, created_at text not null default (datetime('now')));

create table if not exists audit_logs (
  id integer primary key, company_id integer not null, document_id integer, actor_type text not null, actor_id integer,
  actor_name text, action text not null, detail text, ip text, at text not null, prev_hash text, hash text not null);
create index if not exists ix_audit_doc on audit_logs(document_id);

create table if not exists folders (id integer primary key, company_id integer not null, name text not null, unique(company_id,name));
create table if not exists doc_folders (document_id integer not null, folder_id integer not null, source text not null default 'manual', primary key(document_id,folder_id));
create table if not exists doc_tags (document_id integer not null, tag text not null, source text not null default 'manual', primary key(document_id,tag));
create table if not exists class_rules (id integer primary key, company_id integer not null, name text not null, cond text not null, action text not null,
  active integer not null default 1, sort integer not null default 0);

create table if not exists schedules (
  id integer primary key, company_id integer not null, document_id integer not null, kind text not null, title text not null, date text not null,
  source text not null default 'auto', remind_days text not null default '[7,1]', recipients text not null default '["owner"]',
  channels text not null default '["inapp","email"]', repeat text not null default 'none', done integer not null default 0,
  updated_by integer, updated_at text);
create table if not exists schedule_history (id integer primary key, schedule_id integer not null, changed_by integer, before_v text, after_v text, at text not null default (datetime('now')));

create table if not exists comments (
  id integer primary key, document_id integer not null, parent_id integer, visibility text not null, author_type text not null,
  author_id integer, author_name text not null, body text not null, attachments text not null default '[]', mentions text not null default '[]',
  created_at text not null default (datetime('now')), edited_at text, deleted_at text);
create table if not exists comment_revisions (id integer primary key, comment_id integer not null, body text, action text not null, by_name text, at text not null default (datetime('now')));
create table if not exists comment_reads (comment_id integer not null, reader text not null, primary key(comment_id, reader));

create table if not exists api_keys (id integer primary key, company_id integer not null, name text not null, prefix text not null, key_hash text not null unique,
  scopes text not null, rate_per_min integer not null default 60, created_by integer, created_at text not null default (datetime('now')), revoked_at text, last_used_at text);
create table if not exists idempotency (company_id integer not null, idem_key text not null, route text not null, req_hash text not null,
  status_code integer, response text, created_at text not null default (datetime('now')), primary key(company_id, idem_key));
create table if not exists events (id text primary key, company_id integer not null, document_id integer, type text not null, payload text not null,
  created_at text not null default (datetime('now')));
create table if not exists webhooks (id integer primary key, company_id integer not null, url text not null, secret text not null, events text not null,
  active integer not null default 1, created_at text not null default (datetime('now')));
create table if not exists webhook_deliveries (id integer primary key, webhook_id integer not null, event_id text not null, status text not null default 'pending',
  attempts integer not null default 0, next_at integer not null, last_code integer, last_error text, delivered_at text, unique(webhook_id, event_id));
`;
db.exec(SCHEMA);
// 이후 추가된 열 (기존 DB 호환)
for (const [t, c] of [['sessions', 'locked integer not null default 0']]) { try { db.exec(`alter table ${t} add column ${c}`); } catch { /* 이미 있음 */ } }

// 작은 도우미
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const J = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

module.exports = { db, all, get, run, tx, J, DATA_DIR };
