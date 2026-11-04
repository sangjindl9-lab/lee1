"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("user@ieum.power");
  const [password, setPassword] = useState("user1234");
  const [msg, setMsg] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 데모: 클라이언트 세션 흉내
    const accounts: Record<string, { password: string; name: string; role: string }> = {
      "user@ieum.power": { password: "user1234", name: "일반 사용자", role: "USER" },
      "admin@ieum.power": { password: "admin1234", name: "관리자", role: "ADMIN" },
      "pro@ieum.power": { password: "pro1234", name: "전기공사업체", role: "CONTRACTOR" },
    };
    const acc = accounts[email];
    if (acc && acc.password === password) {
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "ieum_user",
          JSON.stringify({ email, name: acc.name, role: acc.role })
        );
      }
      setMsg("로그인 성공");
      router.push("/places");
    } else {
      setMsg("이메일 또는 비밀번호가 올바르지 않습니다.");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">로그인</h1>
      <p className="text-sm text-slate-600">
        데모 계정으로 테스트할 수 있습니다. 실제 운영 시에는 서버 인증·비밀번호 해시를 사용하세요.
      </p>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div>
          <label className="label">이메일</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label">비밀번호</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {msg && <p className="text-sm text-teal-700">{msg}</p>}
        <button type="submit" className="btn-primary w-full">
          로그인
        </button>
      </form>
      <div className="text-xs text-slate-500 space-y-1">
        <p>user@ieum.power / user1234 (일반)</p>
        <p>pro@ieum.power / pro1234 (공사업체)</p>
        <p>admin@ieum.power / admin1234 (관리자)</p>
      </div>
    </div>
  );
}
