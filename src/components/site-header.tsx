import Link from "next/link";
import { BRAND, SERVICE_NAV } from "@/lib/brand";
import { currentUserSummary } from "@/lib/session";

export async function SiteHeader() {
  const session = await currentUserSummary();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-white/95 backdrop-blur">
      <div className="container-dv flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-navy)] text-sm font-black text-white">
            DV
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[1.0625rem] font-extrabold tracking-tight text-[var(--color-navy)]">
              {BRAND.nameKo}
            </span>
            <span className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[#7c8aa0]">
              {BRAND.nameEn}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {SERVICE_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-2 text-[0.8125rem] font-semibold text-[#3c4a60] hover:bg-[var(--color-tint)] hover:text-[var(--color-navy)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {session ? (
            <>
              <Link href="/dashboard" className="hidden text-[0.8125rem] font-semibold text-[#3c4a60] sm:block">
                내 작업실
                {session.unread > 0 && (
                  <span className="ml-1 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[0.625rem] text-white">
                    {session.unread}
                  </span>
                )}
              </Link>
              <form action="/api/auth/logout" method="post">
                <button className="btn btn-outline btn-sm" type="submit">
                  로그아웃
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-outline btn-sm">
                로그인
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm">
                무료 가입
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="border-t border-[var(--color-line)] lg:hidden">
        <div className="container-dv flex gap-3 overflow-x-auto py-2 text-[0.75rem] font-semibold text-[#3c4a60]">
          {SERVICE_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap">
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
