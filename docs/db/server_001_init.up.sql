-- 노트프로 서버 DB (PostgreSQL 15+) — 마이그레이션 001 (UP)
-- 2단계(동기화)에서 적용. 모든 표: 기본키, 외래키, created_at, updated_at, deleted_at(삭제 상태), 필요한 인덱스.
-- 개인 노트 내용(pen_strokes.points, attachments 파일)은 관리자 역할이 기본적으로 조회할 수 없도록 별도 스키마 권한 + 행 보안(RLS) 적용.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE,                     -- 로컬 전용 사용자는 서버에 없음
  email_verified_at TIMESTAMPTZ,
  password_hash TEXT,                      -- argon2id, 소셜 로그인만 쓰면 NULL
  google_sub TEXT UNIQUE, apple_sub TEXT UNIQUE,
  display_name TEXT, locale TEXT NOT NULL DEFAULT 'ko', country CHAR(2), time_zone TEXT,
  storage_quota_bytes BIGINT NOT NULL DEFAULT 2147483648, storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);

CREATE TABLE user_devices (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL CHECK (platform IN ('android','ios','windows','web','macos','linux','eink')),
  model TEXT, app_version TEXT, refresh_token_hash TEXT, last_seen_at TIMESTAMPTZ, last_sync_seq BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_devices_user ON user_devices(user_id) WHERE deleted_at IS NULL;

CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID REFERENCES user_devices(id),  -- NULL = 계정 공통, 값 = 기기별 예외
  settings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  UNIQUE (user_id, device_id)
);

CREATE TABLE notebook_folders (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), parent_id UUID REFERENCES notebook_folders(id),
  name TEXT NOT NULL, rev BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_folders_user ON notebook_folders(user_id, parent_id);

CREATE TABLE notebooks (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), folder_id UUID REFERENCES notebook_folders(id),
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cover_color INT NOT NULL, favorite BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false, is_infinite BOOLEAN NOT NULL DEFAULT false, rev BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_notebooks_user ON notebooks(user_id, updated_at DESC);

CREATE TABLE attachments (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), notebook_id UUID NOT NULL REFERENCES notebooks(id),
  kind TEXT NOT NULL, file_name TEXT NOT NULL, mime TEXT NOT NULL, size BIGINT NOT NULL, sha256 CHAR(64) NOT NULL,
  object_key TEXT NOT NULL,                -- S3 호환 저장소 키 (내용 주소: sha256 기반 중복 제거)
  upload_state TEXT NOT NULL DEFAULT 'pending' CHECK (upload_state IN ('pending','partial','complete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_attachments_nb ON attachments(notebook_id);
CREATE INDEX idx_attachments_sha ON attachments(user_id, sha256);

CREATE TABLE pages (
  id UUID PRIMARY KEY, notebook_id UUID NOT NULL REFERENCES notebooks(id), page_index INT NOT NULL,
  width REAL NOT NULL, height REAL NOT NULL, paper TEXT NOT NULL, template TEXT NOT NULL,
  bg_type SMALLINT NOT NULL DEFAULT 0, attachment_id UUID REFERENCES attachments(id), pdf_page INT NOT NULL DEFAULT -1,
  rev BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_pages_nb ON pages(notebook_id, page_index) WHERE deleted_at IS NULL;

-- 텍스트 상자·이미지·도형 등 획 이외 요소(3단계)
CREATE TABLE page_elements (
  id UUID PRIMARY KEY, page_id UUID NOT NULL REFERENCES pages(id), kind TEXT NOT NULL, z INT NOT NULL DEFAULT 0,
  data JSONB NOT NULL, attachment_id UUID REFERENCES attachments(id), author TEXT NOT NULL DEFAULT 'user' CHECK (author IN ('user','ai')),
  rev BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_elements_page ON page_elements(page_id);

CREATE TABLE pen_strokes (
  id UUID PRIMARY KEY, page_id UUID NOT NULL REFERENCES pages(id), notebook_id UUID NOT NULL REFERENCES notebooks(id),
  pen SMALLINT NOT NULL, color INT NOT NULL, width REAL NOT NULL, opacity REAL NOT NULL, shape SMALLINT NOT NULL DEFAULT 0,
  points BYTEA NOT NULL,                   -- 클라이언트와 동일한 NPS1 이진 형식(CRC32 포함)
  rev BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_strokes_page ON pen_strokes(page_id) WHERE deleted_at IS NULL;

CREATE TABLE document_versions (
  id UUID PRIMARY KEY, notebook_id UUID NOT NULL REFERENCES notebooks(id), reason TEXT NOT NULL,
  object_key TEXT NOT NULL, size BIGINT NOT NULL, sha256 CHAR(64) NOT NULL, page_count INT NOT NULL, stroke_count INT NOT NULL,
  expires_at TIMESTAMPTZ,                  -- 요금제별 보관 기간
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_versions_nb ON document_versions(notebook_id, created_at DESC);

-- 동기화 작업 기록: op_id 가 전역 고유 → 같은 작업을 두 번 보내도 한 번만 반영(멱등)
CREATE TABLE sync_operations (
  op_id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), device_id UUID NOT NULL REFERENCES user_devices(id),
  seq BIGSERIAL UNIQUE,                    -- 서버 수신 순번(기기는 마지막 seq 이후만 받아감)
  notebook_id UUID, page_id UUID, entity_type TEXT NOT NULL, entity_id UUID NOT NULL, op_type TEXT NOT NULL,
  base_rev BIGINT, new_rev BIGINT, payload BYTEA, client_created_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_syncops_user_seq ON sync_operations(user_id, seq);

CREATE TABLE sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL, entity_id UUID NOT NULL, local_op_id UUID REFERENCES sync_operations(op_id), remote_op_id UUID REFERENCES sync_operations(op_id),
  kept_copy_entity_id UUID,                -- 양쪽 보존: 진 쪽을 복사본으로 저장
  resolution TEXT NOT NULL DEFAULT 'both_kept' CHECK (resolution IN ('both_kept','merged','user_resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_conflicts_user ON sync_conflicts(user_id, created_at DESC);

CREATE TABLE backup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), device_id UUID REFERENCES user_devices(id),
  kind TEXT NOT NULL CHECK (kind IN ('auto','manual')), state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
  object_key TEXT, size BIGINT, sha256 CHAR(64), error TEXT, finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_backup_user ON backup_jobs(user_id, created_at DESC);

CREATE TABLE templates (
  id UUID PRIMARY KEY, user_id UUID REFERENCES users(id),   -- NULL = 기본 제공 템플릿
  name TEXT NOT NULL, category TEXT NOT NULL, width REAL NOT NULL, height REAL NOT NULL, data BYTEA NOT NULL, premium BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);

CREATE TABLE tags (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
  notebook_id UUID NOT NULL REFERENCES notebooks(id), tag_id UUID NOT NULL REFERENCES tags(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (notebook_id, tag_id)
);
CREATE INDEX idx_note_tags_tag ON note_tags(tag_id);

CREATE TABLE recordings (
  id UUID PRIMARY KEY, notebook_id UUID NOT NULL REFERENCES notebooks(id), attachment_id UUID NOT NULL REFERENCES attachments(id),
  started_at TIMESTAMPTZ NOT NULL, duration_ms BIGINT NOT NULL, consent_at TIMESTAMPTZ NOT NULL, transcript_element_id UUID REFERENCES page_elements(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_recordings_nb ON recordings(notebook_id);

CREATE TABLE ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), feature TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, notebook_id UUID REFERENCES notebooks(id),
  input_tokens INT, output_tokens INT, cost_micro_usd BIGINT, tier TEXT NOT NULL CHECK (tier IN ('free','paid')),
  state TEXT NOT NULL CHECK (state IN ('queued','done','failed')), error TEXT, consent_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_ai_user_day ON ai_requests(user_id, created_at);
CREATE INDEX idx_ai_feature ON ai_requests(feature, created_at);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), plan TEXT NOT NULL,
  store TEXT NOT NULL CHECK (store IN ('google_play','app_store','web')), state TEXT NOT NULL CHECK (state IN ('active','grace','paused','expired','canceled')),
  current_period_end TIMESTAMPTZ, entitlements JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_subs_user ON subscriptions(user_id, state);

CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), subscription_id UUID REFERENCES subscriptions(id),
  store TEXT NOT NULL, product_id TEXT NOT NULL, purchase_token TEXT NOT NULL UNIQUE, amount_micros BIGINT, currency CHAR(3),
  state TEXT NOT NULL, verified_at TIMESTAMPTZ, raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_purchases_user ON purchases(user_id, created_at DESC);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY, actor_type TEXT NOT NULL CHECK (actor_type IN ('user','admin','system')), actor_id UUID,
  action TEXT NOT NULL, target_type TEXT, target_id UUID, ip INET, user_agent TEXT, detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_audit_actor ON audit_logs(actor_type, actor_id, created_at DESC);

CREATE TABLE app_errors (
  id BIGSERIAL PRIMARY KEY, user_id UUID REFERENCES users(id), device_id UUID REFERENCES user_devices(id),
  platform TEXT NOT NULL, app_version TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, stack TEXT, fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_errors_fp ON app_errors(fingerprint, created_at DESC);

-- 사용자별 데이터 격리(행 보안): API 서버는 요청마다 SET app.user_id 후 조회
ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY notebooks_owner ON notebooks USING (user_id = current_setting('app.user_id')::uuid);
ALTER TABLE pen_strokes ENABLE ROW LEVEL SECURITY;
CREATE POLICY strokes_owner ON pen_strokes USING (notebook_id IN (SELECT id FROM notebooks));
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY pages_owner ON pages USING (notebook_id IN (SELECT id FROM notebooks));
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachments_owner ON attachments USING (user_id = current_setting('app.user_id')::uuid);
-- 관리자 역할(notepro_admin)에는 위 4개 표 SELECT 권한을 주지 않는다 → 통계는 집계 뷰로만 제공
COMMIT;
