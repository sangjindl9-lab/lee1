import pg from 'pg';

const url = process.env.DATABASE_URL;
export const pool = url
  ? new pg.Pool({ connectionString: url, ssl: url.includes('railway.internal') || url.includes('localhost') ? false : { rejectUnauthorized: false }, max: 10 })
  : null;

export async function q(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL 이 설정되지 않았습니다');
  const r = await pool.query(text, params);
  return r.rows;
}

export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

/** 시작할 때 실행되는 스키마 (여러 번 실행해도 안전) */
export async function migrate() {
  await q(`
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    pw_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verify_code TEXT,
    verify_expires TIMESTAMPTZ,
    reset_code TEXT,
    reset_expires TIMESTAMPTZ,
    failed_logins INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('android','pc')),
    name TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT '',
    install_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ,
    last_ip TEXT,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (user_id, install_id)
  );

  CREATE TABLE IF NOT EXISTS device_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    ip TEXT
  );

  -- 모바일(android_id)이 PC(pc_id)에게 허용한 접근
  CREATE TABLE IF NOT EXISTS device_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    android_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    pc_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked')),
    folders JSONB NOT NULL DEFAULT '[]'::jsonb,
    read_only BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    UNIQUE (android_id, pc_id)
  );

  CREATE TABLE IF NOT EXISTS pair_codes (
    code TEXT PRIMARY KEY,
    android_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    folders JSONB NOT NULL DEFAULT '[]'::jsonb,
    read_only BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS file_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    from_device UUID,
    to_device UUID,
    direction TEXT NOT NULL,
    path TEXT NOT NULL,
    size BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'started',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS access_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID,
    device_id UUID,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    ip TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- 이후 단계(클라우드·동기화·공유)에서 사용할 테이블
  CREATE TABLE IF NOT EXISTS cloud_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    account_label TEXT NOT NULL DEFAULT '',
    token_enc TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL, target TEXT NOT NULL, mode TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sync_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES sync_jobs(id) ON DELETE CASCADE,
    path TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS shared_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target JSONB NOT NULL,
    pw_hash TEXT, expires_at TIMESTAMPTZ, max_downloads INT,
    downloads INT NOT NULL DEFAULT 0, permission TEXT NOT NULL DEFAULT 'read',
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS app_releases (
    id SERIAL PRIMARY KEY,
    platform TEXT NOT NULL,
    version TEXT NOT NULL,
    url TEXT NOT NULL,
    sha256 TEXT,
    size BIGINT,
    notes TEXT NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    downloads INT NOT NULL DEFAULT 0,
    UNIQUE (platform, version)
  );

  CREATE TABLE IF NOT EXISTS notices (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
  CREATE INDEX IF NOT EXISTS idx_logs_user ON access_logs(user_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_perm_pc ON device_permissions(pc_id);
  `);
}

export async function log(userId, deviceId, action, detail = '', ip = null) {
  try {
    await q('INSERT INTO access_logs(user_id, device_id, action, detail, ip) VALUES ($1,$2,$3,$4,$5)',
      [userId, deviceId, action, String(detail).slice(0, 500), ip]);
  } catch (e) { console.error('log fail', e.message); }
}
