import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './Auth';
import type { Alarm, Command, DeviceEventEvent, DeviceStatusEvent, TelemetryEvent } from '../api/types';

export interface RealtimeEvents {
  telemetry: TelemetryEvent;
  device_status: DeviceStatusEvent;
  device_event: DeviceEventEvent;
  alarm: Alarm;
  command: Command;
}
export type RealtimeEventName = keyof RealtimeEvents;
export type ConnState = 'connecting' | 'connected' | 'disconnected' | 'error';

interface RealtimeValue {
  socket: Socket | null;
  state: ConnState;
  error: string | null;
}

const RealtimeContext = createContext<RealtimeValue>({ socket: null, state: 'disconnected', error: null });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { token, status } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<ConnState>('disconnected');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authed' || !token) {
      setSocket(null);
      setState('disconnected');
      return;
    }
    // 같은 출처(상대 경로)로 연결: 개발 시 Vite 프록시(ws), 운영 시 서버 직접
    const s = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
    setState('connecting');
    s.on('connect', () => {
      setState('connected');
      setError(null);
    });
    s.on('disconnect', () => setState('disconnected'));
    s.on('connect_error', (e: Error) => {
      setState('error');
      setError(e.message || '실시간 연결 실패');
    });
    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
    };
  }, [token, status]);

  return <RealtimeContext.Provider value={{ socket, state, error }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext);
}

/** 실시간 이벤트 구독. handler는 최신 값을 참조하므로 매 렌더 새 함수여도 된다. */
export function useSocketEvent<K extends RealtimeEventName>(event: K, handler: (payload: RealtimeEvents[K]) => void): void {
  const { socket } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: RealtimeEvents[K]) => ref.current(p);
    socket.on(event as string, fn as (...args: unknown[]) => void);
    return () => {
      socket.off(event as string, fn as (...args: unknown[]) => void);
    };
  }, [socket, event]);
}

/** 재연결 시 화면 데이터를 다시 읽기 위한 훅 */
export function useOnReconnect(fn: () => void): void {
  const { socket } = useRealtime();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!socket) return;
    // 연결이 끊겼다가 다시 붙은 경우에만 호출 (끊긴 동안 놓친 이벤트 보정)
    let wasDown = !socket.connected;
    let mountedConnected = socket.connected;
    const onDown = () => {
      wasDown = true;
    };
    const onUp = () => {
      if (!mountedConnected) {
        mountedConnected = true;
        wasDown = false;
        return;
      }
      if (wasDown) {
        wasDown = false;
        ref.current();
      }
    };
    socket.on('disconnect', onDown);
    socket.on('connect', onUp);
    return () => {
      socket.off('disconnect', onDown);
      socket.off('connect', onUp);
    };
  }, [socket]);
}
