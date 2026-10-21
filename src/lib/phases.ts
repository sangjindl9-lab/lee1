// 장기계속공사 — 총차 예정공정표 / 차수별 예정공정표
import type { ISODate, Project, Task } from './types';
import { buildTree, clamp, computeProject, normalizeTo, plannedPct, r2, WorkCalendar } from './calc';
import { addDays, isValidDate, maxDate, minDate, toNum } from './date';
import { generateTasks, newProject, uid } from './schedule';

export const phaseLabel = (p: Project) => (!p.contract ? '' : p.contract.kind === 'total' ? '총차' : `${p.contract.no}차`);

/** 같은 묶음의 공정표: 총차 먼저, 이후 차수 순 */
export function groupMembers(all: Project[], p: Project): Project[] {
  if (!p.contract) return [p];
  const g = p.contract.groupId;
  return all.filter((x) => x.contract?.groupId === g).sort((a, b) => a.contract!.no - b.contract!.no);
}

export function nextPhaseNo(members: Project[]): number {
  return members.reduce((m, x) => Math.max(m, x.contract?.kind === 'phase' ? x.contract.no : 0), 0) + 1;
}

/** 현재 공정표를 총차 예정공정표로 지정 */
export function makeTotal(d: Project) {
  d.contract = { groupId: uid('g'), kind: 'total', no: 0 };
}

/** 다음 차수의 기본 착공일: 직전 차수 준공 다음날, 없으면 총차 착공일 */
export function suggestPhaseStart(total: Project, members: Project[]): ISODate {
  const phases = members.filter((x) => x.contract?.kind === 'phase');
  if (!phases.length) return total.info.start;
  const last = phases.reduce((m, x) => maxDate(m, x.info.end), phases[0].info.end);
  return addDays(last, 1);
}

/**
 * 총차 공정표에서 차수 공정표를 만든다.
 * 각 공종의 총차 예정 보할 중 차수 기간 [start,end]에 해당하는 몫을 구해 차수 안에서 100%로 환산한다.
 * 공종 일정은 차수 기간으로 잘라내고, 공사비는 같은 비율로 나눈다.
 */
export function derivePhaseTasks(total: Project, start: ISODate, end: ISODate): { tasks: Task[]; share: number } {
  const cal = new WorkCalendar(total.calendar, minDate(total.info.start, start), maxDate(total.info.end, end));
  const tree = buildTree(total.tasks);
  const before = addDays(start, -1);
  const keep = new Map<string, { frac: number; value: number }>();
  for (const t of tree.leaves) {
    if (!isValidDate(t.start) || !isValidDate(t.end) || t.end < start || t.start > end) continue;
    const frac = (plannedPct(t, end, cal) - plannedPct(t, before, cal)) / 100;
    if (frac <= 1e-6) continue;
    keep.set(t.id, { frac, value: (t.weight || 0) * frac });
  }
  const leafIds = [...keep.keys()];
  const share = leafIds.reduce((s, id) => s + keep.get(id)!.value, 0);
  const weights = normalizeTo(leafIds.map((id) => keep.get(id)!.value));
  const wById = new Map(leafIds.map((id, i) => [id, weights[i]]));
  // 하위 공종이 남은 상위 공종도 유지
  const parentKeep = new Set<string>();
  const byId = new Map(total.tasks.map((t) => [t.id, t]));
  for (const id of leafIds) {
    let pid = byId.get(id)!.parentId;
    while (pid) {
      parentKeep.add(pid);
      pid = byId.get(pid)?.parentId ?? null;
    }
  }
  const idMap = new Map<string, string>();
  const tasks: Task[] = [];
  for (const t of total.tasks) {
    const isLeaf = keep.has(t.id);
    if (!isLeaf && !parentKeep.has(t.id)) continue;
    const nid = uid();
    idMap.set(t.id, nid);
    tasks.push({
      ...t,
      id: nid,
      parentId: t.parentId ? idMap.get(t.parentId) ?? null : null,
      start: isLeaf ? maxDate(t.start, start) : t.start,
      end: isLeaf ? minDate(t.end, end) : t.end,
      weight: isLeaf ? wById.get(t.id)! : 0,
      cost: isLeaf ? Math.round((t.cost || 0) * keep.get(t.id)!.frac) : 0,
      actual: 0,
      actualStart: '',
      actualEnd: '',
      manual: false,
      planCurve: null,
    });
  }
  return { tasks, share };
}

export function createPhase(total: Project, no: number, start: ISODate, end: ISODate, amount: number, fromTotal: boolean): Project {
  const p = newProject({
    ...total.info,
    start,
    end,
    amount,
    baseDate: maxDate(start, minDate(end, total.info.baseDate)),
    docNo: '',
  });
  p.calendar = structuredClone(total.calendar);
  p.template = structuredClone(total.template);
  p.groupShare = { ...total.groupShare };
  p.view = total.view;
  p.form = { ...total.form, title: '' };
  p.weightMode = total.weightMode;
  p.contract = { groupId: total.contract!.groupId, kind: 'phase', no };
  let tasks: Task[] = [];
  if (fromTotal && total.tasks.length) tasks = derivePhaseTasks(total, start, end).tasks;
  if (!tasks.length) {
    tasks = generateTasks(p);
    p.weightProvisional = true;
  } else p.weightProvisional = total.weightProvisional;
  p.tasks = tasks;
  p.scheduleBase = { start, end };
  return p;
}

export interface PhaseSummary {
  project: Project;
  label: string;
  start: ISODate;
  end: ISODate;
  days: number;
  amount: number;
  amountRatio: number | null; // 총차 계약금액 대비 %
  share: number; // 총차 예정 중 이 차수 기간의 몫(%)
  planCumAtEnd: number; // 차수 준공일 기준 총차 누적 예정(%)
  actual: number; // 차수 실제공정률(%)
  totalContribution: number; // 총차 환산 실적(%p) = 몫 × 차수 실적
}

export function summarizePhases(total: Project, members: Project[]) {
  const phases = members.filter((x) => x.contract?.kind === 'phase');
  const tc = computeProject(total);
  const cal = tc.cal;
  const leaves = tc.tree.leaves;
  const cumAt = (d: ISODate) => {
    let tw = 0;
    let acc = 0;
    for (const t of leaves) {
      tw += t.weight || 0;
      acc += (t.weight || 0) * plannedPct(t, d, cal);
    }
    return tw > 0 ? acc / tw : 0;
  };
  const rows: PhaseSummary[] = phases.map((ph) => {
    const pc = computeProject(ph);
    const share = clamp(cumAt(ph.info.end) - cumAt(addDays(ph.info.start, -1)));
    return {
      project: ph,
      label: phaseLabel(ph),
      start: ph.info.start,
      end: ph.info.end,
      days: toNum(ph.info.end) - toNum(ph.info.start) + 1,
      amount: ph.info.amount,
      amountRatio: total.info.amount > 0 ? (ph.info.amount / total.info.amount) * 100 : null,
      share: r2(share),
      planCumAtEnd: cumAt(ph.info.end),
      actual: pc.actual,
      totalContribution: (share * pc.actual) / 100,
    };
  });
  const sumAmount = rows.reduce((s, r) => s + r.amount, 0);
  const sumShare = rows.reduce((s, r) => s + r.share, 0);
  const sumContribution = rows.reduce((s, r) => s + r.totalContribution, 0);
  return { rows, sumAmount, sumShare, sumContribution, totalPlanned: tc.planned };
}

/** 총차 양식에 그릴 차수 구분선 */
export interface PhaseMark {
  label: string;
  start: ISODate;
  end: ISODate;
}
export function phaseMarks(all: Project[], p: Project): PhaseMark[] {
  if (p.contract?.kind !== 'total') return [];
  return groupMembers(all, p)
    .filter((x) => x.contract?.kind === 'phase')
    .map((x) => ({ label: phaseLabel(x), start: x.info.start, end: x.info.end }));
}
