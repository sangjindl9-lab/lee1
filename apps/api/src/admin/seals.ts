/**
 * 도장 — 회사 직인 · 대표자 도장 · 사용자 개인 도장
 *  - 이미지는 화면에서 배경을 투명하게 다듬은 PNG 로 받는다 (최대 400KB).
 *  - 바꾸면 새 행을 만들고 이전 행은 보관만 한다. 결재 단계는 처리 순간의 도장 행을 가리킨다.
 *  - 이미지는 같은 회사 사람만 볼 수 있다. 모든 등록·삭제는 감사로그에 남는다.
 */
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, NoCompany, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { memberships, sealImages, users } from '../db/schema';

type Kind = 'COMPANY' | 'CEO' | 'USER';
const KIND_LABEL: Record<Kind, string> = { COMPANY: '회사 직인', CEO: '대표자 도장', USER: '개인 도장' };
const MAX_BYTES = 400 * 1024;

const ImageDto = z.object({ image: z.string().min(30).max(Math.ceil((MAX_BYTES * 4) / 3) + 100) });

/** data:image/png;base64,... → 검증된 PNG 바이트와 크기 */
export function parsePng(dataUrl: string) {
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new BadRequestException({ code: 'BAD_IMAGE', message: '도장 이미지는 PNG 형식이어야 합니다' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new BadRequestException({ code: 'IMAGE_TOO_LARGE', message: '도장 이미지가 너무 큽니다 (400KB 이하)' });
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || !sig.every((b, i) => buf[i] === b) || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new BadRequestException({ code: 'BAD_IMAGE', message: '올바른 PNG 이미지가 아닙니다' });
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width < 16 || height < 16 || width > 2000 || height > 2000) throw new BadRequestException({ code: 'BAD_IMAGE', message: '도장 이미지 크기가 맞지 않습니다 (가로·세로 16~2000px)' });
  return { buf, width, height };
}

/** 지금 쓰는 개인 도장 id — 결재 단계에 기록한다 */
export async function activeUserStampId(tx: Tx | DB, userId: string): Promise<string | null> {
  const [r] = await tx
    .select({ id: sealImages.id })
    .from(sealImages)
    .where(and(eq(sealImages.kind, 'USER'), eq(sealImages.userId, userId), isNull(sealImages.retiredAt)))
    .orderBy(desc(sealImages.createdAt))
    .limit(1);
  return r?.id ?? null;
}

/** PDF 에 찍을 이미지 묶음 */
export async function sealsForPdf(db: DB, companyId: string, stampIds: (string | null | undefined)[]) {
  const company = await db
    .select({ id: sealImages.id, kind: sealImages.kind, data: sealImages.data })
    .from(sealImages)
    .where(and(eq(sealImages.companyId, companyId), inArray(sealImages.kind, ['COMPANY', 'CEO']), isNull(sealImages.retiredAt)))
    .orderBy(desc(sealImages.createdAt));
  const ids = [...new Set(stampIds.filter((x): x is string => !!x))];
  const stamps = new Map<string, Buffer>();
  if (ids.length) {
    const rows = await db.select({ id: sealImages.id, data: sealImages.data }).from(sealImages).where(and(inArray(sealImages.id, ids), eq(sealImages.kind, 'USER')));
    for (const r of rows) stamps.set(r.id, Buffer.from(r.data, 'base64'));
  }
  const pick = (k: Kind) => {
    const r = company.find((c) => c.kind === k);
    return r ? Buffer.from(r.data, 'base64') : null;
  };
  return { company: pick('COMPANY'), ceo: pick('CEO'), stamps };
}

const meta = (r: { id: string; createdAt: Date; width: number | null; height: number | null } | undefined) =>
  r ? { id: r.id, url: `/api/v1/seals/${r.id}/image`, updatedAt: r.createdAt, width: r.width, height: r.height } : null;

@Injectable()
export class SealsService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService) {}

  private async active(kind: Kind, owner: { companyId?: string; userId?: string }) {
    const [r] = await this.db
      .select({ id: sealImages.id, createdAt: sealImages.createdAt, width: sealImages.width, height: sealImages.height })
      .from(sealImages)
      .where(and(eq(sealImages.kind, kind), owner.companyId ? eq(sealImages.companyId, owner.companyId) : eq(sealImages.userId, owner.userId!), isNull(sealImages.retiredAt)))
      .orderBy(desc(sealImages.createdAt))
      .limit(1);
    return r;
  }

  async companySeals(ctx: AccessContext) {
    const [company, ceo] = await Promise.all([this.active('COMPANY', { companyId: ctx.companyId! }), this.active('CEO', { companyId: ctx.companyId! })]);
    return { company: meta(company), ceo: meta(ceo) };
  }

  async userSeal(userId: string) {
    return { stamp: meta(await this.active('USER', { userId })) };
  }

  /** 같은 회사 소속인지 확인하고 사용자 id 를 돌려준다 */
  async memberUser(ctx: AccessContext, membershipId: string) {
    const [m] = await this.db
      .select({ userId: memberships.userId, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, membershipId), eq(memberships.companyId, ctx.companyId!)));
    if (!m) throw notFound('사용자');
    return m;
  }

  private async replace(ctx: AccessContext, kind: Kind, owner: { companyId?: string; userId?: string; label: string }, dataUrl: string | null) {
    const img = dataUrl ? parsePng(dataUrl) : null;
    return this.db.transaction(async (tx) => {
      const ownerCond = owner.companyId ? eq(sealImages.companyId, owner.companyId) : eq(sealImages.userId, owner.userId!);
      const retired = await tx
        .update(sealImages)
        .set({ retiredAt: new Date() })
        .where(and(eq(sealImages.kind, kind), ownerCond, isNull(sealImages.retiredAt)))
        .returning({ id: sealImages.id });
      let row: typeof sealImages.$inferSelect | undefined;
      if (img) {
        [row] = await tx
          .insert(sealImages)
          .values({ kind, companyId: owner.companyId ?? null, userId: owner.userId ?? null, mime: 'image/png', data: img.buf.toString('base64'), width: img.width, height: img.height, createdById: ctx.user.id })
          .returning();
      } else if (!retired.length) {
        throw notFound(KIND_LABEL[kind]);
      }
      await this.audit.fromCtx(
        ctx,
        {
          action: img ? (retired.length ? 'UPDATE' : 'CREATE') : 'DELETE',
          resource: 'seal',
          resourceId: row?.id ?? retired[0]?.id,
          companyId: owner.companyId ?? ctx.companyId,
          summary: `${owner.label} ${KIND_LABEL[kind]} ${img ? (retired.length ? '변경' : '등록') : '삭제'}`,
          after: row ? { id: row.id, width: row.width, height: row.height, bytes: img!.buf.length } : undefined,
        },
        tx,
      );
      return row ? meta(row) : null;
    });
  }

  setCompany(ctx: AccessContext, kind: 'COMPANY' | 'CEO', dataUrl: string | null) {
    return this.replace(ctx, kind, { companyId: ctx.companyId!, label: '회사' }, dataUrl);
  }

  setUser(ctx: AccessContext, userId: string, name: string, dataUrl: string | null) {
    return this.replace(ctx, 'USER', { userId, label: userId === ctx.user.id ? '내' : `${name} 님의` }, dataUrl);
  }

  /** 이미지 — 같은 회사 사람만 */
  async image(ctx: AccessContext, id: string) {
    const [r] = await this.db.select().from(sealImages).where(eq(sealImages.id, id));
    if (!r) throw notFound('도장');
    if (!ctx.user.isSystemAdmin && r.userId !== ctx.user.id) {
      const mine = await this.db.select({ companyId: memberships.companyId }).from(memberships).where(and(eq(memberships.userId, ctx.user.id), eq(memberships.isActive, true)));
      const myCompanies = new Set(mine.map((m) => m.companyId));
      let ok = !!r.companyId && myCompanies.has(r.companyId);
      if (!ok && r.userId) {
        const theirs = await this.db.select({ companyId: memberships.companyId }).from(memberships).where(eq(memberships.userId, r.userId));
        ok = theirs.some((m) => myCompanies.has(m.companyId));
      }
      if (!ok) throw notFound('도장');
    }
    return { buf: Buffer.from(r.data, 'base64'), mime: r.mime };
  }
}

const KindParam = z.enum(['company', 'ceo']).transform((v) => (v === 'company' ? 'COMPANY' : 'CEO') as 'COMPANY' | 'CEO');

@ApiTags('도장')
@Controller('seals')
export class SealsController {
  constructor(private readonly svc: SealsService) {}

  @Get('company')
  company(@Ctx() ctx: AccessContext) {
    return this.svc.companySeals(ctx);
  }

  @Put('company/:kind')
  @RequirePermission('company', 'update')
  setCompany(@Ctx() ctx: AccessContext, @Param('kind', new ZodPipe(KindParam)) kind: 'COMPANY' | 'CEO', @Body(new ZodPipe(ImageDto)) dto: { image: string }) {
    return this.svc.setCompany(ctx, kind, dto.image);
  }

  @Delete('company/:kind')
  @HttpCode(204)
  @RequirePermission('company', 'update')
  async removeCompany(@Ctx() ctx: AccessContext, @Param('kind', new ZodPipe(KindParam)) kind: 'COMPANY' | 'CEO') {
    await this.svc.setCompany(ctx, kind, null);
  }

  @NoCompany()
  @Get('me')
  me(@Ctx() ctx: AccessContext) {
    return this.svc.userSeal(ctx.user.id);
  }

  @NoCompany()
  @Put('me')
  setMe(@Ctx() ctx: AccessContext, @Body(new ZodPipe(ImageDto)) dto: { image: string }) {
    if (ctx.apiKeyId) throw new ForbiddenException({ code: 'API_NOT_ALLOWED', message: '도장은 API 키로 등록할 수 없습니다' });
    return this.svc.setUser(ctx, ctx.user.id, ctx.user.name, dto.image);
  }

  @NoCompany()
  @Delete('me')
  @HttpCode(204)
  async removeMe(@Ctx() ctx: AccessContext) {
    await this.svc.setUser(ctx, ctx.user.id, ctx.user.name, null);
  }

  @Get('members/:membershipId')
  @RequirePermission('user', 'read')
  async member(@Ctx() ctx: AccessContext, @Param('membershipId', ParseUUIDPipe) id: string) {
    const m = await this.svc.memberUser(ctx, id);
    return this.svc.userSeal(m.userId);
  }

  @Put('members/:membershipId')
  @RequirePermission('user', 'update')
  async setMember(@Ctx() ctx: AccessContext, @Param('membershipId', ParseUUIDPipe) id: string, @Body(new ZodPipe(ImageDto)) dto: { image: string }) {
    const m = await this.svc.memberUser(ctx, id);
    return this.svc.setUser(ctx, m.userId, m.name, dto.image);
  }

  @Delete('members/:membershipId')
  @HttpCode(204)
  @RequirePermission('user', 'update')
  async removeMember(@Ctx() ctx: AccessContext, @Param('membershipId', ParseUUIDPipe) id: string) {
    const m = await this.svc.memberUser(ctx, id);
    await this.svc.setUser(ctx, m.userId, m.name, null);
  }

  @NoCompany()
  @Get(':id/image')
  async image(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.svc.image(ctx, id);
    res.setHeader('Content-Type', r.mime);
    // 도장 행은 바뀌지 않으므로 오래 보관해도 된다 (바꾸면 id 가 달라짐)
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(r.buf);
  }
}

