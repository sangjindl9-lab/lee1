"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type PlanRow = {
  id: string;
  name: string;
  quota: string;
  productId: string | null;
  prices: Array<{ basePlanId: string; priceKRW: number; label: string }>;
  perks: string[];
};
type Info = {
  billingReady: boolean;
  familyId: string;
  userId: string;
  canPurchase: boolean;
  plans: PlanRow[];
  usage: { planId: string; used: string; quota: string; percent: number; expiresAt: string | null };
  subscription: { productId: string; basePlanId: string | null; state: string; autoRenewing: boolean; expiresAt: string | null; purchaseToken: string | null; mine: boolean } | null;
};
type StoreOffer = { productId: string; basePlanId: string; offerId: string | null; price: string; trial: boolean };

type Bridge = {
  queryProducts(ids: string): void;
  purchase(productId: string, basePlanId: string, accountId: string, profileId: string, oldToken: string | null): void;
  restore(): void;
  manage(productId: string | null): void;
};

declare global {
  interface Window {
    FamilyAlbumBilling?: Bridge;
    __faBilling?: (event: string, data: unknown) => void;
  }
}

const STATE_LABEL: Record<string, string> = {
  SUBSCRIPTION_STATE_ACTIVE: "이용 중",
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "결제 확인 중 (유예 기간)",
  SUBSCRIPTION_STATE_ON_HOLD: "결제 실패로 보류됨",
  SUBSCRIPTION_STATE_CANCELED: "해지됨 (기간 끝까지 이용)",
};

export default function PlansClient({ inApp }: { inApp: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [offers, setOffers] = useState<StoreOffer[]>([]);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("yearly");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bridge = typeof window !== "undefined" ? window.FamilyAlbumBilling : undefined;
  const infoRef = useRef<Info | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/billing/plans", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      setInfo(data);
      infoRef.current = data;
    }
    return data as Info | null;
  }, []);

  const verify = useCallback(
    async (tokens: string[]) => {
      if (!tokens.length) {
        setBusy(false);
        setNotice("이 Google 계정에 복원할 구독이 없습니다.");
        return;
      }
      setBusy(true);
      let applied = 0;
      let lastError: string | null = null;
      for (const purchaseToken of tokens) {
        const res = await fetch("/api/billing/play/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purchaseToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) applied += 1;
        else lastError = data?.error?.message ?? "결제를 확인하지 못했습니다.";
      }
      await load();
      setBusy(false);
      setNotice(applied ? "요금제가 적용되었어요. 가족 모두에게 바로 반영됩니다." : lastError ?? "적용할 구독이 없습니다.");
    },
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!bridge || !info) return;
    window.__faBilling = (event, data) => {
      if (event === "products") setOffers(data as StoreOffer[]);
      else if (event === "purchases") {
        const list = data as Array<{ purchaseToken: string; state: number }>;
        // state 1 = 결제 완료, 2 = 결제 대기(편의점 결제 등)
        if (list.some((p) => p.state === 2)) setNotice("결제가 대기 중입니다. 결제가 끝나면 자동으로 적용돼요.");
        void verify(list.filter((p) => p.state === 1).map((p) => p.purchaseToken));
      } else if (event === "canceled") {
        setBusy(false);
      } else if (event === "error") {
        setBusy(false);
        const e = data as { code: number; message: string };
        setNotice(e.code === 7 ? "이미 이용 중인 구독입니다. '구매 복원'을 눌러 주세요." : `결제를 진행하지 못했습니다. (${e.code}) ${e.message ?? ""}`);
      }
    };
    const ids = info.plans.map((p) => p.productId).filter(Boolean).join(",");
    bridge.queryProducts(ids);
    return () => {
      window.__faBilling = undefined;
    };
  }, [bridge, info?.familyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return <p className="text-sm text-slate-400">불러오는 중…</p>;

  const current = info.usage.planId;
  const sub = info.subscription;

  function buy(plan: PlanRow) {
    if (!bridge || !info || !plan.productId) return;
    setBusy(true);
    setNotice(null);
    const oldToken = sub && sub.productId !== plan.productId ? sub.purchaseToken : null;
    bridge.purchase(plan.productId, cycle, info.familyId, info.userId, oldToken);
  }

  return (
    <div className="space-y-4">
      {notice && <p className="rounded-2xl bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">{notice}</p>}

      <section className="card p-5">
        <p className="text-xs text-slate-500">우리 가족 사용량</p>
        <p className="mt-1 text-lg font-black text-slate-900">
          {info.usage.used} <span className="text-sm font-semibold text-slate-400">/ {info.usage.quota}</span>
        </p>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${info.usage.percent >= 90 ? "bg-red-500" : "bg-rose-400"}`} style={{ width: `${Math.max(2, info.usage.percent)}%` }} />
        </div>
        {sub && (
          <p className="mt-2 text-xs text-slate-600">
            {STATE_LABEL[sub.state] ?? sub.state}
            {sub.expiresAt ? ` · ${new Date(sub.expiresAt).toLocaleDateString("ko-KR")} ${sub.state === "SUBSCRIPTION_STATE_CANCELED" ? "까지" : "다음 결제"}` : ""}
          </p>
        )}
      </section>

      <div className="flex justify-center">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 text-sm font-bold">
          <button onClick={() => setCycle("monthly")} className={`rounded-xl px-4 py-1.5 ${cycle === "monthly" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500"}`}>
            월간
          </button>
          <button onClick={() => setCycle("yearly")} className={`rounded-xl px-4 py-1.5 ${cycle === "yearly" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500"}`}>
            연간 (할인)
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {info.plans.map((plan) => {
          const price = plan.prices.find((p) => p.basePlanId === cycle) ?? plan.prices[0];
          const store = offers.find((o) => o.productId === plan.productId && o.basePlanId === (price?.basePlanId ?? cycle));
          const isCurrent = plan.id === current;
          const cycleMissing = plan.productId && !plan.prices.some((p) => p.basePlanId === cycle);
          return (
            <section key={plan.id} className={`card p-5 ${isCurrent ? "ring-2 ring-rose-400" : ""}`}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-black text-slate-900">{plan.name}</h2>
                {isCurrent && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">현재 요금제</span>}
              </div>
              <p className="mt-1 text-xl font-black text-rose-600">
                {plan.productId ? store?.price ? `${store.price}${price?.basePlanId === "yearly" ? " / 년" : " / 월"}` : price?.label : "0원"}
              </p>
              {cycleMissing && <p className="text-[11px] text-slate-400">이 요금제는 월간 결제만 있어요.</p>}
              {store?.trial && <p className="text-[11px] font-bold text-emerald-600">첫 7일 무료 체험</p>}
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {plan.perks.map((perk) => (
                  <li key={perk}>✓ {perk}</li>
                ))}
              </ul>
              {plan.productId && !isCurrent && (
                <div className="mt-4">
                  {!inApp ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">결제는 Android 가족앨범 앱에서 할 수 있어요.</p>
                  ) : !info.canPurchase ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">요금제는 부모 계정에서 바꿀 수 있어요.</p>
                  ) : sub && !sub.mine ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">다른 부모님이 구독 중이에요. 그분 계정에서 바꿀 수 있어요.</p>
                  ) : (
                    <button className="btn-primary w-full" disabled={busy || !store || !info.billingReady} onClick={() => buy(plan)}>
                      {!info.billingReady ? "결제 준비 중" : !store ? "상품 불러오는 중…" : sub ? "이 요금제로 변경" : "시작하기"}
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {inApp && bridge && (
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn-ghost text-xs" disabled={busy} onClick={() => { setBusy(true); bridge.restore(); }}>
            구매 복원
          </button>
          {sub && (
            <button className="btn-ghost text-xs" onClick={() => bridge.manage(sub.productId)}>
              구독 해지·결제수단 변경
            </button>
          )}
        </div>
      )}

      <p className="text-center text-[11px] leading-relaxed text-slate-400">
        구독은 Google Play 계정으로 결제되며 해지하지 않으면 자동 갱신됩니다. 해지해도 남은 기간까지 쓸 수 있고, 요금제를 낮추거나 해지해도
        이미 올린 사진은 지워지지 않습니다(용량을 넘으면 새로 올리기만 멈춥니다). 환불은 Google Play 환불 정책을 따릅니다.{" "}
        <Link href="/terms" className="underline">이용약관</Link>
      </p>
    </div>
  );
}
