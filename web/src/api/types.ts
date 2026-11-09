// docs/api.md, docs/protocol.md 기준 타입 정의.
// 측정 불가/미수신 값은 null 또는 누락될 수 있으므로 모두 선택적으로 다룬다.

export type Permission =
  | 'site.read'
  | 'site.write'
  | 'device.read'
  | 'device.write'
  | 'device.control.power'
  | 'device.control.alarm'
  | 'command.approve'
  | 'alarm.read'
  | 'alarm.ack'
  | 'alarm.manage'
  | 'audit.read'
  | 'user.manage'
  | 'org.manage';

export interface User {
  id: string;
  username: string;
  display_name: string;
  org_id: string;
  org_name: string;
  role: string;
  permissions: string[];
  mfa_enabled: boolean;
  /** /users 목록에 포함될 수 있음 (문서에 명시되지 않음) */
  active?: boolean;
}

export interface LoginTokenResponse {
  access_token: string;
  expires_in: number;
  user: User;
}

export interface LoginMfaResponse {
  mfa_required: true;
  mfa_token: string;
}

export type LoginResponse = LoginTokenResponse | LoginMfaResponse;

export interface MfaSetupResponse {
  secret: string;
  otpauth_url: string;
}

export interface ReauthResponse {
  step_up_token: string;
  expires_in: number;
}

export interface Role {
  code: string;
  name: string;
  permissions: string[];
}

export interface Site {
  id: string;
  org_id: string;
  name: string;
  code: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface Cabinet {
  id: string;
  site_id: string;
  code: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  install_date: string | null;
  note: string | null;
}

export type Contact = 'NC' | 'NO';

export interface Channel {
  ch: number;
  contact: Contact;
  role: string;
  name: string;
  shared: boolean;
  load_on: boolean | null;
  coil_on: boolean | null;
}

export interface InputDef {
  key: string;
  name: string;
  polarity: string;
  active: boolean | null;
  severity: string;
}

export interface TelemetryAc {
  v?: number | null;
  a?: number | null;
  w?: number | null;
  kwh?: number | null;
  hz?: number | null;
  pf?: number | null;
}
export interface TelemetryDc {
  in_v?: number | null;
  in_a?: number | null;
  batt_v?: number | null;
}
export interface TelemetryEnv {
  t?: number | null;
  rh?: number | null;
}

export interface TelemetryData {
  ts?: number | null;
  uptime_ms?: number | null;
  seq?: number | null;
  ac?: TelemetryAc | null;
  dc?: TelemetryDc | null;
  env?: TelemetryEnv | null;
  relays?: (boolean | null)[] | null;
  loads?: (boolean | null)[] | null;
  alarm_out?: { siren?: boolean | null; strobe?: boolean | null } | null;
  inputs?: Record<string, boolean | null> | null;
  accel?: { shock?: boolean | null; tilt_deg?: number | null } | null;
  net?: { eth_link?: boolean | null; mqtt_reconnects?: number | null; offline_buffered?: number | null } | null;
  auto?: { fan?: boolean | null; heater?: boolean | null } | null;
}

export interface Telemetry extends TelemetryData {
  received_at?: string | number | null;
}

export interface Smartbox {
  id: string;
  cabinet_id: string;
  device_id: string;
  serial_no: string | null;
  model: string | null;
  fw_version: string | null;
  online: boolean;
  last_seen_at: string | number | null;
  config_version: number | null;
  channels: Channel[];
  inputs: InputDef[];
  latest: Telemetry | null;
  open_alarm_count: number;
  cabinet_code?: string;
  cabinet_name?: string;
  site_name?: string;
}

export interface Provisioning {
  device_id: string;
  cmd_secret: string;
  client_cert_pem: string;
  client_key_pem: string;
  ca_cert_pem: string;
  mqtt_host: string;
  mqtt_port: number;
}

export interface SmartboxCreated extends Smartbox {
  provisioning: Provisioning;
}

export interface TelemetryRow {
  ts: string | number | null;
  received_at: string | number | null;
  data: TelemetryData;
}

export interface DeviceEvent {
  id: string;
  device_event_id: string;
  ts: string | number | null;
  type: string;
  severity: string;
  data: Record<string, unknown> | null;
}

export type CommandStatus =
  | 'pending_approval'
  | 'queued'
  | 'sent'
  | 'received'
  | 'done'
  | 'failed'
  | 'rejected'
  | 'timeout'
  | 'cancelled'
  | 'expired';

export type CommandType =
  | 'power_off'
  | 'power_on'
  | 'power_cycle'
  | 'alarm_out'
  | 'telemetry_now'
  | 'config_set'
  | 'reboot_device';

export interface Command {
  id: string;
  smartbox_id: string;
  type: CommandType | string;
  params: Record<string, unknown> | null;
  status: CommandStatus | string;
  requested_by: string;
  requested_by_name: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  requires_approval: boolean;
  reason: string | null;
  created_at: string | number | null;
  sent_at: string | number | null;
  acked_at: string | number | null;
  finished_at: string | number | null;
  attempts: number | null;
  error: string | null;
  result: unknown;
}

export type Severity = 'critical' | 'major' | 'warning' | 'info';
export type AlarmState = 'open' | 'acknowledged' | 'assigned' | 'resolved' | 'closed';

export interface Alarm {
  id: string;
  org_id: string;
  smartbox_id: string | null;
  site_name: string | null;
  cabinet_code: string | null;
  type: string;
  severity: Severity | string;
  title: string;
  detail: string | null;
  state: AlarmState | string;
  source: 'device' | 'system' | string;
  first_at: string | number | null;
  last_at: string | number | null;
  count: number | null;
  ack_by_name: string | null;
  assignee_name: string | null;
  resolved_at: string | number | null;
}

export interface AuditLog {
  id: string | number;
  ts: string | number | null;
  org_id: string | null;
  user_id: string | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
  prev_hash: string | null;
  hash: string | null;
}

export interface AuditVerify {
  ok: boolean;
  checked: number;
  broken_at_id: string | number | null;
}

export interface Health {
  ok: boolean;
  db: unknown;
  mqtt: unknown;
  version: string;
}

// Socket.IO 이벤트
export interface TelemetryEvent {
  smartbox_id: string;
  data: TelemetryData;
}
export interface DeviceStatusEvent {
  smartbox_id: string;
  online: boolean;
  ts: string | number | null;
}
export interface DeviceEventEvent {
  smartbox_id: string;
  event: DeviceEvent;
}
