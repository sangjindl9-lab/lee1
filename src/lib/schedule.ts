// 기본 공종 템플릿, 자동 공정 생성, 공사기간 변경 시 비례 재계산.
import { fromNum, isValidDate, toNum, todayKST, addDays } from './date';
import { normalizeTo, r2 } from './calc';
import type { ISODate, Project, Task, TemplateRow } from './types';

export function uid(prefix = 't'): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

// 착수·완료 시점(공사기간 대비 %)과 보할은 최초 제안값이며 프로젝트별로 수정 가능하다.
// 선후관계: 앞 공종이 일정 부분 진행된 뒤 다음 공종이 착수하는 FS(+중첩) 관계로 배치.
export const DEFAULT_TEMPLATE: TemplateRow[] = [
  { key: 'e1', group: 'elec', name: '착공 및 현장조사', startPct: 0, endPct: 6, weight: 3, pred: '' },
  { key: 'e2', group: 'elec', name: '시공계획 및 승인도서', startPct: 3, endPct: 12, weight: 3, pred: '착공 및 현장조사' },
  { key: 'e3', group: 'elec', name: '자재승인 및 발주', startPct: 8, endPct: 25, weight: 4, pred: '시공계획 및 승인도서' },
  { key: 'e4', group: 'elec', name: '전선관·케이블트레이 설치', startPct: 18, endPct: 55, weight: 20, pred: '자재승인 및 발주' },
  { key: 'e5', group: 'elec', name: '전력케이블 포설', startPct: 40, endPct: 72, weight: 25, pred: '전선관·케이블트레이 설치' },
  { key: 'e6', group: 'elec', name: '배전반·분전반·전기기기 설치', startPct: 50, endPct: 80, weight: 20, pred: '자재승인 및 발주' },
  { key: 'e7', group: 'elec', name: '케이블 결선 및 접지', startPct: 65, endPct: 86, weight: 12, pred: '전력케이블 포설' },
  { key: 'e8', group: 'elec', name: '절연저항·접지저항 측정', startPct: 82, endPct: 91, weight: 4, pred: '케이블 결선 및 접지' },
  { key: 'e9', group: 'elec', name: '시운전 및 성능시험', startPct: 87, endPct: 96, weight: 5, pred: '절연저항·접지저항 측정' },
  { key: 'e10', group: 'elec', name: '준공검사 및 준공도서 작성', startPct: 94, endPct: 100, weight: 4, pred: '시운전 및 성능시험' },
  { key: 'c1', group: 'comm', name: '착공 및 현장조사', startPct: 0, endPct: 6, weight: 3, pred: '' },
  { key: 'c2', group: 'comm', name: '통신설비 설계검토 및 승인', startPct: 3, endPct: 12, weight: 3, pred: '착공 및 현장조사' },
  { key: 'c3', group: 'comm', name: '통신자재 승인·발주', startPct: 8, endPct: 25, weight: 4, pred: '통신설비 설계검토 및 승인' },
  { key: 'c4', group: 'comm', name: '통신관로 및 트레이 설치', startPct: 18, endPct: 50, weight: 18, pred: '통신자재 승인·발주' },
  { key: 'c5', group: 'comm', name: '광케이블·UTP 케이블 포설', startPct: 35, endPct: 68, weight: 22, pred: '통신관로 및 트레이 설치' },
  { key: 'c6', group: 'comm', name: '통신랙 및 전송·네트워크 장비 설치', startPct: 50, endPct: 78, weight: 20, pred: '통신자재 승인·발주' },
  { key: 'c7', group: 'comm', name: '광접속 및 통신케이블 결선', startPct: 62, endPct: 84, weight: 12, pred: '광케이블·UTP 케이블 포설' },
  { key: 'c8', group: 'comm', name: '장비 구성 및 연동시험', startPct: 78, endPct: 90, weight: 8, pred: '광접속 및 통신케이블 결선' },
  { key: 'c9', group: 'comm', name: '통신품질·성능시험', startPct: 86, endPct: 95, weight: 6, pred: '장비 구성 및 연동시험' },
  { key: 'c10', group: 'comm', name: '준공검사 및 준공도서 작성', startPct: 94, endPct: 100, weight: 4, pred: '통신품질·성능시험' },
];

/** 공사기간 [start,end] 안에서 비율(%) 구간을 날짜로 변환 — 짧은 공기도 최소 1일 보장 */
export function fracRange(start: ISODate, end: ISODate, sPct: number, ePct: number): { start: ISODate; end: ISODate } {
  const s0 = toNum(start);
  const n = toNum(end) - s0 + 1;
  const sp = Math.max(0, Math.min(100, sPct)) / 100;
  const ep = Math.max(0, Math.min(100, Math.max(sPct, ePct))) / 100;
  let a = Math.floor(sp * n);
  let b = Math.ceil(ep * n) - 1;
  a = Math.max(0, Math.min(n - 1, a));
  b = Math.max(a, Math.min(n - 1, b));
  return { start: fromNum(s0 + a), end: fromNum(s0 + b) };
}

function blankTask(partial: Partial<Task>): Task {
  return {
    id: uid(),
    parentId: null,
    name: '',
    weight: 0,
    cost: 0,
    start: '',
    end: '',
    actual: 0,
    actualStart: '',
    actualEnd: '',
    note: '',
    memo: '',
    color: '',
    manual: false,
    planCurve: null,
    ...partial,
  };
}
export const newTask = blankTask;

/** 템플릿 → 공종 목록. 통합공사는 '전기공사'·'정보통신공사' 상위 공종 아래 하위 공종으로 생성 */
export function generateTasks(p: Pick<Project, 'info' | 'template' | 'groupShare'>): Task[] {
  const { start, end, kind } = p.info;
  const groups: ('elec' | 'comm')[] = kind === 'both' ? ['elec', 'comm'] : [kind];
  const out: Task[] = [];
  const shares = kind === 'both' ? normalizeTo([p.groupShare.elec, p.groupShare.comm]) : [100];
  groups.forEach((g, gi) => {
    const rows = p.template.filter((r) => r.group === g);
    const ws = normalizeTo(rows.map((r) => r.weight), shares[gi]);
    let parentId: string | null = null;
    if (kind === 'both') {
      const parent = blankTask({ name: g === 'elec' ? '전기공사' : '정보통신공사', start, end, templateKey: g });
      out.push(parent);
      parentId = parent.id;
    }
    rows.forEach((r, i) => {
      const d = fracRange(start, end, r.startPct, r.endPct);
      out.push(blankTask({ parentId, name: r.name, weight: ws[i], start: d.start, end: d.end, templateKey: r.key, note: '' }));
    });
  });
  return out;
}

/** 공사기간 변경 시 기존 일정을 새 공기에 비례 이동. protectManual=true면 직접 수정한 공종은 유지 */
export function rescaleTasks(tasks: Task[], oldS: ISODate, oldE: ISODate, newS: ISODate, newE: ISODate, protectManual: boolean): Task[] {
  const o0 = toNum(oldS);
  const on = toNum(oldE) - o0 + 1;
  const n0 = toNum(newS);
  const nn = toNum(newE) - n0 + 1;
  if (on <= 0 || nn <= 0) return tasks;
  const mapStart = (d: ISODate) => {
    const f = (toNum(d) - o0) / on;
    return fromNum(n0 + Math.max(0, Math.min(nn - 1, Math.floor(f * nn + 1e-9))));
  };
  const mapEnd = (d: ISODate) => {
    const f = (toNum(d) - o0 + 1) / on;
    return fromNum(n0 + Math.max(0, Math.min(nn - 1, Math.ceil(f * nn - 1e-9) - 1)));
  };
  return tasks.map((t) => {
    if (protectManual && t.manual) return t;
    if (!isValidDate(t.start) || !isValidDate(t.end)) return t;
    let s = mapStart(t.start);
    let e = mapEnd(t.end);
    if (e < s) e = s;
    const planCurve = t.planCurve ? t.planCurve.map((pt) => ({ ...pt, date: mapEnd(pt.date) })) : null;
    return { ...t, start: s, end: e, planCurve, manual: protectManual ? t.manual : false };
  });
}

export function defaultForm(): Project['form'] {
  return { title: '예 정 공 정 표', level: 'all', showActual: true, showSign: false, numbering: true };
}

export function defaultInfo(): Project['info'] {
  const today = todayKST();
  return {
    name: '',
    client: '',
    contractor: '㈜에스에스전력',
    amount: 0,
    start: today,
    end: addDays(today, 119),
    location: '',
    kind: 'elec',
    baseDate: today,
    agent: '',
    writer: '',
    reviewer: '',
    approver: '',
    docNo: '',
    memo: '',
  };
}

export function newProject(info?: Partial<Project['info']>): Project {
  const now = new Date().toISOString();
  return {
    id: uid('p'),
    schema: 1,
    info: { ...defaultInfo(), ...info },
    calendar: { mode: 'weekday', distribution: 'month', holidays: [] },
    form: defaultForm(),
    weightMode: 'direct',
    weightProvisional: true,
    groupShare: { elec: 60, comm: 40 },
    template: DEFAULT_TEMPLATE.map((r) => ({ ...r })),
    tasks: [],
    history: [],
    view: 'month',
    scheduleBase: null,
    statusNote: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** 예시 프로젝트 — 첫 실행 시 화면이 비어 있지 않도록 제공 (표시: [예시]) */
export function sampleProject(): Project {
  const p = newProject({
    name: '[예시] ○○초등학교 전기·통신 개보수공사',
    client: '○○교육지원청',
    contractor: '㈜에스에스전력',
    amount: 486000000,
    start: '2026-08-03',
    end: '2027-01-29',
    location: '경기도 ○○시 ○○로 12',
    kind: 'both',
    baseDate: '2026-10-20',
    agent: '현장대리인',
    writer: '작성자',
    reviewer: '검토자',
    approver: '승인자',
    docNo: 'SS-2026-PL-001',
    memo: '예시 데이터입니다. 신규 프로젝트를 만들어 실제 현장을 입력하세요.',
  });
  p.tasks = generateTasks(p);
  p.scheduleBase = { start: p.info.start, end: p.info.end };
  const leaves = p.tasks.filter((t) => t.parentId);
  const sets: [string, number[]][] = [
    ['2026-08-31', [100, 60, 20, 0, 0, 0, 0, 0, 0, 0, 100, 50, 15, 0, 0, 0, 0, 0, 0, 0]],
    ['2026-09-30', [100, 100, 80, 25, 0, 0, 0, 0, 0, 0, 100, 100, 70, 20, 0, 0, 0, 0, 0, 0]],
    ['2026-10-20', [100, 100, 100, 48, 12, 0, 0, 0, 0, 0, 100, 100, 100, 42, 8, 0, 0, 0, 0, 0]],
  ];
  p.history = sets.map(([date, vals]) => ({
    id: uid('h'),
    date,
    values: Object.fromEntries(leaves.map((t, i) => [t.id, vals[i] ?? 0])),
    note: date === '2026-10-20' ? '트레이 자재 입고 지연(1주)' : '',
    savedAt: new Date().toISOString(),
  }));
  const last = sets[sets.length - 1][1];
  leaves.forEach((t, i) => (t.actual = last[i] ?? 0));
  const tray = leaves[3];
  tray.actualStart = '2026-09-07';
  tray.note = '자재 입고 지연';
  p.statusNote = '전선관·트레이 자재 입고가 1주 지연되어 케이블 포설 착수가 늦어지고 있음. 10월 말까지 인력 2명 추가 투입 예정.';
  return p;
}

export { r2 };
