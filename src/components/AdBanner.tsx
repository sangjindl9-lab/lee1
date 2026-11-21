"use client";

import { useEffect, useState } from "react";

type AdPayload = {
  ok: boolean;
  show: boolean;
  reason: string;
  ad: { id: string; title: string; body: string; cta: string; advertiser: string } | null;
  note?: string;
  shownAt?: string;
};

/**
 * 하루 1회 광고. 서버가 (사용자, 슬롯, 날짜) 이력을 들고 있어
 * 새로고침·재실행·업로드 재시도로 다시 마운트돼도 같은 광고가 두 번 나오지 않는다.
 */
export default function AdBanner({ slot }: { slot: string }) {
  const [state, setState] = useState<AdPayload | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ads/next?slot=${encodeURIComponent(slot)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: AdPayload) => {
        if (alive) setState(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slot]);

  if (!state) return null;
  if (!state.show) return null;
  return (
    <div
      data-testid="ad-banner"
      className="flex items-center gap-3 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3"
    >
      <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-amber-600">AD</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-800">{state.ad?.title}</p>
        <p className="truncate text-xs text-slate-500">{state.ad?.body}</p>
      </div>
      <span className="hidden whitespace-nowrap text-[10px] text-slate-400 sm:block">{state.ad?.advertiser}</span>
    </div>
  );
}
