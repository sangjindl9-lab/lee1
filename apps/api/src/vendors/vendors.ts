import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, asc, desc, eq, ilike, isNull, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { isValidBizNo, normalizeBizNo } from '../common/bizno';
import { decryptField, encryptField, maskAccount } from '../common/crypto';
import { diffOnly } from '../common/diff';
import { notFound, staleVersion } from '../common/errors';
import { buildExcel, sendExcel } from '../common/excel';
import { NumberingService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { fileObjects, vendors } from '../db/schema';
import { ConflictException } from '@nestjs/common';

const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

const VendorBase = z.object({
  name: z.string().trim().min(1, '업체명을 입력해 주세요').max(200),
  vendorType: z.enum(['SUPPLIER', 'SUBCONTRACTOR', 'CLIENT', 'BOTH']).default('SUPPLIER'),
  bizRegNo: z
    .string().optional().nullable()
    .transform((v) => (v ? normalizeBizNo(v) : null))
    .refine((v) => v === null || isValidBizNo(v), '사업자등록번호가 올바르지 않습니다 (검증번호 불일치)'),
  ceoName: optText(50),
  address: optText(300),
  businessType: optText(100),
  businessItem: optText(100),
  contactName: optText(50),
  contactPhone: optText(30),
  email: z.string().trim().max(120).email('이메일 형식이 올바르지 않습니다').optional().nullable().or(z.literal('').transform(() => null)),
  phone: optText(30),
  fax: optText(30),
  bankName: optText(50),
  /** 계좌번호: 입력 시에만 변경. 빈 값을 보내면 유지, null 을 보내면 삭제 */
  bankAccount: z.string().trim().max(40).regex(/^[0-9-\s]*$/, '계좌번호는 숫자와 - 만 입력해 주세요').optional().nullable(),
  bankHolder: optText(50),
  paymentTerms: optText(100),
  bizStatus: z.enum(['UNKNOWN', 'ACTIVE', 'SUSPENDED', 'CLOSED']).default('UNKNOWN'),
  memo: optText(2000),
});
const CreateVendorDto = VendorBase;
const UpdateVendorDto = VendorBase.extend({ version: z.coerce.number().int().positive() });
const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  vendorType: z.enum(['SUPPLIER', 'SUBCONTRACTOR', 'CLIENT', 'BOTH']).optional(),
  bizStatus: z.enum(['UNKNOWN', 'ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
  sort: z.enum(['code', 'name', 'createdAt']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
});

type VendorRow = typeof vendors.$inferSelect;
const present = ({ bankAccountEnc, ...v }: VendorRow) => ({ ...v, hasBankAccount: !!bankAccountEnc });

export const VENDOR_TYPE_LABEL = { SUPPLIER: '매입처', SUBCONTRACTOR: '협력업체', CLIENT: '발주처', BOTH: '매출·매입' } as const;
export const BIZ_STATUS_LABEL = { UNKNOWN: '미확인', ACTIVE: '계속사업자', SUSPENDED: '휴업', CLOSED: '폐업' } as const;

@Injectable()
export class VendorsService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  private base(ctx: AccessContext) {
    return and(eq(vendors.companyId, ctx.companyId!), isNull(vendors.deletedAt))!;
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListQuery>) {
    const conds: SQL[] = [this.base(ctx)];
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      const digits = q.q.replace(/[^0-9]/g, '');
      conds.push(or(ilike(vendors.name, like), ilike(vendors.code, like), ilike(vendors.contactName, like), ...(digits.length >= 3 ? [ilike(vendors.bizRegNo, `%${digits}%`)] : []))!);
    }
    if (q.vendorType) conds.push(eq(vendors.vendorType, q.vendorType));
    if (q.bizStatus) conds.push(eq(vendors.bizStatus, q.bizStatus));
    const where = and(...conds);
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(vendors).where(where);
    const col = { code: vendors.code, name: vendors.name, createdAt: vendors.createdAt }[q.sort];
    const rows = await this.db.select().from(vendors).where(where).orderBy(q.dir === 'asc' ? asc(col) : desc(col)).limit(q.size).offset((q.page - 1) * q.size);
    return { total: count, page: q.page, size: q.size, rows: rows.map(present) };
  }

  async get(ctx: AccessContext, id: string) {
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, id), this.base(ctx)));
    if (!v) throw notFound('거래처');
    const files = await this.db
      .select({ id: fileObjects.id, category: fileObjects.category, originalName: fileObjects.originalName, size: fileObjects.size, mimeType: fileObjects.mimeType, createdAt: fileObjects.createdAt })
      .from(fileObjects)
      .where(and(eq(fileObjects.vendorId, id), eq(fileObjects.companyId, ctx.companyId!), isNull(fileObjects.deletedAt)));
    return { ...present(v), files };
  }

  /** 계좌번호 원문 조회 — 별도 권한(수정 권한) 필요, 조회 사실을 감사로그에 남긴다 */
  async revealAccount(ctx: AccessContext, id: string) {
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, id), this.base(ctx)));
    if (!v) throw notFound('거래처');
    await this.audit.fromCtx(ctx, { action: 'VIEW_SENSITIVE', resource: 'vendor', resourceId: id, summary: `계좌번호 원문 조회 ${v.name}` });
    return { bankAccount: v.bankAccountEnc ? decryptField(v.bankAccountEnc) : null };
  }

  private async assertUniqueBizNo(ctx: AccessContext, bizRegNo: string | null, exceptId?: string) {
    if (!bizRegNo) return;
    const [dup] = await this.db
      .select({ id: vendors.id, name: vendors.name, code: vendors.code })
      .from(vendors)
      .where(and(this.base(ctx), eq(vendors.bizRegNo, bizRegNo)));
    if (dup && dup.id !== exceptId) {
      throw new ConflictException({ code: 'DUPLICATE_BIZNO', message: `같은 사업자등록번호로 이미 등록된 거래처가 있습니다: ${dup.code} ${dup.name}`, fields: [{ field: 'bizRegNo', message: '중복된 사업자등록번호' }] });
    }
  }

  private fields(dto: z.infer<typeof VendorBase>) {
    const { bankAccount, ...rest } = dto;
    const out: Partial<typeof vendors.$inferInsert> = { ...rest };
    if (bankAccount === null) {
      out.bankAccountEnc = null;
      out.bankAccountMask = null;
    } else if (bankAccount && bankAccount.replace(/[^0-9]/g, '').length) {
      out.bankAccountEnc = encryptField(bankAccount.replace(/\s/g, ''));
      out.bankAccountMask = maskAccount(bankAccount);
    }
    return out;
  }

  async create(ctx: AccessContext, dto: z.infer<typeof CreateVendorDto>) {
    await this.assertUniqueBizNo(ctx, dto.bizRegNo);
    return this.db.transaction(async (tx) => {
      const code = await this.numbering.vendorCode(tx, ctx.companyId!);
      const [v] = await tx.insert(vendors).values({ companyId: ctx.companyId!, code, name: dto.name, ...this.fields(dto), createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'vendor', resourceId: v.id, summary: `거래처 등록 ${v.code} ${v.name}`, after: present(v) }, tx);
      return present(v);
    });
  }

  async update(ctx: AccessContext, id: string, dto: z.infer<typeof UpdateVendorDto>) {
    const [before] = await this.db.select().from(vendors).where(and(eq(vendors.id, id), this.base(ctx)));
    if (!before) throw notFound('거래처');
    await this.assertUniqueBizNo(ctx, dto.bizRegNo, id);
    const { version, ...rest } = dto;
    return this.db.transaction(async (tx) => {
      const [v] = await tx
        .update(vendors)
        .set({ ...this.fields(rest), updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${vendors.version} + 1` })
        .where(and(eq(vendors.id, id), eq(vendors.version, version)))
        .returning();
      if (!v) throw staleVersion();
      const d = diffOnly(present(before), present(v));
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'vendor', resourceId: id, summary: `거래처 수정 ${v.code} ${v.name}`, before: d.before, after: d.after }, tx);
      return present(v);
    });
  }

  async remove(ctx: AccessContext, id: string, version: number) {
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, id), this.base(ctx)));
    if (!v) throw notFound('거래처');
    // 2단계부터: 발주·세금계산서·지급 이력이 있으면 삭제 불가 검사가 여기에 추가된다
    await this.db.transaction(async (tx) => {
      const [r] = await tx.update(vendors).set({ deletedAt: new Date(), version: sql`${vendors.version} + 1` }).where(and(eq(vendors.id, id), eq(vendors.version, version))).returning({ id: vendors.id });
      if (!r) throw staleVersion();
      await this.audit.fromCtx(ctx, { action: 'DELETE', resource: 'vendor', resourceId: id, summary: `거래처 삭제 ${v.code} ${v.name}`, before: present(v) }, tx);
    });
  }
}

@ApiTags('거래처')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly svc: VendorsService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('vendor', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.svc.list(ctx, q);
  }

  @Get('export.xlsx')
  @RequirePermission('vendor', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>, @Res() res: Response) {
    const data = await this.svc.list(ctx, { ...q, page: 1, size: 500 });
    const wb = await buildExcel({
      sheet: '거래처', title: '거래처 목록', rows: data.rows,
      columns: [
        { header: '코드', key: 'code', width: 10, value: (r) => r.code },
        { header: '업체명', key: 'name', width: 28, value: (r) => r.name },
        { header: '구분', key: 'type', width: 10, value: (r) => VENDOR_TYPE_LABEL[r.vendorType] },
        { header: '사업자등록번호', key: 'biz', width: 15, value: (r) => (r.bizRegNo ? `${r.bizRegNo.slice(0, 3)}-${r.bizRegNo.slice(3, 5)}-${r.bizRegNo.slice(5)}` : '') },
        { header: '대표자', key: 'ceo', width: 10, value: (r) => r.ceoName },
        { header: '담당자', key: 'contact', width: 10, value: (r) => r.contactName },
        { header: '연락처', key: 'phone', width: 14, value: (r) => r.contactPhone ?? r.phone },
        { header: '이메일', key: 'email', width: 22, value: (r) => r.email },
        { header: '은행', key: 'bank', width: 10, value: (r) => r.bankName },
        { header: '계좌(마스킹)', key: 'acc', width: 18, value: (r) => r.bankAccountMask },
        { header: '결제조건', key: 'terms', width: 14, value: (r) => r.paymentTerms },
        { header: '사업자상태', key: 'st', width: 10, value: (r) => BIZ_STATUS_LABEL[r.bizStatus] },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'vendor', summary: `거래처 엑셀 출력 ${data.rows.length}건` });
    await sendExcel(res, wb, `거래처목록_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Get(':id')
  @RequirePermission('vendor', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post(':id/reveal-account')
  @HttpCode(200)
  @RequirePermission('vendor', 'update')
  reveal(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revealAccount(ctx, id);
  }

  @Post()
  @RequirePermission('vendor', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CreateVendorDto)) dto: z.infer<typeof CreateVendorDto>) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('vendor', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateVendorDto)) dto: z.infer<typeof UpdateVendorDto>) {
    return this.svc.update(ctx, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('vendor', 'delete')
  async remove(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Query('version') version: string) {
    await this.svc.remove(ctx, id, Number(version));
  }
}
