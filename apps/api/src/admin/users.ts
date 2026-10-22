import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomInt } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { checkPasswordPolicy, hashPassword } from '../auth/password';
import { AuthService } from '../auth/auth.service';
import { notFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { memberships, membershipRoles, projectAssignments, projects, rolePermissions, roles, users } from '../db/schema';
import { LicenseService } from '../license/license.service';

const optText = (max = 120) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const CreateUserDto = z.object({
  loginId: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{4,32}$/, '아이디는 영문 소문자·숫자·._- 4~32자'),
  name: z.string().trim().min(1, '이름을 입력해 주세요').max(50),
  email: z.string().trim().email('이메일 형식이 올바르지 않습니다').optional().nullable().or(z.literal('').transform(() => null)),
  phone: optText(30),
  department: optText(50),
  position: optText(30),
  roleIds: z.array(z.string().uuid()).min(1, '역할을 하나 이상 선택해 주세요'),
  projectIds: z.array(z.string().uuid()).default([]),
  tempPassword: z.string().max(128).optional(),
});
const UpdateUserDto = CreateUserDto.omit({ loginId: true, tempPassword: true }).extend({ isActive: z.boolean() });

/** 임시 비밀번호: 혼동 문자(0,O,1,l,I) 제외 12자 */
function tempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < 12) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly audit: AuditService,
    private readonly license: LicenseService,
    private readonly auth: AuthService,
  ) {}

  async list(ctx: AccessContext) {
    const rows = await this.db
      .select({
        membershipId: memberships.id, userId: users.id, loginId: users.loginId, name: users.name, email: users.email, phone: users.phone,
        department: memberships.department, position: memberships.position, isActive: memberships.isActive, status: users.status,
        lockedUntil: users.lockedUntil, mfaEnabled: users.mfaEnabled, lastLoginAt: users.lastLoginAt, mustChangePassword: users.mustChangePassword,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.companyId, ctx.companyId!))
      .orderBy(users.name);
    const ids = rows.map((r) => r.membershipId);
    const roleRows = ids.length
      ? await this.db.select({ membershipId: membershipRoles.membershipId, roleId: roles.id, name: roles.name, key: roles.key }).from(membershipRoles).innerJoin(roles, eq(roles.id, membershipRoles.roleId)).where(inArray(membershipRoles.membershipId, ids))
      : [];
    const projRows = ids.length
      ? await this.db.select({ membershipId: projectAssignments.membershipId, projectId: projects.id, code: projects.code, name: projects.name }).from(projectAssignments).innerJoin(projects, eq(projects.id, projectAssignments.projectId)).where(inArray(projectAssignments.membershipId, ids))
      : [];
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      locked: !!r.lockedUntil && r.lockedUntil.getTime() > now,
      roles: roleRows.filter((x) => x.membershipId === r.membershipId).map(({ roleId, name, key }) => ({ id: roleId, name, key })),
      projects: projRows.filter((x) => x.membershipId === r.membershipId).map(({ projectId, code, name }) => ({ id: projectId, code, name })),
    }));
  }

  /** 권한 상승 방지: 자기가 가진 권한보다 넓은 역할은 부여할 수 없다 */
  private async assertGrantable(ctx: AccessContext, roleIds: string[]) {
    const rs = await this.db.select({ id: roles.id, name: roles.name }).from(roles).where(and(inArray(roles.id, roleIds), eq(roles.companyId, ctx.companyId!)));
    if (rs.length !== new Set(roleIds).size) throw new BadRequestException({ code: 'BAD_ROLE', message: '선택한 역할을 찾을 수 없습니다' });
    if (ctx.user.isSystemAdmin) return;
    const perms = await this.db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
    const over = perms.find((p) => !ctx.permissions.has(`${p.resource}:${p.action}`));
    if (over) {
      const role = rs.find((r) => r.id === over.roleId);
      throw new ForbiddenException({ code: 'ROLE_ESCALATION', message: `'${role?.name}' 역할에는 본인에게 없는 권한이 있어 부여할 수 없습니다` });
    }
  }

  private async assertProjects(ctx: AccessContext, projectIds: string[]) {
    if (!projectIds.length) return;
    const ps = await this.db.select({ id: projects.id }).from(projects).where(and(inArray(projects.id, projectIds), eq(projects.companyId, ctx.companyId!)));
    if (ps.length !== new Set(projectIds).size) throw new BadRequestException({ code: 'BAD_PROJECT', message: '선택한 현장을 찾을 수 없습니다' });
  }

  private async setLinks(tx: Tx, membershipId: string, roleIds: string[], projectIds: string[]) {
    await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membershipId));
    await tx.insert(membershipRoles).values([...new Set(roleIds)].map((roleId) => ({ membershipId, roleId })));
    await tx.delete(projectAssignments).where(eq(projectAssignments.membershipId, membershipId));
    if (projectIds.length) await tx.insert(projectAssignments).values([...new Set(projectIds)].map((projectId) => ({ membershipId, projectId })));
  }

  async create(ctx: AccessContext, dto: z.infer<typeof CreateUserDto>) {
    await this.license.assertSeatAvailable();
    await this.assertGrantable(ctx, dto.roleIds);
    await this.assertProjects(ctx, dto.projectIds);
    const [exists] = await this.db.select({ id: users.id }).from(users).where(eq(users.loginId, dto.loginId));
    if (exists) throw new ConflictException({ code: 'DUPLICATE_LOGIN', message: '이미 사용 중인 아이디입니다', fields: [{ field: 'loginId', message: '사용 중인 아이디' }] });
    const pw = dto.tempPassword || tempPassword();
    const policy = checkPasswordPolicy(pw, dto.loginId);
    if (policy) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: policy, fields: [{ field: 'tempPassword', message: policy }] });
    const hash = await hashPassword(pw);
    const result = await this.db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ loginId: dto.loginId, name: dto.name, email: dto.email, phone: dto.phone, passwordHash: hash, mustChangePassword: true, createdById: ctx.user.id }).returning({ id: users.id });
      const [m] = await tx.insert(memberships).values({ companyId: ctx.companyId!, userId: u.id, department: dto.department, position: dto.position }).returning({ id: memberships.id });
      await this.setLinks(tx, m.id, dto.roleIds, dto.projectIds);
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'user', resourceId: u.id, summary: `사용자 등록 ${dto.name}(${dto.loginId})`, after: { ...dto, tempPassword: undefined } }, tx);
      return { userId: u.id, membershipId: m.id };
    });
    // 임시 비밀번호는 이 응답에서 한 번만 보여준다 (DB에는 해시만 저장)
    return { ...result, tempPassword: pw };
  }

  private async membership(ctx: AccessContext, membershipId: string) {
    const [m] = await this.db.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.companyId, ctx.companyId!)));
    if (!m) throw notFound('사용자');
    return m;
  }

  /** 관리자 역할을 가진 활성 사용자가 최소 1명은 남아 있어야 한다 */
  private async assertAdminRemains(tx: Tx, companyId: string) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(roles.companyId, companyId), eq(roles.key, 'ADMIN'), eq(memberships.isActive, true), eq(users.status, 'ACTIVE')));
    if (n < 1) throw new ConflictException({ code: 'LAST_ADMIN', message: '최고관리자가 최소 1명은 있어야 합니다' });
  }

  async update(ctx: AccessContext, membershipId: string, dto: z.infer<typeof UpdateUserDto>) {
    const m = await this.membership(ctx, membershipId);
    if (m.userId === ctx.user.id && !dto.isActive) throw new BadRequestException({ code: 'SELF_DISABLE', message: '본인 계정은 비활성화할 수 없습니다' });
    await this.assertGrantable(ctx, dto.roleIds);
    await this.assertProjects(ctx, dto.projectIds);
    const before = (await this.list(ctx)).find((x) => x.membershipId === membershipId);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ name: dto.name, email: dto.email, phone: dto.phone, updatedById: ctx.user.id, updatedAt: new Date() }).where(eq(users.id, m.userId));
      await tx.update(memberships).set({ department: dto.department, position: dto.position, isActive: dto.isActive }).where(eq(memberships.id, membershipId));
      await this.setLinks(tx, membershipId, dto.roleIds, dto.projectIds);
      await this.assertAdminRemains(tx, ctx.companyId!);
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'user', resourceId: m.userId, summary: `사용자 수정 ${dto.name}`, before, after: dto }, tx);
    });
    if (!dto.isActive) await this.auth.revokeAll(m.userId);
    return (await this.list(ctx)).find((x) => x.membershipId === membershipId);
  }

  async resetPassword(ctx: AccessContext, membershipId: string) {
    const m = await this.membership(ctx, membershipId);
    const [u] = await this.db.select().from(users).where(eq(users.id, m.userId));
    const pw = tempPassword();
    await this.db.update(users).set({ passwordHash: await hashPassword(pw), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: new Date() }).where(eq(users.id, m.userId));
    await this.auth.revokeAll(m.userId);
    await this.audit.fromCtx(ctx, { action: 'PASSWORD_RESET', resource: 'user', resourceId: m.userId, summary: `비밀번호 초기화 ${u.name}` });
    return { tempPassword: pw };
  }

  async unlock(ctx: AccessContext, membershipId: string) {
    const m = await this.membership(ctx, membershipId);
    await this.db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, m.userId));
    await this.audit.fromCtx(ctx, { action: 'UNLOCK', resource: 'user', resourceId: m.userId, summary: '로그인 잠금 해제' });
    return { ok: true };
  }

  async revokeSessions(ctx: AccessContext, membershipId: string) {
    const m = await this.membership(ctx, membershipId);
    await this.auth.revokeAll(m.userId);
    await this.audit.fromCtx(ctx, { action: 'SESSION_REVOKE', resource: 'user', resourceId: m.userId, summary: '모든 기기에서 로그아웃' });
    return { ok: true };
  }
}

@ApiTags('사용자')
@Controller('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  @RequirePermission('user', 'read')
  list(@Ctx() ctx: AccessContext) {
    return this.svc.list(ctx);
  }

  @Post()
  @RequirePermission('user', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CreateUserDto)) dto: z.infer<typeof CreateUserDto>) {
    return this.svc.create(ctx, dto);
  }

  @Put(':membershipId')
  @RequirePermission('user', 'update')
  update(@Ctx() ctx: AccessContext, @Param('membershipId', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateUserDto)) dto: z.infer<typeof UpdateUserDto>) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':membershipId/reset-password')
  @HttpCode(200)
  @RequirePermission('user', 'update')
  reset(@Ctx() ctx: AccessContext, @Param('membershipId', ParseUUIDPipe) id: string) {
    return this.svc.resetPassword(ctx, id);
  }

  @Post(':membershipId/unlock')
  @HttpCode(200)
  @RequirePermission('user', 'update')
  unlock(@Ctx() ctx: AccessContext, @Param('membershipId', ParseUUIDPipe) id: string) {
    return this.svc.unlock(ctx, id);
  }

  @Post(':membershipId/revoke-sessions')
  @HttpCode(200)
  @RequirePermission('user', 'update')
  revoke(@Ctx() ctx: AccessContext, @Param('membershipId', ParseUUIDPipe) id: string) {
    return this.svc.revokeSessions(ctx, id);
  }
}

/** 현장 담당자 지정용 가벼운 구성원 목록 (사용자 관리 권한 없이 현장 수정 권한으로 조회) */
@ApiTags('사용자')
@Controller('members')
export class MembersController {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  @Get('options')
  @RequirePermission('project', 'update')
  options(@Ctx() ctx: AccessContext) {
    return this.db
      .select({ membershipId: memberships.id, name: users.name, department: memberships.department, position: memberships.position })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.companyId, ctx.companyId!), eq(memberships.isActive, true), eq(users.status, 'ACTIVE')))
      .orderBy(users.name);
  }
}
