// 데이터 모델 — 서버/DB 연동 시에도 이 구조를 그대로 JSON 문서로 저장한다.

export type ISODate = string; // 'YYYY-MM-DD' (시간대 없는 달력 날짜)

export type WorkKind = 'elec' | 'comm' | 'both';
export type ViewUnit = 'month' | 'week' | 'd20';
export type WeightMode = 'direct' | 'cost';
export type CalendarMode = 'calendar' | 'weekday';

export interface ProjectInfo {
  name: string;
  client: string; // 발주처
  contractor: string; // 시공사
  amount: number; // 계약금액(원)
  start: ISODate; // 착공일
  end: ISODate; // 준공일
  location: string;
  kind: WorkKind;
  baseDate: ISODate; // 기준일
  agent: string; // 현장대리인
  writer: string;
  reviewer: string;
  approver: string;
  docNo: string; // 문서번호/도면번호
  memo: string; // 비고
}

export type Distribution = 'month' | 'workday';

export interface CalendarSetting {
  mode: CalendarMode; // 전체 달력일 / 주말 제외
  /** 보할 배분: month = 공종이 걸친 달마다 균등(실무 공정표 방식), workday = 작업일수 비례 */
  distribution: Distribution;
  holidays: ISODate[]; // 사용자 지정 휴무일 (두 모드 모두에서 제외)
}

/** 공종별 수동 계획 진도: 날짜별 누적 계획률(%) 점. 점 사이는 작업일 기준 선형 보간. */
export interface PlanPoint {
  date: ISODate;
  cum: number;
}

export interface Task {
  id: string;
  parentId: string | null;
  name: string;
  weight: number; // 보할(%) — 하위 공종이 있는 상위 공종은 무시되고 하위 합계를 사용
  cost: number; // 공종별 공사비(원) — 공사비 산정 방식에서 사용
  start: ISODate;
  end: ISODate;
  actual: number; // 현재 실제공정률(%) 0~100
  actualStart: ISODate | '';
  actualEnd: ISODate | '';
  note: string; // 비고(표에 표시)
  memo: string; // 상세 메모
  color: string; // 막대 색상(빈 값이면 기본 파랑)
  manual: boolean; // 사용자가 일정을 직접 수정함 → 자동 재계산 시 보호
  planCurve: PlanPoint[] | null; // 수동 기간별 계획 진도율
  templateKey?: string;
}

/** 기준일별 실적 이력. 입력한 날짜의 값만 저장하며, 입력하지 않은 날짜는 만들지 않는다. */
export interface ProgressEntry {
  id: string;
  date: ISODate;
  values: Record<string, number>; // taskId(하위 공종) → 실제공정률(%)
  note: string;
  savedAt: string; // ISO timestamp
}

export interface TemplateRow {
  key: string;
  group: 'elec' | 'comm';
  name: string;
  startPct: number; // 공사기간 대비 착수 시점(%)
  endPct: number; // 공사기간 대비 완료 시점(%)
  weight: number; // 기본 보할(그룹 내 %)
  pred: string; // 선행 공종(설명용)
}

/** 제출 양식 템플릿: 기본형 / 공사개요형 / 금액병기형 / 막대형(간략) */
export type FormTemplate = 'basic' | 'overview' | 'amount' | 'bar';

export interface FormOptions {
  template: FormTemplate;
  title: string; // 예: 'Ⅳ. 예 정 공 정 표(변경)'
  level: 'all' | 'top'; // 전체 공종 / 상위 공종만
  showActual: boolean; // 하단 칸에 실적 표시
  showSign: boolean; // 결재란
  numbering: boolean; // 공종명 앞 번호
}

/** 장기계속공사: 총차 공정표와 차수(1차·2차…) 공정표를 하나의 묶음(groupId)으로 연결 */
export interface ContractLink {
  groupId: string;
  kind: 'total' | 'phase';
  no: number; // 총차 0, 차수 1,2,3…
}

export interface Project {
  id: string;
  schema: 1;
  info: ProjectInfo;
  calendar: CalendarSetting;
  weightMode: WeightMode;
  weightProvisional: boolean; // 자동 생성된 임시 보할 여부
  groupShare: { elec: number; comm: number }; // 통합공사 전기/통신 비중(%)
  template: TemplateRow[];
  tasks: Task[];
  history: ProgressEntry[];
  view: ViewUnit;
  scheduleBase: { start: ISODate; end: ISODate } | null; // 공정표 생성/재계산 당시 공사기간
  statusNote: string; // 공정현황 및 특이사항
  form: FormOptions; // 제출용 양식 설정
  contract?: ContractLink | null; // 장기계속공사 차수 연결
  createdAt: string;
  updatedAt: string;
}
