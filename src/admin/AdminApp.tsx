import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Confirm, Field, Modal, useToast } from '../components/ui';

interface AdminUser {
  id: number;
  username: string;
  name: string;
  company: string;
  phone: string;
  memo: string;
  active: boolean;
  expires_at: string | null;
  max_ips: number;
  created_at: string;
  last_login: string | null;
  project_count: number;
  ips: { ip: string; first_seen: string; last_seen: string }[];
}

const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');
const randomPw = () => {
  const c = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => c[b % c.length]).join('');
};
const addMonths = (base: string, m: number) => {
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + m);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** 관리자 페이지 (/admin): 회원 아이디 발급·기간·IP 관리 */
export default function AdminApp() {
  const [state, setState] = useState<'loading' | 'login' | 'ready' | 'noserver'>('loading');
  const [ephemeral, setEphemeral] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ ephemeral: boolean }>('GET', '/api/admin/me');
        setEphemeral(!!r.ephemeral);
        setState('ready');
      } catch (e) {
        setState((e as ApiError).status === 0 || (e as ApiError).status === 404 ? 'noserver' : 'login');
      }
    })();
  }, []);
  if (state === 'loading') return <div className="gutter flex min-h-screen items-center justify-center text-mute">불러오는 중…</div>;
  if (state === 'noserver') return <div className="gutter flex min-h-screen items-center justify-center text-ink2">관리자 페이지는 회원제 서버에서만 열립니다.</div>;
  if (state === 'login')
    return (
      <AdminLogin
        onDone={async () => {
          const r = await api<{ ephemeral: boolean }>('GET', '/api/admin/me').catch(() => ({ ephemeral: false }));
          setEphemeral(!!r.ephemeral);
          setState('ready');
        }}
      />
    );
  return <AdminHome ephemeral={ephemeral} onLogout={() => setState('login')} />;
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="gutter flex min-h-screen items-start justify-center pt-[14vh]">
      <form
        className="panel flex w-full max-w-[380px] flex-col gap-3 px-6 py-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr('');
          try {
            await api('POST', '/api/admin/login', { id, password: pw });
            onDone();
          } catch (e2) {
            setErr((e2 as ApiError).message);
          }
        }}
      >
        <div className="text-[17px] font-semibold">예정공정표 관리자</div>
        <Field label="관리자 아이디" htmlFor="ad-id">
          <input id="ad-id" className="inp" value={id} onChange={(e) => setId(e.target.value)} autoFocus autoComplete="username" />
        </Field>
        <Field label="비밀번호" htmlFor="ad-pw">
          <input id="ad-pw" className="inp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        </Field>
        {err && <div className="text-[13px] text-late">{err}</div>}
        <button className="btn btn-primary h-10 justify-center" disabled={!id || !pw}>
          로그인
        </button>
      </form>
    </div>
  );
}

function AdminHome({ onLogout, ephemeral }: { onLogout: () => void; ephemeral: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [today, setToday] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<AdminUser | 'new' | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; message: string; ok: () => Promise<void>; danger?: boolean; label?: string }>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: AdminUser[]; today: string }>('GET', '/api/admin/users');
      setUsers(r.users);
      setToday(r.today);
    } catch (e) {
      if ((e as ApiError).status === 401) onLogout();
      else toast.show((e as ApiError).message);
    }
  }, [onLogout]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(() => users.filter((u) => !q || `${u.username} ${u.name} ${u.company} ${u.phone} ${u.memo}`.toLowerCase().includes(q.toLowerCase())), [users, q]);
  const status = (u: AdminUser) => (!u.active ? { k: 'late', t: '정지' } : u.expires_at && u.expires_at < today ? { k: 'late', t: '만료' } : u.expires_at && u.expires_at <= addMonths(today, 1) ? { k: 'warn', t: '만료 임박' } : { k: 'ok', t: '사용 중' });
  const counts = { all: users.length, on: users.filter((u) => status(u).t === '사용 중' || status(u).t === '만료 임박').length, soon: users.filter((u) => status(u).t === '만료 임박').length };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.show(msg);
      await load();
    } catch (e) {
      toast.show((e as ApiError).message);
    }
  };

  return (
    <div className="min-h-screen pb-10">
      <header className="gutter border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-head text-[11px] font-bold text-headInk">관리</div>
          <div className="flex-1">
            <div className="text-[15px] font-semibold">예정공정표 회원 관리</div>
            <div className="text-[12px] text-mute">
              회원 {counts.all}명 · 사용 중 {counts.on}명 · 한 달 안에 만료 {counts.soon}명
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setEdit('new')}>
            + 회원 아이디 발급
          </button>
          <button
            className="btn"
            onClick={async () => {
              await api('POST', '/api/admin/logout').catch(() => {});
              onLogout();
            }}
          >
            로그아웃
          </button>
        </div>
      </header>
      <main className="gutter">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 pt-3">
          {ephemeral && (
            <div className="rounded px-3 py-2 text-[13px]" style={{ background: 'var(--late-soft)', color: 'var(--late)' }}>
              <b>데이터베이스가 연결되지 않았습니다.</b> 지금은 임시 저장소라 서버가 다시 시작되면 회원과 공정표가 모두 사라집니다. Render에서 DATABASE_URL을 설정한 뒤 회원을 발급하세요.
            </div>
          )}
          <input className="inp" style={{ maxWidth: 360 }} placeholder="아이디·이름·회사·연락처 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="회원 검색" />
          <div className="panel overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>아이디</th>
                  <th>이름 / 회사</th>
                  <th>상태</th>
                  <th>사용 기간</th>
                  <th>등록 IP</th>
                  <th className="text-right">공정표</th>
                  <th>최근 접속</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const s = status(u);
                  return (
                    <tr key={u.id}>
                      <td className="num font-semibold">{u.username}</td>
                      <td>
                        <div>{u.name || '-'}</div>
                        <div className="text-[12px] text-mute">
                          {u.company}
                          {u.phone ? ` · ${u.phone}` : ''}
                        </div>
                      </td>
                      <td>
                        <span className={`pill st-${s.k === 'warn' ? 'progress' : s.k}`} style={s.k === 'warn' ? { color: 'var(--warn)', background: 'var(--warn-soft)' } : undefined}>
                          {s.t}
                        </span>
                      </td>
                      <td className="num whitespace-nowrap text-[12.5px]">{u.expires_at ? `~ ${u.expires_at}` : '제한 없음'}</td>
                      <td>
                        <div className="num text-[12.5px] font-semibold">
                          {u.ips.length}/{u.max_ips}
                        </div>
                        {u.ips.map((i) => (
                          <div key={i.ip} className="num flex items-center gap-1 text-[11.5px] text-ink2">
                            <span title={`등록 ${fmtTime(i.first_seen)} · 최근 ${fmtTime(i.last_seen)}`}>{i.ip}</span>
                            <button
                              className="text-late hover:underline"
                              title="이 IP 삭제"
                              onClick={() => setConfirm({ title: 'IP 삭제', message: `${u.username}의 등록 IP ${i.ip}를 지웁니다. 회원이 그 장소에서 다시 접속하면 새로 등록하게 됩니다.`, label: '삭제', danger: true, ok: () => act(() => api('DELETE', `/api/admin/users/${u.id}/ips?ip=${encodeURIComponent(i.ip)}`), 'IP를 지웠습니다.') })}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </td>
                      <td className="num text-right">{u.project_count}</td>
                      <td className="num whitespace-nowrap text-[12px] text-ink2">{fmtTime(u.last_login)}</td>
                      <td className="whitespace-nowrap text-right">
                        <button className="btn btn-sm" onClick={() => setEdit(u)}>
                          수정
                        </button>{' '}
                        <button
                          className="btn btn-sm"
                          disabled={!u.ips.length}
                          onClick={() => setConfirm({ title: 'IP 초기화', message: `${u.username}의 등록 IP ${u.ips.length}개를 모두 지웁니다.`, label: '초기화', ok: () => act(() => api('DELETE', `/api/admin/users/${u.id}/ips`), 'IP를 초기화했습니다.') })}
                        >
                          IP 초기화
                        </button>{' '}
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            const pw = randomPw();
                            setConfirm({
                              title: '비밀번호 재설정',
                              message: `${u.username}의 비밀번호를 새로 만듭니다. 지금 로그인된 기기는 모두 로그아웃됩니다.`,
                              label: '재설정',
                              ok: async () => {
                                await act(() => api('PATCH', `/api/admin/users/${u.id}`, { password: pw }), '비밀번호를 재설정했습니다.');
                                setIssued({ username: u.username, password: pw });
                              },
                            });
                          }}
                        >
                          비밀번호
                        </button>{' '}
                        <button className="btn btn-sm" onClick={() => act(() => api('PATCH', `/api/admin/users/${u.id}`, { active: !u.active }), u.active ? '사용을 중지했습니다.' : '사용을 재개했습니다.')}>
                          {u.active ? '정지' : '재개'}
                        </button>{' '}
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => setConfirm({ title: '회원 삭제', message: `${u.username} 회원과 공정표 ${u.project_count}개를 모두 지웁니다. 되돌릴 수 없습니다.`, label: '삭제', danger: true, ok: () => act(() => api('DELETE', `/api/admin/users/${u.id}`), '회원을 삭제했습니다.') })}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!list.length && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-mute">
                      {users.length ? '검색 결과가 없습니다.' : '아직 발급한 회원 아이디가 없습니다. [+ 회원 아이디 발급]을 누르세요.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-mute">회원 화면 주소: {location.origin} · 회원은 아이디당 등록 IP 수(기본 3곳)까지만 접속할 수 있습니다. 사용 기간이 지나거나 정지하면 바로 막힙니다.</p>
        </div>
      </main>
      {edit && (
        <UserDialog
          user={edit === 'new' ? null : edit}
          today={today}
          onClose={() => setEdit(null)}
          onSaved={async (msg, cred) => {
            setEdit(null);
            toast.show(msg);
            if (cred) setIssued(cred);
            await load();
          }}
        />
      )}
      {confirm && <Confirm title={confirm.title} message={confirm.message} okLabel={confirm.label} danger={confirm.danger} onOk={() => void confirm.ok()} onClose={() => setConfirm(null)} />}
      {issued && (
        <Modal title="회원에게 전달할 로그인 정보" onClose={() => setIssued(null)}>
          <div className="flex flex-col gap-2 text-[14px]">
            <div className="rounded border border-line bg-sunk px-3 py-3">
              <div>
                접속 주소: <b>{location.origin}</b>
              </div>
              <div>
                아이디: <b className="num">{issued.username}</b>
              </div>
              <div>
                비밀번호: <b className="num">{issued.password}</b>
              </div>
            </div>
            <p className="text-[12.5px] text-mute">비밀번호는 이 창을 닫으면 다시 볼 수 없습니다. 회원에게 전달한 뒤, 첫 로그인 후 비밀번호를 바꾸도록 안내하세요.</p>
            <button
              className="btn btn-primary self-start"
              onClick={() => {
                const t = `[전기·통신 예정공정표]\n접속 주소: ${location.origin}\n아이디: ${issued.username}\n비밀번호: ${issued.password}`;
                navigator.clipboard?.writeText(t).then(
                  () => toast.show('복사했습니다.'),
                  () => toast.show('복사하지 못했습니다. 직접 선택해 복사하세요.'),
                );
              }}
            >
              안내 문구 복사
            </button>
          </div>
        </Modal>
      )}
      {toast.node}
    </div>
  );
}

function UserDialog({ user, today, onClose, onSaved }: { user: AdminUser | null; today: string; onClose: () => void; onSaved: (msg: string, cred?: { username: string; password: string }) => void }) {
  const isNew = !user;
  const [f, setF] = useState({
    username: user?.username ?? '',
    password: isNew ? randomPw() : '',
    name: user?.name ?? '',
    company: user?.company ?? '',
    phone: user?.phone ?? '',
    memo: user?.memo ?? '',
    expires_at: user?.expires_at ?? (today ? addMonths(today, 12) : ''),
    max_ips: user?.max_ips ?? 3,
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal
      title={isNew ? '회원 아이디 발급' : `회원 수정 · ${user!.username}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              setErr('');
              try {
                if (isNew) {
                  await api('POST', '/api/admin/users', f);
                  onSaved('회원 아이디를 발급했습니다.', { username: f.username, password: f.password });
                } else {
                  const { username: _u, password, ...rest } = f;
                  await api('PATCH', `/api/admin/users/${user!.id}`, password ? { ...rest, password } : rest);
                  onSaved('회원 정보를 저장했습니다.', password ? { username: user!.username, password } : undefined);
                }
              } catch (e) {
                setErr((e as ApiError).message);
              }
            }}
          >
            {isNew ? '발급' : '저장'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="아이디 (영문·숫자 3~30자)" htmlFor="u-id">
          <input id="u-id" className="inp num" value={f.username} disabled={!isNew} onChange={(e) => set('username', e.target.value.trim())} autoFocus={isNew} />
        </Field>
        <Field label={isNew ? '초기 비밀번호' : '새 비밀번호 (바꿀 때만)'} htmlFor="u-pw">
          <div className="flex gap-1">
            <input id="u-pw" className="inp num" value={f.password} onChange={(e) => set('password', e.target.value)} />
            <button className="btn btn-sm h-auto" type="button" onClick={() => set('password', randomPw())}>
              생성
            </button>
          </div>
        </Field>
        <Field label="이름(담당자)" htmlFor="u-name">
          <input id="u-name" className="inp" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="회사명" htmlFor="u-co">
          <input id="u-co" className="inp" value={f.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
        <Field label="연락처" htmlFor="u-ph">
          <input id="u-ph" className="inp" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="최대 등록 IP 수" htmlFor="u-ip">
          <input id="u-ip" type="number" min={1} max={20} className="inp num" value={f.max_ips} onChange={(e) => set('max_ips', Number(e.target.value))} />
        </Field>
        <Field label="사용 기간 (마지막 날)" htmlFor="u-exp" className="col-span-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <input id="u-exp" type="date" className="inp num" style={{ width: 170 }} value={f.expires_at || ''} onChange={(e) => set('expires_at', e.target.value)} />
            {[1, 3, 6, 12].map((m) => (
              <button key={m} type="button" className="btn btn-sm" onClick={() => set('expires_at', addMonths(user?.expires_at && user.expires_at >= today ? addDaysStr(user.expires_at, 1) : today, m))}>
                {isNew ? '' : '+'}
                {m}개월
              </button>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => set('expires_at', '')}>
              제한 없음
            </button>
          </div>
        </Field>
        <Field label="메모 (입금 내역 등)" htmlFor="u-memo" className="col-span-2">
          <textarea id="u-memo" className="inp" rows={2} value={f.memo} onChange={(e) => set('memo', e.target.value)} />
        </Field>
        {err && <div className="col-span-2 text-[13px] text-late">{err}</div>}
      </div>
    </Modal>
  );
}

function addDaysStr(s: string, n: number) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
