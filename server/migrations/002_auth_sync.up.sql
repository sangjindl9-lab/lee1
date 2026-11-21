-- 002: 인증 토큰, 충돌 상세, 기기 동기화 위치
BEGIN;
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), device_id UUID NOT NULL REFERENCES user_devices(id),
  token_hash CHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, replaced_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
CREATE TABLE email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')), token_hash CHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
ALTER TABLE sync_conflicts ADD COLUMN detail JSONB;
ALTER TABLE user_devices ADD COLUMN name TEXT;
CREATE TABLE file_chunks (
  user_id UUID NOT NULL REFERENCES users(id), sha256 CHAR(64) NOT NULL, idx INT NOT NULL, total INT NOT NULL, size INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, sha256, idx)
);
CREATE TABLE stored_files (
  user_id UUID NOT NULL REFERENCES users(id), sha256 CHAR(64) NOT NULL, size BIGINT NOT NULL, object_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, sha256)
);
ALTER TABLE attachments ALTER COLUMN object_key DROP NOT NULL;
COMMIT;
