"use client";
import { useCallback, useEffect, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const token = () => (typeof window === "undefined" ? null : localStorage.getItem("sf_token"));
export const setToken = (t: string | null) => (t ? localStorage.setItem("sf_token", t) : localStorage.removeItem("sf_token"));

export async function api(path: string, opts: { method?: string; body?: any; form?: FormData; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}/api${path}`, {
    method: opts.method || (opts.body !== undefined || opts.form ? "POST" : "GET"), headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    setToken(null);
    if (typeof window !== "undefined" && location.pathname !== "/login") location.href = "/login";
    throw new Error("로그인이 필요합니다");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (data as any).detail;
    throw new Error(typeof d === "string" ? d : d ? JSON.stringify(d) : `요청 실패 (${res.status})`);
  }
  return data as any;
}

/** 인증이 필요한 파일(다운로드) 주소 */
export const authed = (path: string) => `${API}/api${path}${path.includes("?") ? "&" : "?"}token=${token()}`;

export function useApi<T = any>(path: string | null, interval = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api(path));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    reload();
    if (!interval) return;
    const id = setInterval(reload, interval);
    return () => clearInterval(id);
  }, [reload, interval]);
  return { data, error, loading, reload, setData };
}

export const STATUS: Record<string, string> = {
  PENDING: "대기", RESEARCHING: "조사", SCRIPTING: "대본", STORYBOARDING: "스토리보드", GENERATING: "생성",
  EDITING: "편집", REVIEWING: "검수", RENDERING: "렌더링", COMPLETED: "완성", FAILED: "실패", CANCELLED: "중지",
  AWAITING_APPROVAL: "승인 대기",
};
export const ACTIVE = ["RESEARCHING", "SCRIPTING", "STORYBOARDING", "GENERATING", "EDITING", "REVIEWING", "RENDERING"];
export const MODES: [string, string, string][] = [
  ["auto", "풀오토", "길이·스타일·모델을 AI가 예산 안에서 결정"],
  ["economy", "경제형", "이미지 + 자체 애니메이션으로 비용 절감"],
  ["quality", "고품질형", "오프닝·핵심 장면만 영상 모델 사용"],
  ["cinematic", "시네마틱형", "전 장면 영상 모델, 비용이 가장 큼"],
];

export const usd = (v: number | null | undefined, d = 2) => (v == null ? "—" : `$${Number(v).toFixed(d)}`);
export const n = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("ko-KR"));
export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
/** 초 → 타임코드 00:00.0 */
export const tc = (s?: number | null) => (s == null ? "--:--" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`);
