import prisma from "./db";
import type { SessionUser } from "./auth";

export async function isAdminUser(user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  const emails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.includes(user.email.toLowerCase())) return true;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isAdmin: true } });
  return row?.isAdmin ?? false;
}
