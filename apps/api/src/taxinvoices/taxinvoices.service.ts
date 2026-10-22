/**
 * 전자세금계산서 — 매입 수집·대사·분개 / 매출 작성·결재·발행
 *  - 중복 수집 방지: 승인번호(없으면 내용 조합)로 회사·방향별 고유 (DB 부분 고유 인덱스)
 *  - 대사: 매입 계산서를 검수 내역과 연결해 공급가액 차이를 표시 (한 발주 → 여러 계산서, 한 계산서 → 여러 검수)
 *  - 세금계산서를 받았다고 지급완료가 되지 않는다. 분개는 (부가세대급금 / 외상매입금), 지급은 지급결의로 따로
 *  - 테스트 모드 발행은 법적 효력이 없으므로 국세청 전송완료로 표시하지 않고 분개도 하지 않는다
 */
import { BadRequestException, ConflictException, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext } from '../access/context';
import { LedgerService, PostLine } from '../accounting/ledger.service';
import { ApprovalsService } from '../approvals/approvals';
import { AuditService } from '../audit/audit.service';
import { isValidBizNo, normalizeBizNo } from '../common/bizno';
import { sha256 } from '../common/crypto';
import { notFound, staleVersion } from '../common/errors';
import { D, moneyStr, sumMoney } from '../common/money';
import { NumberingService, TaxRateService } from '../common/numbering.service';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { accounts, companies, costCodes, goodsReceipts, paymentRequestLines, projects, purchaseOrders, taxInvoiceLines, taxInvoiceMatches, taxInvoices, vendors } from '../db/schema';
import { IntegrationsService } from '../integrations/integrations';
import { CollectedInvoice, ProviderError } from '../integrations/types';
import { PaymentsService } from '../payments/payments';

type TI = typeof taxInvoices.$inferSelect;
export const TI_STATUS_LABEL: Record<TI['status'], string> = {
  COLLECTED: '미처리', POSTED: '처리완료', IGNORED: '제외', DRAFT: '작성중', PENDING: '결재중', READY: '발행대기', ISSUED: '발행', FAILED: '발행실패', CANCELLED: '취소',
};

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amt = z.union([z.string(), z.number()]).transform((v) => String(v ?? '').replace(/,/g, '').trim() || '0').refine((v) => /^-?\d{1,15}$/.test(v), '금액은 원 단위 정수');
const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const ManualInvoiceDto = z.object({
  direction: z.enum(['SALES', 'PURCHASE']),
  docKind: z.enum(['TAX', 'EXEMPT']).default('TAX'),
  approvalNo: z.string().trim().max(40).optional().nullable().transform((v) => (v ? v.replace(/\s/g, '') : null)),
  writeDate: dateStr,
  purpose: z.enum(['CHARGE', 'RECEIPT']).default('CHARGE'),
  vendorId: z.string().uuid('거래처를 선택해 주세요'),
  projectId: z.string().uuid().optional().nullable(),
  remark: optText(300),
  lines: z.array(z.object({
    itemDate: dateStr.optional().nullable().or(z.literal('').transform(() => null)),
    name: z.string().trim().min(1, '품목명을 입력해 주세요').max(100),
    spec: optText(60), qty: optText(20), unitPrice: optText(20),
    supplyAmount: amt, vatAmount: amt.default('0'), remark: optText(100),
  })).min(1, '품목을 하나 이상 입력해 주세요').max(99, '세금계산서 품목은 99개까지'),
});
export const PostDto = z.object({
  version: z.coerce.number().int(),
  projectId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  costCodeId: z.string().uuid().optional().nullable(),
  vatDeductible: z.boolean().default(true),
  matchNote: optText(300),
});
export const ListQuery = z.object({
  direction: z.enum(['SALES', 'PURCHASE']).default('PURCHASE'),
  status: z.string().max(20).optional(),
  from: dateStr.optional(), to: dateStr.optional(),
  vendorId: z.string().uuid().optional(), projectId: z.string().uuid().optional(),
  mismatch: z.enum(['1']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(500).default(50),
});

/** 같은 문서를 알아보는 키 — 승인번호가 있으면 승인번호, 없으면 내용 조합 */
export function dedupeKey(direction: string, inv: { approvalNo?: string | null; supplierBizNo?: string | null; buyerBizNo?: string | null; writeDate: string; supplyAmount: string; vatAmount: string; firstItem?: string | null }) {
  if (inv.approvalNo) return `NTS:${inv.approvalNo.replace(/[^0-9A-Za-z]/g, '')}`;
  return 'H:' + sha256([direction, inv.supplierBizNo ?? '', inv.buyerBizNo ?? '', inv.writeDate, D(inv.supplyAmount).toFixed(0), D(inv.vatAmount).toFixed(0), (inv.firstItem ?? '').trim()].join('|')).slice(0, 40);
}

/** 홈택스 '전자세금계산서 목록' 엑셀 (매출·매입 공통) 읽기 */
export async function parseHometaxExcel(buf: Buffer): Promise<{ invoices: CollectedInvoice[]; errors: { row: number; message: string }[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new BadRequestException({ code: 'EMPTY_FILE', message: '엑셀 시트가 없습니다' });
  const text = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text);
    if (typeof v === 'object' && v && 'result' in v) return String((v as { result: unknown }).result);
    return String(v).trim();
  };
  let headerRow = 0;
  let headers: string[] = [];
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const vals = (row.values as unknown[]).slice(1).map((v) => text(v).replace(/\s/g, ''));
    if (vals.some((v) => v.includes('승인번호')) && vals.some((v) => v.includes('공급가액'))) {
      headerRow = n;
      headers = vals;
    }
  });
  if (!headerRow) throw new BadRequestException({ code: 'NOT_HOMETAX', message: '홈택스 세금계산서 목록 엑셀이 아닙니다 ("승인번호"·"공급가액" 머리글을 찾지 못했습니다)' });
  const idx = (pred: (h: string) => boolean, from = 0) => headers.findIndex((h, i) => i >= from && pred(h));
  const supStart = idx((h) => h.includes('공급자') && h.includes('등록번호'));
  const buyStart = idx((h) => h.includes('공급받는자') && h.includes('등록번호'));
  const after = (start: number, pred: (h: string) => boolean) => (start < 0 ? -1 : idx(pred, start + 1));
  const col = {
    writeDate: idx((h) => h === '작성일자'), approvalNo: idx((h) => h.includes('승인번호')), issueDate: idx((h) => h === '발급일자'), sendDate: idx((h) => h === '전송일자'),
    supBiz: supStart, supName: after(supStart, (h) => h === '상호'), supCeo: after(supStart, (h) => h.includes('대표자')), supAddr: after(supStart, (h) => h === '주소'),
    buyBiz: buyStart, buyName: after(buyStart, (h) => h === '상호'), buyCeo: after(buyStart, (h) => h.includes('대표자')), buyAddr: after(buyStart, (h) => h === '주소'),
    total: idx((h) => h === '합계금액'), supply: idx((h) => h === '공급가액'), vat: idx((h) => h === '세액'),
    kind: idx((h) => h.includes('분류')), type: idx((h) => h.includes('종류')), remark: idx((h) => h === '비고'), purpose: idx((h) => h.includes('영수') || h.includes('청구')),
    supEmail: idx((h) => h.includes('공급자이메일')), buyEmail: idx((h) => h.includes('공급받는자이메일')),
    itemDate: idx((h) => h === '품목일자'), itemName: idx((h) => h === '품목명'), itemSpec: idx((h) => h === '품목규격'), itemQty: idx((h) => h === '품목수량'),
    itemPrice: idx((h) => h === '품목단가'), itemSupply: idx((h) => h === '품목공급가액'), itemVat: idx((h) => h === '품목세액'), itemRemark: idx((h) => h === '품목비고'),
  };
  for (const k of ['writeDate', 'supply', 'vat', 'supBiz', 'buyBiz'] as const) if (col[k] < 0) throw new BadRequestException({ code: 'MISSING_COLUMN', message: `필수 열을 찾지 못했습니다: ${{ writeDate: '작성일자', supply: '공급가액', vat: '세액', supBiz: '공급자사업자등록번호', buyBiz: '공급받는자사업자등록번호' }[k]}` });
  const invoices: CollectedInvoice[] = [];
  const errors: { row: number; message: string }[] = [];
  const num = (v: string) => v.replace(/[^0-9.-]/g, '') || '0';
  const isoDate = (v: string) => {
    const d = v.replace(/[^0-9]/g, '');
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
  };
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const v = (row.values as unknown[]).slice(1).map(text);
    const g = (i: number) => (i >= 0 ? v[i] ?? '' : '');
    if (!g(col.writeDate) && !g(col.approvalNo)) return;
    const writeDate = isoDate(g(col.writeDate));
    if (!writeDate) return void errors.push({ row: n, message: '작성일자 형식이 올바르지 않습니다' });
    const supply = num(g(col.supply)), vat = num(g(col.vat));
    const total = col.total >= 0 && g(col.total) ? num(g(col.total)) : String(Number(supply) + Number(vat));
    if (!D(supply).plus(vat).eq(total)) return void errors.push({ row: n, message: `합계금액(${total})이 공급가액+세액과 다릅니다` });
    const kindText = g(col.kind) + g(col.type);
    invoices.push({
      approvalNo: g(col.approvalNo).replace(/\s/g, '') || null, writeDate, issueDate: isoDate(g(col.issueDate)), sendDate: isoDate(g(col.sendDate)),
      invoiceType: g(col.type) || null, docKind: /계산서/.test(kindText) && !/세금/.test(kindText) ? 'EXEMPT' : 'TAX', purpose: g(col.purpose).includes('영수') ? 'RECEIPT' : 'CHARGE',
      supplier: { bizNo: g(col.supBiz).replace(/\D/g, ''), name: g(col.supName), ceo: g(col.supCeo), address: g(col.supAddr), email: g(col.supEmail) },
      buyer: { bizNo: g(col.buyBiz).replace(/\D/g, ''), name: g(col.buyName), ceo: g(col.buyCeo), address: g(col.buyAddr), email: g(col.buyEmail) },
      supplyAmount: supply, vatAmount: vat, totalAmount: total, remark: g(col.remark) || null,
      lines: col.itemName >= 0 && g(col.itemName) ? [{ itemDate: isoDate(g(col.itemDate)), name: g(col.itemName), spec: g(col.itemSpec) || null, qty: g(col.itemQty) || null, unitPrice: g(col.itemPrice) || null, supplyAmount: num(g(col.itemSupply) || supply), vatAmount: num(g(col.itemVat) || vat), remark: g(col.itemRemark) || null }] : [],
      raw: { row: n, values: v },
    });
  });
  return { invoices, errors };
}

@Injectable()
export class TaxInvoicesService implements OnModuleInit {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly taxRates: TaxRateService,
    private readonly ledger: LedgerService,
    private readonly approvals: ApprovalsService,
    private readonly payments: PaymentsService,
    private readonly integrations: IntegrationsService,
  ) {}

  onModuleInit() {
    this.approvals.register('TAX_ISSUE', {
      resource: 'taxinvoice',
      href: (id) => `/tax-invoices/${id}`,
      onApproved: async (tx, id) => {
        await tx.update(taxInvoices).set({ status: 'READY', version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id));
      },
      onRejected: async (tx, id) => {
        await tx.update(taxInvoices).set({ status: 'DRAFT', approvalId: null, version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id));
      },
      onCancelled: async (tx, id) => {
        await tx.update(taxInvoices).set({ status: 'DRAFT', approvalId: null, version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id));
      },
    });
    // 경비성 매입 계산서(검수와 무관)를 지급결의에 넣을 수 있게
    this.payments.registerSource('TAX_INVOICE', {
      label: '세금계산서',
      payableRule: 'AP_OTHER',
      resolve: async (tx, ctx, ids) => {
        const rows = await tx.select().from(taxInvoices).where(and(inArray(taxInvoices.id, ids), eq(taxInvoices.companyId, ctx.companyId!)));
        if (rows.length !== ids.length) throw new BadRequestException({ code: 'BAD_SOURCE', message: '세금계산서를 찾을 수 없습니다' });
        const matched = await tx.select({ id: taxInvoiceMatches.invoiceId }).from(taxInvoiceMatches).where(inArray(taxInvoiceMatches.invoiceId, ids));
        for (const r of rows) {
          if (r.direction !== 'PURCHASE' || r.status !== 'POSTED') throw new BadRequestException({ code: 'NOT_POSTED', message: `${r.code}: 처리(분개)가 끝난 매입 세금계산서만 지급할 수 있습니다` });
          if (matched.some((m) => m.id === r.id)) throw new BadRequestException({ code: 'MATCHED_INVOICE', message: `${r.code}는 검수와 연결된 계산서입니다. 검수 내역으로 자재대금 결의를 하세요` });
        }
        return rows.map((r) => ({ id: r.id, code: r.code, description: `세금계산서 ${r.supplierName ?? ''} ${r.writeDate}${r.approvalNo ? ` (${r.approvalNo.slice(-8)})` : ''}`, projectId: r.projectId, vendorId: r.vendorId, costCodeId: r.costCodeId, supplyAmount: r.supplyAmount, vatAmount: r.vatAmount }));
      },
      available: async (ctx, q) => {
        const conds: SQL[] = [eq(taxInvoices.companyId, ctx.companyId!), eq(taxInvoices.direction, 'PURCHASE'), eq(taxInvoices.status, 'POSTED'),
          sql`not exists (select 1 from ${taxInvoiceMatches} m where m.invoice_id = ${taxInvoices.id})`,
          sql`not exists (select 1 from ${paymentRequestLines} l where l.active_source_key = 'TAX_INVOICE:' || ${taxInvoices.id}::text)`];
        if (q.vendorId) conds.push(eq(taxInvoices.vendorId, q.vendorId));
        if (q.projectId) conds.push(eq(taxInvoices.projectId, q.projectId));
        return this.db.select({ id: taxInvoices.id, code: taxInvoices.code, writeDate: taxInvoices.writeDate, supplierName: taxInvoices.supplierName, supplyAmount: taxInvoices.supplyAmount, vatAmount: taxInvoices.vatAmount, approvalNo: taxInvoices.approvalNo, projectId: taxInvoices.projectId })
          .from(taxInvoices).where(and(...conds)).orderBy(asc(taxInvoices.writeDate)).limit(300);
      },
    });
  }

  private scope(ctx: AccessContext): SQL {
    const c = eq(taxInvoices.companyId, ctx.companyId!);
    if (ctx.scope === 'ASSIGNED') return and(c, ctx.assignedProjectIds.length ? inArray(taxInvoices.projectId, ctx.assignedProjectIds) : sql`false`)!;
    if (ctx.scope === 'CONFIRMED_ONLY') return and(c, inArray(taxInvoices.status, ['POSTED', 'ISSUED']))!;
    return c;
  }

  private async load(ctx: AccessContext, id: string, tx: Tx | DB = this.db) {
    const [t] = await tx.select().from(taxInvoices).where(and(eq(taxInvoices.id, id), this.scope(ctx)));
    if (!t) throw notFound('세금계산서');
    return t;
  }

  private async company(companyId: string) {
    const [c] = await this.db.select().from(companies).where(eq(companies.id, companyId));
    return c;
  }

  // ───────── 목록·상세 ─────────
  async list(ctx: AccessContext, q: z.infer<typeof ListQuery>) {
    const conds: SQL[] = [this.scope(ctx), eq(taxInvoices.direction, q.direction)];
    if (q.status === 'OPEN') conds.push(inArray(taxInvoices.status, q.direction === 'PURCHASE' ? ['COLLECTED'] : ['DRAFT', 'PENDING', 'READY', 'FAILED']));
    else if (q.status) conds.push(eq(taxInvoices.status, q.status as TI['status']));
    else conds.push(ne(taxInvoices.status, 'CANCELLED'));
    if (q.from) conds.push(gte(taxInvoices.writeDate, q.from));
    if (q.to) conds.push(lte(taxInvoices.writeDate, q.to));
    if (q.vendorId) conds.push(eq(taxInvoices.vendorId, q.vendorId));
    if (q.projectId) conds.push(eq(taxInvoices.projectId, q.projectId));
    if (q.mismatch) conds.push(sql`${taxInvoices.matchDiff} is not null and ${taxInvoices.matchDiff} <> 0`);
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      conds.push(or(ilike(taxInvoices.supplierName, like), ilike(taxInvoices.buyerName, like), ilike(taxInvoices.approvalNo, like), ilike(taxInvoices.code, like), ilike(taxInvoices.supplierBizNo, like), ilike(taxInvoices.buyerBizNo, like))!);
    }
    const where = and(...conds);
    const [agg] = await this.db.select({
      count: sql<number>`count(*)::int`, supply: sql<string>`coalesce(sum(${taxInvoices.supplyAmount}),0)::text`, vat: sql<string>`coalesce(sum(${taxInvoices.vatAmount}),0)::text`, total: sql<string>`coalesce(sum(${taxInvoices.totalAmount}),0)::text`,
      open: sql<number>`count(*) filter (where ${taxInvoices.status} in ('COLLECTED','DRAFT','READY','FAILED'))::int`,
      mismatch: sql<number>`count(*) filter (where ${taxInvoices.matchDiff} is not null and ${taxInvoices.matchDiff} <> 0)::int`,
    }).from(taxInvoices).where(where);
    const rows = await this.db.select({ t: taxInvoices, projectName: projects.name, vendorName: vendors.name }).from(taxInvoices)
      .leftJoin(projects, eq(projects.id, taxInvoices.projectId)).leftJoin(vendors, eq(vendors.id, taxInvoices.vendorId))
      .where(where).orderBy(desc(taxInvoices.writeDate), desc(taxInvoices.code)).limit(q.size).offset((q.page - 1) * q.size);
    return {
      total: agg.count, page: q.page, size: q.size, sums: { supplyAmount: agg.supply, vatAmount: agg.vat, totalAmount: agg.total }, open: agg.open, mismatch: agg.mismatch,
      rows: rows.map(({ t, ...x }) => ({ ...this.present(t), ...x, raw: undefined })),
    };
  }

  present(t: TI) {
    const legal = t.direction === 'PURCHASE' || t.providerMode === 'LIVE';
    return { ...t, statusLabel: TI_STATUS_LABEL[t.status], counterpartName: t.direction === 'PURCHASE' ? t.supplierName : t.buyerName, counterpartBizNo: t.direction === 'PURCHASE' ? t.supplierBizNo : t.buyerBizNo, isTestIssue: t.direction === 'SALES' && !!t.provider && !legal };
  }

  async get(ctx: AccessContext, id: string) {
    const t = await this.load(ctx, id);
    const [lines, matches, [vendor], [project], state] = await Promise.all([
      this.db.select().from(taxInvoiceLines).where(eq(taxInvoiceLines.invoiceId, id)).orderBy(asc(taxInvoiceLines.lineNo)),
      this.db.select({ m: taxInvoiceMatches, code: goodsReceipts.code, receiptDate: goodsReceipts.receiptDate, receiptSupply: goodsReceipts.supplyAmount, poId: purchaseOrders.id, poCode: purchaseOrders.code, poTitle: purchaseOrders.title, projectName: projects.name })
        .from(taxInvoiceMatches).leftJoin(goodsReceipts, and(eq(taxInvoiceMatches.sourceType, 'RECEIPT'), eq(goodsReceipts.id, taxInvoiceMatches.sourceId)))
        .leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId)).leftJoin(projects, eq(projects.id, goodsReceipts.projectId))
        .where(eq(taxInvoiceMatches.invoiceId, id)),
      t.vendorId ? this.db.select({ id: vendors.id, name: vendors.name, bizRegNo: vendors.bizRegNo }).from(vendors).where(eq(vendors.id, t.vendorId)) : Promise.resolve([null]),
      t.projectId ? this.db.select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType }).from(projects).where(eq(projects.id, t.projectId)) : Promise.resolve([null]),
      t.direction === 'SALES' ? this.approvals.docState(ctx, 'TAX_ISSUE', id) : Promise.resolve({ approval: null, approvalHistory: [], canAct: false, canRecall: false }),
    ]);
    const journals = (await this.db.execute(sql`select id, code, status, entry_date, total_debit from journal_entry where company_id = ${ctx.companyId} and source_type = 'TAX_INVOICE' and source_id = ${id} order by created_at`)).rows;
    const paid = (await this.db.execute(sql`select r.id, r.code, r.status from payment_request_line l join payment_request r on r.id = l.request_id where l.source_type = 'TAX_INVOICE' and l.source_id = ${id} and r.status <> 'CANCELLED'`)).rows;
    return { ...this.present(t), lines, matches: matches.map(({ m, ...x }) => ({ ...m, ...x })), vendor, project, journals, paymentRequests: paid, ...state };
  }

  // ───────── 수집 저장 (중복 제외) ─────────
  async saveCollected(ctx: AccessContext, direction: 'SALES' | 'PURCHASE', list: CollectedInvoice[], source: 'HOMETAX' | 'EXCEL' | 'OCR', provider?: string) {
    const company = await this.company(ctx.companyId!);
    const vendorList = await this.db.select({ id: vendors.id, bizRegNo: vendors.bizRegNo }).from(vendors).where(and(eq(vendors.companyId, ctx.companyId!), isNull(vendors.deletedAt)));
    let inserted = 0, duplicates = 0, foreign = 0;
    const ids: string[] = [];
    for (const inv of list) {
      const ourSide = direction === 'PURCHASE' ? inv.buyer.bizNo : inv.supplier.bizNo;
      if (ourSide && company.bizRegNo && ourSide !== company.bizRegNo) {
        foreign++;
        continue;
      }
      const counterBiz = direction === 'PURCHASE' ? inv.supplier.bizNo : inv.buyer.bizNo;
      const vendorId = vendorList.find((v) => v.bizRegNo && v.bizRegNo === counterBiz)?.id ?? null;
      const key = dedupeKey(direction, { approvalNo: inv.approvalNo, supplierBizNo: inv.supplier.bizNo, buyerBizNo: inv.buyer.bizNo, writeDate: inv.writeDate, supplyAmount: inv.supplyAmount, vatAmount: inv.vatAmount, firstItem: inv.lines[0]?.name });
      const id = await this.db.transaction(async (tx) => {
        const code = await this.numbering.yearly(tx, ctx.companyId!, 'TI', inv.writeDate);
        const [row] = await tx.insert(taxInvoices).values({
          companyId: ctx.companyId!, direction, docKind: inv.docKind, invoiceType: inv.invoiceType ?? null, status: direction === 'PURCHASE' ? 'COLLECTED' : 'ISSUED', code,
          approvalNo: inv.approvalNo, writeDate: inv.writeDate, issueDate: inv.issueDate ?? null, sendDate: inv.sendDate ?? null, purpose: inv.purpose,
          supplierBizNo: inv.supplier.bizNo ?? null, supplierName: inv.supplier.name ?? null, supplierCeo: inv.supplier.ceo ?? null, supplierAddress: inv.supplier.address ?? null, supplierBizType: inv.supplier.bizType ?? null, supplierBizItem: inv.supplier.bizItem ?? null, supplierEmail: inv.supplier.email ?? null,
          buyerBizNo: inv.buyer.bizNo ?? null, buyerName: inv.buyer.name ?? null, buyerCeo: inv.buyer.ceo ?? null, buyerAddress: inv.buyer.address ?? null, buyerBizType: inv.buyer.bizType ?? null, buyerBizItem: inv.buyer.bizItem ?? null, buyerEmail: inv.buyer.email ?? null,
          vendorId, supplyAmount: moneyStr(inv.supplyAmount), vatAmount: moneyStr(inv.vatAmount), totalAmount: moneyStr(inv.totalAmount), remark: inv.remark ?? null, modifyReason: inv.modifyReason ?? null,
          source, provider: provider ?? null, providerMode: direction === 'SALES' ? 'LIVE' : null, ntsStatus: direction === 'SALES' && inv.approvalNo ? 'SENT' : null,
          dedupeKey: key, raw: (inv.raw ?? null) as never, createdById: ctx.user.id, updatedById: ctx.user.id,
        }).onConflictDoNothing().returning({ id: taxInvoices.id });
        if (!row) return null;
        if (inv.lines.length) await tx.insert(taxInvoiceLines).values(inv.lines.slice(0, 99).map((l, i) => ({ invoiceId: row.id, lineNo: i + 1, itemDate: l.itemDate ?? null, name: l.name ?? null, spec: l.spec ?? null, qty: l.qty && /^-?\d+(\.\d+)?$/.test(l.qty) ? l.qty : null, unitPrice: l.unitPrice && /^-?\d+(\.\d+)?$/.test(l.unitPrice) ? l.unitPrice : null, supplyAmount: moneyStr(l.supplyAmount), vatAmount: moneyStr(l.vatAmount), remark: l.remark ?? null })));
        return row.id;
      });
      if (id) {
        inserted++;
        ids.push(id);
      } else duplicates++;
    }
    await this.audit.fromCtx(ctx, { action: 'IMPORT', resource: 'tax_invoice', summary: `${direction === 'PURCHASE' ? '매입' : '매출'} 세금계산서 ${source === 'HOMETAX' ? '홈택스 수집' : source === 'EXCEL' ? '엑셀 등록' : '등록'} — 새로 ${inserted}건, 중복 제외 ${duplicates}건${foreign ? `, 다른 사업자 ${foreign}건 제외` : ''}` });
    return { inserted, duplicates, foreign, ids };
  }

  async importExcel(ctx: AccessContext, direction: 'SALES' | 'PURCHASE', buf: Buffer, dryRun: boolean) {
    const { invoices, errors } = await parseHometaxExcel(buf);
    if (dryRun || errors.length) {
      // 미리보기: 이미 있는 문서 표시
      const keys = invoices.map((inv) => dedupeKey(direction, { approvalNo: inv.approvalNo, supplierBizNo: inv.supplier.bizNo, buyerBizNo: inv.buyer.bizNo, writeDate: inv.writeDate, supplyAmount: inv.supplyAmount, vatAmount: inv.vatAmount, firstItem: inv.lines[0]?.name }));
      const existing = keys.length ? await this.db.select({ k: taxInvoices.dedupeKey }).from(taxInvoices).where(and(eq(taxInvoices.companyId, ctx.companyId!), eq(taxInvoices.direction, direction), inArray(taxInvoices.dedupeKey, keys), ne(taxInvoices.status, 'CANCELLED'))) : [];
      const dupes = new Set(existing.map((e) => e.k));
      return {
        dryRun: true, errors,
        rows: invoices.map((inv, i) => ({ approvalNo: inv.approvalNo, writeDate: inv.writeDate, counterpart: direction === 'PURCHASE' ? inv.supplier.name : inv.buyer.name, supplyAmount: inv.supplyAmount, vatAmount: inv.vatAmount, duplicate: dupes.has(keys[i]) })),
        summary: { total: invoices.length, duplicate: invoices.filter((_, i) => dupes.has(keys[i])).length, error: errors.length },
      };
    }
    return { dryRun: false, errors, ...(await this.saveCollected(ctx, direction, invoices, 'EXCEL')) };
  }

  /** 종이 세금계산서·OCR 결과 등 직접 등록 */
  async createManual(ctx: AccessContext, dto: z.infer<typeof ManualInvoiceDto>, source: 'MANUAL' | 'OCR' = 'MANUAL') {
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, dto.vendorId), eq(vendors.companyId, ctx.companyId!)));
    if (!v) throw new BadRequestException({ code: 'BAD_VENDOR', message: '거래처를 다시 선택해 주세요' });
    const c = await this.company(ctx.companyId!);
    const supply = sumMoney(dto.lines.map((l) => l.supplyAmount));
    const vat = sumMoney(dto.lines.map((l) => l.vatAmount));
    if (dto.docKind === 'EXEMPT' && D(vat).gt(0)) throw new BadRequestException({ code: 'EXEMPT_VAT', message: '면세 계산서에는 세액이 없어야 합니다' });
    const ours = { bizNo: c.bizRegNo, name: c.name, ceo: c.ceoName, address: c.address, bizType: c.businessType, bizItem: c.businessItem, email: c.email };
    const theirs = { bizNo: v.bizRegNo, name: v.name, ceo: v.ceoName, address: v.address, bizType: v.businessType, bizItem: v.businessItem, email: v.email };
    const sup = dto.direction === 'PURCHASE' ? theirs : ours;
    const buy = dto.direction === 'PURCHASE' ? ours : theirs;
    if (dto.direction === 'SALES' && !v.bizRegNo) throw new BadRequestException({ code: 'NEED_BIZNO', message: '공급받는자(거래처)의 사업자등록번호가 있어야 발행할 수 있습니다' });
    if (dto.projectId && !this.access.canSeeProject(ctx, dto.projectId)) throw new BadRequestException({ code: 'BAD_PROJECT', message: '현장을 다시 선택해 주세요' });
    return this.db.transaction(async (tx) => {
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'TI', dto.writeDate);
      const key = dto.direction === 'SALES' ? `OWN:${code}` : dedupeKey('PURCHASE', { approvalNo: dto.approvalNo, supplierBizNo: sup.bizNo, buyerBizNo: buy.bizNo, writeDate: dto.writeDate, supplyAmount: supply, vatAmount: vat, firstItem: dto.lines[0]?.name });
      const [t] = await tx.insert(taxInvoices).values({
        companyId: ctx.companyId!, direction: dto.direction, docKind: dto.docKind, status: dto.direction === 'PURCHASE' ? 'COLLECTED' : 'DRAFT', code, approvalNo: dto.direction === 'PURCHASE' ? dto.approvalNo : null,
        writeDate: dto.writeDate, purpose: dto.purpose,
        supplierBizNo: sup.bizNo, supplierName: sup.name, supplierCeo: sup.ceo, supplierAddress: sup.address, supplierBizType: sup.bizType, supplierBizItem: sup.bizItem, supplierEmail: sup.email,
        buyerBizNo: buy.bizNo, buyerName: buy.name, buyerCeo: buy.ceo, buyerAddress: buy.address, buyerBizType: buy.bizType, buyerBizItem: buy.bizItem, buyerEmail: buy.email,
        vendorId: v.id, projectId: dto.projectId ?? null, supplyAmount: supply, vatAmount: vat, totalAmount: moneyStr(D(supply).plus(vat)), remark: dto.remark,
        source, dedupeKey: key, createdById: ctx.user.id, updatedById: ctx.user.id,
      }).onConflictDoNothing().returning();
      if (!t) throw new ConflictException({ code: 'DUPLICATE_INVOICE', message: '이미 등록된 세금계산서입니다 (같은 승인번호 또는 같은 거래처·일자·금액)' });
      await tx.insert(taxInvoiceLines).values(dto.lines.map((l, i) => ({ invoiceId: t.id, lineNo: i + 1, itemDate: l.itemDate ?? null, name: l.name, spec: l.spec, qty: l.qty && /^-?\d+(\.\d+)?$/.test(l.qty.replace(/,/g, '')) ? l.qty.replace(/,/g, '') : null, unitPrice: l.unitPrice && /^-?\d+(\.\d+)?$/.test(l.unitPrice.replace(/,/g, '')) ? l.unitPrice.replace(/,/g, '') : null, supplyAmount: moneyStr(l.supplyAmount), vatAmount: moneyStr(l.vatAmount), remark: l.remark })));
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'tax_invoice', resourceId: t.id, summary: `${dto.direction === 'PURCHASE' ? '매입' : '매출'} 세금계산서 ${source === 'OCR' ? '스캔 등록' : '작성'} ${code} ${v.name} ${D(t.totalAmount).toFixed(0)}원` }, tx);
      return t;
    });
  }

  async updateDraft(ctx: AccessContext, id: string, dto: z.infer<typeof ManualInvoiceDto> & { version: number }) {
    const cur = await this.load(ctx, id);
    if (cur.direction !== 'SALES' || cur.status !== 'DRAFT') throw new ConflictException({ code: 'LOCKED', message: '작성중인 매출 세금계산서만 고칠 수 있습니다' });
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, dto.vendorId), eq(vendors.companyId, ctx.companyId!)));
    if (!v?.bizRegNo) throw new BadRequestException({ code: 'NEED_BIZNO', message: '공급받는자의 사업자등록번호가 필요합니다' });
    const supply = sumMoney(dto.lines.map((l) => l.supplyAmount));
    const vat = sumMoney(dto.lines.map((l) => l.vatAmount));
    return this.db.transaction(async (tx) => {
      const [t] = await tx.update(taxInvoices).set({
        writeDate: dto.writeDate, purpose: dto.purpose, docKind: dto.docKind, vendorId: v.id, projectId: dto.projectId ?? null, remark: dto.remark,
        buyerBizNo: v.bizRegNo, buyerName: v.name, buyerCeo: v.ceoName, buyerAddress: v.address, buyerBizType: v.businessType, buyerBizItem: v.businessItem, buyerEmail: v.email,
        supplyAmount: supply, vatAmount: vat, totalAmount: moneyStr(D(supply).plus(vat)), updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${taxInvoices.version} + 1`,
      }).where(and(eq(taxInvoices.id, id), eq(taxInvoices.version, dto.version), eq(taxInvoices.status, 'DRAFT'))).returning();
      if (!t) throw staleVersion();
      await tx.delete(taxInvoiceLines).where(eq(taxInvoiceLines.invoiceId, id));
      await tx.insert(taxInvoiceLines).values(dto.lines.map((l, i) => ({ invoiceId: id, lineNo: i + 1, itemDate: l.itemDate ?? null, name: l.name, spec: l.spec, qty: l.qty?.replace(/,/g, '') || null, unitPrice: l.unitPrice?.replace(/,/g, '') || null, supplyAmount: moneyStr(l.supplyAmount), vatAmount: moneyStr(l.vatAmount), remark: l.remark })));
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'tax_invoice', resourceId: id, summary: `매출 세금계산서 수정 ${t.code}` }, tx);
      return t;
    });
  }

  // ───────── 대사 (검수와 연결) ─────────
  async candidates(ctx: AccessContext, id: string) {
    const t = await this.load(ctx, id);
    if (t.direction !== 'PURCHASE' || !t.vendorId) return [];
    const rows = (await this.db.execute(sql`
      select gr.id, gr.code, gr.receipt_date, gr.supply_amount::text supply, gr.vat_amount::text vat, po.id po_id, po.code po_code, po.title po_title, p.name project_name, p.id project_id,
        coalesce((select sum(m.supply_amount) from tax_invoice_match m join tax_invoice t on t.id = m.invoice_id where m.source_type = 'RECEIPT' and m.source_id = gr.id and t.status <> 'CANCELLED' and t.id <> ${id}),0)::text used
      from goods_receipt gr join purchase_order po on po.id = gr.po_id join project p on p.id = gr.project_id
      where gr.company_id = ${ctx.companyId} and gr.status = 'CONFIRMED' and po.vendor_id = ${t.vendorId}
      order by abs(gr.receipt_date - ${t.writeDate}::date), gr.receipt_date desc limit 100`)).rows as { id: string; code: string; receipt_date: string; supply: string; vat: string; po_id: string; po_code: string; po_title: string; project_name: string; project_id: string; used: string }[];
    return rows.map((r) => ({ ...r, remaining: moneyStr(D(r.supply).minus(r.used)) })).filter((r) => D(r.remaining).gt(0));
  }

  /** 검수 연결 + 차이 계산. lines: [{receiptId, supplyAmount?}] — 금액을 비우면 남은 금액 전부 */
  async match(ctx: AccessContext, id: string, version: number, links: { receiptId: string; supplyAmount?: string | null }[], note?: string | null) {
    return this.db.transaction(async (tx) => {
      const t = await this.load(ctx, id, tx);
      if (t.direction !== 'PURCHASE') throw new BadRequestException({ code: 'NOT_PURCHASE', message: '매입 세금계산서만 검수와 연결합니다' });
      if (t.status !== 'COLLECTED') throw new ConflictException({ code: 'LOCKED', message: '처리 완료된 계산서는 처리 취소 후 연결을 바꿀 수 있습니다' });
      if (t.version !== version) throw staleVersion();
      await tx.delete(taxInvoiceMatches).where(eq(taxInvoiceMatches.invoiceId, id));
      let matched = D(0);
      if (links.length) {
        const grs = await tx.select({ gr: goodsReceipts, vendorId: purchaseOrders.vendorId }).from(goodsReceipts).innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId)).where(and(inArray(goodsReceipts.id, links.map((l) => l.receiptId)), eq(goodsReceipts.companyId, ctx.companyId!)));
        for (const l of links) {
          const g = grs.find((x) => x.gr.id === l.receiptId);
          if (!g) throw new BadRequestException({ code: 'BAD_RECEIPT', message: '검수 내역을 찾을 수 없습니다' });
          if (t.vendorId && g.vendorId !== t.vendorId) throw new BadRequestException({ code: 'VENDOR_MISMATCH', message: `${g.gr.code}은(는) 다른 거래처의 검수입니다` });
          const used = (await tx.execute(sql`select coalesce(sum(m.supply_amount),0)::text u from tax_invoice_match m join tax_invoice x on x.id = m.invoice_id where m.source_type = 'RECEIPT' and m.source_id = ${g.gr.id} and x.status <> 'CANCELLED'`)).rows[0] as { u: string };
          const rem = D(g.gr.supplyAmount).minus(used.u);
          const amount = l.supplyAmount ? D(l.supplyAmount) : rem;
          if (amount.lte(0)) throw new BadRequestException({ code: 'NO_REMAINING', message: `${g.gr.code}은(는) 이미 다른 계산서에 모두 연결되었습니다` });
          const vat = amount.eq(g.gr.supplyAmount) ? D(g.gr.vatAmount) : amount.mul(D(g.gr.vatAmount).div(D(g.gr.supplyAmount).eq(0) ? 1 : g.gr.supplyAmount)).toDecimalPlaces(0, 1);
          await tx.insert(taxInvoiceMatches).values({ invoiceId: id, sourceType: 'RECEIPT', sourceId: g.gr.id, supplyAmount: moneyStr(amount), vatAmount: moneyStr(vat), createdById: ctx.user.id });
          matched = matched.plus(amount);
        }
        if (!t.projectId) {
          const pj = [...new Set(grs.map((g) => g.gr.projectId))];
          if (pj.length === 1) await tx.update(taxInvoices).set({ projectId: pj[0] }).where(eq(taxInvoices.id, id));
        }
      }
      const diff = links.length ? D(t.supplyAmount).minus(matched) : null;
      const [u] = await tx.update(taxInvoices).set({ matchedSupply: links.length ? moneyStr(matched) : null, matchDiff: diff ? moneyStr(diff) : null, matchNote: note ?? t.matchNote, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id)).returning();
      await this.audit.fromCtx(ctx, { action: 'MATCH', resource: 'tax_invoice', resourceId: id, summary: `세금계산서 ${t.code} 검수 ${links.length}건 연결${diff && !diff.eq(0) ? ` — 차이 ${diff.toFixed(0)}원` : diff ? ' — 금액 일치' : ' 해제'}` }, tx);
      return this.present(u);
    });
  }

  /** 자동 대사: 같은 거래처의 남은 검수 중 합계가 계산서 공급가액과 정확히 같은 조합을 찾는다 (최대 16건) */
  async autoMatch(ctx: AccessContext, id: string, version: number) {
    const t = await this.load(ctx, id);
    const cands = (await this.candidates(ctx, id)).slice(0, 16);
    const target = D(t.supplyAmount);
    let best: typeof cands | null = null;
    const n = cands.length;
    for (let mask = 1; mask < 1 << n && !best; mask++) {
      let s = D(0);
      const pick: typeof cands = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) (s = s.plus(cands[i].remaining)), pick.push(cands[i]);
      if (s.eq(target)) best = pick;
    }
    if (!best) {
      // 정확히 맞는 조합이 없으면 가장 가까운 1건
      const near = [...cands].sort((a, b) => D(a.remaining).minus(target).abs().cmp(D(b.remaining).minus(target).abs()))[0];
      if (!near) throw new BadRequestException({ code: 'NO_CANDIDATE', message: '이 거래처에 연결할 검수 내역이 없습니다' });
      return { exact: false, invoice: await this.match(ctx, id, version, [{ receiptId: near.id }]) };
    }
    return { exact: true, invoice: await this.match(ctx, id, version, best.map((b) => ({ receiptId: b.id }))) };
  }

  // ───────── 처리(분개) ─────────
  async post(ctx: AccessContext, id: string, dto: z.infer<typeof PostDto>) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from tax_invoice where id = ${id} for update`);
      const t = await this.load(ctx, id, tx);
      if (t.direction !== 'PURCHASE') throw new BadRequestException({ code: 'NOT_PURCHASE', message: '매입 세금계산서만 여기서 처리합니다' });
      if (t.status !== 'COLLECTED') throw new ConflictException({ code: 'ALREADY', message: `${TI_STATUS_LABEL[t.status]} 상태입니다` });
      if (t.version !== dto.version) throw staleVersion();
      if (!t.vendorId) throw new BadRequestException({ code: 'NEED_VENDOR', message: '공급자가 거래처에 등록되어 있지 않습니다. 먼저 거래처로 등록하세요' });
      const matches = await tx.select().from(taxInvoiceMatches).where(eq(taxInvoiceMatches.invoiceId, id));
      const vatIn = await this.ledger.ruleAccount(tx, ctx.companyId!, 'VAT_IN');
      const lines: PostLine[] = [];
      const deductible = dto.vatDeductible && t.docKind === 'TAX';
      const projectId = dto.projectId ?? t.projectId;
      if (matches.length) {
        // 검수 때 원가(공급가액)는 이미 잡혔다 → 세액만 채무에 더하고, 공급가액 차이는 원가 조정
        const apTrade = await this.ledger.ruleAccount(tx, ctx.companyId!, 'AP_TRADE');
        const grs = await tx.select({ gr: goodsReceipts, costCodeId: purchaseOrders.costCodeId }).from(goodsReceipts).innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId)).where(inArray(goodsReceipts.id, matches.map((m) => m.sourceId)));
        const first = grs[0];
        const costCodeId = first.costCodeId ?? (await this.ledger.defaultCostCode(tx, ctx.companyId!));
        const costAcc = await this.ledger.costAccount(tx, ctx.companyId!, costCodeId!);
        const diff = D(t.supplyAmount).minus(sumMoney(matches.map((m) => m.supplyAmount)));
        if (!diff.eq(0) && !dto.matchNote && !t.matchNote) throw new BadRequestException({ code: 'DIFF_NOTE_REQUIRED', message: `발주·검수 금액과 ${diff.abs().toFixed(0)}원 차이가 있습니다. 차이 원인을 적어 주세요 (예: 운반비 별도 청구, 단가 인상)` });
        if (D(t.vatAmount).gt(0)) {
          if (deductible) lines.push({ accountId: vatIn, debit: t.vatAmount, vendorId: t.vendorId, memo: `${t.code} 매입세액` });
          else lines.push({ accountId: costAcc, debit: t.vatAmount, projectId: first.gr.projectId, costCodeId, vendorId: t.vendorId, memo: `${t.code} 불공제 매입세액` });
          lines.push({ accountId: apTrade, credit: t.vatAmount, vendorId: t.vendorId, projectId: first.gr.projectId, memo: `${t.code} 세액` });
        }
        if (!diff.eq(0)) {
          lines.push(diff.gt(0)
            ? { accountId: costAcc, debit: diff, projectId: first.gr.projectId, costCodeId, vendorId: t.vendorId, memo: `계산서·검수 차이 ${dto.matchNote ?? t.matchNote ?? ''}` }
            : { accountId: costAcc, credit: diff.neg(), projectId: first.gr.projectId, costCodeId, vendorId: t.vendorId, memo: `계산서·검수 차이 ${dto.matchNote ?? t.matchNote ?? ''}` });
          lines.push(diff.gt(0) ? { accountId: apTrade, credit: diff, vendorId: t.vendorId, projectId: first.gr.projectId } : { accountId: apTrade, debit: diff.neg(), vendorId: t.vendorId, projectId: first.gr.projectId });
        }
      } else {
        // 경비성 계산서: (비용·부가세대급금 / 미지급금)
        let accountId = dto.accountId ?? t.accountId;
        let costCodeId = dto.costCodeId ?? t.costCodeId;
        if (costCodeId && !accountId) accountId = await this.ledger.costAccount(tx, ctx.companyId!, costCodeId);
        if (!accountId) throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: '검수와 연결하지 않는 계산서는 비용 계정(또는 원가항목)을 골라야 합니다' });
        const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, ctx.companyId!)));
        if (!acc) throw new BadRequestException({ code: 'BAD_ACCOUNT', message: '계정을 찾을 수 없습니다' });
        if (acc.needsProject && !projectId) throw new BadRequestException({ code: 'NEEDS_PROJECT', message: `${acc.name}은(는) 현장을 지정해야 합니다` });
        if (acc.category === 'CONSTRUCTION_COST' && !costCodeId) {
          const [cc] = await tx.select({ id: costCodes.id }).from(costCodes).where(and(eq(costCodes.companyId, ctx.companyId!), eq(costCodes.accountId, accountId))).limit(1);
          costCodeId = cc?.id ?? null;
        }
        const apOther = await this.ledger.ruleAccount(tx, ctx.companyId!, 'AP_OTHER');
        lines.push({ accountId, debit: deductible ? t.supplyAmount : t.totalAmount, projectId: acc.needsProject || acc.category === 'CONSTRUCTION_COST' ? projectId : projectId ?? null, costCodeId, vendorId: t.vendorId, memo: `${t.supplierName} 세금계산서` });
        if (deductible && D(t.vatAmount).gt(0)) lines.push({ accountId: vatIn, debit: t.vatAmount, vendorId: t.vendorId, memo: `${t.code} 매입세액` });
        lines.push({ accountId: apOther, credit: t.totalAmount, vendorId: t.vendorId, projectId, memo: `${t.supplierName} 세금계산서` });
        await tx.update(taxInvoices).set({ accountId, costCodeId }).where(eq(taxInvoices.id, id));
      }
      if (lines.length) await this.ledger.post(tx, ctx, { date: t.writeDate, description: `매입 세금계산서 ${t.supplierName ?? ''} ${t.code}`, sourceType: 'TAX_INVOICE', sourceId: id, sourceCode: t.code, lines });
      const [u] = await tx.update(taxInvoices).set({ status: 'POSTED', postedAt: new Date(), projectId, vatDeductible: deductible, matchNote: dto.matchNote ?? t.matchNote, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id)).returning();
      await this.audit.fromCtx(ctx, { action: 'POST', resource: 'tax_invoice', resourceId: id, summary: `매입 세금계산서 처리 ${t.code} ${t.supplierName} ${D(t.totalAmount).toFixed(0)}원${matches.length ? ` (검수 ${matches.length}건 연결)` : ' (경비)'}` }, tx);
      return this.present(u);
    });
  }

  async unpost(ctx: AccessContext, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const t = await this.load(ctx, id, tx);
      if (t.status !== 'POSTED') throw new ConflictException({ code: 'NOT_POSTED', message: '처리 완료 상태가 아닙니다' });
      const used = (await tx.execute(sql`select r.code from payment_request_line l join payment_request r on r.id = l.request_id where l.active_source_key = ${'TAX_INVOICE:' + id}`)).rows as { code: string }[];
      if (used.length) throw new ConflictException({ code: 'IN_PAYMENT', message: `지급결의 ${used[0].code}에 포함되어 있습니다. 결의를 먼저 취소하세요` });
      await this.ledger.reverseSource(tx, ctx, 'TAX_INVOICE', id, `세금계산서 처리 취소 — ${reason}`);
      const [u] = await tx.update(taxInvoices).set({ status: 'COLLECTED', postedAt: null, updatedById: ctx.user.id, version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id)).returning();
      await this.audit.fromCtx(ctx, { action: 'UNPOST', resource: 'tax_invoice', resourceId: id, summary: `세금계산서 처리 취소 ${t.code} — ${reason}` }, tx);
      return this.present(u);
    });
  }

  async ignore(ctx: AccessContext, id: string, reason: string, restore = false) {
    const t = await this.load(ctx, id);
    if (restore ? t.status !== 'IGNORED' : t.status !== 'COLLECTED') throw new ConflictException({ code: 'BAD_STATUS', message: '지금 상태에서는 할 수 없습니다' });
    const [u] = await this.db.update(taxInvoices).set({ status: restore ? 'COLLECTED' : 'IGNORED', ignoredReason: restore ? null : reason, updatedById: ctx.user.id, version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id)).returning();
    await this.audit.fromCtx(ctx, { action: restore ? 'RESTORE' : 'IGNORE', resource: 'tax_invoice', resourceId: id, summary: `세금계산서 ${restore ? '처리 대상으로 복원' : '처리 제외'} ${t.code}${restore ? '' : ` — ${reason}`}` });
    return this.present(u);
  }

  async setVendor(ctx: AccessContext, id: string, vendorId: string) {
    const t = await this.load(ctx, id);
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.companyId, ctx.companyId!)));
    if (!v) throw notFound('거래처');
    const counter = t.direction === 'PURCHASE' ? t.supplierBizNo : t.buyerBizNo;
    if (v.bizRegNo && counter && v.bizRegNo !== counter) throw new BadRequestException({ code: 'BIZNO_MISMATCH', message: `거래처 사업자번호(${v.bizRegNo})가 계산서(${counter})와 다릅니다` });
    const [u] = await this.db.update(taxInvoices).set({ vendorId, version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id)).returning();
    return this.present(u);
  }

  /** 계산서 공급자 정보로 거래처 바로 등록 */
  async createVendorFrom(ctx: AccessContext, id: string) {
    const t = await this.load(ctx, id);
    const biz = t.direction === 'PURCHASE' ? t.supplierBizNo : t.buyerBizNo;
    if (!biz || !isValidBizNo(normalizeBizNo(biz))) throw new BadRequestException({ code: 'BAD_BIZNO', message: '계산서의 사업자등록번호가 올바르지 않아 자동 등록할 수 없습니다' });
    const [exists] = await this.db.select().from(vendors).where(and(eq(vendors.companyId, ctx.companyId!), eq(vendors.bizRegNo, biz), isNull(vendors.deletedAt)));
    if (exists) return this.setVendor(ctx, id, exists.id);
    const p = t.direction === 'PURCHASE'
      ? { name: t.supplierName, ceo: t.supplierCeo, addr: t.supplierAddress, type: t.supplierBizType, item: t.supplierBizItem, email: t.supplierEmail }
      : { name: t.buyerName, ceo: t.buyerCeo, addr: t.buyerAddress, type: t.buyerBizType, item: t.buyerBizItem, email: t.buyerEmail };
    const v = await this.db.transaction(async (tx) => {
      const code = await this.numbering.vendorCode(tx, ctx.companyId!);
      const [v] = await tx.insert(vendors).values({ companyId: ctx.companyId!, code, name: p.name ?? biz, bizRegNo: biz, ceoName: p.ceo, address: p.addr, businessType: p.type, businessItem: p.item, email: p.email, vendorType: t.direction === 'PURCHASE' ? 'SUPPLIER' : 'CLIENT', createdById: ctx.user.id }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'vendor', resourceId: v.id, summary: `세금계산서 ${t.code}에서 거래처 등록 ${v.name}` }, tx);
      return v;
    });
    // 같은 사업자번호의 다른 미처리 계산서에도 연결
    await this.db.update(taxInvoices).set({ vendorId: v.id }).where(and(eq(taxInvoices.companyId, ctx.companyId!), isNull(taxInvoices.vendorId), t.direction === 'PURCHASE' ? eq(taxInvoices.supplierBizNo, biz) : eq(taxInvoices.buyerBizNo, biz)));
    return this.present((await this.load(ctx, id)));
  }

  // ───────── 매출 발행 ─────────
  async submit(ctx: AccessContext, id: string, version: number) {
    const t = await this.load(ctx, id);
    if (t.direction !== 'SALES' || t.status !== 'DRAFT') throw new ConflictException({ code: 'LOCKED', message: '작성중인 매출 세금계산서만 상신할 수 있습니다' });
    return this.db.transaction(async (tx) => {
      const [u] = await tx.update(taxInvoices).set({ status: 'PENDING', version: sql`${taxInvoices.version} + 1` }).where(and(eq(taxInvoices.id, id), eq(taxInvoices.version, version), eq(taxInvoices.status, 'DRAFT'))).returning();
      if (!u) throw staleVersion();
      const a = await this.approvals.submit(tx, ctx, { docType: 'TAX_ISSUE', docId: id, docCode: t.code, title: `[세금계산서 발행] ${t.buyerName} ${t.writeDate}`, amount: t.totalAmount, projectId: t.projectId });
      await tx.update(taxInvoices).set({ approvalId: a.id }).where(eq(taxInvoices.id, id));
      return { approvalId: a.id };
    });
  }

  /** 발행 — 결재가 끝난 계산서를 연동사로 보낸다 (권한 있는 사람의 최종 확인 필요) */
  async issue(ctx: AccessContext, id: string, version: number, confirmText: string) {
    const t = await this.load(ctx, id);
    if (t.direction !== 'SALES' || !['READY', 'FAILED'].includes(t.status)) throw new ConflictException({ code: 'NOT_READY', message: t.status === 'PENDING' ? '발행 결재가 끝나지 않았습니다' : `${TI_STATUS_LABEL[t.status]} 상태에서는 발행할 수 없습니다` });
    if (t.version !== version) throw staleVersion();
    const r = await this.integrations.require(ctx.companyId!, 'TAX_ISSUE');
    const legal = r.provider.isLegal(r.pc.mode);
    if (legal && confirmText !== t.buyerName) throw new BadRequestException({ code: 'CONFIRM_REQUIRED', message: `실제 발행(국세청 전송)을 하려면 확인 칸에 공급받는자 상호 '${t.buyerName}'을(를) 그대로 입력해 주세요` });
    const lines = await this.db.select().from(taxInvoiceLines).where(eq(taxInvoiceLines.invoiceId, id)).orderBy(asc(taxInvoiceLines.lineNo));
    const req = {
      mgtKey: t.code, writeDate: t.writeDate, purpose: t.purpose as 'CHARGE' | 'RECEIPT', taxType: (t.docKind === 'EXEMPT' ? 'EXEMPT' : D(t.vatAmount).eq(0) ? 'ZERO' : 'TAX') as 'TAX' | 'ZERO' | 'EXEMPT',
      supplier: { bizNo: t.supplierBizNo!, name: t.supplierName!, ceo: t.supplierCeo ?? '', address: t.supplierAddress, bizType: t.supplierBizType, bizItem: t.supplierBizItem, email: t.supplierEmail },
      buyer: { bizNo: t.buyerBizNo!, name: t.buyerName!, ceo: t.buyerCeo ?? '', address: t.buyerAddress, bizType: t.buyerBizType, bizItem: t.buyerBizItem, email: t.buyerEmail },
      supplyAmount: t.supplyAmount, vatAmount: t.vatAmount, totalAmount: t.totalAmount, remark: t.remark, modifyCode: null, originalApprovalNo: t.originalApprovalNo,
      lines: lines.map((l) => ({ lineNo: l.lineNo, itemDate: l.itemDate, name: l.name, spec: l.spec, qty: l.qty, unitPrice: l.unitPrice, supplyAmount: l.supplyAmount, vatAmount: l.vatAmount, remark: l.remark })),
    };
    try {
      const { value, jobId } = await this.integrations.run(ctx, 'TAX_ISSUE', r.providerId, r.pc.mode, 'ISSUE', () => r.provider.issue(r.pc, req), { summary: `${t.code} ${t.buyerName} ${D(t.totalAmount).toFixed(0)}원 발행`, resultOf: (v) => ({ approvalNo: v.approvalNo, ntsStatus: v.ntsStatus }) });
      const ntsStatus = legal ? value.ntsStatus : 'NOT_SENT';
      return await this.db.transaction(async (tx) => {
        const [u] = await tx.update(taxInvoices).set({
          status: 'ISSUED', issueDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), approvalNo: legal ? value.approvalNo : null,
          provider: r.providerId, providerMode: legal ? 'LIVE' : 'TEST', providerKey: value.providerKey, ntsStatus, ntsMessage: value.message ?? null, raw: { issue: value.raw ?? null, jobId } as never,
          updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${taxInvoices.version} + 1`,
        }).where(eq(taxInvoices.id, id)).returning();
        // 법적 효력이 있는 발행만 장부에 반영 (테스트·가상 발행은 분개하지 않는다)
        if (legal) await this.postSales(tx, ctx, u);
        await this.audit.fromCtx(ctx, { action: 'ISSUE', resource: 'tax_invoice', resourceId: id, summary: `매출 세금계산서 ${legal ? '발행' : '테스트(가상) 발행'} ${t.code} ${t.buyerName} ${D(t.totalAmount).toFixed(0)}원 · ${r.providerId}` }, tx);
        return this.present(u);
      });
    } catch (e) {
      if (e instanceof ProviderError || (e as { jobId?: string }).jobId) {
        await this.db.update(taxInvoices).set({ status: 'FAILED', ntsMessage: (e as Error).message.slice(0, 500), version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id));
        throw new BadRequestException({ code: 'ISSUE_FAILED', message: `발행 실패: ${(e as Error).message}` });
      }
      throw e;
    }
  }

  /** 매출 계산서 분개: 기성과 연결되면 매출은 기성 승인 때 인식되었으므로 세액만, 아니면 매출까지 */
  async postSales(tx: Tx, ctx: AccessContext, t: TI) {
    const ar = await this.ledger.ruleAccount(tx, ctx.companyId!, 'AR');
    const vatOut = await this.ledger.ruleAccount(tx, ctx.companyId!, 'VAT_OUT');
    const lines: PostLine[] = [];
    if (t.claimId) {
      if (D(t.vatAmount).gt(0)) lines.push({ accountId: ar, debit: t.vatAmount, vendorId: t.vendorId, projectId: t.projectId, memo: `${t.code} 매출세액` }, { accountId: vatOut, credit: t.vatAmount, memo: `${t.code} 매출세액` });
    } else {
      const rev = await this.ledger.ruleAccount(tx, ctx.companyId!, 'REVENUE');
      const [revAcc] = await tx.select().from(accounts).where(eq(accounts.id, rev));
      if (revAcc?.needsProject && !t.projectId) throw new BadRequestException({ code: 'NEEDS_PROJECT', message: '공사수입 계정은 현장을 지정해야 합니다. 계산서에 현장을 선택하세요' });
      lines.push({ accountId: ar, debit: t.totalAmount, vendorId: t.vendorId, projectId: t.projectId, memo: `${t.code} ${t.buyerName}` }, { accountId: rev, credit: t.supplyAmount, projectId: t.projectId, memo: `${t.code} ${t.buyerName}` });
      if (D(t.vatAmount).gt(0)) lines.push({ accountId: vatOut, credit: t.vatAmount, memo: `${t.code} 매출세액` });
    }
    if (lines.length) await this.ledger.post(tx, ctx, { date: t.writeDate, description: `매출 세금계산서 ${t.buyerName} ${t.code}`, sourceType: 'TAX_INVOICE', sourceId: t.id, sourceCode: t.code, lines });
  }

  async refreshStatus(ctx: AccessContext, id: string) {
    const t = await this.load(ctx, id);
    if (t.direction !== 'SALES' || t.status !== 'ISSUED' || !t.providerKey) throw new BadRequestException({ code: 'NOT_ISSUED', message: '발행된 매출 계산서가 아닙니다' });
    const r = await this.integrations.require(ctx.companyId!, 'TAX_ISSUE');
    if (r.providerId !== t.provider) throw new BadRequestException({ code: 'PROVIDER_CHANGED', message: `발행한 연동사(${t.provider})와 현재 설정(${r.providerId})이 다릅니다` });
    const { value } = await this.integrations.run(ctx, 'TAX_ISSUE', r.providerId, r.pc.mode, 'STATUS', () => r.provider.status(r.pc, t.providerKey!, t.supplierBizNo!), { summary: `${t.code} 국세청 전송상태 조회` });
    const ntsStatus = t.providerMode === 'LIVE' ? value.ntsStatus : 'NOT_SENT';
    const [u] = await this.db.update(taxInvoices).set({ ntsStatus, ntsMessage: value.message ?? null, approvalNo: t.providerMode === 'LIVE' ? value.approvalNo ?? t.approvalNo : null, sendDate: ntsStatus === 'SENT' ? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) : t.sendDate, version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id)).returning();
    return this.present(u);
  }

  async cancelIssue(ctx: AccessContext, id: string, reason: string) {
    const t = await this.load(ctx, id);
    if (t.direction !== 'SALES' || !['ISSUED', 'DRAFT', 'READY', 'FAILED'].includes(t.status)) throw new ConflictException({ code: 'BAD_STATUS', message: '취소할 수 없는 상태입니다' });
    if (t.status === 'ISSUED' && t.ntsStatus === 'SENT') throw new ConflictException({ code: 'NTS_SENT', message: '국세청 전송이 끝난 계산서는 취소할 수 없습니다. 수정세금계산서(계약의 해제 등)를 발행하세요' });
    if (t.status === 'ISSUED' && t.providerKey) {
      const r = await this.integrations.require(ctx.companyId!, 'TAX_ISSUE');
      await this.integrations.run(ctx, 'TAX_ISSUE', r.providerId, r.pc.mode, 'CANCEL', () => r.provider.cancel(r.pc, t.providerKey!, t.supplierBizNo!, reason), { summary: `${t.code} 발행 취소` });
    }
    return this.db.transaction(async (tx) => {
      await this.ledger.reverseSource(tx, ctx, 'TAX_INVOICE', id, `세금계산서 취소 — ${reason}`);
      const [u] = await tx.update(taxInvoices).set({ status: 'CANCELLED', ntsMessage: reason, version: sql`${taxInvoices.version} + 1` }).where(eq(taxInvoices.id, id)).returning();
      await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'tax_invoice', resourceId: id, summary: `매출 세금계산서 취소 ${t.code} — ${reason}` }, tx);
      return this.present(u);
    });
  }

  /** 발주 ↔ 검수 ↔ 세금계산서 대사표 */
  async reconcile(ctx: AccessContext, q: { vendorId?: string; projectId?: string; from?: string; to?: string; onlyDiff?: boolean }) {
    const rows = (await this.db.execute(sql`
      select po.id, po.code, po.title, po.order_date, po.status, po.supply_amount::text po_supply, v.id vendor_id, v.name vendor_name, p.id project_id, p.name project_name,
        coalesce((select sum(gr.supply_amount) from goods_receipt gr where gr.po_id = po.id and gr.status = 'CONFIRMED'),0)::text received,
        coalesce((select sum(m.supply_amount) from tax_invoice_match m join tax_invoice t on t.id = m.invoice_id join goods_receipt gr on gr.id = m.source_id
                  where m.source_type = 'RECEIPT' and gr.po_id = po.id and t.status <> 'CANCELLED'),0)::text invoiced,
        coalesce((select sum(t.supply_amount) from tax_invoice t where t.id in (select m.invoice_id from tax_invoice_match m join goods_receipt gr on gr.id = m.source_id where gr.po_id = po.id) and t.status <> 'CANCELLED'),0)::text invoice_total,
        (select string_agg(distinct t.code, ', ') from tax_invoice t join tax_invoice_match m on m.invoice_id = t.id join goods_receipt gr on gr.id = m.source_id where gr.po_id = po.id and t.status <> 'CANCELLED') invoice_codes,
        (select count(*) from tax_invoice t join tax_invoice_match m on m.invoice_id = t.id join goods_receipt gr on gr.id = m.source_id where gr.po_id = po.id and t.status <> 'CANCELLED' and t.match_diff <> 0)::int diff_invoices
      from purchase_order po join vendor v on v.id = po.vendor_id join project p on p.id = po.project_id
      where po.company_id = ${ctx.companyId} and po.status in ('APPROVED','SENT','PARTIAL','RECEIVED','CLOSED')
        ${q.vendorId ? sql`and po.vendor_id = ${q.vendorId}` : sql``} ${q.projectId ? sql`and po.project_id = ${q.projectId}` : sql``}
        ${q.from ? sql`and po.order_date >= ${q.from}` : sql``} ${q.to ? sql`and po.order_date <= ${q.to}` : sql``}
        ${ctx.scope === 'ASSIGNED' ? (ctx.assignedProjectIds.length ? sql`and po.project_id in (${sql.join(ctx.assignedProjectIds.map((i) => sql`${i}`), sql`, `)})` : sql`and false`) : sql``}
      order by po.order_date desc limit 300`)).rows as Record<string, string>[];
    const out = rows.map((r) => {
      const diffRecvInv = D(r.received).minus(r.invoiced);
      const diffPoRecv = D(r.po_supply).minus(r.received);
      const issues: string[] = [];
      if (Number(r.diff_invoices) > 0) issues.push('계산서 금액이 검수 금액과 다름');
      if (diffRecvInv.gt(0)) issues.push('검수했지만 계산서 미수취');
      if (diffRecvInv.lt(0)) issues.push('검수보다 많이 계산서 연결');
      if (diffPoRecv.gt(0) && ['RECEIVED', 'CLOSED'].includes(r.status) === false) issues.push('미입고 잔량');
      return { ...r, diffReceivedInvoiced: moneyStr(diffRecvInv), diffPoReceived: moneyStr(diffPoRecv), issues, ok: !issues.filter((i) => i !== '미입고 잔량').length };
    });
    return q.onlyDiff ? out.filter((r) => !r.ok) : out;
  }
}
