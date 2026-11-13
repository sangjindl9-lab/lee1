// YYYY-MM-DD 날짜 문자열 연산입니다.
// 모든 연산은 UTC 기준 "일 번호"로 수행하므로 실행 환경의 시간대·서머타임에 영향을 받지 않습니다.

import type { Period, PeriodUnit } from './types';

const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 형식이 YYYY-MM-DD이고 실제로 존재하는 날짜인지 검사합니다. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** 해당 월의 일수(month는 1~12). */
export function daysInMonth(year: number, month: number): number {
  const date = new Date(Date.UTC(2000, month, 0));
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/** 날짜 문자열을 1970-01-01부터의 일 번호로 바꿉니다. 올바르지 않은 날짜면 오류를 던집니다. */
export function toDayNumber(date: string): number {
  if (!isValidDate(date)) {
    throw new RangeError(`올바른 날짜(YYYY-MM-DD)가 아닙니다: ${String(date)}`);
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  // Date.UTC는 0~99년을 1900년대로 해석하므로 연도는 따로 지정합니다.
  const utc = new Date(Date.UTC(2000, month - 1, day));
  utc.setUTCFullYear(year, month - 1, day);
  return Math.round(utc.getTime() / MS_PER_DAY);
}

/** 일 번호를 YYYY-MM-DD 문자열로 바꿉니다. */
export function fromDayNumber(dayNumber: number): string {
  const date = new Date(dayNumber * MS_PER_DAY);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** to − from 일수. 같은 날이면 0, to가 더 이르면 음수입니다. */
export function diffDays(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 날짜에 일수를 더합니다(음수 가능). */
export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

/** 시작일과 종료일을 모두 포함한 일수. 종료일이 더 이르면 0입니다. */
export function inclusiveDays(start: string, end: string): number {
  return Math.max(0, diffDays(start, end) + 1);
}

/** 두 구간(양 끝 포함)이 겹치는 일수. 겹치지 않으면 0입니다. */
export function overlapDays(startA: string, endA: string, startB: string, endB: string): number {
  const start = Math.max(toDayNumber(startA), toDayNumber(startB));
  const end = Math.min(toDayNumber(endA), toDayNumber(endB));
  return Math.max(0, end - start + 1);
}

/** 요일. 0=월요일 … 6=일요일 */
export function weekdayMondayFirst(date: string): number {
  // 1970-01-01(일 번호 0)은 목요일입니다.
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}

/** 그 날짜가 속한 주의 월요일. */
export function startOfWeek(date: string): string {
  return addDays(date, -weekdayMondayFirst(date));
}

/** 시작일이 속한 달부터 종료일이 속한 달까지의 달력 월 목록. */
export function monthPeriods(startDate: string, endDate: string): Period[] {
  if (diffDays(startDate, endDate) < 0) return [];
  const endYear = Number(endDate.slice(0, 4));
  const endMonth = Number(endDate.slice(5, 7));
  let year = Number(startDate.slice(0, 4));
  let month = Number(startDate.slice(5, 7));

  const periods: Period[] = [];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    periods.push({
      key,
      label: `${year}년 ${month}월`,
      start: `${key}-01`,
      end: `${key}-${String(daysInMonth(year, month)).padStart(2, '0')}`,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}

function monthDayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 시작일이 속한 주부터 종료일이 속한 주까지의 월요일~일요일 목록. */
export function weekPeriods(startDate: string, endDate: string): Period[] {
  if (diffDays(startDate, endDate) < 0) return [];
  const last = toDayNumber(endDate);

  const periods: Period[] = [];
  for (let day = toDayNumber(startOfWeek(startDate)); day <= last; day += 7) {
    const start = fromDayNumber(day);
    const end = fromDayNumber(day + 6);
    periods.push({
      key: start,
      label: `${monthDayLabel(start)}~${monthDayLabel(end)}`,
      start,
      end,
    });
  }
  return periods;
}

/** 기간 단위에 맞는 기간 목록. 종료일이 시작일보다 이르면 빈 배열입니다. */
export function buildPeriods(startDate: string, endDate: string, unit: PeriodUnit): Period[] {
  return unit === 'week' ? weekPeriods(startDate, endDate) : monthPeriods(startDate, endDate);
}
