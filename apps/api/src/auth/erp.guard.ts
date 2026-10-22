import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from '../access/access.service';
import { ALLOW_MFA_PENDING, ErpRequest, IS_PUBLIC, NO_COMPANY, PERMISSION } from '../access/context';
import { safeEqual, sha256 } from '../common/crypto';
import { LicenseService } from '../license/license.service';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'erp_sid';
export const CSRF_COOKIE = 'erp_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 모든 요청에 적용되는 단일 관문.
 * 순서: 세션 → 2단계 인증 → 비밀번호 변경 강제 → CSRF → 라이선스 → 회사 소속 → 기능 권한
 */
@Injectable()
export class ErpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly license: LicenseService,
  ) {}

  private meta<T>(key: string, ec: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ec.getHandler(), ec.getClass()]);
  }

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    if (this.meta<boolean>(IS_PUBLIC, ec)) return true;
    const req = ec.switchToHttp().getRequest<ErpRequest>();

    const token = req.cookies?.[SESSION_COOKIE];
    const found = typeof token === 'string' && token.length > 20 ? await this.auth.validate(token) : null;
    if (!found) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '로그인이 필요합니다' });
    const { session, user } = found;

    if (session.mfaPending && !this.meta<boolean>(ALLOW_MFA_PENDING, ec)) {
      throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: '2단계 인증을 완료해 주세요' });
    }

    const path = req.path ?? req.url;
    const isAuthRoute = path.startsWith('/api/v1/auth/');
    if (user.mustChangePassword && !isAuthRoute) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: '처음 로그인하셨거나 관리자가 비밀번호를 초기화했습니다. 비밀번호를 변경해 주세요' });
    }

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header('x-csrf-token') ?? '';
      if (!header || !safeEqual(sha256(header), session.csrfHash)) {
        throw new ForbiddenException({ code: 'CSRF', message: '보안 토큰이 맞지 않습니다. 페이지를 새로고침해 주세요' });
      }
      if (!isAuthRoute && !path.startsWith('/api/v1/license') && !(await this.license.isWritable())) {
        throw new ForbiddenException({ code: 'LICENSE_READONLY', message: '라이선스가 만료되어 조회만 가능합니다. 라이선스를 갱신해 주세요' });
      }
    }

    req.ctx = {
      user: { id: user.id, loginId: user.loginId, name: user.name, isSystemAdmin: user.isSystemAdmin, mustChangePassword: user.mustChangePassword },
      sessionId: session.id,
      companyId: null,
      membershipId: null,
      permissions: new Set(),
      scope: null,
      assignedProjectIds: [],
      ip: req.ip ?? '',
      userAgent: req.header('user-agent') ?? '',
    };

    if (this.meta<boolean>(NO_COMPANY, ec)) return true;

    const companyId = req.header('x-company-id') ?? '';
    if (!UUID.test(companyId)) throw new NotFoundException({ code: 'COMPANY_REQUIRED', message: '회사를 선택해 주세요' });
    const acc = await this.access.resolve(user.id, user.isSystemAdmin, companyId);
    // 소속되지 않은 회사는 존재 여부도 알리지 않는다
    if (!acc) throw new NotFoundException({ code: 'NOT_FOUND', message: '자료를 찾을 수 없습니다' });
    Object.assign(req.ctx, { companyId, ...acc });

    const perm = this.meta<{ resource: string; action: string }>(PERMISSION, ec);
    if (perm && !req.ctx.permissions.has(`${perm.resource}:${perm.action}`)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: '이 작업을 할 권한이 없습니다. 관리자에게 권한을 요청하세요' });
    }
    return true;
  }
}
