import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { signPayload, verifySignedPayload } from "@/lib/crypto";
import { loadActor, type Actor } from "@/server/services/rbac";

export const SESSION_COOKIE = "dv_session";

export async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signPayload(JSON.stringify({ uid: userId })), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySignedPayload(token);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { uid?: string };
    return parsed.uid ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentActor(): Promise<Actor | null> {
  const uid = await getSessionUserId();
  if (!uid) return null;
  try {
    return await loadActor(uid);
  } catch {
    return null;
  }
}

export async function requireActor(returnTo = "/"): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return actor;
}

export async function requireOperator(scope: "REVIEW" | "SUPPORT" | "SETTLEMENT" | "SUPER") {
  const actor = await requireActor("/admin");
  const { hasOperatorScope } = await import("@/server/services/rbac");
  if (!hasOperatorScope(actor, scope)) redirect("/dashboard/purchases");
  return actor;
}

export async function currentUserSummary() {
  const actor = await getCurrentActor();
  if (!actor) return null;
  const unread = await prisma.notification.count({ where: { userId: actor.id, readAt: null } });
  return { actor, unread };
}
