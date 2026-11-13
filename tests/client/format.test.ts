import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatPercent,
  formatRate,
  formatVariance,
  statusLabel,
  todayString,
  weightBasisLabel,
} from '../../src/client/format';

describe('formatNumber (AC-F6-7 금액은 천 단위 구분 기호)', () => {
  it('천 단위마다 쉼표를 넣는다', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(150000000)).toBe('150,000,000');
  });

  it('소수와 음수도 처리한다', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatNumber(0.25)).toBe('0.25');
    expect(formatNumber(-1234567)).toBe('-1,234,567');
    expect(formatNumber(-0)).toBe('0');
  });

  it('값이 없으면 빈 문자열이다', () => {
    expect(formatNumber(null)).toBe('');
    expect(formatNumber(undefined)).toBe('');
    expect(formatNumber(Number.NaN)).toBe('');
  });
});

describe('formatRate, formatPercent (AC-F6-7 비율은 소수 둘째 자리)', () => {
  it('항상 소수 둘째 자리까지 표시한다', () => {
    expect(formatRate(0)).toBe('0.00');
    expect(formatRate(100)).toBe('100.00');
    expect(formatRate(37.5)).toBe('37.50');
    expect(formatRate(33.333333)).toBe('33.33');
    expect(formatRate(66.666666)).toBe('66.67');
  });

  it('둘째 자리에서 반올림하고 이진 표현 오차를 보정한다', () => {
    expect(formatRate(18.985)).toBe('18.99');
    expect(formatRate(1.005)).toBe('1.01');
    expect(formatRate(-0.001)).toBe('0.00');
  });

  it('formatPercent는 % 기호를 붙인다', () => {
    expect(formatPercent(37.5)).toBe('37.50%');
    expect(formatPercent(100)).toBe('100.00%');
    expect(formatPercent(null)).toBe('');
  });

  it('formatVariance는 부호와 %p를 붙인다', () => {
    expect(formatVariance(2.5)).toBe('+2.50%p');
    expect(formatVariance(-1.234)).toBe('-1.23%p');
    expect(formatVariance(0)).toBe('0.00%p');
  });
});

describe('날짜 표시', () => {
  it('YYYY-MM-DD를 점으로 구분해 표시한다', () => {
    expect(formatDate('2026-01-05')).toBe('2026.01.05');
    expect(formatDate('')).toBe('');
    expect(formatDate('날짜 아님')).toBe('날짜 아님');
  });

  it('기간을 시작일 ~ 종료일로 표시한다', () => {
    expect(formatDateRange('2026-01-01', '2026-06-30')).toBe('2026.01.01 ~ 2026.06.30');
  });

  it('오늘 날짜를 PC 달력 기준 YYYY-MM-DD로 만든다', () => {
    expect(todayString(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('한국어 이름', () => {
  it('상태와 보할 기준을 한국어로 바꾼다', () => {
    expect(statusLabel('ahead')).toBe('앞섬');
    expect(statusLabel('onTrack')).toBe('정상');
    expect(statusLabel('behind')).toBe('지연');
    expect(weightBasisLabel('amount')).toBe('금액');
    expect(weightBasisLabel('manual')).toBe('가중치');
  });
});
