import { NextRequest, NextResponse } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { handleRouteError } from "@/lib/api";
import { signup, SignupError } from "@/lib/signup";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    const user = await signup({
      email: str("email"),
      password: str("password"),
      name: str("name"),
      relation: str("relation"),
      agreeTerms: body.agreeTerms === true,
      familyName: str("familyName"),
      childName: str("childName"),
      childBirthDate: str("childBirthDate"),
      inviteCode: str("inviteCode"),
    });
    const { token, expiresAt } = await createSession(user.id);
    const res = NextResponse.json({ ok: true, user: { id: user.id, role: user.role } });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (error) {
    if (error instanceof SignupError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return handleRouteError(error);
  }
}
