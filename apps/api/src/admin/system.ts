import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, NoCompany, Public, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { TaxRateService } from '../common/numbering.service';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { taxRateSettings } from '../db/schema';
import { LicenseService } from '../license/license.service';

const AuditQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  resource: z.string().max(40).optional(),
  action: z.string().max(40).optional(),
  resourceId: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});

@ApiTags('감사로그')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit', 'read')
  list(@Ctx() ctx: AccessContext, @Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.audit.list(ctx.companyId!, q);
  }

  @Post('verify')
  @HttpCode(200)
  @RequirePermission('audit', 'read')
  async verify(@Ctx() ctx: AccessContext) {
    const r = await this.audit.verifyChain();
    await this.audit.fromCtx(ctx, { action: 'AUDIT_VERIFY', resource: 'audit', summary: r.ok ? `무결성 확인 ${r.checked}건 정상` : `무결성 오류: ${r.brokenAt}번 기록` });
    return r;
  }
}

const LicenseDto = z.object({ license: z.string().min(20).max(4000) });

@ApiTags('라이선스')
@Controller('license')
export class LicenseController {
  constructor(private readonly license: LicenseService, private readonly audit: AuditService) {}

  @NoCompany()
  @Get()
  status() {
    return this.license.status(true);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('license', 'update')
  async install(@Ctx() ctx: AccessContext, @Body(new ZodPipe(LicenseDto)) dto: z.infer<typeof LicenseDto>) {
    const p = await this.license.install(dto.license);
    await this.audit.fromCtx(ctx, { action: 'LICENSE_INSTALL', resource: 'license', summary: `라이선스 등록 ${p.licensee} ~${p.expiresAt} ${p.maxUsers}명` });
    return this.license.status(true);
  }
}

const TaxRateDto = z.object({
  key: z.enum(['VAT']),
  ratePercent: z.coerce.number().min(0).max(100),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(200).optional(),
});

@ApiTags('세율 설정')
@Controller('settings/tax-rates')
export class TaxRateController {
  constructor(private readonly rates: TaxRateService, @Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService) {}

  @Get()
  list() {
    return this.rates.list();
  }

  /** 새 세율 등록 — 기존 최신 구간은 시작일 전날로 종료 처리 */
  @Post()
  @RequirePermission('company', 'update')
  async add(@Ctx() ctx: AccessContext, @Body(new ZodPipe(TaxRateDto)) dto: z.infer<typeof TaxRateDto>) {
    const rate = (dto.ratePercent / 100).toFixed(4);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`update tax_rate_setting set effective_to = (${dto.effectiveFrom}::date - 1)
        where key = ${dto.key} and effective_from < ${dto.effectiveFrom}::date and (effective_to is null or effective_to >= ${dto.effectiveFrom}::date)`);
      await tx.insert(taxRateSettings).values({ key: dto.key, rate, effectiveFrom: dto.effectiveFrom, note: dto.note, verifiedBy: ctx.user.name });
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'tax_rate', summary: `${dto.key} 세율 ${dto.ratePercent}% (${dto.effectiveFrom}~) 등록` }, tx);
    });
    return this.rates.list();
  }
}

@ApiTags('시스템')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  @Public()
  @Get()
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok', time: new Date().toISOString() };
  }
}
