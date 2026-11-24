import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LogoutButton from "./LogoutButton";
import BillingAutoRestore from "./BillingAutoRestore";
import RetentionBanner from "./RetentionBanner";

const NAV = [
  { href: "/app", label: "홈", icon: "🏠" },
  { href: "/app/upload", label: "올리기", icon: "⬆️" },
  { href: "/app/search", label: "검색", icon: "🔎" },
  { href: "/app/care", label: "육아기록", icon: "🌙" },
  { href: "/app/trash", label: "휴지통", icon: "🗑️" },
  { href: "/app/settings", label: "설정", icon: "⚙️" },
];

export default async function AppShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: string;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "PARENT") redirect("/simple");

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-rose-100/70 bg-[#fffaf6]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/app" className="flex items-center gap-2">
            <span className="text-xl">🍼</span>
            <span className="text-sm font-black tracking-tight text-slate-900">가족앨범</span>
          </Link>
          <nav className="ml-2 flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  active === item.href ? "bg-rose-500 text-white" : "text-slate-600 hover:bg-rose-50"
                }`}
              >
                <span className="mr-1">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
              {user.name} · {user.relation ?? "부모"}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <RetentionBanner familyId={user.familyId} />
      <BillingAutoRestore />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-24">{children}</main>
    </div>
  );
}
