import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { buildExcel, sendExcel } from '../common/excel';
import { ZodPipe } from '../common/zod.pipe';
import { HometaxCollectService } from './collect.service';
import { ListQuery, ManualInvoiceDto, PostDto, TaxInvoicesService } from './taxinvoices.service';

const VersionDto = z.object({ version: z.coerce.number().int() });
const ReasonDto = z.object({ reason: z.string().trim().min(2, '사유를 입력해 주세요').max(300) });
const MatchDto = VersionDto.extend({
  links: z.array(z.object({ receiptId: z.string().uuid(), supplyAmount: z.string().regex(/^\d{1,15}$/).optional().nullable() })).max(100),
  note: z.string().trim().max(300).optional().nullable(),
});
const CollectDto = z.object({
  direction: z.enum(['SALES', 'PURCHASE']),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  login: z.record(z.string(), z.string().max(5000)).optional(),
});
const dateQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const ReconQ = z.object({ vendorId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), from: dateQ, to: dateQ, onlyDiff: z.enum(['1']).optional() });

@ApiTags('세금계산서')
@Controller('tax-invoices')
export class TaxInvoicesController {
  constructor(private readonly svc: TaxInvoicesService, private readonly collector: HometaxCollectService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('taxinvoice', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.svc.list(ctx, q);
  }

  @Get('export.xlsx')
  @RequirePermission('taxinvoice', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>, @Res() res: Response) {
    const d = await this.svc.list(ctx, { ...q, page: 1, size: 500 });
    type R = (typeof d.rows)[number];
    const wb = await buildExcel<R>({
      sheet: '세금계산서', title: `${q.direction === 'PURCHASE' ? '매입' : '매출'} 세금계산서`, rows: d.rows,
      columns: [
        { header: '관리번호', key: 'c', width: 12, value: (r) => r.code },
        { header: '작성일자', key: 'd', width: 11, type: 'date', value: (r) => r.writeDate },
        { header: '승인번호', key: 'a', width: 26, value: (r) => r.approvalNo },
        { header: '거래처', key: 'n', width: 22, value: (r) => r.counterpartName },
        { header: '사업자번호', key: 'b', width: 13, value: (r) => r.counterpartBizNo },
        { header: '현장', key: 'p', width: 20, value: (r) => r.projectName },
        { header: '공급가액', key: 's', width: 14, type: 'money', value: (r) => r.supplyAmount },
        { header: '세액', key: 'v', width: 12, type: 'money', value: (r) => r.vatAmount },
        { header: '합계', key: 't', width: 14, type: 'money', value: (r) => r.totalAmount },
        { header: '검수 차이', key: 'df', width: 12, type: 'money', value: (r) => r.matchDiff },
        { header: '상태', key: 'st', width: 9, value: (r) => (r.isTestIssue ? '가상 발행' : r.statusLabel) },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'tax_invoice', summary: `세금계산서 엑셀 출력 ${d.rows.length}건` });
    await sendExcel(res, wb, `세금계산서_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Get('reconcile')
  @RequirePermission('taxinvoice', 'read')
  reconcile(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ReconQ)) q: z.infer<typeof ReconQ>) {
    return this.svc.reconcile(ctx, { ...q, onlyDiff: !!q.onlyDiff });
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  import(@Ctx() ctx: AccessContext, @UploadedFile() file: Express.Multer.File, @Query('direction') direction: string, @Query('dryRun') dryRun: string) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: '파일을 선택해 주세요' });
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException({ code: 'BAD_FILE', message: '홈택스에서 내려받은 .xlsx 파일만 올릴 수 있습니다 (.xls는 엑셀에서 .xlsx로 저장 후 올려 주세요)' });
    return this.svc.importExcel(ctx, direction === 'SALES' ? 'SALES' : 'PURCHASE', file.buffer, dryRun !== 'false');
  }

  @Post('collect')
  @HttpCode(202)
  @RequirePermission('taxinvoice', 'create')
  collect(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CollectDto)) dto: z.infer<typeof CollectDto>) {
    return this.collector.start(ctx, dto);
  }

  @Get('collect/:jobId')
  @RequirePermission('taxinvoice', 'read')
  collectStatus(@Ctx() ctx: AccessContext, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.collector.status(ctx, jobId);
  }

  @Post('collect/:jobId/continue')
  @HttpCode(202)
  @RequirePermission('taxinvoice', 'create')
  collectContinue(@Ctx() ctx: AccessContext, @Param('jobId', ParseUUIDPipe) jobId: string, @Body(new ZodPipe(z.object({ answer: z.record(z.string(), z.string().max(200)).default({}) }))) dto: { answer: Record<string, string> }) {
    return this.collector.continue(ctx, jobId, dto.answer);
  }

  @Post('vendor-status')
  @HttpCode(200)
  @RequirePermission('vendor', 'update')
  vendorStatus(@Ctx() ctx: AccessContext, @Body(new ZodPipe(z.object({ vendorIds: z.array(z.string().uuid()).max(1000).optional() }))) dto: { vendorIds?: string[] }) {
    return this.collector.checkVendors(ctx, dto.vendorIds);
  }

  @Get(':id')
  @RequirePermission('taxinvoice', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/candidates')
  @RequirePermission('taxinvoice', 'read')
  candidates(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.candidates(ctx, id);
  }

  @Post()
  @RequirePermission('taxinvoice', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(ManualInvoiceDto)) dto: z.infer<typeof ManualInvoiceDto>) {
    return this.svc.createManual(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('taxinvoice', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ManualInvoiceDto.extend({ version: z.coerce.number().int() }))) dto: z.infer<typeof ManualInvoiceDto> & { version: number }) {
    return this.svc.updateDraft(ctx, id, dto);
  }

  @Post(':id/match')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'update')
  match(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(MatchDto)) dto: z.infer<typeof MatchDto>) {
    return this.svc.match(ctx, id, dto.version, dto.links, dto.note);
  }

  @Post(':id/auto-match')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'update')
  autoMatch(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: { version: number }) {
    return this.svc.autoMatch(ctx, id, dto.version);
  }

  @Post(':id/post')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'approve')
  post(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PostDto)) dto: z.infer<typeof PostDto>) {
    return this.svc.post(ctx, id, dto);
  }

  @Post(':id/unpost')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'approve')
  unpost(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.unpost(ctx, id, dto.reason);
  }

  @Post(':id/ignore')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'update')
  ignore(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.ignore(ctx, id, dto.reason);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'update')
  restore(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ignore(ctx, id, '', true);
  }

  @Post(':id/vendor')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'update')
  setVendor(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ vendorId: z.string().uuid().optional(), create: z.boolean().optional() }))) dto: { vendorId?: string; create?: boolean }) {
    if (dto.create) return this.svc.createVendorFrom(ctx, id);
    if (!dto.vendorId) throw new BadRequestException({ code: 'NEED_VENDOR', message: '거래처를 선택해 주세요' });
    return this.svc.setVendor(ctx, id, dto.vendorId);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'create')
  submit(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: { version: number }) {
    return this.svc.submit(ctx, id, dto.version);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'approve')
  issue(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto.extend({ confirm: z.string().max(200).default('') }))) dto: { version: number; confirm: string }) {
    return this.svc.issue(ctx, id, dto.version, dto.confirm);
  }

  @Post(':id/refresh')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'read')
  refresh(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.refreshStatus(ctx, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('taxinvoice', 'approve')
  cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: { reason: string }) {
    return this.svc.cancelIssue(ctx, id, dto.reason);
  }
}
