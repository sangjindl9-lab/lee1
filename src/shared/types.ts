// 서버·클라이언트가 함께 쓰는 데이터 모델과 계산 결과 타입입니다.
// 날짜는 모두 YYYY-MM-DD 문자열이며 시간대 변환 없이 달력 날짜로 다룹니다.

export type WeightBasis = 'amount' | 'manual';
export type PeriodUnit = 'month' | 'week';
export type ScheduleStatus = 'ahead' | 'onTrack' | 'behind';

export interface Project {
  id: string;
  /** 1~100자 */
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  weightBasis: WeightBasis;
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  /** 구분(빈 문자열 허용) */
  category: string;
  /** 공종명 */
  name: string;
  /** 금액 또는 가중치, 0보다 큰 수 */
  weightValue: number;
  startDate: string;
  endDate: string;
  /** 표시 순서(0부터) */
  order: number;
}

export interface ProgressRecord {
  id: string;
  taskId: string;
  date: string;
  /** 그 날짜까지의 누계 진척률 0~100 */
  percent: number;
}

export interface Period {
  /** 월: "2026-01" / 주: 주 시작일(월요일) "2026-01-05" */
  key: string;
  /** 월: "2026년 1월" / 주: "1/5~1/11" */
  label: string;
  start: string;
  end: string;
}

export interface ScheduleRow {
  taskId: string;
  category: string;
  name: string;
  weightValue: number;
  /** 보할(%) */
  bohal: number;
  startDate: string;
  endDate: string;
  /** 기준일 현재 공종 진척률(%) */
  currentPercent: number;
  /** 기간별 계획값(%), 작업 기간과 겹치지 않으면 null */
  planned: (number | null)[];
}

export interface ScheduleTotals {
  weightValue: number;
  /** 공종이 있으면 100, 없으면 0 */
  bohal: number;
  periodPlanned: number[];
  cumulativePlanned: number[];
  /** 기준일 이후에 시작하는 기간은 null */
  periodActual: (number | null)[];
  cumulativeActual: (number | null)[];
}

export interface ScheduleSummary {
  /** 기준일 현재 계획 누계(일 단위 배분, %) */
  plannedToDate: number;
  actualToDate: number;
  /** actualToDate − plannedToDate (%p) */
  variance: number;
  status: ScheduleStatus;
}

/** GET /api/projects 의 한 항목: 프로젝트와 기준일 현재 진도 요약 */
export interface ProjectSummary extends Project, ScheduleSummary {
  /** 공종 수 */
  taskCount: number;
}

export interface Schedule {
  project: Project;
  unit: PeriodUnit;
  /** 기준일 */
  asOf: string;
  periods: Period[];
  /** 기준일이 속한 기간의 위치, 기준일이 프로젝트 기간 밖이면 null */
  asOfPeriodIndex: number | null;
  rows: ScheduleRow[];
  totals: ScheduleTotals;
  summary: ScheduleSummary;
}
