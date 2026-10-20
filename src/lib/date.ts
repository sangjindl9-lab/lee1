// 시간대 영향을 받지 않는 달력 날짜 연산.
// 모든 날짜는 'YYYY-MM-DD' 문자열이며 내부적으로 1970-01-01 기준 정수 일수(day number)로 계산한다.
import type { ISODate } from './types';

const MS = 86400000;

export function isValidDate(s: string | null | undefined): s is ISODate {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function toNum(s: ISODate): number {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS);
}

export function fromNum(n: number): ISODate {
  const dt = new Date(n * MS);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(s: ISODate, k: number): ISODate {
  return fromNum(toNum(s) + k);
}

/** 양 끝 포함 일수 */
export function spanDays(a: ISODate, b: ISODate): number {
  return toNum(b) - toNum(a) + 1;
}

/** 0=일 … 6=토 */
export function weekday(s: ISODate | number): number {
  const n = typeof s === 'number' ? s : toNum(s);
  return (((n + 4) % 7) + 7) % 7;
}

export function parts(s: ISODate) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function minDate(a: ISODate, b: ISODate) {
  return a < b ? a : b;
}
export function maxDate(a: ISODate, b: ISODate) {
  return a > b ? a : b;
}

/** 한국 표준시(KST, UTC+9) 기준 오늘 날짜 — 브라우저 시간대와 무관 */
export function todayKST(): ISODate {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function fmtDot(s: ISODate): string {
  return s ? s.replace(/-/g, '.') : '';
}
export function fmtMD(s: ISODate): string {
  const { m, d } = parts(s);
  return `${m}/${d}`;
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function weekdayKo(s: ISODate): string {
  return WD[weekday(s)];
}
