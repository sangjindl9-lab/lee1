-- 003: 관리자·문의·공지·앱 버전·클라이언트 오류 보고
BEGIN;
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email CITEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','support','finance')), last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id), email TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
  app_version TEXT, platform TEXT, state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','closed')), answer TEXT, answered_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_tickets_state ON support_tickets(state, created_at DESC);
CREATE TABLE notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), locale TEXT NOT NULL DEFAULT 'ko', title TEXT NOT NULL, body TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT false, created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE TABLE app_versions (
  platform TEXT PRIMARY KEY, latest TEXT NOT NULL, min_supported TEXT NOT NULL, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
COMMIT;
