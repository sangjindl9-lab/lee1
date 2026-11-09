import { SetMetadata, createParamDecorator, ExecutionContext, HttpException } from '@nestjs/common';

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  org_id: string;
  org_name: string;
  is_platform: boolean;          // 중앙 관리 기관 소속
  role: string;
  role_rank: number;
  requires_mfa: boolean;
  permissions: string[];
  mfa_enabled: boolean;
  jti: string;
  ip: string | null;
}

export const PUBLIC_KEY = 'eum_public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const PERM_KEY = 'eum_perm';
export const Perm = (...perms: string[]) => SetMetadata(PERM_KEY, perms);

export const ALLOW_NO_MFA_KEY = 'eum_allow_no_mfa';
export const AllowWithoutMfa = () => SetMetadata(ALLOW_NO_MFA_KEY, true);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ statusCode: status, code, message }, status);
  }
}

/** 기관 범위: 중앙 관리 기관 사용자는 전체, 나머지는 자기 기관만 */
export function orgFilter(u: AuthUser, column: string, params: any[]): string {
  if (u.is_platform && u.role === 'central_admin') return 'TRUE';
  params.push(u.org_id);
  return `${column} = $${params.length}`;
}

export function canSeeOrg(u: AuthUser, orgId: string): boolean {
  return (u.is_platform && u.role === 'central_admin') || u.org_id === orgId;
}
