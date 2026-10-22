import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config';
import { AccessService } from '../access/access.service';
import { AccessContext, AllowMfaPending, Ctx, ErpRequest, NoCompany, Public } from '../access/context';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { users } from '../db/schema';
import { AuthService, IssuedSession } from './auth.service';
import { CSRF_COOKIE, SESSION_COOKIE } from './erp.guard';

/** 로그인·OTP·비밀번호 변경: IP당 분당 10회 (자동 대입 공격 차단) */
const AUTH_LIMIT = config.NODE_ENV === 'test' ? 10_000 : 10;

const LoginDto = z.object({
  loginId: z.string().trim().min(1, '아이디를 입력해 주세요').max(64),
  password: z.string().min(1, '비밀번호를 입력해 주세요').max(128),
});
const OtpDto = z.object({ code: z.string().trim().regex(/^\d{6}$/, '6자리 숫자를 입력해 주세요') });
const ChangePwDto = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) });
const PwDto = z.object({ password: z.string().min(1).max(128) });
const PrefDto = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  favorites: z.array(z.string().max(80)).max(30).optional(),
  lastCompanyId: z.string().uuid().optional(),
  lastProjectId: z.string().uuid().nullable().optional(),
  sidebarCollapsed: z.boolean().optional(),
});

function client(req: ErpRequest) {
  return { ip: req.ip ?? '', userAgent: req.header('user-agent') ?? '' };
}

function setCookies(res: Response, s: IssuedSession) {
  const base = { secure: config.COOKIE_SECURE, sameSite: 'strict' as const, path: '/', expires: s.expiresAt };
  res.cookie(SESSION_COOKIE, s.token, { ...base, httpOnly: true });
  // CSRF 토큰은 화면 스크립트가 읽어 헤더로 보내야 하므로 httpOnly 가 아니다
  res.cookie(CSRF_COOKIE, s.csrf, { ...base, httpOnly: false });
}

function clearCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

@ApiTags('인증')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    @Inject(DB_TOKEN) private readonly db: DB,
  ) {}

  @Public()
  @Throttle({ default: { limit: AUTH_LIMIT, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginDto)) body: z.infer<typeof LoginDto>, @Req() req: ErpRequest, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.login(body.loginId, body.password, client(req));
    setCookies(res, s);
    return { mfaRequired: s.mfaPending, mustChangePassword: s.mustChangePassword };
  }

  @AllowMfaPending()
  @NoCompany()
  @Throttle({ default: { limit: AUTH_LIMIT, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(@Ctx() ctx: AccessContext, @Body(new ZodPipe(OtpDto)) body: z.infer<typeof OtpDto>, @Req() req: ErpRequest, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.completeMfa(ctx.sessionId, ctx.user.id, body.code, client(req));
    setCookies(res, s);
    return { ok: true };
  }

  @AllowMfaPending()
  @NoCompany()
  @Post('logout')
  @HttpCode(200)
  async logout(@Ctx() ctx: AccessContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx.sessionId);
    clearCookies(res);
    return { ok: true };
  }

  /** 로그인 사용자 정보 + 접근 가능한 회사 목록 */
  @NoCompany()
  @Get('me')
  async me(@Ctx() ctx: AccessContext) {
    const [u] = await this.db
      .select({ id: users.id, loginId: users.loginId, name: users.name, email: users.email, isSystemAdmin: users.isSystemAdmin, mfaEnabled: users.mfaEnabled, mustChangePassword: users.mustChangePassword, preferences: users.preferences, lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, ctx.user.id));
    const companies = await this.access.companiesFor(ctx.user.id, ctx.user.isSystemAdmin);
    return { user: u, companies };
  }

  /** 선택한 회사에서의 내 권한 (화면 버튼 표시용 — 실제 차단은 서버가 한다) */
  @Get('permissions')
  permissions(@Ctx() ctx: AccessContext) {
    return { companyId: ctx.companyId, scope: ctx.scope, permissions: [...ctx.permissions].sort(), assignedProjectIds: ctx.assignedProjectIds };
  }

  @NoCompany()
  @Post('preferences')
  @HttpCode(200)
  async preferences(@Ctx() ctx: AccessContext, @Body(new ZodPipe(PrefDto)) body: z.infer<typeof PrefDto>) {
    const [u] = await this.db.select({ preferences: users.preferences }).from(users).where(eq(users.id, ctx.user.id));
    const merged = { ...(u.preferences ?? {}), ...body };
    await this.db.update(users).set({ preferences: merged }).where(eq(users.id, ctx.user.id));
    return { preferences: merged };
  }

  @NoCompany()
  @Throttle({ default: { limit: AUTH_LIMIT, ttl: 60_000 } })
  @Post('password')
  @HttpCode(200)
  async changePassword(@Ctx() ctx: AccessContext, @Body(new ZodPipe(ChangePwDto)) body: z.infer<typeof ChangePwDto>, @Req() req: ErpRequest) {
    await this.auth.changePassword(ctx.user.id, ctx.sessionId, body.currentPassword, body.newPassword, client(req));
    return { ok: true };
  }

  @NoCompany()
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@Ctx() ctx: AccessContext) {
    return this.auth.mfaSetup(ctx.user.id);
  }

  @NoCompany()
  @Post('mfa/enable')
  @HttpCode(200)
  async mfaEnable(@Ctx() ctx: AccessContext, @Body(new ZodPipe(OtpDto)) body: z.infer<typeof OtpDto>, @Req() req: ErpRequest) {
    await this.auth.mfaEnable(ctx.user.id, body.code, client(req));
    return { ok: true };
  }

  @NoCompany()
  @Post('mfa/disable')
  @HttpCode(200)
  async mfaDisable(@Ctx() ctx: AccessContext, @Body(new ZodPipe(PwDto)) body: z.infer<typeof PwDto>, @Req() req: ErpRequest) {
    await this.auth.mfaDisable(ctx.user.id, body.password, client(req));
    return { ok: true };
  }
}
