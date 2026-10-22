import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Building2, Package, Receipt, FileText, Landmark, BookOpen, HardHat, Stamp, BarChart3, Settings2,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  /** 이 메뉴를 보려면 필요한 권한 (resource:action) */
  perm?: string;
  /** 구현 단계 — 완료되지 않은 메뉴는 '예정' 안내 화면으로 연결 */
  stage: number;
  /** 2단계 이후 메뉴 중 이미 완료된 것 */
  live?: boolean;
  /** 메뉴 옆 숫자 배지 */
  badge?: 'approvals';
  hint?: string;
}
export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const STAGE_TITLE: Record<number, string> = {
  2: '2단계 · 회계·발주 핵심',
  3: '3단계 · 세금계산서·문서 스캔',
  4: '4단계 · 공사관리 고도화',
  5: '5단계 · 금융·외부연동',
};

export const NAV: NavGroup[] = [
  { key: 'home', label: '대시보드', icon: LayoutDashboard, items: [{ label: '대시보드', href: '/dashboard', perm: 'dashboard:read', stage: 1 }] },
  {
    key: 'site', label: '현장관리', icon: Building2,
    items: [
      { label: '현장 목록', href: '/projects', perm: 'project:read', stage: 1 },
      { label: '계약·변경계약', href: '/soon/contracts', perm: 'contract:read', stage: 4, hint: '최초계약 보존, 변경계약 이력, 승인 전 미확정 처리' },
      { label: '실행예산', href: '/budgets', perm: 'budget:read', stage: 2, live: true },
      { label: '현장 손익', href: '/project-pl', perm: 'report:read', stage: 2, live: true },
    ],
  },
  {
    key: 'buy', label: '구매·자재', icon: Package,
    items: [
      { label: '거래처', href: '/vendors', perm: 'vendor:read', stage: 1 },
      { label: '자재마스터', href: '/materials', perm: 'material:read', stage: 2, live: true },
      { label: '구매요청', href: '/purchase-requests', perm: 'purchase:read', stage: 2, live: true },
      { label: '발주서', href: '/purchase-orders', perm: 'purchase:read', stage: 2, live: true },
      { label: '납품·검수', href: '/receipts', perm: 'receipt:read', stage: 2, live: true },
      { label: '문서 스캔', href: '/scan', perm: 'document:read', stage: 3, live: true },
    ],
  },
  {
    key: 'sales', label: '매출·기성', icon: FileText,
    items: [
      { label: '기성청구', href: '/soon/claims', perm: 'claim:read', stage: 4, hint: '전회·금회·누적 기성, 유보금, 기성청구서 PDF' },
      { label: '수금관리', href: '/soon/collections', perm: 'claim:read', stage: 4, hint: '수금예정·실수금 매칭, 미수금 연체' },
      { label: '하도급·외주', href: '/soon/subcontracts', perm: 'subcontract:read', stage: 4, hint: '하도급 계약·기성·지급·정산' },
    ],
  },
  {
    key: 'tax', label: '세금계산서', icon: Receipt,
    items: [
      { label: '매출 발행', href: '/tax-invoices?direction=SALES', perm: 'taxinvoice:read', stage: 3, live: true },
      { label: '매입 수집·처리', href: '/tax-invoices', perm: 'taxinvoice:read', stage: 3, live: true },
      { label: '발주·계산서 대사', href: '/tax-invoices/reconcile', perm: 'taxinvoice:read', stage: 3, live: true },
    ],
  },
  {
    key: 'fund', label: '자금', icon: Landmark,
    items: [
      { label: '지급결의', href: '/payment-requests', perm: 'expense:read', stage: 2, live: true },
      { label: '계좌·카드', href: '/bank', perm: 'bank:read', stage: 5, live: true },
      { label: '거래내역 대사', href: '/soon/reconcile', perm: 'bank:read', stage: 5, hint: '입출금과 미수·미지급 자동 대조' },
      { label: '자금일보·수지', href: '/soon/cashflow', perm: 'bank:read', stage: 5, hint: '일일 자금현황, 월별 예상 현금흐름' },
    ],
  },
  {
    key: 'acct', label: '회계', icon: BookOpen,
    items: [
      { label: '전표', href: '/journals', perm: 'journal:read', stage: 2, live: true },
      { label: '원장·시산표', href: '/ledgers', perm: 'journal:read', stage: 2, live: true },
      { label: '재무제표', href: '/statements', perm: 'journal:read', stage: 2, live: true },
      { label: '월마감', href: '/closing', perm: 'closing:read', stage: 2, live: true },
    ],
  },
  { key: 'labor', label: '노무', icon: HardHat, items: [{ label: '작업일보·노무비', href: '/soon/labor', perm: 'labor:read', stage: 4, hint: '현장별 작업자·공수·노무비 집계' }] },
  {
    key: 'approval', label: '전자결재', icon: Stamp,
    items: [
      { label: '결재함', href: '/approvals', perm: 'approval:create', stage: 2, live: true, badge: 'approvals' },
      { label: '결재선 설정', href: '/admin/approval-lines', perm: 'approval:read', stage: 2, live: true },
    ],
  },
  { key: 'report', label: '보고서', icon: BarChart3, items: [{ label: '보고서', href: '/soon/reports', perm: 'report:read', stage: 2, hint: '현장별 손익·원가명세서·미수·미지급·자금일보' }] },
  {
    key: 'admin', label: '관리', icon: Settings2,
    items: [
      { label: '회사 정보', href: '/admin/company', perm: 'company:read', stage: 1 },
      { label: '사용자', href: '/admin/users', perm: 'user:read', stage: 1 },
      { label: '역할·권한', href: '/admin/roles', perm: 'role:read', stage: 1 },
      { label: '감사로그', href: '/admin/audit', perm: 'audit:read', stage: 1 },
      { label: '계정과목·분개규칙', href: '/admin/accounting', perm: 'journal:read', stage: 2, live: true },
      { label: '세율 설정', href: '/admin/tax-rates', perm: 'company:read', stage: 1 },
      { label: '라이선스', href: '/admin/license', perm: 'license:read', stage: 1 },
      { label: '외부 연동', href: '/admin/integrations', perm: 'integration:read', stage: 3, live: true },
      { label: 'API 키', href: '/soon/api-keys', perm: 'apikey:read', stage: 5, hint: '외부 프로그램용 REST API 키 발급·폐기' },
    ],
  },
];

export const isLiveItem = (i: NavItem) => i.stage === 1 || !!i.live;
export const ALL_ITEMS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
export const findSoon = (slug: string) => ALL_ITEMS.find((i) => i.href === `/soon/${slug}`);
