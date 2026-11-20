"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DemoUser = {
  email: string;
  name: string;
  relation: string | null;
  role: string;
  familyName: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  PARENT: "부모",
  GRANDPARENT: "조부모",
  FAMILY: "가족",
};

const DEMO_PASSWORD = "demo1234";

export default function LoginForm({ demoUsers }: { demoUsers: DemoUser[] }) {
  const router = useRouter();
  const [email, setEmail] = useState(demoUsers[0]?.email ?? "");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(nextEmail = email, nextPassword = password) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail, password: nextPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "로그인에 실패했습니다.");
        return;
      }
      router.push(data.user.role === "PARENT" ? "/app" : "/simple");
      router.refresh();
    } catch {
      setError("네트워크 오류로 로그인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid w-full gap-6 md:grid-cols-[360px_1fr]">
      <form
        className="card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="section-title mb-4">로그인</h2>
        <label className="label" htmlFor="email">
          이메일
        </label>
        <input id="email" className="input mb-4" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <label className="label" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          className="input mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="mb-3 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy} type="submit">
          {busy ? "로그인 중…" : "로그인"}
        </button>
        <p className="mt-3 text-center text-xs text-slate-400">데모 비밀번호는 {DEMO_PASSWORD} 입니다.</p>
      </form>

      <div className="card p-6">
        <h2 className="section-title mb-1">데모 계정으로 바로 들어가기</h2>
        <p className="mb-4 text-xs text-slate-500">
          부모 계정은 전체 기능을, 조부모·가족 계정은 &lsquo;가족 간편 모드&rsquo;를 체험합니다.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {demoUsers.map((u) => (
            <li key={u.email}>
              <button
                type="button"
                onClick={() => {
                  setEmail(u.email);
                  setPassword(DEMO_PASSWORD);
                  void submit(u.email, DEMO_PASSWORD);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 text-left transition hover:border-rose-200 hover:bg-rose-50/60"
              >
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-lg shadow-sm">
                  {u.role === "GRANDPARENT" ? "👵" : u.role === "PARENT" ? "👩‍🍼" : "🧑"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-800">
                    {u.name} <span className="font-normal text-slate-400">{u.relation}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {ROLE_LABEL[u.role] ?? u.role} · {u.familyName}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
