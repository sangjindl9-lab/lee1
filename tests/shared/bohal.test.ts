import { describe, expect, it } from 'vitest';
import { buildSchedule, statusFromVariance } from '../../src/shared/bohal';
import { addDays, weekdayMondayFirst } from '../../src/shared/dates';
import type { ProgressRecord, Project, Task, WeightBasis } from '../../src/shared/types';

const PROJECT_ID = 'p1';

function makeProject(
  startDate = '2026-01-01',
  endDate = '2026-03-31',
  weightBasis: WeightBasis = 'amount',
): Project {
  return {
    id: PROJECT_ID,
    name: '예제 프로젝트',
    description: '',
    startDate,
    endDate,
    weightBasis,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeTask(
  id: string,
  weightValue: number,
  startDate: string,
  endDate: string,
  order: number,
): Task {
  return { id, projectId: PROJECT_ID, category: '', name: `공종 ${id}`, weightValue, startDate, endDate, order };
}

function record(taskId: string, date: string, percent: number): ProgressRecord {
  return { id: `${taskId}-${date}`, taskId, date, percent };
}

/** 소수 둘째 자리까지 일치하는지 검사합니다(화면 표시와 같은 반올림). */
function expect2(actual: number | null | undefined, expected: number): void {
  expect(actual).not.toBeNull();
  expect(actual).not.toBeUndefined();
  expect((actual as number).toFixed(2)).toBe(expected.toFixed(2));
}

function expectAll2(actual: (number | null)[], expected: (number | null)[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    if (value === null) expect(actual[index]).toBeNull();
    else expect2(actual[index], value);
  });
}

// ACCEPTANCE_CRITERIA.md의 기준 예제 데이터
const exampleProject = makeProject();
const taskA = makeTask('A', 60_000_000, '2026-01-01', '2026-01-31', 0);
const taskB = makeTask('B', 40_000_000, '2026-02-01', '2026-03-31', 1);
const exampleTasks = [taskA, taskB];
const exampleProgress = [record('A', '2026-01-31', 100), record('B', '2026-02-28', 50)];

describe('AC-F3 보할 계산', () => {
  it('AC-F3-1: 예제 프로젝트의 보할은 A 60.00, B 40.00이다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, [], 'month', '2026-01-01');
    expect2(schedule.rows[0].bohal, 60);
    expect2(schedule.rows[1].bohal, 40);
    expect(schedule.totals.weightValue).toBe(100_000_000);
    expect(schedule.totals.bohal).toBe(100);
  });

  it('AC-F3-2: 금액 1, 1, 1인 공종의 보할은 각각 33.33이고 합계는 100.00이다', () => {
    const tasks = [0, 1, 2].map((i) => makeTask(`t${i}`, 1, '2026-01-01', '2026-03-31', i));
    const schedule = buildSchedule(exampleProject, tasks, [], 'month', '2026-01-01');
    for (const row of schedule.rows) expect2(row.bohal, 33.33);
    expect2(schedule.totals.bohal, 100);
    expect2(schedule.rows.reduce((sum, row) => sum + row.bohal, 0), 100);
  });

  it('AC-F3-3: 금액 100,000,000인 공종을 추가하면 A 30.00, B 20.00으로 바뀐다', () => {
    const tasks = [...exampleTasks, makeTask('C', 100_000_000, '2026-01-01', '2026-03-31', 2)];
    const schedule = buildSchedule(exampleProject, tasks, [], 'month', '2026-01-01');
    expect2(schedule.rows[0].bohal, 30);
    expect2(schedule.rows[1].bohal, 20);
    expect2(schedule.rows[2].bohal, 50);
  });

  it.each(['month', 'week'] as const)(
    'AC-F3-4: 공종이 없는 프로젝트도 오류 없이 합계 0인 결과를 반환한다(%s)',
    (unit) => {
      const schedule = buildSchedule(exampleProject, [], [], unit, '2026-02-15');
      expect(schedule.rows).toEqual([]);
      expect(schedule.totals.weightValue).toBe(0);
      expect(schedule.totals.bohal).toBe(0);
      expect(schedule.periods.length).toBeGreaterThan(0);
      expect(schedule.totals.periodPlanned.every((v) => v === 0)).toBe(true);
      expect(schedule.totals.cumulativePlanned.every((v) => v === 0)).toBe(true);
      expect(schedule.totals.cumulativeActual.every((v) => v === 0 || v === null)).toBe(true);
      expect(schedule.summary).toEqual({
        plannedToDate: 0,
        actualToDate: 0,
        variance: 0,
        status: 'onTrack',
      });
    },
  );

  it('AC-F3-5: 가중치 2와 6인 공종의 보할은 25.00과 75.00이다', () => {
    const project = makeProject('2026-01-01', '2026-03-31', 'manual');
    const tasks = [
      makeTask('x', 2, '2026-01-01', '2026-01-31', 0),
      makeTask('y', 6, '2026-02-01', '2026-03-31', 1),
    ];
    const schedule = buildSchedule(project, tasks, [], 'month', '2026-01-01');
    expect2(schedule.rows[0].bohal, 25);
    expect2(schedule.rows[1].bohal, 75);
  });
});

describe('AC-F4 계획 공정률', () => {
  it('AC-F4-1, AC-F4-3: 예제 프로젝트의 월 단위 계획이 기준 표와 일치하고 겹치지 않는 셀은 null이다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, [], 'month', '2026-01-01');

    expectAll2(schedule.rows[0].planned, [60, null, null]);
    expectAll2(schedule.rows[1].planned, [null, 18.98, 21.02]);
    expectAll2(schedule.totals.periodPlanned, [60, 18.98, 21.02]);
    expectAll2(schedule.totals.cumulativePlanned, [60, 78.98, 100]);
  });

  it('AC-F4-4: 월 단위 기간은 2026년 1월·2월·3월 3개이다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, [], 'month', '2026-01-01');
    expect(schedule.unit).toBe('month');
    expect(schedule.periods.map((p) => p.label)).toEqual(['2026년 1월', '2026년 2월', '2026년 3월']);
    expect(schedule.periods.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('AC-F4-5: 주 단위 기간은 월요일~일요일이고 프로젝트 시작일·종료일을 포함한다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, [], 'week', '2026-01-01');
    const { periods } = schedule;
    for (const period of periods) {
      expect(weekdayMondayFirst(period.start)).toBe(0);
      expect(weekdayMondayFirst(period.end)).toBe(6);
    }
    expect(periods[0].start <= '2026-01-01' && '2026-01-01' <= periods[0].end).toBe(true);
    const last = periods[periods.length - 1];
    expect(last.start <= '2026-03-31' && '2026-03-31' <= last.end).toBe(true);
  });

  it('AC-F4-6: 2026-01-01(목) ~ 2026-01-14(수) 공종 1개의 주 단위 기간 계획은 28.57, 50.00, 21.43이다', () => {
    const project = makeProject('2026-01-01', '2026-01-14');
    const tasks = [makeTask('only', 500, '2026-01-01', '2026-01-14', 0)];
    const schedule = buildSchedule(project, tasks, [], 'week', '2026-01-01');

    expect2(schedule.rows[0].bohal, 100);
    expectAll2(schedule.totals.periodPlanned, [28.57, 50, 21.43]);
    expectAll2(schedule.rows[0].planned, [28.57, 50, 21.43]);
    expectAll2(schedule.totals.cumulativePlanned, [28.57, 78.57, 100]);
  });

  it.each(['month', 'week'] as const)(
    'AC-F4-2, AC-F4-7: %s 단위에서 기간 계획의 합과 마지막 누계 계획은 100.00이다',
    (unit) => {
      const project = makeProject('2026-01-07', '2026-06-18');
      const tasks = [
        makeTask('a', 12_345_678, '2026-01-07', '2026-02-11', 0),
        makeTask('b', 7_000_001, '2026-01-20', '2026-04-30', 1),
        makeTask('c', 333, '2026-03-03', '2026-03-03', 2),
        makeTask('d', 98_765_432, '2026-04-15', '2026-06-18', 3),
      ];
      for (const set of [tasks, exampleTasks.map((t) => ({ ...t })), [tasks[2]]]) {
        const target = set === tasks || set.length === 1 ? project : exampleProject;
        const schedule = buildSchedule(target, set, [], unit, '2026-01-01');
        const { periodPlanned, cumulativePlanned } = schedule.totals;
        expect2(periodPlanned.reduce((sum, v) => sum + v, 0), 100);
        expect2(cumulativePlanned[cumulativePlanned.length - 1], 100);
        // 공종별 계획값의 합은 그 공종의 보할과 같다
        for (const row of schedule.rows) {
          const rowSum = row.planned.reduce<number>((sum, v) => sum + (v ?? 0), 0);
          expect(rowSum).toBeCloseTo(row.bohal, 9);
        }
      }
    },
  );

  it('시작일과 종료일이 같은 하루짜리 공종은 한 기간에 보할 전체가 배분된다', () => {
    const tasks = [makeTask('one', 10, '2026-02-10', '2026-02-10', 0)];
    const schedule = buildSchedule(exampleProject, tasks, [], 'month', '2026-01-01');
    expectAll2(schedule.rows[0].planned, [null, 100, null]);
  });

  it('반올림하지 않은 값을 반환한다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, [], 'month', '2026-01-01');
    expect(schedule.rows[1].planned[1]).toBeCloseTo((40 * 28) / 59, 12);
    expect(schedule.rows[1].planned[1]).not.toBe(18.98);
  });

  it('행은 order 순서로 정렬되고 다른 프로젝트의 공종은 제외하며 입력 배열을 바꾸지 않는다', () => {
    const other: Task = { ...makeTask('Z', 999, '2026-01-01', '2026-01-31', 0), projectId: 'other' };
    const input = [taskB, other, taskA];
    const schedule = buildSchedule(exampleProject, input, [], 'month', '2026-01-01');
    expect(schedule.rows.map((row) => row.taskId)).toEqual(['A', 'B']);
    expect(schedule.totals.weightValue).toBe(100_000_000);
    expect(input.map((task) => task.id)).toEqual(['B', 'Z', 'A']);
  });
});

describe('AC-F5 실적', () => {
  it('AC-F5-6: 기준일 2026-02-28의 누계 실적은 60.00, 80.00, 기간 실적은 60.00, 20.00이고 3월은 null이다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, exampleProgress, 'month', '2026-02-28');

    expectAll2(schedule.totals.cumulativeActual, [60, 80, null]);
    expectAll2(schedule.totals.periodActual, [60, 20, null]);
    expect(schedule.rows[0].currentPercent).toBe(100);
    expect(schedule.rows[1].currentPercent).toBe(50);
    expect(schedule.asOfPeriodIndex).toBe(1);
  });

  it('AC-F5-7: 기준일을 2026-01-31로 바꾸면 2월 실적이 null이 되고 1월 누계 실적은 60.00이다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, exampleProgress, 'month', '2026-01-31');

    expectAll2(schedule.totals.cumulativeActual, [60, null, null]);
    expectAll2(schedule.totals.periodActual, [60, null, null]);
    expect(schedule.rows[1].currentPercent).toBe(0);
    expect(schedule.asOfPeriodIndex).toBe(0);
  });

  it('AC-F5-8: 실적 기록이 없는 공종의 현재 진척률은 0이다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, [], 'month', '2026-03-31');
    expect(schedule.rows.map((row) => row.currentPercent)).toEqual([0, 0]);
    expectAll2(schedule.totals.cumulativeActual, [0, 0, 0]);
    expectAll2(schedule.totals.periodActual, [0, 0, 0]);
    expect(schedule.summary.actualToDate).toBe(0);
  });

  it('기준일이 속한 기간의 실적은 기준일까지의 기록만 반영한다', () => {
    const progress = [
      record('A', '2026-01-10', 20),
      record('A', '2026-01-20', 70),
      record('A', '2026-01-31', 100),
    ];
    // 입력 순서가 뒤섞여 있어도 날짜순으로 판단한다
    const shuffled = [progress[2], progress[0], progress[1]];

    const mid = buildSchedule(exampleProject, exampleTasks, shuffled, 'month', '2026-01-15');
    expect(mid.rows[0].currentPercent).toBe(20);
    expectAll2(mid.totals.cumulativeActual, [12, null, null]);

    const before = buildSchedule(exampleProject, exampleTasks, shuffled, 'month', '2026-01-09');
    expect(before.rows[0].currentPercent).toBe(0);
    expectAll2(before.totals.cumulativeActual, [0, null, null]);

    const onDay = buildSchedule(exampleProject, exampleTasks, shuffled, 'month', '2026-01-20');
    expect(onDay.rows[0].currentPercent).toBe(70);
    expect2(onDay.summary.actualToDate, 42);
  });

  it('주 단위에서도 기간 실적의 합이 마지막 누계 실적과 같다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, exampleProgress, 'week', '2026-02-28');
    const { periodActual, cumulativeActual } = schedule.totals;
    const known = cumulativeActual.filter((v): v is number => v !== null);
    const sum = periodActual.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    expect2(sum, 80);
    expect2(known[known.length - 1], 80);
    // 기준일 이후에 시작하는 주는 모두 null
    schedule.periods.forEach((period, index) => {
      expect(cumulativeActual[index] === null).toBe(period.start > '2026-02-28');
      expect(periodActual[index] === null).toBe(period.start > '2026-02-28');
    });
  });

  it('기준일이 프로젝트 시작 전이면 모든 실적이 null이고 강조 기간이 없다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, exampleProgress, 'month', '2025-12-31');
    expectAll2(schedule.totals.cumulativeActual, [null, null, null]);
    expectAll2(schedule.totals.periodActual, [null, null, null]);
    expect(schedule.asOfPeriodIndex).toBeNull();
    expect(schedule.summary.plannedToDate).toBe(0);
    expect(schedule.summary.actualToDate).toBe(0);
  });

  it('기준일이 프로젝트 종료 후이면 모든 기간에 실적이 있고 강조 기간이 없다', () => {
    const schedule = buildSchedule(exampleProject, exampleTasks, exampleProgress, 'month', '2026-05-01');
    expectAll2(schedule.totals.cumulativeActual, [60, 80, 80]);
    expectAll2(schedule.totals.periodActual, [60, 20, 0]);
    expect(schedule.asOfPeriodIndex).toBeNull();
    expect2(schedule.summary.plannedToDate, 100);
  });

  it('주 단위에서 기준일이 주에는 속하지만 프로젝트 기간 밖이면 강조 기간이 없다', () => {
    // 2026-01-01(목)이 속한 주는 2025-12-29(월)에 시작한다
    const schedule = buildSchedule(exampleProject, exampleTasks, [], 'week', '2025-12-30');
    expect(schedule.asOfPeriodIndex).toBeNull();
    const inside = buildSchedule(exampleProject, exampleTasks, [], 'week', '2026-01-06');
    expect(inside.asOfPeriodIndex).toBe(1);
  });
});

describe('AC-F7 진도 요약', () => {
  it('AC-F7-1: 기준일 2026-02-28에서 계획 78.98, 실적 80.00, 편차 +1.02, 상태 앞섬이다', () => {
    const { summary } = buildSchedule(exampleProject, exampleTasks, exampleProgress, 'month', '2026-02-28');
    expect2(summary.plannedToDate, 78.98);
    expect2(summary.actualToDate, 80);
    expect2(summary.variance, 1.02);
    expect(summary.status).toBe('ahead');
  });

  it('AC-F7-2: 실적 없이 기준일 2026-01-16이면 계획 30.97, 실적 0.00, 상태 지연이다', () => {
    const { summary } = buildSchedule(exampleProject, exampleTasks, [], 'month', '2026-01-16');
    expect2(summary.plannedToDate, 30.97);
    expect(summary.plannedToDate).toBeCloseTo((60 * 16) / 31, 10);
    expect2(summary.actualToDate, 0);
    expect(summary.status).toBe('behind');
  });

  it('AC-F7-3: 편차가 −1 초과 +1 미만이면 정상이고 경계값은 앞섬·지연이다', () => {
    expect(statusFromVariance(0)).toBe('onTrack');
    expect(statusFromVariance(0.99)).toBe('onTrack');
    expect(statusFromVariance(-0.99)).toBe('onTrack');
    expect(statusFromVariance(1)).toBe('ahead');
    expect(statusFromVariance(-1)).toBe('behind');
    expect(statusFromVariance(25)).toBe('ahead');
    expect(statusFromVariance(-25)).toBe('behind');
  });

  it('AC-F7-3: 계획과 실적 차이가 1%p 미만인 공정표의 상태는 정상이다', () => {
    // 기준일 2026-01-16의 계획 누계는 30.97 → A 진척률 51%면 실적 30.60(편차 −0.37)
    const { summary } = buildSchedule(
      exampleProject,
      exampleTasks,
      [record('A', '2026-01-16', 51)],
      'month',
      '2026-01-16',
    );
    expect2(summary.actualToDate, 30.6);
    expect2(summary.variance, -0.37);
    expect(summary.status).toBe('onTrack');
  });

  it('요약은 기간 단위와 무관하다', () => {
    const month = buildSchedule(exampleProject, exampleTasks, exampleProgress, 'month', '2026-02-14');
    const week = buildSchedule(exampleProject, exampleTasks, exampleProgress, 'week', '2026-02-14');
    expect(week.summary).toEqual(month.summary);
    expect(week.unit).toBe('week');
    expect(week.asOf).toBe('2026-02-14');
  });
});

describe('AC-N-1 성능', () => {
  it('공종 200개, 60개월 프로젝트의 계산이 1초 안에 끝난다', () => {
    const project = makeProject('2026-01-01', '2030-12-31');
    const tasks: Task[] = [];
    const progress: ProgressRecord[] = [];
    for (let i = 0; i < 200; i += 1) {
      const start = addDays(project.startDate, (i * 8) % 1500);
      const end = addDays(start, 30 + ((i * 37) % 300));
      tasks.push(makeTask(`t${i}`, 1_000_000 + i * 12_345, start, end, i));
      for (let k = 0; k < 20; k += 1) {
        progress.push(record(`t${i}`, addDays(start, k * 10), Math.min(100, k * 5)));
      }
    }

    const startedAt = performance.now();
    const month = buildSchedule(project, tasks, progress, 'month', '2028-06-15');
    const week = buildSchedule(project, tasks, progress, 'week', '2028-06-15');
    const elapsed = performance.now() - startedAt;

    expect(elapsed).toBeLessThan(1000);
    expect(month.periods).toHaveLength(60);
    expect(month.rows).toHaveLength(200);
    expect2(month.totals.cumulativePlanned[59], 100);
    expect2(week.totals.cumulativePlanned[week.periods.length - 1], 100);
    expect(month.summary.actualToDate).toBeGreaterThan(0);
  });
});
