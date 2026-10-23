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

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  action text not null,
  summary text not null,
  ip text
);
`;

function createPool(url) {
  const ssl = /sslmode=require|\.rlwy\.net|railway/.test(url) && !/railway\.internal/.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: url, ssl, max: 5 });
}

async function migrate(pool) {
  await pool.query(SCHEMA);
}

module.exports = { createPool, migrate };
