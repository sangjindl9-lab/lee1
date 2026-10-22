/**
 * 회사별 회계 기본값 — 계정과목, 원가항목, 자동분개 규칙, 결재선.
 * 회사를 만들 때와 서버 시작 시(seed) 호출된다. 이미 있는 값은 건드리지 않는다(멱등).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DB, Tx } from '../db/db';
import { accounts, approvalLines, costCodes, postingRules } from '../db/schema';

type AType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
interface Acc { code: string; name: string; type: AType; category: string; vendor?: boolean; project?: boolean }

/** 일반기업회계기준 기반 + 전문건설업 공사원가 계정 */
export const DEFAULT_ACCOUNTS: Acc[] = [
  // 유동자산
  { code: '101', name: '현금', type: 'ASSET', category: 'CURRENT_ASSET' },
  { code: '103', name: '보통예금', type: 'ASSET', category: 'CURRENT_ASSET' },
  { code: '108', name: '공사미수금', type: 'ASSET', category: 'CURRENT_ASSET', vendor: true, project: true },
  { code: '109', name: '공사유보금(미수)', type: 'ASSET', category: 'CURRENT_ASSET', vendor: true, project: true },
  { code: '110', name: '받을어음', type: 'ASSET', category: 'CURRENT_ASSET', vendor: true },
  { code: '120', name: '미수금', type: 'ASSET', category: 'CURRENT_ASSET', vendor: true },
  { code: '131', name: '선급금', type: 'ASSET', category: 'CURRENT_ASSET', vendor: true },
  { code: '134', name: '가지급금', type: 'ASSET', category: 'CURRENT_ASSET' },
  { code: '135', name: '부가세대급금', type: 'ASSET', category: 'CURRENT_ASSET' },
  { code: '136', name: '선납세금', type: 'ASSET', category: 'CURRENT_ASSET' },
  { code: '146', name: '원재료(저장품)', type: 'ASSET', category: 'CURRENT_ASSET' },
  // 비유동자산
  { code: '186', name: '계약이행보증금', type: 'ASSET', category: 'NONCURRENT_ASSET', vendor: true, project: true },
  { code: '187', name: '임차보증금', type: 'ASSET', category: 'NONCURRENT_ASSET' },
  { code: '208', name: '차량운반구', type: 'ASSET', category: 'NONCURRENT_ASSET' },
  { code: '209', name: '감가상각누계액(차량)', type: 'ASSET', category: 'NONCURRENT_ASSET' },
  { code: '212', name: '비품', type: 'ASSET', category: 'NONCURRENT_ASSET' },
  { code: '213', name: '감가상각누계액(비품)', type: 'ASSET', category: 'NONCURRENT_ASSET' },
  { code: '206', name: '공구와기구', type: 'ASSET', category: 'NONCURRENT_ASSET' },
  // 유동부채
  { code: '251', name: '외상매입금', type: 'LIABILITY', category: 'CURRENT_LIABILITY', vendor: true },
  { code: '252', name: '지급어음', type: 'LIABILITY', category: 'CURRENT_LIABILITY', vendor: true },
  { code: '253', name: '미지급금', type: 'LIABILITY', category: 'CURRENT_LIABILITY', vendor: true },
  { code: '254', name: '예수금', type: 'LIABILITY', category: 'CURRENT_LIABILITY' },
  { code: '255', name: '부가세예수금', type: 'LIABILITY', category: 'CURRENT_LIABILITY' },
  { code: '259', name: '공사선수금', type: 'LIABILITY', category: 'CURRENT_LIABILITY', vendor: true, project: true },
  { code: '260', name: '단기차입금', type: 'LIABILITY', category: 'CURRENT_LIABILITY' },
  { code: '262', name: '미지급비용', type: 'LIABILITY', category: 'CURRENT_LIABILITY' },
  { code: '264', name: '하도급유보금(미지급)', type: 'LIABILITY', category: 'CURRENT_LIABILITY', vendor: true, project: true },
  // 비유동부채
  { code: '293', name: '장기차입금', type: 'LIABILITY', category: 'NONCURRENT_LIABILITY' },
  { code: '295', name: '퇴직급여충당부채', type: 'LIABILITY', category: 'NONCURRENT_LIABILITY' },
  // 자본
  { code: '331', name: '자본금', type: 'EQUITY', category: 'EQUITY' },
  { code: '375', name: '이월이익잉여금', type: 'EQUITY', category: 'EQUITY' },
  // 매출
  { code: '404', name: '공사수입금', type: 'REVENUE', category: 'SALES', project: true },
  { code: '405', name: '기타매출', type: 'REVENUE', category: 'SALES' },
  // 공사원가 (현장별 보조원장 필수)
  { code: '501', name: '공사원가-재료비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '502', name: '공사원가-직접노무비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '503', name: '공사원가-간접노무비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '504', name: '공사원가-외주비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '505', name: '공사원가-장비사용료', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '506', name: '공사원가-운반비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '507', name: '공사원가-경비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '508', name: '공사원가-현장관리비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '509', name: '공사원가-안전관리비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '510', name: '공사원가-품질관리비', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '511', name: '공사원가-본사공통비배부', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  { code: '519', name: '공사원가-기타', type: 'EXPENSE', category: 'CONSTRUCTION_COST', project: true },
  // 판매비와관리비
  { code: '801', name: '급여', type: 'EXPENSE', category: 'SGA' },
  { code: '806', name: '퇴직급여', type: 'EXPENSE', category: 'SGA' },
  { code: '811', name: '복리후생비', type: 'EXPENSE', category: 'SGA' },
  { code: '812', name: '여비교통비', type: 'EXPENSE', category: 'SGA' },
  { code: '813', name: '접대비', type: 'EXPENSE', category: 'SGA' },
  { code: '814', name: '통신비', type: 'EXPENSE', category: 'SGA' },
  { code: '815', name: '수도광열비', type: 'EXPENSE', category: 'SGA' },
  { code: '817', name: '세금과공과', type: 'EXPENSE', category: 'SGA' },
  { code: '818', name: '감가상각비', type: 'EXPENSE', category: 'SGA' },
  { code: '819', name: '지급임차료', type: 'EXPENSE', category: 'SGA' },
  { code: '821', name: '보험료', type: 'EXPENSE', category: 'SGA' },
  { code: '822', name: '차량유지비', type: 'EXPENSE', category: 'SGA' },
  { code: '826', name: '도서인쇄비', type: 'EXPENSE', category: 'SGA' },
  { code: '830', name: '소모품비', type: 'EXPENSE', category: 'SGA' },
  { code: '831', name: '지급수수료', type: 'EXPENSE', category: 'SGA' },
  { code: '833', name: '광고선전비', type: 'EXPENSE', category: 'SGA' },
  // 영업외
  { code: '901', name: '이자수익', type: 'REVENUE', category: 'NON_OP_INCOME' },
  { code: '930', name: '잡이익', type: 'REVENUE', category: 'NON_OP_INCOME' },
  { code: '951', name: '이자비용', type: 'EXPENSE', category: 'NON_OP_EXPENSE' },
  { code: '980', name: '잡손실', type: 'EXPENSE', category: 'NON_OP_EXPENSE' },
  { code: '998', name: '법인세등', type: 'EXPENSE', category: 'TAX' },
];

/** 원가항목 (지시서 기본 12종) → 공사원가 계정 */
export const DEFAULT_COST_CODES: { code: string; name: string; account: string }[] = [
  { code: 'C01', name: '재료비', account: '501' },
  { code: 'C02', name: '직접노무비', account: '502' },
  { code: 'C03', name: '간접노무비', account: '503' },
  { code: 'C04', name: '외주·하도급비', account: '504' },
  { code: 'C05', name: '장비사용료', account: '505' },
  { code: 'C06', name: '운반비', account: '506' },
  { code: 'C07', name: '경비', account: '507' },
  { code: 'C08', name: '현장관리비', account: '508' },
  { code: 'C09', name: '안전관리비', account: '509' },
  { code: 'C10', name: '품질관리비', account: '510' },
  { code: 'C11', name: '본사공통비배부', account: '511' },
];

/** 자동분개 규칙 키 → 기본 계정 */
export const POSTING_RULES: { key: string; label: string; account: string; description: string }[] = [
  { key: 'AP_TRADE', label: '자재·외주 대금 채무', account: '251', description: '검수·하도급 기성 시 대변, 지급 시 차변' },
  { key: 'AP_OTHER', label: '경비 지급 채무', account: '253', description: '경비 지급결의 승인 시 대변, 지급 시 차변' },
  { key: 'VAT_IN', label: '매입 부가세', account: '135', description: '매입세금계산서 수취·공제 대상 경비' },
  { key: 'VAT_OUT', label: '매출 부가세', account: '255', description: '매출세금계산서 발행' },
  { key: 'AR', label: '공사 채권', account: '108', description: '기성 매출 인식 시 차변, 수금 시 대변' },
  { key: 'RETAINAGE_AR', label: '유보금 채권', account: '109', description: '기성 중 유보금' },
  { key: 'ADVANCE_RECEIVED', label: '공사선수금', account: '259', description: '선급금 수령 및 기성 정산' },
  { key: 'REVENUE', label: '공사 매출', account: '404', description: '기성 승인(매출 인식)' },
  { key: 'RETAINAGE_AP', label: '하도급 유보금', account: '264', description: '하도급 기성 중 유보' },
  { key: 'LABOR_PAYABLE', label: '노무비 미지급', account: '262', description: '노무비 확정 시 대변, 지급 시 차변' },
  { key: 'WITHHOLDING', label: '원천징수 예수금', account: '254', description: '노무비 원천세·4대보험' },
  { key: 'BANK_DEFAULT', label: '기본 출금 계좌 계정', account: '103', description: '계좌를 지정하지 않은 지급·수금' },
  { key: 'CASH', label: '현금', account: '101', description: '현금 지급' },
  { key: 'RETAINED_EARNINGS', label: '이월이익잉여금', account: '375', description: '연마감 손익 대체' },
];

const DEFAULT_APPROVAL_LINES: { docType: string; steps: { title: string; roleKey: string }[] }[] = [
  { docType: 'PURCHASE_ORDER', steps: [{ title: '승인', roleKey: 'CEO' }] },
  { docType: 'PAYMENT_REQUEST', steps: [{ title: '검토', roleKey: 'ACCOUNTING_MANAGER' }, { title: '승인', roleKey: 'CEO' }] },
  { docType: 'BUDGET', steps: [{ title: '승인', roleKey: 'CEO' }] },
];

export async function ensureAccountingDefaults(tx: Tx | DB, companyId: string, extraLines: { docType: string; steps: { title: string; roleKey: string }[] }[] = []) {
  const existing = await tx.select({ code: accounts.code, id: accounts.id }).from(accounts).where(eq(accounts.companyId, companyId));
  const have = new Map(existing.map((a) => [a.code, a.id]));
  const missing = DEFAULT_ACCOUNTS.filter((a) => !have.has(a.code));
  if (missing.length) {
    const rows = await tx
      .insert(accounts)
      .values(missing.map((a) => ({ companyId, code: a.code, name: a.name, type: a.type, category: a.category, needsVendor: !!a.vendor, needsProject: !!a.project, isSystem: true })))
      .returning({ code: accounts.code, id: accounts.id });
    for (const r of rows) have.set(r.code, r.id);
  }

  const cc = await tx.select({ code: costCodes.code }).from(costCodes).where(eq(costCodes.companyId, companyId));
  const ccHave = new Set(cc.map((c) => c.code));
  const ccMissing = DEFAULT_COST_CODES.filter((c) => !ccHave.has(c.code) && have.get(c.account));
  if (ccMissing.length) {
    await tx.insert(costCodes).values(ccMissing.map((c) => ({ companyId, code: c.code, name: c.name, accountId: have.get(c.account)!, sortOrder: DEFAULT_COST_CODES.indexOf(c) + 1, isSystem: true })));
  }

  const pr = await tx.select({ key: postingRules.key }).from(postingRules).where(eq(postingRules.companyId, companyId));
  const prHave = new Set(pr.map((p) => p.key));
  const prMissing = POSTING_RULES.filter((p) => !prHave.has(p.key) && have.get(p.account));
  if (prMissing.length) await tx.insert(postingRules).values(prMissing.map((p) => ({ companyId, key: p.key, accountId: have.get(p.account)! })));

  const all = [...DEFAULT_APPROVAL_LINES, ...extraLines];
  const lines = await tx.select({ docType: approvalLines.docType }).from(approvalLines).where(and(eq(approvalLines.companyId, companyId), inArray(approvalLines.docType, all.map((l) => l.docType))));
  const lHave = new Set(lines.map((l) => l.docType));
  const lMissing = all.filter((l) => !lHave.has(l.docType));
  if (lMissing.length) await tx.insert(approvalLines).values(lMissing.map((l) => ({ companyId, docType: l.docType, minAmount: '0', steps: l.steps })));
}
