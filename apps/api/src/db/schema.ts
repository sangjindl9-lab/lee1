/**
 * SS-ERP 데이터베이스 스키마 — 1단계
 * 금액 numeric(18,2) / 수량·단가 numeric(18,4) / 비율 numeric(7,4)
 * numeric 컬럼은 문자열로 읽고 쓴다 (부동소수점 오차 차단). 계산은 decimal.js 로만 한다.
 * 재무 자료는 삭제하지 않고 상태로 관리, 기준정보는 deletedAt 소프트 삭제.
 */
import {
  pgTable, pgEnum, uuid, text, boolean, integer, timestamp, date, numeric, jsonb,
  bigserial, primaryKey, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 7, scale: 4 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const audited = {
  createdAt: ts('created_at').notNull().defaultNow(),
  createdById: uuid('created_by_id'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedById: uuid('updated_by_id'),
  version: integer('version').notNull().default(1),
};

// ───────────── 회사 ─────────────
export const companies = pgTable('company', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  bizRegNo: text('biz_reg_no').notNull().unique(),
  ceoName: text('ceo_name'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  businessType: text('business_type'),
  businessItem: text('business_item'),
  isActive: boolean('is_active').notNull().default(true),
  ...audited,
});

// ───────────── 사용자·세션 ─────────────
export const userStatus = pgEnum('user_status', ['ACTIVE', 'LOCKED', 'DISABLED']);

export const users = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  loginId: text('login_id').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: ts('password_changed_at').notNull().defaultNow(),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  status: userStatus('status').notNull().default('ACTIVE'),
  isSystemAdmin: boolean('is_system_admin').notNull().default(false),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecretEnc: text('mfa_secret_enc'),
  lastLoginAt: ts('last_login_at'),
  lastLoginIp: text('last_login_ip'),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  ...audited,
});

export const userSessions = pgTable('user_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  csrfHash: text('csrf_hash').notNull(),
  mfaPending: boolean('mfa_pending').notNull().default(false),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
}, (t) => [index('user_session_user_idx').on(t.userId)]);

// ───────────── 소속·역할·권한 ─────────────
export const dataScope = pgEnum('data_scope', ['COMPANY', 'ASSIGNED', 'CONFIRMED_ONLY']);

export const memberships = pgTable('membership', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  department: text('department'),
  position: text('position'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('membership_company_user_uq').on(t.companyId, t.userId)]);

export const roles = pgTable('role', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  scope: dataScope('scope').notNull().default('ASSIGNED'),
  isSystem: boolean('is_system').notNull().default(false),
  ...audited,
}, (t) => [uniqueIndex('role_company_key_uq').on(t.companyId, t.key)]);

export const rolePermissions = pgTable('role_permission', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
}, (t) => [primaryKey({ columns: [t.roleId, t.resource, t.action] })]);

export const membershipRoles = pgTable('membership_role', {
  membershipId: uuid('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.membershipId, t.roleId] })]);

// ───────────── 현장 ─────────────
export const tradeType = pgEnum('trade_type', ['ELECTRIC', 'TELECOM', 'BUILDING', 'COMPLEX']);
export const projectStatus = pgEnum('project_status', ['PLANNED', 'IN_PROGRESS', 'SUSPENDED', 'COMPLETED', 'SETTLED']);
export const contractRole = pgEnum('contract_role', ['PRIME', 'SUB', 'JOINT']);
export const clientSector = pgEnum('client_sector', ['PUBLIC', 'PRIVATE']);

export const projects = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  tradeType: tradeType('trade_type').notNull(),
  status: projectStatus('status').notNull().default('PLANNED'),
  contractRole: contractRole('contract_role').notNull().default('PRIME'),
  clientSector: clientSector('client_sector').notNull().default('PRIVATE'),
  clientName: text('client_name'),
  primeContractor: text('prime_contractor'),
  subContractor: text('sub_contractor'),
  siteAddress: text('site_address'),
  contractType: text('contract_type'),
  contractDate: date('contract_date'),
  startDate: date('start_date'),
  plannedEndDate: date('planned_end_date'),
  actualEndDate: date('actual_end_date'),
  supplyAmount: money('supply_amount').notNull().default('0'),
  vatAmount: money('vat_amount').notNull().default('0'),
  totalAmount: money('total_amount').notNull().default('0'),
  vatRate: rate('vat_rate').notNull(),
  executionBudget: money('execution_budget').notNull().default('0'),
  jointShareRate: rate('joint_share_rate'),
  progressRate: rate('progress_rate').notNull().default('0'),
  managerName: text('manager_name'),
  siteManagerName: text('site_manager_name'),
  memo: text('memo'),
  /** 발주처 거래처 (기성·수금 채권의 상대방) */
  clientVendorId: uuid('client_vendor_id'),
  /** 선급금 계약액 */
  advanceAmount: money('advance_amount').notNull().default('0'),
  /** 기본 유보율 (기성마다 바꿀 수 있음) */
  retentionRate: rate('retention_rate').notNull().default('0'),
  deletedAt: ts('deleted_at'),
  ...audited,
}, (t) => [
  uniqueIndex('project_company_code_uq').on(t.companyId, t.code),
  index('project_company_status_idx').on(t.companyId, t.status),
]);

export const projectAssignments = pgTable('project_assignment', {
  membershipId: uuid('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  roleInProject: text('role_in_project'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.membershipId, t.projectId] })]);

// ───────────── 거래처 ─────────────
export const vendorType = pgEnum('vendor_type', ['SUPPLIER', 'SUBCONTRACTOR', 'CLIENT', 'BOTH']);
export const vendorBizStatus = pgEnum('vendor_biz_status', ['UNKNOWN', 'ACTIVE', 'SUSPENDED', 'CLOSED']);

export const vendors = pgTable('vendor', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  vendorType: vendorType('vendor_type').notNull().default('SUPPLIER'),
  bizRegNo: text('biz_reg_no'),
  ceoName: text('ceo_name'),
  address: text('address'),
  businessType: text('business_type'),
  businessItem: text('business_item'),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  email: text('email'),
  phone: text('phone'),
  fax: text('fax'),
  bankName: text('bank_name'),
  bankAccountEnc: text('bank_account_enc'),
  bankAccountMask: text('bank_account_mask'),
  bankHolder: text('bank_holder'),
  paymentTerms: text('payment_terms'),
  bizStatus: vendorBizStatus('biz_status').notNull().default('UNKNOWN'),
  bizStatusCheckedAt: ts('biz_status_checked_at'),
  memo: text('memo'),
  deletedAt: ts('deleted_at'),
  ...audited,
}, (t) => [
  uniqueIndex('vendor_company_code_uq').on(t.companyId, t.code),
  index('vendor_company_name_idx').on(t.companyId, t.name),
]);

// ───────────── 파일 ─────────────
export const fileObjects = pgTable('file_object', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').references(() => projects.id),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  category: text('category').notNull(),
  originalName: text('original_name').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  createdById: uuid('created_by_id'),
  deletedAt: ts('deleted_at'),
}, (t) => [
  index('file_company_project_idx').on(t.companyId, t.projectId),
  index('file_company_vendor_idx').on(t.companyId, t.vendorId),
]);

// ───────────── 번호·설정 ─────────────
export const numberSequences = pgTable('number_sequence', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  key: text('key').notNull(),
  lastValue: integer('last_value').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.companyId, t.key] })]);

/** 부가세율 등 법정 요율은 코드에 고정하지 않고 적용기간별로 관리한다 */
export const taxRateSettings = pgTable('tax_rate_setting', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  rate: rate('rate').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  note: text('note'),
  verifiedBy: text('verified_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('tax_rate_key_from_uq').on(t.key, t.effectiveFrom)]);

export const systemSettings = pgTable('system_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const licenseState = pgTable('license_state', {
  id: integer('id').primaryKey().default(1),
  licenseText: text('license_text').notNull(),
  installedAt: ts('installed_at').notNull().defaultNow(),
});

// ───────────── 감사로그 (해시 체인, 트리거로 수정·삭제 차단) ─────────────
export const auditLogs = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  companyId: uuid('company_id').references(() => companies.id),
  userId: uuid('user_id'),
  userName: text('user_name'),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  resourceId: text('resource_id'),
  summary: text('summary'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull().unique(),
}, (t) => [
  index('audit_company_created_idx').on(t.companyId, t.createdAt),
  index('audit_resource_idx').on(t.resource, t.resourceId),
]);

// ═════════════════════════════ 2단계: 자재·발주·전자결재·검수 ═════════════════════════════
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const price = (name: string) => numeric(name, { precision: 18, scale: 4 });

export const taxType = pgEnum('tax_type', ['TAXABLE', 'EXEMPT', 'ZERO']); // 과세·면세·영세

// ───────────── 자재마스터 ─────────────
export const materials = pgTable('material', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  spec: text('spec'), // 규격
  maker: text('maker'), // 제조사
  unit: text('unit').notNull().default('EA'),
  category: text('category'), // 품목분류
  tradeType: text('trade_type'), // 관련 공종 (ELECTRIC/TELECOM/BUILDING/COMMON)
  defaultPrice: price('default_price').notNull().default('0'), // 기본 매입단가 (공급가, 부가세 별도)
  taxType: taxType('tax_type').notNull().default('TAXABLE'),
  memo: text('memo'),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: ts('deleted_at'),
  ...audited,
}, (t) => [
  uniqueIndex('material_company_code_uq').on(t.companyId, t.code),
  index('material_company_name_idx').on(t.companyId, t.name),
]);

/** 거래처별 최근 매입단가 — 발주 승인 시 갱신 */
export const vendorPrices = pgTable('vendor_price', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  materialId: uuid('material_id').notNull().references(() => materials.id),
  unitPrice: price('unit_price').notNull(),
  lastOrderId: uuid('last_order_id'),
  lastOrderDate: date('last_order_date'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.vendorId, t.materialId] })]);

// ───────────── 전자결재 ─────────────
export const approvalStatus = pgEnum('approval_status', ['PENDING', 'HOLD', 'APPROVED', 'REJECTED', 'CANCELLED']);
export const stepState = pgEnum('approval_step_state', ['WAITING', 'APPROVED', 'REJECTED', 'HOLD', 'SKIPPED']);

/** 결재선 설정: 문서 종류·금액 구간별 단계 (단계는 역할로 지정) */
export const approvalLines = pgTable('approval_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  docType: text('doc_type').notNull(),
  minAmount: money('min_amount').notNull().default('0'), // 이 금액(합계) 이상에 적용
  steps: jsonb('steps').$type<{ title: string; roleKey?: string | null; userId?: string | null }[]>().notNull(),
  ...audited,
}, (t) => [uniqueIndex('approval_line_uq').on(t.companyId, t.docType, t.minAmount)]);

export const approvals = pgTable('approval', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  docType: text('doc_type').notNull(),
  docId: uuid('doc_id').notNull(),
  docCode: text('doc_code'),
  title: text('title').notNull(),
  amount: money('amount').notNull().default('0'),
  projectId: uuid('project_id').references(() => projects.id),
  status: approvalStatus('status').notNull().default('PENDING'),
  currentStep: integer('current_step').notNull().default(1),
  drafterId: uuid('drafter_id').notNull(),
  drafterName: text('drafter_name').notNull(),
  submittedAt: ts('submitted_at').notNull().defaultNow(),
  completedAt: ts('completed_at'),
  version: integer('version').notNull().default(1),
}, (t) => [
  index('approval_company_status_idx').on(t.companyId, t.status),
  index('approval_doc_idx').on(t.docType, t.docId),
]);

export const approvalSteps = pgTable('approval_step', {
  id: uuid('id').primaryKey().defaultRandom(),
  approvalId: uuid('approval_id').notNull().references(() => approvals.id, { onDelete: 'cascade' }),
  stepNo: integer('step_no').notNull(), // 0 = 기안(담당)
  title: text('title').notNull(),
  roleKey: text('role_key'), // 이 역할을 가진 사람이 처리
  approverUserId: uuid('approver_user_id').references(() => users.id), // 지정된 사람만 처리 (있으면 역할보다 우선)
  approverNames: text('approver_names'), // 상신 시점의 해당 역할 보유자 (표시용)
  state: stepState('state').notNull().default('WAITING'),
  actedById: uuid('acted_by_id'),
  actedByName: text('acted_by_name'),
  actedAt: ts('acted_at'),
  comment: text('comment'),
}, (t) => [uniqueIndex('approval_step_uq').on(t.approvalId, t.stepNo)]);

// ───────────── 발주서 ─────────────
export const poStatus = pgEnum('po_status', ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED']);

export const purchaseOrders = pgTable('purchase_order', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  code: text('code').notNull(),
  revision: integer('revision').notNull().default(0), // 승인 후 재상신 횟수
  title: text('title').notNull(),
  orderDate: date('order_date').notNull(),
  deliveryDate: date('delivery_date'),
  deliveryPlace: text('delivery_place'),
  paymentTerms: text('payment_terms'),
  ourContact: text('our_contact'), // 당사 담당
  ourPhone: text('our_phone'),
  vendorContact: text('vendor_contact'),
  memo: text('memo'), // 특기사항
  status: poStatus('status').notNull().default('DRAFT'),
  supplyAmount: money('supply_amount').notNull().default('0'),
  vatAmount: money('vat_amount').notNull().default('0'),
  totalAmount: money('total_amount').notNull().default('0'),
  vatRate: rate('vat_rate').notNull(),
  approvalId: uuid('approval_id'),
  approvedAt: ts('approved_at'),
  sentAt: ts('sent_at'),
  costCodeId: uuid('cost_code_id'), // 원가항목 (기본: 재료비)
  requestId: uuid('request_id'), // 구매요청에서 만든 경우
  ...audited,
}, (t) => [
  uniqueIndex('po_company_code_uq').on(t.companyId, t.code),
  index('po_company_status_idx').on(t.companyId, t.status),
  index('po_project_idx').on(t.projectId),
]);

export const purchaseOrderLines = pgTable('purchase_order_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  materialId: uuid('material_id').references(() => materials.id),
  name: text('name').notNull(),
  spec: text('spec'),
  unit: text('unit').notNull(),
  qty: qty('qty').notNull(),
  unitPrice: price('unit_price').notNull(),
  supplyAmount: money('supply_amount').notNull(),
  vatAmount: money('vat_amount').notNull(),
  taxType: taxType('tax_type').notNull().default('TAXABLE'),
  receivedQty: qty('received_qty').notNull().default('0'),
  memo: text('memo'),
}, (t) => [uniqueIndex('po_line_uq').on(t.poId, t.lineNo)]);

// ───────────── 납품·검수 ─────────────
export const receiptStatus = pgEnum('receipt_status', ['CONFIRMED', 'CANCELLED']);

export const goodsReceipts = pgTable('goods_receipt', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  code: text('code').notNull(),
  receiptDate: date('receipt_date').notNull(),
  inspectorName: text('inspector_name'), // 검수자
  memo: text('memo'),
  status: receiptStatus('status').notNull().default('CONFIRMED'),
  supplyAmount: money('supply_amount').notNull().default('0'),
  vatAmount: money('vat_amount').notNull().default('0'),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
  ...audited,
}, (t) => [uniqueIndex('gr_company_code_uq').on(t.companyId, t.code), index('gr_po_idx').on(t.poId)]);

export const goodsReceiptLines = pgTable('goods_receipt_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id').notNull().references(() => goodsReceipts.id, { onDelete: 'cascade' }),
  poLineId: uuid('po_line_id').notNull().references(() => purchaseOrderLines.id),
  qty: qty('qty').notNull(),
  supplyAmount: money('supply_amount').notNull(),
  vatAmount: money('vat_amount').notNull(),
  note: text('note'),
});

// ═════════════════════════════ 2단계-B: 회계·지급결의·실행예산 ═════════════════════════════
export const accountType = pgEnum('account_type', ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);

/** 계정과목. category 는 재무제표 표시 구분 */
export const accounts = pgTable('account', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: accountType('type').notNull(),
  // CURRENT_ASSET / NONCURRENT_ASSET / CURRENT_LIABILITY / NONCURRENT_LIABILITY / EQUITY / SALES / CONSTRUCTION_COST / SGA / NON_OP_INCOME / NON_OP_EXPENSE / TAX
  category: text('category').notNull(),
  needsVendor: boolean('needs_vendor').notNull().default(false),
  needsProject: boolean('needs_project').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  memo: text('memo'),
  ...audited,
}, (t) => [uniqueIndex('account_company_code_uq').on(t.companyId, t.code)]);

/** 자동분개 규칙: 업무 이벤트가 쓸 계정 (회사별로 바꿀 수 있음) */
export const postingRules = pgTable('posting_rule', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  key: text('key').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedById: uuid('updated_by_id'),
}, (t) => [primaryKey({ columns: [t.companyId, t.key] })]);

/** 원가항목(공종별 비용 항목) → 공사원가 계정 */
export const costCodes = pgTable('cost_code', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  tradeType: text('trade_type'), // 비우면 전 공종 공통
  sortOrder: integer('sort_order').notNull().default(0),
  isSystem: boolean('is_system').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...audited,
}, (t) => [uniqueIndex('cost_code_company_code_uq').on(t.companyId, t.code)]);

// ───────────── 실행예산 ─────────────
export const projectBudgets = pgTable('project_budget', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  costCodeId: uuid('cost_code_id').notNull().references(() => costCodes.id),
  amount: money('amount').notNull().default('0'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.projectId, t.costCodeId] })]);

export const docStatus = pgEnum('doc_status', ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

/** 실행예산 편성·변경 — 결재 승인 시에만 예산에 반영 */
export const budgetRevisions = pgTable('budget_revision', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  code: text('code').notNull(),
  title: text('title').notNull(),
  reason: text('reason'),
  status: docStatus('status').notNull().default('DRAFT'),
  totalBefore: money('total_before').notNull().default('0'),
  totalAfter: money('total_after').notNull().default('0'),
  approvalId: uuid('approval_id'),
  approvedAt: ts('approved_at'),
  ...audited,
}, (t) => [uniqueIndex('budget_rev_code_uq').on(t.companyId, t.code), index('budget_rev_project_idx').on(t.projectId)]);

export const budgetRevisionLines = pgTable('budget_revision_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  revisionId: uuid('revision_id').notNull().references(() => budgetRevisions.id, { onDelete: 'cascade' }),
  costCodeId: uuid('cost_code_id').notNull().references(() => costCodes.id),
  beforeAmount: money('before_amount').notNull(),
  afterAmount: money('after_amount').notNull(),
  memo: text('memo'),
}, (t) => [uniqueIndex('budget_rev_line_uq').on(t.revisionId, t.costCodeId)]);

/** 예산 초과 경고 담당자 확인 */
export const budgetAlertAcks = pgTable('budget_alert_ack', {
  projectId: uuid('project_id').notNull().references(() => projects.id),
  costCodeId: uuid('cost_code_id').notNull().references(() => costCodes.id),
  level: text('level').notNull(), // WARN(90%) / OVER(초과)
  note: text('note'),
  ackedById: uuid('acked_by_id').notNull(),
  ackedByName: text('acked_by_name').notNull(),
  ackedAt: ts('acked_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.projectId, t.costCodeId, t.level] })]);

// ───────────── 구매요청 ─────────────
export const prStatus = pgEnum('purchase_request_status', ['REQUESTED', 'ORDERED', 'REJECTED', 'CANCELLED']);

export const purchaseRequests = pgTable('purchase_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  code: text('code').notNull(),
  title: text('title').notNull(),
  neededBy: date('needed_by'),
  requesterName: text('requester_name').notNull(),
  status: prStatus('status').notNull().default('REQUESTED'),
  poId: uuid('po_id'),
  memo: text('memo'),
  rejectReason: text('reject_reason'),
  ...audited,
}, (t) => [uniqueIndex('pr_company_code_uq').on(t.companyId, t.code), index('pr_project_idx').on(t.projectId)]);

export const purchaseRequestLines = pgTable('purchase_request_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => purchaseRequests.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  materialId: uuid('material_id').references(() => materials.id),
  name: text('name').notNull(),
  spec: text('spec'),
  unit: text('unit').notNull(),
  qty: qty('qty').notNull(),
  memo: text('memo'),
}, (t) => [uniqueIndex('pr_line_uq').on(t.requestId, t.lineNo)]);

// ───────────── 회계기간·전표 ─────────────
export const periodStatus = pgEnum('period_status', ['OPEN', 'CLOSED']);

export const accountingPeriods = pgTable('accounting_period', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  period: text('period').notNull(), // YYYY-MM
  status: periodStatus('status').notNull().default('OPEN'),
  closedAt: ts('closed_at'),
  closedById: uuid('closed_by_id'),
  closedByName: text('closed_by_name'),
  note: text('note'),
}, (t) => [primaryKey({ columns: [t.companyId, t.period] })]);

export const journalStatus = pgEnum('journal_status', ['DRAFT', 'APPROVED', 'REVERSED', 'VOID']);

export const journalEntries = pgTable('journal_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  entryDate: date('entry_date').notNull(),
  description: text('description').notNull(),
  status: journalStatus('status').notNull().default('DRAFT'),
  sourceType: text('source_type').notNull().default('MANUAL'),
  sourceId: uuid('source_id'),
  sourceCode: text('source_code'),
  purpose: text('purpose').notNull().default('MAIN'),
  reversalOfId: uuid('reversal_of_id'),
  reversedById: uuid('reversed_by_id'),
  totalDebit: money('total_debit').notNull().default('0'),
  totalCredit: money('total_credit').notNull().default('0'),
  approvedAt: ts('approved_at'),
  approvedById: uuid('approved_by_id'),
  approvedByName: text('approved_by_name'),
  voidReason: text('void_reason'),
  createdByName: text('created_by_name'),
  ...audited,
}, (t) => [
  uniqueIndex('je_company_code_uq').on(t.companyId, t.code),
  index('je_company_date_idx').on(t.companyId, t.entryDate),
  index('je_source_idx').on(t.sourceType, t.sourceId),
]);

export const journalLines = pgTable('journal_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  debit: money('debit').notNull().default('0'),
  credit: money('credit').notNull().default('0'),
  projectId: uuid('project_id').references(() => projects.id),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id),
  bankAccountId: uuid('bank_account_id'), // 예금·카드 출납장 구분
  memo: text('memo'),
}, (t) => [
  uniqueIndex('jl_entry_line_uq').on(t.entryId, t.lineNo),
  index('jl_account_idx').on(t.accountId),
  index('jl_project_idx').on(t.projectId),
  index('jl_vendor_idx').on(t.vendorId),
]);

// ───────────── 계좌·카드 (자금 출처) ─────────────
export const fundKind = pgEnum('fund_kind', ['BANK', 'CARD', 'CASH']);

export const bankAccounts = pgTable('bank_account', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  kind: fundKind('kind').notNull().default('BANK'),
  name: text('name').notNull(), // 별칭 (예: 국민 운영계좌)
  bankName: text('bank_name'),
  accountNoEnc: text('account_no_enc'),
  accountNoMask: text('account_no_mask'),
  holder: text('holder'),
  accountId: uuid('account_id').notNull().references(() => accounts.id), // 연결 계정 (보통예금·현금·미지급금(카드))
  openingBalance: money('opening_balance').notNull().default('0'),
  openingDate: date('opening_date'),
  isActive: boolean('is_active').notNull().default(true),
  memo: text('memo'),
  ...audited,
});

// ───────────── 지급결의·지급 ─────────────
export const payReqKind = pgEnum('payment_request_kind', ['PURCHASE', 'SUBCONTRACT', 'EXPENSE', 'LABOR', 'OTHER']);
export const payReqStatus = pgEnum('payment_request_status', ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED']);

export const paymentRequests = pgTable('payment_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  kind: payReqKind('kind').notNull(),
  title: text('title').notNull(),
  requestDate: date('request_date').notNull(),
  dueDate: date('due_date'),
  projectId: uuid('project_id').references(() => projects.id), // 비우면 본사 공통
  vendorId: uuid('vendor_id').references(() => vendors.id),
  payeeName: text('payee_name').notNull(),
  supplyAmount: money('supply_amount').notNull().default('0'),
  vatAmount: money('vat_amount').notNull().default('0'),
  totalAmount: money('total_amount').notNull().default('0'),
  status: payReqStatus('status').notNull().default('DRAFT'),
  approvalId: uuid('approval_id'),
  approvedAt: ts('approved_at'),
  paidAt: ts('paid_at'),
  memo: text('memo'),
  ...audited,
}, (t) => [
  uniqueIndex('payreq_company_code_uq').on(t.companyId, t.code),
  index('payreq_company_status_idx').on(t.companyId, t.status),
  index('payreq_project_idx').on(t.projectId),
]);

export const paymentRequestLines = pgTable('payment_request_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => paymentRequests.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  description: text('description').notNull(),
  accountId: uuid('account_id').references(() => accounts.id), // 경비성 지급의 비용 계정
  costCodeId: uuid('cost_code_id').references(() => costCodes.id),
  sourceType: text('source_type'), // RECEIPT / TAX_INVOICE / SUB_CLAIM / LABOR ...
  sourceId: uuid('source_id'),
  sourceCode: text('source_code'),
  /** 같은 원천(검수 등)을 두 번 지급 요청하지 못하게 — 진행 중인 결의에서만 값이 있다 */
  activeSourceKey: text('active_source_key'),
  supplyAmount: money('supply_amount').notNull(),
  vatAmount: money('vat_amount').notNull().default('0'),
  vatDeductible: boolean('vat_deductible').notNull().default(true),
  totalAmount: money('total_amount').notNull(),
}, (t) => [uniqueIndex('payreq_line_uq').on(t.requestId, t.lineNo), uniqueIndex('payreq_line_source_uq').on(t.activeSourceKey)]);

export const payMethod = pgEnum('payment_method', ['TRANSFER', 'CASH', 'CARD', 'BILL', 'OFFSET']);

export const payments = pgTable('payment', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  requestId: uuid('request_id').notNull().references(() => paymentRequests.id),
  payDate: date('pay_date').notNull(),
  amount: money('amount').notNull(),
  method: payMethod('method').notNull().default('TRANSFER'),
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
  memo: text('memo'),
  status: receiptStatus('status').notNull().default('CONFIRMED'),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
  ...audited,
}, (t) => [uniqueIndex('payment_company_code_uq').on(t.companyId, t.code), index('payment_request_idx').on(t.requestId)]);

// ═════════════════════════════ 3단계: 세금계산서·외부 연동·문서 스캔 ═════════════════════════════
/** 외부 연동 설정 — 비밀값은 암호화(secretsEnc), 화면에는 '설정됨'만 표시 */
export const integrationConfigs = pgTable('integration_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  kind: text('kind').notNull(), // TAX_ISSUE / HOMETAX / BIZ_STATUS / OCR / BANK
  provider: text('provider').notNull(), // POPBILL / BAROBILL / CODEF / NTS_OPENAPI / ANTHROPIC / CLOVA / BUILTIN / SANDBOX
  mode: text('mode').notNull().default('TEST'), // TEST / LIVE
  enabled: boolean('enabled').notNull().default(false),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  secretsEnc: text('secrets_enc'),
  secretKeys: jsonb('secret_keys').$type<string[]>().notNull().default([]), // 어떤 비밀값이 저장되어 있는지 (값 아님)
  lastTestAt: ts('last_test_at'),
  lastTestOk: boolean('last_test_ok'),
  lastTestMessage: text('last_test_message'),
  ...audited,
}, (t) => [uniqueIndex('integration_company_kind_uq').on(t.companyId, t.kind)]);

/** 외부 API 호출 기록 — 재시도·장애 추적 */
export const integrationJobs = pgTable('integration_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  kind: text('kind').notNull(),
  provider: text('provider').notNull(),
  mode: text('mode').notNull(),
  action: text('action').notNull(),
  status: text('status').notNull().default('RUNNING'), // RUNNING / SUCCESS / FAILED / WAITING_AUTH
  attempts: integer('attempts').notNull().default(0),
  summary: text('summary'),
  result: jsonb('result'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  createdById: uuid('created_by_id'),
  createdByName: text('created_by_name'),
}, (t) => [index('integration_job_company_idx').on(t.companyId, t.startedAt)]);

export const taxDirection = pgEnum('tax_direction', ['SALES', 'PURCHASE']);
export const taxInvoiceStatus = pgEnum('tax_invoice_status', [
  'COLLECTED', // 매입: 수집됨(미처리)
  'POSTED', // 매입: 확인·분개 완료
  'IGNORED', // 매입: 처리 제외 (중복·업무무관)
  'DRAFT', // 매출: 작성중
  'PENDING', // 매출: 발행 결재중
  'READY', // 매출: 결재 완료, 발행 대기
  'ISSUED', // 매출: 발행 완료 (국세청 전송 상태는 nts_status)
  'FAILED', // 매출: 발행 실패
  'CANCELLED',
]);

export const taxInvoices = pgTable('tax_invoice', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  direction: taxDirection('direction').notNull(),
  docKind: text('doc_kind').notNull().default('TAX'), // TAX 세금계산서 / EXEMPT 계산서
  invoiceType: text('invoice_type'), // 일반 / 영세율 / 위수탁 / 수입 ...
  status: taxInvoiceStatus('status').notNull(),
  code: text('code').notNull(), // 내부 관리번호 TI26-0001
  approvalNo: text('approval_no'), // 국세청 승인번호
  writeDate: date('write_date').notNull(), // 작성일자
  issueDate: date('issue_date'),
  sendDate: date('send_date'),
  purpose: text('purpose').notNull().default('CHARGE'), // CHARGE 청구 / RECEIPT 영수
  supplierBizNo: text('supplier_biz_no'),
  supplierName: text('supplier_name'),
  supplierCeo: text('supplier_ceo'),
  supplierAddress: text('supplier_address'),
  supplierBizType: text('supplier_biz_type'),
  supplierBizItem: text('supplier_biz_item'),
  supplierEmail: text('supplier_email'),
  buyerBizNo: text('buyer_biz_no'),
  buyerName: text('buyer_name'),
  buyerCeo: text('buyer_ceo'),
  buyerAddress: text('buyer_address'),
  buyerBizType: text('buyer_biz_type'),
  buyerBizItem: text('buyer_biz_item'),
  buyerEmail: text('buyer_email'),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  projectId: uuid('project_id').references(() => projects.id),
  supplyAmount: money('supply_amount').notNull(),
  vatAmount: money('vat_amount').notNull(),
  totalAmount: money('total_amount').notNull(),
  remark: text('remark'),
  modifyReason: text('modify_reason'), // 수정사유
  originalApprovalNo: text('original_approval_no'),
  source: text('source').notNull(), // HOMETAX / EXCEL / MANUAL / OCR / ISSUE
  provider: text('provider'),
  providerMode: text('provider_mode'), // TEST / LIVE — 테스트 발행은 법적 효력이 없다
  providerKey: text('provider_key'), // 연동사 문서관리번호
  ntsStatus: text('nts_status'), // NOT_SENT / WAITING / SENT / FAILED
  ntsMessage: text('nts_message'),
  dedupeKey: text('dedupe_key').notNull(),
  // 대사(발주·검수·기성과 비교)
  matchedSupply: money('matched_supply'),
  matchDiff: money('match_diff'),
  matchNote: text('match_note'),
  // 분개 설정 (매입: 업무와 무관한 경비성 계산서)
  accountId: uuid('account_id').references(() => accounts.id),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id),
  vatDeductible: boolean('vat_deductible').notNull().default(true),
  claimId: uuid('claim_id'), // 4단계 기성청구 연결 (매출)
  approvalId: uuid('approval_id'),
  raw: jsonb('raw'), // 연동사 원본 자료 (XML/JSON) 보관
  postedAt: ts('posted_at'),
  ignoredReason: text('ignored_reason'),
  ...audited,
}, (t) => [
  uniqueIndex('tax_invoice_code_uq').on(t.companyId, t.code),
  index('tax_invoice_company_dir_idx').on(t.companyId, t.direction, t.writeDate),
  index('tax_invoice_vendor_idx').on(t.vendorId),
]);

export const taxInvoiceLines = pgTable('tax_invoice_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => taxInvoices.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  itemDate: date('item_date'),
  name: text('name'),
  spec: text('spec'),
  qty: qty('qty'),
  unitPrice: price('unit_price'),
  supplyAmount: money('supply_amount').notNull(),
  vatAmount: money('vat_amount').notNull().default('0'),
  remark: text('remark'),
}, (t) => [uniqueIndex('tax_invoice_line_uq').on(t.invoiceId, t.lineNo)]);

/** 세금계산서 ↔ 검수·발주·기성 연결 (한 발주가 여러 계산서로, 한 계산서가 여러 검수를 묶어 발행될 수 있다) */
export const taxInvoiceMatches = pgTable('tax_invoice_match', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => taxInvoices.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(), // RECEIPT / CLAIM
  sourceId: uuid('source_id').notNull(),
  supplyAmount: money('supply_amount').notNull(),
  vatAmount: money('vat_amount').notNull().default('0'),
  createdAt: ts('created_at').notNull().defaultNow(),
  createdById: uuid('created_by_id'),
}, (t) => [uniqueIndex('tax_invoice_match_uq').on(t.invoiceId, t.sourceType, t.sourceId), index('tax_invoice_match_source_idx').on(t.sourceType, t.sourceId)]);

// ───────────── 문서 스캔 (OCR/AI) ─────────────
export const documentStatus = pgEnum('document_status', ['UPLOADED', 'EXTRACTED', 'FAILED', 'REGISTERED', 'REJECTED']);

export const documents = pgTable('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  docType: text('doc_type').notNull(), // ISSUED_PO 구매발주서 / RECEIVED_PO 수주발주서 / STATEMENT 거래명세표 / DELIVERY 자재납품서 / TAX_INVOICE / RECEIPT 영수증 / QUOTE 견적서
  fileId: uuid('file_id').notNull().references(() => fileObjects.id),
  fileSha256: text('file_sha256').notNull(),
  status: documentStatus('status').notNull().default('UPLOADED'),
  projectId: uuid('project_id').references(() => projects.id),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  provider: text('provider'),
  providerMode: text('provider_mode'),
  confidence: rate('confidence'),
  extracted: jsonb('extracted'), // 인식 원본 (수정 전)
  reviewed: jsonb('reviewed'), // 사용자 확인·수정본
  duplicateKey: text('duplicate_key'),
  duplicateOfId: uuid('duplicate_of_id'),
  registeredType: text('registered_type'), // PURCHASE_ORDER / TAX_INVOICE / PAYMENT_REQUEST / PROJECT_FILE
  registeredId: uuid('registered_id'),
  errorMessage: text('error_message'),
  rejectReason: text('reject_reason'),
  ...audited,
}, (t) => [uniqueIndex('document_code_uq').on(t.companyId, t.code), index('document_company_status_idx').on(t.companyId, t.status)]);


// ───────────── 4단계: 계약변경 · 기성 · 수금 · 하도급 · 노무 · 준공정산 ─────────────
/** 변경계약 — 최초계약(project.supply_amount)은 그대로 두고 증감만 쌓는다. 결재 전에는 확정 계약금액에 들어가지 않는다 */
export const contractRevisions = pgTable('contract_revision', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  code: text('code').notNull(),
  revisionNo: integer('revision_no').notNull(),
  revisionDate: date('revision_date').notNull(),
  reason: text('reason').notNull(),
  beforeSupply: money('before_supply').notNull(),
  deltaAmount: money('delta_amount').notNull(),
  afterSupply: money('after_supply').notNull(),
  vatRate: rate('vat_rate').notNull(),
  deltaVat: money('delta_vat').notNull(),
  beforeEndDate: date('before_end_date'),
  afterEndDate: date('after_end_date'),
  /** 승인 때 함께 만들 실행예산 조정안 [{costCodeId, delta}] — 실행예산은 별도 결재 */
  budgetLines: jsonb('budget_lines'),
  budgetRevisionId: uuid('budget_revision_id'),
  status: docStatus('status').notNull().default('DRAFT'),
  approvalId: uuid('approval_id'),
  approvedAt: ts('approved_at'),
  fileId: uuid('file_id'),
  ...audited,
}, (t) => [uniqueIndex('contract_revision_code_uq').on(t.companyId, t.code), index('contract_revision_project_idx').on(t.projectId)]);

export const claimStatus = pgEnum('claim_status', ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'INVOICED', 'PARTIAL', 'COLLECTED', 'CANCELLED']);

/** 기성청구 — 승인 시 매출 인식(공사수입), 세금계산서는 별도(부가세만), 수금은 collection */
export const progressClaims = pgTable('progress_claim', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  code: text('code').notNull(),
  claimNo: integer('claim_no').notNull(),
  claimDate: date('claim_date').notNull(),
  periodFrom: date('period_from'),
  periodTo: date('period_to'),
  dueDate: date('due_date'),
  contractSupply: money('contract_supply').notNull(),
  prevCumulative: money('prev_cumulative').notNull(),
  thisSupply: money('this_supply').notNull(),
  cumulative: money('cumulative').notNull(),
  progressRate: rate('progress_rate').notNull(),
  vatRate: rate('vat_rate').notNull(),
  vatAmount: money('vat_amount').notNull(),
  advanceDeduction: money('advance_deduction').notNull().default('0'),
  retentionRate: rate('retention_rate').notNull().default('0'),
  retentionAmount: money('retention_amount').notNull().default('0'),
  /** 받을 금액 = 금회 공급가 + 세액 − 선급금 공제 − 유보금 */
  receivableAmount: money('receivable_amount').notNull(),
  isFinal: boolean('is_final').notNull().default(false),
  status: claimStatus('status').notNull().default('DRAFT'),
  approvalId: uuid('approval_id'),
  approvedAt: ts('approved_at'),
  memo: text('memo'),
  ...audited,
}, (t) => [uniqueIndex('progress_claim_code_uq').on(t.companyId, t.code), index('progress_claim_project_idx').on(t.projectId)]);

export const progressClaimLines = pgTable('progress_claim_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimId: uuid('claim_id').notNull().references(() => progressClaims.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  name: text('name').notNull(),
  spec: text('spec'),
  unit: text('unit'),
  contractAmount: money('contract_amount').notNull().default('0'),
  prevAmount: money('prev_amount').notNull().default('0'),
  thisAmount: money('this_amount').notNull(),
  cumulativeAmount: money('cumulative_amount').notNull(),
}, (t) => [uniqueIndex('progress_claim_line_uq').on(t.claimId, t.lineNo)]);

export const collectionKind = pgEnum('collection_kind', ['ADVANCE', 'CLAIM', 'RETENTION', 'OTHER']);

/** 수금 — 매출(기성 승인)과 분리. 입금 확인 시 (예금 / 공사미수금·선수금·유보금) */
export const collections = pgTable('collection', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  claimId: uuid('claim_id').references(() => progressClaims.id),
  code: text('code').notNull(),
  kind: collectionKind('kind').notNull(),
  collectDate: date('collect_date').notNull(),
  amount: money('amount').notNull(),
  method: text('method').notNull().default('TRANSFER'),
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
  bankTransactionId: uuid('bank_transaction_id'),
  memo: text('memo'),
  status: text('status').notNull().default('CONFIRMED'), // CONFIRMED / CANCELLED
  cancelReason: text('cancel_reason'),
  ...audited,
}, (t) => [uniqueIndex('collection_code_uq').on(t.companyId, t.code), index('collection_project_idx').on(t.projectId), index('collection_claim_idx').on(t.claimId)]);

export const subcontractStatus = pgEnum('subcontract_status', ['DRAFT', 'PENDING', 'ACTIVE', 'REJECTED', 'COMPLETED', 'CANCELLED']);

/** 하도급·외주 계약 — 최초금액 보존, 변경은 subcontract_revision */
export const subcontracts = pgTable('subcontract', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  costCodeId: uuid('cost_code_id').notNull().references(() => costCodes.id),
  code: text('code').notNull(),
  title: text('title').notNull(),
  contractDate: date('contract_date').notNull(),
  startDate: date('start_date'),
  endDate: date('end_date'),
  originalAmount: money('original_amount').notNull(),
  currentAmount: money('current_amount').notNull(),
  vatRate: rate('vat_rate').notNull(),
  retentionRate: rate('retention_rate').notNull().default('0'),
  progressRate: rate('progress_rate').notNull().default('0'),
  guaranteeType: text('guarantee_type'),
  guaranteeNo: text('guarantee_no'),
  guaranteeAmount: money('guarantee_amount'),
  guaranteeExpiry: date('guarantee_expiry'),
  status: subcontractStatus('status').notNull().default('DRAFT'),
  approvalId: uuid('approval_id'),
  approvedAt: ts('approved_at'),
  completedAt: ts('completed_at'),
  scope: text('scope'),
  memo: text('memo'),
  ...audited,
}, (t) => [uniqueIndex('subcontract_code_uq').on(t.companyId, t.code), index('subcontract_project_idx').on(t.projectId)]);

export const subcontractRevisions = pgTable('subcontract_revision', {
  id: uuid('id').primaryKey().defaultRandom(),
  subcontractId: uuid('subcontract_id').notNull().references(() => subcontracts.id),
  revisionNo: integer('revision_no').notNull(),
  revisionDate: date('revision_date').notNull(),
  beforeAmount: money('before_amount').notNull(),
  deltaAmount: money('delta_amount').notNull(),
  afterAmount: money('after_amount').notNull(),
  reason: text('reason').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  createdById: uuid('created_by_id'),
}, (t) => [uniqueIndex('subcontract_revision_uq').on(t.subcontractId, t.revisionNo)]);

/** 하도급 기성 — 승인 시 (외주비·부가세대급금 / 외상매입금·하도급유보금) */
export const subClaims = pgTable('sub_claim', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  subcontractId: uuid('subcontract_id').notNull().references(() => subcontracts.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  code: text('code').notNull(),
  claimNo: integer('claim_no').notNull(),
  claimDate: date('claim_date').notNull(),
  prevCumulative: money('prev_cumulative').notNull(),
  thisAmount: money('this_amount').notNull(),
  cumulative: money('cumulative').notNull(),
  progressRate: rate('progress_rate').notNull(),
  vatAmount: money('vat_amount').notNull(),
  retentionAmount: money('retention_amount').notNull().default('0'),
  /** 지급할 금액 = 금회 + 세액 − 유보금 */
  payableAmount: money('payable_amount').notNull(),
  status: docStatus('status').notNull().default('DRAFT'),
  approvalId: uuid('approval_id'),
  approvedAt: ts('approved_at'),
  memo: text('memo'),
  ...audited,
}, (t) => [uniqueIndex('sub_claim_code_uq').on(t.companyId, t.code), index('sub_claim_sub_idx').on(t.subcontractId)]);

/** 작업자 — 주민번호·계좌는 암호화, 화면에는 가린 값만 */
export const laborWorkers = pgTable('labor_worker', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('DAILY'), // DAILY 일용 / STAFF 직원
  trade: text('trade'),
  phone: text('phone'),
  residentNoEnc: text('resident_no_enc'),
  residentNoMask: text('resident_no_mask'),
  bankName: text('bank_name'),
  bankAccountEnc: text('bank_account_enc'),
  bankAccountMask: text('bank_account_mask'),
  dailyWage: money('daily_wage').notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  memo: text('memo'),
  ...audited,
}, (t) => [uniqueIndex('labor_worker_code_uq').on(t.companyId, t.code)]);

export const laborRecords = pgTable('labor_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  workerId: uuid('worker_id').notNull().references(() => laborWorkers.id),
  costCodeId: uuid('cost_code_id').notNull().references(() => costCodes.id),
  workDate: date('work_date').notNull(),
  workType: text('work_type'),
  manDays: numeric('man_days', { precision: 6, scale: 2 }).notNull().default('1'), // 공수
  overtimeHours: numeric('overtime_hours', { precision: 6, scale: 2 }).notNull().default('0'),
  dailyWage: money('daily_wage').notNull(),
  overtimeRate: rate('overtime_rate').notNull().default('1.5'),
  amount: money('amount').notNull(),
  status: text('status').notNull().default('RECORDED'), // RECORDED / CONFIRMED / CANCELLED
  confirmedAt: ts('confirmed_at'),
  /** 함께 확정(분개)된 묶음 — 확정 취소 때 함께 되돌린다 */
  confirmBatchId: uuid('confirm_batch_id'),
  memo: text('memo'),
  ...audited,
}, (t) => [index('labor_record_project_idx').on(t.projectId, t.workDate), index('labor_record_worker_idx').on(t.workerId, t.workDate)]);

/** 준공정산 — 정산 시점의 숫자를 그대로 보관 */
export const projectSettlements = pgTable('project_settlement', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  settleDate: date('settle_date').notNull(),
  finalContract: money('final_contract').notNull(),
  totalClaimed: money('total_claimed').notNull(),
  totalCollected: money('total_collected').notNull(),
  receivable: money('receivable').notNull(),
  totalCost: money('total_cost').notNull(),
  totalPaid: money('total_paid').notNull(),
  unpaid: money('unpaid').notNull(),
  profit: money('profit').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  status: text('status').notNull().default('SETTLED'), // SETTLED / REOPENED
  memo: text('memo'),
  reopenReason: text('reopen_reason'),
  ...audited,
}, (t) => [index('project_settlement_project_idx').on(t.projectId)]);

// ───────────── 5단계: 통장·카드 거래 · API 키 · 웹훅 · 백업 ─────────────
/** 통장·카드 거래내역 (엑셀·CSV 업로드) — 입출금을 지급·수금·전표와 맞춘다 */
export const bankTransactions = pgTable('bank_transaction', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id),
  txDate: date('tx_date').notNull(),
  txTime: text('tx_time'),
  direction: text('direction').notNull(), // IN 입금 / OUT 출금
  amount: money('amount').notNull(),
  balance: money('balance'),
  description: text('description'),
  counterparty: text('counterparty'),
  memo: text('memo'),
  approvalNo: text('approval_no'), // 카드 승인번호
  dedupeKey: text('dedupe_key').notNull(),
  status: text('status').notNull().default('UNMATCHED'), // UNMATCHED / MATCHED / IGNORED
  matchedType: text('matched_type'), // PAYMENT / COLLECTION / JOURNAL
  matchedId: uuid('matched_id'),
  journalEntryId: uuid('journal_entry_id'),
  ignoreReason: text('ignore_reason'),
  importBatch: uuid('import_batch'),
  source: text('source').notNull().default('EXCEL'),
  ...audited,
}, (t) => [uniqueIndex('bank_tx_dedupe_uq').on(t.companyId, t.bankAccountId, t.dedupeKey), index('bank_tx_company_date_idx').on(t.companyId, t.txDate), index('bank_tx_status_idx').on(t.companyId, t.status)]);

/** 외부 프로그램용 API 키 — 원문은 발급 때 한 번만 보여 주고 해시만 저장 */
export const apiCredentials = pgTable('api_credential', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  userId: uuid('user_id').notNull().references(() => users.id), // 발급자 — 이 사람 권한을 넘을 수 없다
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  scopes: jsonb('scopes').notNull(), // ['vendor:read', 'project:read', ...]
  allowedIps: jsonb('allowed_ips'),
  expiresAt: ts('expires_at'),
  lastUsedAt: ts('last_used_at'),
  lastUsedIp: text('last_used_ip'),
  revokedAt: ts('revoked_at'),
  revokedReason: text('revoked_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('api_credential_hash_uq').on(t.keyHash), index('api_credential_company_idx').on(t.companyId)]);

/** Idempotency-Key — 같은 요청이 두 번 와도 한 번만 처리 */
export const apiIdempotency = pgTable('api_idempotency', {
  id: uuid('id').primaryKey().defaultRandom(),
  credentialId: uuid('credential_id').notNull().references(() => apiCredentials.id),
  idemKey: text('idem_key').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  bodyHash: text('body_hash').notNull(),
  statusCode: integer('status_code'),
  response: jsonb('response'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('api_idempotency_uq').on(t.credentialId, t.idemKey)]);

export const webhookEndpoints = pgTable('webhook_endpoint', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secretEnc: text('secret_enc').notNull(),
  events: jsonb('events').notNull(), // ['payment_request.pay', 'tax_invoice.*', '*']
  isActive: boolean('is_active').notNull().default(true),
  ...audited,
}, (t) => [index('webhook_endpoint_company_idx').on(t.companyId)]);

/** 웹훅 발송함 (Outbox) — 업무 트랜잭션과 함께 저장되고, 커밋된 것만 발송 */
export const webhookDeliveries = pgTable('webhook_delivery', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING / DELIVERED / FAILED
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  lastStatusCode: integer('last_status_code'),
  lastError: text('last_error'),
  deliveredAt: ts('delivered_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('webhook_delivery_pending_idx').on(t.status, t.nextAttemptAt), index('webhook_delivery_endpoint_idx').on(t.endpointId, t.createdAt)]);

export const backups = pgTable('backup_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(), // MANUAL / AUTO
  status: text('status').notNull().default('RUNNING'), // RUNNING / DONE / FAILED
  dbFile: text('db_file'),
  filesFile: text('files_file'),
  dbSize: integer('db_size'),
  filesSize: integer('files_size'),
  sha256: text('sha256'),
  verified: boolean('verified'),
  verifyMessage: text('verify_message'),
  errorMessage: text('error_message'),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  createdById: uuid('created_by_id'),
  createdByName: text('created_by_name'),
});
