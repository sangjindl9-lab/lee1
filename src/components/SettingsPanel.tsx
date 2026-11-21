"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Inquiry = { id: string; category: string; message: string; status: string; createdAt: string };

export type SettingsUsage = {
  planId: string;
  planName: string;
  usedLabel: string;
  quotaLabel: string;
  percent: number;
  expiresAt: string | null;
};

export default function SettingsPanel({
  usage,
  inviteCode,
  initialInquiries,
  members,
  tags,
  isParent,
}: {
  usage: SettingsUsage;
  inviteCode: string | null;
  initialInquiries: Inquiry[];
  members: Array<{ id: string; name: string; relation: string | null; role: string }>;
  tags: Array<{ id: string; name: string; count: number }>;
  isParent: boolean;
}) {
  const router = useRouter();
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("PAYMENT");
  const [child, setChild] = useState({ name: "", birthDate: "" });
  const [showDelete, setShowDelete] = useState(false);
  const [password, setPassword] = useState("");

  async function submitInquiry() {
    setBusy(true);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "문의를 접수하지 못했습니다.");
      setInquiries((prev) => [data.inquiry, ...prev]);
      setMessage("");
      setNotice("문의가 접수되었습니다. 답변은 가입한 이메일로 보내 드립니다.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "문의를 접수하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function addChild() {
    setBusy(true);
    try {
      const res = await fetch("/api/children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(child),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "아이를 추가하지 못했습니다.");
      setChild({ name: "", birthDate: "" });
      setNotice(`${data.child.name} 앨범을 만들었어요.`);
      router.refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "아이를 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function shareInvite() {
    if (!inviteCode) return;
    const url = `${window.location.origin}/signup?code=${encodeURIComponent(inviteCode)}`;
    const text = `가족앨범에 초대합니다. 초대 코드: ${inviteCode}\n${url}`;
    try {
      if (navigator.share) await navigator.share({ title: "가족앨범 초대", text });
      else {
        await navigator.clipboard.writeText(text);
        setNotice("초대 문구를 복사했어요. 카카오톡 등에 붙여 넣어 보내세요.");
      }
    } catch {
      /* 공유 취소 */
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  async function deleteAccount() {
    setBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "탈퇴하지 못했습니다.");
      router.push("/login");
      router.refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "탈퇴하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p className="rounded-2xl bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700" role="status">
          {notice}
        </p>
      )}

      <section className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title">요금제 · 저장 공간</h2>
            <p className="mt-1 text-xs text-slate-500">
              {usage.planName}
              {usage.expiresAt ? ` · ${usage.expiresAt}까지` : ""}
            </p>
          </div>
          <Link href="/app/plans" className="btn-primary py-1.5 text-xs">
            {usage.planId === "FREE" ? "용량 늘리기" : "요금제 관리"}
          </Link>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${usage.percent >= 90 ? "bg-red-500" : "bg-rose-400"}`} style={{ width: `${Math.max(2, usage.percent)}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {usage.usedLabel} / {usage.quotaLabel} 사용 ({usage.percent}%)
        </p>
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-2">가족 구성원</h2>
        <ul className="flex flex-wrap gap-2">
          {members.map((m) => (
            <li key={m.id} className="rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
              {m.name} <span className="font-normal text-slate-400">{m.relation}</span>
              <span className="ml-1 rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-400">
                {m.role === "PARENT" ? "부모" : m.role === "GRANDPARENT" ? "조부모" : "가족"}
              </span>
            </li>
          ))}
        </ul>
        {inviteCode && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50 p-3">
            <span className="text-xs text-slate-600">초대 코드</span>
            <code className="rounded-lg bg-white px-2 py-1 text-sm font-black tracking-widest text-slate-800">{inviteCode}</code>
            <button className="btn-ghost ml-auto py-1.5 text-xs" onClick={shareInvite}>
              초대 보내기
            </button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400">가족은 가입 화면에서 초대 코드를 넣으면 같은 앨범을 함께 봅니다. 요금제 용량은 가족 전체가 함께 씁니다.</p>
      </section>

      {isParent && (
        <section className="card p-5">
          <h2 className="section-title mb-2">아이 추가</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className="input flex-1 py-1.5 text-sm" placeholder="이름" value={child.name} onChange={(e) => setChild((c) => ({ ...c, name: e.target.value }))} />
            <input type="date" className="input py-1.5 text-sm sm:w-44" value={child.birthDate} onChange={(e) => setChild((c) => ({ ...c, birthDate: e.target.value }))} />
            <button className="btn-dark py-1.5 text-xs" onClick={addChild} disabled={busy || !child.name.trim() || !child.birthDate}>
              추가
            </button>
          </div>
        </section>
      )}

      <section className="card p-5">
        <h2 className="section-title mb-2">문의하기</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select className="input w-auto py-1.5 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="PAYMENT">결제·구독·환불</option>
            <option value="BUG">오류 신고</option>
            <option value="ETC">기타</option>
          </select>
          <input className="input flex-1 py-1.5 text-xs" placeholder="궁금한 점을 적어 주세요." value={message} onChange={(e) => setMessage(e.target.value)} />
          <button className="btn-dark py-1.5 text-xs" onClick={submitInquiry} disabled={busy || message.trim().length < 5}>
            문의 접수
          </button>
        </div>
        {inquiries.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs">
            {inquiries.map((i) => (
              <li key={i.id} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
                <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{i.status}</span>
                {i.message}
                <span className="ml-2 text-[10px] text-slate-400">{i.createdAt}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-2">태그 모아보기</h2>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t.id} className="chip">
              #{t.name} {t.count}
            </span>
          ))}
          {tags.length === 0 && <span className="text-xs text-slate-400">태그가 없습니다.</span>}
        </div>
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="section-title">가족 간편 모드</h2>
          <p className="text-xs text-slate-500">조부모님이 보는 큰 글씨 화면을 확인합니다.</p>
        </div>
        <Link href="/simple" className="btn-ghost">
          간편 모드 미리보기 →
        </Link>
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-2">계정</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/privacy" className="btn-ghost py-1.5 text-xs">개인정보처리방침</Link>
          <Link href="/terms" className="btn-ghost py-1.5 text-xs">이용약관</Link>
          <button className="btn-ghost py-1.5 text-xs" onClick={logout}>로그아웃</button>
          <button className="btn-ghost ml-auto py-1.5 text-xs text-red-600" onClick={() => setShowDelete(true)}>회원 탈퇴</button>
        </div>
      </section>

      {showDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3" onClick={() => setShowDelete(false)}>
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-black text-slate-900">정말 탈퇴할까요?</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600">
              <li>내 계정과 댓글·좋아요가 지워집니다.</li>
              <li>내가 가족의 마지막 부모라면, 가족의 사진·동영상·육아기록이 모두 지워지고 되돌릴 수 없습니다.</li>
              <li>유료 구독은 자동으로 해지되지 않습니다. Google Play 앱 → 결제 및 정기 결제에서 해지해 주세요.</li>
            </ul>
            <input type="password" className="input mt-3" placeholder="비밀번호 확인" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="mt-3 flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setShowDelete(false)}>취소</button>
              <button className="btn-primary flex-1 bg-red-600" onClick={deleteAccount} disabled={busy || !password}>탈퇴하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
