-- 회로·케이블 이력 관리 시스템 초기 스키마
PRAGMA foreign_keys = ON;

CREATE TABLE sites (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  client TEXT,
  period TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','site_manager','worker','viewer')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 사용자별 현장 접근 및 권한
CREATE TABLE site_members (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  can_view INTEGER NOT NULL DEFAULT 1,
  can_create INTEGER NOT NULL DEFAULT 0,
  can_edit INTEGER NOT NULL DEFAULT 0,
  can_delete INTEGER NOT NULL DEFAULT 0,
  can_review INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
);

-- 첨부파일 (공개 경로 없음, /api/files/:id 로 권한 확인 후 제공)
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  owner_type TEXT NOT NULL,          -- asset | measurement | worklog | revision | site
  owner_id INTEGER NOT NULL,
  category TEXT NOT NULL,            -- photo, photo_before, photo_after, report, approval, manual, config, drawing, dwg_original, other
  orig_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  caption TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_files_owner ON files(owner_type, owner_id);

CREATE TABLE drawings (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  drawing_no TEXT NOT NULL,
  title TEXT NOT NULL,
  discipline TEXT,                   -- 전력, 통신, CCTV ...
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (site_id, drawing_no)
);

CREATE TABLE drawing_revisions (
  id INTEGER PRIMARY KEY,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id),
  rev_no TEXT NOT NULL,
  rev_date TEXT,
  reason TEXT,
  display_file_id INTEGER REFERENCES files(id),   -- PDF/이미지 (화면 표시용)
  source_file_id INTEGER REFERENCES files(id),    -- DWG/DXF 원본 (보관용)
  display_type TEXT,                              -- pdf | image | none
  pages_json TEXT,                                -- [{w,h,rotate}] 기준 페이지 크기(pt/px)
  scales_json TEXT,                               -- {"1":{"p1":[x,y],"p2":[x,y],"len_m":12.5}}
  review_status TEXT NOT NULL DEFAULT '검토 대기',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  copied_from_revision_id INTEGER REFERENCES drawing_revisions(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (drawing_id, rev_no)
);

-- 설비 (케이블·장비 공통). id 는 내부 식별자, mgmt_no 는 변경 가능
CREATE TABLE assets (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  mgmt_no TEXT NOT NULL,
  category TEXT NOT NULL,            -- power_cable, fiber_cable, lan_cable, cctv, panel, odf, closure, splitter, rack, patch_panel, switch, nvr, outlet, load, other
  name TEXT,
  building TEXT, floor TEXT, room TEXT, zone TEXT,
  location_desc TEXT,
  status TEXT NOT NULL DEFAULT '설계',
  manufacturer TEXT, model TEXT, serial_no TEXT,
  install_date TEXT, contractor TEXT, manager TEXT,
  notes TEXT,
  parent_id INTEGER REFERENCES assets(id),          -- 랙 안의 패치패널·스위치 등
  qr_token TEXT NOT NULL UNIQUE,
  retired INTEGER NOT NULL DEFAULT 0,               -- 교체·보관 처리됨
  replaced_by INTEGER REFERENCES assets(id),
  replaces INTEGER REFERENCES assets(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (status IN ('설계','시공 중','시공 완료','시험 완료','사용 중','철거'))
);
CREATE UNIQUE INDEX ux_assets_mgmt ON assets(site_id, mgmt_no) WHERE retired = 0;
CREATE INDEX idx_assets_site_cat ON assets(site_id, category);

-- 설비 종류별 상세정보 (전력·광·LAN·CCTV 등 종류별 필드)
CREATE TABLE asset_details (
  asset_id INTEGER PRIMARY KEY REFERENCES assets(id),
  data TEXT NOT NULL DEFAULT '{}'
);

-- 장비 비밀번호 등 민감정보 (일반 카드/엑셀 출력에서 제외)
CREATE TABLE asset_secrets (
  asset_id INTEGER PRIMARY KEY REFERENCES assets(id),
  data TEXT NOT NULL DEFAULT '{}',
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 포트·단자·회로 (패치패널 포트, 스위치 포트, ODF 포트, 분전반 회로, NVR 채널, 분배기 포트 ...)
CREATE TABLE ports (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  port_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  port_type TEXT NOT NULL DEFAULT 'port',   -- port | circuit | terminal | channel | in | out
  status TEXT NOT NULL DEFAULT '예비',       -- 사용, 예비, 불량, 사용 중지
  data TEXT NOT NULL DEFAULT '{}',          -- 차단기 정격 등
  UNIQUE (asset_id, name)
);

-- 광케이블 코어
CREATE TABLE cable_cores (
  id INTEGER PRIMARY KEY,
  cable_id INTEGER NOT NULL REFERENCES assets(id),
  core_no INTEGER NOT NULL,
  color TEXT,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT '예비',       -- 사용 중, 예비, 불량, 사용 중지
  UNIQUE (cable_id, core_no)
);

-- 연결 관계. 양 끝점은 connection_endpoints 에 저장 (중복 연결 검사용)
CREATE TABLE connections (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  kind TEXT NOT NULL,          -- power(전원), fixed(고정배선/단말), patch(패치코드), splice(광접속), comm(통신 일반)
  closure_asset_id INTEGER REFERENCES assets(id),   -- 접속함
  tray TEXT, sleeve TEXT, location TEXT,
  work_date TEXT, worker TEXT, note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ended_at TEXT, ended_by INTEGER REFERENCES users(id), end_reason TEXT,
  replaced_by_connection_id INTEGER REFERENCES connections(id)
);

CREATE TABLE connection_endpoints (
  connection_id INTEGER NOT NULL REFERENCES connections(id),
  seq INTEGER NOT NULL CHECK (seq IN (1,2)),
  ep_type TEXT NOT NULL CHECK (ep_type IN ('asset','port','core','cable')),
  ep_id INTEGER NOT NULL,
  ep_end TEXT NOT NULL DEFAULT '',     -- cable/core: A|B, 패치패널·ODF 포트: front|rear, 기타 ''
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (connection_id, seq)
);
-- 포트·코어·케이블 끝단은 동시에 하나의 활성 연결만 허용 (DB 수준 중복 차단)
CREATE UNIQUE INDEX ux_endpoint_active ON connection_endpoints(ep_type, ep_id, ep_end)
  WHERE active = 1 AND ep_type IN ('port','core','cable');
CREATE INDEX idx_ep_lookup ON connection_endpoints(ep_type, ep_id);

-- 도면 표시 객체 (설비와 분리, 개정본별)
CREATE TABLE drawing_marks (
  id INTEGER PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES drawing_revisions(id),
  page INTEGER NOT NULL DEFAULT 1,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  shape TEXT NOT NULL CHECK (shape IN ('point','rect','polyline')),
  geom TEXT NOT NULL,                 -- 페이지 기준 정규화 좌표 0~1 (회전 전 기준)
  needs_recheck INTEGER NOT NULL DEFAULT 0,
  copied_from_mark_id INTEGER REFERENCES drawing_marks(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_marks_rev ON drawing_marks(revision_id, page);
CREATE INDEX idx_marks_asset ON drawing_marks(asset_id);

-- 시험 판정기준 (버전 관리, 수정 시 새 버전 생성)
CREATE TABLE test_criteria (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  code TEXT NOT NULL,                  -- 같은 기준의 버전들을 묶는 코드
  version INTEGER NOT NULL,
  test_type TEXT NOT NULL,             -- insulation, otdr, optical_loss, lan_cert
  target_category TEXT NOT NULL,       -- power_cable, fiber_cable, lan_cable, *
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  comparator TEXT NOT NULL CHECK (comparator IN ('>=','>','<=','<','=')),
  value REAL NOT NULL,
  conditions TEXT NOT NULL DEFAULT '{}',   -- {"test_voltage":500,"wavelength":1310}
  basis_doc TEXT,
  effective_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (site_id, code, version)
);

-- 측정기록 (누적 저장, 덮어쓰지 않음)
CREATE TABLE measurements (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  core_id INTEGER REFERENCES cable_cores(id),
  test_type TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  section TEXT,
  combination TEXT,
  test_voltage REAL,
  wavelength REAL,
  direction TEXT,
  value REAL,
  unit TEXT,
  items TEXT,                          -- LAN 시험 항목 등 [{name,result,value,unit}]
  overall TEXT,                        -- 측정자가 기록한 종합 결과 (성적서 기준)
  instrument TEXT,
  measurer TEXT,
  criteria_id INTEGER REFERENCES test_criteria(id),
  criteria_snapshot TEXT,              -- 측정 당시 적용 기준 사본
  auto_result TEXT NOT NULL,           -- 적합 | 부적합 | 판정기준 미설정 | 판정 불가
  auto_reason TEXT,
  review_status TEXT NOT NULL DEFAULT '검토 대기',  -- 검토 대기 | 승인 | 반려 | 재시험 필요
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  superseded_by INTEGER REFERENCES measurements(id),
  corrects_id INTEGER REFERENCES measurements(id),
  correction_reason TEXT,
  raw_note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_meas_asset ON measurements(asset_id);

-- 작업·측정·보수 이력
CREATE TABLE work_logs (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  work_type TEXT NOT NULL,   -- 신규 설치, 포설, 접속, 단말 처리, 측정, 점검, 장애, 보수, 교체, 철거, 도면 수정
  work_at TEXT NOT NULL,
  content TEXT,
  worker TEXT,
  company TEXT,
  before_value TEXT,
  after_value TEXT,
  measurement_id INTEGER REFERENCES measurements(id),
  status TEXT NOT NULL DEFAULT '작성',   -- 작성 | 검토 요청 | 확정 | 반려
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  superseded_by INTEGER REFERENCES work_logs(id),
  corrects_id INTEGER REFERENCES work_logs(id),
  correction_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_wl_asset ON work_logs(asset_id);

-- 엑셀 업로드 검증 결과 임시 보관
CREATE TABLE import_jobs (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  category TEXT NOT NULL,
  rows TEXT NOT NULL,
  committed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 감사 로그 (수정·삭제 불가)
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id INTEGER,
  site_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, '감사 로그는 수정할 수 없습니다'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, '감사 로그는 삭제할 수 없습니다'); END;
