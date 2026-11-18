import Link from "next/link";
import { requireOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const MENU = [
  { href: "/admin", label: "운영 현황" },
  { href: "/admin/products", label: "상품·파일 심사" },
  { href: "/admin/sellers", label: "판매자 심사" },
  { href: "/admin/disputes", label: "분쟁·신고" },
  { href: "/admin/settlements", label: "결제·환불·정산" },
  { href: "/admin/reconciliation", label: "대사(Reconciliation)" },
  { href: "/admin/audit", label: "감사 기록" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireOperator("REVIEW");
  const scopeLabel = actor.roles.includes("SUPER_ADMIN")
    ? "최고관리자"
    : actor.roles.includes("OPERATOR_REVIEW")
      ? "심사"
      : actor.roles.includes("OPERATOR_SETTLEMENT")
        ? "정산"
        : "고객지원";

  return (
    <div className="container-dv py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[1.25rem] font-black text-[var(--color-navy)]">운영자 콘솔</h1>
          <p className="text-[0.6875rem] text-[#8c98aa]">
            {actor.name} · 권한 {scopeLabel} · 모든 주요 작업은 감사 로그에 기록됩니다
          </p>
        </div>
        <Link href="/dashboard/purchases" className="btn btn-outline btn-sm">
          회원 화면
        </Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="space-y-0.5">
          {MENU.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="block rounded-md px-3 py-2 text-[0.8125rem] font-medium text-[#3c4a60] hover:bg-white hover:text-[var(--color-navy)]"
            >
              {m.label}
            </Link>
          ))}
        </nav>
        <div>{children}</div>
      </div>
    </div>
  );
}
