// 보할 공정표 계산 엔진입니다. 부수효과가 없으며 반올림하지 않습니다.
// 규칙 번호는 docs/ARCHITECTURE.md "계산 규칙" 절의 번호입니다.

import { buildPeriods, toDayNumber } from './dates';
import type {
  PeriodUnit,
  ProgressRecord,
  Project,
  Schedule,
  ScheduleRow,
  ScheduleStatus,
  Task,
} from './types';

/** 편차가 이 값(%p) 이상 벌어지면 앞섬/지연으로 봅니다. */
export const STATUS_THRESHOLD = 1;

/** 규칙 9: 편차(실적 − 계획)로 진도 상태를 판정합니다. */
export function statusFromVariance(variance: number): ScheduleStatus {
  if (variance >= STATUS_THRESHOLD) return 'ahead';
  if (variance <= -STATUS_THRESHOLD) return 'behind';
  return 'onTrack';
}

interface ProgressPoint {
  day: number;
  percent: number;
}

/** 공종별 실적 기록을 날짜 오름차순으로 묶습니다. */
function groupProgress(progress: readonly ProgressRecord[]): Map<string, ProgressPoint[]> {
  const byTask = new Map<string, ProgressPoint[]>();
  for (const record of progress) {
    const point = { day: toDayNumber(record.date), percent: record.percent };
    const list = byTask.get(record.taskId);
    if (list) list.push(point);
    else byTask.set(record.taskId, [point]);
  }
  for (const list of byTask.values()) list.sort((a, b) => a.day - b.day);
  return byTask;
}

/** 규칙 5: day 이하 날짜의 기록 중 가장 최근 값, 없으면 0. */
function percentAt(points: readonly ProgressPoint[] | undefined, day: number): number {
  if (!points) return 0;
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (points[mid].day <= day) low = mid + 1;
    else high = mid;
  }
  return low === 0 ? 0 : points[low - 1].percent;
}

/**
 * 프로젝트의 보할 공정표를 계산합니다.
 * tasks 중 이 프로젝트에 속한 공종만 사용하며, 행은 order 순서입니다.
 */
export function buildSchedule(
  project: Project,
  tasks: readonly Task[],
  progress: readonly ProgressRecord[],
  unit: PeriodUnit,
  asOf: string,
): Schedule {
  const asOfDay = toDayNumber(asOf);
  const periods = buildPeriods(project.startDate, project.endDate, unit);
  const periodDays = periods.map((period) => ({
    start: toDayNumber(period.start),
    end: toDayNumber(period.end),
  }));

  const ordered = tasks
    .filter((task) => task.projectId === project.id)
    .sort((a, b) => a.order - b.order);
  const progressByTask = groupProgress(progress);

  const totalWeight = ordered.reduce((sum, task) => sum + task.weightValue, 0);

  const periodPlanned = periods.map(() => 0);
  const cumulativeActualRaw = periods.map(() => 0);
  let plannedToDate = 0;
  let actualToDate = 0;

  const rows: ScheduleRow[] = ordered.map((task) => {
    // 규칙 1
    const bohal = totalWeight > 0 ? (task.weightValue / totalWeight) * 100 : 0;

    // 규칙 2
    const taskStart = toDayNumber(task.startDate);
    const taskEnd = toDayNumber(task.endDate);
    const duration = taskEnd - taskStart + 1;

    // 규칙 3, 4
    const planned = periodDays.map((period, index) => {
      const overlap = Math.min(taskEnd, period.end) - Math.max(taskStart, period.start) + 1;
      if (overlap <= 0 || duration <= 0) return null;
      const value = (bohal * overlap) / duration;
      periodPlanned[index] += value;
      return value;
    });

    // 규칙 6, 7
    const points = progressByTask.get(task.id);
    periodDays.forEach((period, index) => {
      if (period.start > asOfDay) return;
      cumulativeActualRaw[index] += (bohal * percentAt(points, Math.min(period.end, asOfDay))) / 100;
    });

    // 규칙 8
    if (duration > 0) {
      const elapsed = Math.min(Math.max((asOfDay - taskStart + 1) / duration, 0), 1);
      plannedToDate += bohal * elapsed;
    }

    const currentPercent = percentAt(points, asOfDay);
    actualToDate += (bohal * currentPercent) / 100;

    return {
      taskId: task.id,
      category: task.category,
      name: task.name,
      weightValue: task.weightValue,
      bohal,
      startDate: task.startDate,
      endDate: task.endDate,
      currentPercent,
      planned,
    };
  });

  // 규칙 4
  const cumulativePlanned: number[] = [];
  let runningPlanned = 0;
  for (const value of periodPlanned) {
    runningPlanned += value;
    cumulativePlanned.push(runningPlanned);
  }

  // 규칙 6, 7
  const cumulativeActual: (number | null)[] = [];
  const periodActual: (number | null)[] = [];
  let previousActual = 0;
  periodDays.forEach((period, index) => {
    if (period.start > asOfDay) {
      cumulativeActual.push(null);
      periodActual.push(null);
      return;
    }
    const value = cumulativeActualRaw[index];
    cumulativeActual.push(value);
    periodActual.push(value - previousActual);
    previousActual = value;
  });

  const inProject =
    asOfDay >= toDayNumber(project.startDate) && asOfDay <= toDayNumber(project.endDate);
  const foundIndex = inProject
    ? periodDays.findIndex((period) => period.start <= asOfDay && asOfDay <= period.end)
    : -1;

  const variance = actualToDate - plannedToDate;

  return {
    project,
    unit,
    asOf,
    periods,
    asOfPeriodIndex: foundIndex >= 0 ? foundIndex : null,
    rows,
    totals: {
      weightValue: totalWeight,
      bohal: totalWeight > 0 ? 100 : 0,
      periodPlanned,
      cumulativePlanned,
      periodActual,
      cumulativeActual,
    },
    summary: {
      plannedToDate,
      actualToDate,
      variance,
      status: statusFromVariance(variance),
    },
  };
}
