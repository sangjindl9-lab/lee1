import { invoke, Channel } from '@tauri-apps/api/core';
import { relay, RelayError } from './relay';

const CHUNK = 512 * 1024;
export type Transfer = {
  id: string; kind: 'down' | 'up'; name: string; phoneId: string;
  remotePath: string; localPath: string; size: number; done: number;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  error?: string; speed: number; startedAt?: number; savedAs?: string;
  /** 클라우드·NAS: Rust에서 스트리밍 전송 */
  http?: { url: string; method?: string; headers: [string, string][]; nas?: NasAuth };
  source?: string;
};
export type NasAuth = { id: string; user: string; insecure: boolean; root: string };

type L = () => void;
class Queue {
  items: Transfer[] = [];
  private listeners = new Set<L>();
  private running = 0;
  private cancel = new Set<string>();
  maxParallel = 2;
  onDone: (t: Transfer) => void = () => {};

  on(f: L) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private emit() { this.listeners.forEach((f) => f()); }

  add(t: Omit<Transfer, 'id' | 'done' | 'status' | 'speed'>) {
    this.items.unshift({ ...t, id: crypto.randomUUID(), done: 0, status: 'queued', speed: 0 });
    this.emit(); this.pump();
  }
  cancelOne(id: string) {
    const t = this.items.find((x) => x.id === id); if (!t) return;
    if (t.status === 'queued') { t.status = 'canceled'; this.emit(); }
    else if (t.status === 'running') { this.cancel.add(id); if (t.http) invoke('cancel_transfer', { id }); }
  }
  retry(id: string) {
    const t = this.items.find((x) => x.id === id);
    if (t && (t.status === 'error' || t.status === 'canceled')) { t.status = 'queued'; t.error = undefined; this.emit(); this.pump(); }
  }
  clearFinished() { this.items = this.items.filter((t) => t.status === 'queued' || t.status === 'running'); this.emit(); }

  private pump() {
    while (this.running < this.maxParallel) {
      const t = [...this.items].reverse().find((x) => x.status === 'queued');
      if (!t) return;
      this.running++;
      t.status = 'running'; t.startedAt = Date.now(); this.emit();
      (t.http ? this.httpTransfer(t) : t.kind === 'down' ? this.download(t) : this.upload(t))
        .then(() => { t.status = 'done'; this.onDone(t); })
        .catch((e) => {
          if (e?.message === '__canceled') { t.status = 'canceled'; if (t.kind === 'down') invoke('cancel_download', { path: t.localPath }); }
          else { t.status = 'error'; t.error = e?.message || String(e); }
        })
        .finally(() => { this.running--; this.cancel.delete(t.id); this.emit(); this.pump(); });
    }
  }

  private tick(t: Transfer, base: number) {
    const sec = (Date.now() - (t.startedAt || Date.now())) / 1000;
    t.speed = sec > 0.3 ? (t.done - base) / sec : 0;
    this.emit();
  }

  private async download(t: Transfer) {
    // 이어받기: 같은 위치의 임시 파일이 있으면 그 지점부터
    let off = await invoke<number>('part_size', { path: t.localPath });
    if (off > t.size) off = 0;
    t.done = off; const base = off;
    if (t.size === 0) await invoke('append_chunk', { path: t.localPath, offset: 0, b64: '' });
    while (off < t.size) {
      if (this.cancel.has(t.id)) throw new Error('__canceled');
      const r = await this.withRetry(() => relay.request<{ b64: string; size: number; eof: boolean }>(t.phoneId, 'read', { path: t.remotePath, offset: off, length: CHUNK }));
      if (!r.b64) break;
      try {
        off = await invoke<number>('append_chunk', { path: t.localPath, offset: off, b64: r.b64 });
      } catch (e: any) {
        const m = String(e).match(/^offset_mismatch:(\d+)/);
        if (m) { off = Number(m[1]); continue; }
        throw new Error('PC에 저장하지 못했습니다: ' + e);
      }
      t.done = off; t.size = Math.max(t.size, r.size); this.tick(t, base);
      if (r.eof) break;
    }
    t.savedAs = await invoke<string>('finish_download', { path: t.localPath });
  }

  private async httpTransfer(t: Transfer) {
    const ch = new Channel<number>();
    t.done = 0; const base = 0;
    ch.onmessage = (n) => { t.done = n; this.tick(t, base); };
    const h = t.http!;
    try {
      if (t.kind === 'down') t.savedAs = await invoke<string>('http_download', { id: t.id, url: h.url, headers: h.headers, nas: h.nas ?? null, dest: t.localPath, onProgress: ch });
      else { await invoke<string>('http_upload', { id: t.id, url: h.url, method: h.method || 'PUT', headers: h.headers, nas: h.nas ?? null, src: t.localPath, onProgress: ch }); t.savedAs = t.remotePath; }
    } catch (e: any) { throw new Error(String(e?.message || e)); }
    t.done = t.size || t.done;
  }

  private async upload(t: Transfer) {
    let off = 0; const base = 0;
    do {
      if (this.cancel.has(t.id)) throw new Error('__canceled');
      const len = Math.min(CHUNK, t.size - off);
      const b64 = len > 0 ? await invoke<string>('read_chunk', { path: t.localPath, offset: off, length: len }) : '';
      const final = off + len >= t.size;
      try {
        const r = await this.withRetry(() => relay.request<any>(t.phoneId, 'write', { path: t.remotePath, offset: off, b64, final }));
        if (final) t.savedAs = r?.path;
        off += len;
      } catch (e: any) {
        const m = e instanceof RelayError && e.code === 'offset_mismatch' ? e.message.match(/(\d+)\)?\s*$/) : null;
        if (m) { off = Number(m[1]); continue; }
        throw e;
      }
      t.done = off; this.tick(t, base);
    } while (off < t.size);
  }

  // 일시적 끊김(재연결)에는 몇 번 다시 시도
  private async withRetry<T>(f: () => Promise<T>): Promise<T> {
    let last: any;
    for (let i = 0; i < 4; i++) {
      try { return await f(); } catch (e: any) {
        last = e;
        if (!(e instanceof RelayError) || !['disconnected', 'offline', 'timeout', 'device_offline'].includes(e.code)) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw last;
  }
}
export const queue = new Queue();
