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
  steps: jsonb('steps').$type<{ title: string; roleKey: string }[]>().notNull(),
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
