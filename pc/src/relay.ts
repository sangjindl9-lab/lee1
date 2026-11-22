import { WS_URL, session } from './api';

type Pending = { resolve: (v: any) => void; reject: (e: any) => void; timer: number };
export class RelayError extends Error { constructor(public code: string, msg: string) { super(msg); } }

type Listener = (m: any) => void;

// PC ↔ 서버 WebSocket. 휴대폰 작업 요청은 서버가 승인 여부·읽기 전용을 확인한 뒤 전달합니다.
class Relay {
  ws: WebSocket | null = null;
  online = false;
  private pending = new Map<string, Pending>();
  private listeners = new Set<Listener>();
  private retry = 0;
  private stopped = true;
  private pingTimer = 0;

  on(f: Listener) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private emit(m: any) { this.listeners.forEach((f) => f(m)); }

  start() { this.stopped = false; this.connect(); }
  stop() {
    this.stopped = true; clearInterval(this.pingTimer);
    this.ws?.close(); this.ws = null; this.setOnline(false);
    this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(new RelayError('closed', '연결이 종료되었습니다')); });
    this.pending.clear();
  }
  private setOnline(v: boolean) { this.online = v; this.emit({ t: '_state', online: v }); }

  private connect() {
    if (this.stopped || !session.token) return;
    const ws = new WebSocket(WS_URL + '?token=' + encodeURIComponent(session.token));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0; this.setOnline(true);
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => ws.readyState === 1 && ws.send('{"t":"ping"}'), 25000);
    };
    ws.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'res' && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!; this.pending.delete(m.id); clearTimeout(p.timer);
        m.ok ? p.resolve(m.data) : p.reject(new RelayError(m.error || 'error', m.message || '작업에 실패했습니다'));
        return;
      }
      this.emit(m);
    };
    ws.onclose = (ev) => {
      clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      this.setOnline(false);
      this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(new RelayError('disconnected', '서버 연결이 끊어졌습니다')); });
      this.pending.clear();
      if (ev.code === 4001) { this.emit({ t: '_unauthorized' }); return; }
      if (!this.stopped) setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** this.retry++));
    };
  }

  request<T = any>(to: string, op: string, args: Record<string, unknown> = {}, timeoutMs = 125000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new RelayError('offline', '서버에 연결되어 있지 않습니다'));
      const id = crypto.randomUUID();
      const timer = window.setTimeout(() => { this.pending.delete(id); reject(new RelayError('timeout', '응답 시간이 초과되었습니다')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ t: 'req', id, to, op, args }));
    });
  }
}
export const relay = new Relay();
