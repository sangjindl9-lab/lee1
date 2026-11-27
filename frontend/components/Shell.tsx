"use client";
import {
  BarChart3, CalendarClock, Clapperboard, Film, Flame, Gauge, KeyRound, LayoutDashboard, LineChart, LogOut, Menu,
  Mic, Music, Palette, PlugZap, Scissors, Search, Settings, ShieldCheck, UserRound, Wallet, X, Youtube,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, token } from "@/lib/api";
import { cx } from "./ui";

const NAV: { label: string; items: [string, string, any][] }[] = [
  { label: "제작", items: [
    ["/", "메인 대시보드", LayoutDashboard], ["/create", "AI 쇼츠 만들기", Clapperboard], ["/topics", "인기 주제 찾기", Flame],
    ["/analysis", "유튜브 콘텐츠 분석", Search], ["/progress", "제작 진행 현황", Gauge], ["/library", "완성 영상 보관함", Film],
    ["/editor", "AI 영상 편집기", Scissors], ["/schedule", "예약 제작", CalendarClock]] },
  { label: "제작 자산", items: [
    ["/characters", "캐릭터 관리", UserRound], ["/branding", "채널 브랜딩 관리", Palette], ["/voices", "음성 라이브러리", Mic],
    ["/music", "음악 라이브러리", Music]] },
  { label: "채널", items: [["/channels", "유튜브 채널 연결", Youtube], ["/performance", "채널 성과 분석", LineChart]] },
  { label: "설정", items: [
    ["/connections", "API 연결 관리", PlugZap], ["/costs", "사용량 및 비용 관리", Wallet], ["/settings", "환경설정", Settings]] },
];

const UserCtx = createContext<any>(null);
export const useUser = () => useContext(UserCtx);

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const bare = path === "/login";

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (bare) return;
    if (!token()) { router.replace("/login"); return; }
    api("/auth/me").then(setUser).catch(() => {});
  }, [bare, router]);
  useEffect(() => setOpen(false), [path]);

  if (bare) return <>{children}</>;
  if (!user) return <div className="min-h-screen" />;

  const groups = user.role === "admin" ? [...NAV, { label: "운영", items: [["/admin", "관리자", ShieldCheck] as [string, string, any]] }] : NAV;
  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 pb-4">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="text-mute text-[12px] px-2 mt-6 mb-2">{g.label}</div>
          <div className="flex flex-col gap-0.5">
            {g.items.map(([href, label, Icon]) => {
              const on = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link key={href} href={href}
                  className={cx("flex items-center gap-2.5 h-9 px-2 rounded-lg transition-colors duration-150 ease-out", on ? "bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-sub hover:text-ink hover:bg-raised/60")}>
                  <Icon size={16} strokeWidth={1.5} className={on ? "text-ink" : "text-mute"} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
  const brand = (
    <Link href="/" className="flex items-center gap-2.5 h-14 px-5 shrink-0">
      <span className="relative w-[14px] h-[22px] rounded-[3px] border border-ink/80 flex items-center justify-center"><span className="w-1 h-1 rounded-full bg-tally" /></span>
      <span className="text-[15px] font-semibold tracking-[0.01em]">Shorts Factory</span>
    </Link>
  );
  const foot = (
    <div className="border-t px-3 py-3 flex items-center gap-2">
      <KeyRound size={16} strokeWidth={1.5} className="text-mute ml-2" />
      <span className="text-sub flex-1 truncate">{user.username}</span>
      <button aria-label="로그아웃" onClick={() => { setToken(null); location.href = "/login"; }} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-mute hover:text-ink hover:bg-raised transition-colors duration-150">
        <LogOut size={16} strokeWidth={1.5} />
      </button>
    </div>
  );

  return (
    <UserCtx.Provider value={user}>
      <div className="min-h-screen lg:pl-[256px]">
        <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[256px] bg-deep border-r flex-col">{brand}{nav}{foot}</aside>
        <header className="lg:hidden sticky top-0 z-30 h-14 bg-deep border-b flex items-center justify-between pr-3">
          {brand}
          <button aria-label="메뉴" onClick={() => setOpen(!open)} className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-sub hover:bg-raised">
            {open ? <X size={18} strokeWidth={1.5} /> : <Menu size={18} strokeWidth={1.5} />}
          </button>
        </header>
        {open && <div className="lg:hidden fixed inset-x-0 top-14 bottom-0 z-20 bg-deep flex flex-col rise">{nav}{foot}</div>}
        <main>{children}</main>
      </div>
    </UserCtx.Provider>
  );
}

export const BarIcon = BarChart3;
