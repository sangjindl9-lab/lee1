import { useState, type FormEvent } from 'react';
import { api, errorText } from '../api/client';
import type { Role, User } from '../api/types';
import { Empty, ErrorState, InlineError, Loading, Modal } from '../components/common';
import { useAuth } from '../context/Auth';
import { useApi } from '../lib/useApi';

export function UsersPage() {
  const { user: me, can } = useAuth();
  const users = useApi(() => api<User[]>('/users'), []);
  const roles = useApi(() => api<Role[]>('/roles'), []);
  const [showForm, setShowForm] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!can('user.manage')) return <ErrorState error={new Error('사용자 관리 권한이 없습니다.')} />;

  const roleName = (code: string) => roles.data?.find((r) => r.code === code)?.name ?? code;

  async function patch(u: User, body: { role?: string; active?: boolean }) {
    setBusyId(u.id);
    setRowErr(null);
    try {
      const r = await api<User>(`/users/${encodeURIComponent(u.id)}`, { method: 'PATCH', body });
      users.setData((l) => (l ? l.map((x) => (x.id === u.id ? { ...x, ...body, ...(r && typeof r === 'object' ? r : {}) } : x)) : l));
    } catch (e) {
      setRowErr(`${u.username}: ${errorText(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>사용자 관리</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={!roles.data}>
          사용자 추가
        </button>
      </div>
      {roles.error ? <div className="banner banner-warn">역할 목록을 불러오지 못했습니다: {roles.error.message}</div> : null}
      {rowErr ? <div className="banner banner-err">{rowErr}</div> : null}
      {users.error ? <ErrorState error={users.error} onRetry={() => void users.reload()} /> : null}
      {users.loading && !users.data ? <Loading /> : null}
      {users.data && users.data.length === 0 ? <Empty text="사용자가 없습니다." /> : null}
      {users.data && users.data.length > 0 ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>아이디</th>
                <th>이름</th>
                <th>역할</th>
                <th>MFA</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => {
                const self = u.id === me?.id;
                const active = u.active !== false;
                return (
                  <tr key={u.id} className={active ? '' : 'row-offline'}>
                    <td className="mono">{u.username}</td>
                    <td>{u.display_name}</td>
                    <td>
                      {roles.data && !self ? (
                        <select value={u.role} disabled={busyId === u.id} onChange={(e) => void patch(u, { role: e.target.value })} aria-label={`${u.username} 역할`}>
                          {!roles.data.some((r) => r.code === u.role) ? <option value={u.role}>{u.role}</option> : null}
                          {roles.data.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <>
                          {roleName(u.role)}
                          {self ? <span className="muted small"> (본인)</span> : null}
                        </>
                      )}
                    </td>
                    <td>{u.mfa_enabled ? <span className="flag flag-ok">사용</span> : <span className="flag flag-unk">미사용</span>}</td>
                    <td>
                      {u.active === undefined ? <span className="muted">—</span> : null}
                      {u.active !== undefined ? (
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={active}
                            disabled={self || busyId === u.id}
                            onChange={(e) => {
                              if (!e.target.checked && !window.confirm(`${u.username} 계정을 비활성화할까요?`)) return;
                              void patch(u, { active: e.target.checked });
                            }}
                          />
                          <span>{active ? '활성' : '비활성'}</span>
                        </label>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {showForm && roles.data ? <UserForm roles={roles.data} onClose={() => setShowForm(false)} onDone={(u) => users.setData((l) => [...(l ?? []), u])} /> : null}
    </div>
  );
}

function UserForm({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: (u: User) => void }) {
  const [f, setF] = useState({ username: '', display_name: '', password: '', password2: '', role: roles[0]?.code ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const mismatch = f.password2.length > 0 && f.password !== f.password2;
  const role = roles.find((r) => r.code === f.role);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setErr(null);
    try {
      const u = await api<User>('/users', {
        method: 'POST',
        body: { username: f.username.trim(), display_name: f.display_name.trim(), password: f.password, role: f.role },
      });
      onDone(u);
      onClose();
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  }
  return (
    <Modal title="사용자 추가" onClose={() => !busy && onClose()}>
      <form className="form" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            <span>아이디</span>
            <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" required autoFocus />
          </label>
          <label className="field">
            <span>이름</span>
            <input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} required />
          </label>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>초기 비밀번호</span>
            <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required />
          </label>
          <label className="field">
            <span>비밀번호 확인</span>
            <input type="password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} autoComplete="new-password" required />
          </label>
        </div>
        {mismatch ? <div className="inline-error">비밀번호가 일치하지 않습니다.</div> : null}
        <label className="field">
          <span>역할</span>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {role ? (
          <div className="perm-list">
            {role.permissions.map((p) => (
              <span key={p} className="pill mono">
                {p}
              </span>
            ))}
          </div>
        ) : null}
        <InlineError error={err} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy || mismatch || !f.username.trim() || !f.display_name.trim() || !f.password || !f.role}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
