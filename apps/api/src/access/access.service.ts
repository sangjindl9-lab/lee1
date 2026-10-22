import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DB, DB_TOKEN } from '../db/db';
import { memberships, membershipRoles, projectAssignments, rolePermissions, roles, companies } from '../db/schema';
import { ACTIONS, RESOURCES } from './catalog';
import type { AccessContext } from './context';

const SCOPE_RANK = { CONFIRMED_ONLY: 0, ASSIGNED: 1, COMPANY: 2 } as const;
const ALL_PERMS = (Object.keys(RESOURCES) as string[]).flatMap((r) => ACTIONS.map((a) => `${r}:${a}`));

export interface CompanyAccess {
  membershipId: string | null;
  permissions: Set<string>;
  scope: AccessContext['scope'];
  assignedProjectIds: string[];
}

@Injectable()
export class AccessService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  /** 사용자의 특정 회사 내 권한·범위 계산. 소속이 아니면 null */
  async resolve(userId: string, isSystemAdmin: boolean, companyId: string): Promise<CompanyAccess | null> {
    const [company] = await this.db.select({ id: companies.id, isActive: companies.isActive }).from(companies).where(eq(companies.id, companyId));
    if (!company) return null;

    const [m] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId), eq(memberships.isActive, true)));

    if (isSystemAdmin) {
      return { membershipId: m?.id ?? null, permissions: new Set(ALL_PERMS), scope: 'COMPANY', assignedProjectIds: [] };
    }
    if (!m || !company.isActive) return null;

    const roleRows = await this.db
      .select({ roleId: roles.id, scope: roles.scope })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, m.id));
    if (!roleRows.length) return { membershipId: m.id, permissions: new Set(), scope: null, assignedProjectIds: [] };

    const permRows = await this.db
      .select({ resource: rolePermissions.resource, action: rolePermissions.action })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleRows.map((r) => r.roleId)));

    const scope = roleRows.reduce<AccessContext['scope']>(
      (best, r) => (best === null || SCOPE_RANK[r.scope] > SCOPE_RANK[best] ? r.scope : best),
      null,
    );
    const assigned = await this.db
      .select({ projectId: projectAssignments.projectId })
      .from(projectAssignments)
      .where(eq(projectAssignments.membershipId, m.id));

    return {
      membershipId: m.id,
      permissions: new Set(permRows.map((p) => `${p.resource}:${p.action}`)),
      scope,
      assignedProjectIds: assigned.map((a) => a.projectId),
    };
  }

  /**
   * 현장 데이터 범위 조건. 모든 현장 관련 조회에 반드시 적용한다.
   * ASSIGNED 범위는 배정된 현장만, 배정이 없으면 아무것도 보이지 않는다.
   */
  projectScope(ctx: AccessContext, projectIdCol: PgColumn): SQL {
    if (ctx.scope === 'COMPANY' || ctx.scope === 'CONFIRMED_ONLY') return sql`true`;
    if (!ctx.assignedProjectIds.length) return sql`false`;
    return inArray(projectIdCol, ctx.assignedProjectIds);
  }

  canSeeProject(ctx: AccessContext, projectId: string) {
    return ctx.scope === 'COMPANY' || ctx.scope === 'CONFIRMED_ONLY' || ctx.assignedProjectIds.includes(projectId);
  }

  /** 사용자가 접근 가능한 회사 목록 (회사 선택기) */
  async companiesFor(userId: string, isSystemAdmin: boolean) {
    if (isSystemAdmin) {
      return this.db.select({ id: companies.id, name: companies.name, code: companies.code }).from(companies).where(eq(companies.isActive, true)).orderBy(companies.name);
    }
    return this.db
      .select({ id: companies.id, name: companies.name, code: companies.code })
      .from(memberships)
      .innerJoin(companies, eq(companies.id, memberships.companyId))
      .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true), eq(companies.isActive, true)))
      .orderBy(companies.name);
  }
}

export const notDeleted = (col: PgColumn) => isNull(col);
