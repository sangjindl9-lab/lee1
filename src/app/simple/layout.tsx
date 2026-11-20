import type { Metadata } from "next";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "가족 간편 모드 · 가족앨범" };

export default async function SimpleLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="simple-mode min-h-dvh bg-[#fffaf6]">
      <header className="sticky top-0 z-30 border-b border-rose-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link href="/simple" className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
            <span>🍼</span> 우리 손주
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-base font-semibold text-slate-500 sm:block">{user?.name ?? ""} {user?.relation ? `(${user.relation})` : ""}</span>
            <Link href="/simple/settings" className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-2xl" aria-label="설정">
              ⚙️
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-3 pb-24 pt-4">{children}</main>
    </div>
  );
}
