import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Notice } from "@/components/ui";
import { loginAction } from "@/app/actions";

export const metadata = { title: "로그인" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="container-dv flex min-h-[70vh] items-center justify-center py-12">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <div className="text-[1.375rem] font-black text-[var(--color-navy)]">{BRAND.nameKo} 로그인</div>
          <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">구매와 판매를 한 계정으로 이용할 수 있습니다.</p>
        </div>
        <form action={loginAction} className="card mt-6 space-y-3 p-6">
          <input type="hidden" name="next" value={sp.next ?? "/dashboard/purchases"} />
          {sp.error && <Notice tone="danger">{sp.error}</Notice>}
          <label className="block">
            <span className="label">이메일</span>
            <input name="email" type="email" required className="input" placeholder="you@company.co.kr" />
          </label>
          <label className="block">
            <span className="label">비밀번호</span>
            <input name="password" type="password" required className="input" />
          </label>
          <button className="btn btn-primary w-full" type="submit">
            로그인
          </button>
          <p className="text-center text-[0.75rem] text-[#8c98aa]">
            아직 계정이 없나요?{" "}
            <Link href="/register" className="font-semibold text-[var(--color-accent)]">
              무료 가입
            </Link>
          </p>
        </form>
        <div className="mt-4 rounded-lg border border-dashed border-[var(--color-line)] p-3 text-[0.6875rem] leading-relaxed text-[#7c8aa0]">
          데모 계정 — 구매자 buyer@devvault.kr / 판매자 seller@devvault.kr / 운영자 admin@devvault.kr, 비밀번호
          모두 <code className="font-mono">devvault1234</code>
        </div>
      </div>
    </div>
  );
}
