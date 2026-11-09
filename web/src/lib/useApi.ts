import { useCallback, useEffect, useRef, useState, type DependencyList, type Dispatch, type SetStateAction } from 'react';
import { ApiError } from '../api/client';

export interface ApiState<T> {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: Dispatch<SetStateAction<T | null>>;
}

/** 화면 데이터 로딩. 실패 시 data를 비우지 않고 error만 채운다(이전 값은 유지하지 않음: 첫 로딩 실패면 null). */
export function useApi<T>(fn: () => Promise<T>, deps: DependencyList): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (my !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (my !== seq.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}

/** 1초마다 갱신되는 현재 시각 (상대 시간·카운트다운용) */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
