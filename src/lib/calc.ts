// 공정 계산 엔진: 작업일 달력, 공종 트리, 예정/실제 공정률, 기간 구분, 누적 공정률.
import { addDays, fromNum, isValidDate, maxDate, minDate, parts, daysInMonth, toNum, weekday, fmtMD } from './date';
import type { CalendarSetting, ISODate, Project, Task, ViewUnit, ProgressEntry } from './types';

export const r2 = (v: number) => Math.round(v * 100) / 100;
export const clamp = (v: number, a = 0, b = 100) => Math.min(b, Math.max(a, v));

// ───────────────────────── 작업일 달력 ─────────────────────────
export class WorkCalendar {
  private hol: Set<string>;
  private lo = 0;
  private prefix: Int32Array = new Int32Array(1);
  constructor(private setting: CalendarSetting, lo: ISODate, hi: ISODate) {
    this.hol = new Set(setting.holidays);
    this.build(toNum(lo) - 400, toNum(hi) + 400);
  }
  private build(lo: number, hi: number) {
    this.lo = lo;
    const n = hi - lo + 1;
    const p = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + (this.isWorkNum(lo + i) ? 1 : 0);
    this.prefix = p;
  }
  get distribution() {
    return this.setting.distribution || 'workday';
  }
  isWorkNum(n: number): boolean {
    if (this.hol.has(fromNum(n))) return false;
    if (this.setting.mode === 'weekday') {
      const w = weekday(n);
      if (w === 0 || w === 6) return false;
    }
    return true;
  }
  isWork(d: ISODate) {
    return this.isWorkNum(toNum(d));
  }
  /** a~b(양 끝 포함) 작업일수 */
  countNum(a: number, b: number): number {
    if (b < a) return 0;
    const hi = this.lo + this.prefix.length - 2;
    if (a < this.lo || b > hi) this.build(Math.min(a, this.lo) - 400, Math.max(b, hi) + 400);
    return this.prefix[b - this.lo + 1] - this.prefix[a - this.lo];
  }
  count(a: ISODate, b: ISODate) {
    return this.countNum(toNum(a), toNum(b));
  }
}

// ───────────────────────── 공종 트리 ─────────────────────────
export interface Node {
  task: Task;
  depth: number;
  num: string; // 1, 1.2 …
  children: Node[];
  isLeaf: boolean;
  leaves: Task[];
  weight: number; // 상위는 하위 합계
  start: ISODate;
  end: ISODate;
}

export function buildTree(tasks: Task[]): { roots: Node[]; flat: Node[]; leaves: Task[] } {
  const byParent = new Map<string | null, Task[]>();
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const p = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(t);
  }
  const flat: Node[] = [];
  const make = (t: Task, depth: number, num: string): Node => {
    const node: Node = { task: t, depth, num, children: [], isLeaf: true, leaves: [], weight: 0, start: t.start, end: t.end };
    flat.push(node);
    const kids = byParent.get(t.id) || [];
    node.children = kids.map((k, i) => make(k, depth + 1, `${num}.${i + 1}`));
    if (node.children.length) {
      node.isLeaf = false;
      node.leaves = node.children.flatMap((c) => (c.isLeaf ? [c.task] : c.leaves));
      node.weight = node.children.reduce((s, c) => s + c.weight, 0);
      node.start = node.children.reduce((s, c) => minDate(s, c.start), node.children[0].start);
      node.end = node.children.reduce((s, c) => maxDate(s, c.end), node.children[0].end);
    } else {
      node.leaves = [t];
      node.weight = t.weight || 0;
    }
    return node;
  };
  const roots = (byParent.get(null) || []).map((t, i) => make(t, 0, String(i + 1)));
  // flat이 DFS 순서가 되도록 재정렬
  const ordered: Node[] = [];
  const walk = (n: Node) => {
    ordered.push(n);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  void flat;
  const leaves = ordered.filter((n) => n.isLeaf).map((n) => n.task);
  return { roots, flat: ordered, leaves };
}

// ───────────────────────── 예정 공정률 ─────────────────────────
/** 공종(하위)의 기준일 d까지 예정 진도율(%) — 작업일 기준 선형, 또는 수동 계획 진도점 보간 */
export function plannedPct(t: Task, d: ISODate, cal: WorkCalendar): number {
  if (!isValidDate(t.start) || !isValidDate(t.end)) return 0;
  const s = toNum(t.start);
  const e = toNum(t.end);
  const dn = toNum(d);
  if (dn < s) return 0;
  if (dn >= e) return 100;
  const frac = (a: number, b: number, x: number) => {
    // (a, b] 구간에서 x까지의 작업일 비율
    const tot = cal.countNum(a + 1, b);
    if (tot > 0) return cal.countNum(a + 1, x) / tot;
    return b > a ? (x - a) / (b - a) : 1;
  };
  if (t.planCurve && t.planCurve.length) {
    const pts = t.planCurve
      .filter((p) => isValidDate(p.date) && toNum(p.date) >= s && toNum(p.date) < e)
      .map((p) => ({ n: toNum(p.date), cum: clamp(p.cum) }))
      .sort((a, b) => a.n - b.n);
    const all = [{ n: s - 1, cum: 0 }, ...pts, { n: e, cum: 100 }];
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i];
      const b = all[i + 1];
      if (dn > a.n && dn <= b.n) return clamp(a.cum + (b.cum - a.cum) * frac(a.n, b.n, dn));
    }
    return 100;
  }
  if (cal.distribution === 'month') {
    // 월 균등 배분: 공종 기간이 걸친 달 수(k)로 보할을 똑같이 나누고, 달 안에서는 작업일 비례
    const segs: [number, number][] = [];
    let cur = s;
    while (cur <= e) {
      const { y, m } = parts(fromNum(cur));
      const last = Math.min(e, toNum(`${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`));
      segs.push([cur, last]);
      cur = last + 1;
    }
    const k = segs.length;
    for (let i = 0; i < k; i++) {
      const [a, b] = segs[i];
      if (dn <= b) return clamp(((i + frac(a - 1, b, dn)) / k) * 100);
    }
    return 100;
  }
  return clamp(frac(s - 1, e, dn) * 100);
}

/** 공종(하위)의 기간별 보할 반영 예정값 = 보할 × (기간말 예정률 − 직전 기간말 예정률) / 100 */
export function taskPeriodPlan(t: Task, periods: Period[], cal: WorkCalendar): number[] {
  return periods.map((pr) => {
    const prev = plannedPct(t, addDays(pr.start, -1), cal);
    const now = plannedPct(t, pr.end, cal);
    return ((now - prev) * (t.weight || 0)) / 100;
  });
}

/** 공종(하위)의 기간별 보할 반영 실적값 — 그 기간에 저장된 실적 이력이 있을 때만 값, 없으면 null */
export function taskPeriodActual(t: Task, periods: Period[], hist: ProgressEntry[]): (number | null)[] {
  const h = sortedHistory(hist);
  return periods.map((pr) => {
    const inP = h.filter((x) => x.date >= pr.start && x.date <= pr.end);
    if (!inP.length) return null;
    const now = inP[inP.length - 1].values[t.id] ?? 0;
    const before = h.filter((x) => x.date < pr.start);
    const prev = before.length ? before[before.length - 1].values[t.id] ?? 0 : 0;
    return ((clamp(now) - clamp(prev)) * (t.weight || 0)) / 100;
  });
}

export interface Weighted {
  total: number; // 하위 보할 합계
  pct: number; // 0~100
}

/** Σ(보할×진도)/Σ보할 — 보할 합계가 100이면 Σ(보할×진도)/100 과 동일 */
export function weightedPct(leaves: Task[], valueOf: (t: Task) => number): Weighted {
  let tw = 0;
  let acc = 0;
  for (const t of leaves) {
    const w = Math.max(0, t.weight || 0);
    tw += w;
    acc += w * clamp(valueOf(t));
  }
  if (tw <= 0) {
    if (!leaves.length) return { total: 0, pct: 0 };
    return { total: 0, pct: leaves.reduce((s, t) => s + clamp(valueOf(t)), 0) / leaves.length };
  }
  return { total: tw, pct: acc / tw };
}

export type TaskStatus = 'idle' | 'progress' | 'late' | 'done' | 'ahead';
export const STATUS_LABEL: Record<TaskStatus, string> = {
  idle: '미착수',
  progress: '진행',
  late: '지연',
  done: '완료',
  ahead: '선행',
};
export function taskStatus(planned: number, actual: number): TaskStatus {
  if (actual >= 100) return 'done';
  if (actual - planned < -0.05) return 'late';
  if (actual <= 0 && planned <= 0) return 'idle';
  if (actual - planned > 0.05) return 'ahead';
  return 'progress';
}
export function overallStatus(dev: number): { key: 'late' | 'ok' | 'ahead'; label: string } {
  if (dev < -0.05) return { key: 'late', label: '지연' };
  if (dev > 0.05) return { key: 'ahead', label: '선행' };
  return { key: 'ok', label: '정상' };
}

// ───────────────────────── 기간 구분 ─────────────────────────
export interface Period {
  key: string;
  start: ISODate;
  end: ISODate;
  group: string; // 상단 행(연도·월 등)
  label: string; // 하단 행
  days: number;
}

/** 공정표 표시 범위: 공사기간 + 공종 일정 중 넓은 쪽 */
export function timelineRange(p: Project): { lo: ISODate; hi: ISODate } {
  let lo = p.info.start;
  let hi = p.info.end;
  for (const t of p.tasks) {
    for (const d of [t.start, t.end, t.actualStart, t.actualEnd]) {
      if (isValidDate(d)) {
        lo = minDate(lo, d);
        hi = maxDate(hi, d);
      }
    }
  }
  if (hi < lo) hi = lo;
  return { lo, hi };
}

export function buildPeriods(unit: ViewUnit, projStart: ISODate, lo: ISODate, hi: ISODate): Period[] {
  const out: Period[] = [];
  const loN = toNum(lo);
  const hiN = toNum(hi);
  const push = (sN: number, eN: number, group: string, label: string, key: string) => {
    const a = Math.max(sN, loN);
    const b = Math.min(eN, hiN);
    if (b < a) return;
    out.push({ key, start: fromNum(a), end: fromNum(b), group, label, days: b - a + 1 });
  };
  if (unit === 'month') {
    let { y, m } = parts(lo);
    while (true) {
      const first = `${y}-${String(m).padStart(2, '0')}-01`;
      if (toNum(first) > hiN) break;
      const last = `${y}-${String(m).padStart(2, '0')}-${daysInMonth(y, m)}`;
      push(toNum(first), toNum(last), `${y}년`, `${m}월`, `${y}-${m}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  } else if (unit === 'week') {
    // 월요일 시작
    let mon = loN - ((weekday(loN) + 6) % 7);
    while (mon <= hiN) {
      const a = Math.max(mon, loN);
      const { y, m } = parts(fromNum(a));
      push(mon, mon + 6, `${y}.${m}`, `${fmtMD(fromNum(a))}`, `w${mon}`);
      mon += 7;
    }
  } else {
    const anchor = toNum(projStart);
    let k = Math.floor((loN - anchor) / 20);
    while (anchor + k * 20 <= hiN) {
      const s = anchor + k * 20;
      const e = s + 19;
      const a = Math.max(s, loN);
      const b = Math.min(e, hiN);
      push(s, e, `${k >= 0 ? k + 1 : k}구간`, `${fmtMD(fromNum(a))}~${fmtMD(fromNum(b))}`, `d${k}`);
      k++;
    }
  }
  return out;
}

export const UNIT_LABEL: Record<ViewUnit, string> = { month: '월별', week: '주별', d20: '20일 단위' };

// ───────────────────────── 실적 이력 ─────────────────────────
export function entryPct(entry: ProgressEntry, leaves: Task[]): number {
  return weightedPct(leaves, (t) => entry.values[t.id] ?? 0).pct;
}

export function sortedHistory(h: ProgressEntry[]) {
  return [...h].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ───────────────────────── 프로젝트 전체 계산 ─────────────────────────
export interface TaskCalc {
  node: Node;
  planned: number;
  actual: number;
  status: TaskStatus;
}
export interface PeriodCalc {
  period: Period;
  planCum: number;
  planDelta: number;
  actCum: number | null; // 해당 기간에 입력된 실적 이력이 없으면 null(데이터 없음)
  actDelta: number | null;
  actDate: ISODate | null;
}
export interface ProjectCalc {
  cal: WorkCalendar;
  tree: ReturnType<typeof buildTree>;
  rows: TaskCalc[];
  byId: Map<string, TaskCalc>;
  weightTotal: number;
  planned: number;
  actual: number;
  deviation: number;
  totalDays: number;
  workDays: number;
  elapsedDays: number;
  periods: PeriodCalc[];
  range: { lo: ISODate; hi: ISODate };
  costTotal: number;
}

export function computeProject(p: Project, unit: ViewUnit = p.view): ProjectCalc {
  const range = timelineRange(p);
  const cal = new WorkCalendar(p.calendar, range.lo, range.hi);
  const tree = buildTree(p.tasks);
  const base = p.info.baseDate;
  const leafPlanned = new Map<string, number>();
  for (const t of tree.leaves) leafPlanned.set(t.id, plannedPct(t, base, cal));
  const rows: TaskCalc[] = tree.flat.map((node) => {
    const planned = node.isLeaf ? leafPlanned.get(node.task.id)! : weightedPct(node.leaves, (t) => leafPlanned.get(t.id)!).pct;
    const actual = node.isLeaf ? clamp(node.task.actual || 0) : weightedPct(node.leaves, (t) => t.actual || 0).pct;
    return { node, planned, actual, status: taskStatus(planned, actual) };
  });
  const byId = new Map(rows.map((r) => [r.node.task.id, r]));
  const wp = weightedPct(tree.leaves, (t) => leafPlanned.get(t.id)!);
  const wa = weightedPct(tree.leaves, (t) => t.actual || 0);
  const periods = buildPeriods(unit, p.info.start, range.lo, range.hi);
  const hist = sortedHistory(p.history);
  let prevPlan = 0;
  let prevAct: number | null = null;
  const pcs: PeriodCalc[] = periods.map((period) => {
    const planCum = weightedPct(tree.leaves, (t) => plannedPct(t, period.end, cal)).pct;
    const inPeriod = hist.filter((h) => h.date >= period.start && h.date <= period.end);
    const last = inPeriod[inPeriod.length - 1];
    const actCum = last ? entryPct(last, tree.leaves) : null;
    // 기간 실적 = 이번 기간 누계 - 직전 누계(직전 이력이 있는 경우)
    const before = hist.filter((h) => h.date < period.start);
    const prevEntry = before[before.length - 1];
    const prevVal = prevEntry ? entryPct(prevEntry, tree.leaves) : prevAct ?? 0;
    const pc: PeriodCalc = {
      period,
      planCum,
      planDelta: planCum - prevPlan,
      actCum,
      actDelta: actCum == null ? null : actCum - prevVal,
      actDate: last ? last.date : null,
    };
    prevPlan = planCum;
    if (actCum != null) prevAct = actCum;
    return pc;
  });
  const okDates = isValidDate(p.info.start) && isValidDate(p.info.end) && p.info.end >= p.info.start;
  const totalDays = okDates ? toNum(p.info.end) - toNum(p.info.start) + 1 : 0;
  const workDays = okDates ? cal.count(p.info.start, p.info.end) : 0;
  const elapsedDays = okDates ? Math.max(0, Math.min(totalDays, toNum(base) - toNum(p.info.start) + 1)) : 0;
  return {
    cal,
    tree,
    rows,
    byId,
    weightTotal: wp.total,
    planned: wp.pct,
    actual: wa.pct,
    deviation: wa.pct - wp.pct,
    totalDays,
    workDays,
    elapsedDays,
    periods: pcs,
    range,
    costTotal: tree.leaves.reduce((s, t) => s + (t.cost || 0), 0),
  };
}

// ───────────────────────── 보할 유틸 ─────────────────────────
/** 값들의 합계를 target(기본 100)으로 비례조정하고 소수 둘째 자리 반올림 오차를 가장 큰 항목에 반영 */
export function normalizeTo(values: number[], target = 100): number[] {
  const sum = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (sum <= 0) {
    if (!values.length) return [];
    const eq = values.map(() => r2(target / values.length));
    eq[0] = r2(eq[0] + target - eq.reduce((s, v) => s + v, 0));
    return eq;
  }
  const out = values.map((v) => r2((Math.max(0, v) / sum) * target));
  const diff = r2(target - out.reduce((s, v) => s + v, 0));
  if (diff !== 0) {
    let mi = 0;
    out.forEach((v, i) => {
      if (v > out[mi]) mi = i;
    });
    out[mi] = r2(out[mi] + diff);
  }
  return out;
}

export function dateToX(d: ISODate, periods: Period[], colW: number): number {
  const n = toNum(d);
  if (!periods.length) return 0;
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const s = toNum(p.start);
    const e = toNum(p.end);
    if (n >= s && n <= e + 1) return i * colW + ((n - s) / p.days) * colW;
  }
  if (n < toNum(periods[0].start)) return 0;
  return periods.length * colW;
}

export function xToDate(x: number, periods: Period[], colW: number): ISODate {
  if (!periods.length) return '';
  const i = Math.max(0, Math.min(periods.length - 1, Math.floor(x / colW)));
  const p = periods[i];
  const within = Math.max(0, Math.min(p.days - 1, Math.floor(((x - i * colW) / colW) * p.days)));
  return addDays(p.start, within);
}
