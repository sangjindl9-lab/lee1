import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { CompanyRole, Role } from "@prisma/client";

export interface Actor {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  companyId: string | null;
  companyRole: CompanyRole | null;
  approvalLimitKrw: number | null;
  sellerProfileId: string | null;
  sellerStatus: string | null;
  /** AI가 최종 판단을 대신하지 못하도록 하는 표식 */
  isAi?: boolean;
  ip?: string;
}

const OPERATOR_ROLES: Role[] = [
  "OPERATOR_REVIEW",
  "OPERATOR_SUPPORT",
  "OPERATOR_SETTLEMENT",
  "SUPER_ADMIN",
];

export async function loadActor(userId: string, ip?: string): Promise<Actor> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: true,
      companyMembers: true,
      sellerProfile: true,
    },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new DomainError("UNAUTHENTICATED", "로그인이 필요합니다.", 401);
  }
  const membership = user.companyMembers[0] ?? null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((r) => r.role),
    companyId: membership?.companyId ?? null,
    companyRole: membership?.role ?? null,
    approvalLimitKrw: membership?.approvalLimitKrw ?? null,
    sellerProfileId: user.sellerProfile?.id ?? null,
    sellerStatus: user.sellerProfile?.status ?? null,
    ip: ip ?? undefined,
  };
}

export function isOperator(actor: Actor): boolean {
  return actor.roles.some((r) => OPERATOR_ROLES.includes(r));
}

export function isSuperAdmin(actor: Actor): boolean {
  return actor.roles.includes("SUPER_ADMIN");
}

export type OperatorScope = "REVIEW" | "SUPPORT" | "SETTLEMENT" | "SUPER";

export function hasOperatorScope(actor: Actor, scope: OperatorScope): boolean {
  switch (scope) {
    case "REVIEW":
      return actor.roles.includes("OPERATOR_REVIEW") || isSuperAdmin(actor);
    case "SUPPORT":
      return actor.roles.includes("OPERATOR_SUPPORT") || isSuperAdmin(actor);
    case "SETTLEMENT":
      return actor.roles.includes("OPERATOR_SETTLEMENT") || isSuperAdmin(actor);
    case "SUPER":
      return isSuperAdmin(actor);
  }
}

export function assertOperatorScope(actor: Actor, scope: OperatorScope): void {
  if (!hasOperatorScope(actor, scope)) {
    throw new DomainError("FORBIDDEN", "해당 운영 작업 권한이 없습니다.", 403);
  }
}

export function assertHuman(actor: Actor, what: string): void {
  if (actor.isAi) {
    throw new DomainError(
      "FORBIDDEN",
      `${what}은(는) AI가 단독으로 최종 결정할 수 없습니다. 담당 운영자가 검토해야 합니다.`,
      403,
    );
  }
}

/** 기업 계정 권한: 구매 담당자는 승인 한도 내에서만 결제를 진행할 수 있다. */
export function assertPurchaseAllowed(actor: Actor, amount: number): void {
  if (actor.companyId && actor.companyRole === "REVIEWER") {
    throw new DomainError("FORBIDDEN", "검수 담당자는 구매를 진행할 수 없습니다.", 403);
  }
  if (
    actor.companyId &&
    actor.companyRole === "BUYER" &&
    actor.approvalLimitKrw != null &&
    amount > actor.approvalLimitKrw
  ) {
    throw new DomainError(
      "FORBIDDEN",
      `기업 구매 승인 한도(${actor.approvalLimitKrw.toLocaleString("ko-KR")}원)를 초과했습니다. 기업 관리자 승인이 필요합니다.`,
      403,
    );
  }
}

/** 기업 관리자·구매 담당자만 기업 명의로 주문할 수 있다. */
export function companyOrderContext(actor: Actor): { companyId: string | null } {
  if (!actor.companyId) return { companyId: null };
  if (actor.companyRole === "REVIEWER") {
    throw new DomainError("FORBIDDEN", "검수 담당자는 구매를 진행할 수 없습니다.", 403);
  }
  return { companyId: actor.companyId };
}
