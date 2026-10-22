import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ACTION_LABELS, ACTIONS, isLive, RESOURCES } from '../access/catalog';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { membershipRoles, rolePermissions, roles } from '../db/schema';

const VALID = new Set((Object.keys(RESOURCES) as string[]).flatMap((r) => ACTIONS.map((a) => `${r}:${a}`)));
const RoleBase = z.object({
  name: z.string().trim().min(1, '역할 이름을 입력해 주세요').max(40),
  description: z.string().trim().max(200).optional().nullable(),
  scope: z.enum(['COMPANY', 'ASSIGNED', 'CONFIRMED_ONLY']),
  permissions: z.array(z.string()).refine((ps) => ps.every((p) => VALID.has(p)), '알 수 없는 권한이 포함되어 있습니다'),
});
const UpdateRoleDto = RoleBase.extend({ version: z.coerce.number().int().positive() });
/** 관리자 역할에서 빠지면 아무도 권한을 되돌릴 수 없게 되는 필수 권한 */
const ADMIN_LOCKED = ['role:read', 'role:update', 'user:read', 'user:update', 'user:create'];

@Injectable()
export class RolesService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService) {}

  async list(ctx: AccessContext) {
    const rs = await this.db.select().from(roles).where(eq(roles.companyId, ctx.companyId!)).orderBy(sql`${roles.isSystem} desc`, roles.createdAt);
    const ids = rs.map((r) => r.id);
    const perms = ids.length ? await this.db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, ids)) : [];
    const counts = ids.length
      ? await this.db.select({ roleId: membershipRoles.roleId, n: sql<number>`count(*)::int` }).from(membershipRoles).where(inArray(membershipRoles.roleId, ids)).groupBy(membershipRoles.roleId)
      : [];
    return rs.map((r) => ({
      ...r,
      permissions: perms.filter((p) => p.roleId === r.id).map((p) => `${p.resource}:${p.action}`).sort(),
      memberCount: counts.find((c) => c.roleId === r.id)?.n ?? 0,
    }));
  }

  catalog() {
    return {
      actions: ACTIONS.map((a) => ({ key: a, label: ACTION_LABELS[a] })),
      resources: Object.entries(RESOURCES).map(([key, v]) => ({ key, ...v, live: isLive(key as keyof typeof RESOURCES) })),
    };
  }

  private assertNoEscalation(ctx: AccessContext, perms: string[]) {
    if (ctx.user.isSystemAdmin) return;
    const over = perms.filter((p) => !ctx.permissions.has(p));
    if (over.length) throw new ForbiddenException({ code: 'ROLE_ESCALATION', message: `본인에게 없는 권한은 역할에 넣을 수 없습니다: ${over.slice(0, 5).join(', ')}` });
  }

  async create(ctx: AccessContext, dto: z.infer<typeof RoleBase>) {
    this.assertNoEscalation(ctx, dto.permissions);
    return this.db.transaction(async (tx) => {
      const [r] = await tx.insert(roles).values({ companyId: ctx.companyId!, key: `CUSTOM_${Date.now().toString(36).toUpperCase()}`, name: dto.name, description: dto.description, scope: dto.scope, createdById: ctx.user.id }).returning();
      const perms = [...new Set(dto.permissions)];
      if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ roleId: r.id, resource: p.split(':')[0], action: p.split(':')[1] })));
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'role', resourceId: r.id, summary: `역할 생성 ${r.name}`, after: { ...dto } }, tx);
      return r;
    });
  }

  async update(ctx: AccessContext, id: string, dto: z.infer<typeof UpdateRoleDto>) {
    const [before] = (await this.list(ctx)).filter((r) => r.id === id);
    if (!before) throw notFound('역할');
    const added = dto.permissions.filter((p) => !before.permissions.includes(p));
    this.assertNoEscalation(ctx, added);
    if (before.key === 'ADMIN') {
      const missing = ADMIN_LOCKED.filter((p) => !dto.permissions.includes(p));
      if (missing.length) throw new BadRequestException({ code: 'ADMIN_LOCKED', message: '최고관리자 역할에서 사용자·권한 관리 권한은 뺄 수 없습니다' });
    }
    return this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(roles)
        .set({ name: dto.name, description: dto.description, scope: before.key === 'ADMIN' ? 'COMPANY' : dto.scope, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${roles.version} + 1` })
        .where(and(eq(roles.id, id), eq(roles.version, dto.version)))
        .returning();
      if (!r) throw staleVersion();
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      const perms = [...new Set(dto.permissions)];
      if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ roleId: id, resource: p.split(':')[0], action: p.split(':')[1] })));
      await this.audit.fromCtx(ctx, {
        action: 'UPDATE', resource: 'role', resourceId: id, summary: `역할 권한 변경 ${r.name}`,
        before: { scope: before.scope, permissions: before.permissions }, after: { scope: r.scope, permissions: perms.sort() },
      }, tx);
      return r;
    });
  }

  async remove(ctx: AccessContext, id: string) {
    const [r] = (await this.list(ctx)).filter((x) => x.id === id);
    if (!r) throw notFound('역할');
    if (r.isSystem) throw new ConflictException({ code: 'SYSTEM_ROLE', message: '기본 제공 역할은 삭제할 수 없습니다. 권한만 조정해 주세요' });
    if (r.memberCount > 0) throw new ConflictException({ code: 'ROLE_IN_USE', message: `이 역할을 가진 사용자가 ${r.memberCount}명 있습니다. 먼저 다른 역할로 바꿔 주세요` });
    await this.db.transaction(async (tx) => {
      await tx.delete(roles).where(eq(roles.id, id));
      await this.audit.fromCtx(ctx, { action: 'DELETE', resource: 'role', resourceId: id, summary: `역할 삭제 ${r.name}`, before: r }, tx);
    });
  }
}

@ApiTags('역할·권한')
@Controller('roles')
export class RolesController {
  constructor(private readonly svc: RolesService) {}

  @Get()
  @RequirePermission('role', 'read')
  list(@Ctx() ctx: AccessContext) {
    return this.svc.list(ctx);
  }

  @Get('catalog')
  @RequirePermission('role', 'read')
  catalog() {
    return this.svc.catalog();
  }

  @Post()
  @RequirePermission('role', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(RoleBase)) dto: z.infer<typeof RoleBase>) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('role', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateRoleDto)) dto: z.infer<typeof UpdateRoleDto>) {
    return this.svc.update(ctx, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('role', 'delete')
  async remove(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(ctx, id);
  }
}
