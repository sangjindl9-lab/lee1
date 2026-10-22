import { BadRequestException, ConflictException, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext } from '../access/context';
import { ApprovalsService } from '../approvals/approvals';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { D, moneyStr, sumMoney, toWon } from '../common/money';
import { NumberingService, TaxRateService } from '../common/numbering.service';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { companies, costCodes, goodsReceiptLines, goodsReceipts, materials, projects, purchaseOrderLines, purchaseOrders, purchaseRequests, vendorPrices, vendors } from '../db/schema';
import { LedgerService } from '../accounting/ledger.service';
import { CreatePo, ListPoQuery, ListReceiptQuery, ReceiptDto } from './purchase.dto';

type Po = typeof purchaseOrders.$inferSelect;
const EDITABLE = ['DRAFT', 'REJECTED'] as const;
const RECEIVABLE = ['APPROVED', 'SENT', 'PARTIAL'] as const;
export const PO_STATUS_LABEL: Record<Po['status'], string> = {
  DRAFT: '작성중', PENDING: '결재중', APPROVED: '승인', REJECTED: '반려', SENT: '발주전송', PARTIAL: '부분입고', RECEIVED: '입고완료', CLOSED: '종결', CANCELLED: '취소',
};

/** 수량 × 단가 → 공급가액(원 미만 절사), 과세 품목만 부가세 */
export function lineAmounts(qty: string, unitPrice: string, taxType: 'TAXABLE' | 'EXEMPT' | 'ZERO', vatRate: string) {
  const supply = toWon(D(qty).mul(unitPrice), 'DOWN');
  const vat = taxType === 'TAXABLE' ? toWon(supply.mul(vatRate), 'DOWN') : D(0);
  return { supplyAmount: moneyStr(supply), vatAmount: moneyStr(vat) };
}

@Injectable()
export class PurchaseService implements OnModuleInit {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly taxRates: TaxRateService,
    private readonly approvals: ApprovalsService,
    private readonly ledger: LedgerService,
  ) {}

  onModuleInit() {
    this.approvals.register('PURCHASE_ORDER', {
      resource: 'purchase',
      href: (id) => `/purchase-orders/${id}`,
      onApproved: async (tx, id, ctx) => {
        const [po] = await tx.update(purchaseOrders).set({ status: 'APPROVED', approvedAt: new Date(), version: sql`${purchaseOrders.version} + 1` }).where(eq(purchaseOrders.id, id)).returning();
        // 거래처별 최근 매입단가 갱신 (자재마스터와 연결된 품목만)
        const lines = await tx.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.poId, id), sql`${purchaseOrderLines.materialId} is not null`));
        for (const l of lines) {
          await tx
            .insert(vendorPrices)
            .values({ companyId: po.companyId, vendorId: po.vendorId, materialId: l.materialId!, unitPrice: l.unitPrice, lastOrderId: po.id, lastOrderDate: po.orderDate })
            .onConflictDoUpdate({ target: [vendorPrices.vendorId, vendorPrices.materialId], set: { unitPrice: l.unitPrice, lastOrderId: po.id, lastOrderDate: po.orderDate, updatedAt: new Date() } });
        }
        void ctx;
      },
      onRejected: async (tx, id) => {
        await tx.update(purchaseOrders).set({ status: 'REJECTED', version: sql`${purchaseOrders.version} + 1` }).where(eq(purchaseOrders.id, id));
      },
      onCancelled: async (tx, id) => {
        await tx.update(purchaseOrders).set({ status: 'DRAFT', approvalId: null, version: sql`${purchaseOrders.version} + 1` }).where(eq(purchaseOrders.id, id));
      },
    });
  }

  private scope(ctx: AccessContext): SQL {
    return and(eq(purchaseOrders.companyId, ctx.companyId!), this.access.projectScope(ctx, purchaseOrders.projectId))!;
  }

  private async load(ctx: AccessContext, id: string, tx: Tx | DB = this.db) {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), this.scope(ctx)));
    if (!po) throw notFound('발주서');
    return po;
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListPoQuery>) {
    const conds: SQL[] = [this.scope(ctx)];
    if (q.status === 'OPEN') conds.push(inArray(purchaseOrders.status, [...RECEIVABLE]));
    else if (q.status) conds.push(eq(purchaseOrders.status, q.status));
    else conds.push(sql`${purchaseOrders.status} <> 'CANCELLED'`);
    if (q.projectId) conds.push(eq(purchaseOrders.projectId, q.projectId));
    if (q.vendorId) conds.push(eq(purchaseOrders.vendorId, q.vendorId));
    if (q.from) conds.push(gte(purchaseOrders.orderDate, q.from));
    if (q.to) conds.push(lte(purchaseOrders.orderDate, q.to));
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      conds.push(or(ilike(purchaseOrders.code, like), ilike(purchaseOrders.title, like), ilike(vendors.name, like), ilike(projects.name, like))!);
    }
    const where = and(...conds);
    const base = this.db.select().from(purchaseOrders).innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId)).innerJoin(projects, eq(projects.id, purchaseOrders.projectId));
    const [agg] = await this.db
      .select({ count: sql<number>`count(*)::int`, supply: sql<string>`coalesce(sum(${purchaseOrders.supplyAmount}),0)::text`, vat: sql<string>`coalesce(sum(${purchaseOrders.vatAmount}),0)::text`, total: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}),0)::text` })
      .from(purchaseOrders).innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId)).innerJoin(projects, eq(projects.id, purchaseOrders.projectId)).where(where);
    const rows = await base.where(where).orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.code)).limit(q.size).offset((q.page - 1) * q.size);
    // 입고율 (공급가액 기준)
    const ids = rows.map((r) => r.purchase_order.id);
    const recv = ids.length
      ? await this.db
          .select({ poId: purchaseOrderLines.poId, received: sql<string>`coalesce(sum(round(${purchaseOrderLines.receivedQty} * ${purchaseOrderLines.unitPrice})),0)::text`, lines: sql<number>`count(*)::int` })
          .from(purchaseOrderLines).where(inArray(purchaseOrderLines.poId, ids)).groupBy(purchaseOrderLines.poId)
      : [];
    return {
      total: agg.count, page: q.page, size: q.size, sums: { supplyAmount: agg.supply, vatAmount: agg.vat, totalAmount: agg.total },
      rows: rows.map(({ purchase_order: p, vendor: v, project: pr }) => {
        const r = recv.find((x) => x.poId === p.id);
        return {
          ...p, vendorName: v.name, projectCode: pr.code, projectName: pr.name, tradeType: pr.tradeType, lineCount: r?.lines ?? 0,
          receivedRate: D(p.supplyAmount).gt(0) ? D(r?.received ?? 0).div(p.supplyAmount).toFixed(4) : '0',
        };
      }),
    };
  }

  async get(ctx: AccessContext, id: string) {
    const po = await this.load(ctx, id);
    const [lines, [vendor], [project], [company], history, receipts] = await Promise.all([
      this.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id)).orderBy(asc(purchaseOrderLines.lineNo)),
      this.db.select().from(vendors).where(eq(vendors.id, po.vendorId)),
      this.db.select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType, siteAddress: projects.siteAddress, status: projects.status }).from(projects).where(eq(projects.id, po.projectId)),
      this.db.select().from(companies).where(eq(companies.id, po.companyId)),
      this.approvals.historyFor(ctx.companyId!, 'PURCHASE_ORDER', id),
      this.db.select().from(goodsReceipts).where(eq(goodsReceipts.poId, id)).orderBy(desc(goodsReceipts.receiptDate), desc(goodsReceipts.code)),
    ]);
    const rLines = receipts.length ? await this.db.select().from(goodsReceiptLines).where(inArray(goodsReceiptLines.receiptId, receipts.map((r) => r.id))) : [];
    const { bankAccountEnc, ...vendorSafe } = vendor;
    void bankAccountEnc;
    const current = history[0];
    const myRoles = current ? await this.approvals.roleKeys(ctx.companyId!, ctx.user.id) : [];
    const curStep = current?.steps.find((s) => s.stepNo === current.currentStep);
    const canAct = !!current && ['PENDING', 'HOLD'].includes(current.status) && !!curStep?.roleKey && myRoles.includes(curStep.roleKey);
    const canRecall = !!current && current.status === 'PENDING' && current.drafterId === ctx.user.id && !current.steps.some((s) => s.stepNo > 0 && (s.state === 'APPROVED' || s.state === 'HOLD'));
    return {
      canAct,
      canRecall,
      ...po,
      statusLabel: PO_STATUS_LABEL[po.status],
      lines: lines.map((l) => ({ ...l, remainingQty: D(l.qty).minus(l.receivedQty).toFixed(4) })),
      vendor: vendorSafe,
      project,
      company: { name: company.name, bizRegNo: company.bizRegNo, ceoName: company.ceoName, address: company.address, phone: company.phone, businessType: company.businessType, businessItem: company.businessItem },
      approval: history[0] ?? null,
      approvalHistory: history,
      receipts: receipts.map((r) => ({ ...r, lines: rLines.filter((x) => x.receiptId === r.id) })),
    };
  }

  private async validateRefs(ctx: AccessContext, dto: CreatePo) {
    const [p] = await this.db.select({ id: projects.id, status: projects.status }).from(projects).where(and(eq(projects.id, dto.projectId), eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt)));
    if (!p || !this.access.canSeeProject(ctx, p.id)) throw new BadRequestException({ code: 'BAD_PROJECT', message: '선택한 현장을 찾을 수 없습니다', fields: [{ field: 'projectId', message: '현장을 다시 선택해 주세요' }] });
    if (p.status === 'SETTLED') throw new BadRequestException({ code: 'PROJECT_SETTLED', message: '정산이 끝난 현장에는 발주할 수 없습니다' });
    const [v] = await this.db.select({ id: vendors.id, bizStatus: vendors.bizStatus }).from(vendors).where(and(eq(vendors.id, dto.vendorId), eq(vendors.companyId, ctx.companyId!), isNull(vendors.deletedAt)));
    if (!v) throw new BadRequestException({ code: 'BAD_VENDOR', message: '선택한 거래처를 찾을 수 없습니다', fields: [{ field: 'vendorId', message: '거래처를 다시 선택해 주세요' }] });
    if (v.bizStatus === 'CLOSED') throw new BadRequestException({ code: 'VENDOR_CLOSED', message: '폐업한 거래처에는 발주할 수 없습니다' });
    if (dto.costCodeId) {
      const [cc] = await this.db.select({ id: costCodes.id }).from(costCodes).where(and(eq(costCodes.id, dto.costCodeId), eq(costCodes.companyId, ctx.companyId!)));
      if (!cc) throw new BadRequestException({ code: 'BAD_COST_CODE', message: '원가항목을 다시 선택해 주세요', fields: [{ field: 'costCodeId', message: '원가항목을 다시 선택해 주세요' }] });
    }
    if (dto.requestId) {
      const [rq] = await this.db.select({ id: purchaseRequests.id, projectId: purchaseRequests.projectId, status: purchaseRequests.status, poId: purchaseRequests.poId }).from(purchaseRequests).where(and(eq(purchaseRequests.id, dto.requestId), eq(purchaseRequests.companyId, ctx.companyId!)));
      if (!rq) throw new BadRequestException({ code: 'BAD_REQUEST_DOC', message: '구매요청을 찾을 수 없습니다' });
      if (rq.projectId !== dto.projectId) throw new BadRequestException({ code: 'REQUEST_PROJECT', message: '구매요청과 발주서의 현장이 다릅니다' });
    }
    const mids = [...new Set(dto.lines.map((l) => l.materialId).filter(Boolean))] as string[];
    if (mids.length) {
      const ms = await this.db.select({ id: materials.id }).from(materials).where(and(inArray(materials.id, mids), eq(materials.companyId, ctx.companyId!)));
      if (ms.length !== mids.length) throw new BadRequestException({ code: 'BAD_MATERIAL', message: '자재마스터에 없는 자재가 포함되어 있습니다' });
    }
  }

  /** 서버에서 품목별 금액과 합계를 다시 계산 — 화면 값은 쓰지 않는다 */
  private async compute(dto: CreatePo) {
    const vatRate = await this.taxRates.rateAt('VAT', dto.orderDate);
    const lines = dto.lines.map((l, i) => ({
      lineNo: i + 1, materialId: l.materialId ?? null, name: l.name, spec: l.spec, unit: l.unit, qty: D(l.qty).toFixed(4), unitPrice: D(l.unitPrice).toFixed(4),
      taxType: l.taxType, memo: l.memo, ...lineAmounts(l.qty, l.unitPrice, l.taxType, vatRate),
    }));
    const supply = sumMoney(lines.map((l) => l.supplyAmount));
    const vat = sumMoney(lines.map((l) => l.vatAmount));
    return { vatRate, lines, supplyAmount: supply, vatAmount: vat, totalAmount: moneyStr(D(supply).plus(vat)) };
  }

  private header(dto: CreatePo) {
    return {
      projectId: dto.projectId, vendorId: dto.vendorId, title: dto.title, orderDate: dto.orderDate, deliveryDate: dto.deliveryDate ?? null, deliveryPlace: dto.deliveryPlace,
      paymentTerms: dto.paymentTerms, ourContact: dto.ourContact, ourPhone: dto.ourPhone, vendorContact: dto.vendorContact, memo: dto.memo,
      costCodeId: dto.costCodeId ?? null,
    };
  }

  async create(ctx: AccessContext, dto: CreatePo) {
    await this.validateRefs(ctx, dto);
    const c = await this.compute(dto);
    return this.db.transaction(async (tx) => {
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'PO');
      const head = this.header(dto);
      if (!head.costCodeId) head.costCodeId = await this.ledger.defaultCostCode(tx, ctx.companyId!);
      const [po] = await tx
        .insert(purchaseOrders)
        .values({ companyId: ctx.companyId!, code, ...head, requestId: dto.requestId ?? null, supplyAmount: c.supplyAmount, vatAmount: c.vatAmount, totalAmount: c.totalAmount, vatRate: c.vatRate, createdById: ctx.user.id, updatedById: ctx.user.id })
        .returning();
      await tx.insert(purchaseOrderLines).values(c.lines.map((l) => ({ ...l, poId: po.id })));
      if (dto.requestId) {
        const [rq] = await tx.update(purchaseRequests).set({ status: 'ORDERED', poId: po.id, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${purchaseRequests.version} + 1` })
          .where(and(eq(purchaseRequests.id, dto.requestId), eq(purchaseRequests.status, 'REQUESTED'))).returning();
        if (!rq) throw new ConflictException({ code: 'REQUEST_DONE', message: '이미 발주했거나 반려된 구매요청입니다' });
      }
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'purchase_order', resourceId: po.id, summary: `발주서 작성 ${po.code} ${po.title} (${D(po.totalAmount).toFixed(0)}원)`, after: { ...po, lines: c.lines } }, tx);
      return po;
    });
  }

  async update(ctx: AccessContext, id: string, dto: CreatePo & { version: number }) {
    const before = await this.load(ctx, id);
    if (!(EDITABLE as readonly string[]).includes(before.status)) {
      throw new ConflictException({ code: 'PO_LOCKED', message: `${PO_STATUS_LABEL[before.status]} 상태의 발주서는 수정할 수 없습니다${before.status === 'APPROVED' || before.status === 'SENT' ? '. "변경 재결재"로 작성중 상태로 되돌린 뒤 수정하세요' : ''}` });
    }
    await this.validateRefs(ctx, dto);
    const c = await this.compute(dto);
    return this.db.transaction(async (tx) => {
      const beforeLines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id));
      const [po] = await tx
        .update(purchaseOrders)
        .set({ ...this.header(dto), costCodeId: dto.costCodeId ?? before.costCodeId ?? (await this.ledger.defaultCostCode(tx, ctx.companyId!)), supplyAmount: c.supplyAmount, vatAmount: c.vatAmount, totalAmount: c.totalAmount, vatRate: c.vatRate, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${purchaseOrders.version} + 1` })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.version, dto.version)))
        .returning();
      if (!po) throw staleVersion();
      await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id));
      await tx.insert(purchaseOrderLines).values(c.lines.map((l) => ({ ...l, poId: id })));
      await this.audit.fromCtx(ctx, {
        action: 'UPDATE', resource: 'purchase_order', resourceId: id, summary: `발주서 수정 ${po.code}`,
        before: { totalAmount: before.totalAmount, lines: beforeLines.map(({ name, qty, unitPrice, supplyAmount }) => ({ name, qty, unitPrice, supplyAmount })) },
        after: { totalAmount: po.totalAmount, lines: c.lines.map(({ name, qty, unitPrice, supplyAmount }) => ({ name, qty, unitPrice, supplyAmount })) },
      }, tx);
      return po;
    });
  }

  /** 대표이사 결재 상신 */
  async submit(ctx: AccessContext, id: string, version: number) {
    const po = await this.load(ctx, id);
    if (!(EDITABLE as readonly string[]).includes(po.status)) throw new ConflictException({ code: 'PO_LOCKED', message: `${PO_STATUS_LABEL[po.status]} 상태에서는 상신할 수 없습니다` });
    if (D(po.totalAmount).lte(0)) throw new BadRequestException({ code: 'ZERO_AMOUNT', message: '금액이 0원인 발주서는 상신할 수 없습니다' });
    return this.db.transaction(async (tx) => {
      const [locked] = await tx.update(purchaseOrders).set({ status: 'PENDING', version: sql`${purchaseOrders.version} + 1` }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.version, version), inArray(purchaseOrders.status, [...EDITABLE]))).returning();
      if (!locked) throw staleVersion();
      const a = await this.approvals.submit(tx, ctx, { docType: 'PURCHASE_ORDER', docId: id, docCode: po.code, title: `[발주] ${po.title}`, amount: po.totalAmount, projectId: po.projectId });
      await tx.update(purchaseOrders).set({ approvalId: a.id }).where(eq(purchaseOrders.id, id));
      return { approvalId: a.id };
    });
  }

  private async transition(ctx: AccessContext, id: string, version: number, from: Po['status'][], to: Po['status'], extra: Partial<Po>, summary: string, tx?: Tx) {
    const run = async (t: Tx) => {
      const [po] = await t
        .update(purchaseOrders)
        .set({ ...extra, status: to, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${purchaseOrders.version} + 1` })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.version, version), inArray(purchaseOrders.status, from), this.scope(ctx)))
        .returning();
      if (!po) {
        const cur = await this.load(ctx, id, t);
        if (cur.version !== version) throw staleVersion();
        throw new ConflictException({ code: 'BAD_STATUS', message: `${PO_STATUS_LABEL[cur.status]} 상태에서는 할 수 없는 작업입니다` });
      }
      await this.audit.fromCtx(ctx, { action: 'STATUS', resource: 'purchase_order', resourceId: id, summary: `${po.code} ${summary}` }, t);
      return po;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  markSent(ctx: AccessContext, id: string, version: number) {
    return this.transition(ctx, id, version, ['APPROVED'], 'SENT', { sentAt: new Date() }, '거래처 전송 처리');
  }

  private async assertNoReceipts(tx: Tx | DB, id: string) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(goodsReceipts).where(and(eq(goodsReceipts.poId, id), eq(goodsReceipts.status, 'CONFIRMED')));
    if (n) throw new ConflictException({ code: 'HAS_RECEIPTS', message: '이미 검수(입고)된 내역이 있어 처리할 수 없습니다. 검수를 먼저 취소하세요' });
  }

  /** 승인 후 변경: 작성중으로 되돌리고 개정번호 증가 → 다시 대표 결재 필요 */
  async reopen(ctx: AccessContext, id: string, version: number, reason: string) {
    return this.db.transaction(async (tx) => {
      await this.assertNoReceipts(tx, id);
      const po = await this.transition(ctx, id, version, ['APPROVED', 'SENT'], 'DRAFT', { approvalId: null, approvedAt: null, sentAt: null, revision: sql`${purchaseOrders.revision} + 1` as unknown as number }, `변경 재결재를 위해 작성중으로 전환 — ${reason}`, tx);
      return po;
    });
  }

  async cancel(ctx: AccessContext, id: string, version: number, reason: string) {
    return this.db.transaction(async (tx) => {
      await this.assertNoReceipts(tx, id);
      const po = await this.transition(ctx, id, version, ['DRAFT', 'REJECTED', 'APPROVED', 'SENT'], 'CANCELLED', {}, `발주 취소 — ${reason}`, tx);
      // 구매요청에서 만든 발주서면 요청을 다시 '요청' 상태로 돌려 다른 발주서로 처리할 수 있게 한다
      if (po.requestId) await tx.update(purchaseRequests).set({ status: 'REQUESTED', poId: null, version: sql`${purchaseRequests.version} + 1` }).where(and(eq(purchaseRequests.id, po.requestId), eq(purchaseRequests.poId, id)));
      return po;
    });
  }

  /** 부분입고 상태에서 남은 수량을 더 받지 않기로 하고 종결 */
  close(ctx: AccessContext, id: string, version: number, reason: string) {
    return this.transition(ctx, id, version, ['PARTIAL'], 'CLOSED', {}, `잔량 종결 — ${reason}`);
  }

  // ───────── 납품·검수 ─────────
  private async recomputeStatus(tx: Tx, poId: string) {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
    const any = lines.some((l) => D(l.receivedQty).gt(0));
    const all = lines.every((l) => D(l.receivedQty).gte(l.qty));
    const status: Po['status'] = all ? 'RECEIVED' : any ? 'PARTIAL' : po.sentAt ? 'SENT' : 'APPROVED';
    if (po.status !== status && po.status !== 'CLOSED') await tx.update(purchaseOrders).set({ status, version: sql`${purchaseOrders.version} + 1` }).where(eq(purchaseOrders.id, poId));
    return status;
  }

  async receive(ctx: AccessContext, poId: string, dto: z.infer<typeof ReceiptDto>) {
    return this.db.transaction(async (tx) => {
      // 발주서와 품목 행을 잠가서 동시 검수 시 초과 입고를 막는다
      const locked = await tx.execute(sql`select id, status from purchase_order where id = ${poId} and company_id = ${ctx.companyId} for update`);
      if (!locked.rows.length) throw notFound('발주서');
      const po = await this.load(ctx, poId, tx);
      if (!(RECEIVABLE as readonly string[]).includes(po.status)) {
        throw new ConflictException({ code: 'NOT_RECEIVABLE', message: po.status === 'PENDING' ? '대표이사 결재가 끝나야 검수할 수 있습니다' : `${PO_STATUS_LABEL[po.status]} 상태의 발주서는 검수할 수 없습니다` });
      }
      await tx.execute(sql`select id from purchase_order_line where po_id = ${poId} for update`);
      const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
      const seen = new Set<string>();
      const prepared = [];
      for (const l of dto.lines) {
        if (D(l.qty).lte(0)) continue;
        if (seen.has(l.poLineId)) throw new BadRequestException({ code: 'DUP_LINE', message: '같은 품목이 두 번 들어 있습니다' });
        seen.add(l.poLineId);
        const pl = lines.find((x) => x.id === l.poLineId);
        if (!pl) throw new BadRequestException({ code: 'BAD_LINE', message: '이 발주서에 없는 품목입니다' });
        const remaining = D(pl.qty).minus(pl.receivedQty);
        if (D(l.qty).gt(remaining)) {
          throw new BadRequestException({ code: 'OVER_RECEIPT', message: `'${pl.name}' 검수 수량(${D(l.qty).toString()})이 미입고 잔량(${remaining.toString()} ${pl.unit})보다 많습니다`, fields: [{ field: `lines.${l.poLineId}`, message: `잔량 ${remaining.toString()}` }] });
        }
        prepared.push({ pl, qty: D(l.qty).toFixed(4), note: l.note, ...lineAmounts(l.qty, pl.unitPrice, pl.taxType, po.vatRate) });
      }
      if (!prepared.length) throw new BadRequestException({ code: 'NO_QTY', message: '검수 수량을 하나 이상 입력해 주세요' });
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'GR');
      const [gr] = await tx
        .insert(goodsReceipts)
        .values({
          companyId: ctx.companyId!, poId, projectId: po.projectId, code, receiptDate: dto.receiptDate, inspectorName: dto.inspectorName ?? ctx.user.name, memo: dto.memo,
          supplyAmount: sumMoney(prepared.map((p) => p.supplyAmount)), vatAmount: sumMoney(prepared.map((p) => p.vatAmount)), createdById: ctx.user.id, updatedById: ctx.user.id,
        })
        .returning();
      for (const p of prepared) {
        await tx.insert(goodsReceiptLines).values({ receiptId: gr.id, poLineId: p.pl.id, qty: p.qty, supplyAmount: p.supplyAmount, vatAmount: p.vatAmount, note: p.note });
        await tx.update(purchaseOrderLines).set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${p.qty}` }).where(eq(purchaseOrderLines.id, p.pl.id));
      }
      const status = await this.recomputeStatus(tx, poId);
      // 자동분개: 공사원가(원가항목 계정) / 외상매입금 — 발생원가는 부가세를 제외한 공급가액
      const costCodeId = po.costCodeId ?? (await this.ledger.defaultCostCode(tx, ctx.companyId!));
      if (costCodeId && D(gr.supplyAmount).gt(0)) {
        const costAcc = await this.ledger.costAccount(tx, ctx.companyId!, costCodeId);
        const ap = await this.ledger.ruleAccount(tx, ctx.companyId!, 'AP_TRADE');
        await this.ledger.post(tx, ctx, {
          date: dto.receiptDate, description: `자재 검수 ${gr.code} · ${po.title}`, sourceType: 'RECEIPT', sourceId: gr.id, sourceCode: gr.code,
          lines: [
            { accountId: costAcc, debit: gr.supplyAmount, projectId: po.projectId, vendorId: po.vendorId, costCodeId, memo: `${po.code} 검수` },
            { accountId: ap, credit: gr.supplyAmount, projectId: po.projectId, vendorId: po.vendorId, memo: `${po.code} 검수` },
          ],
        });
      }
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'goods_receipt', resourceId: poId, summary: `검수 ${gr.code} (${po.code}) ${prepared.length}개 품목, ${D(gr.supplyAmount).toFixed(0)}원 → ${PO_STATUS_LABEL[status]}`, after: { receipt: gr, lines: prepared.map((p) => ({ name: p.pl.name, qty: p.qty })) } }, tx);
      return { ...gr, poStatus: status };
    });
  }

  /** 검수 취소 (반품·오입력) — 입고 수량을 되돌린다 */
  async cancelReceipt(ctx: AccessContext, receiptId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [gr] = await tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.companyId, ctx.companyId!), this.access.projectScope(ctx, goodsReceipts.projectId)));
      if (!gr) throw notFound('검수 내역');
      await tx.execute(sql`select id from purchase_order where id = ${gr.poId} for update`);
      // 지급결의에 걸린 검수는 결의부터 취소해야 한다
      const used = await tx.execute(sql`select r.code from payment_request_line l join payment_request r on r.id = l.request_id where l.active_source_key = ${'RECEIPT:' + receiptId}`);
      if (used.rows.length) throw new ConflictException({ code: 'RECEIPT_IN_PAYMENT', message: `지급결의 ${(used.rows[0] as { code: string }).code}에 포함된 검수입니다. 지급결의를 먼저 취소하세요` });
      const [u] = await tx.update(goodsReceipts).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, updatedById: ctx.user.id, version: sql`${goodsReceipts.version} + 1` }).where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.status, 'CONFIRMED'))).returning();
      if (!u) throw new ConflictException({ code: 'ALREADY_CANCELLED', message: '이미 취소된 검수입니다' });
      const lines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, receiptId));
      for (const l of lines) await tx.update(purchaseOrderLines).set({ receivedQty: sql`${purchaseOrderLines.receivedQty} - ${l.qty}` }).where(eq(purchaseOrderLines.id, l.poLineId));
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, gr.poId));
      if (po.status === 'CLOSED') await tx.update(purchaseOrders).set({ status: 'PARTIAL' }).where(eq(purchaseOrders.id, gr.poId));
      const status = await this.recomputeStatus(tx, gr.poId);
      await this.ledger.reverseSource(tx, ctx, 'RECEIPT', receiptId, `검수 취소 — ${reason}`);
      await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'goods_receipt', resourceId: gr.poId, summary: `검수 취소 ${gr.code} — ${reason} → ${PO_STATUS_LABEL[status]}` }, tx);
      return { poStatus: status };
    });
  }

  async receipts(ctx: AccessContext, q: z.infer<typeof ListReceiptQuery>) {
    const conds: SQL[] = [eq(goodsReceipts.companyId, ctx.companyId!), this.access.projectScope(ctx, goodsReceipts.projectId)];
    if (q.projectId) conds.push(eq(goodsReceipts.projectId, q.projectId));
    if (q.poId) conds.push(eq(goodsReceipts.poId, q.poId));
    if (q.from) conds.push(gte(goodsReceipts.receiptDate, q.from));
    if (q.to) conds.push(lte(goodsReceipts.receiptDate, q.to));
    const where = and(...conds);
    const [agg] = await this.db.select({ count: sql<number>`count(*)::int`, supply: sql<string>`coalesce(sum(case when ${goodsReceipts.status}='CONFIRMED' then ${goodsReceipts.supplyAmount} end),0)::text` }).from(goodsReceipts).where(where);
    const rows = await this.db
      .select({ r: goodsReceipts, poCode: purchaseOrders.code, poTitle: purchaseOrders.title, vendorName: vendors.name, projectCode: projects.code, projectName: projects.name, tradeType: projects.tradeType })
      .from(goodsReceipts)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
      .where(where)
      .orderBy(desc(goodsReceipts.receiptDate), desc(goodsReceipts.code))
      .limit(q.size)
      .offset((q.page - 1) * q.size);
    return { total: agg.count, page: q.page, size: q.size, sums: { supplyAmount: agg.supply }, rows: rows.map(({ r, ...x }) => ({ ...r, ...x })) };
  }

  /** 대시보드용 발주 집계 */
  async metrics(ctx: AccessContext) {
    const s = this.scope(ctx);
    const [row] = await this.db
      .select({
        pending: sql<number>`count(*) filter (where ${purchaseOrders.status} = 'PENDING')::int`,
        draft: sql<number>`count(*) filter (where ${purchaseOrders.status} in ('DRAFT','REJECTED'))::int`,
        confirmed: sql<string>`coalesce(sum(${purchaseOrders.totalAmount}) filter (where ${purchaseOrders.status} in ('APPROVED','SENT','PARTIAL','RECEIVED','CLOSED')),0)::text`,
        confirmedSupply: sql<string>`coalesce(sum(${purchaseOrders.supplyAmount}) filter (where ${purchaseOrders.status} in ('APPROVED','SENT','PARTIAL','RECEIVED','CLOSED')),0)::text`,
        open: sql<number>`count(*) filter (where ${purchaseOrders.status} in ('APPROVED','SENT','PARTIAL'))::int`,
      })
      .from(purchaseOrders)
      .where(s);
    const [rc] = await this.db
      .select({ received: sql<string>`coalesce(sum(${goodsReceipts.supplyAmount}),0)::text` })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.companyId, ctx.companyId!), eq(goodsReceipts.status, 'CONFIRMED'), this.access.projectScope(ctx, goodsReceipts.projectId)));
    return { ...row, receivedSupply: rc.received };
  }
}
