import { describe, expect, it } from 'vitest';
import { addDays, isValidDate, spanDays, toNum, weekday, fromNum } from './date';
import { buildPeriods, computeProject, normalizeTo, plannedPct, WorkCalendar, entryPct, buildTree, taskPeriodPlan } from './calc';
import { generateTasks, newProject, rescaleTasks, sampleProject, fracRange } from './schedule';

describe('날짜', () => {
  it('윤년·연도 경계', () => {
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2027-02-29')).toBe(false);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(spanDays('2028-01-01', '2028-12-31')).toBe(366);
    expect(weekday('2026-10-20')).toBe(2); // 화요일
    expect(fromNum(toNum('2100-03-01'))).toBe('2100-03-01');
  });
});

describe('자동 생성', () => {
  it('전기공사 10공종, 보할 100, 기간 내 배치', () => {
    const p = newProject({ start: '2026-11-02', end: '2027-03-31', kind: 'elec' });
    const ts = generateTasks(p);
    expect(ts).toHaveLength(10);
    expect(ts.reduce((s, t) => s + t.weight, 0)).toBeCloseTo(100, 6);
    expect(ts[0].start).toBe('2026-11-02');
    expect(ts[9].end).toBe('2027-03-31');
    for (const t of ts) expect(t.start <= t.end).toBe(true);
  });
  it('통합공사: 상위 2 + 하위 20, 상위 보할 중복 없이 합계 100', () => {
    const p = newProject({ kind: 'both', start: '2026-01-01', end: '2026-06-30' });
    p.tasks = generateTasks(p);
    const c = computeProject(p);
    expect(c.tree.leaves).toHaveLength(20);
    expect(c.weightTotal).toBeCloseTo(100, 6);
    expect(c.tree.roots[0].weight).toBeCloseTo(60, 6);
  });
  it('짧은 공기(3일)도 정상', () => {
    const r = fracRange('2026-05-01', '2026-05-03', 94, 100);
    expect(r).toEqual({ start: '2026-05-03', end: '2026-05-03' });
    const p = newProject({ start: '2026-05-01', end: '2026-05-01' });
    expect(generateTasks(p).every((t) => t.start === '2026-05-01' && t.end === '2026-05-01')).toBe(true);
  });
});

describe('예정공정률', () => {
  it('선형 작업일 진도, 0~100, 준공일 100', () => {
    const p = newProject({ start: '2026-03-02', end: '2026-03-13', kind: 'elec' });
    p.calendar = { mode: 'weekday', distribution: 'workday', holidays: [] };
    p.tasks = generateTasks(p);
    const cal = new WorkCalendar(p.calendar, p.info.start, p.info.end);
    const t = { ...p.tasks[0], start: '2026-03-02', end: '2026-03-13', planCurve: null };
    expect(plannedPct(t, '2026-03-01', cal)).toBe(0);
    expect(plannedPct(t, '2026-03-06', cal)).toBeCloseTo(50, 6); // 10 작업일 중 5일
    expect(plannedPct(t, '2026-03-08', cal)).toBeCloseTo(50, 6); // 주말은 진도 없음
    expect(plannedPct(t, '2026-03-13', cal)).toBe(100);
    p.info.baseDate = p.info.end;
    expect(computeProject(p).planned).toBeCloseTo(100, 6);
  });
  it('기준일 변경 → 예정률 갱신', () => {
    const p = sampleProject();
    const a = computeProject(p).planned;
    p.info.baseDate = '2026-12-01';
    const b = computeProject(p).planned;
    expect(b).toBeGreaterThan(a);
  });
  it('수동 계획 진도점 보간', () => {
    const cal = new WorkCalendar({ mode: 'calendar', distribution: 'workday', holidays: [] }, '2026-01-01', '2026-01-10');
    const t = { ...generateTasks(newProject())[0], start: '2026-01-01', end: '2026-01-10', planCurve: [{ date: '2026-01-05', cum: 80 }] };
    expect(plannedPct(t, '2026-01-05', cal)).toBeCloseTo(80, 6);
    expect(plannedPct(t, '2026-01-03', cal)).toBeCloseTo(48, 6);
  });
  it('사용자 휴무일 제외', () => {
    const cal = new WorkCalendar({ mode: 'calendar', distribution: 'workday', holidays: ['2026-01-02'] }, '2026-01-01', '2026-01-04');
    expect(cal.count('2026-01-01', '2026-01-04')).toBe(3);
  });
});

describe('월 균등 배분', () => {
  it('걸친 달마다 보할 균등, 준공일 100', () => {
    const cal = new WorkCalendar({ mode: 'calendar', distribution: 'month', holidays: [] }, '2025-11-01', '2026-12-31');
    const t = { ...generateTasks(newProject())[0], start: '2025-11-01', end: '2026-12-31', weight: 17.65, planCurve: null };
    const ps = buildPeriods('month', '2025-11-01', '2025-11-01', '2026-12-31');
    const v = taskPeriodPlan(t, ps, cal);
    expect(v).toHaveLength(14);
    for (const x of v) expect(x).toBeCloseTo(17.65 / 14, 6);
    expect(plannedPct(t, '2026-12-31', cal)).toBe(100);
    // 월 중간 착수: 그 달도 한 칸으로 균등
    const t2 = { ...t, start: '2026-01-20', end: '2026-03-10', weight: 3 };
    const v2 = taskPeriodPlan(t2, ps, cal).filter((x) => x > 0);
    expect(v2.map((x) => +x.toFixed(6))).toEqual([1, 1, 1]);
  });
});

describe('실제공정률·이력', () => {
  it('Σ(보할×실적)/100 즉시 반영', () => {
    const p = newProject({ kind: 'elec' });
    p.tasks = generateTasks(p);
    p.tasks.forEach((t) => (t.actual = 0));
    p.tasks[4].actual = 50; // 보할 25 → 12.5%
    expect(computeProject(p).actual).toBeCloseTo(12.5, 6);
  });
  it('S-Curve 실적은 이력 기반, 이력 없는 기간은 null', () => {
    const p = sampleProject();
    p.view = 'month';
    const c = computeProject(p);
    const oct = c.periods.find((x) => x.period.key === '2026-10')!;
    const nov = c.periods.find((x) => x.period.key === '2026-11')!;
    const e = p.history.find((h) => h.date === '2026-10-20')!;
    expect(oct.actCum).toBeCloseTo(entryPct(e, buildTree(p.tasks).leaves), 6);
    expect(nov.actCum).toBeNull();
  });
});

describe('기간 단위', () => {
  it('월/주/20일 구간이 범위를 빈틈없이 덮음', () => {
    for (const u of ['month', 'week', 'd20'] as const) {
      const ps = buildPeriods(u, '2027-12-15', '2027-12-15', '2028-03-10');
      expect(ps[0].start).toBe('2027-12-15');
      expect(ps[ps.length - 1].end).toBe('2028-03-10');
      for (let i = 1; i < ps.length; i++) expect(toNum(ps[i].start)).toBe(toNum(ps[i - 1].end) + 1);
      expect(ps.reduce((s, x) => s + x.days, 0)).toBe(spanDays('2027-12-15', '2028-03-10'));
    }
    const w = buildPeriods('week', '2026-10-21', '2026-10-21', '2026-11-10');
    expect(w[0]).toMatchObject({ start: '2026-10-21', end: '2026-10-25' }); // 수~일 부분 주
    const d = buildPeriods('d20', '2026-01-01', '2026-01-01', '2026-02-15');
    expect(d.map((x) => x.days)).toEqual([20, 20, 6]);
  });
});

describe('공사기간 변경 재계산', () => {
  it('비례 이동, 수동 일정 보호', () => {
    const p = newProject({ start: '2026-01-01', end: '2026-04-10', kind: 'elec' });
    p.tasks = generateTasks(p);
    p.tasks[2] = { ...p.tasks[2], start: '2026-01-20', end: '2026-02-01', manual: true };
    const r = rescaleTasks(p.tasks, '2026-01-01', '2026-04-10', '2026-01-01', '2026-07-19', true);
    expect(r[0].start).toBe('2026-01-01');
    expect(r[9].end).toBe('2026-07-19');
    expect(r[2].start).toBe('2026-01-20');
  });
});

describe('보할 비례조정', () => {
  it('합계 100 보정', () => {
    const v = normalizeTo([1, 1, 1]);
    expect(v.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 9);
  });
});

import { createPhase, derivePhaseTasks, makeTotal, summarizePhases } from './phases';
describe('장기계속공사 차수', () => {
  it('총차에서 차수 생성: 차수 보할 100, 차수 몫 합계 100, 일정은 차수 기간 안', () => {
    const total = newProject({ kind: 'elec', start: '2026-01-05', end: '2027-12-31', amount: 1_000_000_000 });
    total.calendar.distribution = 'month';
    total.tasks = generateTasks(total);
    makeTotal(total);
    const ph1 = createPhase(total, 1, '2026-01-05', '2026-12-31', 400_000_000, true);
    const ph2 = createPhase(total, 2, '2027-01-01', '2027-12-31', 600_000_000, true);
    for (const ph of [ph1, ph2]) {
      expect(ph.tasks.reduce((s, t) => s + t.weight, 0)).toBeCloseTo(100, 6);
      for (const t of ph.tasks) {
        expect(t.start >= ph.info.start && t.end <= ph.info.end).toBe(true);
      }
      expect(ph.contract?.groupId).toBe(total.contract?.groupId);
    }
    const sum = summarizePhases(total, [total, ph1, ph2]);
    expect(sum.sumShare).toBeCloseTo(100, 1);
    expect(sum.rows[0].amountRatio).toBeCloseTo(40, 6);
    const d = derivePhaseTasks(total, '2026-01-05', '2026-12-31');
    expect(d.share + derivePhaseTasks(total, '2027-01-01', '2027-12-31').share).toBeCloseTo(100, 6);
  });
});
