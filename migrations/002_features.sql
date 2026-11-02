-- 추가 기능: CAD 자동 변환 기록, OTDR 해석, 실시간 상태 감시, 오프라인 전송 중복 방지

ALTER TABLE drawing_revisions ADD COLUMN conversion_note TEXT;

-- 오프라인 대기열 재전송 시 같은 요청이 두 번 저장되지 않도록 단말에서 만든 고유값
ALTER TABLE measurements ADD COLUMN client_ref TEXT;
ALTER TABLE work_logs ADD COLUMN client_ref TEXT;
ALTER TABLE files ADD COLUMN client_ref TEXT;
CREATE UNIQUE INDEX ux_meas_client ON measurements(client_ref) WHERE client_ref IS NOT NULL;
CREATE UNIQUE INDEX ux_wl_client ON work_logs(client_ref) WHERE client_ref IS NOT NULL;
CREATE UNIQUE INDEX ux_files_client ON files(client_ref) WHERE client_ref IS NOT NULL;

-- OTDR 원본에서 만든 측정기록과 원본 파일 연결
ALTER TABLE measurements ADD COLUMN source_file_id INTEGER REFERENCES files(id);

-- 실시간 상태 감시 설정 (설비당 1개)
CREATE TABLE monitors (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  asset_id INTEGER NOT NULL UNIQUE REFERENCES assets(id),
  method TEXT NOT NULL CHECK (method IN ('tcp','http','push')),
  host TEXT,
  port INTEGER,
  path TEXT,
  interval_sec INTEGER NOT NULL DEFAULT 60,
  timeout_ms INTEGER NOT NULL DEFAULT 3000,
  fail_threshold INTEGER NOT NULL DEFAULT 2,
  push_stale_sec INTEGER NOT NULL DEFAULT 300,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT '확인 전',      -- 정상 | 이상 | 응답 없음 | 확인 전 | 중지
  consecutive_fail INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_ok_at TEXT,
  last_change_at TEXT,
  last_latency_ms INTEGER,
  last_message TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 상태 변화 이력 (상태가 바뀔 때만 기록)
CREATE TABLE monitor_events (
  id INTEGER PRIMARY KEY,
  monitor_id INTEGER NOT NULL REFERENCES monitors(id),
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  latency_ms INTEGER,
  message TEXT,
  source TEXT                                   -- poll | push
);
CREATE INDEX idx_mon_events ON monitor_events(monitor_id, id);

-- 외부 시스템(NVR·SCADA·NMS) 상태 수신용 토큰 (현장 단위, 해시만 저장)
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
