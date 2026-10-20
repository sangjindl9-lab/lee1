// 제출용 예정공정표(보할공정표) 양식 데이터 — 화면·PDF·Excel이 같은 값을 쓴다.
import type { ISODate, Project } from './types';
import { taskPeriodActual, taskPeriodPlan, type Period, type ProjectCalc } from './calc';
import { isValidDate } from './date';

export interface FormRow {
  id: string;
  label: string;
  depth: number;
  weight: number;
  note: string;
  start: ISODate;
  end: ISODate;
  actStart: ISODate | '';
  actEnd: ISODate | '';
  actual: number;
  plan: number[]; // 기간별 보할 반영 예정값
  act: (number | null)[]; // 기간별 보할 반영 실적값 (이력 없는 기간 null)
}

export interface FormData {
  periods: Period[];
  rows: FormRow[];
  planSum: number[];
  planCum: number[];
  actSum: (number | null)[];
  actCum: (number | null)[];
  weightTotal: number;
}

export function buildForm(p: Project, c: ProjectCalc): FormData {
  const periods = c.periods.map((x) => x.period);
  const leafPlan = new Map<string, number[]>();
  const leafAct = new Map<string, (number | null)[]>();
  for (const t of c.tree.leaves) {
    leafPlan.set(t.id, taskPeriodPlan(t, periods, c.cal));
    leafAct.set(t.id, taskPeriodActual(t, periods, p.history));
  }
  const sumArr = (ids: string[]) => periods.map((_, i) => ids.reduce((s, id) => s + (leafPlan.get(id)![i] || 0), 0));
  const sumAct = (ids: string[]) =>
    periods.map((_, i) => {
      let any = false;
      let s = 0;
      for (const id of ids) {
        const v = leafAct.get(id)![i];
        if (v != null) {
          any = true;
          s += v;
        }
      }
      return any ? s : null;
    });
  const opts = p.form;
  const rows: FormRow[] = c.rows
    .filter((r) => opts.level === 'all' || r.node.depth === 0)
    .map((r) => {
      const ids = r.node.leaves.map((t) => t.id);
      const t = r.node.task;
      const num = opts.numbering ? (r.node.depth === 0 ? `${r.node.num}. ` : `${r.node.num} `) : '';
      return {
        id: t.id,
        label: num + t.name,
        depth: opts.level === 'all' ? r.node.depth : 0,
        weight: r.node.weight,
        note: t.note,
        start: r.node.start,
        end: r.node.end,
        actStart: r.node.isLeaf && isValidDate(t.actualStart) ? t.actualStart : '',
        actEnd: r.node.isLeaf && isValidDate(t.actualEnd) ? t.actualEnd : '',
        actual: r.actual,
        plan: sumArr(ids),
        act: sumAct(ids),
      };
    });
  const allLeaves = c.tree.leaves.map((t) => t.id);
  const planSum = sumArr(allLeaves);
  const actSum = sumAct(allLeaves);
  const planCum: number[] = [];
  planSum.reduce((acc, v, i) => ((planCum[i] = acc + v), acc + v), 0);
  const actCum = c.periods.map((x) => x.actCum);
  return { periods, rows, planSum, planCum, actSum, actCum, weightTotal: c.weightTotal };
}

/** 표 칸 숫자: 0은 비움, 소수 둘째 자리 */
export const cellNum = (v: number | null | undefined, digits = 2) => (v == null || Math.abs(v) < 0.005 ? '' : v.toFixed(digits));

/** 월 머리글 '07월', 그 외 단위는 기존 라벨 */
export function periodHead(pr: Period): { top: string; label: string } {
  if (pr.key.includes('-') && pr.group.endsWith('년')) return { top: pr.group.replace('년', ''), label: `${pr.label.replace('월', '').padStart(2, '0')}월` };
  return { top: pr.group, label: pr.label };
}
