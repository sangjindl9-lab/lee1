'use strict';
const { Pool, types } = require('pg');
// date 컬럼은 문자열(YYYY-MM-DD) 그대로 — 시간대 변환으로 하루 밀리는 것을 막는다
types.setTypeParser(1082, (v) => v);

const SCHEMA = `
create extension if not exists pgcrypto;

create table if not exists customer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  biz_reg_no text not null unique,
  ceo_name text,
  contact_name text,
  phone text,
  email text,
  deployment text not null default 'HOSTED' check (deployment in ('HOSTED','ONPREM')),
  server_url text,
  activation_code text not null unique,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_active_users int,
  last_app_version text
);

create table if not exists license (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete restrict,
  license_id text not null unique,
  kind text not null check (kind in ('NEW','RENEW','CHANGE','SUSPEND','RESUME')),
  max_users int not null,
  starts_on date not null,
  expires_at date not null,
  edition text not null default 'standard',
  amount bigint not null default 0,
  memo text,
  license_text text not null,
  issued_at timestamptz not null default now()
);
create index if not exists license_customer_idx on license(customer_id, issued_at desc);
alter table license add column if not exists storage_mb int not null default 1024;
alter table customer add column if not exists last_used_mb int;
alter table customer add column if not exists last_storage_at timestamptz;

create table if not exists server_job (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references customer(id) on delete restrict,
  status text not null check (status in ('RUNNING','DONE','FAILED')),
  step text,
  input jsonb not null,
  data jsonb not null default '{}',
  secrets text not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists portal_setting (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists request (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customer(id) on delete set null,
  kind text not null check (kind in ('CUSTOMER','GLOBAL')),
  title text not null,
  screen text,
  deploy text,
  issue_number integer,
  issue_url text,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','DONE','DEPLOYED')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  deployed_at timestamptz,
  rollout_id uuid
);

alter table request add column if not exists req_type text;
alter table request add column if not exists priority text;
alter table request add column if not exists due_on date;
alter table request add column if not exists folder text;
alter table request add column if not exists files jsonb not null default '[]';

create table if not exists rollout (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scope text not null,
  results jsonb not null default '[]'
);

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  action text not null,
  summary text not null,
  ip text
);

-- ── 고객관리(영업·계약·과금·상담) ──
alter table customer add column if not exists stage text;
alter table customer add column if not exists address text;
alter table customer add column if not exists industry text;
alter table customer add column if not exists lead_source text;

create table if not exists contract (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  customer_id uuid not null references customer(id) on delete restrict,
  product text not null,
  deployment text not null check (deployment in ('HOSTED','ONPREM')),
  plan_id text,
  plan_name text,
  seats int not null default 1,
  options jsonb not null default '[]',
  starts_on date not null,
  ends_on date not null,
  bill_method text not null,
  pay_method text not null,
  pay_days int not null default 14,
  auto_renew boolean not null default true,
  discount int not null default 0,
  extra_once bigint not null default 0,
  annual_fee bigint not null default 0,
  once_fee bigint not null default 0,
  fee_detail jsonb not null default '[]',
  special text,
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING','SIGNED','TERMINATED')),
  signatures jsonb not null default '{}',
  doc_hash text,
  signed_at timestamptz,
  terminated_on date,
  renew_of uuid,
  license_row_id uuid references license(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contract_customer_idx on contract(customer_id);

create table if not exists invoice (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  customer_id uuid not null references customer(id) on delete restrict,
  contract_id uuid references contract(id) on delete set null,
  period text not null,
  issue_date date not null,
  due_date date not null,
  supply bigint not null default 0,
  vat bigint not null default 0,
  total bigint not null default 0,
  paid bigint not null default 0,
  paid_at date,
  payments jsonb not null default '[]',
  pay_method text,
  tax_invoice boolean not null default false,
  billed boolean not null default false,
  canceled boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoice_customer_idx on invoice(customer_id);

create table if not exists ticket (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete restrict,
  type text not null,
  title text not null,
  body text,
  opened_on date not null,
  due_on date,
  status text not null default '접수',
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 고객 ERP 의 '고장·수정 요청' 메뉴에서 들어온 건 (source = 'ERP')
alter table ticket add column if not exists source text not null default 'MANUAL';
alter table ticket add column if not exists requester text;
alter table ticket add column if not exists screen text;
alter table ticket add column if not exists reply text;
alter table ticket add column if not exists replied_at timestamptz;
alter table ticket add column if not exists request_id uuid;
create table if not exists ticket_file (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references ticket(id) on delete cascade,
  name text not null,
  mime text not null,
  size int not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
`;

function createPool(url) {
  const ssl = /sslmode=require|\.rlwy\.net|railway/.test(url) && !/railway\.internal/.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: url, ssl, max: 5 });
}

async function migrate(pool) {
  await pool.query(SCHEMA);
  // 2026-10-30 브랜드 변경: SS-ERP → 이음ERP, 공급사 ㈜에스에스전력 → 주식회사 이음소프트
  await pool.query(`update contract set product = '이음ERP' where product = 'SS-ERP'`);
  const [cfg] = (await pool.query(`select value from portal_setting where key = 'crm_config'`)).rows;
  if (cfg && /SS-ERP|에스에스전력/.test(cfg.value)) {
    const v = JSON.parse(cfg.value);
    if (v.provider?.name === '㈜에스에스전력') v.provider = { ...v.provider, name: '주식회사 이음소프트', bizNo: '', ceo: '' };
    for (const x of [...(v.plans ?? []), ...(v.options ?? [])]) if (x.product === 'SS-ERP') x.product = '이음ERP';
    await pool.query(`update portal_setting set value = $1, updated_at = now() where key = 'crm_config'`, [JSON.stringify(v)]);
  }
}

module.exports = { createPool, migrate };
