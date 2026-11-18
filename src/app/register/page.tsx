import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Notice } from "@/components/ui";
import { registerAction } from "@/app/actions";

export const metadata = { title: "회원가입" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="container-dv flex min-h-[75vh] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="text-center">
          <div className="text-[1.375rem] font-black text-[var(--color-navy)]">{BRAND.nameKo} 시작하기</div>
          <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">
            구매자·판매자 역할을 함께 가질 수 있고, 기업 계정은 구성원 권한을 따로 관리합니다.
          </p>
        </div>
        <form action={registerAction} className="card mt-6 space-y-3 p-6">
          {sp.error && <Notice tone="danger">{sp.error}</Notice>}
          <label className="block">
            <span className="label">이름</span>
            <input name="name" required className="input" />
          </label>
          <label className="block">
            <span className="label">이메일</span>
            <input name="email" type="email" required className="input" placeholder="you@company.co.kr" />
          </label>
          <label className="block">
            <span className="label">휴대전화(선택)</span>
            <input name="phone" className="input" placeholder="010-0000-0000" />
          </label>
          <label className="block">
            <span className="label">비밀번호 (8자 이상)</span>
            <input name="password" type="password" required minLength={8} className="input" />
          </label>
          <button className="btn btn-primary w-full" type="submit">
            가입하고 시작하기
          </button>
          <p className="text-center text-[0.6875rem] leading-relaxed text-[#8c98aa]">
            가입 시 <Link href="/legal/terms" className="underline">이용약관</Link>과{" "}
            <Link href="/legal/privacy" className="underline">개인정보처리방침</Link>에 동의하는 것으로 봅니다. 판매자는
            별도 심사 후 상품을 등록할 수 있습니다.
          </p>
        </form>
      </div>
    </div>
  );
}
