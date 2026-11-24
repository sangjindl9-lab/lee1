"use client";

/**
 * 웹 화면 ↔ 안드로이드 결제 연결(window.FamilyAlbumBilling) 공용 모듈.
 * - 앱이 보내는 이벤트(window.__faBilling)를 한곳에서 받아 여러 화면에 나눠 준다.
 * - 구매 토큰 확인(/api/billing/play/verify)을 한곳에서 하고, 같은 토큰을 동시에 두 번 보내지 않는다.
 */
export type BillingBridge = {
  queryProducts(ids: string): void;
  purchase(productId: string, basePlanId: string, accountId: string, profileId: string, oldToken: string | null): void;
  restore(): void;
  manage(productId: string | null): void;
};

export type StorePurchase = { purchaseToken: string; state: number; products?: string[] };
export type VerifyOutcome = { token: string; ok: boolean; code?: string; message?: string; planId?: string };

type Listener = (event: string, data: unknown) => void;

declare global {
  interface Window {
    FamilyAlbumBilling?: BillingBridge;
    __faBilling?: (event: string, data: unknown) => void;
    __faOnResume?: () => void;
  }
}

const listeners = new Set<Listener>();
const inFlight = new Map<string, Promise<VerifyOutcome>>();

function install() {
  if (typeof window === "undefined" || window.__faBilling) return;
  window.__faBilling = (event, data) => {
    for (const l of [...listeners]) {
      try {
        l(event, data);
      } catch (e) {
        console.error("[billing] listener", e);
      }
    }
  };
}

export function bridge(): BillingBridge | undefined {
  return typeof window === "undefined" ? undefined : window.FamilyAlbumBilling;
}

export function onBilling(listener: Listener): () => void {
  install();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 구매 토큰을 서버에 확인시킨다. 같은 토큰이 이미 확인 중이면 그 결과를 같이 기다린다. */
export function verifyToken(token: string, source: "app" | "restore"): Promise<VerifyOutcome> {
  const running = inFlight.get(token);
  if (running) return running;
  const p = (async () => {
    try {
      const res = await fetch("/api/billing/play/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseToken: token, source }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { token, ok: true, planId: data.planId as string };
      return { token, ok: false, code: data?.error?.code as string, message: data?.error?.message as string };
    } catch {
      return { token, ok: false, code: "NETWORK", message: "네트워크 오류로 결제를 확인하지 못했습니다." };
    } finally {
      setTimeout(() => inFlight.delete(token), 0);
    }
  })();
  inFlight.set(token, p);
  return p;
}

/** state 1 = 결제 완료, 2 = 결제 대기 */
export function completedTokens(list: StorePurchase[]): string[] {
  return [...new Set(list.filter((p) => p.state === 1).map((p) => p.purchaseToken))];
}
