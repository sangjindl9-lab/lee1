import { Body, Controller, ForbiddenException, Get, Inject, Injectable, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, NoCompany, RequirePermission } from '../access/context';
import { DEFAULT_ROLES } from '../access/catalog';
import { AuditService } from '../audit/audit.service';
import { isValidBizNo, normalizeBizNo } from '../common/bizno';
import { diffOnly } from '../common/diff';
import { notFound, staleVersion } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { companies, rolePermissions, roles } from '../db/schema';
import { ensureAccountingDefaults } from '../accounting/defaults';

const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const CompanyBase = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, '회사 코드는 영문 대문자·숫자 2~10자'),
  name: z.string().trim().min(1, '회사명을 입력해 주세요').max(100),
  bizRegNo: z.string().transform(normalizeBizNo).refine(isValidBizNo, '사업자등록번호가 올바르지 않습니다'),
  ceoName: optText(50),
  address: optText(300),
  phone: optText(30),
  email: optText(120),
  businessType: optText(100),
  businessItem: optText(100),
});
const UpdateCompanyDto = CompanyBase.omit({ code: true }).extend({ version: z.coerce.number().int().positive() });

/** 회사 생성 시 기본 역할과 권한을 함께 만든다 */
export async function seedDefaultRoles(tx: Tx, companyId: string) {
  for (const r of DEFAULT_ROLES) {
    const [role] = await tx.insert(roles).values({ companyId, key: r.key, name: r.name, description: r.description, scope: r.scope, isSystem: true }).returning();
    const perms = [...new Set(r.permissions)].map((p) => {
      const [resource, action] = p.split(':');
      return { roleId: role.id, resource, action };
    });
    if (perms.length) await tx.insert(rolePermissions).values(perms);
  }
  // 발주서는 모두 대표이사 결재
  await ensureAccountingDefaults(tx, companyId);
}

@Injectable()
export class CompaniesService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService) {}

  async current(ctx: AccessContext) {
    const [c] = await this.db.select().from(companies).where(eq(companies.id, ctx.companyId!));
    if (!c) throw notFound('회사');
    return c;
  }

  async create(ctx: AccessContext, dto: z.infer<typeof CompanyBase>) {
    if (!ctx.user.isSystemAdmin) throw new ForbiddenException({ code: 'FORBIDDEN', message: '회사 추가는 최고관리자만 할 수 있습니다' });
    return this.db.transaction(async (tx) => {
      const [c] = await tx.insert(companies).values({ ...dto, createdById: ctx.user.id }).returning();
      await seedDefaultRoles(tx, c.id);
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'company', resourceId: c.id, companyId: c.id, summary: `회사 등록 ${c.name}`, after: c }, tx);
      return c;
    });
  }

  async update(ctx: AccessContext, dto: z.infer<typeof UpdateCompanyDto>) {
    const before = await this.current(ctx);
    const { version, ...rest } = dto;
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .update(companies)
        .set({ ...rest, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${companies.version} + 1` })
        .where(and(eq(companies.id, ctx.companyId!), eq(companies.version, version)))
        .returning();
      if (!c) throw staleVersion();
      const d = diffOnly(before, c);
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'company', resourceId: c.id, summary: '회사 정보 수정', ...d }, tx);
      return c;
    });
  }
}

@ApiTags('회사')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly svc: CompaniesService) {}

  @Get('current')
  current(@Ctx() ctx: AccessContext) {
    return this.svc.current(ctx);
  }

  @Put('current')
  @RequirePermission('company', 'update')
  update(@Ctx() ctx: AccessContext, @Body(new ZodPipe(UpdateCompanyDto)) dto: z.infer<typeof UpdateCompanyDto>) {
    return this.svc.update(ctx, dto);
  }

  @NoCompany()
  @Post()
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CompanyBase)) dto: z.infer<typeof CompanyBase>) {
    return this.svc.create(ctx, dto);
  }
}
