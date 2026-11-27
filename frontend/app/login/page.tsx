"use client";
import { useState } from "react";
import { Button, Field, Note } from "@/components/ui";
import { api, setToken } from "@/lib/api";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ username: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: any) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api(`/auth/${mode}`, { body: f }); setToken(r.token); location.href = "/"; }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_480px]">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-deep border-r">
        <div className="flex items-center gap-2.5"><span className="w-[14px] h-[22px] rounded-[3px] border border-ink/80 flex items-center justify-center"><span className="w-1 h-1 rounded-full bg-tally" /></span><span className="text-[15px] font-semibold">Shorts Factory</span></div>
        <div>
          <h1 className="text-[44px] leading-[1.1] font-medium tracking-[-0.02em] max-w-[14em]">주제 한 줄이 들어가면 검수까지 끝난 쇼츠가 나옵니다</h1>
          <p className="text-sub text-[18px] leading-7 mt-5 max-w-[32rem]">조사, 대본, 스토리보드, 생성, 편집, 품질검수 17단계를 순서대로 진행하고 단계마다 기록을 남깁니다</p>
          <div className="flex gap-1 mt-10">{Array.from({ length: 17 }).map((_, i) => <span key={i} className={`w-3 h-7 rounded-[2px] ${i < 11 ? "bg-ink/70" : i === 11 ? "bg-tally" : "bg-raised"}`} />)}</div>
          <div className="num text-mute text-[12px] mt-2">12 / 17 이미지 생성</div>
        </div>
        <div className="text-mute text-[12px]">예산을 넘는 작업은 과금 전에 멈추고 승인을 기다립니다</div>
      </div>
      <form onSubmit={submit} className="flex flex-col justify-center px-6 sm:px-12 py-12 max-w-[480px] w-full mx-auto">
        <h2 className="text-[28px] leading-8 font-medium mb-8">{mode === "login" ? "로그인" : "계정 만들기"}</h2>
        <div className="flex flex-col gap-4">
          <Field label="아이디"><input autoFocus autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
          <Field label="비밀번호" hint={mode === "register" ? "8자 이상" : undefined}><input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          {err && <Note tone="bad">{err}</Note>}
          <Button kind="primary" busy={busy} type="submit" className="!h-11 mt-2">{mode === "login" ? "로그인" : "가입하고 시작"}</Button>
        </div>
        <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")} className="text-sub hover:text-ink text-[13px] mt-6 self-start transition-colors duration-150">
          {mode === "login" ? "계정이 없으면 새로 만들기" : "이미 계정이 있으면 로그인"}
        </button>
      </form>
    </div>
  );
}
