"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const PARENT_RELATIONS = ["엄마", "아빠"];
const FAMILY_RELATIONS = ["엄마", "아빠", "할머니", "할아버지", "외할머니", "외할아버지", "이모", "고모", "삼촌", "가족"];

export default function SignupForm({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "join">(initialCode ? "join" : "new");
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    relation: "",
    familyName: "",
    childName: "",
    childBirthDate: "",
    inviteCode: initialCode,
  });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload =
        mode === "new"
          ? { ...form, inviteCode: "", agreeTerms: agree }
          : { email: form.email, password: form.password, name: form.name, relation: form.relation, inviteCode: form.inviteCode, agreeTerms: agree };
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "가입하지 못했습니다.");
        return;
      }
      router.push(data.user.role === "PARENT" ? "/app" : "/simple");
      router.refresh();
    } catch {
      setError("네트워크 오류로 가입하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const relations = mode === "new" ? PARENT_RELATIONS : FAMILY_RELATIONS;

  return (
    <form
      className="card w-full p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 text-sm font-bold">
        <button type="button" onClick={() => setMode("new")} className={`rounded-xl py-2 ${mode === "new" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500"}`}>
          새 가족 만들기
        </button>
        <button type="button" onClick={() => setMode("join")} className={`rounded-xl py-2 ${mode === "join" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500"}`}>
          초대 코드로 합류
        </button>
      </div>

      {mode === "join" && (
        <>
          <label className="label" htmlFor="code">초대 코드</label>
          <input id="code" className="input mb-4 uppercase tracking-widest" placeholder="ABCD-1234" value={form.inviteCode} onChange={set("inviteCode")} required />
        </>
      )}

      <label className="label" htmlFor="name">내 이름</label>
      <input id="name" className="input mb-4" value={form.name} onChange={set("name")} required />

      <label className="label" htmlFor="relation">아이와의 관계</label>
      <select id="relation" className="input mb-4" value={form.relation} onChange={set("relation")} required>
        <option value="">선택해 주세요</option>
        {relations.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      {mode === "new" && (
        <>
          <label className="label" htmlFor="familyName">가족 이름 (선택)</label>
          <input id="familyName" className="input mb-4" placeholder="예: 서준이네" value={form.familyName} onChange={set("familyName")} />
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="childName">첫 아이 이름</label>
              <input id="childName" className="input" value={form.childName} onChange={set("childName")} required />
            </div>
            <div>
              <label className="label" htmlFor="childBirth">생일</label>
              <input id="childBirth" type="date" className="input" value={form.childBirthDate} onChange={set("childBirthDate")} required />
            </div>
          </div>
        </>
      )}

      <label className="label" htmlFor="email">이메일</label>
      <input id="email" type="email" className="input mb-4" value={form.email} onChange={set("email")} autoComplete="username" required />
      <label className="label" htmlFor="pw">비밀번호 (8자 이상)</label>
      <input id="pw" type="password" className="input mb-4" value={form.password} onChange={set("password")} autoComplete="new-password" minLength={8} required />

      <label className="mb-4 flex items-start gap-2 text-xs text-slate-600">
        <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          <Link href="/terms" className="font-bold underline" target="_blank">이용약관</Link>과{" "}
          <Link href="/privacy" className="font-bold underline" target="_blank">개인정보처리방침</Link>에 동의합니다. (필수, 만 14세 이상)
        </span>
      </label>

      {error && <p className="mb-3 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy} type="submit">
        {busy ? "가입 중…" : "가입하고 시작하기"}
      </button>
      <p className="mt-4 text-center text-sm text-slate-500">
        이미 계정이 있나요? <Link href="/login" className="font-bold text-rose-600 underline">로그인</Link>
      </p>
    </form>
  );
}
