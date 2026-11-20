import { redirect } from "next/navigation";
import type { SessionUser } from "./auth";

/** 페이지 공통: 로그인·가족 확인 */
export async function assertFamily(user: SessionUser | null): Promise<string> {
  if (!user) redirect("/login");
  if (!user.familyId) redirect("/login");
  return user.familyId;
}
