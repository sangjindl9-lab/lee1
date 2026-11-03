-- CCTV 공사 설계 프로그램 초기 스키마
-- 설계 객체(장비·케이블·관로·주석)는 핵심 키를 컬럼으로, 가변 속성은 data(JSON)로 저장합니다.

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','designer','reviewer','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,             -- 공사명
  address TEXT, client TEXT, designer TEXT, contractor TEXT, author TEXT,
  written_at TEXT, drawing_no TEXT, revision TEXT,
  system_type TEXT NOT NULL DEFAULT '혼합형' CHECK (system_type IN ('IP형','동축형','혼합형')),
  is_sample INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',   -- 레이어, 여장, 반올림, 산출규칙, 기준값, 단가 등
  ver INTEGER NOT NULL DEFAULT 1,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('designer','reviewer','viewer')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime TEXT, size INTEGER, sha256 TEXT,
  kind TEXT NOT NULL,             -- image | pdf | dxf | dwg | photo | spec | logo | titleblock | other
  storage_path TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',-- 페이지 수, CAD 단위, 레이어, 경고 등 분석 결과
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sheets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  building TEXT, floor TEXT, zone TEXT, sheet_no TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',  -- 배경(file_id,page,kind,width,height,rotation,opacity), scale, cad, georef
  ver INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE sheet_revisions (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  rev_no TEXT NOT NULL,
  file_id TEXT,
  note TEXT,
  snapshot TEXT NOT NULL,          -- 해당 시점 도면 객체 + 물량표 스냅샷 JSON
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 설계 객체 공통 구조
CREATE TABLE devices (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id TEXT, type TEXT NOT NULL, tag TEXT, product_id TEXT,
  data TEXT NOT NULL DEFAULT '{}', ver INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT
);
CREATE TABLE cables (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id TEXT, kind TEXT NOT NULL, tag TEXT, product_id TEXT,
  from_dev TEXT, to_dev TEXT, parent_id TEXT,
  data TEXT NOT NULL DEFAULT '{}', ver INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT
);
CREATE TABLE conduits (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id TEXT, tag TEXT, product_id TEXT,
  data TEXT NOT NULL DEFAULT '{}', ver INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT
);
CREATE TABLE annotations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id TEXT, type TEXT NOT NULL,   -- text | dim | leader | legend | measure | area | polyline
  data TEXT NOT NULL DEFAULT '{}', ver INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT
);
CREATE INDEX ix_dev_p ON devices(project_id);
CREATE INDEX ix_cab_p ON cables(project_id);
CREATE INDEX ix_cab_ft ON cables(from_dev, to_dev);
CREATE INDEX ix_con_p ON conduits(project_id);
CREATE INDEX ix_ann_p ON annotations(project_id);

-- 제품 사양(품목) : company_id NULL = 공용 기본 품목
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('device','cable','conduit','accessory')),
  kind TEXT,                 -- camera/nvr/... | utp/fiber/coax/composite/power/ground | pipe/tray | 역할
  name TEXT NOT NULL, spec TEXT, unit TEXT, maker TEXT, model TEXT,
  data TEXT NOT NULL DEFAULT '{}',   -- 임피던스, 외경, 감쇠표, 권장거리(근거), 코어, 지원신호 등
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES files(id),
  kind TEXT NOT NULL,     -- 현장사진 | 시공사진 | 제품사양서 | 시험결과
  note TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  user_id TEXT, user_name TEXT,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
  before TEXT, after TEXT, reason TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_log_p ON change_log(project_id, ts);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '대기',   -- 대기 | 진행 | 완료 | 실패
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT, result TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
