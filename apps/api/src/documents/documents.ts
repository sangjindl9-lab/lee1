/**
 * 문서 스캔 — 발주서·거래명세표·자재납품서·세금계산서·영수증을 올리면 품목·금액을 읽어 초안을 만든다.
 *  업로드 → 인식(OCR/AI) → 사람이 확인·수정 → 발주서 초안 / 매입 세금계산서 / 지급결의 초안으로 등록
 *  - 인식 결과는 사람이 확인하기 전에는 어떤 확정 자료도 만들지 않는다
 *  - 같은 파일(SHA-256)은 두 번 올릴 수 없고, 같은 거래처·문서번호·금액 문서는 중복 경고
 *  - 원본 파일은 보존하고 인식 원본(extracted)과 사람이 고친 값(reviewed)을 따로 남긴다
 */
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, desc, eq, ilike, inArray, isNull, ne, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto';
import { notFound } from '../common/errors';
import { NumberingService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { companies, documents, fileObjects, projects, vendors } from '../db/schema';
import { FilesService } from '../files/files';
import { IntegrationsService } from '../integrations/integrations';
import { Extraction } from '../integrations/types';
import { PayReqDto, PaymentsService } from '../payments/payments';
import { CreatePoDto } from '../purchase/purchase.dto';
import { PurchaseService } from '../purchase/purchase.service';
import { ManualInvoiceDto, TaxInvoicesService } from '../taxinvoices/taxinvoices.service';

export const DOC_TYPES = {
  STATEMENT: '거래명세표', DELIVERY: '자재납품서', ISSUED_PO: '구매발주서 (우리가 보낸)', RECEIVED_PO: '발주서 (받은)', QUOTE: '견적서', TAX_INVOICE: '세금계산서 (종이·PDF)', RECEIPT: '영수증',
} as const;
type DocType = keyof typeof DOC_TYPES;
const STATUS_LABEL = { UPLOADED: '인식 대기', EXTRACTED: '확인 필요', FAILED: '인식 실패', REGISTERED: '등록 완료', REJECTED: '반려' } as const;

const ListQ = z.object({
  status: z.enum(['UPLOADED', 'EXTRACTED', 'FAILED', 'REGISTERED', 'REJECTED', 'OPEN']).optional(),
  docType: z.string().max(20).optional(), q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(200).default(50),
});
const ReviewDto = z.object({
  vendorId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  data: z.record(z.string(), z.unknown()),
});
const RegisterDto = z.discriminatedUnion('target', [
  z.object({ target: z.literal('PURCHASE_ORDER'), payload: CreatePoDto }),
  z.object({ target: z.literal('TAX_INVOICE'), payload: ManualInvoiceDto }),
  z.object({ target: z.literal('PAYMENT_REQUEST'), payload: PayReqDto }),
  z.object({ target: z.literal('PROJECT_FILE'), payload: z.object({ projectId: z.string().uuid() }) }),
]);

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly files: FilesService,
    private readonly integrations: IntegrationsService,
    private readonly purchase: PurchaseService,
    private readonly invoices: TaxInvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  private scope(ctx: AccessContext): SQL {
    const c = eq(documents.companyId, ctx.companyId!);
    if (ctx.scope === 'ASSIGNED') return and(c, or(eq(documents.createdById, ctx.user.id), ctx.assignedProjectIds.length ? inArray(documents.projectId, ctx.assignedProjectIds) : sql`false`))!;
    return c;
  }

  private async load(ctx: AccessContext, id: string) {
    const [d] = await this.db.select().from(documents).where(and(eq(documents.id, id), this.scope(ctx)));
    if (!d) throw notFound('문서');
    return d;
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListQ>) {
    const conds: SQL[] = [this.scope(ctx)];
    if (q.status === 'OPEN') conds.push(inArray(documents.status, ['UPLOADED', 'EXTRACTED', 'FAILED']));
    else if (q.status) conds.push(eq(documents.status, q.status));
    if (q.docType) conds.push(eq(documents.docType, q.docType));
    if (q.q) conds.push(or(ilike(documents.code, `%${q.q}%`), ilike(fileObjects.originalName, `%${q.q}%`), ilike(vendors.name, `%${q.q}%`))!);
    const where = and(...conds);
    const [agg] = await this.db.select({
      count: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${documents.status} in ('UPLOADED','EXTRACTED','FAILED'))::int`,
    }).from(documents).leftJoin(fileObjects, eq(fileObjects.id, documents.fileId)).leftJoin(vendors, eq(vendors.id, documents.vendorId)).where(where);
    const rows = await this.db.select({ d: documents, fileName: fileObjects.originalName, mimeType: fileObjects.mimeType, size: fileObjects.size, vendorName: vendors.name, projectName: projects.name })
      .from(documents).leftJoin(fileObjects, eq(fileObjects.id, documents.fileId)).leftJoin(vendors, eq(vendors.id, documents.vendorId)).leftJoin(projects, eq(projects.id, documents.projectId))
      .where(where).orderBy(desc(documents.createdAt)).limit(q.size).offset((q.page - 1) * q.size);
    return {
      total: agg.count, open: agg.open, page: q.page, size: q.size,
      rows: rows.map(({ d, ...x }) => ({ ...d, ...x, extracted: undefined, reviewed: undefined, statusLabel: STATUS_LABEL[d.status], docTypeLabel: DOC_TYPES[d.docType as DocType] ?? d.docType, lineCount: ((d.reviewed ?? d.extracted) as Extraction | null)?.lines?.length ?? 0, totalAmount: ((d.reviewed ?? d.extracted) as Extraction | null)?.totalAmount ?? null })),
    };
  }

  async get(ctx: AccessContext, id: string) {
    const d = await this.load(ctx, id);
    const [[file], [vendor], [project], [dup]] = await Promise.all([
      this.db.select({ id: fileObjects.id, originalName: fileObjects.originalName, mimeType: fileObjects.mimeType, size: fileObjects.size }).from(fileObjects).where(eq(fileObjects.id, d.fileId)),
      d.vendorId ? this.db.select({ id: vendors.id, name: vendors.name, bizRegNo: vendors.bizRegNo }).from(vendors).where(eq(vendors.id, d.vendorId)) : Promise.resolve([null]),
      d.projectId ? this.db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).where(eq(projects.id, d.projectId)) : Promise.resolve([null]),
      d.duplicateOfId ? this.db.select({ id: documents.id, code: documents.code, status: documents.status, registeredType: documents.registeredType, registeredId: documents.registeredId }).from(documents).where(eq(documents.id, d.duplicateOfId)) : Promise.resolve([null]),
    ]);
    return { ...d, statusLabel: STATUS_LABEL[d.status], docTypeLabel: DOC_TYPES[d.docType as DocType] ?? d.docType, file, vendor, project, duplicateOf: dup ?? null, registeredHref: this.href(d.registeredType, d.registeredId) };
  }

  private href(type: string | null, id: string | null) {
    if (!type || !id) return null;
    return { PURCHASE_ORDER: `/purchase-orders/${id}`, TAX_INVOICE: `/tax-invoices/${id}`, PAYMENT_REQUEST: `/payment-requests/${id}`, PROJECT_FILE: `/projects/${id}` }[type] ?? null;
  }

  async upload(ctx: AccessContext, file: Express.Multer.File | undefined, docType: string, projectId?: string | null, autoExtract = true) {
    if (!(docType in DOC_TYPES)) throw new BadRequestException({ code: 'BAD_DOC_TYPE', message: '문서 종류를 골라 주세요' });
    if (projectId && !this.access.canSeeProject(ctx, projectId)) throw new BadRequestException({ code: 'BAD_PROJECT', message: '현장을 다시 선택해 주세요' });
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: '파일을 선택해 주세요' });
    const hash = sha256(file.buffer);
    const [same] = await this.db.select({ id: documents.id, code: documents.code, status: documents.status }).from(documents).where(and(eq(documents.companyId, ctx.companyId!), eq(documents.fileSha256, hash), ne(documents.status, 'REJECTED')));
    if (same) throw new ConflictException({ code: 'DUPLICATE_FILE', message: `같은 파일이 이미 올라와 있습니다 (${same.code}, ${STATUS_LABEL[same.status]})`, details: { documentId: same.id } });
    const f = await this.files.storeScan(ctx, file, projectId);
    const d = await this.db.transaction(async (tx) => {
      const code = await this.numbering.yearly(tx, ctx.companyId!, 'DS');
      const [d] = await tx.insert(documents).values({ companyId: ctx.companyId!, code, docType, fileId: f.id, fileSha256: hash, projectId: projectId ?? null, createdById: ctx.user.id, updatedById: ctx.user.id }).onConflictDoNothing().returning();
      if (!d) throw new ConflictException({ code: 'DUPLICATE_FILE', message: '같은 파일이 이미 올라와 있습니다' });
      await this.audit.fromCtx(ctx, { action: 'UPLOAD', resource: 'document', resourceId: d.id, summary: `문서 스캔 업로드 ${code} ${DOC_TYPES[docType as DocType]} ${f.originalName}` }, tx);
      return d;
    });
    if (autoExtract) return this.extract(ctx, d.id).catch(() => this.get(ctx, d.id));
    return this.get(ctx, d.id);
  }

  async extract(ctx: AccessContext, id: string) {
    const d = await this.load(ctx, id);
    if (d.status === 'REGISTERED' || d.status === 'REJECTED') throw new ConflictException({ code: 'LOCKED', message: '등록·반려된 문서는 다시 인식하지 않습니다' });
    const r = await this.integrations.require(ctx.companyId!, 'OCR');
    const { file, buffer } = await this.files.readBuffer(d.fileId, ctx.companyId!);
    try {
      const { value } = await this.integrations.run(ctx, 'OCR', r.providerId, r.pc.mode, 'EXTRACT', () => r.provider.extract(r.pc, { buffer, mimeType: file.mimeType, name: file.originalName }, { docType: d.docType }), { summary: `${d.code} ${file.originalName}`, attempts: 2, resultOf: (v) => ({ lines: v.lines.length, confidence: v.confidence }) });
      const ex = value;
      // 거래처 찾기: 문서의 사업자번호 중 우리 회사 번호가 아닌 것
      const [co] = await this.db.select({ bizRegNo: companies.bizRegNo }).from(companies).where(eq(companies.id, ctx.companyId!));
      const candidates = [...new Set([ex.vendorBizNo, ...(ex.allBizNos ?? [])].filter((b): b is string => !!b && b !== co.bizRegNo))];
      let vendorId: string | null = d.vendorId;
      if (!vendorId && candidates.length) {
        const [v] = await this.db.select({ id: vendors.id, bizRegNo: vendors.bizRegNo }).from(vendors).where(and(eq(vendors.companyId, ctx.companyId!), inArray(vendors.bizRegNo, candidates), isNull(vendors.deletedAt))).limit(1);
        vendorId = v?.id ?? null;
        if (v && v.bizRegNo !== ex.vendorBizNo) ex.vendorBizNo = v.bizRegNo;
      }
      if (!vendorId && ex.vendorName) {
        const [v] = await this.db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.companyId, ctx.companyId!), eq(vendors.name, ex.vendorName), isNull(vendors.deletedAt))).limit(1);
        vendorId = v?.id ?? null;
      }
      const dupKey = this.dupKey(d.docType, vendorId ?? ex.vendorBizNo ?? ex.vendorName, ex.docNo, ex.totalAmount ?? ex.supplyAmount, ex.docDate);
      const [dup] = dupKey ? await this.db.select({ id: documents.id }).from(documents).where(and(eq(documents.companyId, ctx.companyId!), eq(documents.duplicateKey, dupKey), ne(documents.id, id), ne(documents.status, 'REJECTED'))).limit(1) : [];
      await this.db.update(documents).set({
        status: 'EXTRACTED', provider: r.providerId, providerMode: r.pc.mode, confidence: String(ex.confidence), extracted: ex as never, reviewed: null, vendorId, duplicateKey: dupKey, duplicateOfId: dup?.id ?? null, errorMessage: null, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${documents.version} + 1`,
      }).where(eq(documents.id, id));
    } catch (e) {
      await this.db.update(documents).set({ status: 'FAILED', provider: r.providerId, errorMessage: (e as Error).message.slice(0, 500), updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
      throw new BadRequestException({ code: 'EXTRACT_FAILED', message: `인식하지 못했습니다: ${(e as Error).message}` });
    }
    return this.get(ctx, id);
  }

  private dupKey(docType: string, who: string | null | undefined, docNo: string | null | undefined, amount: string | null | undefined, date: string | null | undefined) {
    if (!who || (!docNo && !amount)) return null;
    return sha256([docType, who, docNo ?? '', amount ?? '', docNo ? '' : date ?? ''].join('|')).slice(0, 40);
  }

  async review(ctx: AccessContext, id: string, dto: z.infer<typeof ReviewDto>) {
    const d = await this.load(ctx, id);
    if (!['EXTRACTED', 'FAILED', 'UPLOADED'].includes(d.status)) throw new ConflictException({ code: 'LOCKED', message: '등록·반려된 문서는 고칠 수 없습니다' });
    if (dto.projectId && !this.access.canSeeProject(ctx, dto.projectId)) throw new BadRequestException({ code: 'BAD_PROJECT', message: '현장을 다시 선택해 주세요' });
    const data = dto.data as Partial<Extraction>;
    const dupKey = this.dupKey(d.docType, dto.vendorId ?? data.vendorBizNo ?? data.vendorName, data.docNo, data.totalAmount ?? data.supplyAmount, data.docDate);
    const [dup] = dupKey ? await this.db.select({ id: documents.id }).from(documents).where(and(eq(documents.companyId, ctx.companyId!), eq(documents.duplicateKey, dupKey), ne(documents.id, id), ne(documents.status, 'REJECTED'))).limit(1) : [];
    await this.db.update(documents).set({ reviewed: dto.data as never, vendorId: dto.vendorId ?? null, projectId: dto.projectId ?? null, duplicateKey: dupKey, duplicateOfId: dup?.id ?? null, status: d.status === 'UPLOADED' || d.status === 'FAILED' ? 'EXTRACTED' : d.status, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
    return this.get(ctx, id);
  }

  /** 확인한 내용으로 실제 문서 만들기 — 각 모듈의 검증·권한을 그대로 거친다 */
  async register(ctx: AccessContext, id: string, dto: z.infer<typeof RegisterDto>, allowDuplicate: boolean) {
    const d = await this.load(ctx, id);
    if (d.status === 'REGISTERED') throw new ConflictException({ code: 'ALREADY', message: '이미 등록된 문서입니다' });
    if (d.status === 'REJECTED') throw new ConflictException({ code: 'REJECTED', message: '반려된 문서입니다' });
    if (d.duplicateOfId && !allowDuplicate) throw new ConflictException({ code: 'POSSIBLE_DUPLICATE', message: '같은 거래처·문서번호·금액의 문서가 이미 있습니다. 확인 후 "중복 아님"으로 다시 등록하세요' });
    const need = { PURCHASE_ORDER: ['purchase', 'create'], TAX_INVOICE: ['taxinvoice', 'create'], PAYMENT_REQUEST: ['expense', 'create'], PROJECT_FILE: ['project', 'update'] }[dto.target] as [string, string];
    if (!ctx.permissions.has(`${need[0]}:${need[1]}`)) throw new BadRequestException({ code: 'FORBIDDEN', message: '이 문서로 등록할 권한이 없습니다' });
    let registeredId: string;
    if (dto.target === 'PURCHASE_ORDER') registeredId = (await this.purchase.create(ctx, dto.payload)).id;
    else if (dto.target === 'TAX_INVOICE') registeredId = (await this.invoices.createManual(ctx, { ...dto.payload, direction: 'PURCHASE' }, 'OCR')).id;
    else if (dto.target === 'PAYMENT_REQUEST') registeredId = (await this.payments.create(ctx, dto.payload)).id;
    else {
      if (!this.access.canSeeProject(ctx, dto.payload.projectId)) throw new BadRequestException({ code: 'BAD_PROJECT', message: '현장을 다시 선택해 주세요' });
      await this.db.update(fileObjects).set({ projectId: dto.payload.projectId, category: 'etc' }).where(eq(fileObjects.id, d.fileId));
      registeredId = dto.payload.projectId;
    }
    await this.db.update(documents).set({ status: 'REGISTERED', registeredType: dto.target, registeredId, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
    await this.audit.fromCtx(ctx, { action: 'REGISTER', resource: 'document', resourceId: id, summary: `스캔 문서 ${d.code} → ${{ PURCHASE_ORDER: '발주서 초안', TAX_INVOICE: '매입 세금계산서', PAYMENT_REQUEST: '지급결의 초안', PROJECT_FILE: '현장 첨부' }[dto.target]} 등록${d.duplicateOfId ? ' (중복 아님 확인)' : ''}` });
    return { id, registeredType: dto.target, registeredId, href: this.href(dto.target, registeredId) };
  }

  async reject(ctx: AccessContext, id: string, reason: string) {
    const d = await this.load(ctx, id);
    if (d.status === 'REGISTERED') throw new ConflictException({ code: 'LOCKED', message: '등록된 문서는 반려할 수 없습니다. 만들어진 문서를 취소하세요' });
    await this.db.update(documents).set({ status: 'REJECTED', rejectReason: reason, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${documents.version} + 1` }).where(eq(documents.id, id));
    await this.audit.fromCtx(ctx, { action: 'REJECT', resource: 'document', resourceId: id, summary: `스캔 문서 반려 ${d.code} — ${reason}` });
    return this.get(ctx, id);
  }

  async file(ctx: AccessContext, id: string, res: Response) {
    const d = await this.load(ctx, id);
    await this.files.streamRaw(d.fileId, ctx.companyId!, res, true);
  }
}

@ApiTags('문서 스캔')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly svc: DocumentsService) {}

  @Get('types')
  @RequirePermission('document', 'read')
  types() {
    return Object.entries(DOC_TYPES).map(([value, label]) => ({ value, label }));
  }

  @Get()
  @RequirePermission('document', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) {
    return this.svc.list(ctx, q);
  }

  @Get(':id')
  @RequirePermission('document', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/file')
  @RequirePermission('document', 'read')
  file(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.svc.file(ctx, id, res);
  }

  @Post()
  @RequirePermission('document', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(@Ctx() ctx: AccessContext, @UploadedFile() file: Express.Multer.File, @Body(new ZodPipe(z.object({ docType: z.string().max(20), projectId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)), extract: z.enum(['0', '1']).default('1') }))) dto: { docType: string; projectId?: string; extract: '0' | '1' }) {
    return this.svc.upload(ctx, file, dto.docType, dto.projectId, dto.extract === '1');
  }

  @Post(':id/extract')
  @HttpCode(200)
  @RequirePermission('document', 'create')
  extract(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.extract(ctx, id);
  }

  @Put(':id/review')
  @RequirePermission('document', 'update')
  review(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReviewDto)) dto: z.infer<typeof ReviewDto>) {
    return this.svc.review(ctx, id, dto);
  }

  @Post(':id/register')
  @HttpCode(200)
  @RequirePermission('document', 'update')
  register(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ allowDuplicate: z.boolean().default(false) }).and(RegisterDto))) dto: z.infer<typeof RegisterDto> & { allowDuplicate: boolean }) {
    return this.svc.register(ctx, id, dto, dto.allowDuplicate);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('document', 'update')
  reject(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(2, '사유를 입력해 주세요').max(300) }))) dto: { reason: string }) {
    return this.svc.reject(ctx, id, dto.reason);
  }
}
