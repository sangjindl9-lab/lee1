-- EUM 3D STUDIO PRO 스키마 (PostgreSQL 14+)
-- 회사별 데이터 격리: 모든 업무 테이블에 company_id + Row Level Security.
-- 앱의 일반 요청은 SET LOCAL ROLE eum_app + app.company_id 설정 후 실행되므로
-- 쿼리에 WHERE company_id 를 빠뜨려도 다른 회사 행은 보이지도, 수정되지도 않는다.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eum_app') THEN CREATE ROLE eum_app NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  brand jsonb NOT NULL DEFAULT '{}',            -- 화이트라벨: 프로그램명·로고 (4단계)
  limits jsonb NOT NULL DEFAULT '{"storage_mb":5120,"render_minutes":600,"users":20}',
  features jsonb NOT NULL DEFAULT '{}',
  external_ai_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  industry text NOT NULL DEFAULT 'machine' CHECK (industry IN ('mold','machine','electric','building','product')),
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  size bigint NOT NULL,
  received bigint NOT NULL DEFAULT 0,
  next_chunk int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 원본 파일: 절대 덮어쓰지 않고 같은 이름이면 version 증가
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  ext text NOT NULL,
  size bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'uploaded',      -- uploaded|analyzing|analyzed|converted|failed
  analysis jsonb,
  error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 시각화 모델 (GLB). 원본 파일 ID·버전을 반드시 연결
CREATE TABLE IF NOT EXISTS models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  source_file_version int NOT NULL,
  name text NOT NULL,
  method text NOT NULL,                         -- step-brep-tessellation|stl-mesh|glb-import|dxf-extrude
  glb_key text,
  parts jsonb NOT NULL DEFAULT '[]',            -- 부품 트리
  stats jsonb NOT NULL DEFAULT '{}',
  provenance jsonb NOT NULL DEFAULT '{}',       -- 원본확인/사용자입력/AI추정/생성불가 구분
  created_at timestamptz NOT NULL DEFAULT now()
);

-- AI 추정 형상 검토·승인 (n/a: 검토 불필요, pending: 검토 대기, approved/rejected)
ALTER TABLE models ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'n/a';
ALTER TABLE models ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE models ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE models ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- 프로젝트 저장: 분해 설정·재질·카메라·애니메이션 (버전 누적)
CREATE TABLE IF NOT EXISTS scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  version int NOT NULL,
  data jsonb NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, version)
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type text NOT NULL,                           -- convert|render
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',        -- queued|running|done|failed
  progress real NOT NULL DEFAULT 0,
  message text,
  error text,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 2,
  result jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (status, created_at);

CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  storage_key text NOT NULL,
  thumb_key text,
  format text NOT NULL DEFAULT 'mp4',
  width int NOT NULL, height int NOT NULL, fps int NOT NULL,
  duration real NOT NULL, size bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  password_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  allow_original_download boolean NOT NULL DEFAULT false,
  view_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_visits (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  share_id uuid NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  ip_hash text, user_agent text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  target text,
  meta jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);

-- 고객사별 쇼룸: 공개 주소(/c/<slug>)·브랜드, 공유 링크의 쇼룸 목록 노출 여부, 모델 썸네일
ALTER TABLE companies ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_provider text;  -- claude | openai | both (NULL = 서버 기본)
CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_idx ON companies (slug);
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS listed boolean NOT NULL DEFAULT true;
ALTER TABLE models ADD COLUMN IF NOT EXISTS thumb_key text;

-- ── RLS ─────────────────────────────────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','projects','upload_sessions','files','models','scenes','jobs','videos','share_links','share_visits','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I TO eum_app
      USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid)
      WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO eum_app', t);
  END LOOP;
  ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE companies FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON companies;
  CREATE POLICY tenant_isolation ON companies TO eum_app
    USING (id = nullif(current_setting('app.company_id', true), '')::uuid);
  GRANT SELECT, UPDATE ON companies TO eum_app;
  GRANT USAGE ON SCHEMA public TO eum_app;
  GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO eum_app;
END $$;
