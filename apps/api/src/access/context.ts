import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Action, Resource } from './catalog';

export interface AuthUser {
  id: string;
  loginId: string;
  name: string;
  isSystemAdmin: boolean;
  mustChangePassword: boolean;
}

/** 요청마다 서버가 계산하는 접근 컨텍스트 — 클라이언트 값은 신뢰하지 않는다 */
export interface AccessContext {
  user: AuthUser;
  sessionId: string;
  companyId: string | null;
  membershipId: string | null;
  permissions: Set<string>;
  /** COMPANY: 회사 전체, ASSIGNED: 배정 현장만, CONFIRMED_ONLY: 확정 자료만 */
  scope: 'COMPANY' | 'ASSIGNED' | 'CONFIRMED_ONLY' | null;
  assignedProjectIds: string[];
  ip: string;
  userAgent: string;
  /** API 키로 들어온 요청 (세션 대신) */
  apiKeyId?: string;
  /** 이번 상신에만 쓰는 결재선 (상신 요청에 함께 온 경우) */
  approvalLine?: { title: string; roleKey?: string | null; userId?: string | null }[];
}

export interface ErpRequest extends Request {
  ctx?: AccessContext;
}

export const IS_PUBLIC = 'erp:public';
export const NO_COMPANY = 'erp:no-company';
export const ALLOW_MFA_PENDING = 'erp:mfa-pending';
export const PERMISSION = 'erp:permission';

/** 로그인 없이 접근 가능 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** 회사 선택 없이 접근 가능 (내 정보, 회사 목록 등) */
export const NoCompany = () => SetMetadata(NO_COMPANY, true);
/** 2단계 인증 대기 상태에서도 접근 가능 (OTP 입력) */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);
/** 필요한 기능 권한 */
export const RequirePermission = (resource: Resource, action: Action) => SetMetadata(PERMISSION, { resource, action });

export const Ctx = createParamDecorator((_: unknown, ec: ExecutionContext): AccessContext => {
  const req = ec.switchToHttp().getRequest<ErpRequest>();
  return req.ctx!;
});

export function can(ctx: AccessContext, resource: Resource, action: Action) {
  return ctx.permissions.has(`${resource}:${action}`);
}
