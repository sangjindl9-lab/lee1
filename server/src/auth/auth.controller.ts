import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { AllowWithoutMfa, AuthUser, CurrentUser, Public } from './auth.types';
import { clientIp } from './auth.guard';
import { parse } from '../common/validate';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('auth/login') @HttpCode(200)
  login(@Body() b: any, @Req() req: any) {
    const d = parse(z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }), b);
    return this.auth.login(d.username, d.password, clientIp(req), req.headers['user-agent'] ?? null);
  }

  @Public() @Post('auth/mfa/verify') @HttpCode(200)
  mfaVerify(@Body() b: any, @Req() req: any) {
    const d = parse(z.object({ mfa_token: z.string(), code: z.string().regex(/^\d{6}$/) }), b);
    return this.auth.mfaVerify(d.mfa_token, d.code, clientIp(req), req.headers['user-agent'] ?? null);
  }

  @AllowWithoutMfa() @Post('auth/mfa/setup') @HttpCode(200)
  mfaSetup(@CurrentUser() u: AuthUser) { return this.auth.mfaSetup(u); }

  @AllowWithoutMfa() @Post('auth/mfa/enable') @HttpCode(200)
  mfaEnable(@CurrentUser() u: AuthUser, @Body() b: any) {
    return this.auth.mfaEnable(u, parse(z.object({ code: z.string().regex(/^\d{6}$/) }), b).code);
  }

  @Post('auth/reauth') @HttpCode(200)
  reauth(@CurrentUser() u: AuthUser, @Body() b: any) {
    const d = parse(z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/).optional() }), b);
    return this.auth.reauth(u, d.password, d.code);
  }

  @AllowWithoutMfa() @Post('auth/logout') @HttpCode(200)
  logout(@CurrentUser() u: AuthUser) { return this.auth.logout(u); }

  @AllowWithoutMfa() @Get('me')
  me(@CurrentUser() u: AuthUser) { return this.auth.publicUser(u); }
}
