import prisma from "./db";
import { newToken } from "./password";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "fa_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  relation: string | null;
  familyId: string | null;
  familyName: string | null;
  children: Array<{ id: string; name: string; nickname: string; birthDate: string }>;
};

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        include: {
          family: { include: { children: { orderBy: { sortOrder: "asc" } } } },
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  const user = session.user;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    relation: user.relation,
    familyId: user.familyId,
    familyName: user.family?.name ?? null,
    children: (user.family?.children ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      nickname: c.nickname,
      birthDate: c.birthDate.toISOString(),
    })),
  };
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}

/** 라우트 핸들러용: 현재 로그인 사용자 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("로그인이 필요합니다.");
  }
}

export function isParent(user: SessionUser): boolean {
  return user.role === "PARENT";
}
