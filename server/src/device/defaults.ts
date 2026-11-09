export const INPUTS = [
  { key: 'door', name: '문 열림', severity: 'warning' },
  { key: 'tamper', name: '함체 탬퍼', severity: 'warning' },
  { key: 'ups_ac_fail', name: 'UPS 정전', severity: 'critical' },
  { key: 'ups_batt_low', name: 'UPS 배터리 저전압', severity: 'major' },
  { key: 'elb_trip', name: '누전차단기 트립', severity: 'critical' },
  { key: 'spd_fault', name: 'SPD 이상', severity: 'major' },
  { key: 'di7', name: '예비 입력 1', severity: 'info' },
  { key: 'di8', name: '예비 입력 2', severity: 'info' },
] as const;

export const SHARED_ROLES = ['poe_switch', 'optic_converter'];

export const CHANNELS = [
  { ch: 1, name: 'PoE 스위치', role: 'poe_switch', contact: 'NC' },
  { ch: 2, name: '광컨버터', role: 'optic_converter', contact: 'NC' },
  { ch: 3, name: '냉각팬', role: 'fan', contact: 'NO' },
  { ch: 4, name: '히터', role: 'heater', contact: 'NO' },
  { ch: 5, name: '예비 1', role: 'spare', contact: 'NC' },
  { ch: 6, name: '예비 2', role: 'spare', contact: 'NC' },
];

export function defaultConfig() {
  return {
    config_version: 1,
    telemetry_interval_s: 10,
    fan: { on_c: 40, off_c: 35 },
    heater: { on_c: 0, off_c: 5, rh_on: 85, rh_off: 75 },
    channels: CHANNELS.map(({ ch, contact, role }) => ({ ch, contact, role })),
    inputs_polarity: Object.fromEntries(INPUTS.map(i => [i.key, 'NO'])),
    local_recovery: { enabled: false, interval_s: 30, fail_threshold: 5, off_sec: 10, boot_wait_s: 180, max_per_hour: 3, targets: [] as any[] },
  };
}

export const SEVERITY_KO: Record<string, string> = { critical: '긴급', major: '심각', warning: '주의', info: '정보' };
