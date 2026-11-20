/**
 * 날짜/시간 유틸 — 서비스 기준 시간대는 Asia/Seoul (KST, DST 없음).
 * 서버가 UTC 로 돌아도 화면·기록·검색이 한국 시간 기준으로 일관되게 동작하도록
 * 모든 날짜 계산은 KST 달력 기준으로 한다.
 */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

export type KstParts = {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
};

export function kstParts(date: Date): KstParts {
  const t = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
    ss: t.getUTCSeconds(),
  };
}

export function kstDateKey(date: Date): string {
  const p = kstParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function formatKstDate(date: Date | null | undefined): string {
  if (!date) return "-";
  return kstDateKey(date);
}

export function formatKstTime(date: Date | null | undefined): string {
  if (!date) return "-";
  const p = kstParts(date);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

export function formatKstDateTime(date: Date | null | undefined): string {
  if (!date) return "-";
  return `${kstDateKey(date)} ${formatKstTime(date)}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > daysInMonth(y, mo)) return false;
  return true;
}

export function isValidTimeString(s: string): boolean {
  const m = TIME_RE.exec(s);
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/** "2026-11-20" + "23:40" (KST) → Date */
export function parseKstDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+09:00`);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** KST 달력 기준 개월 더하기 (말일 보정) */
export function addMonthsKst(date: Date, months: number): Date {
  const p = kstParts(date);
  const total = (p.y * 12 + (p.m - 1)) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(p.d, daysInMonth(y, m));
  return new Date(Date.UTC(y, m - 1, d, -9, 0, 0));
}

/** KST 달력 기준 만 개월 수 (생년월일 대비 촬영일) */
export function ageMonthsAt(birthDate: Date, at: Date): number {
  const b = kstParts(birthDate);
  const a = kstParts(at);
  let months = (a.y - b.y) * 12 + (a.m - b.m);
  if (a.d < b.d) months -= 1;
  return Math.max(0, months);
}

export function ageLabelAt(birthDate: Date, at: Date): string {
  const months = ageMonthsAt(birthDate, at);
  if (months < 1) return "생후 0개월";
  if (months < 24) return `생후 ${months}개월`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years}세` : `${years}세 ${rest}개월`;
}

/** 분 단위 → "1시간 30분" / "45분" / "12시간" */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "-";
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

/** 수면 구간의 분 차이 (자정을 넘겨도 단순 시각 차) */
export function diffMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

export function todayKstKey(now: Date = new Date()): string {
  return kstDateKey(now);
}
