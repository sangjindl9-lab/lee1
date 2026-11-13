// 화면에 표시할 숫자·비율·날짜 형식입니다. 반올림은 여기(표시 단계)에서만 합니다.

import type { ScheduleStatus, WeightBasis } from '../shared/types';

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 천 단위 구분 기호를 넣은 숫자. 예: 1234567 → "1,234,567", 1234.5 → "1,234.5"
 * 소수는 넷째 자리에서 반올림하고 끝의 0은 지웁니다. 값이 없으면 빈 문자열입니다.
 */
export function formatNumber(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '';
  const rounded = Math.round((value + Math.sign(value) * Number.EPSILON) * 1000) / 1000;
  if (rounded === 0) return '0';
  const [integer, fraction] = Math.abs(rounded).toFixed(3).split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${rounded < 0 ? '-' : ''}${groupThousands(integer)}${trimmed === '' ? '' : `.${trimmed}`}`;
}

/** 소수 둘째 자리로 반올림한 비율(기호 없음). 예: 18.985 → "18.99", 100 → "100.00" */
export function formatRate(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '';
  // 18.985처럼 이진 표현 때문에 내림되는 값을 보정한 뒤 반올림합니다.
  const rounded = Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
  // -0은 0으로 씁니다.
  return (rounded === 0 ? 0 : rounded).toFixed(2);
}

/** 소수 둘째 자리 비율에 %를 붙입니다. 예: 37.5 → "37.50%" */
export function formatPercent(value: number | null | undefined): string {
  const rate = formatRate(value);
  return rate === '' ? '' : `${rate}%`;
}

/** 편차 표시. 양수에는 +를 붙입니다. 예: 2.5 → "+2.50%p", -1.234 → "-1.23%p" */
export function formatVariance(value: number | null | undefined): string {
  const rate = formatRate(value);
  if (rate === '') return '';
  return `${Number(rate) > 0 ? '+' : ''}${rate}%p`;
}

/** YYYY-MM-DD → "2026.01.05". 형식이 다르면 받은 값을 그대로 돌려줍니다. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : date;
}

/** 기간 표시. 예: "2026.01.01 ~ 2026.06.30" */
export function formatDateRange(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
}

/** 브라우저 PC의 오늘 날짜(YYYY-MM-DD) */
export function todayString(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  ahead: '앞섬',
  onTrack: '정상',
  behind: '지연',
};

export function statusLabel(status: ScheduleStatus): string {
  return STATUS_LABELS[status];
}

const WEIGHT_BASIS_LABELS: Record<WeightBasis, string> = {
  amount: '금액',
  manual: '가중치',
};

export function weightBasisLabel(basis: WeightBasis): string {
  return WEIGHT_BASIS_LABELS[basis];
}
