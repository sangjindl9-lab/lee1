// 클라우드(Google Drive·Dropbox·OneDrive)와 NAS(WebDAV) 탐색기, 공유 링크 화면
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { api, fmtSize, SERVER, session } from './api';
import { queue, NasAuth } from './transfers';

export type CloudConn = { id: string; provider: string; label: string; account: string; ready: boolean };
export type Provider = { id: string; label: string; ready: boolean };
export type NasProfile = { id: string; name: string; url: string; user: string; insecure: boolean };
export const PROVIDER_ICON: Record<string, string> = { gdrive: '🟢', dropbox: '🔷', onedrive: '☁️' };

export const nasStore = {
  list(): NasProfile[] { try { return JSON.parse(localStorage.getItem('fm2.nas') || '[]'); } catch { return []; } },
  save(l: NasProfile[]) { localStorage.setItem('fm2.nas', JSON.stringify(l)); },
};

type GItem = { key: string; name: string; dir: boolean; size: number; mtime: number; ref: string; native?: boolean };
type LocalF = { path: string; name: string; size: number; dir?: boolean };
interface Adapter {
  title: string;
  rootRef: string;
  list(ref: string): Promise<GItem[]>;
  download(it: GItem, localPath: string): void;
  upload(dirRef: string, f: LocalF, name: string): void;
  mkdir(dirRef: string, name: string): Promise<string>;
  rename(it: GItem, dirRef: string, name: string): Promise<void>;
  remove(it: GItem): Promise<void>;
  share?: (it: GItem) => void;
  note?: string;
}
const join = (...a: string[]) => a.join('\\').replace(/\\+/g, '\\');
const auth = (): [string, string][] => [['Authorization', 'Bearer ' + session.token]];

// ---------------- 공용 탐색기 ----------------
function GenericExplorer({ a, saveDir, say }: { a: Adapter; saveDir: string; say: (m: string) => void }) {
  const [stack, setStack] = useState<{ name: string; ref: string }[]>([{ name: a.title, ref: a.rootRef }]);
  const [items, setItems] = useState<GItem[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const cur = stack[stack.length - 1];
  const curRef = useRef(cur); curRef.current = cur;

  const load = useCallback(async (ref: string) => {
    setLoading(true); setErr(''); setSel(new Set());
    try { setItems(await a.list(ref)); } catch (e: any) { setErr(String(e?.message || e)); setItems([]); }
    setLoading(false);
  }, [a]);
  useEffect(() => { load(cur.ref); }, [cur.ref, load]);

  const uploadPaths = useCallback(async (paths: string[]) => {
    const target = curRef.current.ref; let n = 0;
    try {
      const dirCache = new Map<string, string>();
      const ensure = async (parent: string, name: string) => {
        const k = parent + '|' + name;
        if (dirCache.has(k)) return dirCache.get(k)!;
        const ex = (await a.list(parent)).find((i) => i.dir && i.name === name);
        const r = ex ? ex.ref : await a.mkdir(parent, name);
        dirCache.set(k, r); return r;
      };
      for (const p of paths) {
        const st = await invoke<LocalF>('local_stat', { path: p });
        const files = st.dir ? await invoke<LocalF[]>('local_walk', { path: p }) : [st];
        for (const f of files) {
          const parts = f.name.replace(/\\/g, '/').split('/');
          let dir = target;
          for (const d of parts.slice(0, -1)) dir = await ensure(dir, d);
          a.upload(dir, f, parts[parts.length - 1]); n++;
        }
      }
      say(`${n}개 파일 보내기를 시작했습니다`);
      const off = queue.on(() => { if (!queue.items.some((t) => t.kind === 'up' && (t.status === 'queued' || t.status === 'running'))) { off(); if (curRef.current.ref === target) load(target); } });
    } catch (e: any) { say(String(e?.message || e)); }
  }, [a, load, say]);

  useEffect(() => {
    let un: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent((ev) => {
      const t = ev.payload.type;
      if (t === 'enter' || t === 'over') setDrag(true); else if (t === 'leave') setDrag(false);
      else if (t === 'drop') { setDrag(false); uploadPaths(ev.payload.paths); }
    }).then((f) => { un = f; });
    return () => un?.();
  }, [uploadPaths]);

  async function download(list: GItem[]) {
    let n = 0, skipped = 0;
    const walk = async (it: GItem, base: string) => {
      if (it.native) { skipped++; return; }
      if (!it.dir) { a.download(it, join(base, it.name)); n++; return; }
      for (const c of await a.list(it.ref)) await walk(c, join(base, it.name));
    };
    try {
      for (const it of list) await walk(it, saveDir);
      say(`${n}개 파일 받기를 시작했습니다` + (skipped ? ` (Google 문서 형식 ${skipped}개는 제외)` : ''));
    } catch (e: any) { say(String(e?.message || e)); }
  }
  const act = async (f: () => Promise<unknown>, ok: string) => { try { await f(); say(ok); load(cur.ref); } catch (e: any) { say(String(e?.message || e)); } };
  const selected = items.filter((i) => sel.has(i.key));
  const isImg = (n: string) => /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(n);
  const sorted = useMemo(() => [...items].sort((x, y) => (x.dir === y.dir ? x.name.localeCompare(y.name, 'ko') : x.dir ? -1 : 1)), [items]);

  return (
    <div className={'explorer ' + (drag ? 'drag' : '')}>
      <div className="toolbar">
        <button className="btn ghost sm" disabled={stack.length < 2} onClick={() => setStack(stack.slice(0, -1))}>↑ 위로</button>
        <button className="btn ghost sm" onClick={() => load(cur.ref)}>새로 고침</button>
        <div className="crumbs">{stack.map((c, i) => <span key={i}>{i > 0 && ' › '}<a onClick={() => setStack(stack.slice(0, i + 1))}>{c.name}</a></span>)}</div>
        <div className="grow" />
        <button className="btn sm" disabled={!selected.length} onClick={() => download(selected)}>받기 ({selected.length})</button>
        <button className="btn ghost sm" onClick={async () => { const r = await openDialog({ multiple: true }); if (r) uploadPaths(Array.isArray(r) ? r : [r]); }}>파일 올리기</button>
        <button className="btn ghost sm" onClick={async () => { const r = await openDialog({ directory: true }); if (typeof r === 'string') uploadPaths([r]); }}>폴더 올리기</button>
        <button className="btn ghost sm" onClick={() => { const n = prompt('새 폴더 이름'); if (n) act(() => a.mkdir(cur.ref, n.trim()), '폴더를 만들었습니다'); }}>새 폴더</button>
        <button className="btn ghost sm" disabled={selected.length !== 1} onClick={() => { const it = selected[0]; const n = prompt('새 이름', it.name); if (n && n !== it.name) act(() => a.rename(it, cur.ref, n.trim()), '이름을 바꿨습니다'); }}>이름 변경</button>
        {a.share && <button className="btn ghost sm" disabled={selected.length !== 1 || selected[0].dir} onClick={() => a.share!(selected[0])}>공유 링크</button>}
        <button className="btn ghost sm danger" disabled={!selected.length} onClick={() => { if (confirm(`${selected.length}개 항목을 삭제할까요?`)) act(async () => { for (const it of selected) await a.remove(it); }, '삭제했습니다'); }}>삭제</button>
      </div>
      {a.note && <div className="note">{a.note}</div>}
      {err && <div className="note warn">{err}</div>}
      <div className="list">
        <table>
          <thead><tr>
            <th style={{ width: 32 }}><input type="checkbox" checked={!!items.length && sel.size === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map((i) => i.key)) : new Set())} /></th>
            <th>이름</th><th style={{ width: 170 }}>수정한 날짜</th><th style={{ width: 110, textAlign: 'right' }}>크기</th>
          </tr></thead>
          <tbody>{sorted.map((it) => (
            <tr key={it.key} className={sel.has(it.key) ? 'sel' : ''}
              onClick={(e) => { const s = new Set(e.ctrlKey || e.metaKey ? sel : []); s.has(it.key) && (e.ctrlKey || e.metaKey) ? s.delete(it.key) : s.add(it.key); setSel(s); }}
              onDoubleClick={() => (it.dir ? setStack([...stack, { name: it.name, ref: it.ref }]) : download([it]))}>
              <td><input type="checkbox" checked={sel.has(it.key)} onClick={(e) => e.stopPropagation()} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(it.key) : s.delete(it.key); setSel(s); }} /></td>
              <td>{it.dir ? '📁' : it.native ? '📝' : isImg(it.name) ? '🖼️' : '📄'} {it.name}</td>
              <td className="muted">{it.mtime ? new Date(it.mtime).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td>
              <td className="muted" style={{ textAlign: 'right' }}>{it.dir ? '' : it.native ? 'Google 문서' : fmtSize(it.size)}</td>
            </tr>))}
          </tbody>
        </table>
        {!loading && !items.length && !err && <p className="muted pad">빈 폴더입니다. PC의 파일을 끌어다 놓으면 이 폴더로 보냅니다.</p>}
        {loading && <div className="loading">불러오는 중…</div>}
      </div>
      {drag && <div className="dropzone">여기에 놓으면 이 폴더로 보냅니다</div>}
    </div>
  );
}

// ---------------- 클라우드 ----------------
export function CloudExplorer({ conn, saveDir, say, onShare }: { conn: CloudConn; saveDir: string; say: (m: string) => void; onShare: (t: ShareTarget) => void }) {
  const a = useMemo<Adapter>(() => {
    const base = `${SERVER}/api/cloud/${conn.id}`;
    const rootRef = conn.provider === 'dropbox' ? '' : 'root';
    return {
      title: `${conn.label} (${conn.account})`, rootRef,
      note: conn.ready ? undefined : '이 클라우드는 현재 연동 준비가 필요합니다 (운영자 설정). 설정되면 바로 쓸 수 있습니다.',
      async list(ref) {
        const r = await api<{ items: any[] }>('GET', `/api/cloud/${conn.id}/list?id=${encodeURIComponent(ref)}`);
        return r.items.map((i) => ({ key: i.id, ref: i.id, name: i.name, dir: i.dir, size: i.size, mtime: i.mtime, native: i.native }));
      },
      download(it, localPath) {
        queue.add({ kind: 'down', name: it.name, phoneId: '', remotePath: it.ref, localPath, size: it.size, source: conn.label,
          http: { url: `${base}/download?id=${encodeURIComponent(it.ref)}`, headers: auth() } });
      },
      upload(dirRef, f, name) {
        queue.add({ kind: 'up', name, phoneId: '', remotePath: name, localPath: f.path, size: f.size, source: conn.label,
          http: { url: `${base}/upload?parent=${encodeURIComponent(dirRef)}&name=${encodeURIComponent(name)}`, method: 'POST', headers: [...auth(), ['Content-Type', 'application/octet-stream']] } });
      },
      async mkdir(dirRef, name) { return (await api<{ id: string }>('POST', `/api/cloud/${conn.id}/mkdir`, { parent: dirRef, name })).id; },
      async rename(it, _d, name) { await api('POST', `/api/cloud/${conn.id}/rename`, { id: it.ref, name }); },
      async remove(it) { await api('POST', `/api/cloud/${conn.id}/delete`, { id: it.ref }); },
      share: (it) => onShare({ kind: 'cloud', connId: conn.id, id: it.ref, name: it.name }),
    };
  }, [conn, onShare]);
  return <GenericExplorer key={conn.id} a={a} saveDir={saveDir} say={say} />;
}

export function useClouds() {
  const [conns, setConns] = useState<CloudConn[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const reload = useCallback(async () => {
    try { const [c, p] = await Promise.all([api<CloudConn[]>('GET', '/api/cloud'), api<Provider[]>('GET', '/api/cloud/providers')]); setConns(c); setProviders(p); } catch { /* */ }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { conns, providers, reload };
}

export function CloudAddDialog({ providers, conns, onClose, onAdded, say }: { providers: Provider[]; conns: CloudConn[]; onClose: () => void; onAdded: () => void; say: (m: string) => void }) {
  const [waiting, setWaiting] = useState('');
  useEffect(() => {
    if (!waiting) return;
    const before = new Set(conns.map((c) => c.id));
    let n = 0;
    const t = setInterval(async () => {
      n++;
      try {
        const c = await api<CloudConn[]>('GET', '/api/cloud');
        if (c.some((x) => !before.has(x.id) && x.provider === waiting)) { clearInterval(t); say('클라우드가 연결되었습니다'); onAdded(); }
      } catch { /* */ }
      if (n > 100) { clearInterval(t); setWaiting(''); }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting]); // eslint-disable-line
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>클라우드 연결</h3>
      <p className="muted small">브라우저에서 해당 서비스에 로그인하고 권한을 허용하면 연결됩니다. 비밀번호는 이 프로그램이나 서버에 저장되지 않습니다.</p>
      {providers.map((p) => (
        <div key={p.id} className="row between provider">
          <span>{PROVIDER_ICON[p.id]} <b>{p.label}</b>{!p.ready && <span className="muted small"> · 연동 준비 필요</span>}</span>
          <button className="btn sm" disabled={!p.ready || !!waiting} onClick={async () => {
            try { const r = await api<{ url: string }>('POST', `/api/cloud/${p.id}/start`); await openUrl(r.url); setWaiting(p.id); } catch (e: any) { say(e.message); }
          }}>{waiting === p.id ? '브라우저에서 승인 대기…' : '연결'}</button>
        </div>
      ))}
      {providers.some((p) => !p.ready) && <p className="muted small">'연동 준비 필요'는 운영자가 해당 서비스의 앱 키를 등록하기 전이라는 뜻입니다.</p>}
      <div className="note warn" style={{ borderRadius: 12, marginTop: 10 }}>
        <b>Google Drive 연결 시 '확인하지 않은 앱' 경고가 나오면</b>
        <ol style={{ margin: '6px 0 0 18px', padding: 0, lineHeight: 1.7 }}>
          <li>Google 계정 선택</li>
          <li>왼쪽 아래 <b>고급</b> 클릭</li>
          <li><b>파일관리자2(으)로 이동(안전하지 않음)</b> 클릭</li>
          <li>권한 화면에서 <b>계속</b> → '연결되었습니다'가 나오면 이 프로그램으로 돌아오기</li>
        </ol>
        <div className="small" style={{ marginTop: 4 }}>Google 앱 인증 심사 전이라 나오는 화면입니다. 비밀번호는 저장되지 않으며 언제든 연결을 해제할 수 있습니다.</div>
      </div>
      <div className="row end"><button className="btn ghost" onClick={onClose}>닫기</button></div>
    </div></div>
  );
}

// ---------------- NAS (WebDAV) ----------------
/** http(암호화 없음)·'인증서 확인 안 함'은 내부망 주소에서만 허용 (Rust 쪽에서도 똑같이 막습니다) */
export function nasPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /\.(local|lan|home\.arpa)$/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) { const a = +m[1], b = +m[2]; return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254); }
  if (h.includes(':')) return h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd');
  return false;
}
export function nasTransportProblem(url: string, insecure: boolean): string | null {
  let u: URL; try { u = new URL(url); } catch { return '주소 형식이 올바르지 않습니다'; }
  if (u.username) return '주소에 아이디를 넣지 마세요';
  if (nasPrivateHost(u.hostname)) return null;
  if (u.protocol === 'http:') return '외부(인터넷) 주소는 HTTPS만 쓸 수 있습니다. http는 비밀번호가 그대로 노출됩니다';
  if (insecure) return "'인증서 확인 안 함'은 내부망 주소(192.168.x.x 등)에서만 쓸 수 있습니다";
  return null;
}
export function NasExplorer({ nas, saveDir, say }: { nas: NasProfile; saveDir: string; say: (m: string) => void }) {
  const a = useMemo<Adapter>(() => {
    const root = nas.url.endsWith('/') ? nas.url : nas.url + '/';
    const auth: NasAuth = { id: nas.id, user: nas.user, insecure: nas.insecure, root };
    const enc = (n: string) => encodeURIComponent(n);
    const parentOf = (u: string) => u.replace(/\/$/, '').replace(/[^/]+$/, '');
    return {
      title: nas.name, rootRef: root,
      note: nas.insecure ? '인증서 확인을 끈 NAS입니다. 회사·집 내부망에서만 사용하세요.' : undefined,
      async list(ref) {
        const r = await invoke<{ name: string; url: string; dir: boolean; size: number; mtime: number }[]>('webdav_list', { url: ref, nas: auth });
        return r.map((i) => ({ key: i.url, ref: i.dir && !i.url.endsWith('/') ? i.url + '/' : i.url, name: i.name, dir: i.dir, size: i.size, mtime: i.mtime }));
      },
      download(it, localPath) {
        queue.add({ kind: 'down', name: it.name, phoneId: '', remotePath: it.ref, localPath, size: it.size, source: nas.name, http: { url: it.ref, headers: [], nas: auth } });
      },
      upload(dirRef, f, name) {
        queue.add({ kind: 'up', name, phoneId: '', remotePath: dirRef + enc(name), localPath: f.path, size: f.size, source: nas.name,
          http: { url: dirRef + enc(name), method: 'PUT', headers: [['Content-Type', 'application/octet-stream']], nas: auth } });
      },
      async mkdir(dirRef, name) { const u = dirRef + enc(name) + '/'; await invoke('webdav_op', { method: 'MKCOL', url: u, destination: null, nas: auth }); return u; },
      async rename(it, _d, name) {
        const dest = parentOf(it.ref) + enc(name) + (it.dir ? '/' : '');
        await invoke('webdav_op', { method: 'MOVE', url: it.ref, destination: dest, nas: auth });
      },
      async remove(it) { await invoke('webdav_op', { method: 'DELETE', url: it.ref, destination: null, nas: auth }); },
    };
  }, [nas]);
  return <GenericExplorer key={nas.id} a={a} saveDir={saveDir} say={say} />;
}

export const NAS_PRESETS = [
  { id: 'synology', label: '시놀로지', https: 5006, http: 5005, hint: '예: mynas.synology.me 또는 192.168.0.10',
    howTo: ['DSM → 패키지 센터에서 WebDAV Server 설치', 'WebDAV Server에서 HTTPS(5006) 사용 체크', '외부 접속: 포트 개방 대신 패키지 센터의 VPN Server로 VPN에 먼저 접속한 뒤 내부 주소(192.168.x.x)로 연결 권장', 'QuickConnect ID는 WebDAV에 쓸 수 없습니다'] },
  { id: 'qnap', label: 'QNAP', https: 443, http: 80, hint: '예: mynas.myqnapcloud.com 또는 192.168.0.10',
    howTo: ['제어판 → 네트워크 및 파일 서비스 → WebDAV 활성화', '공유 폴더 권한에서 WebDAV 허용', '외부 접속: 포트 개방 대신 QVPN Service로 VPN에 먼저 접속한 뒤 내부 주소로 연결 권장'] },
  { id: 'asustor', label: 'ASUSTOR', https: 9802, http: 9800, hint: '예: mynas.myasustor.com 또는 192.168.0.10',
    howTo: ['서비스 → WebDAV 활성화, SSL(9802) 사용', '외부 접속: 포트 개방 대신 App Central의 VPN Server로 VPN에 먼저 접속한 뒤 내부 주소로 연결 권장'] },
  { id: 'custom', label: '기타 WebDAV', https: 443, http: 80, hint: '예: nas.example.com 또는 192.168.0.10',
    howTo: ['NAS 관리 화면에서 WebDAV를 켜고 포트 확인', '외부 접속은 포트 개방보다 VPN으로 내부망에 들어온 뒤 연결 권장'] },
];

export function NasDialog({ edit, onClose, onSaved }: { edit?: NasProfile; onClose: () => void; onSaved: (p: NasProfile) => void }) {
  const [p, setP] = useState<NasProfile>(edit || { id: 'nas-' + crypto.randomUUID(), name: '', url: 'https://', user: '', insecure: false });
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof NasProfile, v: any) => setP((q) => ({ ...q, [k]: v }));
  const norm = (u: string) => (u.endsWith('/') ? u : u + '/');
  const urlChanged = !!edit && norm(edit.url) !== norm(p.url);
  const transport = /^https?:\/\/.+/.test(p.url) ? nasTransportProblem(p.url, p.insecure) : null;
  const [preset, setPresetS] = useState(NAS_PRESETS[0]);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(NAS_PRESETS[0].https));
  const [https, setHttps] = useState(true);
  const [folder, setFolder] = useState('');
  const setPreset = (pr: typeof NAS_PRESETS[number]) => { setPresetS(pr); setPort(String(https ? pr.https : pr.http)); if (!p.name || NAS_PRESETS.some((x) => x.label === p.name)) set('name', pr.label); };
  useEffect(() => {
    if (edit) return;
    const h = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const f = folder.trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
    set('url', h ? `${https ? 'https' : 'http'}://${h}${port ? ':' + port : ''}/${f ? f + '/' : ''}` : 'https://');
  }, [host, port, https, folder]); // eslint-disable-line
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>{edit ? 'NAS 설정' : 'NAS 추가 (WebDAV)'}</h3>
      {!edit && <div className="presets">
        {NAS_PRESETS.map((pr) => <button key={pr.id} className={'btn sm ' + (preset.id === pr.id ? '' : 'ghost')} onClick={() => setPreset(pr)}>{pr.label}</button>)}
      </div>}
      {!edit && <div className="note" style={{ borderRadius: 10, margin: '8px 0' }}>
        <b>{preset.label} WebDAV 켜는 방법</b>
        <ol style={{ margin: '4px 0 0 18px', padding: 0, lineHeight: 1.6 }}>{preset.howTo.map((t) => <li key={t} className="small">{t}</li>)}</ol>
      </div>}
      {!edit && <>
        <label>주소 (DDNS 또는 IP)<input value={host} placeholder={preset.hint} onChange={(e) => setHost(e.target.value.trim())} /></label>
        <div className="row">
          <label style={{ flex: 1 }}>포트<input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} /></label>
          <label className="row" style={{ flexDirection: 'row', marginTop: 28 }}><input type="checkbox" checked={https} onChange={(e) => { setHttps(e.target.checked); setPort(String(e.target.checked ? preset.https : preset.http)); }} /> HTTPS</label>
        </div>
        <label>공유 폴더 (선택)<input value={folder} placeholder="예: home" onChange={(e) => setFolder(e.target.value)} /></label>
      </>}
      <label>이름<input value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="사무실 NAS" /></label>
      {edit ? <label>WebDAV 주소<input value={p.url} onChange={(e) => set('url', e.target.value.trim())} /></label>
        : p.url.length > 8 && <div className="small path">접속 주소: {p.url}</div>}
      <label>아이디<input value={p.user} onChange={(e) => set('user', e.target.value)} /></label>
      <label>비밀번호{edit && <span className="small"> (바꿀 때만 입력)</span>}<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <label className="row" style={{ flexDirection: 'row' }}><input type="checkbox" checked={p.insecure} onChange={(e) => set('insecure', e.target.checked)} /> 인증서 확인 안 함 (내부망 자체 서명 인증서)</label>
      {transport ? <div className="err">{transport}</div> : p.url.startsWith('http://') && <div className="note warn">http는 내부망에서만 쓸 수 있으며 비밀번호가 암호화되지 않습니다.</div>}
      {urlChanged && !pw && <div className="note warn">주소를 바꾸면 보안을 위해 비밀번호를 다시 입력해야 합니다.</div>}
      <p className="muted small">외부에서 접속할 때는 공유기 포트 개방보다 NAS 제조사 VPN(시놀로지 VPN Server, QNAP QVPN 등)으로 내부망에 들어온 뒤 내부 주소로 연결하는 방법을 권장합니다.</p>
      <p className="muted small">비밀번호는 Windows 자격 증명 관리자에만 저장됩니다.</p>
      {err && <div className="err">{err}</div>}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>취소</button>
        <button className="btn" disabled={busy || !p.name || !/^https?:\/\/.+/.test(p.url) || !p.user || (!edit && !pw) || !!transport || (urlChanged && !pw)} onClick={async () => {
          setBusy(true); setErr('');
          try {
            const root = p.url.endsWith('/') ? p.url : p.url + '/';
            if (pw) await invoke('nas_save_password', { id: p.id, password: pw, root });
            await invoke('webdav_list', { url: root, nas: { id: p.id, user: p.user, insecure: p.insecure, root } });
            onSaved(p);
          } catch (e: any) { setErr('연결 확인 실패: ' + String(e?.message || e)); }
          setBusy(false);
        }}>연결 확인 후 저장</button>
      </div>
    </div></div>
  );
}

// ---------------- 공유 링크 ----------------
export type ShareTarget = { kind: 'phone'; androidId: string; path: string; name: string } | { kind: 'cloud'; connId: string; id: string; name: string };
type ShareRow = { id: string; url: string; name: string; size: number; kind: string; provider: string | null; expiresAt: string; maxDownloads: number | null; downloads: number; hasPassword: boolean; revoked: boolean; active: boolean };

export function ShareDialog({ target, onClose, say }: { target: ShareTarget; onClose: () => void; say: (m: string) => void }) {
  const [hours, setHours] = useState(72);
  const [pw, setPw] = useState('');
  const [max, setMax] = useState('');
  const [made, setMade] = useState<ShareRow | null>(null);
  const [err, setErr] = useState('');
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>공유 링크 만들기</h3>
      <p className="b" style={{ wordBreak: 'break-all' }}>{target.name}</p>
      {!made ? <>
        <p className="muted small">링크를 받은 사람은 로그인 없이 이 파일 하나만 받을 수 있습니다. 파일은 서버에 저장되지 않고{target.kind === 'phone' ? ' 받을 때 휴대폰에서 바로 전달되므로, 휴대폰이 켜져 있고 PC 연결이 켜져 있어야 합니다.' : ' 받을 때 클라우드에서 바로 전달됩니다.'}</p>
        <label>유효 기간<select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>1시간</option><option value={24}>1일</option><option value={72}>3일</option><option value={168}>7일</option><option value={720}>30일</option></select></label>
        <label>비밀번호 (선택, 4자 이상)<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>받기 횟수 제한 (선택)<input type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} placeholder="제한 없음" /></label>
        {err && <div className="err">{err}</div>}
        <div className="row end"><button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn" onClick={async () => {
            try {
              const body: any = { ...target, expiresHours: hours, password: pw || undefined, maxDownloads: max ? Number(max) : undefined };
              delete body.name;
              setMade(await api<ShareRow>('POST', '/api/shares', body));
            } catch (e: any) { setErr(e.message); }
          }}>링크 만들기</button></div>
      </> : <>
        <input readOnly value={made.url} style={{ width: '100%' }} onFocus={(e) => e.target.select()} />
        <p className="muted small">{new Date(made.expiresAt).toLocaleString('ko-KR')}까지{made.hasPassword ? ' · 비밀번호 필요 (따로 알려 주세요)' : ''}{made.maxDownloads ? ` · ${made.maxDownloads}회` : ''}</p>
        <div className="row end">
          <button className="btn ghost" onClick={() => openUrl(made.url)}>열어 보기</button>
          <button className="btn" onClick={async () => { await navigator.clipboard.writeText(made.url); say('링크를 복사했습니다'); }}>링크 복사</button>
          <button className="btn ghost" onClick={onClose}>닫기</button>
        </div>
      </>}
    </div></div>
  );
}

export function SharesDialog({ onClose, say }: { onClose: () => void; say: (m: string) => void }) {
  const [rows, setRows] = useState<ShareRow[]>([]);
  const load = useCallback(() => api<ShareRow[]>('GET', '/api/shares').then(setRows).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal wide" onClick={(e) => e.stopPropagation()}>
      <h3>내 공유 링크</h3>
      {!rows.length && <p className="muted">만든 공유 링크가 없습니다. 파일을 하나 고르고 '공유 링크'를 누르세요.</p>}
      <div className="logs">{rows.map((r) => (
        <div key={r.id} className="row between share-row">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="b" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
            <div className="small muted">{fmtSize(r.size)} · {r.kind === 'phone' ? '휴대폰' : r.provider} · 받은 횟수 {r.downloads}{r.maxDownloads ? '/' + r.maxDownloads : ''} · {r.active ? new Date(r.expiresAt).toLocaleString('ko-KR') + '까지' : r.revoked ? '해제됨' : '만료됨'}{r.hasPassword ? ' · 🔒' : ''}</div>
          </div>
          {r.active && <>
            <button className="btn ghost sm" onClick={async () => { await navigator.clipboard.writeText(r.url); say('링크를 복사했습니다'); }}>복사</button>
            <button className="btn ghost sm danger" onClick={async () => { await api('POST', `/api/shares/${r.id}/revoke`); load(); }}>해제</button>
          </>}
        </div>))}
      </div>
      <div className="row end"><button className="btn" onClick={onClose}>닫기</button></div>
    </div></div>
  );
}
