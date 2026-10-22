/**
 * 외부 연동 공통 타입 — 공급업체를 바꿔 끼울 수 있게 기능별 인터페이스로 나눈다 (Provider Adapter).
 */
export type Mode = 'TEST' | 'LIVE';
export type IntegrationKind = 'TAX_ISSUE' | 'HOMETAX' | 'BIZ_STATUS' | 'OCR';

export interface ProviderContext {
  mode: Mode;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
}

/** 외부 API 오류 — retryable 이면 자동 재시도 대상 */
export class ProviderError extends Error {
  constructor(message: string, public code = 'PROVIDER_ERROR', public retryable = false, public detail?: unknown) {
    super(message);
  }
}

// ───────── 전자세금계산서 발행 ─────────
export interface IssueParty { bizNo: string; name: string; ceo: string; address?: string | null; bizType?: string | null; bizItem?: string | null; email?: string | null }
export interface IssueRequest {
  mgtKey: string;
  writeDate: string; // YYYY-MM-DD
  purpose: 'CHARGE' | 'RECEIPT';
  taxType: 'TAX' | 'ZERO' | 'EXEMPT';
  supplier: IssueParty;
  buyer: IssueParty;
  supplyAmount: string;
  vatAmount: string;
  totalAmount: string;
  remark?: string | null;
  modifyCode?: string | null;
  originalApprovalNo?: string | null;
  lines: { lineNo: number; itemDate?: string | null; name?: string | null; spec?: string | null; qty?: string | null; unitPrice?: string | null; supplyAmount: string; vatAmount: string; remark?: string | null }[];
}
export interface IssueResult { approvalNo: string | null; providerKey: string; ntsStatus: 'NOT_SENT' | 'WAITING' | 'SENT' | 'FAILED'; message?: string; raw?: unknown }
export interface TaxIssueProvider {
  readonly name: string;
  /** 이 공급업체가 실제로 국세청에 전송할 수 있는 모드인지 (샌드박스는 항상 false) */
  isLegal(mode: Mode): boolean;
  test(pc: ProviderContext): Promise<string>;
  issue(pc: ProviderContext, req: IssueRequest): Promise<IssueResult>;
  status(pc: ProviderContext, providerKey: string, corpNum: string): Promise<Omit<IssueResult, 'providerKey'>>;
  cancel(pc: ProviderContext, providerKey: string, corpNum: string, memo: string): Promise<void>;
}

// ───────── 홈택스 매입·매출 수집 ─────────
export interface CollectedInvoice {
  approvalNo: string | null;
  writeDate: string;
  issueDate?: string | null;
  sendDate?: string | null;
  invoiceType?: string | null;
  docKind: 'TAX' | 'EXEMPT';
  purpose: 'CHARGE' | 'RECEIPT';
  supplier: Partial<IssueParty>;
  buyer: Partial<IssueParty>;
  supplyAmount: string;
  vatAmount: string;
  totalAmount: string;
  remark?: string | null;
  modifyReason?: string | null;
  lines: { itemDate?: string | null; name?: string | null; spec?: string | null; qty?: string | null; unitPrice?: string | null; supplyAmount: string; vatAmount: string; remark?: string | null }[];
  raw?: unknown;
}
export interface CollectRequest {
  direction: 'SALES' | 'PURCHASE';
  from: string;
  to: string;
  login: Record<string, string>; // 로그인 방식별 값 (아이디/인증서/간편인증 정보)
}
export type CollectResult =
  | { kind: 'DONE'; invoices: CollectedInvoice[]; pages?: number }
  | { kind: 'NEED_AUTH'; method: string; twoWayInfo: Record<string, unknown>; extraInfo?: Record<string, unknown>; message: string; partial: CollectedInvoice[] };
export interface HometaxProvider {
  readonly name: string;
  test(pc: ProviderContext): Promise<string>;
  collect(pc: ProviderContext, req: CollectRequest): Promise<CollectResult>;
  continueAuth(pc: ProviderContext, req: CollectRequest, twoWayInfo: Record<string, unknown>, answer: Record<string, string>): Promise<CollectResult>;
}

// ───────── 사업자 상태조회 ─────────
export interface BizStatus { bizNo: string; status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'UNKNOWN'; label: string; taxType?: string; closedDate?: string | null }
export interface BizStatusProvider {
  readonly name: string;
  test(pc: ProviderContext): Promise<string>;
  check(pc: ProviderContext, bizNos: string[]): Promise<BizStatus[]>;
}

// ───────── 문서 인식 (OCR/AI) ─────────
export interface ExtractedLine { name: string; spec?: string | null; unit?: string | null; qty?: string | null; unitPrice?: string | null; supplyAmount?: string | null; vatAmount?: string | null; memo?: string | null; confidence?: number }
export interface Extraction {
  docType?: string | null;
  vendorName?: string | null;
  vendorBizNo?: string | null;
  docNo?: string | null;
  docDate?: string | null;
  deliveryDate?: string | null;
  deliveryPlace?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  supplyAmount?: string | null;
  vatAmount?: string | null;
  totalAmount?: string | null;
  memo?: string | null;
  lines: ExtractedLine[];
  confidence: number; // 0~1
  pages?: number;
  fieldConfidence?: Record<string, number>;
  warnings?: string[];
  /** 문서에서 찾은 모든 사업자번호 (우리 회사 번호를 빼고 거래처를 고를 때) */
  allBizNos?: string[];
}
export interface OcrProvider {
  readonly name: string;
  test(pc: ProviderContext): Promise<string>;
  extract(pc: ProviderContext, file: { buffer: Buffer; mimeType: string; name: string }, hint: { docType: string }): Promise<Extraction>;
}
