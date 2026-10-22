/**
 * 홈택스 수집(CODEF) — 오래 걸릴 수 있어 백그라운드 작업으로 돌리고, 화면은 작업 상태를 조회한다.
 * 간편인증(2-Way)이 필요하면 작업이 '인증 대기'로 멈추고, 사용자가 휴대폰 인증을 마친 뒤 '계속'을 누르면 이어서 수집한다.
 * 추가인증 정보는 수 분 안에 써야 하므로 서버 메모리에만 잠깐 보관한다 (DB·로그에 남기지 않음).
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AccessContext } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { DB, DB_TOKEN } from '../db/db';
import { integrationJobs, vendors } from '../db/schema';
import { IntegrationsService } from '../integrations/integrations';
import { CollectRequest, CollectResult, CollectedInvoice, ProviderContext } from '../integrations/types';
import { TaxInvoicesService } from './taxinvoices.service';

interface Pending { companyId: string; req: CollectRequest; twoWayInfo: Record<string, unknown>; partial: CollectedInvoice[]; method: string; message: string; expires: number }
const AUTH_TTL_MS = 4.5 * 60 * 1000;

@Injectable()
export class HometaxCollectService {
  private pending = new Map<string, Pending>();

  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly integrations: IntegrationsService,
    private readonly invoices: TaxInvoicesService,
    private readonly audit: AuditService,
  ) {}

  /** 수집 시작 — 작업 번호를 바로 돌려주고 실제 수집은 뒤에서 */
  async start(ctx: AccessContext, dto: { direction: 'SALES' | 'PURCHASE'; from: string; to: string; login?: Record<string, string> }) {
    if (dto.from > dto.to) throw new BadRequestException({ code: 'BAD_RANGE', message: '시작일이 종료일보다 늦습니다' });
    const days = (Date.parse(dto.to) - Date.parse(dto.from)) / 86400000;
    if (days > 366) throw new BadRequestException({ code: 'RANGE_TOO_LONG', message: '한 번에 1년까지만 수집할 수 있습니다' });
    const r = await this.integrations.require(ctx.companyId!, 'HOMETAX');
    const req: CollectRequest = { direction: dto.direction, from: dto.from, to: dto.to, login: dto.login ?? {} };
    const [job] = await this.db.insert(integrationJobs).values({ companyId: ctx.companyId!, kind: 'HOMETAX', provider: r.providerId, mode: r.pc.mode, action: 'COLLECT', summary: `${dto.direction === 'PURCHASE' ? '매입' : '매출'} ${dto.from} ~ ${dto.to}`, createdById: ctx.user.id, createdByName: ctx.user.name }).returning();
    void this.execute(ctx, job.id, req, (pc) => r.provider.collect(pc, req));
    return { jobId: job.id };
  }

  async continue(ctx: AccessContext, jobId: string, answer: Record<string, string>) {
    const p = this.pending.get(jobId);
    if (!p || p.companyId !== ctx.companyId) throw new NotFoundException({ code: 'NO_PENDING_AUTH', message: '이어서 진행할 인증 요청이 없습니다. 수집을 다시 시작하세요' });
    if (p.expires < Date.now()) {
      this.pending.delete(jobId);
      await this.db.update(integrationJobs).set({ status: 'FAILED', errorCode: 'AUTH_TIMEOUT', errorMessage: '인증 시간이 지났습니다', finishedAt: new Date() }).where(eq(integrationJobs.id, jobId));
      throw new BadRequestException({ code: 'AUTH_TIMEOUT', message: '인증 시간(4분 30초)이 지났습니다. 수집을 다시 시작하세요' });
    }
    this.pending.delete(jobId);
    const r = await this.integrations.require(ctx.companyId!, 'HOMETAX');
    await this.db.update(integrationJobs).set({ status: 'RUNNING', errorMessage: null }).where(eq(integrationJobs.id, jobId));
    void this.execute(ctx, jobId, p.req, (pc) => r.provider.continueAuth(pc, p.req, p.twoWayInfo, answer), p.partial);
    return { jobId };
  }

  private async execute(ctx: AccessContext, jobId: string, req: CollectRequest, fn: (pc: ProviderContext) => Promise<CollectResult>, carried: CollectedInvoice[] = []) {
    try {
      const r = await this.integrations.require(ctx.companyId!, 'HOMETAX');
      const { value } = await this.integrations.run(ctx, 'HOMETAX', r.providerId, r.pc.mode, 'COLLECT', () => fn(r.pc), { jobId, attempts: 2, leaveOpen: true });
      if (value.kind === 'NEED_AUTH') {
        this.pending.set(jobId, { companyId: ctx.companyId!, req, twoWayInfo: value.twoWayInfo, partial: [...carried, ...value.partial], method: value.method, message: value.message, expires: Date.now() + AUTH_TTL_MS });
        await this.db.update(integrationJobs).set({ status: 'WAITING_AUTH', finishedAt: null, result: { kind: 'NEED_AUTH', method: value.method, message: value.message, extraInfo: value.extraInfo ?? null } as never }).where(eq(integrationJobs.id, jobId));
        return;
      }
      const saved = await this.invoices.saveCollected(ctx, req.direction, [...carried, ...value.invoices], 'HOMETAX', r.providerId);
      await this.db.update(integrationJobs).set({ status: 'SUCCESS', finishedAt: new Date(), result: { kind: 'DONE', fetched: carried.length + value.invoices.length, ...saved, ids: undefined } as never }).where(eq(integrationJobs.id, jobId));
    } catch (e) {
      // run() 이 이미 실패로 기록했다. 저장 단계 실패만 여기서 남긴다
      await this.db.update(integrationJobs).set({ status: 'FAILED', finishedAt: new Date(), errorMessage: (e as Error).message?.slice(0, 1000) }).where(eq(integrationJobs.id, jobId));
    }
  }

  async status(ctx: AccessContext, jobId: string) {
    const [j] = await this.db.select().from(integrationJobs).where(and(eq(integrationJobs.id, jobId), eq(integrationJobs.companyId, ctx.companyId!)));
    if (!j) throw new NotFoundException({ code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다' });
    const p = this.pending.get(jobId);
    return { ...j, authExpiresAt: p ? new Date(p.expires).toISOString() : null };
  }

  /** 거래처 휴·폐업 조회 (국세청) — 결과를 거래처에 저장 */
  async checkVendors(ctx: AccessContext, vendorIds?: string[]) {
    const r = await this.integrations.require(ctx.companyId!, 'BIZ_STATUS');
    const conds = [eq(vendors.companyId, ctx.companyId!), isNull(vendors.deletedAt)];
    if (vendorIds?.length) conds.push(inArray(vendors.id, vendorIds));
    const list = (await this.db.select({ id: vendors.id, bizRegNo: vendors.bizRegNo, name: vendors.name }).from(vendors).where(and(...conds))).filter((v) => v.bizRegNo);
    if (!list.length) return { checked: 0, results: [] };
    const results: { vendorId: string; name: string; status: string; label: string }[] = [];
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const { value } = await this.integrations.run(ctx, 'BIZ_STATUS', r.providerId, r.pc.mode, 'CHECK', () => r.provider.check(r.pc, chunk.map((c) => c.bizRegNo!)), { summary: `거래처 ${chunk.length}곳 휴폐업 조회` });
      for (const v of chunk) {
        const s = value.find((x) => x.bizNo === v.bizRegNo);
        if (!s) continue;
        await this.db.update(vendors).set({ bizStatus: s.status, bizStatusCheckedAt: new Date() }).where(eq(vendors.id, v.id));
        results.push({ vendorId: v.id, name: v.name, status: s.status, label: s.label });
      }
    }
    const bad = results.filter((x) => x.status === 'CLOSED' || x.status === 'SUSPENDED');
    await this.audit.fromCtx(ctx, { action: 'CHECK', resource: 'vendor', summary: `거래처 휴폐업 조회 ${results.length}곳${bad.length ? ` — 휴·폐업 ${bad.length}곳: ${bad.slice(0, 5).map((b) => b.name).join(', ')}` : ''}` });
    return { checked: results.length, results };
  }
}
