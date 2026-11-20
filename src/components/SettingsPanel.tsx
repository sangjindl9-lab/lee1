"use client";

import Link from "next/link";
import { useState } from "react";

type Entitlement = {
  adFree: boolean;
  scope: string | null;
  coversFamily: boolean;
  productTitle: string | null;
  platform: string | null;
  activatedAt: string | null;
  purchaserName: string | null;
  explanation: string;
  coveredMembers: string[];
};

type Inquiry = { id: string; category: string; message: string; status: string; createdAt: string };

export default function SettingsPanel({
  initialEntitlement,
  initialInquiries,
  members,
  tags,
}: {
  initialEntitlement: Entitlement;
  initialInquiries: Inquiry[];
  members: Array<{ id: string; name: string; relation: string | null; role: string }>;
  tags: Array<{ id: string; name: string; count: number }>;
}) {
  const [entitlement, setEntitlement] = useState(initialEntitlement);
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [recheck, setRecheck] = useState<{ checkedAt: string; issues: string[]; adImpressionsToday: number; verified: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("AD_REMOVAL");
  const [showPurchaseConfirm, setShowPurchaseConfirm] = useState(false);

  async function doRecheck() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/recheck", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "재확인에 실패했습니다.");
      setEntitlement(data.entitlement);
      setRecheck(data);
      setNotice(data.issues.length ? data.issues.join(" / ") : "결제 상태가 정상입니다.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "재확인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "구매 복원에 실패했습니다.");
      setEntitlement(data.entitlement);
      setNotice(data.restored ? `구매 ${data.restored}건을 복원했습니다.` : "복원할 구매 이력이 없습니다.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "구매 복원에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function submitInquiry() {
    setBusy(true);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, category, purchaseId: entitlement.productTitle ? undefined : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "문의를 접수하지 못했습니다.");
      setInquiries((prev) => [data.inquiry, ...prev]);
      setMessage("");
      setNotice("문의가 접수되었습니다. (DB 저장 완료)");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "문의를 접수하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {notice && <div className="rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white">{notice}</div>}

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="section-title">광고 제거 상태</h2>
            <p className="mt-1 text-xs text-slate-500">{entitlement.explanation}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              entitlement.adFree ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            {entitlement.adFree ? "적용 중" : "미적용"}
          </span>
        </div>

        <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">적용 범위</dt>
            <dd className="font-bold text-slate-800">
              {entitlement.adFree ? (entitlement.coversFamily ? "초대된 가족 전체" : "결제자 개인") : "-"}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">상품</dt>
            <dd className="font-bold text-slate-800">{entitlement.productTitle ?? "-"}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">적용 시작</dt>
            <dd className="font-bold text-slate-800">{entitlement.activatedAt ?? "-"}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">결제 계정</dt>
            <dd className="font-bold text-slate-800">{entitlement.purchaserName ?? "-"}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-soft" onClick={doRecheck} disabled={busy}>
            🔄 결제 상태 재확인
          </button>
          <button className="btn-ghost" onClick={restore} disabled={busy}>
            ☁️ 구매 복원 (재설치·기기 변경)
          </button>
          <button className="btn-primary ml-auto" onClick={() => setShowPurchaseConfirm(true)}>
            광고 제거 상품 보기
          </button>
        </div>

        {recheck && (
          <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-bold text-slate-700">마지막 재확인: {recheck.checkedAt}</p>
            <p className="mt-0.5">오늘 광고 노출: {recheck.adImpressionsToday}회 · {recheck.verified ? "이상 없음" : "확인 필요"}</p>
            {recheck.issues.length > 0 && <p className="mt-1 font-semibold text-amber-700">{recheck.issues.join(" ")}</p>}
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-dashed border-rose-200 bg-rose-50/50 p-3">
          <p className="text-xs font-bold text-rose-700">결제 후에도 광고가 보이나요?</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            위의 &lsquo;결제 상태 재확인&rsquo;을 먼저 눌러 주세요. 그래도 문제가 있으면 아래에서 바로 문의를 남길 수 있습니다.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select className="input w-auto py-1.5 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="AD_REMOVAL">광고 제거 관련</option>
              <option value="PAYMENT">결제·환불</option>
              <option value="ETC">기타</option>
            </select>
            <input
              className="input flex-1 py-1.5 text-xs"
              placeholder="예: 결제했는데 업로드 화면에 광고가 계속 보입니다."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button className="btn-dark py-1.5 text-xs" onClick={submitInquiry} disabled={busy || message.trim().length < 5}>
              문의 접수
            </button>
          </div>
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
        <h2 className="section-title mb-2">가족 구성원</h2>
        <ul className="flex flex-wrap gap-2">
          {members.map((m) => (
            <li key={m.id} className="rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
              {m.name} <span className="font-normal text-slate-400">{m.relation}</span>
              <span className="ml-1 rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-400">{m.role === "PARENT" ? "부모" : m.role === "GRANDPARENT" ? "조부모" : "가족"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-400">초대 링크로 가족을 추가하는 기능은 다음 단계에서 연결할 수 있습니다.</p>
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
          <p className="text-xs text-slate-500">조부모님이 보는 큰 글씨 화면을 확인합니다. 결제 메뉴는 이 설정에서만 접근할 수 있습니다.</p>
        </div>
        <Link href="/simple" className="btn-ghost">
          간편 모드 미리보기 →
        </Link>
      </section>

      {showPurchaseConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3" onClick={() => setShowPurchaseConfirm(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">광고 제거 상품으로 이동할까요?</h3>
            <p className="mt-2 text-xs text-slate-500">
              구매 화면은 설정에서만 열립니다. 결제 전에 제거되는 광고 종류와 혜택 적용 대상(개인 / 가족 전체)을 확인할 수 있습니다.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setShowPurchaseConfirm(false)}>
                취소
              </button>
              <Link href="/app/settings/purchase" className="btn-primary flex-1">
                상품 보기
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
