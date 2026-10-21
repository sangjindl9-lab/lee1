import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, detectServer, type IpState, type Me } from '../lib/api';
import { setServerMode } from '../lib/storage';

export interface Account {
  me: Me;
  logout: () => Promise<void>;
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'local' }
  | { kind: 'moved' }
  | { kind: 'login'; notice?: string }
  | { kind: 'ip'; me: Me }
  | { kind: 'ready'; me: Me };

/** 회원제 서버가 있으면 로그인·IP 등록을 거친 뒤에만 앱을 보여준다. 서버가 없으면 로컬 모드로 바로 연다. */
export function Gate({ children }: { children: (account: Account | null) => ReactNode }) {
  const [st, setSt] = useState<GateState>({ kind: 'loading' });

  const apply = useCallback((me: Me) => {
    if (me.ipState.status === 'ok') {
      setServerMode(true, me.user.username);
      setSt({ kind: 'ready', me });
    } else setSt({ kind: 'ip', me });
  }, []);

  const check = useCallback(async () => {
    if (!(await detectServer())) {
      const h = location.hostname;
      const localOk = location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || !!(window as any).claude?.use;
      if (!localOk) {
        setSt({ kind: 'moved' });
        return;
      }
      setServerMode(false);
      setSt({ kind: 'local' });
      return;
    }
    try {
      apply(await api<Me>('GET', '/api/me'));
    } catch (e) {
      const err = e as ApiError;
      setSt({ kind: 'login', notice: err.status === 403 ? err.message : undefined });
    }
  }, [apply]);

  useEffect(() => {
    check();
  }, [check]);

  // 사용 중 세션 만료·IP 변경·사용 정지 → 다시 확인
  useEffect(() => {
    const h = (ev: Event) => {
      const err = (ev as CustomEvent).detail as ApiError;
      if (err.code === 'ip' && err.body?.ipState) setSt((s) => (s.kind === 'ready' ? { kind: 'ip', me: { ...s.me, ipState: err.body.ipState } } : s));
      else if (err.status === 401 || err.status === 403) setSt({ kind: 'login', notice: err.message });
    };
    window.addEventListener('gj-auth', h);
    return () => window.removeEventListener('gj-auth', h);
  }, []);

  const logout = useCallback(async () => {
    await api('POST', '/api/logout').catch(() => {});
    setServerMode(false);
    setSt({ kind: 'login', notice: '로그아웃했습니다.' });
  }, []);

  if (st.kind === 'loading') return <Center>불러오는 중…</Center>;
  if (st.kind === 'local') return <>{children(null)}</>;
  if (st.kind === 'moved')
    return (
      <Shell title="회원 전용 프로그램입니다" sub="전기·통신 예정공정표">
        <p className="text-[13.5px] text-ink2">이 주소는 더 이상 사용하지 않습니다. 관리자에게 받은 회원 주소로 접속해 로그인하세요.</p>
      </Shell>
    );
  if (st.kind === 'login') return <Login notice={st.notice} onDone={apply} />;
  if (st.kind === 'ip') return <IpRegister me={st.me} onDone={apply} onLogout={logout} />;
  return <>{children({ me: st.me, logout })}</>;
}

function Center({ children }: { children: ReactNode }) {
  return <div className="gutter flex min-h-screen items-center justify-center text-[14px] text-mute">{children}</div>;
}

function Shell({ children, title, sub }: { children: ReactNode; title: string; sub?: string }) {
  return (
    <div className="gutter flex min-h-screen items-start justify-center pt-[12vh]">
      <div className="panel w-full max-w-[420px] px-6 py-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded bg-head text-[12px] font-bold text-headInk" aria-hidden>
            공정
          </div>
          <div>
            <div className="text-[17px] font-semibold leading-tight">{title}</div>
            {sub && <div className="text-[12.5px] text-mute">{sub}</div>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Login({ notice, onDone }: { notice?: string; onDone: (me: Me) => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="전기·통신 예정공정표" sub="관리자에게 받은 아이디로 로그인하세요">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            onDone(await api<Me>('POST', '/api/login', { username, password }));
          } catch (e2) {
            setErr((e2 as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {notice && <div className="rounded bg-sunk px-3 py-2 text-[13px] text-ink2">{notice}</div>}
        <label className="flex flex-col gap-1">
          <span className="label">아이디</span>
          <input id="login-id" className="inp" autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">비밀번호</span>
          <input id="login-pw" className="inp" type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} />
        </label>
        {err && <div className="text-[13px] text-late">{err}</div>}
        <button className="btn btn-primary h-10 justify-center" disabled={busy || !username || !password}>
          {busy ? '확인 중…' : '로그인'}
        </button>
        <p className="text-[12px] text-mute">아이디가 없거나 비밀번호를 잊었으면 판매처(관리자)에 문의하세요.</p>
      </form>
    </Shell>
  );
}

function IpRegister({ me, onDone, onLogout }: { me: Me; onDone: (me: Me) => void; onLogout: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const s: IpState = me.ipState;
  const full = s.status === 'full';
  return (
    <Shell title={full ? '등록 가능한 장소를 모두 사용했습니다' : '이 장소(IP)를 등록할까요?'} sub={`${me.user.name || me.user.username} 님`}>
      <div className="flex flex-col gap-3 text-[13.5px]">
        <p className="text-ink2">
          이 프로그램은 아이디 하나당 <b>최대 {s.max}곳</b>(사무실·현장 등)의 인터넷 주소(IP)에서 사용할 수 있습니다.
          {full ? ' 새 장소에서 쓰려면 관리자에게 IP 초기화를 요청하세요.' : ' 처음 접속한 장소는 한 번 등록하면 다음부터 바로 열립니다.'}
        </p>
        <div className="rounded border border-line bg-sunk px-3 py-2">
          <div className="label">지금 접속한 IP</div>
          <div className="num text-[15px] font-semibold">{s.ip || '알 수 없음'}</div>
        </div>
        <div>
          <div className="label mb-1">
            등록된 IP ({s.used}/{s.max})
          </div>
          {s.ips.length ? (
            <ul className="flex flex-col gap-1">
              {s.ips.map((r) => (
                <li key={r.ip} className="num flex justify-between rounded border border-line px-2 py-1 text-[12.5px]">
                  <span>{r.ip}</span>
                  <span className="text-mute">{String(r.first_seen).slice(0, 10)} 등록</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[12.5px] text-mute">아직 등록된 장소가 없습니다.</div>
          )}
        </div>
        {err && <div className="text-[13px] text-late">{err}</div>}
        <div className="flex gap-2">
          {!full && (
            <button
              className="btn btn-primary h-10 flex-1 justify-center"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr('');
                try {
                  onDone(await api<Me>('POST', '/api/ip/register'));
                } catch (e) {
                  setErr((e as ApiError).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              이 장소 등록하고 시작 ({s.used + 1}/{s.max})
            </button>
          )}
          <button className="btn h-10" onClick={onLogout}>
            로그아웃
          </button>
        </div>
        <p className="text-[12px] text-mute">휴대폰 데이터(LTE·5G)는 IP가 자주 바뀌어 등록 칸을 빨리 쓰게 됩니다. 사무실·현장의 와이파이에서 등록하세요.</p>
      </div>
    </Shell>
  );
}
