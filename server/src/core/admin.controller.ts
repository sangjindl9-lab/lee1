import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import * as bcrypt from 'bcryptjs';
import { DbService } from '../common/db.service';
import { AuditService } from '../common/audit.service';
import { parse, uuid } from '../common/validate';
import { ApiError, AuthUser, CurrentUser, Perm, canSeeOrg, orgFilter } from '../auth/auth.types';
import { validatePassword } from '../auth/auth.service';

@Controller()
export class AdminController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get('organizations')
  async orgs(@CurrentUser() u: AuthUser) {
    const p: any[] = [];
    return this.db.query(`SELECT id, code, name, is_platform, created_at FROM organizations WHERE ${orgFilter(u, 'id', p)} ORDER BY name`, p);
  }

  @Post('organizations') @Perm('org.manage')
  async createOrg(@CurrentUser() u: AuthUser, @Body() b: any) {
    if (!u.is_platform) throw new ApiError(403, 'FORBIDDEN', '중앙 관리 기관만 기관을 만들 수 있습니다');
    const d = parse(z.object({ name: z.string().min(1).max(100), code: z.string().regex(/^[A-Za-z0-9_-]{2,30}$/) }), b);
    const o = await this.db.one('INSERT INTO organizations(code, name) VALUES ($1,$2) RETURNING id, code, name, is_platform, created_at', [d.code, d.name])
      .catch(e => { if (e.code === '23505') throw new ApiError(409, 'DUPLICATE', '이미 있는 기관 코드입니다'); throw e; });
    await this.audit.log(u, 'org.create', 'organization', o!.id, d);
    return o;
  }

  @Get('roles')
  roles() {
    return this.db.query(`SELECT r.code, r.name, r.rank, r.requires_mfa, COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL),'{}') AS permissions
      FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id GROUP BY r.id ORDER BY r.rank, r.code`);
  }

  @Get('users') @Perm('user.manage')
  users(@CurrentUser() u: AuthUser) {
    const p: any[] = [];
    return this.db.query(`SELECT us.id, us.org_id, o.name AS org_name, us.username, us.display_name, r.code AS role, r.name AS role_name, us.active, us.mfa_enabled, us.last_login_at, us.locked_until, us.created_at
      FROM users us JOIN roles r ON r.id=us.role_id JOIN organizations o ON o.id=us.org_id WHERE ${orgFilter(u, 'us.org_id', p)} ORDER BY us.username`, p);
  }

  /** 장애 담당자로 지정할 수 있는 같은 기관 사용자 (alarm.manage) */
  @Get('users/assignable') @Perm('alarm.manage')
  assignable(@CurrentUser() u: AuthUser) {
    const p: any[] = [];
    return this.db.query(`SELECT us.id, us.username, us.display_name, r.code AS role, r.name AS role_name, us.active
      FROM users us JOIN roles r ON r.id=us.role_id WHERE us.active AND ${orgFilter(u, 'us.org_id', p)} ORDER BY us.display_name`, p);
  }

  /** 자기보다 상위 역할은 부여할 수 없다 */
  private async roleFor(u: AuthUser, code: string) {
    const r = await this.db.one('SELECT id, code, rank FROM roles WHERE code=$1', [code]);
    if (!r) throw new ApiError(400, 'VALIDATION', '알 수 없는 역할입니다');
    if (r.rank < u.role_rank) throw new ApiError(403, 'FORBIDDEN', '자신보다 상위 역할은 부여할 수 없습니다');
    if (r.code === 'central_admin' && !u.is_platform) throw new ApiError(403, 'FORBIDDEN', '중앙 관리자 역할은 중앙 관리 기관에서만 부여할 수 있습니다');
    return r;
  }

  @Post('users') @Perm('user.manage')
  async createUser(@CurrentUser() u: AuthUser, @Body() b: any) {
    const d = parse(z.object({
      username: z.string().regex(/^[A-Za-z0-9._-]{3,40}$/), display_name: z.string().min(1).max(60),
      password: z.string().max(200), role: z.string(), org_id: uuid.optional(),
    }), b);
    validatePassword(d.password);
    const orgId = d.org_id ?? u.org_id;
    if (!canSeeOrg(u, orgId)) throw new ApiError(403, 'FORBIDDEN', '다른 기관의 사용자는 만들 수 없습니다');
    const role = await this.roleFor(u, d.role);
    const row = await this.db.one(`INSERT INTO users(org_id, username, display_name, password_hash, role_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [orgId, d.username, d.display_name, await bcrypt.hash(d.password, 12), role.id])
      .catch(e => { if (e.code === '23505') throw new ApiError(409, 'DUPLICATE', '이미 있는 아이디입니다'); throw e; });
    await this.audit.log(u, 'user.create', 'user', row!.id, { username: d.username, role: d.role, org_id: orgId });
    return { id: row!.id, username: d.username, display_name: d.display_name, role: d.role, org_id: orgId, active: true, mfa_enabled: false };
  }

  @Patch('users/:id') @Perm('user.manage')
  async updateUser(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    parse(uuid, id);
    const d = parse(z.object({ display_name: z.string().min(1).max(60).optional(), role: z.string().optional(), active: z.boolean().optional(), password: z.string().max(200).optional() }), b);
    const target = await this.db.one('SELECT us.id, us.org_id, r.rank FROM users us JOIN roles r ON r.id=us.role_id WHERE us.id=$1', [id]);
    if (!target || !canSeeOrg(u, target.org_id)) throw new ApiError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다');
    if (target.rank < u.role_rank) throw new ApiError(403, 'FORBIDDEN', '상위 역할 사용자는 변경할 수 없습니다');
    if (id === u.id && (d.active === false || d.role)) throw new ApiError(400, 'VALIDATION', '자기 자신의 역할·활성 상태는 바꿀 수 없습니다');
    const sets: string[] = []; const p: any[] = [id];
    if (d.display_name) { p.push(d.display_name); sets.push(`display_name=$${p.length}`); }
    if (d.role) { const r = await this.roleFor(u, d.role); p.push(r.id); sets.push(`role_id=$${p.length}`); }
    if (d.active !== undefined) { p.push(d.active); sets.push(`active=$${p.length}`); }
    if (d.password) { validatePassword(d.password); p.push(await bcrypt.hash(d.password, 12)); sets.push(`password_hash=$${p.length}, password_changed_at=now(), failed_logins=0, locked_until=NULL`); }
    if (!sets.length) throw new ApiError(400, 'VALIDATION', '변경할 항목이 없습니다');
    await this.db.tx(async q => {
      await q(`UPDATE users SET ${sets.join(', ')} WHERE id=$1`, p);
      if (d.active === false || d.role || d.password) await q(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [id]);
      await this.audit.log(u, 'user.update', 'user', id, { ...d, password: d.password ? '(변경됨)' : undefined }, q);
    });
    return { ok: true };
  }
}
