import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { revealItemInDir, openUrl } from '@tauri-apps/plugin-opener';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { invoke } from '@tauri-apps/api/core';
import { api, ApiError, APP_VERSION, Device, fmtSize, fmtTime, login, logout, Perm, RItem, SERVER, session, setUnauthorizedHandler, sysInfo } from './api';
import { relay } from './relay';
import { queue, Transfer } from './transfers';
import { CloudAddDialog, CloudExplorer, NasDialog, NasExplorer, NasProfile, nasStore, PROVIDER_ICON, ShareDialog, SharesDialog, ShareTarget, useClouds } from './sources';

const useForce = () => { const [, s] = useState(0); return useCallback(() => s((x) => x + 1), []); };

export default function App() {
  const [authed, setAuthed] = useState(!!session.token);
  useEffect(() => setUnauthorizedHandler(() => { relay.stop(); setAuthed(false); }), []);
  return (
    <>
      <UpdateBanner />
      {authed ? <Main onLogout={() => setAuthed(false)} /> : <Login onDone={() => setAuthed(true)} />}
    </>
  );
}

// ---------------- 업데이트 (서명 검증된 패키지만 설치) ----------------
function UpdateBanner() {
  const [u, setU] = useState<Update | null>(null);
  const [state, setState] = useState('');
  useEffect(() => { check().then((r) => r && setU(r)).catch(() => {}); }, []);
  if (!u) return null;
  return (
    <div className="update">
      새 버전 {u.version}이(가) 있습니다. {state}
      {!state && <button className="btn sm" onClick={async () => {
        let total = 0, got = 0;
        setState('내려받는 중…');
        try {
          await u.downloadAndInstall((e) => {
            if (e.event === 'Started') total = e.data.contentLength || 0;
            if (e.event === 'Progress') { got += e.data.chunkLength; if (total) setState(`내려받는 중… ${Math.round((got / total) * 100)}%`); }
          });
          setState('설치 완료, 다시 시작합니다'); await relaunch();
        } catch (e: any) { setState('업데이트 실패: ' + (e?.message || e)); }
      }}>지금 업데이트</button>}
      <button className="btn ghost sm" onClick={() => setU(null)}>나중에</button>
    </div>
  );
}

// ---------------- 로그인 ----------------
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(session.email || '');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f(); } catch (e: any) { setErr(e.message); } setBusy(false); };
  return (
    <div className="login-wrap">
      <div className="login">
        <div className="brand"><img src="/icon.png" alt="" /><div><b>파일 관리자 2</b><span>PC 연결</span></div></div>
        <p className="muted">휴대폰의 <b>파일 관리자 2 → PC 연결</b>에서 쓰는 계정과 같은 계정으로 로그인하세요.</p>
        <label>이메일<input value={email} onChange={(e) => setEmail(e.target.value.trim())} autoFocus /></label>
        {mode === 'reset' && <label>메일로 받은 재설정 코드<input value={code} onChange={(e) => setCode(e.target.value)} /></label>}
        {mode !== 'forgot' && <label>{mode === 'reset' ? '새 비밀번호 (8자 이상)' : '비밀번호'}
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mode === 'login' && run(async () => { await login(email, pw); onDone(); })} /></label>}
        {mode === 'login' && <button className="btn wide" disabled={busy || !email || !pw} onClick={() => run(async () => { await login(email, pw); onDone(); })}>로그인</button>}
        {mode === 'forgot' && <button className="btn wide" disabled={busy || !email} onClick={() => run(async () => { await api('POST', '/api/auth/forgot', { email }); setMode('reset'); })}>재설정 코드 받기</button>}
        {mode === 'reset' && <button className="btn wide" disabled={busy} onClick={() => run(async () => { await api('POST', '/api/auth/reset', { email, code: code.trim(), password: pw }); await login(email, pw); onDone(); })}>비밀번호 바꾸고 로그인</button>}
        {err && <div className="err">{err}</div>}
        <div className="row between small">
          {mode === 'login' ? <a onClick={() => { setMode('forgot'); setErr(''); }}>비밀번호를 잊으셨나요?</a> : <a onClick={() => { setMode('login'); setErr(''); }}>로그인으로 돌아가기</a>}
          <a onClick={() => openUrl(SERVER + '/guide')}>사용 방법</a>
        </div>
        <p className="muted small">계정이 없으면 휴대폰 앱의 PC 연결 메뉴에서 가입하세요. 파일 내용은 서버에 저장되지 않습니다.</p>
      </div>
    </div>
  );
}

// ---------------- 메인 ----------------
function Main({ onLogout }: { onLogout: () => void }) {
  const force = useForce();
  const [devices, setDevices] = useState<Device[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [view, setView] = useState<{ t: 'phone' | 'cloud' | 'nas'; id: string } | null>(null);
  const phoneId = view?.t === 'phone' ? view.id : null;
  const setPhoneId = (id: string) => setView({ t: 'phone', id });
  const clouds = useClouds();
  const [nasList, setNasList] = useState<NasProfile[]>(nasStore.list());
  const [cloudAdd, setCloudAdd] = useState(false);
  const [nasEdit, setNasEdit] = useState<NasProfile | 'new' | null>(null);
  const [shareT, setShareT] = useState<ShareTarget | null>(null);
  const [sharesOpen, setSharesOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const [saveDir, setSaveDir] = useState(localStorage.getItem('fm2.saveDir') || '');
  const [showLogs, setShowLogs] = useState(false);

  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); }, []);
  const reload = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([api<Device[]>('GET', '/api/devices'), api<Perm[]>('GET', '/api/permissions')]);
      setDevices(d); setPerms(p);
    } catch (e: any) { say(e.message); }
  }, [say]);

  useEffect(() => {
    if (!saveDir) sysInfo().then((s) => { const d = s.downloads + '\\FileManager2'; setSaveDir(d); localStorage.setItem('fm2.saveDir', d); });
    relay.start(); reload();
    const off = relay.on((m) => {
      if (m.t === '_state') force();
      if (m.t === '_unauthorized') { session.token = null; onLogout(); }
      if (m.t === 'presence' || m.t === 'perm_changed' || m.t === 'hello') reload();
      if (m.t === 'perm_changed' && m.permission?.status === 'approved') say(`${m.permission.androidName}에서 연결을 승인했습니다`);
      if (m.t === 'perm_changed' && ['revoked', 'rejected'].includes(m.permission?.status)) say(`${m.permission.androidName} 연결이 ${m.permission.status === 'rejected' ? '거절' : '해제'}되었습니다`);
      if (m.t === 'security') say('보안 알림: ' + m.message);
    });
    const offQ = queue.on(force);
    queue.onDone = (t) => say(`${t.kind === 'down' ? '받기' : '보내기'} 완료: ${t.name}`);
    const timer = setInterval(reload, 30000);
    return () => { off(); offQ(); clearInterval(timer); relay.stop(); };
  }, []); // eslint-disable-line

  const phones = devices.filter((d) => d.kind === 'android');
  const permOf = (id: string) => perms.find((p) => p.androidId === id);
  const current = phoneId ? permOf(phoneId) : undefined;
  useEffect(() => {
    if (!view) { const a = perms.find((p) => p.status === 'approved'); if (a) setPhoneId(a.androidId); }
  }, [perms, view]); // eslint-disable-line
  const cloudSel = view?.t === 'cloud' ? clouds.conns.find((c) => c.id === view.id) : undefined;
  const nasSel = view?.t === 'nas' ? nasList.find((n) => n.id === view.id) : undefined;

  return (
    <div className="app">
      <aside>
        <div className="brand"><img src="/icon.png" alt="" /><div><b>파일 관리자 2</b><span>PC</span></div></div>
        <div className={'conn ' + (relay.online ? 'on' : '')}>{relay.online ? '서버 연결됨' : '서버 연결 중…'}</div>
        <div className="side-title">내 휴대폰</div>
        {phones.length === 0 && <p className="muted small pad">같은 계정으로 로그인한 휴대폰이 없습니다. 휴대폰 앱의 PC 연결에서 로그인하세요.</p>}
        {phones.map((d) => {
          const p = permOf(d.id);
          return (
            <div key={d.id} className={'phone ' + (phoneId === d.id ? 'sel' : '')} onClick={() => setPhoneId(d.id)}>
              <span className={'dot ' + (d.online ? 'on' : '')} />
              <div className="grow">
                <div className="b">{d.name}</div>
                <div className="small muted">{!p || ['rejected', 'revoked'].includes(p.status) ? '연결 안 됨' : p.status === 'pending' ? '휴대폰 승인 대기' : (d.online ? '접속 중' : '오프라인') + (p.readOnly ? ' · 읽기 전용' : '')}</div>
              </div>
            </div>
          );
        })}
        <button className="btn ghost wide" onClick={() => setCodeOpen(true)}>연결 코드 입력</button>
        <div className="side-title row between">클라우드<a className="small" onClick={() => setCloudAdd(true)}>+ 연결</a></div>
        {clouds.conns.map((c) => (
          <div key={c.id} className={'phone ' + (view?.t === 'cloud' && view.id === c.id ? 'sel' : '')} onClick={() => setView({ t: 'cloud', id: c.id })}>
            <span>{PROVIDER_ICON[c.provider] || '☁️'}</span>
            <div className="grow" style={{ minWidth: 0 }}><div className="b">{c.label}</div><div className="small muted ellip">{c.account}</div></div>
            <a className="small" title="연결 해제" onClick={async (e) => { e.stopPropagation(); if (confirm(`${c.label} (${c.account}) 연결을 해제할까요? 이 클라우드 파일로 만든 공유 링크도 해제됩니다.`)) { await api('DELETE', `/api/cloud/${c.id}`).catch((er) => say(er.message)); if (view?.id === c.id) setView(null); clouds.reload(); } }}>✕</a>
          </div>))}
        {!clouds.conns.length && <p className="muted small pad">Google Drive·Dropbox·OneDrive를 연결할 수 있습니다.</p>}
        <div className="side-title row between">NAS<a className="small" onClick={() => setNasEdit('new')}>+ 추가</a></div>
        {nasList.map((n) => (
          <div key={n.id} className={'phone ' + (view?.t === 'nas' && view.id === n.id ? 'sel' : '')} onClick={() => setView({ t: 'nas', id: n.id })}>
            <span>🗄️</span>
            <div className="grow" style={{ minWidth: 0 }}><div className="b">{n.name}</div><div className="small muted ellip">{n.url.replace(/^https?:\/\//, '')}</div></div>
            <a className="small" title="설정" onClick={(e) => { e.stopPropagation(); setNasEdit(n); }}>⚙</a>
          </div>))}
        <div className="side-title">설정</div>
        <div className="small pad">받은 파일 저장 위치<div className="path">{saveDir}</div>
          <a onClick={async () => { const d = await openDialog({ directory: true, defaultPath: saveDir }); if (typeof d === 'string') { setSaveDir(d); localStorage.setItem('fm2.saveDir', d); } }}>바꾸기</a> · <a onClick={() => revealItemInDir(saveDir).catch(() => say('폴더가 아직 없습니다'))}>열기</a>
        </div>
        <a className="small pad" onClick={() => setSharesOpen(true)}>내 공유 링크</a>
        <a className="small pad" onClick={() => setShowLogs(true)}>연결 기록</a>
        <div className="grow" />
        <div className="small pad muted">{session.email}<br />버전 {APP_VERSION}</div>
        <button className="btn ghost wide" onClick={async () => { relay.stop(); await logout(); onLogout(); }}>로그아웃</button>
      </aside>
      <main>
        {cloudSel ? <CloudExplorer conn={cloudSel} saveDir={saveDir} say={say} onShare={setShareT} />
          : nasSel ? <NasExplorer nas={nasSel} saveDir={saveDir} say={say} />
          : !phoneId || !phones.find((d) => d.id === phoneId) ? <Empty text="왼쪽에서 휴대폰·클라우드·NAS를 고르세요." />
          : !current || ['rejected', 'revoked'].includes(current.status) ? <RequestPanel phone={phones.find((d) => d.id === phoneId)!} onDone={reload} say={say} />
          : current.status === 'pending' ? <Empty text="휴대폰에서 승인을 기다리는 중입니다. 휴대폰의 알림 또는 파일 관리자 2 → PC 연결에서 '승인하고 폴더 선택'을 누르세요." />
          : <Explorer key={phoneId} perm={current} online={!!phones.find((d) => d.id === phoneId)?.online && relay.online} saveDir={saveDir} say={say} onShare={setShareT} />}
        <TransferPanel />
      </main>
      {codeOpen && <CodeDialog onClose={() => setCodeOpen(false)} onDone={(p) => { setCodeOpen(false); setPhoneId(p.androidId); reload(); say('연결되었습니다'); }} />}
      {showLogs && <LogsDialog onClose={() => setShowLogs(false)} />}
      {cloudAdd && <CloudAddDialog providers={clouds.providers} conns={clouds.conns} say={say} onClose={() => setCloudAdd(false)} onAdded={() => { setCloudAdd(false); clouds.reload(); }} />}
      {nasEdit && <NasDialog edit={nasEdit === 'new' ? undefined : nasEdit} onClose={() => setNasEdit(null)} onSaved={(p) => {
        const l = [...nasList.filter((x) => x.id !== p.id), p]; nasStore.save(l); setNasList(l); setNasEdit(null); setView({ t: 'nas', id: p.id }); say('NAS를 저장했습니다');
      }} />}
      {nasEdit && nasEdit !== 'new' && <div className="nas-del"><button className="btn ghost sm danger" onClick={async () => {
        if (!confirm('이 NAS 설정과 저장된 비밀번호를 지울까요?')) return;
        await invoke('nas_forget', { id: nasEdit.id }); const l = nasList.filter((x) => x.id !== nasEdit.id); nasStore.save(l); setNasList(l); setNasEdit(null); setView(null);
      }}>이 NAS 삭제</button></div>}
      {shareT && <ShareDialog target={shareT} say={say} onClose={() => setShareT(null)} />}
      {sharesOpen && <SharesDialog say={say} onClose={() => setSharesOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) { return <div className="empty"><div className="big">📱 ⇄ 💻</div><p>{text}</p></div>; }

function RequestPanel({ phone, onDone, say }: { phone: Device; onDone: () => void; say: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="empty">
      <div className="big">📱</div>
      <h2>{phone.name}</h2>
      <p>이 PC에서 휴대폰 파일을 보려면 휴대폰의 승인이 필요합니다.<br />요청을 보내면 휴대폰에 알림이 오고, 휴대폰에서 허용할 폴더를 직접 고릅니다.</p>
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api('POST', '/api/pair/request', { androidId: phone.id }); say('연결 요청을 보냈습니다. 휴대폰에서 승인해 주세요'); onDone(); } catch (e: any) { say(e.message); }
        setBusy(false);
      }}>연결 요청 보내기</button>
      <p className="muted small">또는 휴대폰에서 '연결 코드 만들기'를 누르고 왼쪽 아래 '연결 코드 입력'에 6자리 코드를 넣으세요.</p>
    </div>
  );
}

function CodeDialog({ onClose, onDone }: { onClose: () => void; onDone: (p: Perm) => void }) {
  const [code, setCode] = useState(''); const [err, setErr] = useState('');
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>연결 코드 입력</h3>
      <p className="muted small">휴대폰의 파일 관리자 2 → PC 연결 → '연결 코드 만들기'에 표시된 6자리 숫자</p>
      <input className="code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
      {err && <div className="err">{err}</div>}
      <div className="row end"><button className="btn ghost" onClick={onClose}>취소</button>
        <button className="btn" disabled={code.length !== 6} onClick={async () => { try { onDone(await api<Perm>('POST', '/api/pair/redeem', { code })); } catch (e: any) { setErr(e.message); } }}>연결</button></div>
    </div></div>
  );
}

function LogsDialog({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { api<any[]>('GET', '/api/logs').then(setLogs).catch(() => {}); }, []);
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal wide" onClick={(e) => e.stopPropagation()}>
      <h3>연결 기록</h3>
      <div className="logs">{logs.map((l, i) => <div key={i}><span className="muted">{String(l.at || l.created_at).slice(0, 19).replace('T', ' ')}</span> {ACTIONS[l.action] || l.action} {l.device_name || ''} <span className="muted">{l.detail}</span></div>)}</div>
      <div className="row end"><button className="btn" onClick={onClose}>닫기</button></div>
    </div></div>
  );
}

// ---------------- 탐색기 ----------------
function Explorer({ perm, online, saveDir, say, onShare }: { perm: Perm; online: boolean; saveDir: string; say: (m: string) => void; onShare: (t: ShareTarget) => void }) {
  const [roots, setRoots] = useState<{ name: string; path: string; exists: boolean }[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [items, setItems] = useState<RItem[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState<'name' | 'size' | 'mtime'>('name');
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [moveMode, setMoveMode] = useState<null | 'copy' | 'move'>(null);
  const pathRef = useRef<string | null>(null); pathRef.current = path;
  const phone = perm.androidId;
  const ro = perm.readOnly;

  const load = useCallback(async (p: string | null) => {
    setLoading(true); setErr(''); setSel(new Set());
    try {
      if (p === null) { setRoots(await relay.request(phone, 'roots')); setItems([]); }
      else { const r = await relay.request<{ items: RItem[] }>(phone, 'list', { path: p }); setItems(r.items); }
      setPath(p);
    } catch (e: any) { setErr(e.message); }
    setLoading(false);
  }, [phone]);
  useEffect(() => { if (online) load(pathRef.current); }, [online, load]);

  // 드래그 앤 드롭으로 올리기
  useEffect(() => {
    let un: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent((ev) => {
      const t = ev.payload.type;
      if (t === 'enter' || t === 'over') setDragOver(true);
      else if (t === 'leave') setDragOver(false);
      else if (t === 'drop') { setDragOver(false); if (pathRef.current && !ro) uploadPaths(ev.payload.paths); else if (ro) say('읽기 전용 연결이라 올릴 수 없습니다'); else say('먼저 휴대폰 폴더를 여세요'); }
    }).then((f) => { un = f; });
    return () => un?.();
  }, [ro]); // eslint-disable-line

  const sorted = useMemo(() => [...items].sort((a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1) || (sort === 'name' ? a.name.localeCompare(b.name, 'ko') : sort === 'size' ? b.size - a.size : b.mtime - a.mtime)), [items, sort]);
  const root = roots.find((r) => path && (path === r.path || path.startsWith(r.path + '/')));
  const crumbs = path && root ? [{ name: root.name, path: root.path }, ...path.slice(root.path.length).split('/').filter(Boolean).map((n, i, arr) => ({ name: n, path: root.path + '/' + arr.slice(0, i + 1).join('/') }))] : [];
  const up = () => { if (!path || !root || path === root.path) load(null); else load(path.slice(0, path.lastIndexOf('/'))); };
  const selected = sorted.filter((i) => sel.has(i.path));
  const join = (...a: string[]) => a.join('\\').replace(/\\+/g, '\\');

  async function download(list: RItem[]) {
    let n = 0;
    const walk = async (it: RItem, localBase: string) => {
      if (!it.dir) { queue.add({ kind: 'down', name: it.name, phoneId: phone, remotePath: it.path, localPath: join(localBase, it.name), size: it.size }); n++; return; }
      const r = await relay.request<{ items: RItem[] }>(phone, 'list', { path: it.path });
      for (const c of r.items) await walk(c, join(localBase, it.name));
    };
    try { for (const it of list) await walk(it, saveDir); say(`${n}개 파일 받기를 시작했습니다`); } catch (e: any) { say(e.message); }
  }
  async function uploadPaths(paths: string[]) {
    const target = pathRef.current; if (!target) return;
    let n = 0;
    for (const p of paths) {
      const st = await invoke<{ path: string; name: string; size: number; dir: boolean }>('local_stat', { path: p });
      const files = st.dir ? await invoke<{ path: string; name: string; size: number }[]>('local_walk', { path: p }) : [st];
      for (const f of files) {
        const rel = f.name.replace(/\\/g, '/');
        if (rel.split('/').length > 1) {
          // 하위 폴더 만들기 (이미 있으면 무시)
          const dirs = rel.split('/').slice(0, -1); let cur = target;
          for (const d of dirs) { await relay.request(phone, 'mkdir', { path: cur, name: d }).catch(() => {}); cur += '/' + d; }
        }
        queue.add({ kind: 'up', name: rel, phoneId: phone, remotePath: target + '/' + rel, localPath: f.path, size: f.size }); n++;
      }
    }
    say(`${n}개 파일 보내기를 시작했습니다`);
    const off = queue.on(() => { if (!queue.items.some((t) => t.kind === 'up' && (t.status === 'queued' || t.status === 'running'))) { off(); if (pathRef.current === target) load(target); } });
  }
  async function pickUpload(dir: boolean) {
    const r = await openDialog({ multiple: !dir, directory: dir });
    if (!r) return; uploadPaths(Array.isArray(r) ? r : [r]);
  }
  async function act(f: () => Promise<unknown>, ok: string) { try { await f(); say(ok); load(path); } catch (e: any) { say(e.message); } }

  const isImg = (n: string) => /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(n);

  return (
    <div className={'explorer ' + (dragOver ? 'drag' : '')}>
      <div className="toolbar">
        <button className="btn ghost sm" onClick={up} disabled={path === null}>↑ 위로</button>
        <button className="btn ghost sm" onClick={() => load(path)}>새로 고침</button>
        <div className="crumbs">
          <a onClick={() => load(null)}>{perm.androidName}</a>
          {crumbs.map((c) => <span key={c.path}> › <a onClick={() => load(c.path)}>{c.name}</a></span>)}
        </div>
        <div className="grow" />
        {path && <>
          <button className="btn sm" disabled={!selected.length} onClick={() => download(selected)}>받기 ({selected.length})</button>
          <button className="btn ghost sm" disabled={selected.length !== 1 || selected[0].dir} onClick={() => onShare({ kind: 'phone', androidId: phone, path: selected[0].path, name: selected[0].name })}>공유 링크</button>
          {!ro && <>
            <button className="btn ghost sm" onClick={() => pickUpload(false)}>파일 올리기</button>
            <button className="btn ghost sm" onClick={() => pickUpload(true)}>폴더 올리기</button>
            <button className="btn ghost sm" onClick={() => { const n = prompt('새 폴더 이름'); if (n) act(() => relay.request(phone, 'mkdir', { path, name: n }), '폴더를 만들었습니다'); }}>새 폴더</button>
            <button className="btn ghost sm" disabled={selected.length !== 1} onClick={() => { const it = selected[0]; const n = prompt('새 이름', it.name); if (n && n !== it.name) act(() => relay.request(phone, 'rename', { path: it.path, newName: n }), '이름을 바꿨습니다'); }}>이름 변경</button>
            <button className="btn ghost sm" disabled={!selected.length} onClick={() => setMoveMode('copy')}>복사</button>
            <button className="btn ghost sm" disabled={!selected.length} onClick={() => setMoveMode('move')}>이동</button>
            <button className="btn ghost sm danger" disabled={!selected.length} onClick={() => { if (confirm(`${selected.length}개 항목을 휴대폰 휴지통으로 옮길까요?`)) act(async () => { for (const it of selected) await relay.request(phone, 'delete', { path: it.path }); }, '휴대폰 휴지통으로 옮겼습니다'); }}>삭제</button>
          </>}
        </>}
      </div>
      {ro && <div className="note">읽기 전용 연결입니다. 받기만 할 수 있습니다.</div>}
      {!online && <div className="note warn">휴대폰이 오프라인입니다. 휴대폰의 파일 관리자 2 → PC 연결에서 '연결 켜짐'으로 바꿔 주세요.</div>}
      {err && <div className="note warn">{err}</div>}
      <div className="list">
        {path === null ? (
          <div className="roots">
            {roots.map((r) => <div key={r.path} className={'root ' + (r.exists ? '' : 'dim')} onDoubleClick={() => r.exists && load(r.path)} onClick={() => r.exists && load(r.path)}>
              <div className="ico">📁</div><b>{r.name}</b><span className="small muted">{r.path.replace('/storage/emulated/0', '내부 저장소')}</span></div>)}
            {!roots.length && !loading && <p className="muted pad">허용된 폴더가 없습니다.</p>}
          </div>
        ) : (
          <table>
            <thead><tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={!!items.length && sel.size === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map((i) => i.path)) : new Set())} /></th>
              <th onClick={() => setSort('name')}>이름{sort === 'name' ? ' ▾' : ''}</th>
              <th onClick={() => setSort('mtime')} style={{ width: 170 }}>수정한 날짜{sort === 'mtime' ? ' ▾' : ''}</th>
              <th onClick={() => setSort('size')} style={{ width: 110, textAlign: 'right' }}>크기{sort === 'size' ? ' ▾' : ''}</th>
            </tr></thead>
            <tbody>
              {sorted.map((it) => (
                <tr key={it.path} className={sel.has(it.path) ? 'sel' : ''}
                  onClick={(e) => { const s = new Set(e.ctrlKey || e.metaKey ? sel : []); s.has(it.path) && (e.ctrlKey || e.metaKey) ? s.delete(it.path) : s.add(it.path); setSel(s); }}
                  onDoubleClick={async () => {
                    if (it.dir) return load(it.path);
                    if (isImg(it.name)) { try { const r = await relay.request<{ b64: string; mime: string }>(phone, 'thumb', { path: it.path, size: 512 }); setPreview({ name: it.name, src: `data:${r.mime};base64,${r.b64}` }); } catch (e: any) { say(e.message); } }
                    else download([it]);
                  }}>
                  <td><input type="checkbox" checked={sel.has(it.path)} onClick={(e) => e.stopPropagation()} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(it.path) : s.delete(it.path); setSel(s); }} /></td>
                  <td>{it.dir ? '📁' : isImg(it.name) ? '🖼️' : /\.(mp4|mkv|mov|avi)$/i.test(it.name) ? '🎬' : /\.(mp3|m4a|wav|flac)$/i.test(it.name) ? '🎵' : '📄'} {it.name}</td>
                  <td className="muted">{new Date(it.mtime).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="muted" style={{ textAlign: 'right' }}>{it.dir ? (it.count ?? '') + '개' : fmtSize(it.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {path !== null && !loading && !items.length && !err && <p className="muted pad">빈 폴더입니다.{!ro && ' PC의 파일을 여기에 끌어다 놓으면 휴대폰으로 보냅니다.'}</p>}
        {loading && <div className="loading">불러오는 중…</div>}
      </div>
      {dragOver && <div className="dropzone">여기에 놓으면 휴대폰의 이 폴더로 보냅니다</div>}
      {moveMode && <FolderPicker phone={phone} roots={roots} title={`${selected.length}개 항목 ${moveMode === 'copy' ? '복사' : '이동'}할 폴더 선택`}
        onClose={() => setMoveMode(null)} onPick={(dest) => {
          const mode = moveMode; setMoveMode(null);
          act(async () => { for (const it of selected) await relay.request(phone, mode, { path: it.path, destDir: dest }); }, mode === 'copy' ? '복사했습니다' : '이동했습니다');
        }} />}
      {preview && <div className="modal-bg" onClick={() => setPreview(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{preview.name}</h3><img className="preview" src={preview.src} alt="" />
        <div className="row end"><button className="btn ghost" onClick={() => setPreview(null)}>닫기</button></div></div></div>}
    </div>
  );
}

// ---------------- 전송 목록 ----------------
function TransferPanel() {
  const force = useForce();
  const [open, setOpen] = useState(true);
  useEffect(() => queue.on(force), [force]);
  const list = queue.items;
  if (!list.length) return null;
  const active = list.filter((t) => t.status === 'running' || t.status === 'queued').length;
  return (
    <div className={'transfers ' + (open ? 'open' : '')}>
      <div className="thead" onClick={() => setOpen(!open)}>
        <b>전송 {active ? `${active}개 진행 중` : '완료'}</b><div className="grow" />
        <a onClick={(e) => { e.stopPropagation(); queue.clearFinished(); }}>끝난 항목 지우기</a><span>{open ? '▾' : '▴'}</span>
      </div>
      {open && <div className="tbody">{list.map((t) => <TRow key={t.id} t={t} />)}</div>}
    </div>
  );
}
function TRow({ t }: { t: Transfer }) {
  const pct = t.size ? Math.min(100, (t.done / t.size) * 100) : t.status === 'done' ? 100 : 0;
  return (
    <div className={'trow ' + t.status}>
      <span className="kind">{t.kind === 'down' ? '⬇' : '⬆'}</span>
      <div className="grow">
        <div className="row between"><span className="tname">{t.name}{t.source && <span className="muted small"> · {t.source}</span>}</span>
          <span className="small muted">
            {t.status === 'running' && `${fmtSize(t.done)} / ${fmtSize(t.size)} · ${fmtSize(t.speed)}/s · 남은 시간 ${fmtTime((t.size - t.done) / (t.speed || 1))}`}
            {t.status === 'queued' && '대기 중'}{t.status === 'done' && '완료 · ' + fmtSize(t.size)}
            {t.status === 'canceled' && '취소됨'}{t.status === 'error' && <span className="errt">{t.error}</span>}
          </span></div>
        <div className="bar"><div style={{ width: pct + '%' }} /></div>
      </div>
      {(t.status === 'running' || t.status === 'queued') && <button className="btn ghost sm" onClick={() => queue.cancelOne(t.id)}>취소</button>}
      {(t.status === 'error' || t.status === 'canceled') && <button className="btn ghost sm" onClick={() => queue.retry(t.id)}>다시 시도</button>}
      {t.status === 'done' && t.kind === 'down' && t.savedAs && <button className="btn ghost sm" onClick={() => revealItemInDir(t.savedAs!)}>폴더 열기</button>}
    </div>
  );
}

export { ApiError };

const ACTIONS: Record<string, string> = {
  login: '로그인', logout: '로그아웃', login_failed: '로그인 실패', pair_request: '연결 요청', pair_approved: '연결 승인',
  pair_rejected: '연결 거절', pair_revoked: '연결 해제', pair_code_used: '코드로 연결', device_revoked: '기기 로그아웃',
  remote_read: '파일 받기', remote_write: '파일 보내기', remote_delete: '삭제', remote_rename: '이름 변경', remote_mkdir: '폴더 만들기',
};

// 휴대폰 안의 대상 폴더 고르기 (허용 폴더 안에서만)
function FolderPicker({ phone, roots, title, onClose, onPick }: { phone: string; roots: { name: string; path: string; exists: boolean }[]; title: string; onClose: () => void; onPick: (p: string) => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<RItem[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (path === null) { setDirs([]); return; }
    relay.request<{ items: RItem[] }>(phone, 'list', { path }).then((r) => setDirs(r.items.filter((i) => i.dir))).catch((e) => setErr(e.message));
  }, [path, phone]);
  const root = roots.find((r) => path && (path === r.path || path.startsWith(r.path + '/')));
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal wide" onClick={(e) => e.stopPropagation()}>
      <h3>{title}</h3>
      <div className="small muted path">{path ?? '허용 폴더'}</div>
      <div className="logs">
        {path !== null && <div className="phone" onClick={() => setPath(!root || path === root.path ? null : path.slice(0, path.lastIndexOf('/')))}>↑ 위로</div>}
        {(path === null ? roots.filter((r) => r.exists).map((r) => ({ name: r.name, path: r.path })) : dirs).map((d) =>
          <div key={d.path} className="phone" onClick={() => setPath(d.path)}>📁 {d.name}</div>)}
        {path !== null && !dirs.length && <p className="muted small">하위 폴더가 없습니다.</p>}
      </div>
      {err && <div className="err">{err}</div>}
      <div className="row end"><button className="btn ghost" onClick={onClose}>취소</button>
        <button className="btn" disabled={path === null} onClick={() => path && onPick(path)}>이 폴더로</button></div>
    </div></div>
  );
}
