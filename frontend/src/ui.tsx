import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "./api";

export function useData<T>(fn: () => Promise<T>, deps: unknown[] = [], intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    reload();
    if (intervalMs) {
      const t = window.setInterval(reload, intervalMs);
      return () => window.clearInterval(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

export function errMsg(e: unknown) {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

const STATE_CLASS: Record<string, string> = {
  recording: "rec", connecting: "warn", retry_wait: "warn", error: "warn", stopped: "off", idle: "off", disabled: "off",
};

export function StatusBadge({ status }: { status: { state: string; state_label: string; error_message?: string } }) {
  return (
    <span className={`badge ${STATE_CLASS[status.state] ?? ""}`} title={status.error_message || undefined}>
      {status.state_label}
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, flex: 1 }}>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="닫기">닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Alert({ kind = "", children }: { kind?: "" | "err" | "ok" | "info"; children: ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === "err" ? "alert" : undefined}>{children}</div>;
}

export function Field({ label, hint, children, full }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field${full ? " full" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
