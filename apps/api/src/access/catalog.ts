/**
 * 권한 카탈로그 — 리소스 × 동작.
 * 새 기능을 추가할 때는 이 표에 리소스를 먼저 등록한다.
 */
export const ACTIONS = ['read', 'create', 'update', 'delete', 'approve', 'export', 'api'] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = {
  dashboard: { label: '대시보드', group: '공통', stage: 1 },
  project: { label: '현장', group: '현장관리', stage: 1 },
  contract: { live: true, label: '계약·변경계약', group: '현장관리', stage: 4 },
  budget: { live: true, label: '실행예산', group: '현장관리', stage: 2 },
  vendor: { label: '거래처', group: '구매·자재', stage: 1 },
  material: { label: '자재마스터', group: '구매·자재', stage: 2, live: true },
  purchase: { label: '구매요청·발주', group: '구매·자재', stage: 2, live: true },
  receipt: { label: '납품·검수', group: '구매·자재', stage: 2, live: true },
  document: { live: true, label: '문서 스캔', group: '구매·자재', stage: 3 },
  claim: { live: true, label: '기성·수금', group: '매출·기성', stage: 4 },
  subcontract: { live: true, label: '하도급·외주', group: '매출·기성', stage: 4 },
  taxinvoice: { live: true, label: '세금계산서', group: '세금계산서', stage: 3 },
  bank: { label: '계좌·카드', group: '자금', stage: 5, live: true },
  expense: { live: true, label: '지급결의', group: '자금', stage: 2 },
  payment: { live: true, label: '지급', group: '자금', stage: 2 },
  journal: { live: true, label: '전표·장부', group: '회계', stage: 2 },
  closing: { live: true, label: '월마감', group: '회계', stage: 2 },
  labor: { live: true, label: '노무비', group: '노무', stage: 4 },
  approval: { label: '전자결재', group: '전자결재', stage: 2, live: true },
  report: { live: true, label: '보고서', group: '보고서', stage: 2 },
  company: { label: '회사', group: '관리', stage: 1 },
  user: { label: '사용자', group: '관리', stage: 1 },
  role: { label: '역할·권한', group: '관리', stage: 1 },
  audit: { label: '감사로그', group: '관리', stage: 1 },
  integration: { live: true, label: '외부 연동', group: '관리', stage: 3 },
  apikey: { live: true, label: 'API 키', group: '관리', stage: 5 },
  license: { label: '라이선스', group: '관리', stage: 1 },
} as const;
export type Resource = keyof typeof RESOURCES;
/** 구현이 끝나 실제로 쓸 수 있는 리소스인지 (1단계 + 2단계 중 완료분) */
export const isLive = (r: Resource) => RESOURCES[r].stage === 1 || (RESOURCES[r] as { live?: boolean }).live === true;

export const ACTION_LABELS: Record<Action, string> = {
  read: '조회', create: '등록', update: '수정', delete: '삭제', approve: '승인', export: '출력', api: 'API',
};

type Perm = `${Resource}:${Action}`;
const all = (r: Resource): Perm[] => ACTIONS.map((a) => `${r}:${a}` as Perm);
const ro = (...rs: Resource[]): Perm[] => rs.flatMap((r) => [`${r}:read`, `${r}:export`] as Perm[]);
const rw = (...rs: Resource[]): Perm[] => rs.flatMap((r) => [`${r}:read`, `${r}:create`, `${r}:update`, `${r}:export`] as Perm[]);

const BUSINESS: Resource[] = Object.keys(RESOURCES).filter(
  (r) => !['company', 'user', 'role', 'audit', 'integration', 'apikey', 'license'].includes(r),
) as Resource[];

export interface DefaultRole {
  key: string;
  name: string;
  description: string;
  scope: 'COMPANY' | 'ASSIGNED' | 'CONFIRMED_ONLY';
  permissions: Perm[];
}

/** 기본 제공 역할 (회사 생성 시 자동 생성, 권한은 관리 화면에서 조정 가능) */
export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: 'ADMIN', name: '최고관리자', description: '시스템·사용자·권한·연동 전체 관리', scope: 'COMPANY',
    permissions: (Object.keys(RESOURCES) as Resource[]).flatMap(all),
  },
  {
    key: 'CEO', name: '대표이사', description: '전 현장 손익·자금 조회, 최종 결재', scope: 'COMPANY',
    permissions: [...ro(...BUSINESS), 'approval:approve', 'approval:create', 'audit:read', 'user:read'],
  },
  {
    key: 'EXECUTIVE', name: '임원', description: '지정 현장 통합 조회 및 결재', scope: 'ASSIGNED',
    permissions: [...ro(...BUSINESS), 'approval:approve', 'approval:create'],
  },
  {
    key: 'ACCOUNTING_MANAGER', name: '회계관리자', description: '회계·자금·세금계산서 관리, 전표 승인, 마감', scope: 'COMPANY',
    permissions: [
      ...ro(...BUSINESS),
      ...rw('journal', 'taxinvoice', 'bank', 'expense', 'payment', 'closing', 'vendor', 'document'),
      'journal:approve', 'taxinvoice:approve', 'payment:approve', 'expense:approve', 'closing:approve', 'approval:approve', 'approval:create', 'labor:approve', 'labor:read', 'labor:update', 'subcontract:approve',
    ],
  },
  {
    key: 'BOOKKEEPER', name: '경리담당자', description: '증빙·전표 작성, 지급결의', scope: 'COMPANY',
    permissions: [...ro(...BUSINESS), ...rw('journal', 'expense', 'document', 'taxinvoice', 'bank', 'vendor'), 'approval:create'],
  },
  {
    key: 'CONTRACT_MANAGER', name: '공무담당자', description: '계약·실행예산·기성 관리', scope: 'ASSIGNED',
    permissions: [...ro('dashboard', 'project', 'vendor', 'report', 'purchase', 'receipt'), ...rw('project', 'contract', 'budget', 'claim', 'subcontract'), 'subcontract:approve', 'approval:create'],
  },
  {
    key: 'PURCHASER', name: '구매담당자', description: '거래처·자재·발주·검수', scope: 'COMPANY',
    permissions: [...ro('dashboard', 'project', 'budget', 'report'), ...rw('vendor', 'material', 'purchase', 'receipt', 'document'), 'approval:create'],
  },
  {
    key: 'SITE_MANAGER', name: '현장소장', description: '담당 현장의 발주요청·지출·노무', scope: 'ASSIGNED',
    permissions: [...ro('dashboard', 'project', 'budget', 'vendor', 'material', 'report'), ...rw('purchase', 'receipt', 'expense', 'labor', 'document'), 'approval:create'],
  },
  {
    key: 'STAFF', name: '일반직원', description: '배정된 현장 기본 조회', scope: 'ASSIGNED',
    permissions: ['dashboard:read', 'project:read', 'vendor:read', 'approval:create'],
  },
  {
    key: 'TAX_ACCOUNTANT', name: '외부 세무담당자', description: '승인·확정된 회계자료 열람', scope: 'CONFIRMED_ONLY',
    permissions: ro('journal', 'taxinvoice', 'report', 'closing'),
  },
];
