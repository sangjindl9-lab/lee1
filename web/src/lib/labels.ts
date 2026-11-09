// 화면 표기용 한국어 레이블. 알 수 없는 코드는 원문을 그대로 보여준다.

export const SEVERITY_LABEL: Record<string, string> = {
  critical: '긴급',
  major: '심각',
  warning: '주의',
  info: '정보',
};
export const SEVERITIES = ['critical', 'major', 'warning', 'info'] as const;

export const ALARM_STATE_LABEL: Record<string, string> = {
  open: '미확인',
  acknowledged: '확인됨',
  assigned: '담당 지정',
  resolved: '조치 완료',
  closed: '종료',
};
export const ALARM_STATES = ['open', 'acknowledged', 'assigned', 'resolved', 'closed'] as const;
export const UNRESOLVED_STATES = ['open', 'acknowledged', 'assigned'] as const;

export const INPUT_KEYS = ['door', 'tamper', 'ups_ac_fail', 'ups_batt_low', 'elb_trip', 'spd_fault', 'di7', 'di8'] as const;
export const INPUT_LABEL: Record<string, string> = {
  door: '문 열림',
  tamper: '함체 탬퍼',
  ups_ac_fail: 'UPS 정전',
  ups_batt_low: 'UPS 배터리 저전압',
  elb_trip: '누전차단기 트립',
  spd_fault: 'SPD 이상',
  di7: '예비 입력 1',
  di8: '예비 입력 2',
};

export const ROLE_LABEL: Record<string, string> = {
  poe_switch: 'PoE 스위치',
  optic_converter: '광컨버터',
  fan: '냉각팬',
  heater: '히터',
  camera: '카메라',
  spare: '예비',
  other: '기타',
};

export const COMMAND_TYPE_LABEL: Record<string, string> = {
  power_off: '전원 차단',
  power_on: '전원 공급',
  power_cycle: '전원 재투입',
  alarm_out: '경보 출력',
  telemetry_now: '즉시 계측',
  config_set: '설정 변경',
  reboot_device: '컨트롤러 재시작',
};
export const POWER_COMMANDS = ['power_off', 'power_on', 'power_cycle'];

export const COMMAND_STATUS_LABEL: Record<string, string> = {
  pending_approval: '승인 대기',
  queued: '대기열',
  sent: '전송됨',
  received: '장치 수신',
  done: '완료',
  failed: '실패',
  rejected: '거부',
  timeout: '응답 없음',
  cancelled: '취소',
  expired: '만료',
};
export const COMMAND_FINAL = ['done', 'failed', 'rejected', 'timeout', 'cancelled', 'expired'];

export const EVENT_TYPE_LABEL: Record<string, string> = {
  input_change: '입력 변화',
  shock: '충격',
  tilt: '기울기',
  env_alarm: '환경 경보',
  local_action: '자체 조치',
  recovery: '자동 복구',
  boot: '부팅',
  sensor_fault: '센서 이상',
};

export const ENV_KIND_LABEL: Record<string, string> = {
  overtemp: '고온',
  undertemp: '저온',
  humidity: '고습',
};

export const ALARM_TYPE_LABEL: Record<string, string> = {
  ...INPUT_LABEL,
  ...EVENT_TYPE_LABEL,
};

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (key === null || key === undefined || key === '') return '—';
  return map[key] ?? key;
}

export function commandParamsText(type: string, params: Record<string, unknown> | null): string {
  if (!params) return '';
  const parts: string[] = [];
  if (params.ch !== undefined) parts.push(`CH${String(params.ch)}`);
  if (type === 'power_cycle' && params.off_sec !== undefined) parts.push(`${String(params.off_sec)}초 차단`);
  if (type === 'alarm_out') {
    const out = params.output === 'siren' ? '사이렌' : params.output === 'strobe' ? '경광등' : String(params.output ?? '');
    parts.push(`${out} ${params.on ? '켜기' : '끄기'}`);
    if (params.on && typeof params.duration_s === 'number' && params.duration_s > 0) parts.push(`${params.duration_s}초`);
  }
  return parts.join(' · ');
}
