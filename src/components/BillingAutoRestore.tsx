"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { bridge, completedTokens, onBilling, verifyToken, type StorePurchase } from "@/lib/billing-client";

/** 너무 자주 묻지 않도록: 자동 복원 최소 간격 */
const MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastRun = 0;
let autoPending = false;

/**
 * 앱을 열 때·로그인 직후·앱으로 다시 돌아올 때 이 기기 Google 계정의 구독을 조용히 다시 확인한다.
 * 새 휴대폰·재설치 후에도 같은 가족의 구독이 자동으로 이어진다. 다른 가족의 구독은 서버가 거절하므로 연결되지 않는다.
 */
export default function BillingAutoRestore() {
  const router = useRouter();
  const refreshRef = useRef(router.refresh);
  refreshRef.current = router.refresh;

  useEffect(() => {
    const b = bridge();
    if (!b) return; // 웹 브라우저에서는 할 일이 없다

    const off = onBilling(async (event, data) => {
      if (!autoPending) return; // 요금제 화면에서 직접 누른 결제·복원은 그쪽이 처리한다
      if (event === "error" || event === "canceled") {
        autoPending = false;
        return;
      }
      if (event !== "purchases") return;
      autoPending = false;
      const tokens = completedTokens(data as StorePurchase[]);
      if (!tokens.length) return;
      const results = await Promise.all(tokens.map((t) => verifyToken(t, "restore")));
      if (results.some((r) => r.ok)) refreshRef.current();
    });

    const run = (force = false) => {
      if (document.visibilityState !== "visible") return;
      if (!force && Date.now() - lastRun < MIN_INTERVAL_MS) return;
      lastRun = Date.now();
      autoPending = true;
      try {
        b.restore();
      } catch {
        autoPending = false;
      }
    };

    // 로그인·가입 직후에는 간격과 상관없이 확인 (로그인 화면이 남긴 표시)
    let fromLogin = false;
    try {
      fromLogin = sessionStorage.getItem("fa_just_logged_in") === "1";
      sessionStorage.removeItem("fa_just_logged_in");
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
    run(fromLogin);
    const onVisible = () => run();
    document.addEventListener("visibilitychange", onVisible);
    window.__faOnResume = () => run();
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
      if (window.__faOnResume) window.__faOnResume = undefined;
    };
  }, []);

  return null;
}
