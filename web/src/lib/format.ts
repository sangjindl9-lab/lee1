// 표시용 포맷터. 값이 없으면 항상 "—"(0으로 표시하지 않음).

export const DASH = '—';

const seoulParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** ISO 문자열, epoch ms(숫자 또는 숫자 문자열)를 Date로. 0/빈 값은 null. */
export function toDate(v: string | number | null | undefined): Date | null {
  if (v === null || v === undefined || v === '' || v === 0) return null;
  let d: Date;
  if (typeof v === 'number') d = new Date(v);
  else if (/^\d+$/.test(v)) d = new Date(Number(v));
  else d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toMs(v: string | number | null | undefined): number | null {
  const d = toDate(v);
  return d ? d.getTime() : null;
}

/** Asia/Seoul 기준 YYYY-MM-DD HH:mm:ss */
export function fmtTime(v: string | number | null | undefined): string {
  const d = toDate(v);
  if (!d) return DASH;
  const p: Record<string, string> = {};
  for (const part of seoulParts.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 축 레이블용 HH:mm (Asia/Seoul) */
export function fmtHm(ms: number): string {
  const full = fmtTime(ms);
  return full === DASH ? DASH : full.slice(11, 16);
}

export function fmtNum(v: number | null | undefined, digits = 1, unit = ''): string {
  if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) return DASH;
  const s = v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit ? `${s} ${unit}` : s;
}

export function fmtInt(v: number | null | undefined): string {
  return fmtNum(v, 0);
}

export function fmtBool(v: boolean | null | undefined, onText: string, offText: string): string {
  if (v === true) return onText;
  if (v === false) return offText;
  return DASH;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return DASH;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분 ${s % 60}초`;
}

export function relTime(v: string | number | null | undefined, now = Date.now()): string {
  const ms = toMs(v);
  if (ms === null) return DASH;
  const diff = Math.round((now - ms) / 1000);
  if (diff < 0) return '방금';
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

/** Seoul 기준 ISO(+09:00) 문자열이 아니라 UTC ISO를 서버에 보낸다. */
export function isoNowMinus(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
