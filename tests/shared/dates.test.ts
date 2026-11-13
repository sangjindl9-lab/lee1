import { afterEach, describe, expect, it } from 'vitest';
import {
  addDays,
  buildPeriods,
  daysInMonth,
  diffDays,
  inclusiveDays,
  isValidDate,
  monthPeriods,
  overlapDays,
  startOfWeek,
  weekdayMondayFirst,
  weekPeriods,
} from '../../src/shared/dates';

describe('isValidDate', () => {
  it('YYYY-MM-DD 형식의 실제 날짜만 통과한다', () => {
    expect(isValidDate('2026-01-01')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-12-31')).toBe(true);
  });

  it('존재하지 않는 날짜를 거부한다', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-04-31')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-10')).toBe(false);
    expect(isValidDate('2026-01-00')).toBe(false);
    expect(isValidDate('1900-02-29')).toBe(false);
  });

  it('형식이 다른 값과 문자열이 아닌 값을 거부한다', () => {
    expect(isValidDate('2026-1-1')).toBe(false);
    expect(isValidDate('2026/01/01')).toBe(false);
    expect(isValidDate('20260101')).toBe(false);
    expect(isValidDate('2026-01-01T00:00:00Z')).toBe(false);
    expect(isValidDate(' 2026-01-01')).toBe(false);
    expect(isValidDate('')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(20260101)).toBe(false);
  });
});

describe('daysInMonth', () => {
  it('월별 일수와 윤년을 계산한다', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('diffDays / addDays / inclusiveDays', () => {
  it('일수 차이를 계산한다', () => {
    expect(diffDays('2026-01-01', '2026-01-01')).toBe(0);
    expect(diffDays('2026-01-01', '2026-01-31')).toBe(30);
    expect(diffDays('2026-01-31', '2026-01-01')).toBe(-30);
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
    expect(diffDays('2024-01-01', '2025-01-01')).toBe(366);
  });

  it('날짜를 더하고 뺀다', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-01-01', 0)).toBe('2026-01-01');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('양 끝을 포함한 일수를 센다', () => {
    expect(inclusiveDays('2026-01-01', '2026-01-31')).toBe(31);
    expect(inclusiveDays('2026-02-01', '2026-03-31')).toBe(59);
    expect(inclusiveDays('2026-01-01', '2026-01-01')).toBe(1);
    expect(inclusiveDays('2026-01-02', '2026-01-01')).toBe(0);
  });

  it('올바르지 않은 날짜는 오류를 던진다', () => {
    expect(() => diffDays('2026-02-30', '2026-03-01')).toThrow(RangeError);
    expect(() => addDays('날짜아님', 1)).toThrow(RangeError);
  });
});

describe('overlapDays', () => {
  it('구간이 겹치는 일수를 양 끝 포함으로 센다', () => {
    expect(overlapDays('2026-02-01', '2026-03-31', '2026-02-01', '2026-02-28')).toBe(28);
    expect(overlapDays('2026-02-01', '2026-03-31', '2026-03-01', '2026-03-31')).toBe(31);
    expect(overlapDays('2026-01-10', '2026-01-20', '2026-01-01', '2026-01-31')).toBe(11);
    expect(overlapDays('2026-01-01', '2026-01-31', '2026-01-31', '2026-02-28')).toBe(1);
  });

  it('겹치지 않으면 0이다', () => {
    expect(overlapDays('2026-01-01', '2026-01-31', '2026-02-01', '2026-02-28')).toBe(0);
    expect(overlapDays('2026-03-01', '2026-03-31', '2026-01-01', '2026-01-31')).toBe(0);
  });
});

describe('요일과 주 시작일', () => {
  it('월요일을 0으로 하는 요일을 구한다', () => {
    expect(weekdayMondayFirst('2026-01-01')).toBe(3); // 목
    expect(weekdayMondayFirst('2026-01-05')).toBe(0); // 월
    expect(weekdayMondayFirst('2026-01-04')).toBe(6); // 일
    expect(weekdayMondayFirst('1969-12-29')).toBe(0); // 1970년 이전의 월요일
  });

  it('그 주의 월요일을 구한다', () => {
    expect(startOfWeek('2026-01-01')).toBe('2025-12-29');
    expect(startOfWeek('2026-01-05')).toBe('2026-01-05');
    expect(startOfWeek('2026-01-11')).toBe('2026-01-05');
  });
});

describe('monthPeriods', () => {
  it('AC-F4-4: 2026-01-01 ~ 2026-03-31은 2026년 1월·2월·3월 3개이다', () => {
    expect(monthPeriods('2026-01-01', '2026-03-31')).toEqual([
      { key: '2026-01', label: '2026년 1월', start: '2026-01-01', end: '2026-01-31' },
      { key: '2026-02', label: '2026년 2월', start: '2026-02-01', end: '2026-02-28' },
      { key: '2026-03', label: '2026년 3월', start: '2026-03-01', end: '2026-03-31' },
    ]);
  });

  it('달 중간에 시작·종료해도 달력 월 전체를 기간으로 하고 해를 넘긴다', () => {
    const periods = monthPeriods('2026-11-15', '2027-02-10');
    expect(periods.map((p) => p.key)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(periods[0].start).toBe('2026-11-01');
    expect(periods[3].end).toBe('2027-02-28');
    expect(periods[2].label).toBe('2027년 1월');
  });

  it('같은 달 안의 프로젝트는 기간이 1개이다', () => {
    expect(monthPeriods('2026-05-10', '2026-05-10')).toHaveLength(1);
  });

  it('종료일이 시작일보다 이르면 빈 배열이다', () => {
    expect(monthPeriods('2026-03-01', '2026-01-01')).toEqual([]);
  });
});

describe('weekPeriods', () => {
  it('AC-F4-5: 모든 기간이 월요일~일요일이고 첫·마지막 기간이 프로젝트 시작일·종료일을 포함한다', () => {
    const start = '2026-01-01';
    const end = '2026-03-31';
    const periods = weekPeriods(start, end);

    expect(periods.length).toBeGreaterThan(0);
    for (const period of periods) {
      expect(weekdayMondayFirst(period.start)).toBe(0);
      expect(weekdayMondayFirst(period.end)).toBe(6);
      expect(diffDays(period.start, period.end)).toBe(6);
      expect(period.key).toBe(period.start);
    }
    for (let i = 1; i < periods.length; i += 1) {
      expect(diffDays(periods[i - 1].end, periods[i].start)).toBe(1);
    }

    const first = periods[0];
    const last = periods[periods.length - 1];
    expect(first.start <= start && start <= first.end).toBe(true);
    expect(last.start <= end && end <= last.end).toBe(true);
  });

  it('2026-01-01(목) ~ 2026-01-14(수)는 3주이며 라벨은 월/일~월/일 형식이다', () => {
    expect(weekPeriods('2026-01-01', '2026-01-14')).toEqual([
      { key: '2025-12-29', label: '12/29~1/4', start: '2025-12-29', end: '2026-01-04' },
      { key: '2026-01-05', label: '1/5~1/11', start: '2026-01-05', end: '2026-01-11' },
      { key: '2026-01-12', label: '1/12~1/18', start: '2026-01-12', end: '2026-01-18' },
    ]);
  });

  it('월요일에 시작해 일요일에 끝나는 프로젝트는 주가 딱 맞는다', () => {
    const periods = weekPeriods('2026-01-05', '2026-01-18');
    expect(periods).toHaveLength(2);
    expect(periods[0].start).toBe('2026-01-05');
    expect(periods[1].end).toBe('2026-01-18');
  });

  it('종료일이 시작일보다 이르면 빈 배열이다', () => {
    expect(weekPeriods('2026-01-14', '2026-01-01')).toEqual([]);
  });
});

describe('buildPeriods', () => {
  it('단위에 따라 월 또는 주 목록을 만든다', () => {
    expect(buildPeriods('2026-01-01', '2026-03-31', 'month')).toHaveLength(3);
    expect(buildPeriods('2026-01-01', '2026-01-14', 'week')).toHaveLength(3);
  });
});

describe('시간대 독립성', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each(['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
    '시간대가 %s여도 결과가 같다',
    (tz) => {
      process.env.TZ = tz;
      expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
      expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // 미국 서머타임 시작일
      expect(diffDays('2026-03-01', '2026-03-31')).toBe(30);
      expect(diffDays('2026-10-25', '2026-11-02')).toBe(8); // 서머타임 종료 구간
      expect(weekdayMondayFirst('2026-01-05')).toBe(0);
      expect(monthPeriods('2026-01-01', '2026-03-31').map((p) => p.end)).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
      ]);
    },
  );
});
