export type TradeType = 'ELECTRIC' | 'TELECOM' | 'BUILDING' | 'COMPLEX';
export type ProjectStatus = 'PLANNED' | 'IN_PROGRESS' | 'SUSPENDED' | 'COMPLETED' | 'SETTLED';
export type VendorType = 'SUPPLIER' | 'SUBCONTRACTOR' | 'CLIENT' | 'BOTH';
export type BizStatus = 'UNKNOWN' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export const TRADE: Record<TradeType, { label: string; short: string; color: string }> = {
  ELECTRIC: { label: '전기', short: '전기', color: 'var(--trade-electric)' },
  TELECOM: { label: '정보통신', short: '통신', color: 'var(--trade-telecom)' },
  BUILDING: { label: '건축', short: '건축', color: 'var(--trade-building)' },
  COMPLEX: { label: '복합', short: '복합', color: 'var(--trade-complex)' },
};

export const STATUS: Record<ProjectStatus, { label: string; tone: 'outline' | 'steel' | 'seal' | 'ok' | 'ink' }> = {
  PLANNED: { label: '예정', tone: 'outline' },
  IN_PROGRESS: { label: '진행', tone: 'steel' },
  SUSPENDED: { label: '중지', tone: 'seal' },
  COMPLETED: { label: '준공', tone: 'ok' },
  SETTLED: { label: '정산완료', tone: 'ink' },
};

export const CONTRACT_ROLE = { PRIME: '원도급', SUB: '하도급', JOINT: '공동도급' } as const;
export const SECTOR = { PUBLIC: '관급', PRIVATE: '민간' } as const;
export const VENDOR_TYPE: Record<VendorType, string> = { SUPPLIER: '매입처', SUBCONTRACTOR: '협력업체', CLIENT: '발주처', BOTH: '매출·매입' };
export const BIZ_STATUS: Record<BizStatus, { label: string; tone: 'outline' | 'ok' | 'warn' | 'seal' }> = {
  UNKNOWN: { label: '미확인', tone: 'outline' },
  ACTIVE: { label: '계속사업자', tone: 'ok' },
  SUSPENDED: { label: '휴업', tone: 'warn' },
  CLOSED: { label: '폐업', tone: 'seal' },
};
export const SCOPE_LABEL = { COMPANY: '회사 전체', ASSIGNED: '배정 현장만', CONFIRMED_ONLY: '확정 자료만' } as const;

export const AUDIT_ACTION: Record<string, string> = {
  LOGIN: '로그인', LOGIN_FAIL: '로그인 실패', LOGIN_PASSWORD_OK: '비밀번호 확인', ACCOUNT_LOCKED: '계정 잠김', MFA_FAIL: '인증번호 실패',
  MFA_ENABLE: '2단계 인증 사용', MFA_DISABLE: '2단계 인증 해제', PASSWORD_CHANGE: '비밀번호 변경', PASSWORD_RESET: '비밀번호 초기화',
  CREATE: '등록', UPDATE: '수정', DELETE: '삭제', EXPORT: '출력(엑셀·PDF)', UPLOAD: '파일 첨부', DOWNLOAD: '파일 내려받기',
  VIEW_SENSITIVE: '민감정보 조회', UNLOCK: '잠금 해제', SESSION_REVOKE: '강제 로그아웃', AUDIT_VERIFY: '무결성 검사', LICENSE_INSTALL: '라이선스 등록',
  IMPORT: '엑셀 등록', SUBMIT: '결재 상신', PAY: '지급', VOID: '무효 처리', REVERSE: '역분개', APPROVE: '승인', CLOSE: '마감', REOPEN: '마감 해제', APPLY: '반영', ACK: '경고 확인', APPROVAL_APPROVE: '결재 승인', APPROVAL_REJECT: '결재 반려', APPROVAL_HOLD: '결재 보류', APPROVAL_CANCEL: '결재 회수', STATUS: '상태 변경', CANCEL: '취소',
};
export const AUDIT_RESOURCE: Record<string, string> = {
  auth: '인증', project: '현장', project_assignment: '현장 담당자', vendor: '거래처', file: '파일', user: '사용자', role: '역할',
  company: '회사', audit: '감사로그', license: '라이선스', tax_rate: '세율',
  material: '자재', purchase_order: '발주서', goods_receipt: '검수', approval: '결재', approval_line: '결재선',
  journal_entry: '전표', payment_request: '지급결의', payment: '지급', account: '계정과목', cost_code: '원가항목', posting_rule: '자동분개 규칙',
  accounting_period: '회계기간', bank_account: '계좌·카드', budget: '실행예산', purchase_request: '구매요청', ledger: '장부',
};

export const PO_STATUS: Record<import('./types').PoStatus, { label: string; tone: 'outline' | 'steel' | 'seal' | 'ok' | 'ink' | 'warn' | 'muted' }> = {
  DRAFT: { label: '작성중', tone: 'outline' },
  PENDING: { label: '결재중', tone: 'warn' },
  APPROVED: { label: '승인', tone: 'steel' },
  REJECTED: { label: '반려', tone: 'seal' },
  SENT: { label: '발주전송', tone: 'steel' },
  PARTIAL: { label: '부분입고', tone: 'warn' },
  RECEIVED: { label: '입고완료', tone: 'ok' },
  CLOSED: { label: '종결', tone: 'ink' },
  CANCELLED: { label: '취소', tone: 'muted' },
};
export const TAX_TYPE = { TAXABLE: '과세', EXEMPT: '면세', ZERO: '영세' } as const;
export const MAT_TRADE: Record<string, string> = { ELECTRIC: '전기', TELECOM: '통신', BUILDING: '건축', COMMON: '공통' };
export const APPROVAL_STATUS = {
  PENDING: { label: '진행', tone: 'warn' },
  HOLD: { label: '보류', tone: 'warn' },
  APPROVED: { label: '승인', tone: 'ok' },
  REJECTED: { label: '반려', tone: 'seal' },
  CANCELLED: { label: '회수', tone: 'muted' },
} as const;

type Tone = 'outline' | 'steel' | 'seal' | 'ok' | 'ink' | 'warn' | 'muted';
export const PAYREQ_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: '작성중', tone: 'outline' }, PENDING: { label: '결재중', tone: 'warn' }, APPROVED: { label: '지급대기', tone: 'steel' },
  REJECTED: { label: '반려', tone: 'seal' }, PAID: { label: '지급완료', tone: 'ok' }, CANCELLED: { label: '취소', tone: 'muted' },
};
export const PAYREQ_KIND: Record<string, string> = { PURCHASE: '자재대금', SUBCONTRACT: '외주·하도급', EXPENSE: '경비', LABOR: '노무비', OTHER: '기타' };
export const PAY_METHOD: Record<string, string> = { TRANSFER: '계좌이체', CASH: '현금', CARD: '카드', BILL: '어음', OFFSET: '상계' };
export const JOURNAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: '미승인', tone: 'warn' }, APPROVED: { label: '승인', tone: 'ok' }, REVERSED: { label: '역분개됨', tone: 'muted' }, VOID: { label: '무효', tone: 'muted' },
};
export const SOURCE_LABEL: Record<string, string> = {
  MANUAL: '수동', RECEIPT: '검수', PAYMENT_REQUEST: '지급결의', PAYMENT: '지급', TAX_INVOICE: '세금계산서', CLAIM: '기성', COLLECTION: '수금',
  SUB_CLAIM: '하도급 기성', LABOR: '노무비', BANK: '통장거래', YEAR_CLOSE: '연마감', OPENING: '기초잔액',
};
export const REV_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: '작성중', tone: 'outline' }, PENDING: { label: '결재중', tone: 'warn' }, APPROVED: { label: '반영', tone: 'ok' }, REJECTED: { label: '반려', tone: 'seal' }, CANCELLED: { label: '취소', tone: 'muted' },
};
export const PR_STATUS: Record<string, { label: string; tone: Tone }> = {
  REQUESTED: { label: '요청', tone: 'warn' }, ORDERED: { label: '발주완료', tone: 'ok' }, REJECTED: { label: '반려', tone: 'seal' }, CANCELLED: { label: '취소', tone: 'muted' },
};
export const ACCOUNT_TYPE: Record<string, string> = { ASSET: '자산', LIABILITY: '부채', EQUITY: '자본', REVENUE: '수익', EXPENSE: '비용' };
export const ACCOUNT_CATEGORY: Record<string, string> = {
  CURRENT_ASSET: '유동자산', NONCURRENT_ASSET: '비유동자산', CURRENT_LIABILITY: '유동부채', NONCURRENT_LIABILITY: '비유동부채', EQUITY: '자본',
  SALES: '매출', CONSTRUCTION_COST: '공사원가', SGA: '판매비와관리비', NON_OP_INCOME: '영업외수익', NON_OP_EXPENSE: '영업외비용', TAX: '법인세',
};
export const BUDGET_LEVEL: Record<string, { label: string; tone: Tone }> = {
  OK: { label: '정상', tone: 'outline' }, WARN: { label: '90% 도달', tone: 'warn' }, OVER: { label: '초과', tone: 'seal' }, UNBUDGETED: { label: '예산 없음', tone: 'seal' },
};
export const TI_STATUS: Record<string, { label: string; tone: Tone }> = {
  COLLECTED: { label: '미처리', tone: 'warn' }, POSTED: { label: '처리완료', tone: 'ok' }, IGNORED: { label: '제외', tone: 'muted' },
  DRAFT: { label: '작성중', tone: 'outline' }, PENDING: { label: '결재중', tone: 'warn' }, READY: { label: '발행대기', tone: 'steel' },
  ISSUED: { label: '발행', tone: 'ok' }, FAILED: { label: '발행실패', tone: 'seal' }, CANCELLED: { label: '취소', tone: 'muted' },
};
export const NTS_STATUS: Record<string, { label: string; tone: Tone }> = {
  NOT_SENT: { label: '국세청 미전송', tone: 'muted' }, WAITING: { label: '전송 대기', tone: 'warn' }, SENT: { label: '국세청 전송완료', tone: 'ok' }, FAILED: { label: '전송 실패', tone: 'seal' },
};
export const TI_SOURCE: Record<string, string> = { HOMETAX: '홈택스 수집', EXCEL: '홈택스 엑셀', MANUAL: '직접 입력', OCR: '문서 스캔' };
export const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  UPLOADED: { label: '인식 대기', tone: 'outline' }, EXTRACTED: { label: '확인 필요', tone: 'warn' }, FAILED: { label: '인식 실패', tone: 'seal' }, REGISTERED: { label: '등록 완료', tone: 'ok' }, REJECTED: { label: '반려', tone: 'muted' },
};
