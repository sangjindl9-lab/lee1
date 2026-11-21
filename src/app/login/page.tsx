import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSessionUser();
  if (session) redirect(session.role === "PARENT" ? "/app" : "/simple");

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center gap-8 px-5 py-12">
      <div className="text-center">
        <div className="mb-3 text-5xl">🍼</div>
        <h1 className="text-3xl font-black tracking-tight text-slate-900">가족앨범 · 육아기록</h1>
        <p className="mt-2 text-sm text-slate-500">
          아이 사진 원본은 그대로 보관하고, 가족은 쉽게 보고, 육아 기록은 한 곳에.
        </p>
      </div>

      <LoginForm />
      <a href="/privacy" className="text-xs font-semibold text-slate-400 underline">개인정보처리방침</a>
    </main>
  );
}
