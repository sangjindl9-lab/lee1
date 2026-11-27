"use client";
import { Loader2 } from "lucide-react";
import { ReactNode, useState } from "react";
import { ACTIVE, STATUS } from "@/lib/api";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export function Button({ kind = "secondary", busy, className, children, ...p }: any) {
  const base = "inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg text-[14px] font-medium whitespace-nowrap transition-[background-color,border-color,transform,opacity] duration-150 ease-out active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
  const kinds: Record<string, string> = {
    primary: "bg-ink text-deep hover:bg-white",
    secondary: "bg-raised border text-ink hover:border-[rgba(237,237,237,0.2)]",
    ghost: "text-sub hover:text-ink hover:bg-raised",
    danger: "bg-raised border text-bad hover:border-bad/40",
  };
  return (
    <button {...p} disabled={p.disabled || busy} className={cx(base, kinds[kind], className)}>
      {busy && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />}
      {children}
    </button>
  );
}

export const Card = ({ className, children, ...p }: any) => (
  <section {...p} className={cx("bg-card border rounded-[14px] p-5", className)}>{children}</section>
);

export function Page({ title, meta, actions, children }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="rise mx-auto w-full max-w-[1440px] px-4 sm:px-8 py-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] leading-8 font-medium">{title}</h1>
          {meta && <p className="text-sub mt-2 max-w-[44rem]">{meta}</p>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export const Field = ({ label, hint, children, className }: any) => (
  <label className={cx("block", className)}>
    <span className="block text-sub text-[13px] mb-2">{label}</span>
    {children}
    {hint && <span className="block text-mute text-[12px] mt-1">{hint}</span>}
  </label>
);

export const H2 = ({ children, right }: any) => (
  <div className="flex items-center justify-between mb-3">
    <h2 className="text-[15px] font-medium">{children}</h2>
    {right}
  </div>
);

/** 상태 표시: 진행 중일 때만 탤리 라이트가 켜진다 */
export function Status({ s }: { s: string }) {
  const live = ACTIVE.includes(s);
  const color = live ? "bg-tally" : s === "COMPLETED" ? "bg-ok" : s === "FAILED" ? "bg-bad" : s === "AWAITING_APPROVAL" ? "bg-ink" : "bg-mute";
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-sub whitespace-nowrap">
      <span className={cx("w-1.5 h-1.5 rounded-full", color, live && "animate-pulse")} />
      {STATUS[s] || s}
    </span>
  );
}

export const Note = ({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) => (
  <div className={cx("rounded-lg border px-3 py-2 text-[13px] leading-5", tone === "bad" ? "text-bad border-bad/30" : tone === "ok" ? "text-ok border-ok/30" : tone === "warn" ? "text-ink" : "text-sub")}>
    {children}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="text-mute text-[13px] py-10 text-center">{children}</div>;

export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <Card className="!p-4">
    <div className="text-sub text-[13px]">{label}</div>
    <div className="num text-[28px] leading-8 font-medium mt-2">{value}</div>
    {sub && <div className="text-mute text-[12px] mt-1">{sub}</div>}
  </Card>
);

export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b mb-5 -mx-1 px-1">
      {tabs.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={cx("h-9 px-3 text-[14px] whitespace-nowrap border-b-2 -mb-px transition-colors duration-150 ease-out", value === k ? "border-ink text-ink" : "border-transparent text-sub hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** 요청 실행 + 오류 표시를 한 번에 처리 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<any>, ok?: string) {
    setBusy(key); setError(null); setDone(null);
    try { const r = await fn(); if (ok) setDone(ok); return r; }
    catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }
  const view = (error || done) ? <div className="mt-3"><Note tone={error ? "bad" : "ok"}>{error || done}</Note></div> : null;
  return { busy, error, run, view, setError };
}

export { cx };
