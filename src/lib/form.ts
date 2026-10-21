// 제출용 예정공정표(보할공정표) 양식 데이터 — 화면·PDF·Excel이 같은 값을 쓴다.
import type { FormTemplate, ISODate, Project } from './types';
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
  color: string; // 공종 막대 색상(빈 값이면 검정)
  amount: number; // 공종 금액(원) — 공사비 입력값, 없으면 계약금액×보할
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
  amountTotal: number;
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
  // 금액: 공사비 산정 방식이고 공사비가 입력돼 있으면 그 값, 아니면 계약금액을 보할 비율로 나눔
  const useCost = p.weightMode === 'cost' && c.costTotal > 0;
  const amountOf = (leaves: { cost: number }[], weight: number) =>
    useCost ? leaves.reduce((s, t) => s + (t.cost || 0), 0) : c.weightTotal > 0 ? ((p.info.amount || 0) * weight) / c.weightTotal : 0;
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
        color: /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '',
        amount: Math.round(amountOf(r.node.leaves, r.node.weight)),
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
  const amountTotal = useCost ? c.costTotal : c.weightTotal > 0 ? p.info.amount || 0 : 0;
  return { periods, rows, planSum, planCum, actSum, actCum, weightTotal: c.weightTotal, amountTotal };
}

/** 표 칸 숫자: 0은 비움, 소수 둘째 자리 */
export const cellNum = (v: number | null | undefined, digits = 2) => (v == null || Math.abs(v) < 0.005 ? '' : v.toFixed(digits));

/** 월 머리글 '07월', 그 외 단위는 기존 라벨 */
export function periodHead(pr: Period): { top: string; label: string } {
  if (pr.key.includes('-') && pr.group.endsWith('년')) return { top: pr.group.replace('년', ''), label: `${pr.label.replace('월', '').padStart(2, '0')}월` };
  return { top: pr.group, label: pr.label };
}

/** 자동 제목 문구(제목 칸이 비어 있을 때 사용): 차수 공정표 → "N 차 예정공정표", 차수가 있는 총차 → "총차 예정공정표", 그 외 → "예정공정표" */
export function autoTitle(p: Project, hasPhases: boolean): string {
  if (p.contract?.kind === 'phase') return `${p.contract.no} 차 예 정 공 정 표`;
  if (p.contract?.kind === 'total' && hasPhases) return '총 차 예 정 공 정 표';
  return '예 정 공 정 표';
}
/** 실제 표시 제목: 직접 입력한 제목이 있으면 그것, 없으면 자동 제목 */
export function formTitle(p: Project, hasPhases: boolean): string {
  return (p.form.title || '').trim() || autoTitle(p, hasPhases);
}
/** 예전 버전이 자동으로 넣던 제목은 '자동'(빈 값)으로 본다 */
export function isAutoTitleText(t: string): boolean {
  return /^(\d+\s*차\s*|총\s*차\s*)?예\s*정\s*공\s*정\s*표$/.test((t || '').trim());
}

// ── 제출 양식 템플릿 ─────────────────────────────────────────────
export const FORM_TEMPLATES: { id: FormTemplate; name: string; desc: string }[] = [
  { id: 'basic', name: '기본형', desc: '공종 · 보할 · 기간별 보할값과 굵은 예정선 · 계/누계 (관공서 보할공정표 기본)' },
  { id: 'overview', name: '공사개요형', desc: '표 위에 공사개요(공사명·위치·기간·계약금액·발주처·시공업체)를 표로 넣음' },
  { id: 'amount', name: '금액병기형', desc: '공종별 금액(원) 칸을 보할 앞에 추가 — 공사비가 없으면 계약금액×보할' },
  { id: 'bar', name: '막대형', desc: '착수일·완료일 칸 + 예정 막대만 표시(칸 숫자 없음), 계/누계만 숫자' },
];

/** 공종·기간 사이의 고정 칸. w = 화면 px 기준 폭(PDF·엑셀은 비율로 환산) */
export interface FormCol {
  key: 'weight' | 'amount' | 'start' | 'end';
  head: [string, string?];
  w: number;
  value: (r: FormRow) => string;
  sum: (f: FormData) => string; // '계' 행 값
}

const shortDate = (d: string) => (isValidDate(d) ? d.slice(2).replace(/-/g, '.') : '');
export const won = (v: number) => (v ? Math.round(v).toLocaleString('ko-KR') : '');

export interface FormLayout {
  template: FormTemplate;
  cols: FormCol[];
  overview: boolean; // 공사개요 표
  cellValues: boolean; // 공종 행에 기간별 보할값 표시
  rowScale: number; // 공종 행 높이 배율 (막대형은 낮게)
}

export function formLayout(p: Project): FormLayout {
  const t: FormTemplate = (FORM_TEMPLATES.some((x) => x.id === p.form.template) ? p.form.template : 'basic') as FormTemplate;
  const weight: FormCol = { key: 'weight', head: ['보할', '(%)'], w: 60, value: (r) => r.weight.toFixed(2), sum: (f) => f.weightTotal.toFixed(1) };
  const amount: FormCol = { key: 'amount', head: ['금액', '(원)'], w: 96, value: (r) => won(r.amount), sum: (f) => won(f.amountTotal) };
  const start: FormCol = { key: 'start', head: ['착수일'], w: 62, value: (r) => shortDate(r.start), sum: (_f) => shortDate(p.info.start) };
  const end: FormCol = { key: 'end', head: ['완료일'], w: 62, value: (r) => shortDate(r.end), sum: (_f) => shortDate(p.info.end) };
  const cols = t === 'amount' ? [amount, weight] : t === 'bar' ? [weight, start, end] : [weight];
  return { template: t, cols, overview: t === 'overview', cellValues: t !== 'bar', rowScale: t === 'bar' ? 0.74 : 1 };
}

/** 공사개요 표 내용 (라벨, 값) 3줄 × 2쌍 */
export function overviewRows(p: Project): [string, string, string, string][] {
  const i = p.info;
  const days = isValidDate(i.start) && isValidDate(i.end) ? Math.round((Date.parse(i.end) - Date.parse(i.start)) / 86400000) + 1 : 0;
  const period = isValidDate(i.start) && isValidDate(i.end) ? `${i.start.replace(/-/g, '.')} ~ ${i.end.replace(/-/g, '.')}${days > 0 ? ` (${days}일)` : ''}` : '';
  return [
    ['공 사 명', i.name, '공사위치', i.location],
    ['공사기간', period, '계약금액', i.amount ? `금 ${won(i.amount)}원` : ''],
    ['발 주 처', i.client, '시공업체', i.contractor ? `${i.contractor} (인)` : ''],
  ];
}
