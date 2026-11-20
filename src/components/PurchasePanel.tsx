"use client";

import Link from "next/link";
import { useState } from "react";

type Product = {
  id: string;
  title: string;
  priceKRW: number;
  scope: string;
  period: string;
  removes: string[];
  covers: string[];
};
type Entitlement = { adFree: boolean; scope: string | null; productTitle: string | null; explanation: string; activatedAt: string | null };

export default function PurchasePanel({
  products,
  platforms,
  initialEntitlement,
}: {
  products: Product[];
  platforms: Array<{ id: string; configured: boolean }>;
  initialEntitlement: Entitlement;
}) {
  const [selected, setSelected] = useState(products[1]?.id ?? products[0]?.id ?? "");
  const [platform, setPlatform] = useState("WEB_MOCK");
  const [entitlement, setEntitlement] = useState(initialEntitlement);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const platformLabel: Record<string, string> = {
    WEB_MOCK: "웹 데모 결제 (지금 바로 체험)",
    GOOGLE_PLAY: "Google Play",
    APPLE_APP_STORE: "Apple App Store",
  };

  async function buy() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/billing/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selected, platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "결제에 실패했습니다.");
      setEntitlement(data.entitlement);
      setNotice("결제가 완료되어 광고 제거가 적용되었습니다. 설정 화면에서 상태를 확인할 수 있습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "결제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "구매 복원에 실패했습니다.");
      setEntitlement(data.entitlement);
      setNotice(data.restored ? "구매 내역을 복원했습니다." : "복원할 구매 내역이 없습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "구매 복원에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const chosen = products.find((p) => p.id === selected);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <p className="font-black">결제 전 꼭 확인하세요</p>
        <p className="mt-1">
          제거되는 광고: 하단 배너 · 업로드 화면 광고 · 앨범 사이 광고. <br />
          혜택 적용 대상은 상품에 따라 <strong>결제자 개인</strong> 또는 <strong>같은 가족에 초대된 가족 전체(조부모 포함)</strong>로 다릅니다. 아래 상품 카드에서 확인할 수 있어요.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {products.map((product) => {
          const active = selected === product.id;
          return (
            <button
              key={product.id}
              onClick={() => setSelected(product.id)}
              className={`card p-5 text-left transition ${active ? "ring-2 ring-rose-500" : "hover:-translate-y-0.5"}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-black text-slate-900">{product.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">매월 {product.priceKRW.toLocaleString()}원</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${product.scope === "FAMILY" ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-600"}`}>
                  {product.scope === "FAMILY" ? "가족 전체" : "개인"}
                </span>
              </div>
              <p className="mt-3 text-xs font-bold text-slate-700">적용 대상</p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {product.covers.map((c) => (
                  <li key={c}>✓ {c}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs font-bold text-slate-700">제거되는 광고</p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {product.removes.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <section className="card p-5">
        <h2 className="section-title mb-2">결제 수단</h2>
        <div className="flex flex-wrap gap-2">
          {platforms.map((p) => (
            <button
              key={p.id}
              onClick={() => p.configured && setPlatform(p.id)}
              disabled={!p.configured}
              className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${
                platform === p.id ? "border-rose-500 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-600"
              } ${!p.configured ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {platformLabel[p.id] ?? p.id}
              {!p.configured && <span className="ml-1 text-[10px] text-slate-400">계정 연동 필요</span>}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Google Play·App Store 결제는 스토어 개발자 계정과 상품 등록, 서버 영수증 검증 키가 연결되면 활성화됩니다. 지금은 웹 데모 결제로 전체 흐름을 검증합니다.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={buy} disabled={busy || !chosen}>
            {chosen ? `${chosen.priceKRW.toLocaleString()}원 결제하고 광고 제거` : "상품을 선택해 주세요"}
          </button>
          <button className="btn-ghost" onClick={restore} disabled={busy}>
            구매 복원
          </button>
          <Link href="/app/settings" className="btn-ghost ml-auto">
            설정으로 돌아가기
          </Link>
        </div>

        {notice && <div className="mt-3 rounded-2xl bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700">{notice}</div>}
        {error && <div className="mt-3 rounded-2xl bg-red-50 px-4 py-2 text-xs font-semibold text-red-600">{error}</div>}

        {entitlement.adFree && (
          <div className="mt-3 rounded-2xl bg-slate-900 px-4 py-3 text-xs text-white">
            <p className="font-bold">현재 적용 중: {entitlement.productTitle}</p>
            <p className="mt-0.5 text-white/70">{entitlement.explanation}</p>
            <p className="mt-0.5 text-white/50">적용 시작 {entitlement.activatedAt}</p>
          </div>
        )}
      </section>
    </div>
  );
}
