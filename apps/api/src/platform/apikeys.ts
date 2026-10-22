/**
 * 외부 프로그램용 API 키
 *  - 원문 키는 발급 때 한 번만 보여 주고 SHA-256 해시만 저장
 *  - 키 권한 = 발급자 권한 ∩ 지정한 범위(scopes). 발급자가 퇴사·권한 축소되면 키 권한도 줄어든다
 *  - 관리 기능(사용자·역할·연동·API 키·라이선스)은 키로 접근할 수 없다
 *  - 상태를 바꾸는 POST 요청은 Idempotency-Key 헤더가 필수 (같은 요청 재전송 시 한 번만 처리)
 */
import { BadRequestException, Body, CallHandler, ConflictException, Controller, Delete, ExecutionContext, Get, HttpCode, Inject, Injectable, NestInterceptor, Param, ParseUUIDPipe, Post, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { catchError, from, map, mergeMap, Observable, of } from 'rxjs';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { RESOURCES } from '../access/catalog';
import { AccessContext, Ctx, ErpRequest, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../common/crypto';
import { notFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { apiCredentials, apiIdempotency, users } from '../db/schema';

export const ADMIN_ONLY = new Set(['company', 'user', 'role', 'audit', 'integration', 'apikey', 'license']);
const KEY_RE = /^ssk_[A-Za-z0-9_-]{40,60}$/;

const CreateDto = z.object({
  name: z.string().trim().min(1, '키 이름을 입력해 주세요').max(60),
  scopes: z.array(z.string().regex(/^[a-z]+:(read|create|update|export)$/)).min(1, '허용할 기능을 하나 이상 고르세요').max(200),
  expiresInDays: z.coerce.number().int().min(1).max(730).optional().nullable(),
  allowedIps: z.array(z.string().trim().regex(/^[0-9a-fA-F:.]{3,45}$/, 'IP 주소 형식')).max(20).optional().nullable(),
});

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService, private readonly access: AccessService) {}

  /** 가드에서 호출 — 유효하면 발급자·범위 반환 */
  async validate(raw: string, ip: string) {
    if (!KEY_RE.test(raw)) return null;
    const [k] = await this.db.select().from(apiCredentials).where(and(eq(apiCredentials.keyHash, sha256(raw)), isNull(apiCredentials.revokedAt)));
    if (!k) return null;
    if (k.expiresAt && k.expiresAt < new Date()) throw new UnauthorizedException({ code: 'API_KEY_EXPIRED', message: 'API 키가 만료되었습니다' });
    const ips = (k.allowedIps as string[] | null) ?? [];
    const clientIp = ip.replace(/^::ffff:/, '');
    if (ips.length && !ips.includes(clientIp)) throw new UnauthorizedException({ code: 'API_IP_DENIED', message: '허용되지 않은 IP에서 온 요청입니다' });
    const [u] = await this.db.select().from(users).where(eq(users.id, k.userId));
    if (!u || u.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'API_KEY_OWNER_INACTIVE', message: '키를 발급한 사용자가 비활성 상태입니다' });
    // 마지막 사용 시각은 1분에 한 번만 기록
    if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) await this.db.update(apiCredentials).set({ lastUsedAt: new Date(), lastUsedIp: clientIp }).where(eq(apiCredentials.id, k.id));
    return { key: k, user: u };
  }

  async list(ctx: AccessContext) {
    const rows = await this.db.select({ k: apiCredentials, userName: users.name }).from(apiCredentials).innerJoin(users, eq(users.id, apiCredentials.userId)).where(eq(apiCredentials.companyId, ctx.companyId!)).orderBy(desc(apiCredentials.createdAt));
    return rows.map(({ k, userName }) => ({ id: k.id, name: k.name, keyPrefix: k.keyPrefix, scopes: k.scopes, allowedIps: k.allowedIps, expiresAt: k.expiresAt, lastUsedAt: k.lastUsedAt, lastUsedIp: k.lastUsedIp, revokedAt: k.revokedAt, revokedReason: k.revokedReason, createdAt: k.createdAt, userName }));
  }

  /** 발급 가능한 범위 = 내가 가진 권한 중 관리 기능 제외 */
  grantable(ctx: AccessContext) {
    return [...ctx.permissions].filter((p) => { const [r, a] = p.split(':'); return !ADMIN_ONLY.has(r) && ['read', 'create', 'update', 'export'].includes(a) && r in RESOURCES; }).sort();
  }

  async create(ctx: AccessContext, dto: z.infer<typeof CreateDto>) {
    const allowed = new Set(this.grantable(ctx));
    const bad = dto.scopes.filter((s) => !allowed.has(s));
    if (bad.length) throw new BadRequestException({ code: 'SCOPE_DENIED', message: `내 권한을 넘는 범위는 줄 수 없습니다: ${bad.slice(0, 3).join(', ')}` });
    const raw = `ssk_${randomToken(36)}`;
    const [k] = await this.db.insert(apiCredentials).values({
      companyId: ctx.companyId!, userId: ctx.user.id, name: dto.name, keyPrefix: raw.slice(0, 12), keyHash: sha256(raw), scopes: dto.scopes, allowedIps: dto.allowedIps?.length ? dto.allowedIps : null,
      expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86400000) : null,
    }).returning();
    await this.audit.fromCtx(ctx, { action: 'CREATE', resource: 'apikey', resourceId: k.id, summary: `API 키 발급 '${dto.name}' (${k.keyPrefix}…) 범위 ${dto.scopes.length}개${dto.expiresInDays ? `, ${dto.expiresInDays}일 후 만료` : ''}` });
    return { id: k.id, key: raw, keyPrefix: k.keyPrefix };
  }

  async revoke(ctx: AccessContext, id: string, reason: string) {
    const [k] = await this.db.update(apiCredentials).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(apiCredentials.id, id), eq(apiCredentials.companyId, ctx.companyId!), isNull(apiCredentials.revokedAt))).returning();
    if (!k) throw notFound('API 키');
    await this.audit.fromCtx(ctx, { action: 'REVOKE', resource: 'apikey', resourceId: id, summary: `API 키 폐기 '${k.name}' (${k.keyPrefix}…) — ${reason}` });
    return { ok: true };
  }
}

/** API 키 요청의 Idempotency-Key 처리 — 같은 키로 다시 오면 저장된 응답을 그대로 돌려준다 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  intercept(ec: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ec.switchToHttp().getRequest<ErpRequest>();
    const res = ec.switchToHttp().getResponse<{ status: (n: number) => void; statusCode: number }>();
    const keyId = req.ctx?.apiKeyId;
    if (!keyId || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next.handle();
    const idem = (req.header('idempotency-key') ?? '').trim();
    if (!idem) {
      if (req.method === 'POST') throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'API 키로 보내는 POST 요청에는 Idempotency-Key 헤더가 필요합니다 (요청마다 고유한 값, 예: UUID)' });
      return next.handle();
    }
    if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(idem)) throw new BadRequestException({ code: 'BAD_IDEMPOTENCY_KEY', message: 'Idempotency-Key 는 8~100자의 영문·숫자·-_.: 만 쓸 수 있습니다' });
    const path = req.originalUrl.split('?')[0];
    const bodyHash = sha256(JSON.stringify(req.body ?? {}));
    return from((async () => {
      const [row] = await this.db.insert(apiIdempotency).values({ credentialId: keyId, idemKey: idem, method: req.method, path, bodyHash }).onConflictDoNothing().returning();
      if (row) return { fresh: true as const, id: row.id };
      const [ex] = await this.db.select().from(apiIdempotency).where(and(eq(apiIdempotency.credentialId, keyId), eq(apiIdempotency.idemKey, idem)));
      if (ex.method !== req.method || ex.path !== path || ex.bodyHash !== bodyHash) throw new UnprocessableEntityException({ code: 'IDEMPOTENCY_KEY_REUSED', message: '같은 Idempotency-Key 로 다른 요청을 보냈습니다. 새 요청에는 새 키를 쓰세요' });
      if (ex.statusCode === null) throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: '같은 요청을 처리하는 중입니다. 잠시 후 다시 확인하세요' });
      return { fresh: false as const, statusCode: ex.statusCode, response: ex.response };
    })()).pipe(
      mergeMap((r) => {
        if (!r.fresh) {
          res.status(r.statusCode);
          return of(r.response);
        }
        return next.handle().pipe(
          mergeMap((body) => from(this.db.update(apiIdempotency).set({ statusCode: res.statusCode, response: (body ?? null) as never }).where(eq(apiIdempotency.id, r.id)).catch(() => undefined)).pipe(map(() => body))),
          catchError((err) => from(this.db.delete(apiIdempotency).where(eq(apiIdempotency.id, r.id))).pipe(mergeMap(() => { throw err; }))),
        );
      }),
    );
  }
}

@ApiTags('관리 · API 키')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly svc: ApiKeysService) {}

  @Get()
  @RequirePermission('apikey', 'read')
  list(@Ctx() ctx: AccessContext) {
    return this.svc.list(ctx);
  }

  @Get('scopes')
  @RequirePermission('apikey', 'create')
  scopes(@Ctx() ctx: AccessContext) {
    return this.svc.grantable(ctx).map((p) => ({ value: p, resource: p.split(':')[0], action: p.split(':')[1], label: (RESOURCES as Record<string, { label: string }>)[p.split(':')[0]]?.label }));
  }

  @Post()
  @RequirePermission('apikey', 'create')
  create(@Ctx() ctx: AccessContext, @Body(new ZodPipe(CreateDto)) dto: z.infer<typeof CreateDto>) {
    return this.svc.create(ctx, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('apikey', 'delete')
  revoke(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(2).max(200) }))) dto: { reason: string }) {
    return this.svc.revoke(ctx, id, dto.reason);
  }
}

