import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { ALLOW_NO_MFA_KEY, ApiError, PERM_KEY, PUBLIC_KEY } from './auth.types';

export function clientIp(req: any): string | null {
  const xf = req.headers?.['x-forwarded-for'];
  return (typeof xf === 'string' && process.env.TRUST_PROXY === 'true' ? xf.split(',')[0].trim() : req.socket?.remoteAddress) || null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers['authorization'] || '';
    if (!h.startsWith('Bearer ')) throw new ApiError(401, 'NO_TOKEN', '로그인이 필요합니다');
    const user = await this.auth.verifyToken(h.slice(7), 'access', clientIp(req));
    req.user = user;
    if (user.requires_mfa && !user.mfa_enabled && !this.reflector.getAllAndOverride<boolean>(ALLOW_NO_MFA_KEY, targets)) {
      throw new ApiError(403, 'MFA_SETUP_REQUIRED', '관리자 계정은 다중요소 인증(MFA)을 먼저 설정해야 합니다');
    }
    const perms = this.reflector.getAllAndOverride<string[]>(PERM_KEY, targets) || [];
    for (const p of perms) if (!user.permissions.includes(p)) throw new ApiError(403, 'FORBIDDEN', `권한이 없습니다 (${p})`);
    return true;
  }
}
