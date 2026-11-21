"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
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
    <form
      className="card w-full max-w-sm p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className="section-title mb-4">로그인</h2>
      <label className="label" htmlFor="email">
        이메일
      </label>
      <input id="email" type="email" className="input mb-4" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
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
        required
      />
      {error && <p className="mb-3 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy} type="submit">
        {busy ? "로그인 중…" : "로그인"}
      </button>
      <p className="mt-4 text-center text-sm text-slate-500">
        처음이신가요?{" "}
        <Link href="/signup" className="font-bold text-rose-600 underline">
          가입하기
        </Link>
      </p>
      <p className="mt-1 text-center text-xs text-slate-400">가족에게 받은 초대 코드가 있으면 가입할 때 입력하세요.</p>
    </form>
  );
}
