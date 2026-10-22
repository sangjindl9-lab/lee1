import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, SQL } from 'drizzle-orm';
import { AccessService } from '../access/access.service';
import { AccessContext } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { notFound, staleVersion } from '../common/errors';
import { D, checkVatTriple, moneyStr, vatFromSupply } from '../common/money';
import { NumberingService, TaxRateService, todayKST } from '../common/numbering.service';
import { DB, DB_TOKEN } from '../db/db';
import { fileObjects, memberships, projectAssignments, projects, users } from '../db/schema';
import { CreateProject, ListProjectsQuery, UpdateProject } from './projects.dto';
import { z } from 'zod';
import { diffOnly } from '../common/diff';

const VAT_TOLERANCE_WON = 10;
const SORT = {
  code: projects.code, name: projects.name, contractDate: projects.contractDate, totalAmount: projects.totalAmount,
  plannedEndDate: projects.plannedEndDate, progressRate: projects.progressRate,
};

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly taxRates: TaxRateService,
  ) {}

  private baseWhere(ctx: AccessContext): SQL {
    return and(eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt), this.access.projectScope(ctx, projects.id))!;
  }

  async list(ctx: AccessContext, q: z.infer<typeof ListProjectsQuery>) {
    const conds: SQL[] = [this.baseWhere(ctx)];
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      conds.push(or(ilike(projects.name, like), ilike(projects.code, like), ilike(projects.clientName, like), ilike(projects.siteAddress, like))!);
    }
    if (q.status) conds.push(eq(projects.status, q.status));
    if (q.tradeType) conds.push(eq(projects.tradeType, q.tradeType));
    if (q.from) conds.push(gte(projects.contractDate, q.from));
    if (q.to) conds.push(lte(projects.contractDate, q.to));
    const where = and(...conds);

    const [agg] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        supply: sql<string>`coalesce(sum(${projects.supplyAmount}),0)::text`,
        vat: sql<string>`coalesce(sum(${projects.vatAmount}),0)::text`,
        total: sql<string>`coalesce(sum(${projects.totalAmount}),0)::text`,
        budget: sql<string>`coalesce(sum(${projects.executionBudget}),0)::text`,
      })
      .from(projects)
      .where(where);

    const col = SORT[q.sort];
    const rows = await this.db
      .select()
      .from(projects)
      .where(where)
      .orderBy(q.dir === 'asc' ? asc(col) : desc(col), desc(projects.code))
      .limit(q.size)
      .offset((q.page - 1) * q.size);
    return { total: agg.count, page: q.page, size: q.size, sums: { supplyAmount: agg.supply, vatAmount: agg.vat, totalAmount: agg.total, executionBudget: agg.budget }, rows: rows.map(present) };
  }

  /** 현장 선택기용 가벼운 목록 */
  async options(ctx: AccessContext) {
    return this.db
      .select({ id: projects.id, code: projects.code, name: projects.name, tradeType: projects.tradeType, status: projects.status })
      .from(projects)
      .where(this.baseWhere(ctx))
      .orderBy(desc(projects.code))
      .limit(1000);
  }

  async get(ctx: AccessContext, id: string) {
    const [p] = await this.db.select().from(projects).where(and(eq(projects.id, id), this.baseWhere(ctx)));
    if (!p) throw notFound('현장');
    const members = await this.db
      .select({ membershipId: projectAssignments.membershipId, roleInProject: projectAssignments.roleInProject, name: users.name, loginId: users.loginId })
      .from(projectAssignments)
      .innerJoin(memberships, eq(memberships.id, projectAssignments.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(projectAssignments.projectId, id));
    const files = await this.db
      .select({ id: fileObjects.id, category: fileObjects.category, originalName: fileObjects.originalName, size: fileObjects.size, mimeType: fileObjects.mimeType, createdAt: fileObjects.createdAt })
      .from(fileObjects)
      .where(and(eq(fileObjects.projectId, id), eq(fileObjects.companyId, ctx.companyId!), isNull(fileObjects.deletedAt)))
      .orderBy(desc(fileObjects.createdAt));
    return { ...present(p), members, files };
  }

  /** 서버 측 금액 계산·검증 — 화면 계산값은 참고만 한다 */
  private async amounts(dto: CreateProject) {
    const baseDate = dto.contractDate ?? todayKST();
    const rate = await this.taxRates.rateAt('VAT', baseDate);
    const auto = vatFromSupply(dto.supplyAmount, rate);
    let vat = auto.vat;
    if (dto.vatAmount !== undefined && dto.vatAmount !== null && dto.vatAmount !== '') {
      const total = moneyStr(D(dto.supplyAmount).plus(dto.vatAmount));
      const chk = checkVatTriple({ supply: dto.supplyAmount, vat: dto.vatAmount, total }, rate, VAT_TOLERANCE_WON);
      if (!chk.ok) {
        throw new BadRequestException({ code: 'VAT_MISMATCH', message: `부가세가 계산값(${D(chk.expectedVat).toFixed(0)}원)과 ${VAT_TOLERANCE_WON}원 넘게 차이납니다`, fields: [{ field: 'vatAmount', message: chk.reason }] });
      }
      vat = moneyStr(dto.vatAmount);
    }
    const supply = moneyStr(D(dto.supplyAmount));
    return {
      supplyAmount: supply,
      vatAmount: vat,
      totalAmount: moneyStr(D(supply).plus(vat)),
      vatRate: rate,
      executionBudget: moneyStr(dto.executionBudget ?? '0'),
      progressRate: D(dto.progressRate ?? 0).div(100).toFixed(4),
      jointShareRate: dto.jointShareRate === null || dto.jointShareRate === undefined ? null : D(dto.jointShareRate).div(100).toFixed(4),
    };
  }

  private fields(dto: CreateProject) {
    return {
      name: dto.name, tradeType: dto.tradeType, status: dto.status, contractRole: dto.contractRole, clientSector: dto.clientSector,
      clientName: dto.clientName, primeContractor: dto.primeContractor, subContractor: dto.subContractor, siteAddress: dto.siteAddress,
      contractType: dto.contractType, contractDate: dto.contractDate ?? null, startDate: dto.startDate ?? null,
      plannedEndDate: dto.plannedEndDate ?? null, actualEndDate: dto.actualEndDate ?? null,
      managerName: dto.managerName, siteManagerName: dto.siteManagerName, memo: dto.memo,
    };
  }

  async create(ctx: AccessContext, dto: CreateProject) {
    const amounts = await this.amounts(dto);
    return this.db.transaction(async (tx) => {
      const code = await this.numbering.projectCode(tx, ctx.companyId!);
      const [p] = await tx
        .insert(projects)
        .values({ companyId: ctx.companyId!, code, ...this.fields(dto), ...amounts, createdById: ctx.user.id, updatedById: ctx.user.id })
        .returning();
      // 배정 범위 사용자가 등록하면 본인을 자동 배정해야 자신이 만든 현장을 볼 수 있다
      if (ctx.scope === 'ASSIGNED' && ctx.membershipId) {
        await tx.insert(projectAssignments).values({ membershipId: ctx.membershipId, projectId: p.id, roleInProject: '등록자' });
      }
      await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'project', resourceId: p.id, summary: `현장 등록 ${p.code} ${p.name}`, after: p }, tx);
      return present(p);
    });
  }

  async update(ctx: AccessContext, id: string, dto: UpdateProject) {
    const [before] = await this.db.select().from(projects).where(and(eq(projects.id, id), this.baseWhere(ctx)));
    if (!before) throw notFound('현장');
    const amounts = await this.amounts(dto);
    return this.db.transaction(async (tx) => {
      const [p] = await tx
        .update(projects)
        .set({ ...this.fields(dto), ...amounts, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${projects.version} + 1` })
        .where(and(eq(projects.id, id), eq(projects.version, dto.version)))
        .returning();
      if (!p) throw staleVersion();
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'project', resourceId: id, summary: `현장 수정 ${p.code}`, before: diffOnly(before, p).before, after: diffOnly(before, p).after }, tx);
      return present(p);
    });
  }

  /** 삭제는 '예정' 상태이며 연결된 업무자료가 없을 때만 허용 (소프트 삭제) */
  async remove(ctx: AccessContext, id: string, version: number) {
    const [p] = await this.db.select().from(projects).where(and(eq(projects.id, id), this.baseWhere(ctx)));
    if (!p) throw notFound('현장');
    if (p.status !== 'PLANNED') {
      throw new ConflictException({ code: 'PROJECT_IN_USE', message: '진행 이후 단계의 현장은 삭제할 수 없습니다. 상태를 "중지"로 바꿔 관리해 주세요' });
    }
    await this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(projects)
        .set({ deletedAt: new Date(), updatedById: ctx.user.id, version: sql`${projects.version} + 1` })
        .where(and(eq(projects.id, id), eq(projects.version, version)))
        .returning({ id: projects.id });
      if (!r) throw staleVersion();
      await this.audit.fromCtx(ctx, { action: 'DELETE', resource: 'project', resourceId: id, summary: `현장 삭제 ${p.code} ${p.name}`, before: p }, tx);
    });
  }

  async setAssignments(ctx: AccessContext, id: string, members: { membershipId: string; roleInProject?: string | null }[]) {
    await this.get(ctx, id);
    const ids = [...new Set(members.map((m) => m.membershipId))];
    if (ids.length) {
      const valid = await this.db.select({ id: memberships.id }).from(memberships).where(and(inArray(memberships.id, ids), eq(memberships.companyId, ctx.companyId!)));
      if (valid.length !== ids.length) throw new BadRequestException({ code: 'BAD_MEMBER', message: '이 회사 소속이 아닌 사용자가 포함되어 있습니다' });
    }
    await this.db.transaction(async (tx) => {
      const before = await tx.select().from(projectAssignments).where(eq(projectAssignments.projectId, id));
      await tx.delete(projectAssignments).where(eq(projectAssignments.projectId, id));
      if (members.length) {
        const uniq = new Map(members.map((m) => [m.membershipId, m]));
        await tx.insert(projectAssignments).values([...uniq.values()].map((m) => ({ projectId: id, membershipId: m.membershipId, roleInProject: m.roleInProject ?? null })));
      }
      await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'project_assignment', resourceId: id, summary: `현장 담당자 변경 (${members.length}명)`, before, after: members }, tx);
    });
    return this.get(ctx, id);
  }
}

/** 응답 형태 — 공정률·지분율은 % 로 변환해 돌려준다 */
function present(p: typeof projects.$inferSelect) {
  return {
    ...p,
    progressPercent: D(p.progressRate).mul(100).toFixed(1),
    jointSharePercent: p.jointShareRate === null ? null : D(p.jointShareRate).mul(100).toFixed(2),
    plannedMargin: moneyStr(D(p.supplyAmount).minus(p.executionBudget)),
    plannedMarginRate: D(p.supplyAmount).gt(0) ? D(p.supplyAmount).minus(p.executionBudget).div(p.supplyAmount).toFixed(4) : null,
  };
}
