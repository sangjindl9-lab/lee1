import { prisma } from "@/lib/db";
import type { Actor } from "./rbac";

export interface AuditInput {
  actor?: Actor | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** 운영·거래의 주요 작업은 반드시 감사 로그를 남긴다. */
export async function audit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actor?.id ?? null,
      actorRole: input.actor ? input.actor.roles.join(",") : "SYSTEM",
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      before: (input.before ?? undefined) as never,
      after: (input.after ?? undefined) as never,
      ip: input.ip ?? input.actor?.ip ?? null,
    },
  });
}

export async function notify(input: {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  link?: string;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
}
