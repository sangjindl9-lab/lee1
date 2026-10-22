/**
 * 작업자·작업일보·노무비
 *  - 작업자: 주민등록번호·계좌번호는 암호화 저장, 화면에는 가린 값만. 원문 열람은 권한자만, 감사로그에 남김 (최소 수집 — 주민번호는 선택 입력)
 *  - 작업일보: 현장·날짜·공수(1.0=하루)·연장시간 → 노무비 = 일당×공수 + 일당/8×연장시간×연장배율 (원 미만 버림)
 *  - 확정: 기록을 잠그고 (직접노무비 / 미지급비용) 분개. 지급은 지급결의(원천: 노무비)
 *  - 원천세·4대보험은 법정 요율을 고정하지 않는다 — 이 모듈은 총지급액(세전)까지만 계산하고, 공제는 급여 모듈/세무사 확인 후 지급결의에서 처리
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { LedgerService, PostLine } from '../accounting/ledger.service';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField, maskAccount } from '../common/crypto';
import { notFound, staleVersion } from '../common/errors';
import { buildExcel, sendExcel } from '../common/excel';
import { D, moneyStr } from '../common/money';
import { NumberingService, todayKST } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { costCodes, laborRecords, laborWorkers, paymentRequestLines, projects } from '../db/schema';
import { PaymentsService } from '../payments/payments';
import { dateStr, loadProject, optText, posAmt, ReasonDto } from './common';

const WorkerDto = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요').max(50),
  kind: z.enum(['DAILY', 'STAFF']).default('DAILY'),
  trade: optText(50), phone: optText(30),
  residentNo: z.string().trim().max(20).optional().nullable().transform((v) => (v ? v.replace(/\D/g, '') : null)).refine((v) => !v || v.length === 13, '주민등록번호는 13자리'),
  bankName: optText(30),
  bankAccount: z.string().trim().max(40).optional().nullable().transform((v) => (v ? v.replace(/[^0-9-]/g, '') : null)),
  dailyWage: posAmt.default('0'),
  isActive: z.boolean().default(true),
  memo: optText(500),
});
const RecordDto = z.object({
  projectId: z.string().uuid('현장을 선택해 주세요'),
  workDate: dateStr,
  entries: z.array(z.object({
    workerId: z.string().uuid(),
    manDays: z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 3, '공수는 0.1~3'),
    overtimeHours: z.union([z.string(), z.number()]).transform((v) => String(v || 0)).refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 16, '연장 0~16시간').default('0'),
    dailyWage: posAmt.optional().nullable(),
    workType: optText(50),
    costCodeId: z.string().uuid().optional().nullable(),
    memo: optText(200),
  })).min(1, '작업자를 한 명 이상 넣어 주세요').max(200),
});
const ListQ = z.object({ projectId: z.string().uuid().optional(), workerId: z.string().uuid().optional(), from: dateStr.optional(), to: dateStr.optional(), status: z.enum(['RECORDED', 'CONFIRMED', 'CANCELLED']).optional() });

const residentMask = (n: string) => `${n.slice(0, 6)}-${n[6]}******`;
export const laborAmount = (wage: Decimal.Value, manDays: Decimal.Value, ot: Decimal.Value, otRate: Decimal.Value = '1.5') =>
  D(wage).mul(manDays).plus(D(wage).div(8).mul(ot).mul(otRate)).toDecimalPlaces(0, 1);
import type Decimal from 'decimal.js';

@Injectable()
export class LaborService implements OnModuleInit {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    this.payments.registerSource('LABOR', {
      label: '노무비', payableRule: 'LABOR_PAYABLE',
      resolve: async (tx, ctx, ids) => {
        const rows = await tx.select({ r: laborRecords, name: laborWorkers.name }).from(laborRecords).innerJoin(laborWorkers, eq(laborWorkers.id, laborRecords.workerId)).where(and(inArray(laborRecords.id, ids), eq(laborRecords.companyId, ctx.companyId!)));
        if (rows.length !== ids.length) throw new BadRequestException({ code: 'BAD_SOURCE', message: '노무 기록을 찾을 수 없습니다' });
        for (const x of rows) if (x.r.status !== 'CONFIRMED') throw new BadRequestException({ code: 'NOT_CONFIRMED', message: `${x.name} ${x.r.workDate}: 확정된 노무비만 지급할 수 있습니다` });
        return rows.map(({ r, name }) => ({ id: r.id, code: `${r.workDate.slice(5)} ${name}`, description: `${name} ${r.workDate} 노무비 (${D(r.manDays).toString()}공수)`, projectId: r.projectId, vendorId: null, costCodeId: r.costCodeId, supplyAmount: r.amount, vatAmount: '0' }));
      },
      available: async (ctx, q) => {
        const conds: SQL[] = [eq(laborRecords.companyId, ctx.companyId!), eq(laborRecords.status, 'CONFIRMED'), sql`not exists (select 1 from ${paymentRequestLines} l where l.active_source_key = 'LABOR:' || ${laborRecords.id}::text)`,
          sql`not exists (select 1 from payment_request_line l join payment_request r on r.id = l.request_id where l.source_type = 'LABOR' and l.source_id = ${laborRecords.id} and r.status = 'PAID')`];
        if (q.projectId) conds.push(eq(laborRecords.projectId, q.projectId));
        return this.db.select({ id: laborRecords.id, workDate: laborRecords.workDate, amount: laborRecords.amount, manDays: laborRecords.manDays, workerName: laborWorkers.name, projectName: projects.name })
          .from(laborRecords).innerJoin(laborWorkers, eq(laborWorkers.id, laborRecords.workerId)).innerJoin(projects, eq(projects.id, laborRecords.projectId)).where(and(...conds)).orderBy(asc(laborRecords.workDate), asc(laborWorkers.name)).limit(500);
      },
    });
  }

  // ───────── 작업자 ─────────
  async workers(ctx: AccessContext, q: { q?: string; all?: boolean }) {
    const conds: SQL[] = [eq(laborWorkers.companyId, ctx.companyId!)];
    if (!q.all) conds.push(eq(laborWorkers.isActive, true));
    if (q.q) conds.push(ilike(laborWorkers.name, `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`));
    const rows = await this.db.select().from(laborWorkers).where(and(...conds)).orderBy(asc(laborWorkers.name)).limit(500);
    return rows.map(({ residentNoEnc, bankAccountEnc, ...w }) => ({ ...w, hasResidentNo: !!residentNoEnc, hasBankAccount: !!bankAccountEnc }));
  }

  private enc(dto: z.infer<typeof WorkerDto>) {
    return {
      residentNoEnc: dto.residentNo ? encryptField(dto.residentNo) : null, residentNoMask: dto.residentNo ? residentMask(dto.residentNo) : null,
      bankAccountEnc: dto.bankAccount ? encryptField(dto.bankAccount) : null, bankAccountMask: dto.bankAccount ? maskAccount(dto.bankAccount) : null,
    };
  }

  async createWorker(ctx: AccessContext, dto: z.infer<typeof WorkerDto>) {
    return this.db.transaction(async (tx) => {
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'W', todayKST());
      const [w] = await tx.insert(laborWorkers).values({ companyId: ctx.companyId!, code, name: dto.name, kind: dto.kind, trade: dto.trade, phone: dto.phone, bankName: dto.bankName, dailyWage: moneyStr(dto.dailyWage), isActive: dto.isActive, memo: dto.memo, ...this.enc(dto), createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'labor', resourceId: w.id, summary: `작업자 등록 ${w.name} (${dto.trade ?? '직종 미지정'}, 일당 ${D(dto.dailyWage).toFixed(0)}원)` }, tx);
      return { id: w.id };
    });
  }

  /** 빈 칸으로 보낸 주민번호·계좌는 기존 값 유지, 'CLEAR' 로 지움 */
  async updateWorker(ctx: AccessContext, id: string, dto: z.infer<typeof WorkerDto> & { version: number; clear?: string[] }) {
    const [cur] = await this.db.select().from(laborWorkers).where(and(eq(laborWorkers.id, id), eq(laborWorkers.companyId, ctx.companyId!)));
    if (!cur) throw notFound('작업자');
    const e = this.enc(dto);
    const set: Partial<typeof laborWorkers.$inferInsert> = { name: dto.name, kind: dto.kind, trade: dto.trade, phone: dto.phone, bankName: dto.bankName, dailyWage: moneyStr(dto.dailyWage), isActive: dto.isActive, memo: dto.memo, updatedById: ctx.user.id, updatedAt: new Date() };
    if (dto.residentNo) Object.assign(set, { residentNoEnc: e.residentNoEnc, residentNoMask: e.residentNoMask });
    if (dto.bankAccount) Object.assign(set, { bankAccountEnc: e.bankAccountEnc, bankAccountMask: e.bankAccountMask });
    if (dto.clear?.includes('residentNo')) Object.assign(set, { residentNoEnc: null, residentNoMask: null });
    if (dto.clear?.includes('bankAccount')) Object.assign(set, { bankAccountEnc: null, bankAccountMask: null });
    const [w] = await this.db.update(laborWorkers).set({ ...set, version: sql`${laborWorkers.version} + 1` }).where(and(eq(laborWorkers.id, id), eq(laborWorkers.version, dto.version))).returning();
    if (!w) throw staleVersion();
    await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'labor', resourceId: id, summary: `작업자 정보 수정 ${w.name}${dto.residentNo ? ' (주민번호 변경)' : ''}${dto.bankAccount ? ' (계좌 변경)' : ''}` });
    return { id };
  }

  /** 민감정보 원문 보기 — 권한자만, 사유와 함께 감사로그 */
  async reveal(ctx: AccessContext, id: string, field: 'residentNo' | 'bankAccount', reason: string) {
    const [w] = await this.db.select().from(laborWorkers).where(and(eq(laborWorkers.id, id), eq(laborWorkers.companyId, ctx.companyId!)));
    if (!w) throw notFound('작업자');
    const v = field === 'residentNo' ? w.residentNoEnc : w.bankAccountEnc;
    await this.audit.fromCtx(ctx, { action: 'REVEAL', resource: 'labor', resourceId: id, summary: `작업자 ${w.name} ${field === 'residentNo' ? '주민등록번호' : '계좌번호'} 원문 열람 — ${reason}` });
    return { value: v ? decryptField(v) : null };
  }

  // ───────── 작업일보 ─────────
  async records(ctx: AccessContext, q: z.infer<typeof ListQ>) {
    const conds: SQL[] = [eq(laborRecords.companyId, ctx.companyId!), this.access.projectScope(ctx, laborRecords.projectId)];
    if (q.projectId) conds.push(eq(laborRecords.projectId, q.projectId));
    if (q.workerId) conds.push(eq(laborRecords.workerId, q.workerId));
    if (q.from) conds.push(gte(laborRecords.workDate, q.from));
    if (q.to) conds.push(lte(laborRecords.workDate, q.to));
    if (q.status) conds.push(eq(laborRecords.status, q.status));
    else conds.push(sql`${laborRecords.status} <> 'CANCELLED'`);
    const rows = await this.db.select({
      r: laborRecords, workerName: laborWorkers.name, trade: laborWorkers.trade, projectName: projects.name, projectCode: projects.code, costCodeName: costCodes.name,
      paid: sql<boolean>`exists (select 1 from payment_request_line l join payment_request pr on pr.id = l.request_id where l.source_type = 'LABOR' and l.source_id = ${laborRecords.id} and pr.status = 'PAID')`,
      inRequest: sql<boolean>`exists (select 1 from payment_request_line l where l.active_source_key = 'LABOR:' || ${laborRecords.id}::text)`,
    }).from(laborRecords).innerJoin(laborWorkers, eq(laborWorkers.id, laborRecords.workerId)).innerJoin(projects, eq(projects.id, laborRecords.projectId)).innerJoin(costCodes, eq(costCodes.id, laborRecords.costCodeId))
      .where(and(...conds)).orderBy(desc(laborRecords.workDate), asc(laborWorkers.name)).limit(1000);
    const out = rows.map(({ r, ...x }) => ({ ...r, ...x }));
    const sum = (f: (r: (typeof out)[number]) => boolean) => moneyStr(out.filter(f).reduce((a, r) => a.plus(r.amount), D(0)));
    return {
      rows: out,
      sums: { total: sum(() => true), recorded: sum((r) => r.status === 'RECORDED'), confirmed: sum((r) => r.status === 'CONFIRMED' && !r.paid), paid: sum((r) => r.paid), manDays: out.reduce((a, r) => a.plus(r.manDays), D(0)).toString() },
    };
  }

  /** 하루 작업일보 저장 (같은 날·같은 현장·같은 작업자는 한 번만) */
  async record(ctx: AccessContext, dto: z.infer<typeof RecordDto>) {
    const p = await loadProject(this.db, this.access, ctx, dto.projectId);
    if (p.status === 'SETTLED') throw new BadRequestException({ code: 'SETTLED', message: '정산이 끝난 현장입니다' });
    if (dto.workDate > todayKST()) throw new BadRequestException({ code: 'FUTURE', message: '앞으로의 날짜에는 작업을 기록할 수 없습니다' });
    const ids = dto.entries.map((e) => e.workerId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException({ code: 'DUP_WORKER', message: '같은 작업자가 두 번 들어 있습니다' });
    const ws = await this.db.select().from(laborWorkers).where(and(inArray(laborWorkers.id, ids), eq(laborWorkers.companyId, ctx.companyId!)));
    if (ws.length !== ids.length) throw new BadRequestException({ code: 'BAD_WORKER', message: '작업자를 다시 선택해 주세요' });
    const [defCc] = await this.db.select({ id: costCodes.id }).from(costCodes).where(and(eq(costCodes.companyId, ctx.companyId!), eq(costCodes.code, 'C02')));
    const dup = await this.db.select({ workerId: laborRecords.workerId }).from(laborRecords).where(and(eq(laborRecords.projectId, p.id), eq(laborRecords.workDate, dto.workDate), inArray(laborRecords.workerId, ids), sql`${laborRecords.status} <> 'CANCELLED'`));
    if (dup.length) throw new ConflictException({ code: 'DUPLICATE', message: `${ws.find((w) => w.id === dup[0].workerId)?.name}님은 이 날 이 현장에 이미 기록되어 있습니다` });
    return this.db.transaction(async (tx) => {
      const values = dto.entries.map((e) => {
        const w = ws.find((x) => x.id === e.workerId)!;
        const wage = D(e.dailyWage ?? w.dailyWage);
        if (wage.lte(0)) throw new BadRequestException({ code: 'NO_WAGE', message: `${w.name}님의 일당을 입력해 주세요` });
        return { companyId: ctx.companyId!, projectId: p.id, workerId: w.id, costCodeId: e.costCodeId ?? defCc.id, workDate: dto.workDate, workType: e.workType, manDays: e.manDays, overtimeHours: e.overtimeHours, dailyWage: moneyStr(wage), amount: moneyStr(laborAmount(wage, e.manDays, e.overtimeHours)), memo: e.memo, createdById: ctx.user.id, updatedById: ctx.user.id };
      });
      const rows = await tx.insert(laborRecords).values(values).returning({ id: laborRecords.id, amount: laborRecords.amount });
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'labor', resourceId: p.id, summary: `작업일보 ${dto.workDate} ${p.name} ${rows.length}명 · 노무비 ${rows.reduce((a, r) => a.plus(r.amount), D(0)).toFixed(0)}원` }, tx);
      return { count: rows.length };
    });
  }

  async updateRecord(ctx: AccessContext, id: string, dto: { manDays: string; overtimeHours: string; dailyWage: string; workType?: string | null; memo?: string | null; version: number }) {
    const [r] = await this.db.select().from(laborRecords).where(and(eq(laborRecords.id, id), eq(laborRecords.companyId, ctx.companyId!)));
    if (!r || !this.access.canSeeProject(ctx, r.projectId)) throw notFound('노무 기록');
    if (r.status !== 'RECORDED') throw new ConflictException({ code: 'LOCKED', message: '확정된 기록은 확정 취소 후 고칠 수 있습니다' });
    const [u] = await this.db.update(laborRecords).set({ manDays: dto.manDays, overtimeHours: dto.overtimeHours, dailyWage: moneyStr(dto.dailyWage), amount: moneyStr(laborAmount(dto.dailyWage, dto.manDays, dto.overtimeHours, r.overtimeRate)), workType: dto.workType ?? null, memo: dto.memo ?? null, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${laborRecords.version} + 1` })
      .where(and(eq(laborRecords.id, id), eq(laborRecords.version, dto.version))).returning();
    if (!u) throw staleVersion();
    await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'labor', resourceId: id, summary: `노무 기록 수정 ${r.workDate} ${D(r.amount).toFixed(0)} → ${D(u.amount).toFixed(0)}원` });
    return u;
  }

  async cancelRecord(ctx: AccessContext, id: string, reason: string) {
    const [r] = await this.db.select().from(laborRecords).where(and(eq(laborRecords.id, id), eq(laborRecords.companyId, ctx.companyId!)));
    if (!r || !this.access.canSeeProject(ctx, r.projectId)) throw notFound('노무 기록');
    if (r.status !== 'RECORDED') throw new ConflictException({ code: 'LOCKED', message: '확정된 기록은 확정 취소 후 지울 수 있습니다' });
    await this.db.update(laborRecords).set({ status: 'CANCELLED', memo: `${r.memo ? r.memo + ' / ' : ''}취소: ${reason}`, updatedById: ctx.user.id, version: sql`${laborRecords.version} + 1` }).where(eq(laborRecords.id, id));
    await this.audit.fromCtx(ctx, { action: 'CANCEL', resource: 'labor', resourceId: id, summary: `노무 기록 취소 ${r.workDate} — ${reason}` });
    return { ok: true };
  }

  /** 확정 — 기록을 잠그고 현장별로 (원가 / 미지급비용) 분개 */
  async confirm(ctx: AccessContext, ids: string[], date: string) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select({ r: laborRecords, name: laborWorkers.name }).from(laborRecords).innerJoin(laborWorkers, eq(laborWorkers.id, laborRecords.workerId))
        .where(and(inArray(laborRecords.id, ids), eq(laborRecords.companyId, ctx.companyId!))).for('update');
      if (rows.length !== ids.length) throw new BadRequestException({ code: 'BAD_IDS', message: '기록을 다시 확인해 주세요' });
      for (const x of rows) {
        if (!this.access.canSeeProject(ctx, x.r.projectId)) throw notFound('노무 기록');
        if (x.r.status !== 'RECORDED') throw new ConflictException({ code: 'ALREADY', message: `${x.name} ${x.r.workDate}: 이미 확정되었거나 취소된 기록입니다` });
        if (x.r.workDate > date) throw new BadRequestException({ code: 'DATE', message: '확정일은 작업일 이후여야 합니다' });
      }
      const payable = await this.ledger.ruleAccount(tx, ctx.companyId!, 'LABOR_PAYABLE');
      const byKey = new Map<string, { projectId: string; costCodeId: string; amount: Decimal }>();
      for (const { r } of rows) {
        const k = `${r.projectId}|${r.costCodeId}`;
        const cur = byKey.get(k) ?? { projectId: r.projectId, costCodeId: r.costCodeId, amount: D(0) };
        cur.amount = cur.amount.plus(r.amount);
        byKey.set(k, cur);
      }
      const lines: PostLine[] = [];
      let total = D(0);
      for (const g of byKey.values()) {
        lines.push({ accountId: await this.ledger.costAccount(tx, ctx.companyId!, g.costCodeId), debit: g.amount, projectId: g.projectId, costCodeId: g.costCodeId, memo: '노무비 확정' });
        total = total.plus(g.amount);
      }
      lines.push({ accountId: payable, credit: total, memo: `노무비 ${rows.length}건` });
      const batch = (await tx.execute(sql`select gen_random_uuid() id`)).rows[0] as { id: string };
      await this.ledger.post(tx, ctx, { date, description: `노무비 확정 ${rows.length}건 (${[...new Set(rows.map((x) => x.r.workDate))].sort()[0]} ~)`, sourceType: 'LABOR', sourceId: batch.id, sourceCode: `노무 ${date}`, lines });
      await tx.update(laborRecords).set({ status: 'CONFIRMED', confirmedAt: new Date(), confirmBatchId: batch.id, version: sql`${laborRecords.version} + 1` }).where(inArray(laborRecords.id, ids));
      await this.audit.fromCtx(ctx, { action: 'CONFIRM', resource: 'labor', summary: `노무비 확정 ${rows.length}건 ${total.toFixed(0)}원` }, tx);
      return { count: rows.length, total: moneyStr(total), batchId: batch.id };
    });
  }

  /** 확정 취소 — 같은 묶음 전체를 되돌린다 (지급결의에 들어간 기록이 있으면 불가) */
  async unconfirm(ctx: AccessContext, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(laborRecords).where(and(eq(laborRecords.id, id), eq(laborRecords.companyId, ctx.companyId!)));
      if (!r || r.status !== 'CONFIRMED') throw new ConflictException({ code: 'NOT_CONFIRMED', message: '확정된 기록이 아닙니다' });
      const batch = r.confirmBatchId;
      if (!batch) throw new ConflictException({ code: 'NO_BATCH', message: '확정 묶음을 찾을 수 없습니다' });
      const group = await tx.select({ id: laborRecords.id }).from(laborRecords).where(and(eq(laborRecords.companyId, ctx.companyId!), eq(laborRecords.confirmBatchId, batch)));
      const used = (await tx.execute(sql`select r.code from payment_request_line l join payment_request r on r.id = l.request_id where l.source_type = 'LABOR' and l.source_id in (${sql.join(group.map((g) => sql`${g.id}`), sql`, `)}) and r.status <> 'CANCELLED' limit 1`)).rows as { code: string }[];
      if (used.length) throw new ConflictException({ code: 'IN_PAYMENT', message: `같은 묶음의 노무비가 지급결의 ${used[0].code}에 들어 있습니다` });
      await this.ledger.reverseSource(tx, ctx, 'LABOR', batch, `노무비 확정 취소 — ${reason}`);
      await tx.update(laborRecords).set({ status: 'RECORDED', confirmedAt: null, confirmBatchId: null, version: sql`${laborRecords.version} + 1` }).where(eq(laborRecords.confirmBatchId, batch));
      await this.audit.fromCtx(ctx, { action: 'UNCONFIRM', resource: 'labor', summary: `노무비 확정 취소 ${group.length}건 — ${reason}` }, tx);
      return { count: group.length };
    });
  }

  /** 현장별·월별·작업자별 노무비 집계 */
  async summary(ctx: AccessContext, q: { from?: string; to?: string }) {
    const from = q.from ?? todayKST().slice(0, 8) + '01';
    const to = q.to ?? todayKST();
    const scope = ctx.scope === 'ASSIGNED' ? (ctx.assignedProjectIds.length ? sql`and r.project_id in (${sql.join(ctx.assignedProjectIds.map((i) => sql`${i}`), sql`, `)})` : sql`and false`) : sql``;
    const byProject = (await this.db.execute(sql`select p.id, p.code, p.name, count(distinct r.worker_id)::int workers, sum(r.man_days)::text man_days, sum(r.amount)::text amount,
        sum(r.amount) filter (where r.status = 'RECORDED')::text recorded, sum(r.amount) filter (where r.status = 'CONFIRMED')::text confirmed
      from labor_record r join project p on p.id = r.project_id where r.company_id = ${ctx.companyId} and r.status <> 'CANCELLED' and r.work_date between ${from} and ${to} ${scope}
      group by p.id order by p.code`)).rows;
    const byWorker = (await this.db.execute(sql`select w.id, w.name, w.trade, w.bank_name, w.bank_account_mask, count(*)::int days, sum(r.man_days)::text man_days, sum(r.overtime_hours)::text overtime, sum(r.amount)::text amount
      from labor_record r join labor_worker w on w.id = r.worker_id where r.company_id = ${ctx.companyId} and r.status <> 'CANCELLED' and r.work_date between ${from} and ${to} ${scope}
      group by w.id order by w.name`)).rows;
    return { from, to, byProject, byWorker };
  }

  async exportSummary(ctx: AccessContext, q: { from?: string; to?: string }, res: Response) {
    const s = await this.summary(ctx, q);
    type R = Record<string, string>;
    const wb = await buildExcel<R>({
      sheet: '노무비 집계', title: `노무비 집계표 (${s.from} ~ ${s.to})`, rows: s.byWorker as R[],
      columns: [
        { header: '작업자', key: 'n', width: 12, value: (r) => r.name }, { header: '직종', key: 't', width: 10, value: (r) => r.trade },
        { header: '출역일수', key: 'd', width: 9, value: (r) => r.days }, { header: '공수', key: 'm', width: 8, value: (r) => r.man_days }, { header: '연장(시간)', key: 'o', width: 10, value: (r) => r.overtime },
        { header: '노무비(세전)', key: 'a', width: 14, type: 'money', value: (r) => r.amount }, { header: '은행', key: 'b', width: 10, value: (r) => r.bank_name }, { header: '계좌', key: 'ac', width: 18, value: (r) => r.bank_account_mask },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'labor', summary: `노무비 집계표 엑셀 ${s.from} ~ ${s.to}` });
    await sendExcel(res, wb, `노무비집계_${s.from}_${s.to}.xlsx`);
  }
}

@ApiTags('노무 · 작업자·노무비')
@Controller('labor')
export class LaborController {
  constructor(private readonly svc: LaborService) {}

  @Get('workers')
  @RequirePermission('labor', 'read')
  workers(@Ctx() ctx: AccessContext, @Query('q') q?: string, @Query('all') all?: string) {
    return this.svc.workers(ctx, { q: q?.slice(0, 50), all: all === '1' });
  }

  @Post('workers')
  @RequirePermission('labor', 'create')
  createWorker(@Ctx() ctx: AccessContext, @Body(new ZodPipe(WorkerDto)) dto: z.infer<typeof WorkerDto>) {
    return this.svc.createWorker(ctx, dto);
  }

  @Put('workers/:id')
  @RequirePermission('labor', 'update')
  updateWorker(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(WorkerDto.extend({ version: z.coerce.number().int(), clear: z.array(z.enum(['residentNo', 'bankAccount'])).optional() }))) dto: z.infer<typeof WorkerDto> & { version: number; clear?: string[] }) {
    return this.svc.updateWorker(ctx, id, dto);
  }

  @Post('workers/:id/reveal')
  @HttpCode(200)
  @RequirePermission('labor', 'approve')
  reveal(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto.extend({ field: z.enum(['residentNo', 'bankAccount']) }))) dto: { field: 'residentNo' | 'bankAccount'; reason: string }) {
    return this.svc.reveal(ctx, id, dto.field, dto.reason);
  }

  @Get('records')
  @RequirePermission('labor', 'read')
  records(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) {
    return this.svc.records(ctx, q);
  }

  @Post('records')
  @RequirePermission('labor', 'create')
  record(@Ctx() ctx: AccessContext, @Body(new ZodPipe(RecordDto)) dto: z.infer<typeof RecordDto>) {
    return this.svc.record(ctx, dto);
  }

  @Put('records/:id')
  @RequirePermission('labor', 'update')
  updateRecord(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ manDays: z.coerce.number().min(0.1).max(3).transform(String), overtimeHours: z.coerce.number().min(0).max(16).transform(String), dailyWage: posAmt, workType: optText(50), memo: optText(200), version: z.coerce.number().int() }))) dto: { manDays: string; overtimeHours: string; dailyWage: string; workType?: string | null; memo?: string | null; version: number }) {
    return this.svc.updateRecord(ctx, id, dto);
  }

  @Post('records/:id/cancel')
  @HttpCode(200)
  @RequirePermission('labor', 'update')
  cancelRecord(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.cancelRecord(ctx, id, dto.reason);
  }

  @Post('records/confirm')
  @HttpCode(200)
  @RequirePermission('labor', 'approve')
  confirm(@Ctx() ctx: AccessContext, @Body(new ZodPipe(z.object({ ids: z.array(z.string().uuid()).min(1).max(1000), date: dateStr.optional() }))) dto: { ids: string[]; date?: string }) {
    return this.svc.confirm(ctx, dto.ids, dto.date ?? todayKST());
  }

  @Post('records/:id/unconfirm')
  @HttpCode(200)
  @RequirePermission('labor', 'approve')
  unconfirm(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.unconfirm(ctx, id, dto.reason);
  }

  @Get('summary')
  @RequirePermission('labor', 'read')
  summary(@Ctx() ctx: AccessContext, @Query(new ZodPipe(z.object({ from: dateStr.optional(), to: dateStr.optional() }))) q: { from?: string; to?: string }) {
    return this.svc.summary(ctx, q);
  }

  @Get('summary.xlsx')
  @RequirePermission('labor', 'export')
  exportSummary(@Ctx() ctx: AccessContext, @Query(new ZodPipe(z.object({ from: dateStr.optional(), to: dateStr.optional() }))) q: { from?: string; to?: string }, @Res() res: Response) {
    return this.svc.exportSummary(ctx, q, res);
  }
}
