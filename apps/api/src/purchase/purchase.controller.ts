import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { buildExcel, sendExcel } from '../common/excel';
import { ZodPipe } from '../common/zod.pipe';
import { renderPoPdf } from './po-pdf';
import { sealsForPdf } from '../admin/seals';
import { DB, DB_TOKEN } from '../db/db';
import { CreatePoDto, ListPoQuery, ListReceiptQuery, ReasonDto, ReceiptDto, UpdatePoDto, VersionDto } from './purchase.dto';
import { PO_STATUS_LABEL, PurchaseService } from './purchase.service';

@ApiTags('발주서')
@Controller('purchase-orders')
export class PurchaseController {
  constructor(private readonly svc: PurchaseService, private readonly audit: AuditService, @Inject(DB_TOKEN) private readonly db: DB) {}

  @Get()
  @RequirePermission('purchase', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListPoQuery)) q: z.infer<typeof ListPoQuery>) {
    return this.svc.list(ctx, q);
  }

  @Get('metrics')
  @RequirePermission('purchase', 'read')
  metrics(@Ctx() ctx: AccessContext) {
    return this.svc.metrics(ctx);
  }

  @Get('export.xlsx')
  @RequirePermission('purchase', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListPoQuery)) q: z.infer<typeof ListPoQuery>, @Res() res: Response) {
    const data = await this.svc.list(ctx, { ...q, page: 1, size: 500 });
    type R = (typeof data.rows)[number];
    const wb = await buildExcel<R>({
      sheet: '발주현황', title: '발주 현황', rows: data.rows,
      columns: [
        { header: '발주번호', key: 'code', width: 12, value: (r) => r.code },
        { header: '발주일', key: 'od', width: 12, type: 'date', value: (r) => r.orderDate },
        { header: '현장', key: 'pj', width: 28, value: (r) => `${r.projectCode} ${r.projectName}` },
        { header: '거래처', key: 'v', width: 20, value: (r) => r.vendorName },
        { header: '발주내용', key: 't', width: 28, value: (r) => r.title },
        { header: '상태', key: 's', width: 10, value: (r) => PO_STATUS_LABEL[r.status] },
        { header: '납품기한', key: 'dd', width: 12, type: 'date', value: (r) => r.deliveryDate },
        { header: '공급가액', key: 'sp', width: 15, type: 'money', value: (r) => r.supplyAmount },
        { header: '세액', key: 'vt', width: 13, type: 'money', value: (r) => r.vatAmount },
        { header: '합계', key: 'tt', width: 15, type: 'money', value: (r) => r.totalAmount },
        { header: '입고율', key: 'rr', width: 9, type: 'rate', value: (r) => r.receivedRate },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'purchase_order', summary: `발주 현황 엑셀 출력 ${data.rows.length}건` });
    await sendExcel(res, wb, `발주현황_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Get('receipts')
  @RequirePermission('receipt', 'read')
  receipts(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListReceiptQuery)) q: z.infer<typeof ListReceiptQuery>) {
    return this.svc.receipts(ctx, q);
  }

  @Post('receipts/:receiptId/cancel')
  @HttpCode(200)
  @RequirePermission('receipt', 'update')
  cancelReceipt(@Ctx() ctx: AccessContext, @Param('receiptId', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto.omit({ version: true }))) dto: { reason: string }) {
    return this.svc.cancelReceipt(ctx, id, dto.reason);
  }

  @Get(':id')
  @RequirePermission('purchase', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/pdf')
  @RequirePermission('purchase', 'export')
  async pdf(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const po = await this.svc.get(ctx, id);
    const approval = po.approval && po.approval.status !== 'CANCELLED' ? po.approval : null;
    const seals = await sealsForPdf(this.db, ctx.companyId!, approval?.steps.map((st: { actedStampId?: string | null }) => st.actedStampId) ?? []);
    const buf = await renderPoPdf({ ...po, approval, printedBy: ctx.user.name, seals });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'purchase_order', resourceId: id, summary: `발주서 PDF 출력 ${po.code} (${PO_STATUS_LABEL[po.status]})` });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`발주서_${po.code}_${po.vendor.name}.pdf`)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buf);
  }

  @Post()
  @RequirePermission('purchase', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CreatePoDto)) dto: z.infer<typeof CreatePoDto>) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('purchase', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdatePoDto)) dto: z.infer<typeof UpdatePoDto>) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('purchase', 'update')
  submit(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: z.infer<typeof VersionDto>) {
    return this.svc.submit(ctx, id, dto.version);
  }

  @Post(':id/sent')
  @HttpCode(200)
  @RequirePermission('purchase', 'update')
  sent(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VersionDto)) dto: z.infer<typeof VersionDto>) {
    return this.svc.markSent(ctx, id, dto.version);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission('purchase', 'update')
  reopen(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>) {
    return this.svc.reopen(ctx, id, dto.version, dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('purchase', 'update')
  cancel(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>) {
    return this.svc.cancel(ctx, id, dto.version, dto.reason);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('purchase', 'update')
  close(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>) {
    return this.svc.close(ctx, id, dto.version, dto.reason);
  }

  @Post(':id/receipts')
  @RequirePermission('receipt', 'create')
  receive(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReceiptDto)) dto: z.infer<typeof ReceiptDto>) {
    return this.svc.receive(ctx, id, dto);
  }
}
