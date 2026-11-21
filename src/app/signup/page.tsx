import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import SignupForm from "@/components/SignupForm";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const session = await getSessionUser();
  if (session) redirect(session.role === "PARENT" ? "/app" : "/simple");
  const { code } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 px-5 py-10">
      <div className="text-center">
        <p className="text-4xl">👨‍👩‍👧</p>
        <h1 className="mt-2 text-2xl font-black text-slate-800">가족앨범 시작하기</h1>
        <p className="mt-1 text-sm text-slate-500">아이 사진을 가족과 함께, 안전하게 보관하세요.</p>
      </div>
      <SignupForm initialCode={code ?? ""} />
    </main>
  );
}
