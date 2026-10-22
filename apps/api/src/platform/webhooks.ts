/**
 * 웹훅 — 업무 이벤트(감사로그와 같은 시점)를 외부 주소로 알린다
 *  - 발송함(Outbox): 업무 트랜잭션 안에서 발송 예정 행을 함께 저장 → 커밋된 일만 발송, 롤백되면 발송도 없음
 *  - 서명: X-SSERP-Signature: sha256=HMAC(secret, `${timestamp}.${body}`), X-SSERP-Timestamp (5분 넘은 요청은 받는 쪽에서 버리도록 안내)
 *  - 실패하면 1분·5분·30분·2시간·12시간 뒤 다시 보내고, 6번 실패하면 '실패'로 남긴다
 *  - 내부망·localhost 주소로는 보내지 않는다 (SSRF 방지) — 운영 환경은 https 만
 */
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHmac } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField, randomToken } from '../common/crypto';
import { notFound, staleVersion } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { config } from '../config';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { webhookDeliveries, webhookEndpoints } from '../db/schema';

/** 화면에 보여 줄 대표 이벤트 (감사로그 resource.action 을 소문자로) */
export const WEBHOOK_EVENTS = [
  { value: '*', label: '모든 이벤트' },
  { value: 'purchase_order.*', label: '발주서 (작성·결재·발송·입고)' },
  { value: 'approval.*', label: '전자결재 (상신·승인·반려)' },
  { value: 'payment_request.pay', label: '지급 완료' },
  { value: 'payment_request.*', label: '지급결의 전체' },
  { value: 'tax_invoice.issue', label: '매출 세금계산서 발행' },
  { value: 'tax_invoice.import', label: '세금계산서 수집' },
  { value: 'tax_invoice.post', label: '매입 세금계산서 처리' },
  { value: 'claim.*', label: '기성·수금' },
  { value: 'subcontract.*', label: '하도급' },
  { value: 'project.*', label: '현장' },
  { value: 'vendor.*', label: '거래처' },
  { value: 'bank.*', label: '통장 거래 대사' },
];
const BACKOFF_MIN = [1, 5, 30, 120, 720];

export function matches(patterns: string[], event: string) {
  return patterns.some((p) => p === '*' || p === event || (p.endsWith('.*') && event.startsWith(p.slice(0, -1))));
}

export async function assertPublicUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException({ code: 'BAD_URL', message: '주소 형식이 올바르지 않습니다' });
  }
  if (!['https:', 'http:'].includes(u.protocol)) throw new BadRequestException({ code: 'BAD_URL', message: 'http(s) 주소만 쓸 수 있습니다' });
  if (config.NODE_ENV === 'production' && u.protocol !== 'https:') throw new BadRequestException({ code: 'HTTPS_REQUIRED', message: '운영 환경에서는 https 주소만 쓸 수 있습니다' });
  if (process.env.WEBHOOK_ALLOW_PRIVATE === 'true') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!ips.length) throw new BadRequestException({ code: 'DNS_FAILED', message: '주소를 찾을 수 없습니다' });
  const priv = (ip: string) => /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|fe80)/i.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip === 'localhost';
  if (ips.some(priv)) throw new BadRequestException({ code: 'PRIVATE_URL', message: '내부망 주소로는 웹훅을 보낼 수 없습니다' });
  return u;
}

const EndpointDto = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().url('주소 형식이 올바르지 않습니다').max(500),
  events: z.array(z.string().regex(/^(\*|[a-z_]+\.(\*|[a-z_]+))$/)).min(1, '받을 이벤트를 고르세요').max(30),
  isActive: z.boolean().default(true),
});

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService) {}

  onModuleInit() {
    AuditService.hooks.set('webhooks', (tx, e) => this.enqueue(tx, e));
    if (config.NODE_ENV !== 'test' || process.env.WEBHOOK_WORKER === 'true') this.timer = setInterval(() => void this.process(), 5000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** 감사로그가 쓰일 때 (같은 트랜잭션) 구독 중인 주소마다 발송 예정 행을 만든다 */
  private async enqueue(tx: Tx, e: { companyId: string | null; userName: string | null; action: string; resource: string; resourceId: string | null; summary: string | null; createdAt: Date }) {
    if (!e.companyId || ['apikey', 'integration', 'auth', 'session', 'user', 'role'].includes(e.resource)) return;
    const event = `${e.resource}.${e.action}`.toLowerCase();
    const eps = await tx.select({ id: webhookEndpoints.id, events: webhookEndpoints.events }).from(webhookEndpoints).where(and(eq(webhookEndpoints.companyId, e.companyId), eq(webhookEndpoints.isActive, true)));
    const targets = eps.filter((x) => matches(x.events as string[], event));
    if (!targets.length) return;
    const payload = { event, resource: e.resource, action: e.action, resourceId: e.resourceId, summary: e.summary, actor: e.userName, occurredAt: e.createdAt.toISOString(), companyId: e.companyId };
    await tx.insert(webhookDeliveries).values(targets.map((t) => ({ companyId: e.companyId!, endpointId: t.id, event, payload })));
  }

  /** 발송 작업 — 여러 서버가 떠 있어도 같은 행을 두 번 보내지 않게 SKIP LOCKED */
  async process(limit = 20) {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const rows = await this.db.transaction(async (tx) => {
        const list = (await tx.execute(sql`select d.id from webhook_delivery d where d.status = 'PENDING' and d.next_attempt_at <= now() order by d.next_attempt_at limit ${limit} for update skip locked`)).rows as { id: string }[];
        if (!list.length) return [];
        // 이번 회차가 가져간 행은 잠시 뒤로 미뤄 다른 작업자가 가져가지 않게
        await tx.execute(sql`update webhook_delivery set next_attempt_at = now() + interval '2 minutes' where id in (${sql.join(list.map((l) => sql`${l.id}`), sql`, `)})`);
        return list.map((l) => l.id);
      });
      for (const id of rows) {
        await this.deliver(id);
        sent++;
      }
    } finally {
      this.running = false;
    }
    return sent;
  }

  async deliver(id: string) {
    const [d] = await this.db.select({ d: webhookDeliveries, url: webhookEndpoints.url, secretEnc: webhookEndpoints.secretEnc, isActive: webhookEndpoints.isActive }).from(webhookDeliveries).innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId)).where(eq(webhookDeliveries.id, id));
    if (!d || d.d.status !== 'PENDING') return;
    const attempts = d.d.attempts + 1;
    let code: number | null = null;
    let error: string | null = null;
    try {
      if (!d.isActive) throw new Error('엔드포인트가 꺼져 있습니다');
      await assertPublicUrl(d.url);
      const body = JSON.stringify({ id: d.d.id, ...(d.d.payload as object) });
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = createHmac('sha256', decryptField(d.secretEnc)).update(`${ts}.${body}`).digest('hex');
      const res = await fetch(d.url, {
        method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'user-agent': 'SS-ERP-Webhook/1.0', 'x-sserp-event': d.d.event, 'x-sserp-delivery': d.d.id, 'x-sserp-timestamp': ts, 'x-sserp-signature': `sha256=${sig}` },
      });
      code = res.status;
      if (res.status < 200 || res.status >= 300) error = `응답 코드 ${res.status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
    }
    if (!error) {
      await this.db.update(webhookDeliveries).set({ status: 'DELIVERED', attempts, lastStatusCode: code, lastError: null, deliveredAt: new Date() }).where(eq(webhookDeliveries.id, id));
      return;
    }
    const failed = attempts > BACKOFF_MIN.length;
    await this.db.update(webhookDeliveries).set({ status: failed ? 'FAILED' : 'PENDING', attempts, lastStatusCode: code, lastError: error, nextAttemptAt: new Date(Date.now() + (BACKOFF_MIN[attempts - 1] ?? 0) * 60_000) }).where(eq(webhookDeliveries.id, id));
  }

  async list(ctx: AccessContext) {
    const eps = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.companyId, ctx.companyId!)).orderBy(desc(webhookEndpoints.createdAt));
    const stats = (await this.db.execute(sql`select endpoint_id, count(*) filter (where status = 'DELIVERED')::int ok, count(*) filter (where status = 'FAILED')::int failed, count(*) filter (where status = 'PENDING')::int pending, max(created_at) last
      from webhook_delivery where company_id = ${ctx.companyId} group by 1`)).rows as { endpoint_id: string; ok: number; failed: number; pending: number; last: string }[];
    return { events: WEBHOOK_EVENTS, endpoints: eps.map(({ secretEnc, ...e }) => ({ ...e, hasSecret: !!secretEnc, stats: stats.find((s) => s.endpoint_id === e.id) ?? null })) };
  }

  async create(ctx: AccessContext, dto: z.infer<typeof EndpointDto>) {
    await assertPublicUrl(dto.url);
    const secret = `whsec_${randomToken(24)}`;
    const [e] = await this.db.insert(webhookEndpoints).values({ companyId: ctx.companyId!, name: dto.name, url: dto.url, events: dto.events, isActive: dto.isActive, secretEnc: encryptField(secret), createdById: ctx.user.id, updatedById: ctx.user.id }).returning();
    await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'integration', resourceId: e.id, summary: `웹훅 등록 '${dto.name}' ${new URL(dto.url).host} (${dto.events.join(', ')})` });
    return { id: e.id, secret };
  }

  async update(ctx: AccessContext, id: string, dto: z.infer<typeof EndpointDto> & { version: number }) {
    await assertPublicUrl(dto.url);
    const [e] = await this.db.update(webhookEndpoints).set({ name: dto.name, url: dto.url, events: dto.events, isActive: dto.isActive, updatedById: ctx.user.id, updatedAt: new Date(), version: sql`${webhookEndpoints.version} + 1` })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.companyId, ctx.companyId!), eq(webhookEndpoints.version, dto.version))).returning();
    if (!e) throw staleVersion();
    await this.audit.fromCtx(ctx, { action: 'UPDATE', resource: 'integration', resourceId: id, summary: `웹훅 수정 '${dto.name}'${dto.isActive ? '' : ' (꺼짐)'}` });
    return { id };
  }

  async remove(ctx: AccessContext, id: string) {
    const [e] = await this.db.update(webhookEndpoints).set({ isActive: false, updatedById: ctx.user.id }).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.companyId, ctx.companyId!))).returning();
    if (!e) throw notFound('웹훅');
    await this.db.update(webhookDeliveries).set({ status: 'FAILED', lastError: '엔드포인트 삭제' }).where(and(eq(webhookDeliveries.endpointId, id), eq(webhookDeliveries.status, 'PENDING')));
    await this.audit.fromCtx(ctx, { action: 'DELETE', resource: 'integration', resourceId: id, summary: `웹훅 끔 '${e.name}'` });
    return { ok: true };
  }

  async test(ctx: AccessContext, id: string) {
    const [e] = await this.db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.companyId, ctx.companyId!)));
    if (!e) throw notFound('웹훅');
    const [d] = await this.db.insert(webhookDeliveries).values({ companyId: ctx.companyId!, endpointId: id, event: 'ping', payload: { event: 'ping', summary: 'SS-ERP 웹훅 연결 테스트', occurredAt: new Date().toISOString(), companyId: ctx.companyId } }).returning();
    await this.deliver(d.id);
    const [r] = await this.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, d.id));
    return { ok: r.status === 'DELIVERED', statusCode: r.lastStatusCode, error: r.lastError };
  }

  async deliveries(ctx: AccessContext, endpointId?: string) {
    return this.db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.companyId, ctx.companyId!), ...(endpointId ? [eq(webhookDeliveries.endpointId, endpointId)] : []))).orderBy(desc(webhookDeliveries.createdAt)).limit(100);
  }

  async retry(ctx: AccessContext, id: string) {
    const [d] = await this.db.update(webhookDeliveries).set({ status: 'PENDING', nextAttemptAt: new Date(), attempts: 0 }).where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.companyId, ctx.companyId!))).returning();
    if (!d) throw notFound('발송 기록');
    await this.deliver(id);
    return { ok: true };
  }
}

@ApiTags('관리 · 웹훅')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Get()
  @RequirePermission('integration', 'read')
  list(@Ctx() ctx: AccessContext) {
    return this.svc.list(ctx);
  }

  @Get('deliveries')
  @RequirePermission('integration', 'read')
  deliveries(@Ctx() ctx: AccessContext, @Query('endpointId') endpointId?: string) {
    return this.svc.deliveries(ctx, endpointId && /^[0-9a-f-]{36}$/.test(endpointId) ? endpointId : undefined);
  }

  @Post()
  @RequirePermission('integration', 'update')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(EndpointDto)) dto: z.infer<typeof EndpointDto>) {
    return this.svc.create(ctx, dto);
  }

  @Put(':id')
  @RequirePermission('integration', 'update')
  update(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(EndpointDto.extend({ version: z.coerce.number().int() }))) dto: z.infer<typeof EndpointDto> & { version: number }) {
    return this.svc.update(ctx, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('integration', 'update')
  remove(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ctx, id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @RequirePermission('integration', 'update')
  test(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.test(ctx, id);
  }

  @Post('deliveries/:id/retry')
  @HttpCode(200)
  @RequirePermission('integration', 'update')
  retry(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retry(ctx, id);
  }
}
