-- EUM SMART VMS PRO : 초기 스키마 (지시서 15장 엔터티)
-- 모든 업무 테이블은 org_id(기관)를 가지며 애플리케이션 계층에서 org_id로 접근을 제한한다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────── 기관 · 사용자 · 권한 ─────────
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  settings    jsonb NOT NULL DEFAULT '{}',
  is_platform boolean NOT NULL DEFAULT false,   -- 중앙 관리 기관(플랫폼 운영사)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  code        text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE roles (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  rank        int  NOT NULL,                    -- 작을수록 상위
  requires_mfa boolean NOT NULL DEFAULT false,
  is_system   boolean NOT NULL DEFAULT true
);

CREATE TABLE role_permissions (
  role_id         int  NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id),
  username       text NOT NULL UNIQUE,
  display_name   text NOT NULL,
  password_hash  text NOT NULL,
  role_id        int  NOT NULL REFERENCES roles(id),
  active         boolean NOT NULL DEFAULT true,
  mfa_enabled    boolean NOT NULL DEFAULT false,
  mfa_secret_enc text,
  failed_logins  int NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_org_idx ON users(org_id);

CREATE TABLE sessions (
  jti         uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('access','mfa','stepup')),
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE login_history (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  username    text NOT NULL,
  org_id      uuid REFERENCES organizations(id),
  success     boolean NOT NULL,
  reason      text,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_history_org_idx ON login_history(org_id, created_at DESC);

-- ───────── 현장 · 함체 · 스마트박스 ─────────
CREATE TABLE sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  code        text NOT NULL,
  name        text NOT NULL,
  address     text,
  admin_area  text,                              -- 행정구역
  lat         double precision,
  lng         double precision,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE cabinets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  site_id      uuid NOT NULL REFERENCES sites(id),
  code         text NOT NULL,                    -- 함체번호
  name         text NOT NULL,
  facility_no  text,                             -- 시설물번호
  address      text,
  lat          double precision,
  lng          double precision,
  install_date date,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX cabinets_site_idx ON cabinets(site_id);

CREATE TABLE smartboxes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id),
  cabinet_id      uuid NOT NULL REFERENCES cabinets(id),
  device_id       text NOT NULL UNIQUE,
  serial_no       text,
  model           text NOT NULL DEFAULT 'SB-MB01',
  hw_rev          text,
  fw_version      text,
  cmd_secret_enc  text NOT NULL,
  cert_serial     text,
  cert_fingerprint text,
  online          boolean NOT NULL DEFAULT false,
  last_seen_at    timestamptz,
  last_hello      jsonb,
  last_telemetry  jsonb,
  config          jsonb NOT NULL DEFAULT '{}',
  config_version  int NOT NULL DEFAULT 1,
  decommissioned  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smartboxes_org_idx ON smartboxes(org_id);
CREATE INDEX smartboxes_cabinet_idx ON smartboxes(cabinet_id);

CREATE TABLE smartbox_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smartbox_id uuid NOT NULL REFERENCES smartboxes(id) ON DELETE CASCADE,
  ch          int  NOT NULL CHECK (ch BETWEEN 1 AND 6),
  name        text NOT NULL,
  role        text NOT NULL CHECK (role IN ('poe_switch','optic_converter','fan','heater','camera','spare','other')),
  contact     text NOT NULL CHECK (contact IN ('NC','NO')),
  shared      boolean NOT NULL DEFAULT false,    -- 여러 장비에 전원을 공급하는 공유 장비
  coil_on     boolean,
  load_on     boolean,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (smartbox_id, ch)
);

CREATE TABLE smartbox_inputs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smartbox_id uuid NOT NULL REFERENCES smartboxes(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  polarity    text NOT NULL DEFAULT 'NO' CHECK (polarity IN ('NO','NC')),
  severity    text NOT NULL CHECK (severity IN ('critical','major','warning','info')),
  active      boolean,
  changed_at  timestamptz,
  UNIQUE (smartbox_id, key)
);

CREATE TABLE sensors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smartbox_id uuid NOT NULL REFERENCES smartboxes(id) ON DELETE CASCADE,
  kind        text NOT NULL,                     -- sht31, ina226_in, ina226_batt, lis3dh, pzem, rtc, mcp23017
  address     text,
  status      text NOT NULL DEFAULT 'unknown' CHECK (status IN ('ok','fault','absent','unknown')),
  last_ok_at  timestamptz,
  fault_since timestamptz,
  UNIQUE (smartbox_id, kind)
);

-- 계측 시계열. TimescaleDB가 있으면 하이퍼테이블로 전환한다(아래 DO 블록).
CREATE TABLE telemetry (
  smartbox_id uuid NOT NULL REFERENCES smartboxes(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  org_id      uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  t           real, rh real,
  ac_v real, ac_a real, ac_w real, ac_kwh double precision,
  dc_in_v real, dc_in_a real, batt_v real,
  data        jsonb NOT NULL,
  PRIMARY KEY (smartbox_id, ts)
);
CREATE INDEX telemetry_org_ts_idx ON telemetry(org_id, ts DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('telemetry', 'ts', migrate_data => true, if_not_exists => true);
  END IF;
END $$;

CREATE TABLE device_events (
  id              bigserial PRIMARY KEY,
  org_id          uuid NOT NULL REFERENCES organizations(id),
  smartbox_id     uuid NOT NULL REFERENCES smartboxes(id) ON DELETE CASCADE,
  device_event_id text NOT NULL,
  ts              timestamptz NOT NULL,
  type            text NOT NULL,
  severity        text NOT NULL,
  data            jsonb NOT NULL DEFAULT '{}',
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (smartbox_id, device_event_id)
);
CREATE INDEX device_events_box_idx ON device_events(smartbox_id, ts DESC);

CREATE TABLE commands (
  id                text PRIMARY KEY,               -- cmd_id
  org_id            uuid NOT NULL REFERENCES organizations(id),
  smartbox_id       uuid NOT NULL REFERENCES smartboxes(id),
  type              text NOT NULL,
  params            jsonb NOT NULL DEFAULT '{}',
  reason            text,
  status            text NOT NULL CHECK (status IN ('pending_approval','queued','sent','received','done','failed','rejected','timeout','cancelled','expired')),
  requires_approval boolean NOT NULL DEFAULT false,
  requested_by      uuid REFERENCES users(id),
  approved_by       uuid REFERENCES users(id),
  approval_expires_at timestamptz,
  rejected_reason   text,
  attempts          int NOT NULL DEFAULT 0,
  ts                bigint,                          -- 서명에 포함된 ts
  exp               bigint,
  error             text,
  result            jsonb,
  source            text NOT NULL DEFAULT 'user' CHECK (source IN ('user','policy','system')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  acked_at          timestamptz,
  finished_at       timestamptz
);
CREATE INDEX commands_box_idx ON commands(smartbox_id, created_at DESC);
CREATE INDEX commands_status_idx ON commands(org_id, status);

-- ───────── 카메라 · 네트워크 장비 · VMS ─────────
CREATE TABLE cameras (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  site_id      uuid REFERENCES sites(id),
  code         text NOT NULL,                   -- 카메라번호
  name         text NOT NULL,
  manufacturer text,
  model        text,
  ip           inet,
  mac          text,
  serial_no    text,
  onvif_url    text,
  credentials_enc text,
  lat          double precision,
  lng          double precision,
  status       text NOT NULL DEFAULT 'unknown',
  status_at    timestamptz,
  install_date date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

-- 카메라와 함체는 다대다
CREATE TABLE camera_cabinets (
  camera_id   uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  cabinet_id  uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  relation    text NOT NULL DEFAULT 'powered' CHECK (relation IN ('powered','network','both')),
  PRIMARY KEY (camera_id, cabinet_id)
);

CREATE TABLE camera_streams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id   uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  profile     text NOT NULL,                   -- main / sub
  url         text NOT NULL,
  codec       text, width int, height int, fps real,
  UNIQUE (camera_id, profile)
);

CREATE TABLE poe_switches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  cabinet_id  uuid REFERENCES cabinets(id),
  name        text NOT NULL,
  manufacturer text, model text,
  ip          inet,
  mgmt_protocol text CHECK (mgmt_protocol IN ('snmpv3','http','ssh','none')),
  mgmt_config_enc text,
  smartbox_channel_id uuid REFERENCES smartbox_channels(id),   -- 이 스위치 전원을 공급하는 릴레이 채널
  status      text NOT NULL DEFAULT 'unknown',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poe_ports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  switch_id   uuid NOT NULL REFERENCES poe_switches(id) ON DELETE CASCADE,
  port_no     int NOT NULL,
  camera_id   uuid REFERENCES cameras(id),
  poe_enabled boolean,
  power_w     real,
  link_up     boolean,
  remote_control_allowed boolean NOT NULL DEFAULT false,      -- 승인된 개별 포트 재투입 허용
  updated_at  timestamptz,
  UNIQUE (switch_id, port_no)
);

CREATE TABLE nvrs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  site_id      uuid REFERENCES sites(id),
  name         text NOT NULL,
  manufacturer text, model text,
  ip           inet,
  credentials_enc text,
  status       text NOT NULL DEFAULT 'unknown',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vms_adapters (
  code         text PRIMARY KEY,                -- hanwha_wave, milestone_xprotect, genetec, nx_witness, onvif, hikcentral ...
  name         text NOT NULL,
  vendor       text NOT NULL,
  adapter_version text NOT NULL,
  supported_levels int[] NOT NULL DEFAULT '{}', -- 구현된 연동 레벨
  verification text NOT NULL DEFAULT 'unverified' CHECK (verification IN ('verified','unverified','unsupported')),
  notes        text
);

CREATE TABLE vms_servers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  adapter_code text NOT NULL REFERENCES vms_adapters(code),
  name         text NOT NULL,
  product      text, version text,
  host         text NOT NULL, port int NOT NULL,
  auth_type    text NOT NULL,
  secret_enc   text,
  tls          jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'unknown',
  capabilities jsonb NOT NULL DEFAULT '{}',      -- 실제 확인된 기능만
  last_check_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vms_camera_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  vms_server_id uuid NOT NULL REFERENCES vms_servers(id) ON DELETE CASCADE,
  vms_camera_ref text NOT NULL,
  vms_camera_name text,
  camera_id     uuid REFERENCES cameras(id),
  match_method  text CHECK (match_method IN ('ip','mac','serial','name','manual')),
  confirmed     boolean NOT NULL DEFAULT false,
  UNIQUE (vms_server_id, vms_camera_ref)
);

CREATE TABLE network_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  kind        text NOT NULL CHECK (kind IN ('fiber','utp','wireless','lte','other')),
  a_type      text NOT NULL, a_id uuid NOT NULL,
  b_type      text NOT NULL, b_id uuid NOT NULL,
  geometry    jsonb,                             -- GeoJSON LineString
  core_info   text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────── 알람 · 복구 ─────────
CREATE TABLE alarm_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organizations(id),  -- NULL = 전체 기본 규칙
  key         text NOT NULL,
  name        text NOT NULL,
  condition   jsonb NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('critical','major','warning','info')),
  enabled     boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, key)
);

CREATE TABLE alarms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  smartbox_id  uuid REFERENCES smartboxes(id),
  camera_id    uuid REFERENCES cameras(id),
  dedup_key    text NOT NULL,                     -- 같은 장애 반복을 하나로 묶는 키
  type         text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('critical','major','warning','info')),
  title        text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}',
  cause        text,                              -- 원인 분석 결과
  state        text NOT NULL CHECK (state IN ('open','acknowledged','assigned','resolved','closed')),
  source       text NOT NULL CHECK (source IN ('device','system','vms')),
  first_at     timestamptz NOT NULL,
  last_at      timestamptz NOT NULL,
  count        int NOT NULL DEFAULT 1,
  cleared_at   timestamptz,                       -- 장치가 정상 복귀를 알린 시각
  ack_by       uuid REFERENCES users(id), ack_at timestamptz,
  assignee_id  uuid REFERENCES users(id), assigned_at timestamptz,
  resolved_by  uuid REFERENCES users(id), resolved_at timestamptz, resolve_note text,
  auto_recovered boolean NOT NULL DEFAULT false
);
CREATE INDEX alarms_org_state_idx ON alarms(org_id, state, last_at DESC);
CREATE UNIQUE INDEX alarms_open_dedup_idx ON alarms(org_id, dedup_key) WHERE state IN ('open','acknowledged','assigned');

CREATE TABLE recovery_policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES organizations(id),  -- NULL = 기본 정책
  name           text NOT NULL,
  interval_s     int NOT NULL DEFAULT 30,
  fail_threshold int NOT NULL DEFAULT 5,
  off_sec        int NOT NULL DEFAULT 10,
  boot_wait_s    int NOT NULL DEFAULT 180,
  max_per_hour   int NOT NULL DEFAULT 3,
  allow_shared_auto boolean NOT NULL DEFAULT false,   -- 공유 장비 자동 재투입 (기본 금지)
  maintenance_window jsonb,
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recovery_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  smartbox_id  uuid REFERENCES smartboxes(id),
  camera_id    uuid REFERENCES cameras(id),
  alarm_id     uuid REFERENCES alarms(id),
  policy_id    uuid REFERENCES recovery_policies(id),
  command_id   text REFERENCES commands(id),
  step         text NOT NULL,     -- detect, retry_check, soft_restart, poe_port_cycle, shared_power_request, verify, dispatch
  result       text NOT NULL,     -- ok, failed, skipped, blocked, pending
  detail       jsonb NOT NULL DEFAULT '{}',
  source       text NOT NULL DEFAULT 'server' CHECK (source IN ('server','device')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_actions_box_idx ON recovery_actions(smartbox_id, created_at DESC);

-- ───────── 유지보수 ─────────
CREATE TABLE work_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  alarm_id     uuid REFERENCES alarms(id),
  cabinet_id   uuid REFERENCES cabinets(id),
  title        text NOT NULL,
  status       text NOT NULL CHECK (status IN ('received','assigned','dispatched','on_site','done','verified','closed','cancelled')),
  assignee_id  uuid REFERENCES users(id),
  requested_by uuid REFERENCES users(id),
  due_at       timestamptz,
  dispatched_at timestamptz, arrived_at timestamptz, finished_at timestamptz,
  gps_consent  boolean NOT NULL DEFAULT false,
  arrive_lat   double precision, arrive_lng double precision,
  cause        text, action_taken text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_orders_org_idx ON work_orders(org_id, status);

CREATE TABLE inspections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  cabinet_id   uuid REFERENCES cabinets(id),
  template     jsonb NOT NULL DEFAULT '{}',
  results      jsonb NOT NULL DEFAULT '{}',
  scheduled_at timestamptz,
  done_at      timestamptz,
  inspector_id uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  work_order_id uuid REFERENCES work_orders(id),
  cabinet_id    uuid REFERENCES cabinets(id),
  camera_id     uuid REFERENCES cameras(id),
  kind          text NOT NULL,                  -- repair, replace, inspect, measure
  part_name     text, old_serial text, new_serial text,
  measurements  jsonb NOT NULL DEFAULT '{}',
  note          text,
  performed_by  uuid REFERENCES users(id),
  performed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  owner_type  text NOT NULL,                     -- work_order, maintenance_record, cabinet, site
  owner_id    uuid NOT NULL,
  kind        text NOT NULL,                     -- photo_before, photo_after, drawing, document
  filename    text NOT NULL,
  mime        text NOT NULL,
  size_bytes  bigint NOT NULL,
  sha256      text NOT NULL,
  storage_key text NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_owner_idx ON attachments(owner_type, owner_id);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  channel     text NOT NULL CHECK (channel IN ('internal','sms','alimtalk','email','push')),
  recipient   text NOT NULL,
  alarm_id    uuid REFERENCES alarms(id),
  title       text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('pending','sent','failed','read')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

-- ───────── 감사 · 펌웨어 · 라이선스 · 보고서 ─────────
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  org_id      uuid REFERENCES organizations(id),
  user_id     uuid REFERENCES users(id),
  username    text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  detail      jsonb NOT NULL DEFAULT '{}',
  ip          text,
  prev_hash   text NOT NULL,
  hash        text NOT NULL
);
CREATE INDEX audit_logs_org_idx ON audit_logs(org_id, id DESC);
-- 감사로그는 수정·삭제 금지
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE firmware_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model       text NOT NULL,
  version     text NOT NULL,
  sha256      text NOT NULL,
  signature   text NOT NULL,
  size_bytes  bigint NOT NULL,
  storage_key text NOT NULL,
  release_note text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model, version)
);

CREATE TABLE ota_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  firmware_id uuid NOT NULL REFERENCES firmware_versions(id),
  smartbox_id uuid NOT NULL REFERENCES smartboxes(id),
  status      text NOT NULL CHECK (status IN ('scheduled','sent','downloading','verifying','done','failed','rolled_back')),
  error       text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE licenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid REFERENCES organizations(id),   -- NULL = 서버 전체
  modes        text[] NOT NULL,                     -- A smartbox, B vms_link, C integrated
  max_devices  int,
  valid_from   date NOT NULL,
  valid_until  date,
  issued_to    text NOT NULL,
  payload      jsonb NOT NULL,
  signature    text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organizations(id),
  kind        text NOT NULL,                       -- daily_ops, weekly_faults, monthly_maintenance, photo_ledger ...
  name        text NOT NULL,
  settings    jsonb NOT NULL DEFAULT '{}',         -- 기관명, 사업명, 계약기간, 업체명, 결재란
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
