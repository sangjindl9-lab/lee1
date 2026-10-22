import type { CONTRACT_ROLE, SECTOR, ProjectStatus, TradeType, VendorType, BizStatus } from './labels';

export interface ProjectRow {
  id: string; code: string; name: string; tradeType: TradeType; status: ProjectStatus; contractRole: keyof typeof CONTRACT_ROLE; clientSector: keyof typeof SECTOR;
  clientName: string | null; contractDate: string | null; startDate: string | null; plannedEndDate: string | null; supplyAmount: string; vatAmount: string; totalAmount: string;
  executionBudget: string; plannedMargin: string; plannedMarginRate: string | null; progressRate: string; progressPercent: string; siteManagerName: string | null; version: number;
}

export interface FileItem { id: string; category: string; originalName: string; size: number; mimeType: string; createdAt: string }

export interface ProjectDetail extends ProjectRow {
  companyId: string; primeContractor: string | null; subContractor: string | null; siteAddress: string | null; contractType: string | null;
  actualEndDate: string | null; vatRate: string; jointShareRate: string | null; jointSharePercent: string | null; managerName: string | null; memo: string | null;
  createdAt: string; updatedAt: string;
  members: { membershipId: string; roleInProject: string | null; name: string; loginId: string }[];
  files: FileItem[];
}

export interface VendorRow {
  id: string; code: string; name: string; vendorType: VendorType; bizRegNo: string | null; ceoName: string | null; address: string | null; businessType: string | null;
  businessItem: string | null; contactName: string | null; contactPhone: string | null; email: string | null; phone: string | null; fax: string | null; bankName: string | null;
  bankAccountMask: string | null; hasBankAccount: boolean; bankHolder: string | null; paymentTerms: string | null; bizStatus: BizStatus; memo: string | null; version: number;
  createdAt: string; updatedAt: string;
}
export interface VendorDetail extends VendorRow { files: FileItem[] }

// ───────── 2단계 ─────────
export type TaxType = 'TAXABLE' | 'EXEMPT' | 'ZERO';
export type PoStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';

export interface Material {
  id: string; code: string; name: string; spec: string | null; maker: string | null; unit: string; category: string | null;
  tradeType: 'ELECTRIC' | 'TELECOM' | 'BUILDING' | 'COMMON' | null; defaultPrice: string; taxType: TaxType; memo: string | null; isActive: boolean; version: number;
  vendorPrice?: { unitPrice: string; lastOrderDate: string | null } | null;
}

export interface ApprovalStep {
  id: string; stepNo: number; title: string; roleKey: string | null; approverNames: string | null;
  state: 'WAITING' | 'APPROVED' | 'REJECTED' | 'HOLD' | 'SKIPPED'; actedByName: string | null; actedAt: string | null; comment: string | null;
}
export interface Approval {
  id: string; docType: string; docLabel?: string; href?: string | null; docId: string; docCode: string | null; title: string; amount: string; projectId: string | null;
  status: 'PENDING' | 'HOLD' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; currentStep: number; drafterId: string; drafterName: string;
  submittedAt: string; completedAt: string | null; version: number; steps: ApprovalStep[];
}

export interface PoRow {
  id: string; code: string; revision: number; title: string; orderDate: string; deliveryDate: string | null; status: PoStatus;
  supplyAmount: string; vatAmount: string; totalAmount: string; vendorName: string; projectCode: string; projectName: string;
  tradeType: TradeType; lineCount: number; receivedRate: string; version: number; projectId: string; vendorId: string;
}
export interface PoLine {
  id: string; lineNo: number; materialId: string | null; name: string; spec: string | null; unit: string; qty: string; unitPrice: string;
  supplyAmount: string; vatAmount: string; taxType: TaxType; receivedQty: string; remainingQty: string; memo: string | null;
}
export interface Receipt {
  id: string; code: string; receiptDate: string; inspectorName: string | null; memo: string | null; status: 'CONFIRMED' | 'CANCELLED';
  supplyAmount: string; vatAmount: string; cancelReason: string | null; createdAt: string; lines: { poLineId: string; qty: string; supplyAmount: string; note: string | null }[];
}
export interface PoDetail {
  id: string; code: string; revision: number; title: string; status: PoStatus; statusLabel: string; orderDate: string; deliveryDate: string | null;
  deliveryPlace: string | null; paymentTerms: string | null; ourContact: string | null; ourPhone: string | null; vendorContact: string | null; memo: string | null;
  supplyAmount: string; vatAmount: string; totalAmount: string; vatRate: string; version: number; projectId: string; vendorId: string; costCodeId: string | null; requestId: string | null;
  approvedAt: string | null; sentAt: string | null; createdAt: string; updatedAt: string;
  lines: PoLine[];
  vendor: VendorRow;
  project: { id: string; code: string; name: string; tradeType: TradeType; siteAddress: string | null; status: ProjectStatus };
  company: { name: string; bizRegNo: string; ceoName: string | null; address: string | null; phone: string | null };
  approval: Approval | null;
  approvalHistory: Approval[];
  receipts: Receipt[];
}
export type PoDetailFull = PoDetail & { canAct: boolean; canRecall: boolean };

/** 결재 문서 상세에 공통으로 붙는 결재 상태 */
export interface DocApprovalState { approval: Approval | null; approvalHistory: Approval[]; canAct: boolean; canRecall: boolean }
