import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Put, Query, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { diffOnly } from '../common/diff';
import { notFound, staleVersion } from '../common/errors';
import { buildExcel, sendExcel } from '../common/excel';
import { D } from '../common/money';
import { NumberingService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { materials, vendorPrices, vendors } from '../db/schema';

const TRADE = { 전기: 'ELECTRIC', 통신: 'TELECOM', 정보통신: 'TELECOM', 건축: 'BUILDING', 공통: 'COMMON' } as const;
const TRADE_LABEL: Record<string, string> = { ELECTRIC: '전기', TELECOM: '통신', BUILDING: '건축', COMMON: '공통' };
const TAX = { 과세: 'TAXABLE', 면세: 'EXEMPT', 영세: 'ZERO' } as const;
const TAX_LABEL = { TAXABLE: '과세', EXEMPT: '면세', ZERO: '영세' } as const;

const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const priceStr = z.union([z.string(), z.number()]).transform((v) => String(v ?? '0').replace(/,/g, '').trim() || '0').refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v), '단가는 0 이상의 숫자로 입력해 주세요');

const MaterialBase = z.object({
  code: z.string().trim().max(30).regex(/^[A-Za-z0-9._-]*$/, '자재코드는 영문·숫자·._- 만 쓸 수 있습니다').optional().nullable().transform((v) => (v ? v.toUpperCase() : null)),
  name: z.string().trim().min(1, '자재명을 입력해 주세요').max(200),
  spec: optText(200),
  maker: optText(100),
  unit: z.string().trim().min(1, '단위를 입력해 주세요').max(20),
  category: optText(50),
  tradeType: z.enum(['ELECTRIC', 'TELECOM', 'BUILDING', 'COMMON']).optional().nullable(),
  defaultPrice: priceStr.default('0'),
  taxType: z.enum(['TAXABLE', 'EXEMPT', 'ZERO']).default('TAXABLE'),
  memo: optText(1000),
  isActive: z.boolean().default(true),
});
const UpdateDto = MaterialBase.extend({ version: z.coerce.number().int().positive() });
const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  tradeType: z.enum(['ELECTRIC', 'TELECOM', 'BUILDING', 'COMMON']).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  vendorId: z.string().uuid().optional(), // 이 거래처의 최근 단가를 함께
  sort: z.enum(['code', 'name', 'category']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
});

type Row = typeof materials.$inferSelect;

export interface ImportRowResult {
  row: number;
  action: 'insert' | 'update' | 'skip' | 'error';
  code?: string | null;
  name?: string;
  message?: string;
}

@Injectable()
export class MaterialsService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  private base(ctx: AccessContext) {
    return and(eq(materials.companyId, ctx.companyId!), isNull(materials.deletedAt))!;
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListQuery>) {
    const conds: SQL[] = [this.base(ctx)];
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      conds.push(or(ilike(materials.name, like), ilike(materials.code, like), ilike(materials.spec, like), ilike(materials.maker, like))!);
    }
    if (q.category) conds.push(eq(materials.category, q.category));
    if (q.tradeType) conds.push(eq(materials.tradeType, q.tradeType));
    if (q.active !== 'all') conds.push(eq(materials.isActive, q.active === 'true'));
    const where = and(...conds);
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(materials).where(where);
    const col = { code: materials.code, name: materials.name, category: materials.category }[q.sort];
    const rows = await this.db.select().from(materials).where(where).orderBy(q.dir === 'asc' ? asc(col) : desc(col), asc(materials.code)).limit(q.size).offset((q.page - 1) * q.size);
    let prices: Record<string, { unitPrice: string; lastOrderDate: string | null }> = {};
    if (q.vendorId && rows.length) {
      const ps = await this.db.select().from(vendorPrices).where(and(eq(vendorPrices.vendorId, q.vendorId), eq(vendorPrices.companyId, ctx.companyId!), inArray(vendorPrices.materialId, rows.map((r) => r.id))));
      prices = Object.fromEntries(ps.map((p) => [p.materialId, { unitPrice: p.unitPrice, lastOrderDate: p.lastOrderDate }]));
    }
    const categories = await this.db.selectDistinct({ c: materials.category }).from(materials).where(and(this.base(ctx), sql`${materials.category} is not null`)).orderBy(materials.category);
    return { total: count, page: q.page, size: q.size, categories: categories.map((c) => c.c), rows: rows.map((r) => ({ ...r, vendorPrice: prices[r.id] ?? null })) };
  }

  async get(ctx: AccessContext, id: string) {
    const [m] = await this.db.select().from(materials).where(and(eq(materials.id, id), this.base(ctx)));
    if (!m) throw notFound('자재');
    const prices = await this.db
      .select({ vendorId: vendors.id, vendorName: vendors.name, unitPrice: vendorPrices.unitPrice, lastOrderDate: vendorPrices.lastOrderDate })
      .from(vendorPrices)
      .innerJoin(vendors, eq(vendors.id, vendorPrices.vendorId))
      .where(and(eq(vendorPrices.materialId, id), eq(vendorPrices.companyId, ctx.companyId!)))
      .orderBy(desc(vendorPrices.lastOrderDate));
    return { ...m, vendorPrices: prices };
  }

  private async assertCodeFree(ctx: AccessContext, code: string, exceptId?: string) {
    const [dup] = await this.db.select({ id: materials.id, name: materials.name }).from(materials).where(and(this.base(ctx), eq(materials.code, code)));
    if (dup && dup.id !== exceptId) throw new ConflictException({ code: 'DUPLICATE_CODE', message: `자재코드 ${code} 는 이미 '${dup.name}'에 쓰이고 있습니다`, fields: [{ field: 'code', message: '중복된 자재코드' }] });
  }

  private values(dto: z.infer<typeof MaterialBase>) {
    const { code, ...rest } = dto;
    return { ...rest, defaultPrice: D(dto.defaultPrice).toFixed(4) };
  }

  async create(ctx: AccessContext, dto: z.infer<typeof MaterialBase>) {
    if (dto.code) await this.assertCodeFree(ctx, dto.code);
    return this.db.transaction(async (tx) => {
      const code = dto.code ?? (await this.numbering.materialCode(tx, ctx.companyId!));
      const [m] = await tx.insert(materials).values({ companyId: ctx.companyId!, code, ...this.values(dto), createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'material', resourceId: m.id, summary: `자재 등록 ${m.code} ${m.name}`, after: m }, tx);
      return m;
    });
  }

  async update(ctx: AccessContext, id: string, dto: z.infer<typeof UpdateDto>) {
    const [before] = await this.db.select().from(materials).where(and(eq(materials.id, id), this.base(ctx)));
    if (!before) throw notFound('자재');
    const code = dto.code ?? before.code;
    if (code !== before.code) await this.assertCodeFree(ctx, code, id);
    return this.db.transaction(async (tx) => {
      const [m] = await tx
        .update(materials)
        .set({ code, ...this.values(dto), updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${materials.version} + 1` })
        .where(and(eq(materials.id, id), eq(materials.version, dto.version)))
        .returning();
      if (!m) throw staleVersion();
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'material', resourceId: id, summary: `자재 수정 ${m.code} ${m.name}`, ...diffOnly(before, m) }, tx);
      return m;
    });
  }

  /** 삭제: 목록에서만 뺀다 (지난 발주서에 남은 품목 정보는 그대로) */
  async remove(ctx: AccessContext, id: string, version: number) {
    const [m] = await this.db.select().from(materials).where(and(eq(materials.id, id), this.base(ctx)));
    if (!m) throw notFound('자재');
    await this.db.transaction(async (tx) => {
      const [r] = await tx.update(materials).set({ deletedAt: new Date(), version: sql`${materials.version} + 1` }).where(and(eq(materials.id, id), eq(materials.version, version))).returning({ id: materials.id });
      if (!r) throw staleVersion();
      await this.audit.fromCtx(ctx, { action: 'DELETE', resource: 'material', resourceId: id, summary: `자재 삭제 ${m.code} ${m.name}`, before: m }, tx);
    });
  }

  // ───────── 엑셀 대량 등록 ─────────
  static COLUMNS = ['자재코드', '자재명', '규격', '제조사', '단위', '품목분류', '공종', '기본단가', '과세구분', '비고'];

  async template(res: Response) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('자재등록');
    ws.addRow(MaterialsService.COLUMNS);
    ws.addRow(['', 'F-CV 케이블', '6sq 2C', 'LS전선', 'm', '전선', '전기', 1850, '과세', '예시 — 지우고 입력하세요']);
    ws.addRow(['', '분전반', '주40A 분기 20A×12', '', 'EA', '배전반', '전기', 480000, '과세', '']);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B4C6F' } };
    [12, 28, 22, 14, 8, 12, 8, 12, 10, 24].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.getColumn(8).numFmt = '#,##0';
    const help = wb.addWorksheet('작성방법');
    [
      ['항목', '설명'],
      ['자재코드', '비워 두면 자동 생성(M00001). 기존 코드를 쓰면 그 자재 정보를 덮어씁니다.'],
      ['자재명·단위', '필수'],
      ['공종', '전기 / 통신 / 건축 / 공통 중 하나 (비워도 됨)'],
      ['기본단가', '부가세 별도 공급가 기준 숫자'],
      ['과세구분', '과세 / 면세 / 영세 (비우면 과세)'],
      ['중복', '자재코드 없이 같은 자재명+규격이 이미 있으면 건너뜁니다'],
    ].forEach((r) => help.addRow(r));
    help.getColumn(1).width = 14;
    help.getColumn(2).width = 70;
    help.getRow(1).font = { bold: true };
    await sendExcel(res, wb, '자재등록_양식.xlsx');
  }

  private cellText(v: ExcelJS.CellValue): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
      if ('result' in v) return String(v.result ?? '').trim();
      if ('text' in v) return String(v.text).trim();
    }
    return String(v).trim();
  }

  /** dryRun=true 면 검사 결과만, false 면 실제 저장 (전체가 한 트랜잭션) */
  async import(ctx: AccessContext, file: Express.Multer.File | undefined, dryRun: boolean) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: '엑셀 파일을 선택해 주세요' });
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({ code: 'BAD_EXCEL', message: '엑셀(.xlsx) 파일을 읽을 수 없습니다. 양식 파일에 입력해 주세요' });
    }
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => this.cellText(v));
    const idx = (name: string) => header.indexOf(name) + 1;
    if (!idx('자재명') || !idx('단위')) throw new BadRequestException({ code: 'BAD_HEADER', message: '첫 줄에 "자재명", "단위" 제목이 필요합니다. 양식 파일을 내려받아 사용해 주세요' });
    if (ws.rowCount > 5001) throw new BadRequestException({ code: 'TOO_MANY', message: '한 번에 5,000행까지 올릴 수 있습니다' });

    const existing = await this.db.select({ id: materials.id, code: materials.code, name: materials.name, spec: materials.spec, version: materials.version }).from(materials).where(this.base(ctx));
    const byCode = new Map(existing.map((e) => [e.code, e]));
    const byNameSpec = new Set(existing.map((e) => `${e.name}|${e.spec ?? ''}`));
    const seenInFile = new Set<string>();
    const results: ImportRowResult[] = [];
    const toInsert: z.infer<typeof MaterialBase>[] = [];
    const toUpdate: { id: string; dto: z.infer<typeof MaterialBase> }[] = [];

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (n: string) => (idx(n) ? this.cellText(row.getCell(idx(n)).value) : '');
      if (!MaterialsService.COLUMNS.some((c) => get(c))) continue; // 빈 줄
      if (get('비고').startsWith('예시')) continue;
      const tradeRaw = get('공종');
      const taxRaw = get('과세구분');
      const parsed = MaterialBase.safeParse({
        code: get('자재코드') || null, name: get('자재명'), spec: get('규격'), maker: get('제조사'), unit: get('단위'), category: get('품목분류'),
        tradeType: tradeRaw ? (TRADE as Record<string, string>)[tradeRaw] ?? 'INVALID' : null,
        defaultPrice: get('기본단가') || '0', taxType: taxRaw ? (TAX as Record<string, string>)[taxRaw] ?? 'INVALID' : 'TAXABLE', memo: get('비고'),
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = { tradeType: '공종(전기/통신/건축/공통)', taxType: '과세구분(과세/면세/영세)' }[String(issue.path[0])] ?? String(issue.path[0]);
        results.push({ row: r, action: 'error', name: get('자재명'), message: issue.message.includes('Invalid') ? `${field} 값이 올바르지 않습니다` : issue.message });
        continue;
      }
      const dto = parsed.data;
      const key = `${dto.name}|${dto.spec ?? ''}`;
      if (dto.code && byCode.has(dto.code)) {
        toUpdate.push({ id: byCode.get(dto.code)!.id, dto });
        results.push({ row: r, action: 'update', code: dto.code, name: dto.name });
      } else if (!dto.code && byNameSpec.has(key)) {
        results.push({ row: r, action: 'skip', name: dto.name, message: '같은 자재명·규격이 이미 있습니다' });
      } else if (seenInFile.has(dto.code ?? key)) {
        results.push({ row: r, action: 'skip', name: dto.name, message: '파일 안에서 중복된 행입니다' });
      } else {
        seenInFile.add(dto.code ?? key);
        toInsert.push(dto);
        results.push({ row: r, action: 'insert', code: dto.code, name: dto.name });
      }
    }
    const summary = {
      insert: results.filter((x) => x.action === 'insert').length,
      update: results.filter((x) => x.action === 'update').length,
      skip: results.filter((x) => x.action === 'skip').length,
      error: results.filter((x) => x.action === 'error').length,
    };
    if (dryRun) return { dryRun: true, summary, results };
    if (summary.error) throw new BadRequestException({ code: 'IMPORT_ERRORS', message: `오류가 있는 행 ${summary.error}개를 고친 뒤 다시 올려 주세요`, results });

    await this.db.transaction(async (tx) => {
      for (const dto of toInsert) {
        const code = dto.code ?? (await this.numbering.materialCode(tx, ctx.companyId!));
        await tx.insert(materials).values({ companyId: ctx.companyId!, code, ...this.values(dto), createdById: ctx.user.id, updatedById: ctx.user.id });
      }
      for (const u of toUpdate) {
        await tx.update(materials).set({ ...this.values(u.dto), updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${materials.version} + 1` }).where(eq(materials.id, u.id));
      }
      await this.audit.fromCtx(ctx, { action: 'IMPORT', resource: 'material', summary: `자재 엑셀 등록 — 신규 ${summary.insert}, 갱신 ${summary.update}, 건너뜀 ${summary.skip}` }, tx);
    });
    return { dryRun: false, summary, results };
  }
}

@ApiTags('자재마스터')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly svc: MaterialsService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('material', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.svc.list(ctx, q);
  }

  @Get('template.xlsx')
  @RequirePermission('material', 'create')
  template(@Res() res: Response) {
    return this.svc.template(res);
  }

  @Get('export.xlsx')
  @RequirePermission('material', 'export')
  async export(@Ctx() ctx: AccessContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>, @Res() res: Response) {
    const data = await this.svc.list(ctx, { ...q, page: 1, size: 500 });
    const wb = await buildExcel({
      sheet: '자재', title: '자재마스터', rows: data.rows,
      columns: [
        { header: '자재코드', key: 'code', width: 12, value: (r: Row) => r.code },
        { header: '자재명', key: 'name', width: 28, value: (r: Row) => r.name },
        { header: '규격', key: 'spec', width: 22, value: (r: Row) => r.spec },
        { header: '제조사', key: 'maker', width: 14, value: (r: Row) => r.maker },
        { header: '단위', key: 'unit', width: 8, value: (r: Row) => r.unit },
        { header: '품목분류', key: 'cat', width: 12, value: (r: Row) => r.category },
        { header: '공종', key: 'trade', width: 8, value: (r: Row) => (r.tradeType ? TRADE_LABEL[r.tradeType] : '') },
        { header: '기본단가', key: 'price', width: 12, type: 'int', value: (r: Row) => r.defaultPrice },
        { header: '과세구분', key: 'tax', width: 10, value: (r: Row) => TAX_LABEL[r.taxType] },
      ],
    });
    await this.audit.fromCtx(ctx, { action: 'EXPORT', resource: 'material', summary: `자재 엑셀 출력 ${data.rows.length}건` });
    await sendExcel(res, wb, `자재마스터_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermission('material', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  import(@Ctx() ctx: AccessContext, @UploadedFile() file: Express.Multer.File, @Query('dryRun') dryRun: string) {
    return this.svc.import(ctx, file, dryRun !== 'false');
  }

  @Get(':id')
  @RequirePermission('material', 'read')
  get(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post()
  @RequirePermission('material', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(MaterialBase)) dto: z.infer<typeof MaterialBase>) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('material', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateDto)) dto: z.infer<typeof UpdateDto>) {
    return this.svc.update(ctx, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('material', 'delete')
  async remove(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Query('version') version: string) {
    await this.svc.remove(ctx, id, Number(version));
  }
}
