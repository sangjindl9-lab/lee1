import Link from "next/link";
import { MEMBER_NAV } from "@/lib/brand";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("/dashboard");
  const isOperator = actor.roles.some((r) => r.startsWith("OPERATOR_") || r === "SUPER_ADMIN");

  return (
    <div className="container-dv py-8">
      <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
        <aside>
          <div className="card p-4">
            <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">{actor.name}</div>
            <div className="mt-0.5 text-[0.6875rem] text-[#8c98aa]">{actor.email}</div>
            {actor.companyId && (
              <div className="mt-2 rounded bg-[var(--color-tint)] px-2 py-1 text-[0.625rem] text-[#5a6a80]">
                기업 계정 · {actor.companyRole}
              </div>
            )}
          </div>
          <nav className="mt-3 space-y-0.5">
            {MEMBER_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-md px-3 py-2 text-[0.8125rem] font-medium text-[#3c4a60] hover:bg-white hover:text-[var(--color-navy)]"
              >
                {item.label}
              </Link>
            ))}
            <div className="my-2 border-t border-[var(--color-line)]" />
            <Link href="/dashboard/seller" className="block rounded-md px-3 py-2 text-[0.8125rem] font-medium text-[#3c4a60] hover:bg-white">
              판매자 센터
            </Link>
            <Link href="/seller/products/new" className="block rounded-md px-3 py-2 text-[0.8125rem] font-medium text-[#3c4a60] hover:bg-white">
              상품 등록
            </Link>
            {isOperator && (
              <Link href="/admin" className="block rounded-md px-3 py-2 text-[0.8125rem] font-semibold text-[var(--color-accent)]">
                운영자 콘솔
              </Link>
            )}
          </nav>
        </aside>
        <div>{children}</div>
      </div>
    </div>
  );
}
